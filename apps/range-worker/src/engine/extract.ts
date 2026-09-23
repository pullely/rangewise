import type { BenefitCategory, ExtractedAd, ExtractedPay, PayPeriod } from "@saas/contracts/range";

/**
 * RW1's first-cut pay extractor (design §2.1): finds ONE pay statement in an
 * ad, with its currency and period, and whether it is a bounded range, a
 * single figure, or open-ended. Deterministic, no I/O. RW2 replaces it with
 * the full parser behind the same signature.
 */

type Currency = "USD" | "EUR" | "GBP";

const CURRENCY_OF: Record<string, Currency> = {
  $: "USD",
  US$: "USD",
  USD: "USD",
  "€": "EUR",
  EUR: "EUR",
  "£": "GBP",
  GBP: "GBP",
};

// A number: 80,000 / 80.000 / 80 000 / 80000 / 27.50 / 27,50 / 80
const NUM = String.raw`\d{1,3}(?:[,.\u00a0\u202f ]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const K = String.raw`\s?[kK](?![A-Za-z])`;
const PRE = String.raw`US\$|USD|EUR|GBP|\$|€|£`;
const POST = String.raw`USD|EUR|GBP|€|£`;

// Money anchored on a currency, prefix or suffix.
const MONEY_RE = new RegExp(
  String.raw`(?:(${PRE})\s?(${NUM})(${K})?)|(?:(${NUM})(${K})?\s?(${POST})(?![A-Za-z]))`,
  "g",
);
const SEP_AFTER_RE = new RegExp(String.raw`^\s*(?:-|–|—|to|and)\s*(?:(${PRE})\s?)?(${NUM})(${K})?`, "i");
const SEP_BEFORE_RE = new RegExp(String.raw`(${NUM})(${K})?\s*(?:-|–|—|to)\s*$`, "i");
const MAGNITUDE_RE = /^\s?(?:m|mm|b|bn|mn|million|billion)\b/i;
const NOT_PAY_AFTER_RE = /^[^.\n]{0,25}?\b(?:bonus|stipend|allowance|referral|reimburse\w*|match(?:ing)?|funding|raised|revenue|budget|valuation)\b/i;
const NOT_PAY_BEFORE_RE = /\b(?:bonus|stipend|allowance|referral|raised|funding|revenue|valuation|budget)\b(?:\s+\w+){0,3}\s*(?:of|:)?\s*$/i;
const OPEN_MAX_BEFORE_RE = /\b(?:up\s?to|maximum(?:\s+of)?|max\.?|not\s+to\s+exceed|no\s+more\s+than)\s*$/i;
const OPEN_MIN_BEFORE_RE = /\b(?:from|starting\s+(?:at|from)|starts\s+at|minimum(?:\s+of)?|min\.?|at\s+least)\s*$/i;
const OPEN_MIN_AFTER_RE = /^\s*(?:\+|and\s+up\b|or\s+more\b|and\s+above\b|or\s+higher\b)/i;

const PERIOD_AFTER: [RegExp, PayPeriod][] = [
  [/^\s*(?:\/\s?|per\s+|an?\s+|each\s+)(?:hour|hr)\b|^\s*hourly\b|^\s*\/h\b/i, "hour"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)(?:year|yr|annum)\b|^\s*(?:annually|yearly|annual|p\.a\.|pa\b)/i, "year"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)(?:month|mo)\b|^\s*monthly\b/i, "month"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)(?:week|wk)\b|^\s*weekly\b/i, "week"],
  [/^\s*(?:\/\s?|per\s+|an?\s+)day\b|^\s*daily\b/i, "day"],
];
const PERIOD_BEFORE: [RegExp, PayPeriod][] = [
  [/\bhourly\b[^.\n]{0,25}$/i, "hour"],
  [/\b(?:annual|yearly|annually)\b[^.\n]{0,25}$/i, "year"],
  [/\bmonthly\b[^.\n]{0,25}$/i, "month"],
];

/** "80,000" → 80000, "80.000" → 80000, "27.50" → 27.5, "27,50" → 27.5, "80 000" → 80000. */
export function parseAmount(raw: string): number {
  const s = raw.replace(/[\u00a0\u202f ]/g, "");
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
  currency: Currency;
  start: number;
  end: number;
}

function moneyTokens(text: string): Token[] {
  const out: Token[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const pre = m[1];
    const raw = pre !== undefined ? m[2]! : m[4]!;
    const k = pre !== undefined ? m[3] : m[5];
    const cur = pre !== undefined ? pre : m[6]!;
    const currency = CURRENCY_OF[cur.toUpperCase()] ?? CURRENCY_OF[cur];
    if (!currency) continue;
    if (MAGNITUDE_RE.test(text.slice(end))) continue;
    if (NOT_PAY_AFTER_RE.test(text.slice(end, end + 40))) continue;
    if (NOT_PAY_BEFORE_RE.test(text.slice(Math.max(0, start - 40), start))) continue;
    out.push({ value: parseAmount(raw) * (k ? 1000 : 1), hasK: !!k, currency, start, end });
  }
  return out;
}

function periodAround(text: string, start: number, end: number): PayPeriod | null {
  const after = text.slice(end, end + 30);
  for (const [re, p] of PERIOD_AFTER) if (re.test(after)) return p;
  const before = text.slice(Math.max(0, start - 40), start);
  for (const [re, p] of PERIOD_BEFORE) if (re.test(before)) return p;
  return null;
}

interface Statement {
  kind: "range" | "single" | "open_max" | "open_min";
  min: number | null;
  max: number | null;
  currency: Currency;
  start: number;
  end: number;
}

function statements(text: string): Statement[] {
  const tokens = moneyTokens(text);
  const out: Statement[] = [];
  const used = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    if (used.has(i)) continue;
    const t = tokens[i]!;

    // A range written forwards: "$80,000 - $100,000", "$80-100k", "€45.000 to 55.000"
    const fwd = SEP_AFTER_RE.exec(text.slice(t.end));
    if (fwd) {
      const secondK = !!fwd[3];
      let hi = parseAmount(fwd[2]!) * (secondK ? 1000 : 1);
      let lo = t.value;
      if (secondK && !t.hasK && lo < 1000) lo *= 1000; // "$80-100k"
      if (!secondK && t.hasK && hi < 1000) hi *= 1000; // "$80k-100"
      const end = t.end + fwd[0].length;
      // min > max ("$50,000 and 20 days PTO") is not a range: read the first amount on its own.
      if (lo <= hi) {
        tokens.forEach((x, j) => {
          if (j > i && x.start < end) used.add(j);
        });
        out.push({ kind: lo < hi ? "range" : "single", min: lo, max: hi, currency: t.currency, start: t.start, end });
        continue;
      }
    }

    // A range written backwards onto a suffix currency: "45.000 – 55.000 €"
    const back = SEP_BEFORE_RE.exec(text.slice(Math.max(0, t.start - 30), t.start));
    if (back) {
      let lo = parseAmount(back[1]!) * (back[2] ? 1000 : 1);
      if (t.hasK && !back[2] && lo < 1000) lo *= 1000;
      const start = t.start - back[0].length;
      if (lo < t.value) {
        out.push({ kind: "range", min: lo, max: t.value, currency: t.currency, start, end: t.end });
        continue;
      }
    }

    const before = text.slice(Math.max(0, t.start - 25), t.start);
    const after = text.slice(t.end, t.end + 20);
    if (OPEN_MAX_BEFORE_RE.test(before)) {
      out.push({ kind: "open_max", min: null, max: t.value, currency: t.currency, start: t.start, end: t.end });
    } else if (OPEN_MIN_BEFORE_RE.test(before) || OPEN_MIN_AFTER_RE.test(after)) {
      const plus = OPEN_MIN_AFTER_RE.exec(after);
      out.push({ kind: "open_min", min: t.value, max: null, currency: t.currency, start: t.start, end: t.end + (plus ? plus[0].length : 0) });
    } else {
      out.push({ kind: "single", min: t.value, max: t.value, currency: t.currency, start: t.start, end: t.end });
    }
  }
  return out;
}

const NO_PAY: ExtractedPay = { kind: "none", min: null, max: null, currency: null, period: null, text: "", start: null, end: null };

/** The one pay statement RW1 reports: the first bounded range, else the first figure, else the first open-ended amount. */
export function extractPay(text: string): ExtractedPay {
  const found = statements(text);
  const pick =
    found.find((s) => s.kind === "range") ??
    found.find((s) => s.kind === "single") ??
    found.find((s) => s.kind === "open_max" || s.kind === "open_min");
  if (!pick) return NO_PAY;
  // "up to $60,000" reads better with its marker in the quote.
  let start = pick.start;
  if (pick.kind === "open_max" || (pick.kind === "open_min" && OPEN_MIN_BEFORE_RE.test(text.slice(Math.max(0, start - 25), start)))) {
    const m = /(?:up\s?to|maximum(?:\s+of)?|max\.?|not\s+to\s+exceed|no\s+more\s+than|from|starting\s+(?:at|from)|starts\s+at|minimum(?:\s+of)?|min\.?|at\s+least)\s*$/i.exec(
      text.slice(Math.max(0, start - 25), start),
    );
    if (m) start -= m[0].length;
  }
  return {
    kind: pick.kind,
    min: pick.min,
    max: pick.max,
    currency: pick.currency,
    period: periodAround(text, pick.start, pick.end),
    text: text.slice(start, pick.end).trim(),
    start,
    end: pick.end,
  };
}

const VAGUE_RE =
  /\b(competitive\s+(?:salary|pay|compensation|wages?|rates?)|competitive(?!\s+(?:benefits|environment|market))|DOE|depending\s+on\s+experience|dependent\s+on\s+experience|commensurate\s+with\s+experience|commensurate|negotiable|market\s+rate|attractive\s+(?:salary|package))\b/gi;

/** Vague pay words, lower-cased and de-duplicated, in order of appearance. */
export function vaguePayWords(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(VAGUE_RE)) {
    const w = m[1]!.replace(/\s+/g, " ");
    const key = w === "DOE" ? "DOE" : w.toLowerCase();
    // "competitive" inside "competitive salary" is already reported.
    if (!seen.includes(key) && !seen.some((s) => s.includes(key))) seen.push(key);
  }
  return seen;
}

const BENEFIT_RES: [BenefitCategory, RegExp][] = [
  ["health", /\b(?:health\s*(?:care|insurance|benefits?|plan|coverage)|healthcare|medical|dental|vision)\b/i],
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

export function extractAd(text: string): ExtractedAd {
  return {
    pay: extractPay(text),
    vaguePay: vaguePayWords(text),
    benefits: benefitCategories(text),
    benefitFiller: benefitFiller(text),
  };
}
