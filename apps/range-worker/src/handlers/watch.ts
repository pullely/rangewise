import {
  type ListWatchedAdsResponse,
  type ScanResponse,
  type SweepResponse,
  type WatchedAdDetailResponse,
  type WatchedAdResponse,
} from "@saas/contracts/range";
import type { WatchedAdRow } from "@saas/db/range";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { nowIso, openDb, todayUtc } from "../context.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { actorSubjectUuid, parseWatchedAdPublicId, watchedAdPublicId } from "../ids.js";
import { validateWatchCreate, validateWatchUpdate } from "../validate.js";
import { presentAd, presentAlert, runSweep, scanNow } from "../watch.js";
import { parseStored } from "./checks.js";

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const text = await request.text();
    return { ok: true, body: text.trim() === "" ? {} : JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/** POST /v1/organizations/{org}/watched-ads — save an ad (pasted text or a public careers-page URL). It is due at the next sweep. */
export async function handleSaveAd(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const now = nowIso();
  const today = todayUtc(now);
  const v = validateWatchCreate(parsed.body, today);
  if (!v.valid) return validationError(requestId, v.fields);
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);
  // The alert goes to the member who saved the ad, never to an address the request names.
  if (!actor.email) return validationError(requestId, { recruiter: ["Only a signed-in member with an email address can save an ad"] });
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const w = v.value;
    const row: WatchedAdRow = {
      id: crypto.randomUUID(),
      orgId,
      title: w.title,
      sourceKind: w.sourceKind,
      sourceUrl: w.sourceUrl,
      adText: w.adText,
      locations: w.locations,
      remote: w.remote,
      employeeCount: w.employeeCount,
      recruiterEmail: actor.email,
      active: true,
      revision: 1,
      scannedRevision: 0,
      lastCheckId: null,
      lastOverall: null,
      lastRulesFingerprint: null,
      lastCheckedAt: null,
      nextDueOn: today,
      lastFetchStatus: null,
      lastFetchError: null,
      lastFetchedAt: null,
      createdBy: actorSubjectUuid(actor.subjectId),
      createdAt: now,
      updatedAt: now,
    };
    if (!(await db.watch.insertAd(row))) return unavailable(requestId);
    await recordAudit(db.executor, {
      type: "range.ad.saved",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "watched_ad",
      subjectId: row.id,
      subjectName: row.title || watchedAdPublicId(row.id),
      description: `Saved ${row.sourceKind === "url" ? `the careers page ${row.sourceUrl}` : "a pasted ad"} for weekly checks`,
      payload: { adId: watchedAdPublicId(row.id), sourceKind: row.sourceKind, sourceUrl: row.sourceUrl, locations: row.locations, remote: row.remote, employeeCount: row.employeeCount },
      occurredAt: now,
    });
    const data: WatchedAdResponse = { ad: presentAd(row) };
    return successResponse(data, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** GET /v1/organizations/{org}/watched-ads */
export async function handleListAds(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const data: ListWatchedAdsResponse = { ads: (await db.watch.listAds(orgId, 200)).map(presentAd) };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** GET /v1/organizations/{org}/watched-ads/{rwa} — the ad, its latest check and its alerts. */
export async function handleGetAd(env: Env, requestId: string, actor: ActorContext, orgId: string, adId: string): Promise<Response> {
  const id = parseWatchedAdPublicId(adId);
  if (!id) return notFound(requestId);
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const ad = await db.watch.getAd(orgId, id);
    if (!ad) return notFound(requestId);
    const last = ad.lastCheckId ? await db.range.getCheck(orgId, ad.lastCheckId) : null;
    const alerts = await db.watch.listAlerts(orgId, id, 20);
    const data: WatchedAdDetailResponse = { ad: presentAd(ad), lastCheck: last ? parseStored(last) : null, alerts: alerts.map(presentAlert) };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** PATCH /v1/organizations/{org}/watched-ads/{rwa} — edit the ad or its facts (due again today), or pause it. */
export async function handleUpdateAd(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string, adId: string): Promise<Response> {
  const id = parseWatchedAdPublicId(adId);
  if (!id) return notFound(requestId);
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const current = await db.watch.getAd(orgId, id);
    if (!current) return notFound(requestId);
    const now = nowIso();
    const v = validateWatchUpdate(parsed.body, current, todayUtc(now));
    if (!v.valid) return validationError(requestId, v.fields);
    const updated = await db.watch.editAd(orgId, id, v.value.edit, v.value.bump, now, todayUtc(now));
    if (!updated) return notFound(requestId);
    await recordAudit(db.executor, {
      type: "range.ad.updated",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "watched_ad",
      subjectId: id,
      subjectName: updated.title || watchedAdPublicId(id),
      description: `Updated saved ad "${updated.title || watchedAdPublicId(id)}" (${Object.keys(v.value.edit).join(", ") || "no change"})${v.value.bump ? "; due for a re-check" : ""}`,
      payload: { adId: watchedAdPublicId(id), fields: Object.keys(v.value.edit), revision: updated.revision },
      occurredAt: now,
    });
    const data: WatchedAdResponse = { ad: presentAd(updated) };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** POST /v1/organizations/{org}/watched-ads/{rwa}/scan — scan one saved ad now. */
export async function handleScanAd(env: Env, requestId: string, actor: ActorContext, orgId: string, adId: string): Promise<Response> {
  const id = parseWatchedAdPublicId(adId);
  if (!id) return notFound(requestId);
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const ad = await db.watch.getAd(orgId, id);
    if (!ad) return notFound(requestId);
    const outcome = await scanNow(env, db, ad, { now: nowIso(), actor, requestId });
    const after = (await db.watch.getAd(orgId, id)) ?? ad;
    const data: ScanResponse = { ad: presentAd(after), outcome };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/**
 * POST /v1/organizations/{org}/watched-ads/sweep — run the daily sweep for
 * this org now. It claims the same windows the cron does, so a sweep and a
 * tick (or two sweeps) on the same day re-check an ad once.
 */
export async function handleSweep(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const data: SweepResponse = await runSweep(env, db, { now: nowIso(), orgId, triggeredBy: "sweep", actor, requestId });
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
