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

export interface ExtractedPay {
  kind: PayKind;
  min: number | null;
  max: number | null;
  currency: "USD" | "EUR" | "GBP" | null;
  period: PayPeriod | null;
  /** The ad text the pay statement was read from ("" when none). */
  text: string;
  start: number | null;
  end: number | null;
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
  pay: ExtractedPay;
  /** Vague pay words found ("competitive", "DOE"); they never count as pay. */
  vaguePay: string[];
  benefits: BenefitCategory[];
  /** Filler phrases found next to benefits ("and more", "etc."). */
  benefitFiller: string[];
}

export interface RequirementResult {
  requirement: RangeRequirement;
  outcome: RangeOutcome;
  explanation: string;
  citation: string;
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
}

export interface PayCheckResponse {
  check: PublicPayCheck;
}

export const RANGE_EVENT_TYPES = ["range.check.run"] as const;
export type RangeEventType = (typeof RANGE_EVENT_TYPES)[number];

export const PAY_CHECK_AD_MAX = 20_000;
export const PAY_CHECK_LOCATIONS_MAX = 60;
export const PAY_CHECK_EMPLOYEES_MAX = 1_000_000;

/** The worst verdict among results (`not_covered` when there are none). */
export function overallVerdict(verdicts: readonly RangeVerdict[]): RangeVerdict {
  for (const v of RANGE_VERDICT_SEVERITY) if (verdicts.includes(v)) return v;
  return "not_covered";
}

const PERIOD_WORDS: Record<PayPeriod, string> = { hour: "per hour", day: "per day", week: "per week", month: "per month", year: "per year" };
const CURRENCY_SIGN: Record<"USD" | "EUR" | "GBP", string> = { USD: "$", EUR: "€", GBP: "£" };

/** "$80,000–$100,000 per year", "up to €60,000", "no pay stated". */
export function describePay(pay: ExtractedPay): string {
  const money = (n: number | null): string => {
    if (n === null) return "?";
    const sign = pay.currency ? CURRENCY_SIGN[pay.currency] : "";
    return `${sign}${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
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
