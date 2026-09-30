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

/** A stored check (RW2, migration 210_range_checks). Never edited; a re-check is a new row. */
export interface RangeCheckRow {
  id: string;
  orgId: string;
  title: string;
  adText: string;
  adSha256: string;
  locations: string[];
  remote: "none" | "us" | "eu" | "anywhere";
  employeeCount: number;
  checkDate: string;
  overall: string;
  /** The full PublicPayCheck JSON as returned. */
  resultJson: string;
  rulesFingerprint: string;
  ruleIds: string[];
  engineVersion: string;
  recheckedFrom: string | null;
  rootId: string;
  createdBy: string | null;
  createdAt: string;
}

export interface ListChecksQuery {
  overall?: string | undefined;
  limit: number;
  /** Keyset: rows strictly older than this (created_at, id). */
  before?: { createdAt: string; id: string } | undefined;
}

export interface RangeRepository {
  listJurisdictions(): Promise<RangeJurisdiction[]>;
  /** Every version of every rule, ordered by jurisdiction then version. */
  listRules(): Promise<RangeRule[]>;
  /** Store a check. True when the row was written (counted from RETURNING — trap 22). */
  insertCheck(row: RangeCheckRow): Promise<boolean>;
  getCheck(orgId: string, id: string): Promise<RangeCheckRow | null>;
  /** Newest first. */
  listChecks(orgId: string, query: ListChecksQuery): Promise<RangeCheckRow[]>;
  /** Every check sharing a root, oldest first. */
  listLineage(orgId: string, rootId: string): Promise<RangeCheckRow[]>;
}
