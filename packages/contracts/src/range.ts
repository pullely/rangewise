/**
 * Rangewise (`range`) bounded context — the pay-transparency rules table and
 * the job-ad check (RW1). The organization is the employer or the recruiting
 * agency; its members are recruiters.
 *
 * A verdict is a pure function of the ad text, the facts the user states
 * (locations, remote, headcount, date) and a rule version. Every rule carries
 * the citation and source it was read from. Rangewise never says an ad is
 * "compliant with the law": it says the ad passes or fails Rangewise's rule
 * for a jurisdiction, as cited.
 */

/** A check's answer for one jurisdiction. */
export const RANGE_VERDICTS = ["pass", "fail", "review", "not_applicable", "not_in_force", "not_covered"] as const;
export type RangeVerdict = (typeof RANGE_VERDICTS)[number];

export const RANGE_VERDICT_LABELS: Record<RangeVerdict, string> = {
  pass: "Passes",
  fail: "Fails",
  review: "Needs review",
  not_applicable: "Not applicable (employer size)",
  not_in_force: "Not yet in force",
  not_covered: "Not covered by Rangewise",
};

/** Worst first: the overall verdict of a check is the first of these any jurisdiction got. */
export const RANGE_VERDICT_SEVERITY: readonly RangeVerdict[] = [
  "fail",
  "review",
  "pass",
  "not_applicable",
  "not_in_force",
  "not_covered",
];

/** The requirements a rule can impose, in the order they decide a verdict. */
export const RANGE_REQUIREMENTS = [
  "in_force",
  "employer_size",
  "pay_disclosed",
  "range_bounded",
  "single_figure",
  "spread",
  "benefits_described",
  "on_request",
  // RW2
  "pay_currency",
  "apply_info",
] as const;
export type RangeRequirement = (typeof RANGE_REQUIREMENTS)[number];

export const RANGE_REQUIREMENT_LABELS: Record<RangeRequirement, string> = {
  in_force: "Rule in force on the check date",
  employer_size: "Employer-size threshold",
  pay_disclosed: "Pay stated in the ad",
  range_bounded: "Range has a bottom and a top",
  single_figure: "Single figure instead of a range",
  spread: "Width of the range",
  benefits_described: "Benefits described",
  on_request: "Pay available before the interview",
  pay_currency: "Pay in the jurisdiction's currency",
  apply_info: "How and when to apply",
};

export const RANGE_OUTCOMES = ["met", "failed", "review"] as const;
export type RangeOutcome = (typeof RANGE_OUTCOMES)[number];

export const RANGE_REMOTE_AREAS = ["none", "us", "eu", "anywhere"] as const;
export type RangeRemoteArea = (typeof RANGE_REMOTE_AREAS)[number];

export const RANGE_REMOTE_LABELS: Record<RangeRemoteArea, string> = {
  none: "Not remote",
  us: "Remote, anywhere in the US",
  eu: "Remote, anywhere in the EU",
  anywhere: "Remote, anywhere",
};

export const RANGE_PAY_OBLIGATIONS = ["in_posting", "on_request"] as const;
export type RangePayObligation = (typeof RANGE_PAY_OBLIGATIONS)[number];

export const RANGE_SINGLE_FIGURE_POLICIES = ["allowed", "review"] as const;
export type RangeSingleFigurePolicy = (typeof RANGE_SINGLE_FIGURE_POLICIES)[number];

export const RANGE_REMOTE_COVERAGE = ["covered", "unsettled"] as const;
export type RangeRemoteCoverage = (typeof RANGE_REMOTE_COVERAGE)[number];

export const RANGE_SOURCE_KINDS = ["statute", "official_guidance", "official_journal"] as const;
export type RangeSourceKind = (typeof RANGE_SOURCE_KINDS)[number];

export const RANGE_SOURCE_KIND_LABELS: Record<RangeSourceKind, string> = {
  statute: "Statute text",
  official_guidance: "Official agency guidance",
  official_journal: "Official Journal of the EU",
};

/** The 27 EU member states, as ISO 3166-1 alpha-2 (Greece is EL in EU usage; GR is accepted too). */
export const EU_MEMBER_STATES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "GR", "HR", "HU", "IE",
  "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
] as const;

/** The 50 states plus DC, as USPS codes. */
export const US_STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC",
  "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
] as const;

