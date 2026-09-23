import { benefitCategories, benefitFiller, extractPay, parseAmount, vaguePayWords } from "@range-worker/engine/index";

describe("parseAmount", () => {
  it.each([
    ["80,000", 80000],
    ["80.000", 80000],
    ["80 000", 80000],
    ["1,250,000", 1250000],
    ["27.50", 27.5],
    ["27,50", 27.5],
    ["80000", 80000],
    ["80", 80],
    ["80,000.50", 80000.5],
    ["80.000,50", 80000.5],
  ])("%s → %d", (raw, n) => {
    expect(parseAmount(raw)).toBe(n);
  });
});

describe("extractPay (RW1 first cut)", () => {
  it("reads a bounded annual range", () => {
    const pay = extractPay("Compensation: $80,000 – $100,000 per year, plus benefits.");
    expect(pay).toMatchObject({ kind: "range", min: 80000, max: 100000, currency: "USD", period: "year", text: "$80,000 – $100,000" });
  });

  it("reads k ranges, shared k, and 'to'", () => {
    expect(extractPay("Salary $120k-$150k annually")).toMatchObject({ kind: "range", min: 120000, max: 150000, period: "year" });
    expect(extractPay("Base pay $80-100k")).toMatchObject({ kind: "range", min: 80000, max: 100000 });
    expect(extractPay("between $95,000 and $120,000 a year")).toMatchObject({ kind: "range", min: 95000, max: 120000, period: "year" });
    expect(extractPay("USD 70,000 to USD 90,000")).toMatchObject({ kind: "range", min: 70000, max: 90000, currency: "USD" });
  });

  it("reads hourly ranges and single figures", () => {
    expect(extractPay("$25 - $30/hr, weekends off")).toMatchObject({ kind: "range", min: 25, max: 30, period: "hour" });
    expect(extractPay("Pay: $27.50 per hour")).toMatchObject({ kind: "single", min: 27.5, max: 27.5, period: "hour" });
    expect(extractPay("Hourly rate of $22")).toMatchObject({ kind: "single", min: 22, period: "hour" });
  });

  it("reads EU formats with the currency before or after", () => {
    expect(extractPay("Gehalt: 45.000 – 55.000 € brutto jährlich")).toMatchObject({ kind: "range", min: 45000, max: 55000, currency: "EUR" });
    expect(extractPay("Salary €50.000 - €60.000 per annum")).toMatchObject({ kind: "range", min: 50000, max: 60000, currency: "EUR", period: "year" });
    expect(extractPay("£40,000 to £48,000")).toMatchObject({ kind: "range", min: 40000, max: 48000, currency: "GBP" });
  });

  it("flags open-ended amounts", () => {
    expect(extractPay("Earn up to $60,000!")).toMatchObject({ kind: "open_max", min: null, max: 60000, text: "up to $60,000" });
    expect(extractPay("Starting at $30/hour")).toMatchObject({ kind: "open_min", min: 30, max: null, period: "hour", text: "Starting at $30" });
    expect(extractPay("Base salary $70,000+ DOE")).toMatchObject({ kind: "open_min", min: 70000, max: null });
    expect(extractPay("$90,000 and up")).toMatchObject({ kind: "open_min", min: 90000 });
  });

  it("prefers a bounded range over an open-ended bonus figure", () => {
    const pay = extractPay("Bonus up to $10,000. Salary $80,000 - $95,000 per year.");
    expect(pay).toMatchObject({ kind: "range", min: 80000, max: 95000 });
  });

  it("ignores money that is not pay", () => {
    expect(extractPay("We raised $25M in our Series B and serve 10,000 customers.")).toMatchObject({ kind: "none" });
    expect(extractPay("A $1,000 signing bonus and a 401(k) match.")).toMatchObject({ kind: "none" });
    expect(extractPay("Our annual revenue of $5 million")).toMatchObject({ kind: "none" });
  });

  it("does not read a reversed pair as a range", () => {
    expect(extractPay("$50,000 and 20 days of PTO")).toMatchObject({ kind: "single", min: 50000 });
  });

  it("reports no pay when there is none", () => {
    expect(extractPay("Competitive salary, great team.")).toMatchObject({ kind: "none", text: "", start: null });
  });
});

describe("vague pay words, benefits and filler", () => {
  it("finds vague pay wording", () => {
    expect(vaguePayWords("Competitive salary, DOE. Pay is negotiable.")).toEqual(["competitive salary", "DOE", "negotiable"]);
    expect(vaguePayWords("We offer competitive benefits")).toEqual([]);
  });

  it("finds benefit categories", () => {
    expect(benefitCategories("Medical, dental and vision; 401(k) with match; 20 days PTO; annual bonus")).toEqual([
      "health",
      "retirement",
      "paid_time_off",
      "bonus",
    ]);
    expect(benefitCategories("Life insurance and stock options")).toEqual(["insurance", "equity"]);
    expect(benefitCategories("A fun team")).toEqual([]);
  });

  it("finds filler", () => {
    expect(benefitFiller("Health insurance and more! Great benefits, etc.")).toEqual(["and more", "great benefits", "etc"]);
  });
});
