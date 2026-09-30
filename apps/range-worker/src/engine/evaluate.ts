import {
  EU_CURRENCIES,
  RANGE_UNVERIFIED_JURISDICTIONS,
  describePay,
  type EvidenceSpan,
  type ExtractedPay,
  ruleCodeFor,
  type ExtractedAd,
  type JurisdictionResult,
  type PublicPayRule,
  type RangeRemoteArea,
  type RangeVerdict,
  type RequirementResult,
} from "@saas/contracts/range";
import { CORE_BENEFITS, NO_PAY, bestStatement } from "./extract.js";

/**
 * Colorado requires every posting to say how and when to apply (C.R.S.
 * § 8-5-201(2); POST Rule 11.1.1, 11.1.3(A)–(B), as INFO #9A §3 reads them).
 * Keyed off the jurisdiction here rather than a rules-table column: adding a
 * column would edit seeded rule rows, which design §0.1 forbids. A later rules
 * migration can move it into the table as a new version.
 */
const APPLY_INFO_RULES: Readonly<Record<string, string>> = {
  "US-CO": "C.R.S. § 8-5-201(2); 7 CCR 1103-18 (POST Rules) Rule 11.1.1, 11.1.3(A)–(B)",
};

function spanOf(pay: ExtractedPay): EvidenceSpan[] {
  return pay.start !== null && pay.end !== null ? [{ text: pay.text, start: pay.start, end: pay.end }] : [];
}

interface ChosenPay {
  pay: ExtractedPay;
  /** Set when the ad gives pay only for other places. */
  onlyFor: string[];
}

/**
 * The pay statement that applies to one target: a statement written for that
 * place ("Denver: …" for US-CO), else the statements written for the whole ad,
 * else none — the ad gives pay only for other places.
 */
export function payFor(ad: ExtractedAd, location: string): ChosenPay {
  const statements = ad.statements ?? (ad.pay.kind === "none" ? [] : [ad.pay]);
  const matches = (s: ExtractedPay): boolean => {
    const locs = s.locations ?? [];
    return locs.includes(location) || (location === "EU" && locs.some((l) => l.startsWith("EU-")));
  };
  const own = bestStatement(statements.filter(matches));
  if (own) return { pay: own, onlyFor: [] };
  const general = bestStatement(statements.filter((s) => (s.locations ?? []).length === 0));
  if (general) return { pay: general, onlyFor: [] };
  const scoped = [...new Set(statements.map((s) => s.scope).filter((x): x is string => !!x))];
  return { pay: NO_PAY, onlyFor: scoped };
}

function currencyOk(code: string, currency: string | null | undefined): boolean {
  if (!currency) return true;
  return code === "EU" ? EU_CURRENCIES.includes(currency) : currency === "USD";
}

/**
 * Apply each jurisdiction's rule to an extracted ad (design §2.2). Pure: the
 * same ad, facts and rules always give the same results.
 */

export interface CheckFacts {
  locations: readonly string[];
  remote: RangeRemoteArea;
  employeeCount: number;
  /** ISO date the ad is checked for. */
  checkDate: string;
}

interface Target {
  location: string;
  code: string;
  via: "location" | "remote";
}

/** The jurisdictions a check covers: the named locations first, then every seeded one the remote area adds. */
export function targets(facts: CheckFacts, rules: readonly PublicPayRule[]): Target[] {
  const out: Target[] = [];
  const seen = new Set<string>();
  for (const location of facts.locations) {
    if (seen.has(location)) continue;
    seen.add(location);
    out.push({ location, code: ruleCodeFor(location), via: "location" });
  }
  const covered = new Set(out.map((t) => t.code));
  const codes = [...new Set(rules.map((r) => r.jurisdictionCode))].sort();
  const inArea = (code: string): boolean =>
    facts.remote === "anywhere" ||
    (facts.remote === "us" && code.startsWith("US-")) ||
    (facts.remote === "eu" && code === "EU");
  for (const code of codes) {
    if (!covered.has(code) && inArea(code)) out.push({ location: code, code, via: "remote" });
  }
  return out;
}

