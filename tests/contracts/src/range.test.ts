import { describePay, isLocationCode, overallVerdict, ruleCodeFor } from "@saas/contracts/range";

describe("range contracts", () => {
  it("accepts US state, DC, EU and EU member-state codes and nothing else", () => {
    for (const ok of ["US-CO", "US-NY", "US-DC", "US-TX", "EU", "EU-DE", "EU-FR", "EU-EL"]) expect(isLocationCode(ok)).toBe(true);
    for (const bad of ["US", "US-XX", "us-co", "EU-US", "EU-GB", "CO", "US-CO-DEN", "", "EU-"]) expect(isLocationCode(bad)).toBe(false);
  });

  it("maps member states onto the Directive's row", () => {
    expect(ruleCodeFor("EU-DE")).toBe("EU");
    expect(ruleCodeFor("EU")).toBe("EU");
    expect(ruleCodeFor("US-CO")).toBe("US-CO");
  });

  it("takes the worst verdict as the overall one", () => {
    expect(overallVerdict(["pass", "fail", "review"])).toBe("fail");
    expect(overallVerdict(["pass", "review", "not_applicable"])).toBe("review");
    expect(overallVerdict(["not_applicable", "pass"])).toBe("pass");
    expect(overallVerdict(["not_covered", "not_in_force"])).toBe("not_in_force");
    expect(overallVerdict([])).toBe("not_covered");
  });

  it("describes pay the way the console shows it", () => {
    const base = { text: "", start: null, end: null } as const;
    expect(describePay({ ...base, kind: "range", min: 80000, max: 100000, currency: "USD", period: "year" })).toBe("$80,000–$100,000 per year");
    expect(describePay({ ...base, kind: "open_max", min: null, max: 60000, currency: "EUR", period: null })).toBe("up to €60,000 (no bottom)");
    expect(describePay({ ...base, kind: "single", min: 27.5, max: 27.5, currency: "USD", period: "hour" })).toBe("$27.5 per hour");
    expect(describePay({ ...base, kind: "none", min: null, max: null, currency: null, period: null })).toBe("no pay stated");
  });
});
