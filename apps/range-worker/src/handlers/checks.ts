import { overallVerdict, type PayCheckResponse, type PublicPayCheck } from "@saas/contracts/range";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { recordAudit } from "../audit.js";
import { nowIso, openDb, todayUtc } from "../context.js";
import { evaluate, extractAd } from "../engine/index.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { checkPublicId } from "../ids.js";
import { rulesFingerprint, sha256Hex, toPublicRule } from "../present.js";
import { validateCheckBody } from "../validate.js";

async function readJson(request: Request): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return { ok: false };
  }
}

/**
 * POST /v1/organizations/{org}/pay-checks — check one ad against the rules in
 * force on the check date. RW1 returns the result and audits it (verdicts and
 * the ad's SHA-256, never its text); RW2 stores it under the same id.
 */
export async function handleRunCheck(
  request: Request,
  env: Env,
  requestId: string,
  actor: ActorContext,
  orgId: string,
): Promise<Response> {
  const parsed = await readJson(request);
  if (!parsed.ok) return validationError(requestId, { body: ["Invalid JSON"] });
  const now = nowIso();
  const validation = validateCheckBody(parsed.body, todayUtc(now));
  if (!validation.valid) return validationError(requestId, validation.fields);
  if (!(await allowed(env, actor, orgId, "range.write", requestId))) return notFound(requestId);

  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const input = validation.value;
    const rules = await db.range.listRules();
    const extracted = extractAd(input.adText);
    const results = evaluate(
      extracted,
      { locations: input.locations, remote: input.remote, employeeCount: input.employeeCount, checkDate: input.checkDate },
      rules.map(toPublicRule),
    );
    const id = crypto.randomUUID();
    const check: PublicPayCheck = {
      id: checkPublicId(id),
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
    };
    const counts: Record<string, number> = {};
    for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;
    const label = input.title || `ad ${check.adSha256.slice(0, 8)}`;
    await recordAudit(db.executor, {
      type: "range.check.run",
      orgId,
      actor: { type: actor.subjectType, id: actor.subjectId },
      requestId,
      subjectKind: "pay_check",
      subjectId: id,
      subjectName: label,
      description: `Checked "${label}" against ${results.length} jurisdiction(s): ${check.overall}${
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
        verdicts: results.map((r) => ({ location: r.location, ruleId: r.ruleId, verdict: r.verdict, deciding: r.deciding?.requirement ?? null })),
      },
      occurredAt: now,
    });
    const data: PayCheckResponse = { check };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