/** The rule version in force on `date`, or null. */
export function ruleInForce(rules: readonly PublicPayRule[], code: string, date: string): PublicPayRule | null {
  const candidates = rules
    .filter((r) => r.jurisdictionCode === code && r.effectiveFrom <= date && (r.effectiveTo === null || date < r.effectiveTo))
    .sort((a, b) => b.version - a.version);
  return candidates[0] ?? null;
}

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function requirementsFor(rule: PublicPayRule, ad: ExtractedAd, chosen: ChosenPay): RequirementResult[] {
  const pay = chosen.pay;
  const payEvidence = spanOf(pay);
  const req = (
    requirement: RequirementResult["requirement"],
    outcome: RequirementResult["outcome"],
    explanation: string,
    evidence: EvidenceSpan[] = payEvidence,
  ): RequirementResult => ({
    requirement,
    outcome,
    explanation,
    citation: rule.citation,
    evidence,
  });
  const payText = pay.text ? `"${pay.text}"` : "";
  const out: RequirementResult[] = [];

  if (rule.payObligation === "on_request") {
    out.push(
      pay.kind === "range" || pay.kind === "single"
        ? req("on_request", "met", `The ad states pay (${payText}). Applicants are entitled to the initial pay or its range, and the ad gives it.`)
        : req(
            "on_request",
            "review",
            `The ad states ${pay.kind === "none" ? "no pay" : `only an open-ended amount (${payText})`}. The Directive lets the employer give the initial pay or its range in the ad, before the interview "or otherwise"; national law transposing it may require it in the ad.`,
          ),
    );
    return out;
  }

  if (pay.kind === "none") {
    const vague = ad.vaguePay.length ? ` It says ${ad.vaguePay.map((w) => `"${w}"`).join(", ")}, which does not count as pay.` : "";
    const scoped = chosen.onlyFor.length
      ? `The ad gives pay only for ${chosen.onlyFor.join("; ")}, and none of it is written for ${rule.jurisdictionName}.`
      : "No pay is stated in the ad.";
    const bonus = (ad.nonPay ?? []).find((n) => n.kind === "sign_on_bonus" || n.kind === "bonus");
    const other = bonus ? ` "${bonus.text}" is a bonus, not the position's pay.` : "";
    out.push(req("pay_disclosed", "failed", `${scoped}${vague}${other} ${rule.jurisdictionName} requires the pay or pay range in the posting.`, ad.vagueEvidence ?? []));
    return out.concat(benefitsRequirement(rule, ad), applyRequirement(rule, ad));
  }
  const scopeNote = pay.scope ? ` It is the pay the ad gives for ${pay.scope}.` : "";
  out.push(req("pay_disclosed", "met", `Pay is stated: ${payText} (${describePay(pay)}).${scopeNote}`));
  if (!currencyOk(rule.jurisdictionCode, pay.currency)) {
    out.push(
      req(
        "pay_currency",
        "review",
        `The pay is stated in ${pay.currency}, not ${rule.jurisdictionCode === "EU" ? "the euro or a member state's currency" : "US dollars"}. Rangewise cannot tell whether that is the pay for a role performed in ${rule.jurisdictionName}.`,
      ),
    );
  }

  if (pay.kind === "open_max" || pay.kind === "open_min") {
    const missing = pay.kind === "open_max" ? "a bottom" : "a top";
    out.push(req("range_bounded", "failed", `${payText} has no ${missing === "a bottom" ? "minimum" : "maximum"}. ${rule.jurisdictionName} requires a range with both a minimum and a maximum, or one fixed figure; an open-ended range lacks ${missing}.`));
  } else if (pay.kind === "range") {
    out.push(req("range_bounded", "met", `The range ${describePay(pay)} has a minimum and a maximum.`));
    if (rule.maxSpreadPct !== null && pay.min !== null && pay.max !== null && pay.min > 0) {
      const spread = ((pay.max - pay.min) / pay.min) * 100;
      const pct = Math.round(spread * 10) / 10;
      if (spread > rule.maxSpreadPct) {
        out.push(
          req(
            "spread",
            rule.spreadStatus === "in_force" ? "failed" : "review",
            `The top of the range is ${pct}% above the bottom; the ${rule.spreadStatus === "proposed" ? "proposed (not yet adopted) " : ""}limit is ${rule.maxSpreadPct}%.`,
          ),
        );
      } else {
        out.push(req("spread", "met", `The top of the range is ${pct}% above the bottom, within the ${rule.maxSpreadPct}% ${rule.spreadStatus === "proposed" ? "proposed " : ""}limit.`));
      }
    }
  } else {
    // single figure
    out.push(
      rule.singleFigure === "allowed"
        ? req("single_figure", "met", `One fixed figure (${describePay(pay)}) is accepted in ${rule.jurisdictionName} when the pay is fixed.`)
        : req(
            "single_figure",
            "review",
            `The ad gives one figure (${describePay(pay)}). ${rule.jurisdictionName}'s text asks for a range (a minimum and a maximum); whether a single fixed rate is enough is not settled in the source Rangewise read.`,
          ),
    );
  }
  return out.concat(benefitsRequirement(rule, ad), applyRequirement(rule, ad));
}