/** Jurisdictions a user may name but Rangewise has no rule for, with why (design §0.4). */
export const RANGE_UNVERIFIED_JURISDICTIONS: Readonly<Record<string, string>> = {
  "US-IL": "Illinois: the statute site refused automated reads on 2026-09-23; citation not yet verified",
  "US-MA": "Massachusetts: the statute and agency sites refused automated reads on 2026-09-23; citation not yet verified",
  "US-VT": "Vermont: the statute site refused automated reads on 2026-09-23; citation not yet verified",
  "US-HI": "Hawaii: the statute site blocked automated reads on 2026-09-23; citation not yet verified",
};

/**
 * Is `code` a location a check may name? `US-XX` (a state or DC), `EU`, or
 * `EU-XX` (a member state, checked against the Directive's row).
 */
export function isLocationCode(code: string): boolean {
  const m = /^(US|EU)(?:-([A-Z]{2}))?$/.exec(code);
  if (!m) return false;
  if (m[1] === "US") return m[2] !== undefined && (US_STATE_CODES as readonly string[]).includes(m[2]);
  return m[2] === undefined || (EU_MEMBER_STATES as readonly string[]).includes(m[2]);
}

/** The rules-table row a location is checked against: `EU-DE` → `EU`, `US-CO` → `US-CO`. */
export function ruleCodeFor(location: string): string {
  return location.startsWith("EU") ? "EU" : location;
}

// ── wire types ───────────────────────────────────────────────────────────────

export interface PublicJurisdiction {
  code: string;
  name: string;
  kind: "us_state" | "us_district" | "eu";
  country: "US" | "EU";
}

export interface PublicPayRule {
  /** `<code>@<version>`, e.g. `US-CO@1`. */
  id: string;
  jurisdictionCode: string;
  jurisdictionName: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  minEmployees: number;
  employeeScope: string;
  payObligation: RangePayObligation;
  singleFigure: RangeSingleFigurePolicy;
  benefitsRequired: boolean;
  benefitsScope: string;
  maxSpreadPct: number | null;
  spreadStatus: "in_force" | "proposed" | null;
  remoteCoverage: RangeRemoteCoverage;
  remoteNote: string;
  summary: string;
  citation: string;
  sourceUrl: string;
  sourceKind: RangeSourceKind;
  verification: "verified";
  verifiedOn: string;
  notes: string;
}

export interface ListPayRulesResponse {
  rules: PublicPayRule[];
  jurisdictions: PublicJurisdiction[];
  /** Jurisdictions a check may name that have no rule yet, and why. */
  notCovered: { code: string; reason: string }[];
  /** Changes whenever a rule row changes (a fingerprint of rule ids + effective dates). */
  rulesVersion: string;
}

export type PayKind = "range" | "single" | "open_max" | "open_min" | "none";
export type PayPeriod = "hour" | "day" | "week" | "month" | "year";

/** ISO 4217 code ("USD", "EUR", "PLN", "CAD" …). RW1 read only USD, EUR and GBP. */
export type RangeCurrency = string;

/** The currencies of the EU's member states: the euro and the seven that have not adopted it. */
export const EU_CURRENCIES: readonly RangeCurrency[] = ["EUR", "BGN", "CZK", "DKK", "HUF", "PLN", "RON", "SEK"];

/** How many of a period make a year, for normalising pay to annual (design §2.1, plan RW2). */
export const PERIODS_PER_YEAR: Record<PayPeriod, number> = { hour: 2080, day: 260, week: 52, month: 12, year: 1 };

/** A quoted piece of the ad: the evidence a finding came from. `start`/`end` index the ad text. */
export interface EvidenceSpan {
  text: string;
  start: number;
  end: number;
}

export interface ExtractedPay {
  kind: PayKind;
  min: number | null;
  max: number | null;
  currency: RangeCurrency | null;
  period: PayPeriod | null;
  /** The ad text the pay statement was read from ("" when none). */
  text: string;
  start: number | null;
  end: number | null;
  // ── RW2 (extensions; RW1 fields unchanged) ──
  /** True when no period was written and it was inferred from the amount's size. */
  periodInferred?: boolean;
  /** The pay normalised to a year (2,080 h, 260 d, 52 wk, 12 mo; hourly uses the ad's weekly hours when stated). */
  annualMin?: number | null;
  annualMax?: number | null;
  /** Location codes this statement is written for ("Denver: …" → US-CO); empty when it applies to the whole ad. */
  locations?: string[];
  /** The place label the locations were read from ("Denver"), or null. */
  scope?: string | null;
}

