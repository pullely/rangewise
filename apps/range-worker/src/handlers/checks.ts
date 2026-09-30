import {
  RANGE_VERDICTS,
  describePay,
  overallVerdict,
  type ListPayChecksResponse,
  type PayCheckDetailResponse,
  type PayCheckResponse,
  type PayCheckSummary,
  type PublicPayCheck,
  type RecheckResponse,
  type VerdictChange,
} from "@saas/contracts/range";
import type { RangeCheckRow, RangeRule } from "@saas/db/range";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { nowIso, openDb, todayUtc, type Db } from "../context.js";
import { ENGINE_VERSION, evaluate, extractAd } from "../engine/index.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { actorSubjectUuid, checkPublicId, parseCheckPublicId } from "../ids.js";
import { rulesFingerprint, sha256Hex, toPublicRule } from "../present.js";
import { validateCheckBody, type ValidCheck } from "../validate.js";

async function readJson(request: Request, allowEmpty = false): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    const text = await request.text();
    if (allowEmpty && text.trim() === "") return { ok: true, body: {} };
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export interface StoredCheck {
  check: PublicPayCheck;
  row: RangeCheckRow;
}

/**
 * Run one check and store it (RW2). The row is written before the response,
 * with `RETURNING id` (trap 22); the audit row follows, best-effort. Used by
 * the manual check, the re-check and (RW3) the saved-ad scan.
 */
export async function runAndStore(
  db: Db,
  input: ValidCheck,
  opts: {
    orgId: string;
    actor: ActorContext;
    requestId: string;
    now: string;
    rules: RangeRule[];
    recheckOf?: RangeCheckRow | null;
    auditType?: "range.check.run" | "range.check.rechecked";
    extraPayload?: Record<string, unknown>;
  },
): Promise<StoredCheck | null> {
  const { orgId, actor, requestId, now, rules } = opts;
  const extracted = extractAd(input.adText);
  const results = evaluate(
    extracted,
    { locations: input.locations, remote: input.remote, employeeCount: input.employeeCount, checkDate: input.checkDate },
    rules.map(toPublicRule),
  );
  const uuid = crypto.randomUUID();
  const ruleIds = [...new Set(results.map((r) => r.ruleId).filter((x): x is string => x !== null))].sort();
  const recheckOf = opts.recheckOf ?? null;
  const check: PublicPayCheck = {
    id: checkPublicId(uuid),
    title: input.title,
    overall: overallVerdict(results.map((r) => r.verdict)),
    checkDate: input.checkDate,
    employeeCount: input.employeeCount,
    remote: input.remote,
    locations: input.locations,
    adSha256: await sha256Hex(input.adText),
    extracted,
    results,
    rulesVersion: await rulesFingerprint(rules),
    checkedAt: now,
    ruleIds,
    recheckedFrom: recheckOf ? checkPublicId(recheckOf.id) : null,
    rootId: checkPublicId(recheckOf ? recheckOf.rootId : uuid),
    engineVersion: ENGINE_VERSION,
  };
  const row: RangeCheckRow = {
    id: uuid,
    orgId,
    title: input.title,
    adText: input.adText,
    adSha256: check.adSha256,
    locations: input.locations,
    remote: input.remote,
    employeeCount: input.employeeCount,
    checkDate: input.checkDate,
    overall: check.overall,
    resultJson: JSON.stringify(check),
    rulesFingerprint: check.rulesVersion,
    ruleIds,
    engineVersion: ENGINE_VERSION,
    recheckedFrom: recheckOf ? recheckOf.id : null,
    rootId: recheckOf ? recheckOf.rootId : uuid,
    createdBy: actorSubjectUuid(actor.subjectId),
    createdAt: now,
  };
  if (!(await db.range.insertCheck(row))) return null;

  const counts: Record<string, number> = {};
  for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
  const label = input.title || `ad ${check.adSha256.slice(0, 8)}`;
  const type = opts.auditType ?? "range.check.run";
  await recordAudit(db.executor, {
    type,
    orgId,
    actor: { type: actor.subjectType, id: actor.subjectId },
    requestId,
    subjectKind: "pay_check",
    subjectId: uuid,
    subjectName: label,
    description: `${type === "range.check.rechecked" ? "Re-checked" : "Checked"} "${label}" against ${results.length} jurisdiction(s): ${check.overall}${
      Object.keys(counts).length ? ` (${Object.entries(counts).map(([v, n]) => `${n} ${v}`).join(", ")})` : ""
    }`,
    payload: {
      checkId: check.id,
      overall: check.overall,
      checkDate: check.checkDate,
      employeeCount: check.employeeCount,
      remote: check.remote,
      adSha256: check.adSha256,
      payKind: extracted.pay.kind,
      rulesVersion: check.rulesVersion,
      ruleIds,
      recheckedFrom: check.recheckedFrom,
      verdicts: results.map((r) => ({ location: r.location, ruleId: r.ruleId, verdict: r.verdict, deciding: r.deciding?.requirement ?? null })),
      ...(opts.extraPayload ?? {}),
    },
    occurredAt: now,
  });
  return { check, row };
}

export function parseStored(row: RangeCheckRow): PublicPayCheck {
  return JSON.parse(row.resultJson) as PublicPayCheck;
}

export function summarise(row: RangeCheckRow): PayCheckSummary {
  const check = parseStored(row);
  return {
    id: checkPublicId(row.id),
    title: row.title,
    overall: row.overall as PayCheckSummary["overall"],
    checkDate: row.checkDate,
    locations: row.locations,
    remote: row.remote,
    employeeCount: row.employeeCount,
    adSha256: row.adSha256,
    payText: describePay(check.extracted.pay),
    ruleIds: row.ruleIds,
    rulesVersion: row.rulesFingerprint,
    recheckedFrom: row.recheckedFrom ? checkPublicId(row.recheckedFrom) : null,
    rootId: checkPublicId(row.rootId),
    checkedAt: row.createdAt,
  };
}