function applyRequirement(rule: PublicPayRule, ad: ExtractedAd): RequirementResult[] {
  const citation = APPLY_INFO_RULES[rule.jurisdictionCode];
  if (!citation || !ad.apply) return [];
  const { how, when, untilFilled } = ad.apply;
  const evidence = [how, when, untilFilled].filter((x): x is EvidenceSpan => x !== null);
  if (how && when) {
    return [{ requirement: "apply_info", outcome: "met", explanation: `The ad says how to apply ("${how.text}") and by when ("${when.text}").`, citation, evidence }];
  }
  const missing = [how ? null : "how to apply", when ? null : "an application deadline (or that applications are accepted on an ongoing basis)"].filter(Boolean).join(" and ");
  const filled = untilFilled && !when ? ` "${untilFilled.text}" is not a deadline under the Colorado guidance.` : "";
  return [
    {
      requirement: "apply_info",
      outcome: "review",
      explanation: `Rangewise did not find ${missing} in the ad.${filled} ${rule.jurisdictionName} requires every posting to say how and when to apply; a human should confirm it is there.`,
      citation,
      evidence,
    },
  ];
}

function benefitsRequirement(rule: PublicPayRule, ad: ExtractedAd): RequirementResult[] {
  if (!rule.benefitsRequired) return [];
  const core = ad.benefits.filter((b) => CORE_BENEFITS.includes(b));
  const citation = rule.citation;
  const evidence: EvidenceSpan[] = (ad.benefitEvidence ?? [])
    .filter((b) => CORE_BENEFITS.includes(b.category))
    .map(({ text, start, end }) => ({ text, start, end }));
  if (core.length === 0) {
    return [
      {
        requirement: "benefits_described",
        outcome: "failed",
        explanation: `No benefits are described. ${rule.jurisdictionName} requires ${rule.benefitsScope}.`,
        citation,
        evidence: [],
      },
    ];
  }
  if (ad.benefitFiller.length) {
    return [
      {
        requirement: "benefits_described",
        outcome: "review",
        explanation: `Benefits are described (${core.join(", ")}) but with ${ad.benefitFiller.map((f) => `"${f}"`).join(", ")}; ${rule.jurisdictionName} asks for a general description of all benefits, and open-ended filler does not count toward it.`,
        citation,
        evidence,
      },
    ];
  }
  return [
    {
      requirement: "benefits_described",
      outcome: "met",
      explanation: `Benefits are described (${core.join(", ")}). Rangewise checks that benefits are described, not that the list is complete.`,
      citation,
      evidence,
    },
  ];
}

