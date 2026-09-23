import {
  RANGE_UNVERIFIED_JURISDICTIONS,
  describePay,
  ruleCodeFor,
  type ExtractedAd,
  type JurisdictionResult,
  type PublicPayRule,
  type RangeRemoteArea,
  type RangeVerdict,
  type RequirementResult,
} from "@saas/contracts/range";
import { CORE_BENEFITS } from "./extract.js";

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

function requirementsFor(rule: PublicPayRule, ad: ExtractedAd): RequirementResult[] {
  const req = (requirement: RequirementResult["requirement"], outcome: RequirementResult["outcome"], explanation: string): RequirementResult => ({
    requirement,
    outcome,
    explanation,
    citation: rule.citation,
  });
  const pay = ad.pay;
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
    out.push(req("pay_disclosed", "failed", `No pay is stated in the ad.${vague} ${rule.jurisdictionName} requires the pay or pay range in the posting.`));
    return out.concat(benefitsRequirement(rule, ad));
  }
  out.push(req("pay_disclosed", "met", `Pay is stated: ${payText} (${describePay(pay)}).`));

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
  return out.concat(benefitsRequirement(rule, ad));
}

function benefitsRequirement(rule: PublicPayRule, ad: ExtractedAd): RequirementResult[] {
  if (!rule.benefitsRequired) return [];
  const core = ad.benefits.filter((b) => CORE_BENEFITS.includes(b));
  const citation = rule.citation;
  if (core.length === 0) {
    return [
      {
        requirement: "benefits_described",
        outcome: "failed",
        explanation: `No benefits are described. ${rule.jurisdictionName} requires ${rule.benefitsScope}.`,
        citation,
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
      },
    ];
  }
  return [
    {
      requirement: "benefits_described",
      outcome: "met",
      explanation: `Benefits are described (${core.join(", ")}). Rangewise checks that benefits are described, not that the list is complete.`,
      citation,
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

  const requirements = requirementsFor(rule, ad);
  let { verdict, deciding } = decide(requirements);
  if (verdict === "fail" && t.via === "remote" && rule.remoteCoverage === "unsettled" && deciding) {
    verdict = "review";
    deciding = {
      ...deciding,
      outcome: "review",
      explanation: `${deciding.explanation} ${name} is included only because the role is remote, and the source Rangewise read does not say whether remote roles performable there are covered.`,
    };
  }
  return { ...base, jurisdictionName: name, verdict, ruleId: rule.id, citation: rule.citation, sourceUrl: rule.sourceUrl, deciding, requirements };
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