/** Per-location verdict changes between two checks (a location in only one of them changes from or to null). */
export function verdictChanges(before: PublicPayCheck, after: PublicPayCheck): VerdictChange[] {
  const was = new Map(before.results.map((r) => [r.location, r.verdict]));
  const now = new Map(after.results.map((r) => [r.location, r.verdict]));
  const out: VerdictChange[] = [];
  for (const loc of new Set([...was.keys(), ...now.keys()])) {
    const from = was.get(loc) ?? null;
    const to = now.get(loc) ?? null;
    if (from !== to) out.push({ location: loc, from, to });
  }
  return out;
}

/**
 * POST /v1/organizations/{org}/pay-checks — check one ad against the rules in
 * force on the check date, and store it (RW2: 201 with the stored check; RW1
 * answered 200 and stored nothing).
 */
export async function handleRunCheck(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const now = nowIso();
  const validation = validateCheckBody(parsed.body, todayUtc(now));
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const rules = await db.range.listRules();
    const stored = await runAndStore(db, validation.value, { orgId, actor, requestId, now, rules });
    if (!stored) return unavailable(requestId);
    const data: PayCheckResponse = { check: stored.check };
    return successResponse(data, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

const LIMIT_DEFAULT = 25;
const LIMIT_MAX = 100;

function encodeCursor(row: RangeCheckRow): string {
  return btoa(`${row.createdAt}|${row.id}`).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  try {
    const raw = atob(cursor.replace(/-/g, "+").replace(/_/g, "/"));
    const [createdAt, id] = raw.split("|");
    if (!createdAt || !id || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt)) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/** GET /v1/organizations/{org}/pay-checks — the check history, newest first; `?overall=`, `?limit=`, `?cursor=`. */
export async function handleListChecks(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  const url = new URL(request.url);
  const fields: Record<string, string[]> = {};
  const overall = url.searchParams.get("overall");
  if (overall !== null && !(RANGE_VERDICTS as readonly string[]).includes(overall)) fields.overall = [`One of ${RANGE_VERDICTS.join(", ")}`];
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw === null ? LIMIT_DEFAULT : Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > LIMIT_MAX) fields.limit = [`A whole number from 1 to ${LIMIT_MAX}`];
  const cursorRaw = url.searchParams.get("cursor");
  const before = cursorRaw ? decodeCursor(cursorRaw) : undefined;
  if (cursorRaw && !before) fields.cursor = ["Not a cursor this API returned"];
  if (Object.keys(fields).length) return validationError(requestId, fields);
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const rows = await db.range.listChecks(orgId, { overall: overall ?? undefined, limit: limit + 1, before: before ?? undefined });
    const page = rows.slice(0, limit);
    const data: ListPayChecksResponse = {
      checks: page.map(summarise),
      nextCursor: rows.length > limit ? encodeCursor(page[page.length - 1]!) : null,
    };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/** GET /v1/organizations/{org}/pay-checks/{rwc} — one stored check with its ad text, evidence and lineage. */
export async function handleGetCheck(env: Env, requestId: string, actor: ActorContext, orgId: string, checkId: string): Promise<Response> {
  const id = parseCheckPublicId(checkId);
  if (!id) return notFound(requestId);
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const row = await db.range.getCheck(orgId, id);
    if (!row) return notFound(requestId);
    const lineage = await db.range.listLineage(orgId, row.rootId);
    const data: PayCheckDetailResponse = { check: parseStored(row), adText: row.adText, lineage: lineage.map(summarise) };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}

/**
 * POST /v1/organizations/{org}/pay-checks/{rwc}/recheck — run a stored check
 * again, against today's rules unless `checkDate` is given. Any field of the
 * original request may be changed (an edited ad); omitted ones are the stored
 * check's. The result is a NEW row in the same lineage; the original is not
 * touched.
 */
export async function handleRecheck(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string, checkId: string): Promise<Response> {
  const id = parseCheckPublicId(checkId);
  if (!id) return notFound(requestId);
  const parsed = await readJson(request, true);
  if (!parsed.ok || !parsed.body || typeof parsed.body !== "object" || Array.isArray(parsed.body)) {
    return validationError(requestId, { body: ["Expected a JSON object (or no body)"] });
  }
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const original = await db.range.getCheck(orgId, id);
    if (!original) return notFound(requestId);
    const now = nowIso();
    const changes = parsed.body as Record<string, unknown>;
    const merged = {
      title: original.title,
      adText: original.adText,
      locations: original.locations,
      remote: original.remote,
      employeeCount: original.employeeCount,
      ...changes,
      checkDate: changes.checkDate ?? todayUtc(now),
    };
    const validation = validateCheckBody(merged, todayUtc(now));
    if (!validation.valid) return validationError(requestId, validation.fields);
    const rules = await db.range.listRules();
    const stored = await runAndStore(db, validation.value, {
      orgId,
      actor,
      requestId,
      now,
      rules,
      recheckOf: original,
      auditType: "range.check.rechecked",
      extraPayload: { adEdited: validation.value.adText !== original.adText },
    });
    if (!stored) return unavailable(requestId);
    const before = parseStored(original);
    const data: RecheckResponse = { check: stored.check, previous: summarise(original), changes: verdictChanges(before, stored.check) };
    return successResponse(data, requestId, 201);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
