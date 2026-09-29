import {
  PERIODS_PER_YEAR,
  type ApplyInfo,
  type BenefitCategory,
  type EvidenceSpan,
  type ExtractedAd,
  type ExtractedPay,
  type NonPayKind,
  type NonPayMoney,
  type PayKind,
  type PayPeriod,
} from "@saas/contracts/range";
import { placesIn } from "./places.js";

/**
 * RW2's pay parser (design §2.1, plan RW2), behind RW1's `extractAd()`.
 * Deterministic and pure: no I/O, no model. It reads EVERY money amount in
 * the ad, joins amounts into ranges, decides from the words around each one
 * whether it is the position's pay or other money (a sign-on bonus, tips,
 * funding, a 401(k) contribution …), scopes a statement to the places its
 * label names ("Denver: $105k–$130k"), and normalises pay to a year.
 *
 * Every statement keeps its span in the ad text, so a stored check can quote
 * the exact words each finding came from.
 */

export const ENGINE_VERSION = "rw2.1";

// ── money tokens ─────────────────────────────────────────────────────────────

const CURRENCY_OF: Record<string, string> = {
  $: "USD",
  US$: "USD",
  USD: "USD",
  "€": "EUR",
  EUR: "EUR",
  "£": "GBP",
  GBP: "GBP",
  CA$: "CAD",
  C$: "CAD",
  CAD: "CAD",
  A$: "AUD",
  AU$: "AUD",
  AUD: "AUD",
  CHF: "CHF",
  SEK: "SEK",
  NOK: "NOK",
  DKK: "DKK",
  PLN: "PLN",
  ZŁ: "PLN",
  CZK: "CZK",
  KČ: "CZK",
  HUF: "HUF",
  RON: "RON",
  BGN: "BGN",
  INR: "INR",
  "₹": "INR",
  JPY: "JPY",
  "¥": "JPY",
  MXN: "MXN",
  SGD: "SGD",
  NZD: "NZD",
  HKD: "HKD",
};