export const NON_PAY_KINDS = [
  "sign_on_bonus",
  "bonus",
  "commission",
  "tips",
  "equity",
  "retirement",
  "relocation",
  "stipend",
  "referral",
  "funding",
  "revenue",
  "other",
] as const;
export type NonPayKind = (typeof NON_PAY_KINDS)[number];

export const NON_PAY_LABELS: Record<NonPayKind, string> = {
  sign_on_bonus: "Sign-on bonus",
  bonus: "Bonus",
  commission: "Commission or on-target earnings",
  tips: "Tips",
  equity: "Equity",
  retirement: "Retirement contribution",
  relocation: "Relocation",
  stipend: "Stipend, allowance or reimbursement",
  referral: "Referral bonus",
  funding: "Funding or valuation",
  revenue: "Revenue or business figure",
  other: "Other money that is not pay",
};

/** Money in the ad that is not the position's pay: never counted as pay, reported as evidence. */
export interface NonPayMoney extends EvidenceSpan {
  kind: NonPayKind;
}

/** Colorado's "how and when to apply" (INFO #9A §3): where the ad says how to apply and by when. */
export interface ApplyInfo {
  how: EvidenceSpan | null;
  when: EvidenceSpan | null;
  /** "Open until filled" — the guidance says it is not a deadline. */
  untilFilled: EvidenceSpan | null;
}

export const BENEFIT_CATEGORIES = ["health", "retirement", "paid_time_off", "insurance", "equity", "bonus"] as const;
export type BenefitCategory = (typeof BENEFIT_CATEGORIES)[number];

export const BENEFIT_CATEGORY_LABELS: Record<BenefitCategory, string> = {
  health: "Health care",
  retirement: "Retirement",
  paid_time_off: "Paid time off",
  insurance: "Life or disability insurance",
  equity: "Equity",
  bonus: "Bonus or commission",
};

export interface ExtractedAd {
  /** The ad's main pay statement: the first bounded range, else a single figure, else an open-ended amount. */
  pay: ExtractedPay;
  /** Vague pay words found ("competitive", "DOE"); they never count as pay. */
  vaguePay: string[];
  benefits: BenefitCategory[];
  /** Filler phrases found next to benefits ("and more", "etc."). */
  benefitFiller: string[];
  // ── RW2 (extensions) ──
  /** Every pay statement in the ad, in order, each with its span and the locations it is written for. */
  statements?: ExtractedPay[];
  /** Money that is not pay (bonuses, funding, 401(k) contributions …), with spans. */
  nonPay?: NonPayMoney[];
  apply?: ApplyInfo;
  /** "30 hours per week", when stated; used to annualise hourly pay. */
  weeklyHours?: number | null;
  benefitEvidence?: (EvidenceSpan & { category: BenefitCategory })[];
  vagueEvidence?: EvidenceSpan[];
  /** The extractor's version, stored with each check. */
  engineVersion?: string;
}

export interface RequirementResult {
  requirement: RangeRequirement;
  outcome: RangeOutcome;
  explanation: string;
  citation: string;
  /** RW2: the spans of the ad this finding was read from (empty when it rests on the stated facts). */
  evidence?: EvidenceSpan[];
}

export interface JurisdictionResult {
  location: string;
  jurisdictionCode: string;
  jurisdictionName: string;
  verdict: RangeVerdict;
  /** How the jurisdiction came into the check. */
  via: "location" | "remote";
  /** `US-CO@1`, or null for `not_covered`. */
  ruleId: string | null;
  citation: string | null;
  sourceUrl: string | null;
  deciding: RequirementResult | null;
  requirements: RequirementResult[];
  /** RW2: the pay statement applied to this jurisdiction (its own per-location range when the ad gives one). */
  pay?: ExtractedPay | null;
}

export interface PayCheckRequest {
  title?: string;
  adText: string;
  locations: string[];
  remote?: RangeRemoteArea;
  employeeCount: number;
  checkDate?: string;
}

