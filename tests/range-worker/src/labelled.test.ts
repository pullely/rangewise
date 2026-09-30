/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are plain JSON */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createSqlExecutor } from "@saas/db/d1";
import { createRangeRepository } from "@saas/db/range";
import type { PublicPayRule } from "@saas/contracts/range";
import { evaluate, extractAd } from "@range-worker/engine/index";
import { toPublicRule } from "@range-worker/present";
import { d1Over, migratedDatabase } from "./harness";

/**
 * The labelled set (plan RW2): real-world-shaped ad snippets, each with the
 * verdict every jurisdiction must get against the SEEDED rules table (read
 * from the real migrations, not a copy). Every verdict must match: this is the
 * brief's "false-flag rate under 2%" made into a test, at 0%.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SET = JSON.parse(readFileSync(resolve(__dirname, "../fixtures/labelled-ads.json"), "utf8")) as {
  checkDate: string;
  snippets: any[];
};

let rules: PublicPayRule[] = [];
beforeAll(async () => {
  const executor = createSqlExecutor(d1Over(migratedDatabase()));
  rules = (await createRangeRepository(executor).listRules()).map(toPublicRule);
});

function mismatches(s: any): string[] {
  const out: string[] = [];
  const ad = extractAd(s.ad);
  const results = evaluate(ad, { locations: s.locations, remote: s.remote, employeeCount: s.employeeCount, checkDate: SET.checkDate }, rules);
  const got = Object.fromEntries(results.map((r) => [r.location, r]));
  const want = Object.keys(s.expect).sort();
  const have = Object.keys(got).sort();
  if (want.join() !== have.join()) out.push(`jurisdictions: want ${want.join(",")} got ${have.join(",")}`);
  for (const [loc, verdict] of Object.entries(s.expect)) {
    if (got[loc]?.verdict !== verdict) out.push(`${loc}: want ${verdict} got ${got[loc]?.verdict} (${got[loc]?.deciding?.requirement}: ${got[loc]?.deciding?.explanation})`);
  }
  for (const [key, requirement] of Object.entries(s.deciding ?? {})) {
    const r = got[key] ?? results.find((x) => x.jurisdictionCode === key);
    if (r?.deciding?.requirement !== requirement) out.push(`${key}: deciding want ${requirement} got ${r?.deciding?.requirement}`);
  }
  if (s.pay?.byLocation) {
    for (const [loc, [min, max]] of Object.entries(s.pay.byLocation as Record<string, [number, number]>)) {
      const p = got[loc]?.pay;
      if (p?.min !== min || p?.max !== max) out.push(`${loc} pay: want ${min}–${max} got ${p?.min}–${p?.max}`);
    }
  } else if (s.pay) {
    for (const [field, value] of Object.entries(s.pay)) {
      if ((ad.pay as any)[field] !== value) out.push(`pay.${field}: want ${value} got ${(ad.pay as any)[field]} (${ad.pay.text})`);
    }
  }
  return out;
}

describe("the labelled set", () => {
  it("has at least 60 snippets, including the adversarial ones", () => {
    const ids = SET.snippets.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(60);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["range-next-to-signing-bonus", "competitive", "hourly-weekly-hours", "cad-for-ny", "up-to", "per-location-nyc-denver"]) {
      expect(ids).toContain(id);
    }
  });

  it.each(SET.snippets.map((s) => [s.id, s]))("%s", (_id, s) => {
    expect(mismatches(s)).toEqual([]);
  });

  it("scores 100 percent over every labelled verdict", () => {
    let total = 0;
    let wrong = 0;
    for (const s of SET.snippets) {
      total += Object.keys(s.expect).length;
      wrong += mismatches(s).filter((m) => /want (pass|fail|review|not_)/.test(m)).length;
    }
    // eslint-disable-next-line no-console -- the score is the milestone's headline number
    console.log(`labelled set: ${total - wrong}/${total} verdicts correct over ${SET.snippets.length} snippets`);
    expect(wrong).toBe(0);
  });
});
