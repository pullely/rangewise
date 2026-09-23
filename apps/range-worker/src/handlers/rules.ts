import { RANGE_UNVERIFIED_JURISDICTIONS, type ListPayRulesResponse } from "@saas/contracts/range";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { openDb } from "../context.js";
import { notFound, successResponse, unavailable } from "../http.js";
import { rulesFingerprint, toPublicJurisdiction, toPublicRule } from "../present.js";

/** GET /v1/organizations/{org}/pay-rules — the whole rules table, every version, with citations. */
export async function handleListRules(env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const [rules, jurisdictions] = await Promise.all([db.range.listRules(), db.range.listJurisdictions()]);
    const data: ListPayRulesResponse = {
      rules: rules.map(toPublicRule),
      jurisdictions: jurisdictions.map(toPublicJurisdiction),
      notCovered: Object.entries(RANGE_UNVERIFIED_JURISDICTIONS).map(([code, reason]) => ({ code, reason })),
      rulesVersion: await rulesFingerprint(rules),
    };
    return successResponse(data, requestId);
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