export interface PublicPayCheck {
  /** `rwc_…`; stored from RW2, the audit subject from RW1. */
  id: string;
  title: string;
  overall: RangeVerdict;
  checkDate: string;
  employeeCount: number;
  remote: RangeRemoteArea;
  locations: string[];
  adSha256: string;
  extracted: ExtractedAd;
  results: JurisdictionResult[];
  rulesVersion: string;
  checkedAt: string;
  // ── RW2: stored checks ──
  /** The rule versions the verdicts used, e.g. ["US-CO@1", "US-NY@1"]. */
  ruleIds?: string[];
  /** The check this one re-runs, or null for an original check. */
  recheckedFrom?: string | null;
  /** The first check of this ad's lineage (itself for an original). */
  rootId?: string;
  engineVersion?: string;
}

export interface PayCheckResponse {
  check: PublicPayCheck;
}

/** One row of the check history. */
export interface PayCheckSummary {
  id: string;
  title: string;
  overall: RangeVerdict;
  checkDate: string;
  locations: string[];
  remote: RangeRemoteArea;
  employeeCount: number;
  adSha256: string;
  /** describePay() of the ad's main pay statement. */
  payText: string;
  ruleIds: string[];
  rulesVersion: string;
  recheckedFrom: string | null;
  rootId: string;
  checkedAt: string;
}

export interface ListPayChecksResponse {
  checks: PayCheckSummary[];
  /** Pass as `?cursor=` for the next page; null on the last page. */
  nextCursor: string | null;
}

export interface PayCheckDetailResponse {
  check: PublicPayCheck;
  /** The ad text as checked (the evidence spans index it). */
  adText: string;
  /** Every check in this ad's lineage (the original and its re-checks), oldest first. */
  lineage: PayCheckSummary[];
}

/** POST …/pay-checks/{id}/recheck: every field optional; omitted ones are the stored check's. `checkDate` defaults to today. */
export type RecheckRequest = Partial<PayCheckRequest>;

export interface VerdictChange {
  location: string;
  from: RangeVerdict | null;
  to: RangeVerdict | null;
}

export interface RecheckResponse {
  check: PublicPayCheck;
  previous: PayCheckSummary;
  /** Jurisdictions whose verdict differs from the previous check. */
  changes: VerdictChange[];
}

export const RANGE_EVENT_TYPES = ["range.check.run", "range.check.rechecked"] as const;
export type RangeEventType = (typeof RANGE_EVENT_TYPES)[number];

export const PAY_CHECK_AD_MAX = 20_000;
export const PAY_CHECK_LOCATIONS_MAX = 60;
export const PAY_CHECK_EMPLOYEES_MAX = 1_000_000;

/** How bad a verdict is, for "did it get worse": fail 2, review 1, everything else 0. */
export function verdictRank(v: RangeVerdict | null | undefined): number {
  return v === "fail" ? 2 : v === "review" ? 1 : 0;
}

/** The worst verdict among results (`not_covered` when there are none). */
export function overallVerdict(verdicts: readonly RangeVerdict[]): RangeVerdict {
  for (const v of RANGE_VERDICT_SEVERITY) if (verdicts.includes(v)) return v;
  return "not_covered";
}

const PERIOD_WORDS: Record<PayPeriod, string> = { hour: "per hour", day: "per day", week: "per week", month: "per month", year: "per year" };
const CURRENCY_SIGN: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** "$80,000–$100,000 per year", "up to €60,000", "no pay stated". */
export function describePay(pay: ExtractedPay): string {
  const money = (n: number | null): string => {
    if (n === null) return "?";
    const amount = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (!pay.currency) return amount;
    const sign = CURRENCY_SIGN[pay.currency];
    return sign ? `${sign}${amount}` : `${pay.currency} ${amount}`;
  };
  const per = pay.period ? ` ${PERIOD_WORDS[pay.period]}` : "";
  switch (pay.kind) {
    case "range":
      return `${money(pay.min)}–${money(pay.max)}${per}`;
    case "single":
      return `${money(pay.min)}${per}`;
    case "open_max":
      return `up to ${money(pay.max)}${per} (no bottom)`;
    case "open_min":
      return `from ${money(pay.min)}${per} (no top)`;
    default:
      return "no pay stated";
  }
}
