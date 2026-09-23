import type { JurisdictionResult, PublicPayRule } from "@saas/contracts/range";
import { createSqlExecutor } from "@saas/db/d1";
import { createRangeRepository } from "@saas/db/range";
import { evaluate, extractAd, ruleInForce } from "@range-worker/engine/index";
import { toPublicRule } from "@range-worker/present";
import { d1Over, migratedDatabase } from "./harness";

let RULES: PublicPayRule[] = [];

beforeAll(async () => {
  const executor = createSqlExecutor(d1Over(migratedDatabase()));
  RULES = (await createRangeRepository(executor).listRules()).map(toPublicRule);
});

const GOOD_AD = `Senior Accountant (hybrid)
Compensation: $80,000 – $100,000 per year, depending on qualifications.
Benefits: medical, dental and vision insurance; 401(k) with 4% match; 20 days PTO plus paid holidays.
Apply by October 31 at careers.example.com.`;

const OPEN_AD = `Sales Associate — remote
Earn up to $60,000 in your first year! Competitive pay and a fun team.`;

function by(results: JurisdictionResult[], location: string): JurisdictionResult {
  const r = results.find((x) => x.location === location);
  if (!r) throw new Error(`no result for ${location}`);
  return r;
}

const facts = (over: Partial<Parameters<typeof evaluate>[1]> = {}): Parameters<typeof evaluate>[1] => ({
  locations: [],
  remote: "none",
  employeeCount: 50,
  checkDate: "2026-09-23",
  ...over,
});

