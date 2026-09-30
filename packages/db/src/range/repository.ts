import type { SqlExecutor, SqlRow } from "../d1/executor.js";
import type { RangeCheckRow, RangeJurisdiction, RangeRepository, RangeRule } from "./types.js";

type Row = SqlRow & Record<string, unknown>;

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapJurisdiction(row: Row): RangeJurisdiction {
  return {
    code: row.code as string,
    name: row.name as string,
    kind: row.kind as RangeJurisdiction["kind"],
    country: row.country as RangeJurisdiction["country"],
    sortOrder: Number(row.sort_order),
  };
}

function mapRule(row: Row): RangeRule {
  const spread = row.max_spread_pct;
  return {
    id: row.id as string,
    jurisdictionCode: row.jurisdiction_code as string,
    jurisdictionName: row.jurisdiction_name as string,
    version: Number(row.version),
    effectiveFrom: row.effective_from as string,
    effectiveTo: str(row.effective_to),
    minEmployees: Number(row.min_employees),
    employeeScope: row.employee_scope as string,
    payObligation: row.pay_obligation as RangeRule["payObligation"],
    singleFigure: row.single_figure as RangeRule["singleFigure"],
    benefitsRequired: Number(row.benefits_required) === 1,
    benefitsScope: (row.benefits_scope as string) ?? "",
    maxSpreadPct: spread === null || spread === undefined ? null : Number(spread),
    spreadStatus: (str(row.spread_status) as RangeRule["spreadStatus"]) ?? null,
    remoteCoverage: row.remote_coverage as RangeRule["remoteCoverage"],
    remoteNote: (row.remote_note as string) ?? "",
    summary: row.summary as string,
    citation: row.citation as string,
    sourceUrl: row.source_url as string,
    sourceKind: row.source_kind as RangeRule["sourceKind"],
    verification: "verified",
    verifiedOn: row.verified_on as string,
    notes: (row.notes as string) ?? "",
  };
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const CHECK_COLUMNS = `id, org_id, title, ad_text, ad_sha256, locations, remote, employee_count, check_date, overall,
  result_json, rules_fingerprint, rule_ids, engine_version, rechecked_from, root_id, created_by, created_at`;

function mapCheck(row: Row): RangeCheckRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    title: (row.title as string) ?? "",
    adText: row.ad_text as string,
    adSha256: row.ad_sha256 as string,
    locations: jsonArray(row.locations),
    remote: row.remote as RangeCheckRow["remote"],
    employeeCount: Number(row.employee_count),
    checkDate: row.check_date as string,
    overall: row.overall as string,
    resultJson: row.result_json as string,
    rulesFingerprint: row.rules_fingerprint as string,
    ruleIds: jsonArray(row.rule_ids),
    engineVersion: row.engine_version as string,
    recheckedFrom: str(row.rechecked_from),
    rootId: row.root_id as string,
    createdBy: str(row.created_by),
    createdAt: row.created_at as string,
  };
}

export function createRangeRepository(executor: SqlExecutor): RangeRepository {
  return {
    async listJurisdictions() {
      const result = await executor.execute<Row>(
        `SELECT code, name, kind, country, sort_order FROM range_jurisdictions ORDER BY sort_order, code`,
        [],
      );
      return result.rows.map(mapJurisdiction);
    },

    async listRules() {
      const result = await executor.execute<Row>(
        `SELECT r.id, r.jurisdiction_code, j.name AS jurisdiction_name, r.version, r.effective_from, r.effective_to,
                r.min_employees, r.employee_scope, r.pay_obligation, r.single_figure, r.benefits_required,
                r.benefits_scope, r.max_spread_pct, r.spread_status, r.remote_coverage, r.remote_note,
                r.summary, r.citation, r.source_url, r.source_kind, r.verification, r.verified_on, r.notes
           FROM range_rules r
           JOIN range_jurisdictions j ON j.code = r.jurisdiction_code
          ORDER BY j.sort_order, r.jurisdiction_code, r.version`,
        [],
      );
      return result.rows.map(mapRule);
    },

    async insertCheck(c) {
      const result = await executor.execute<Row>(
        `INSERT INTO range_checks (${CHECK_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          c.id, c.orgId, c.title, c.adText, c.adSha256, JSON.stringify(c.locations), c.remote, c.employeeCount, c.checkDate,
          c.overall, c.resultJson, c.rulesFingerprint, JSON.stringify(c.ruleIds), c.engineVersion, c.recheckedFrom, c.rootId,
          c.createdBy, c.createdAt,
        ],
      );
      return result.rows.length === 1;
    },

    async getCheck(orgId, id) {
      const result = await executor.execute<Row>(`SELECT ${CHECK_COLUMNS} FROM range_checks WHERE org_id = $1 AND id = $2`, [orgId, id]);
      const row = result.rows[0];
      return row ? mapCheck(row) : null;
    },

    async listChecks(orgId, q) {
      const params: unknown[] = [orgId];
      let where = "org_id = $1";
      if (q.overall) {
        params.push(q.overall);
        where += ` AND overall = $${params.length}`;
      }
      if (q.before) {
        params.push(q.before.createdAt, q.before.id);
        where += ` AND (created_at < $${params.length - 1} OR (created_at = $${params.length - 1} AND id < $${params.length}))`;
      }
      params.push(q.limit);
      const result = await executor.execute<Row>(
        `SELECT ${CHECK_COLUMNS} FROM range_checks WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
        params,
      );
      return result.rows.map(mapCheck);
    },

    async listLineage(orgId, rootId) {
      const result = await executor.execute<Row>(
        `SELECT ${CHECK_COLUMNS} FROM range_checks WHERE org_id = $1 AND root_id = $2 ORDER BY created_at, id LIMIT 200`,
        [orgId, rootId],
      );
      return result.rows.map(mapCheck);
    },
  };
}