function decide(requirements: RequirementResult[]): { verdict: RangeVerdict; deciding: RequirementResult | null } {
  const failed = requirements.find((r) => r.outcome === "failed");
  if (failed) return { verdict: "fail", deciding: failed };
  const review = requirements.find((r) => r.outcome === "review");
  if (review) return { verdict: "review", deciding: review };
  const pay =
    requirements.find((r) => r.requirement === "range_bounded" || r.requirement === "single_figure" || r.requirement === "on_request") ??
    requirements[0] ??
    null;
  return { verdict: "pass", deciding: pay };
}

export function evaluate(ad: ExtractedAd, facts: CheckFacts, rules: readonly PublicPayRule[]): JurisdictionResult[] {
  return targets(facts, rules).map((t) => evaluateOne(ad, facts, rules, t));
}

function evaluateOne(ad: ExtractedAd, facts: CheckFacts, rules: readonly PublicPayRule[], t: Target): JurisdictionResult {
  const versions = rules.filter((r) => r.jurisdictionCode === t.code);
  const base = { location: t.location, jurisdictionCode: t.code, via: t.via };

  if (versions.length === 0) {
    const reason =
      RANGE_UNVERIFIED_JURISDICTIONS[t.code] ??
      `Rangewise has no rule for ${t.code}. That does not mean the place has no pay-transparency law.`;
    return withReason(base, t.code, reason);
  }

  const name = versions[0]!.jurisdictionName;
  const rule = ruleInForce(rules, t.code, facts.checkDate);
  if (!rule) {
    const upcoming = versions.filter((r) => r.effectiveFrom > facts.checkDate).sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))[0];
    const shown = upcoming ?? versions[versions.length - 1]!;
    const deciding: RequirementResult = {
      requirement: "in_force",
      outcome: "met",
      explanation: upcoming
        ? `${name}'s rule applies from ${upcoming.effectiveFrom}; the check date is ${facts.checkDate}.`
        : `${name}'s rule is not in force on ${facts.checkDate}.`,
      citation: shown.citation,
    };
    return { ...base, jurisdictionName: name, verdict: "not_in_force", ruleId: shown.id, citation: shown.citation, sourceUrl: shown.sourceUrl, deciding, requirements: [deciding] };
  }

  if (facts.employeeCount < rule.minEmployees) {
    const deciding: RequirementResult = {
      requirement: "employer_size",
      outcome: "failed",
      explanation: `The rule covers employers with ${rule.minEmployees} or more ${rule.employeeScope}; the check states ${money(facts.employeeCount)}.`,
      citation: rule.citation,
    };
    return { ...base, jurisdictionName: name, verdict: "not_applicable", ruleId: rule.id, citation: rule.citation, sourceUrl: rule.sourceUrl, deciding, requirements: [deciding] };
  }

  const chosen = payFor(ad, t.location);
  const requirements = requirementsFor(rule, ad, chosen);
  let { verdict, deciding } = decide(requirements);
  if (verdict === "fail" && t.via === "remote" && rule.remoteCoverage === "unsettled" && deciding) {
    verdict = "review";
    deciding = {
      ...deciding,
      outcome: "review",
      explanation: `${deciding.explanation} ${name} is included only because the role is remote, and the source Rangewise read does not say whether remote roles performable there are covered.`,
    };
  }
  return { ...base, jurisdictionName: name, verdict, ruleId: rule.id, citation: rule.citation, sourceUrl: rule.sourceUrl, deciding, requirements, pay: chosen.pay };
}

function withReason(base: { location: string; jurisdictionCode: string; via: "location" | "remote" }, code: string, reason: string): JurisdictionResult {
  return {
    ...base,
    jurisdictionName: code,
    verdict: "not_covered",
    ruleId: null,
    citation: null,
    sourceUrl: null,
    deciding: { requirement: "in_force", outcome: "review", explanation: reason, citation: "" },
    requirements: [],
  };
}
