import {
  WATCH_RESCAN_DAYS,
  verdictRank,
  type PublicAlert,
  type PublicPayCheck,
  type PublicWatchedAd,
  type RangeVerdict,
  type ScanOutcome,
  type SweepResponse,
  type VerdictChange,
  type WatchScanReason,
} from "@saas/contracts/range";
import type { AlertRow, RangeRule, WatchedAdRow } from "@saas/db/range";
import type { Env } from "./env.js";
import type { ActorContext } from "./router.js";
import type { Db } from "./context.js";
import { recordAudit } from "./audit.js";
import { ruleInForce, targets } from "./engine/index.js";
import { fetchAdText } from "./fetch-ad.js";
import { parseStored, runAndStore, verdictChanges } from "./handlers/checks.js";
import { alertPublicId, checkPublicId, watchedAdPublicId } from "./ids.js";
import { sendWorsened } from "./notify.js";
import { sha256Hex, toPublicRule } from "./present.js";

/** The actor a scheduled scan runs as. */
export const SYSTEM_ACTOR: ActorContext = { subjectId: "range-worker", subjectType: "system", email: null };

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function presentAd(a: WatchedAdRow): PublicWatchedAd {
  return {
    id: watchedAdPublicId(a.id),
    title: a.title,
    sourceKind: a.sourceKind,
    sourceUrl: a.sourceUrl,
    adText: a.adText,
    locations: a.locations,
    remote: a.remote,
    employeeCount: a.employeeCount,
    recruiterEmail: a.recruiterEmail,
    active: a.active,
    revision: a.revision,
    lastCheckId: a.lastCheckId ? checkPublicId(a.lastCheckId) : null,
    lastOverall: (a.lastOverall as RangeVerdict | null) ?? null,
    lastCheckedAt: a.lastCheckedAt,
    nextDueOn: a.nextDueOn,
    lastFetch: a.lastFetchStatus && a.lastFetchedAt ? { status: a.lastFetchStatus, error: a.lastFetchError, at: a.lastFetchedAt } : null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function presentAlert(a: AlertRow): PublicAlert {
  let worsened: VerdictChange[] = [];
  try {
    worsened = JSON.parse(a.worsened) as VerdictChange[];
  } catch {
    worsened = [];
  }
  return {
    id: alertPublicId(a.id),
    checkId: checkPublicId(a.checkId),
    previousCheckId: a.previousCheckId ? checkPublicId(a.previousCheckId) : null,
    previousOverall: (a.previousOverall as RangeVerdict | null) ?? null,
    overall: a.overall as RangeVerdict,
    worsened,
    recipient: a.recipient,
    status: a.status,
    createdAt: a.createdAt,
  };
}

/**
 * A fingerprint of the rule versions in force today for the jurisdictions this
 * ad is checked in. A rules migration that adds a version, or ends one, for
 * any of them changes it — and makes the ad due at the next tick.
 */
export async function adRulesFingerprint(ad: Pick<WatchedAdRow, "locations" | "remote" | "employeeCount">, rules: RangeRule[], today: string): Promise<string> {
  const pub = rules.map(toPublicRule);
  const codes = targets({ locations: ad.locations, remote: ad.remote, employeeCount: ad.employeeCount, checkDate: today }, pub).map((t) => t.code);
  const ids = [...new Set(codes)]
    .map((code) => {
      const r = ruleInForce(pub, code, today);
      return r ? `${r.id}:${r.effectiveFrom}:${r.effectiveTo ?? ""}` : `${code}:none`;
    })
    .sort();
  return `rf_${(await sha256Hex(ids.join("|"))).slice(0, 16)}`;
}

/** Why an ad is due today, and the window its scan claims — or null when it is not due. */
export function dueWindow(ad: WatchedAdRow, fingerprint: string, today: string): { reason: WatchScanReason; windowKey: string } | null {
  if (ad.scannedRevision < ad.revision) return { reason: ad.revision === 1 && !ad.lastCheckId ? "new" : "edited", windowKey: `rev:${ad.revision}` };
  if (ad.lastRulesFingerprint !== null && ad.lastRulesFingerprint !== fingerprint) return { reason: "rules_changed", windowKey: `rules:${fingerprint}` };
  if (ad.nextDueOn <= today) return { reason: "weekly", windowKey: `week:${ad.nextDueOn}` };
  return null;
}

/** Locations whose verdict got worse (pass → review, review → fail, …), and whether the overall verdict did. */
export function worsening(before: PublicPayCheck, after: PublicPayCheck): VerdictChange[] {
  const worse = verdictChanges(before, after).filter((c) => c.from !== null && c.to !== null && verdictRank(c.to) > verdictRank(c.from));
  if (worse.length === 0 && verdictRank(after.overall) > verdictRank(before.overall)) {
    return [{ location: "overall", from: before.overall, to: after.overall }];
  }
  return worse;
}

interface ScanContext {
  env: Env;
  db: Db;
  rules: RangeRule[];
  now: string;
  today: string;
  requestId: string;
  actor: ActorContext;
  triggeredBy: "cron" | "sweep" | "manual";
}

/**
 * Scan one saved ad: claim its window, fetch the page when it is a URL ad,
 * run and store the check (a re-check in the ad's lineage), record it on the
 * ad, and alert the recruiter once if the verdict got worse.
 */
export async function scanAd(ctx: ScanContext, ad: WatchedAdRow, window: { reason: WatchScanReason; windowKey: string }, fingerprint: string): Promise<ScanOutcome | "already_claimed"> {
  const { db, now, today } = ctx;
  const runId = await db.watch.claimScan({
    id: crypto.randomUUID(),
    adId: ad.id,
    orgId: ad.orgId,
    windowKey: window.windowKey,
    reason: window.reason,
    triggeredBy: ctx.triggeredBy,
    startedAt: now,
    today,
  });
  if (!runId) return "already_claimed";
  const fail = async (error: string): Promise<ScanOutcome> => {
    await db.watch.finishScan(runId, { status: "failed", checkId: null, error, finishedAt: new Date().toISOString() });
    return { adId: watchedAdPublicId(ad.id), reason: window.reason, status: "failed", checkId: null, overall: null, error, alert: null };
  };

  let adText = ad.adText;
  if (ad.sourceKind === "url" && ad.sourceUrl) {
    const fetched = await fetchAdText(ad.sourceUrl);
    if (fetched.status !== "ok") {
      await db.watch.recordFetch(ad.id, { status: fetched.status, error: fetched.error, at: now });
      return fail(fetched.error);
    }
    adText = fetched.text;
    await db.watch.recordFetch(ad.id, { status: "ok", error: null, at: now, adText });
  }
  if (!adText.trim()) return fail("The ad has no text to check");

  const previous = ad.lastCheckId ? await db.range.getCheck(ad.orgId, ad.lastCheckId) : null;
  const stored = await runAndStore(
    db,
    { title: ad.title, adText, locations: ad.locations, remote: ad.remote, employeeCount: ad.employeeCount, checkDate: today },
    {
      orgId: ad.orgId,
      actor: ctx.actor,
      requestId: ctx.requestId,
      now,
      rules: ctx.rules,
      recheckOf: previous,
      auditType: previous ? "range.check.rechecked" : "range.check.run",
      extraPayload: { watchedAdId: watchedAdPublicId(ad.id), scanReason: window.reason },
    },
  );
  if (!stored) return fail("The check could not be stored");
  await db.watch.recordScan(ad.id, {
    checkId: stored.row.id,
    overall: stored.check.overall,
    rulesFingerprint: fingerprint,
    checkedAt: now,
    scannedRevision: ad.revision,
    nextDueOn: addDays(today, WATCH_RESCAN_DAYS),
  });
  await db.watch.finishScan(runId, { status: "checked", checkId: stored.row.id, error: null, finishedAt: new Date().toISOString() });
  await recordAudit(db.executor, {
    type: "range.ad.scanned",
    orgId: ad.orgId,
    actor: { type: ctx.actor.subjectType, id: ctx.actor.subjectId },
    requestId: ctx.requestId,
    subjectKind: "watched_ad",
    subjectId: ad.id,
    subjectName: ad.title || watchedAdPublicId(ad.id),
    description: `Scanned saved ad "${ad.title || watchedAdPublicId(ad.id)}" (${window.reason}): ${stored.check.overall}`,
    payload: { adId: watchedAdPublicId(ad.id), reason: window.reason, windowKey: window.windowKey, checkId: stored.check.id, overall: stored.check.overall },
    occurredAt: now,
  });

  let alert: ScanOutcome["alert"] = null;
  if (previous) {
    const before = parseStored(previous);
    const worse = worsening(before, stored.check);
    if (worse.length) alert = await raiseAlert(ctx, ad, before, stored.check, previous.id, stored.row.id, worse);
  }
  return {
    adId: watchedAdPublicId(ad.id),
    reason: window.reason,
    status: "checked",
    checkId: stored.check.id,
    overall: stored.check.overall,
    error: null,
    alert,
  };
}

async function raiseAlert(
  ctx: ScanContext,
  ad: WatchedAdRow,
  before: PublicPayCheck,
  after: PublicPayCheck,
  previousCheckId: string,
  checkId: string,
  worse: VerdictChange[],
): Promise<ScanOutcome["alert"]> {
  const { db, now } = ctx;
  const id = crypto.randomUUID();
  const inserted = await db.watch.insertAlert({
    id,
    adId: ad.id,
    orgId: ad.orgId,
    checkId,
    previousCheckId,
    previousOverall: before.overall,
    overall: after.overall,
    worsened: JSON.stringify(worse),
    recipient: ad.recruiterEmail,
    status: "pending",
    notificationId: null,
    error: null,
    createdAt: now,
    updatedAt: now,
  });
  // UNIQUE (ad_id, check_id): someone already alerted for this check — never email twice.
  if (!inserted) return null;
  const sent = await sendWorsened(ctx.env, ctx.requestId, ctx.actor, ad, { alertId: id, before, after, worse });
  const status = sent.ok ? "accepted" : "failed";
  await db.watch.updateAlert(id, { status, notificationId: sent.ok ? sent.notificationId : null, error: sent.ok ? null : sent.reason, updatedAt: new Date().toISOString() });
  await recordAudit(db.executor, {
    type: "range.ad.alerted",
    orgId: ad.orgId,
    actor: { type: ctx.actor.subjectType, id: ctx.actor.subjectId },
    requestId: ctx.requestId,
    subjectKind: "watched_ad",
    subjectId: ad.id,
    subjectName: ad.title || watchedAdPublicId(ad.id),
    description: `Verdict got worse for "${ad.title || watchedAdPublicId(ad.id)}" (${before.overall} → ${after.overall}); alert ${status}`,
    payload: { adId: watchedAdPublicId(ad.id), alertId: alertPublicId(id), checkId: after.id, worsened: worse, status },
    occurredAt: now,
  });
  return { id: alertPublicId(id), status, worsened: worse };
}

const SWEEP_CONSIDER = 500;
const SWEEP_SCAN_MAX = 25;

/**
 * The sweep: every active saved ad that is due (new or edited, its rules
 * changed, or a week since its last scan) is claimed and scanned — at most 25
 * per call, soonest due first. The daily cron runs it over every org; the
 * sweep route runs it for one org. Two sweeps the same day scan an ad once,
 * because the claim is UNIQUE per (ad, window).
 */
export async function runSweep(
  env: Env,
  db: Db,
  opts: { now: string; orgId: string | null; triggeredBy: "cron" | "sweep"; actor: ActorContext; requestId: string },
): Promise<SweepResponse> {
  const today = opts.now.slice(0, 10);
  const rules = await db.range.listRules();
  const ads = await db.watch.listActiveAds(opts.orgId, SWEEP_CONSIDER);
  const ctx: ScanContext = { env, db, rules, now: opts.now, today, requestId: opts.requestId, actor: opts.actor, triggeredBy: opts.triggeredBy };
  const scanned: ScanOutcome[] = [];
  let alreadyClaimed = 0;
  for (const ad of ads) {
    if (scanned.length >= SWEEP_SCAN_MAX) break;
    const fingerprint = await adRulesFingerprint(ad, rules, today);
    const window = dueWindow(ad, fingerprint, today);
    if (!window) continue;
    const outcome = await scanAd(ctx, ad, window, fingerprint);
    if (outcome === "already_claimed") alreadyClaimed += 1;
    else scanned.push(outcome);
  }
  return { today, considered: ads.length, scanned, alreadyClaimed };
}

/** A scan on request: its own window, so it always runs. */
export async function scanNow(env: Env, db: Db, ad: WatchedAdRow, opts: { now: string; actor: ActorContext; requestId: string }): Promise<ScanOutcome> {
  const today = opts.now.slice(0, 10);
  const rules = await db.range.listRules();
  const fingerprint = await adRulesFingerprint(ad, rules, today);
  const ctx: ScanContext = { env, db, rules, now: opts.now, today, requestId: opts.requestId, actor: opts.actor, triggeredBy: "manual" };
  const outcome = await scanAd(ctx, ad, { reason: "manual", windowKey: `manual:${crypto.randomUUID()}` }, fingerprint);
  // A fresh window is never already claimed.
  return outcome === "already_claimed" ? { adId: watchedAdPublicId(ad.id), reason: "manual", status: "failed", checkId: null, overall: null, error: "claimed", alert: null } : outcome;
}