describe("the seeded rules table", () => {
  it("has the nine verified rows of design §0.2, each with a source", () => {
    expect(RULES.map((r) => r.id).sort()).toEqual(
      ["EU@1", "US-CA@1", "US-CO@1", "US-DC@1", "US-MD@1", "US-MN@1", "US-NJ@1", "US-NY@1", "US-WA@1"],
    );
    for (const r of RULES) {
      expect(r.verification).toBe("verified");
      expect(r.verifiedOn).toBe("2026-09-23");
      expect(r.sourceUrl).toMatch(/^https?:\/\//);
      expect(r.citation.length).toBeGreaterThan(5);
      expect(r.effectiveTo).toBeNull();
    }
  });

  it("holds the effective dates and thresholds read from the sources", () => {
    const get = (code: string): PublicPayRule => RULES.find((r) => r.jurisdictionCode === code)!;
    expect([get("US-CO").effectiveFrom, get("US-CO").minEmployees]).toEqual(["2021-01-01", 1]);
    expect([get("US-NY").effectiveFrom, get("US-NY").minEmployees]).toEqual(["2023-09-17", 4]);
    expect([get("US-CA").effectiveFrom, get("US-CA").minEmployees]).toEqual(["2023-01-01", 15]);
    expect([get("US-WA").effectiveFrom, get("US-WA").minEmployees]).toEqual(["2023-01-01", 15]);
    expect([get("US-MN").effectiveFrom, get("US-MN").minEmployees]).toEqual(["2025-01-01", 30]);
    expect([get("US-MD").effectiveFrom, get("US-MD").minEmployees]).toEqual(["2024-10-01", 1]);
    expect([get("US-NJ").effectiveFrom, get("US-NJ").minEmployees]).toEqual(["2025-06-01", 10]);
    expect([get("US-DC").effectiveFrom, get("US-DC").minEmployees]).toEqual(["2024-06-30", 1]);
    expect([get("EU").effectiveFrom, get("EU").payObligation]).toEqual(["2026-06-07", "on_request"]);
    expect([get("US-NJ").maxSpreadPct, get("US-NJ").spreadStatus]).toEqual([60, "proposed"]);
  });

  it("picks the version in force on a date", () => {
    expect(ruleInForce(RULES, "US-NY", "2023-09-16")).toBeNull();
    expect(ruleInForce(RULES, "US-NY", "2023-09-17")?.id).toBe("US-NY@1");
  });
});

describe("evaluate", () => {
  it("passes a bounded range with benefits in Colorado and New York, naming the deciding rule", () => {
    const results = evaluate(extractAd(GOOD_AD), facts({ locations: ["US-CO", "US-NY"] }), RULES);
    expect(results.map((r) => [r.location, r.verdict])).toEqual([
      ["US-CO", "pass"],
      ["US-NY", "pass"],
    ]);
    const co = by(results, "US-CO");
    expect(co.ruleId).toBe("US-CO@1");
    expect(co.deciding?.requirement).toBe("range_bounded");
    expect(co.requirements.map((r) => [r.requirement, r.outcome])).toEqual([
      ["pay_disclosed", "met"],
      ["range_bounded", "met"],
      ["benefits_described", "met"],
    ]);
  });

  it("fails an open-ended ad in Colorado on range_bounded, citing C.R.S. § 8-5-201(2)", () => {
    const results = evaluate(extractAd(OPEN_AD), facts({ remote: "us" }), RULES);
    const co = by(results, "US-CO");
    expect(co.verdict).toBe("fail");
    expect(co.via).toBe("remote");
    expect(co.deciding?.requirement).toBe("range_bounded");
    expect(co.deciding?.outcome).toBe("failed");
    expect(co.deciding?.citation).toContain("C.R.S. § 8-5-201(2)");
    expect(co.deciding?.explanation).toContain('"up to $60,000"');
    // Remote coverage settled: NY and NJ fail too.
    expect(by(results, "US-NY").verdict).toBe("fail");
    expect(by(results, "US-NJ").verdict).toBe("fail");
    // Remote coverage unsettled: the fail is reported as review, with the reason.
    for (const code of ["US-CA", "US-WA", "US-MN", "US-MD", "US-DC"]) {
      const r = by(results, code);
      expect(r.verdict).toBe("review");
      expect(r.deciding?.explanation).toContain("only because the role is remote");
    }
    expect(results.find((r) => r.jurisdictionCode === "EU")).toBeUndefined();
  });

  it("names a state's own failure when it is listed explicitly, remote or not", () => {
    const results = evaluate(extractAd(OPEN_AD), facts({ locations: ["US-WA"], remote: "us" }), RULES);
    const wa = by(results, "US-WA");
    expect(wa.via).toBe("location");
    expect(wa.verdict).toBe("fail");
  });

  it("fails an ad with no pay, quoting its vague words", () => {
    const results = evaluate(extractAd("Great role. Competitive salary, DOE. Health insurance."), facts({ locations: ["US-NY"] }), RULES);
    const ny = by(results, "US-NY");
    expect(ny.verdict).toBe("fail");
    expect(ny.deciding?.requirement).toBe("pay_disclosed");
    expect(ny.deciding?.explanation).toContain('"competitive salary"');
  });

  it("fails benefits where they are required, and ignores them where not", () => {
    const ad = extractAd("Pay: $25-$30 per hour.");
    const results = evaluate(ad, facts({ locations: ["US-WA", "US-NY"] }), RULES);
    expect(by(results, "US-WA").verdict).toBe("fail");
    expect(by(results, "US-WA").deciding?.requirement).toBe("benefits_described");
    expect(by(results, "US-NY").verdict).toBe("pass");
  });

  it("puts benefit filler to review where benefits are required", () => {
    const ad = extractAd("$60,000 - $70,000 per year. Health insurance and more!");
    const results = evaluate(ad, facts({ locations: ["US-CO"] }), RULES);
    expect(by(results, "US-CO").verdict).toBe("review");
    expect(by(results, "US-CO").deciding?.requirement).toBe("benefits_described");
  });

  it("applies employer-size thresholds", () => {
    const results = evaluate(extractAd(OPEN_AD), facts({ locations: ["US-NY", "US-CO", "US-MN"], employeeCount: 3 }), RULES);
    expect(by(results, "US-NY").verdict).toBe("not_applicable");
    expect(by(results, "US-NY").deciding?.explanation).toContain("4 or more employees");
    expect(by(results, "US-CO").verdict).toBe("fail");
    expect(by(results, "US-MN").verdict).toBe("not_applicable");
  });

  it("says not_in_force before a rule's effective date", () => {
    const results = evaluate(extractAd(OPEN_AD), facts({ locations: ["US-NJ"], checkDate: "2025-05-31" }), RULES);
    expect(by(results, "US-NJ").verdict).toBe("not_in_force");
    expect(by(results, "US-NJ").deciding?.explanation).toContain("2025-06-01");
  });

  it("reviews single figures where the text asks for a range, and allows them where it does not", () => {
    const ad = extractAd("Pay: $27.50 per hour. Medical and dental, 401(k), PTO.");
    const results = evaluate(ad, facts({ locations: ["US-CA", "US-NY", "US-MD"] }), RULES);
    expect(by(results, "US-CA").verdict).toBe("review");
    expect(by(results, "US-CA").deciding?.requirement).toBe("single_figure");
    expect(by(results, "US-NY").verdict).toBe("pass");
    expect(by(results, "US-MD").verdict).toBe("review");
  });

  it("puts New Jersey's proposed 60% spread to review, never fail", () => {
    const ad = extractAd("Salary $100,000 to $165,000 a year. Health, dental, 401(k) and PTO.");
    const nj = by(evaluate(ad, facts({ locations: ["US-NJ"] }), RULES), "US-NJ");
    expect(nj.verdict).toBe("review");
    expect(nj.deciding?.requirement).toBe("spread");
    expect(nj.deciding?.explanation).toContain("65%");
    const ok = by(evaluate(extractAd("Salary $95,000 to $115,000 a year. Health, dental, 401(k) and PTO."), facts({ locations: ["US-NJ"] }), RULES), "US-NJ");
    expect(ok.verdict).toBe("pass");
  });

  it("treats the EU Directive as advice: pass with pay, review without, never fail", () => {
    const withPay = evaluate(extractAd("Gehalt: 45.000 – 55.000 € brutto"), facts({ locations: ["EU-DE"] }), RULES);
    expect(by(withPay, "EU-DE")).toMatchObject({ jurisdictionCode: "EU", verdict: "pass", ruleId: "EU@1" });
    const without = evaluate(extractAd("Competitive package."), facts({ remote: "eu" }), RULES);
    expect(by(without, "EU").verdict).toBe("review");
    expect(by(without, "EU").deciding?.requirement).toBe("on_request");
    const early = evaluate(extractAd("Competitive package."), facts({ locations: ["EU"], checkDate: "2026-01-01" }), RULES);
    expect(by(early, "EU").verdict).toBe("not_in_force");
  });

  it("says not_covered for places without a rule, with the reason when it is known", () => {
    const results = evaluate(extractAd(GOOD_AD), facts({ locations: ["US-TX", "US-IL"] }), RULES);
    expect(by(results, "US-TX").verdict).toBe("not_covered");
    expect(by(results, "US-TX").deciding?.explanation).toContain("does not mean the place has no pay-transparency law");
    expect(by(results, "US-IL").deciding?.explanation).toContain("not yet verified");
  });

  it("is deterministic", () => {
    const a = evaluate(extractAd(OPEN_AD), facts({ remote: "anywhere" }), RULES);
    const b = evaluate(extractAd(OPEN_AD), facts({ remote: "anywhere" }), RULES);
    expect(a).toEqual(b);
    expect(a).toHaveLength(9);
  });
});
