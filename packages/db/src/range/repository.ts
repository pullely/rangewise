import type { SqlExecutor, SqlRow } from "../d1/executor.js";
import type { RangeJurisdiction, RangeRepository, RangeRule } from "./types.js";

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
  };
}