const CODES = "USD|EUR|GBP|CAD|AUD|CHF|SEK|NOK|DKK|PLN|CZK|HUF|RON|BGN|INR|JPY|MXN|SGD|NZD|HKD";
// A number: 80,000 / 80.000 / 80 000 / 100'000 / 80000 / 27.50 / 27,50 / 80
const NUM = String.raw`\d{1,3}(?:[,.  ' ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const K = String.raw`\s?[kK](?![A-Za-z])`;
const PRE = String.raw`US\$|CA\$|AU\$|A\$|C\$|(?<![A-Za-z])(?:${CODES})|\$|€|£|₹|¥`;
const POST = String.raw`(?:${CODES}|zł|Kč)(?![A-Za-z])|€|£|₹`;

const MONEY_RE = new RegExp(String.raw`(?:(${PRE})\s?(${NUM})(${K})?)|(?:(${NUM})(${K})?\s?(${POST}))`, "gi");
/** A bare number right after a pay word ("Salary: 80,000 – 95,000"): pay with no currency written. */
const BARE_RE = new RegExp(
  String.raw`\b(?:salary|pay|compensation|wage|base|rate|gehalt|salaire|salario|stipendio|wynagrodzenie)\b(?:\s+(?:range|band|scale|is|of|from|between|will\s+be))*\s*[:=]?\s*(${NUM})(${K})?(?=\s*(?:-|–|—|to|per|\/|an?\s|annually|hourly|$|[\s.,;]))`,
  "gi",
);

const PERIOD_INLINE = String.raw`(?:\s*(?:\/\s?(?:hr|hour|h|yr|year|annum|mo|month|wk|week)\b|per\s+(?:hour|hr|year|annum|month|week)\b|an?\s+(?:hour|year)\b|hourly\b|annually\b))`;
const SEP = String.raw`(?:-|–|—|to|bis|à)`;
const SEP_AFTER_RE = new RegExp(
  String.raw`^(?:\s?(?:${CODES})(?![A-Za-z]))?${PERIOD_INLINE}?\s*${SEP}\s*(?:(${PRE})\s?)?(${NUM})(${K})?(?:\s?(${POST}))?`,
  "i",
);
const BETWEEN_AND_RE = new RegExp(String.raw`^\s*and\s*(?:(${PRE})\s?)?(${NUM})(${K})?(?:\s?(${POST}))?`, "i");
const SEP_BEFORE_RE = new RegExp(String.raw`(${NUM})(${K})?\s*${SEP}\s*$`, "i");
const MAGNITUDE_RE = /^\s?(?:m|mm|b|bn|mn|million|billion|mio\.?|mrd\.?)(?![A-Za-z])/i;

const OPEN_MAX_BEFORE_RE = /\b(?:up\s?to|maximum(?:\s+of)?|max\.?|not\s+to\s+exceed|no\s+more\s+than|as\s+much\s+as|bis\s+zu|jusqu'à)\s*$/i;
const OPEN_MIN_BEFORE_RE = /\b(?:from|starting\s+(?:at|from)|starts\s+at|minimum(?:\s+of)?|min\.?|at\s+least|no\s+less\s+than|ab)\s*$/i;
const OPEN_MIN_AFTER_RE = /^\s*(?:\+|and\s+up\b|or\s+more\b|and\s+above\b|or\s+higher\b|plus\b(?!\s+(?:a|an|the|benefits|bonus|commission|equity|tips|\$|€|£)))/i;

const PERIOD_AFTER: [RegExp, PayPeriod][] = [
  [/^\s*(?:\/\s?|per\s+|an?\s+|each\s+|p\/)(?:hour|hr|h)\b|^\s*(?:hourly|stündlich)\b|^\s*ph\b/i, "hour"],
  [
    /^\s*(?:\/\s?|per\s+|an?\s+|pro\s+)(?:year|yr|annum|jahr|an|jaar)\b|^\s*(?:annually|yearly|annual|p\.\s?a\.|pa\b|jährlich|brutto\s*(?:\/\s*)?(?:jahr|jährlich)|brut\s+annuel|par\s+an|per\s+jaar|al\s+año|brutos?\s+anuales?|annuel)/i,
    "year",
  ],
  [/^\s*(?:\/\s?|per\s+|an?\s+|pro\s+)(?:month|mo|monat|maand|mois)\b|^\s*(?:monthly|monatlich|brutto\s*(?:\/\s*)?monat|par\s+mois|mensuel|mensual|per\s+maand|(?:brutto\s+)?miesięcznie)/i, "month"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)(?:week|wk)\b|^\s*weekly\b/i, "week"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)day\b|^\s*daily\b/i, "day"],
];
const PERIOD_BEFORE: [RegExp, PayPeriod][] = [
  [/\bhourly\b[^.\n;]{0,30}$/i, "hour"],
  [/\b(?:annual|yearly|annually|per\s+annum|jahresgehalt)\b[^.\n;]{0,30}$/i, "year"],
  [/\b(?:monthly|monatsgehalt)\b[^.\n;]{0,30}$/i, "month"],
  [/\bweekly\b[^.\n;]{0,30}$/i, "week"],
  [/\bdaily\b[^.\n;]{0,30}$/i, "day"],
];

/** "80,000" → 80000, "80.000" → 80000, "27.50" → 27.5, "27,50" → 27.5, "80 000" → 80000, "100'000" → 100000. */
export function parseAmount(raw: string): number {
  const s = raw.replace(/[   ']/g, "");
  const grouped = /^(\d{1,3})((?:[,.]\d{3})+)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (grouped) {
    const groups = grouped[2]!;
    const sep = groups[0]!;
    const sameSep = groups.split("").filter((c) => c === "," || c === ".").every((c) => c === sep);
    if (sameSep && (grouped[3] === undefined || grouped[3] !== sep)) {
      const int = grouped[1]! + groups.replace(/[,.]/g, "");
      return Number(grouped[4] !== undefined ? `${int}.${grouped[4]}` : int);
    }
  }
  const decimal = /^(\d+)[.,](\d{1,2})$/.exec(s);
  if (decimal) return Number(`${decimal[1]}.${decimal[2]}`);
  return Number(s.replace(/[,.]/g, ""));
}

interface Token {
  value: number;
  hasK: boolean;
  currency: string | null;
  start: number;
  end: number;
  magnitude: boolean;
}

function currencyOf(sym: string): string | null {
  return CURRENCY_OF[sym] ?? CURRENCY_OF[sym.toUpperCase()] ?? null;
}

function moneyTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const pre = m[1];
    const raw = pre !== undefined ? m[2]! : m[4]!;
    const k = pre !== undefined ? m[3] : m[5];
    const currency = currencyOf(pre !== undefined ? pre : m[6]!);
    if (!currency) continue;
    out.push({ value: parseAmount(raw) * (k ? 1000 : 1), hasK: !!k, currency, start, end, magnitude: MAGNITUDE_RE.test(text.slice(end)) });
  }
  for (const m of text.matchAll(BARE_RE)) {
    const numStart = (m.index ?? 0) + m[0].length - m[1]!.length - (m[2]?.length ?? 0);
    const end = numStart + m[1]!.length + (m[2]?.length ?? 0);
    if (out.some((t) => t.start <= numStart && numStart < t.end)) continue;
    const value = parseAmount(m[1]!) * (m[2] ? 1000 : 1);
    // A bare "pay 5" or "rate 3" is not pay; a bare figure needs a plausible size or a k.
    if (!m[2] && value < 7) continue;
    out.push({ value, hasK: !!m[2], currency: null, start: numStart, end, magnitude: MAGNITUDE_RE.test(text.slice(end)) });
  }
  return out.sort((a, b) => a.start - b.start);
}

function periodAround(text: string, start: number, end: number, labelStart: number): PayPeriod | null {
  const after = text.slice(end, end + 30);
  for (const [re, p] of PERIOD_AFTER) if (re.test(after)) return p;
  const before = text.slice(Math.max(labelStart, start - 45), start);
  for (const [re, p] of PERIOD_BEFORE) if (re.test(before)) return p;
  return null;
}

// ── statements ───────────────────────────────────────────────────────────────

interface RawStatement {
  kind: Exclude<PayKind, "none">;
  min: number | null;
  max: number | null;
  currency: string | null;
  /** The amounts' own span. */
  start: number;
  end: number;
  /** The span quoted as evidence (with "up to", "+" …). */
  quoteStart: number;
  quoteEnd: number;
  magnitude: boolean;
}

const OPEN_MARKER_RE =
  /(?:up\s?to|maximum(?:\s+of)?|max\.?|not\s+to\s+exceed|no\s+more\s+than|as\s+much\s+as|bis\s+zu|from|starting\s+(?:at|from)|starts\s+at|minimum(?:\s+of)?|min\.?|at\s+least|no\s+less\s+than)\s*$/i;

function rawStatements(text: string): RawStatement[] {
  const tokens = moneyTokens(text);
  const out: RawStatement[] = [];
  const used = new Set<number>();
  const push = (s: Omit<RawStatement, "quoteStart" | "quoteEnd"> & Partial<Pick<RawStatement, "quoteStart" | "quoteEnd">>): void => {
    out.push({ quoteStart: s.start, quoteEnd: s.end, ...s });
  };
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const t = tokens[i]!;
    const consume = (end: number): void => {
      tokens.forEach((x, j) => {
        if (j > i && x.start < end) used.add(j);
      });
    };
    if (t.magnitude) {
      push({ kind: "single", min: t.value, max: t.value, currency: t.currency, start: t.start, end: t.end, magnitude: true });
      continue;
    }

    // Forwards: "$80,000 - $100,000", "$80-100k", "€45.000 to 55.000", "$25/hr - $30/hr", and "between $X and $Y".
    const betweenBefore = /\bbetween\s*$/i.test(text.slice(Math.max(0, t.start - 12), t.start));
    const fwd = SEP_AFTER_RE.exec(text.slice(t.end)) ?? (betweenBefore ? BETWEEN_AND_RE.exec(text.slice(t.end)) : null);
    if (fwd) {
      const secondK = !!fwd[3];
      let hi = parseAmount(fwd[2]!) * (secondK ? 1000 : 1);
      let lo = t.value;
      if (secondK && !t.hasK && lo < 1000) lo *= 1000; // "$80-100k"
      if (!secondK && t.hasK && hi < 1000) hi *= 1000; // "$80k-100"
      if (!t.hasK && !secondK && lo < 1000 && hi >= 10_000 && lo * 1000 <= hi) lo *= 1000; // "$50-70,000"
      const end = t.end + fwd[0].length;
      const currency = t.currency ?? (fwd[1] ? currencyOf(fwd[1]) : fwd[4] ? currencyOf(fwd[4]) : null);
      const magnitude = MAGNITUDE_RE.test(text.slice(end));
      // min > max ("$50,000 and 20 days PTO") is not a range: read the first amount on its own.
      if (lo <= hi) {
        consume(end);
        push({ kind: lo < hi ? "range" : "single", min: lo, max: hi, currency, start: t.start, end, magnitude });
        continue;
      }
    }

    // Backwards onto a suffix currency: "45.000 – 55.000 €", "45-55 k€"
    const back = SEP_BEFORE_RE.exec(text.slice(Math.max(0, t.start - 30), t.start));
    if (back) {
      let lo = parseAmount(back[1]!) * (back[2] ? 1000 : 1);
      if (t.hasK && !back[2] && lo < 1000) lo *= 1000;
      const start = t.start - back[0].length;
      if (lo < t.value && !out.some((s) => s.end > start)) {
        push({ kind: "range", min: lo, max: t.value, currency: t.currency, start, end: t.end, magnitude: false });
        continue;
      }
    }

    const before = text.slice(Math.max(0, t.start - 25), t.start);
    const after = text.slice(t.end, t.end + 20);
    if (OPEN_MAX_BEFORE_RE.test(before)) {
      const marker = OPEN_MARKER_RE.exec(before);
      push({ kind: "open_max", min: null, max: t.value, currency: t.currency, start: t.start, end: t.end, quoteStart: t.start - (marker?.[0].length ?? 0), magnitude: false });
    } else if (OPEN_MIN_BEFORE_RE.test(before) || OPEN_MIN_AFTER_RE.test(after)) {
      const plus = OPEN_MIN_AFTER_RE.exec(after);
      const marker = OPEN_MIN_BEFORE_RE.test(before) ? OPEN_MARKER_RE.exec(before) : null;
      const end = t.end + (plus ? plus[0].length : 0);
      push({ kind: "open_min", min: t.value, max: null, currency: t.currency, start: t.start, end, quoteStart: t.start - (marker?.[0].length ?? 0), quoteEnd: end, magnitude: false });
    } else {
      push({ kind: "single", min: t.value, max: t.value, currency: t.currency, start: t.start, end: t.end, magnitude: false });
    }
  }
  return out;
}

// ── pay or not pay ───────────────────────────────────────────────────────────

const NON_PAY_WORDS: [NonPayKind, string][] = [
  ["sign_on_bonus", String.raw`(?:sign[- ]?on|signing|joining|hiring|welcome)\s+bonus(?:es)?`],
  ["referral", String.raw`referral(?:\s+bonus)?`],
  ["relocation", String.raw`relocation(?:\s+(?:assistance|package|bonus|stipend|support))?`],
  ["retirement", String.raw`401\s?\(?k\)?(?:\s+(?:match|matching|contribution))?|403\s?\(?b\)?|retirement(?:\s+contribution)?|pension(?:\s+contribution)?|employer\s+match`],
  ["commission", String.raw`commissions?|OTE|on[- ]target\s+earnings|uncapped`],
  ["tips", String.raw`tips|gratuit(?:y|ies)|tip\s+pool`],
  ["equity", String.raw`equity|stock(?:\s+options?)?|RSUs?|options\s+grant|share\s+options`],
  ["stipend", String.raw`stipends?|allowances?|reimburse(?:ment|d)?|per\s+diem|budget|credits?|learning\s+fund|tuition(?:\s+assistance)?`],
  ["bonus", String.raw`(?:performance\s+|annual\s+|target\s+|year[- ]end\s+|retention\s+|holiday\s+|quarterly\s+)?bonus(?:es)?`],
  ["funding", String.raw`raised|funding|funded|valuation|valued\s+at|series\s+[a-f]\b|seed\s+round|investment`],
  ["revenue", String.raw`revenue|ARR|turnover|in\s+sales|GMV|customers|users|under\s+management|AUM`],
];
const NON_PAY_BEFORE = NON_PAY_WORDS.map(([k, w]) => [k, new RegExp(String.raw`\b(?:${w})\b`, "gi")] as const);
/** The non-pay noun must follow the amount almost at once ("$10,000 signing bonus", "$5 hourly tips", "$20,000 in equity"). */
const NON_PAY_AFTER = NON_PAY_WORDS.map(
  ([k, w]) =>
    [
      k,
      new RegExp(
        String.raw`^(?:\s?(?:${CODES})(?![A-Za-z]))?\s*(?:\/\s?(?:yr|year|mo|month|hr|hour)\s*|per\s+(?:year|month|hour)\s+|(?:hourly|annually|yearly|monthly)\s+)?(?:(?:one[- ]time|annual|yearly|quarterly|monthly|performance|target|additional|potential|cash|retention|year[- ]end|holiday|in|of|a|an|the|employer)\s+){0,3}(?:${w})(?![A-Za-z])`,
        "i",
      ),
    ] as const,
);
const PAY_WORD_RE =
  /\b(?:salary|salaries|pay|paid|compensation|wages?|earn(?:ing|ings)?|base|rate|range|band|scale|gehalt|salaire|salario|stipendio|wynagrodzenie|remuneration|rémunération)\b/gi;

/** Where the words that label a statement start: the previous statement's end, or the last sentence/line/list boundary. */
function labelStart(text: string, start: number, prevEnd: number): number {
  const from = Math.max(prevEnd, start - 80, 0);
  const seg = text.slice(from, start);
  let cut = -1;
  for (const m of seg.matchAll(/[.!?](?=\s)|[;\n•|·]/g)) cut = Math.max(cut, (m.index ?? 0) + m[0].length);
  return from + (cut >= 0 ? cut : 0);
}

function lastMatch(re: RegExp, s: string): { index: number; end: number } | null {
  let last: { index: number; end: number } | null = null;
  re.lastIndex = 0;
  for (const m of s.matchAll(re)) last = { index: m.index ?? 0, end: (m.index ?? 0) + m[0].length };
  return last;
}

/** null when the statement is pay; otherwise which kind of other money it is. */
function nonPayKind(text: string, s: RawStatement, from: number): NonPayKind | null {
  const after = text.slice(s.quoteEnd, s.quoteEnd + 60);
  for (const [kind, re] of NON_PAY_AFTER) if (re.test(after)) return kind;
  const label = text.slice(from, s.quoteStart);
  let best: { kind: NonPayKind; index: number; end: number } | null = null;
  for (const [kind, re] of NON_PAY_BEFORE) {
    const m = lastMatch(re, label);
    if (m && (!best || m.index > best.index)) best = { kind, ...m };
  }
  if (s.magnitude) return best?.kind === "funding" || best?.kind === "revenue" ? best.kind : (nonPayAfterLoose(after) ?? "other");
  if (!best) return null;
  const pay = lastMatch(PAY_WORD_RE, label);
  // "Salary plus a signing bonus of $10,000" → the bonus is closest; "bonus … salary of $80,000" → the salary is.
  // "Bonus pay of $500": a pay word straight after the other-money word still labels other money.
  if (pay && pay.index > best.index && pay.index - best.end > 1) return null;
  return best.kind;
}

function nonPayAfterLoose(after: string): NonPayKind | null {
  if (/\b(?:raised|funding|valuation|series\s+[a-f])\b/i.test(after)) return "funding";
  if (/\b(?:revenue|ARR|sales|turnover|customers)\b/i.test(after)) return "revenue";
  return null;
}

// ── places ───────────────────────────────────────────────────────────────────

const PAY_CONTEXT_RE = /\b(?:range|salary|pay|rate|compensation|base|band|wage)\b/i;

/** The places a statement is written for: "Denver: $…", "In Colorado, the range is $…", "$… for New York-based roles". */
function scopeOf(text: string, s: RawStatement, from: number, nextStart: number): { locations: string[]; scope: string | null } {
  const label = text.slice(from, s.quoteStart);
  const places = placesIn(label);
  if (places.length) {
    const last = places[places.length - 1]!;
    const between = label.slice(last.end);
    const labelled = /^[^.!?]*?[:=–—-]\s*[^.!?:]*$/.test(between) || /^\s*\)?\s*[:=–—-]/.test(between) || /^\s*(?:\([^)]*\))\s*[:=–—-]?/.test(between);
    const phrased = PAY_CONTEXT_RE.test(label) && places.some((p) => /\b(?:in|for|within)\s+(?:the\s+)?$/i.test(label.slice(Math.max(0, p.start - 12), p.start)));
    if (labelled || phrased) return { locations: uniq(places.flatMap((p) => p.codes)), scope: places.map((p) => p.text).join(", ") };
  }
  // Trailing: "$80k–$100k in Denver", "$90,000–$110,000 (New York City)", "… for candidates based in Colorado"
  const tail = text.slice(s.quoteEnd, Math.min(nextStart, s.quoteEnd + 70));
  const tailClause = tail.split(/[.;\n•|]/)[0] ?? "";
  const m = /^(?:\s*(?:USD|EUR))?(?:\s*(?:\/\s?\w+|per\s+\w+|an?\s+(?:hour|year)|annually|hourly|yearly))?\s*(?:\(\s*|,?\s*(?:in|for)\s+(?:(?:candidates|employees|roles|positions|hires|those|people)\s+(?:based\s+)?(?:in|located\s+in)\s+|the\s+)?)/i.exec(tailClause);
  if (m) {
    const rest = tailClause.slice(m[0].length);
    const first = placesIn(rest)[0];
    if (first && first.start <= 2) {
      // "in New York or New Jersey": the run of places joined by "and", "or", "/", ","
      const run = [first];
      for (const p of placesIn(rest).slice(1)) {
        if (!/^\s*(?:,|\/|&|and|or)\s*$/i.test(rest.slice(run[run.length - 1]!.end, p.start))) break;
        run.push(p);
      }
      return { locations: uniq(run.flatMap((p) => p.codes)), scope: run.map((p) => p.text).join(", ") };
    }
  }
  return { locations: [], scope: null };
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

// ── the whole ad ─────────────────────────────────────────────────────────────

const WEEKLY_HOURS_RE = /\b(\d{1,2}(?:[.,]\d)?)\s*(?:(?:-|–|to)\s*(\d{1,2}(?:[.,]\d)?)\s*)?(?:hours?|hrs?)\s*(?:per|a|\/|each|every)\s*(?:week|wk)\b/i;

function weeklyHours(text: string): { low: number; high: number } | null {
  const m = WEEKLY_HOURS_RE.exec(text);
  if (!m) return null;
  const low = Number(m[1]!.replace(",", "."));
  const high = m[2] ? Number(m[2].replace(",", ".")) : low;
  if (!(low > 0 && low <= 80 && high >= low && high <= 80)) return null;
  return { low, high };
}

function annualise(value: number | null, period: PayPeriod | null, hours: { low: number; high: number } | null, which: "low" | "high"): number | null {
  if (value === null || period === null) return null;
  if (period === "hour" && hours) return Math.round(value * hours[which] * 52 * 100) / 100;
  return Math.round(value * PERIODS_PER_YEAR[period] * 100) / 100;
}

/** No period written: ≥ 10,000 reads as a year; under 200 as an hour (the size of an hourly wage). Otherwise unknown. */
function inferPeriod(s: RawStatement): PayPeriod | null {
  const v = s.max ?? s.min ?? 0;
  if (v >= 10_000) return "year";
  if (v > 0 && v < 200) return "hour";
  return null;
}

export interface ParsedMoney {
  pay: ExtractedPay[];
  nonPay: NonPayMoney[];
}

/** Every money statement in the ad, split into pay (with scope and annual figures) and other money. */
export function parseMoney(text: string): ParsedMoney {
  const raws = rawStatements(text);
  const hours = weeklyHours(text);
  const pay: ExtractedPay[] = [];
  const nonPay: NonPayMoney[] = [];
  let prevEnd = 0;
  raws.forEach((s, i) => {
    const from = labelStart(text, s.quoteStart, prevEnd);
    const kind = nonPayKind(text, s, from);
    const quote = text.slice(s.quoteStart, s.quoteEnd).trim();
    if (kind) {
      nonPay.push({ kind, text: quote, start: s.quoteStart, end: s.quoteEnd });
    } else {
      const written = periodAround(text, s.start, s.end, from);
      const period = written ?? inferPeriod(s);
      const next = raws[i + 1]?.quoteStart ?? text.length;
      const { locations, scope } = scopeOf(text, s, from, next);
      pay.push({
        kind: s.kind,
        min: s.min,
        max: s.max,
        currency: s.currency,
        period,
        text: quote,
        start: s.quoteStart,
        end: s.quoteEnd,
        periodInferred: written === null && period !== null,
        annualMin: annualise(s.min, period, hours, "low"),
        annualMax: annualise(s.max, period, hours, "high"),
        locations,
        scope,
      });
    }
    prevEnd = s.quoteEnd;
  });
  return { pay, nonPay };
}

export const NO_PAY: ExtractedPay = {
  kind: "none",
  min: null,
  max: null,
  currency: null,
  period: null,
  text: "",
  start: null,
  end: null,
  periodInferred: false,
  annualMin: null,
  annualMax: null,
  locations: [],
  scope: null,
};

/** RW1's precedence, kept: the first bounded range, else the first single figure, else the first open-ended amount. */
export function bestStatement(statements: readonly ExtractedPay[]): ExtractedPay | null {
  return (
    statements.find((s) => s.kind === "range") ??
    statements.find((s) => s.kind === "single") ??
    statements.find((s) => s.kind === "open_max" || s.kind === "open_min") ??
    null
  );
}

/** The ad's main pay statement (RW1's `extractPay`, now over the full parser). */
export function extractPay(text: string): ExtractedPay {
  return bestStatement(parseMoney(text).pay) ?? NO_PAY;
}

// ── words: vague pay, benefits, filler, how and when to apply ────────────────

const VAGUE_RE =
  /\b(competitive\s+(?:salary|pay|compensation|wages?|rates?)|competitive(?!\s+(?:benefits|environment|market|landscape|edge|advantage|analysis|intelligence))|DOE|depending\s+on\s+experience|dependent\s+on\s+experience|commensurate\s+with\s+experience|commensurate|negotiable|market\s+rate|attractive\s+(?:salary|package)|salary\s+TBD|to\s+be\s+discussed)\b/gi;

function vagueMatches(text: string): EvidenceSpan[] {
  const out: EvidenceSpan[] = [];
  for (const m of text.matchAll(VAGUE_RE)) out.push({ text: m[1]!, start: m.index ?? 0, end: (m.index ?? 0) + m[1]!.length });
  return out;
}

/** Vague pay words, lower-cased and de-duplicated, in order of appearance. */
export function vaguePayWords(text: string): string[] {
  const seen: string[] = [];
  for (const m of vagueMatches(text)) {
    const w = m.text.replace(/\s+/g, " ");
    const key = w === "DOE" ? "DOE" : w.toLowerCase();
    // "competitive" inside "competitive salary" is already reported.
    if (!seen.includes(key) && !seen.some((s) => s.includes(key))) seen.push(key);
  }
  return seen;
}

const BENEFIT_RES: [BenefitCategory, RegExp][] = [
  ["health", /\b(?:health\s*(?:care|insurance|benefits?|plan|coverage)|healthcare|medical|dental|vision|health\s+ins\.?)(?![A-Za-z])/i],
  ["retirement", /401\s?\(?k\)?|403\s?\(?b\)?|\bretirement\b|\bpension\b/i],
  ["paid_time_off", /\b(?:paid\s+time\s+off|PTO|vacation|paid\s+holidays?|holidays|sick\s+(?:leave|days|time)|parental\s+leave|paid\s+leave|annual\s+leave)\b/i],
  ["insurance", /\b(?:life\s+insurance|disability(?:\s+insurance)?)\b/i],
  ["equity", /\b(?:equity|stock\s+options?|RSUs?|ESPP)\b/i],
  ["bonus", /\b(?:bonus(?:es)?|commissions?|profit[-\s]sharing)\b/i],
];

/** The benefit categories an ad mentions. */
export function benefitCategories(text: string): BenefitCategory[] {
  return BENEFIT_RES.filter(([, re]) => re.test(text)).map(([c]) => c);
}

function benefitEvidence(text: string): (EvidenceSpan & { category: BenefitCategory })[] {
  const out: (EvidenceSpan & { category: BenefitCategory })[] = [];
  for (const [category, re] of BENEFIT_RES) {
    const m = re.exec(text);
    if (m) out.push({ category, text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** The categories that count as "benefits" (equity and bonus are other compensation). */
export const CORE_BENEFITS: readonly BenefitCategory[] = ["health", "retirement", "paid_time_off", "insurance"];

const FILLER_RE = /\b(and\s+more|etc\.?|great\s+benefits|competitive\s+benefits|excellent\s+benefits)(?![A-Za-z])/gi;

export function benefitFiller(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(FILLER_RE)) {
    const w = m[1]!.toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

const HOW_RE =
  /\b(?:how\s+to\s+apply|to\s+apply|apply\s+(?:online|now|here|today|at|via|through|on|with|using|by\s+(?:email|emailing|sending|visiting|submitting|clicking))|submit\s+(?:your\s+|an?\s+)?(?:application|resume|résumé|CV|cover\s+letter)|send\s+(?:your\s+|an?\s+)?(?:resume|résumé|CV|application)|email\s+(?:your\s+)?(?:resume|résumé|CV|application)|applications?\s+(?:can|may|should|must)\s+be\s+(?:submitted|sent|made))\b/i;
/** "Apply by October 31 at careers.example.com": an apply word, then a site or an address in the same sentence. */
const HOW_WHERE_RE = /\bapply\b(?:(?!\.\s)[^;\n]){0,50}?(?:https?:\/\/\S+|www\.\S+|[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|co|jobs|careers|example|gov|edu)\b\S*|[\w.+-]+@[\w-]+\.[\w.-]+)/i;
const UNTIL_FILLED_RE = /\b(?:open\s+)?until\s+(?:the\s+(?:position|role|job)\s+is\s+)?filled\b/i;
const MONTH = String.raw`(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?`;
const DATE = String.raw`(?:${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?${MONTH}(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2})`;
/** "submit your resume at careers.example.com by November 15" — an apply word, then a dated deadline in the same sentence. */
const DATED_WHEN_RE = new RegExp(
  String.raw`\b(?:apply|applying|applications?|submit|resumes?|résumés?|CVs?|email)\b(?:(?!\.\s)[^;\n]){0,80}?\b(?:by|before|no\s+later\s+than|until|through)\s+${DATE}`,
  "i",
);
const WHEN_RE =
  /\b(?:(?:apply|applications?(?:\s+(?:are|will\s+be))?\s+(?:due|accepted|received|open|considered))\s+(?:by|before|until|through|no\s+later\s+than)\s+(?!(?:the\s+(?:position|role|job)\s+is\s+)?filled)[^.;\n]{3,40}|application\s+(?:deadline|window)[^.;\n]{0,40}|applications?\s+(?:close|closes|will\s+close)\s+(?!when)[^.;\n]{3,40}|deadline(?:\s+to\s+apply)?\s*(?:is|:)?\s+[^.;\n]{3,40}|(?:closing\s+date|closes\s+on|close\s+on|will\s+close\s+on|posting\s+closes|(?:this\s+)?(?:posting|position|job|ad|vacancy)\s+(?:will\s+)?(?:close|closes|expires|is\s+open\s+(?:until|through|for)))(?!\s+(?:the\s+(?:position|role|job)\s+is\s+)?filled)[^.;\n]{0,40}|(?:accepted|accepting\s+applications)\s+on\s+an\s+ongoing\s+basis|on\s+an\s+ongoing\s+basis)/i;

function span(m: RegExpExecArray | null): EvidenceSpan | null {
  return m ? { text: m[0].trim(), start: m.index, end: m.index + m[0].length } : null;
}

/** Colorado's "how and when to apply" (INFO #9A §3): the instructions and a deadline, or "ongoing basis" for evergreen roles. */
export function applyInfo(text: string): ApplyInfo {
  return { how: span(HOW_RE.exec(text) ?? HOW_WHERE_RE.exec(text)), when: span(WHEN_RE.exec(text) ?? DATED_WHEN_RE.exec(text)), untilFilled: span(UNTIL_FILLED_RE.exec(text)) };
}

export function extractAd(text: string): ExtractedAd {
  const money = parseMoney(text);
  const hours = weeklyHours(text);
  return {
    pay: bestStatement(money.pay) ?? NO_PAY,
    vaguePay: vaguePayWords(text),
    benefits: benefitCategories(text),
    benefitFiller: benefitFiller(text),
    statements: money.pay,
    nonPay: money.nonPay,
    apply: applyInfo(text),
    weeklyHours: hours ? hours.low : null,
    benefitEvidence: benefitEvidence(text),
    vagueEvidence: vagueMatches(text),
    engineVersion: ENGINE_VERSION,
  };
}
