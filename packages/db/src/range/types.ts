/**
 * Rangewise (`range`) bounded context — the pay-transparency rules table.
 * Global reference data, written only by migrations (see 200_range_rules).
 */

export interface RangeJurisdiction {
  code: string;
  name: string;
  kind: "us_state" | "us_district" | "eu";
  country: "US" | "EU";
  sortOrder: number;
}

export interface RangeRule {
  id: string;
  jurisdictionCode: string;
  jurisdictionName: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  minEmployees: number;
  employeeScope: string;
  payObligation: "in_posting" | "on_request";
  singleFigure: "allowed" | "review";
  benefitsRequired: boolean;
  benefitsScope: string;
  maxSpreadPct: number | null;
  spreadStatus: "in_force" | "proposed" | null;
  remoteCoverage: "covered" | "unsettled";
  remoteNote: string;
  summary: string;
  citation: string;
  sourceUrl: string;
  sourceKind: "statute" | "official_guidance" | "official_journal";
  verification: "verified";
  verifiedOn: string;
  notes: string;
}

export interface RangeRepository {
  listJurisdictions(): Promise<RangeJurisdiction[]>;
  /** Every version of every rule, ordered by jurisdiction then version. */
  listRules(): Promise<RangeRule[]>;
}
