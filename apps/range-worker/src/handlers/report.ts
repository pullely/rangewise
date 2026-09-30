import {
  RANGE_REMOTE_LABELS,
  RANGE_VERDICTS,
  type ComplianceReportResponse,
  type ComplianceReportRow,
  type PublicPayCheck,
  type RangeVerdict,
} from "@saas/contracts/range";
import type { Env } from "../env.js";
import type { ActorContext } from "../router.js";
import { allowed } from "../authz.js";
import { nowIso, openDb } from "../context.js";
import { notFound, successResponse, unavailable, validationError } from "../http.js";
import { checkPublicId, watchedAdPublicId } from "../ids.js";
import { rulesFingerprint } from "../present.js";

/** A CSV cell: quoted, quotes doubled, and a leading = + - @ neutralised so a spreadsheet never runs it as a formula. */
export function csvCell(value: string | number | null): string {
  let s = value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * GET /v1/organizations/{org}/reports/compliance — every saved ad's latest
 * verdict per jurisdiction, with the deciding rule. `?format=csv` gives one
 * row per ad per jurisdiction.
 */
export async function handleComplianceReport(request: Request, env: Env, requestId: string, actor: ActorContext, orgId: string): Promise<Response> {
  const format = new URL(request.url).searchParams.get("format") ?? "json";
  if (format !== "json" && format !== "csv") return validationError(requestId, { format: ["json or csv"] });
  if (!(await allowed(env, actor, orgId, "range.read", requestId))) return notFound(requestId);
  const db = openDb(env);
  if (!db) return unavailable(requestId);
  try {
    const [rows, rules] = await Promise.all([db.watch.reportRows(orgId), db.range.listRules()]);
    const totals = Object.fromEntries([...RANGE_VERDICTS, "pending"].map((v) => [v, 0])) as Record<RangeVerdict | "pending", number>;
    const ads: ComplianceReportRow[] = rows.map(({ ad, resultJson }) => {
      const check = resultJson ? (JSON.parse(resultJson) as PublicPayCheck) : null;
      const overall: RangeVerdict | "pending" = check ? check.overall : "pending";
      totals[overall] += 1;
      const where = [...ad.locations, ...(ad.remote !== "none" ? [RANGE_REMOTE_LABELS[ad.remote]] : [])].join(", ");
      return {
        adId: watchedAdPublicId(ad.id),
        title: ad.title,
        source: ad.sourceKind === "url" ? (ad.sourceUrl ?? "") : `pasted text (${where})`,
        lastCheckId: ad.lastCheckId ? checkPublicId(ad.lastCheckId) : null,
        lastCheckedAt: ad.lastCheckedAt,
        overall,
        jurisdictions: (check?.results ?? []).map((r) => ({
          location: r.location,
          jurisdictionName: r.jurisdictionName,
          verdict: r.verdict,
          ruleId: r.ruleId,
          deciding: r.deciding?.requirement ?? null,
          explanation: r.deciding?.explanation ?? null,
        })),
      };
    });
    const data: ComplianceReportResponse = { generatedAt: nowIso(), rulesVersion: await rulesFingerprint(rules), totals, ads };
    if (format === "json") return successResponse(data, requestId);

    const header = ["ad_id", "title", "source", "last_checked_at", "overall", "location", "jurisdiction", "verdict", "rule_id", "deciding_rule", "explanation"];
    const lines = [header.map(csvCell).join(",")];
    for (const a of ads) {
      const base = [a.adId, a.title, a.source, a.lastCheckedAt, a.overall];
      if (a.jurisdictions.length === 0) lines.push([...base, null, null, null, null, null, null].map(csvCell).join(","));
      for (const j of a.jurisdictions) lines.push([...base, j.location, j.jurisdictionName, j.verdict, j.ruleId, j.deciding, j.explanation].map(csvCell).join(","));
    }
    return new Response(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="rangewise-compliance-${data.generatedAt.slice(0, 10)}.csv"`,
        "x-request-id": requestId,
      },
    });
  } catch {
    return unavailable(requestId);
  } finally {
    await db.dispose();
  }
}
