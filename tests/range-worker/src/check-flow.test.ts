/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { route } from "@range-worker/router";
import { orgPublicId } from "@range-worker/ids";
import { MEMBER, OWNER, STRANGER, VIEWER, as, json, world, type TestWorld } from "./harness";

const ORG_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG = orgPublicId(ORG_UUID);
const BASE = "https://range.internal";
const RULES = `/v1/organizations/${ORG}/pay-rules`;
const CHECKS = `/v1/organizations/${ORG}/pay-checks`;

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}

function check(w: TestWorld, who: string, body: unknown): Promise<Response> {
  return call(w, CHECKS, { method: "POST", headers: { ...as(who), "content-type": "application/json" }, body: JSON.stringify(body) });
}

function audit(w: TestWorld): { event_type: string; subject_kind: string; subject_id: string; payload: string; org_id: string }[] {
  return w.db
    .prepare("SELECT event_type, subject_kind, subject_id, payload, org_id FROM events_audit_entries ORDER BY occurred_at, rowid")
    .all() as any;
}

const PASSING = {
  title: "Senior Accountant",
  adText: "Compensation: $80,000 – $100,000 per year. Benefits: medical, dental, 401(k), 20 days PTO.",
  locations: ["US-CO", "us-ny"],
  employeeCount: 50,
};
const FAILING = { title: "Sales Associate", adText: "Earn up to $60,000! Competitive pay.", remote: "us", employeeCount: 50 };

describe("the rules table and the manual check, over HTTP", () => {
  it("lists every rule with its citation and source to any member, including a viewer", async () => {
    const w = world();
    for (const who of [OWNER, MEMBER, VIEWER]) {
      const res = await call(w, RULES, { headers: as(who) });
      expect(res.status).toBe(200);
      const { data } = await json(res);
      expect(data.rules).toHaveLength(9);
      expect(data.jurisdictions).toHaveLength(9);
      expect(data.rulesVersion).toMatch(/^rules_[0-9a-f]{16}$/);
      expect(data.notCovered.map((n: any) => n.code)).toEqual(["US-IL", "US-MA", "US-VT", "US-HI"]);
      const co = data.rules.find((r: any) => r.id === "US-CO@1");
      expect(co).toMatchObject({ jurisdictionName: "Colorado", sourceKind: "official_guidance", benefitsRequired: true, verification: "verified" });
    }
  });

  it("runs a check that passes, and audits verdicts without the ad text", async () => {
    const w = world();
    const res = await check(w, OWNER, PASSING);
    expect(res.status).toBe(200);
    const { check: c } = (await json(res)).data;
    expect(c.id).toMatch(/^rwc_[0-9a-f]{32}$/);
    expect(c.overall).toBe("pass");
    expect(c.locations).toEqual(["US-CO", "US-NY"]);
    expect(c.extracted.pay).toMatchObject({ kind: "range", min: 80000, max: 100000, period: "year" });
    expect(c.results.map((r: any) => [r.location, r.verdict, r.ruleId])).toEqual([
      ["US-CO", "pass", "US-CO@1"],
      ["US-NY", "pass", "US-NY@1"],
    ]);
    expect(c.adSha256).toMatch(/^[0-9a-f]{64}$/);

    const rows = audit(w);
    expect(rows.map((r) => r.event_type)).toEqual(["range.check.run"]);
    expect(rows[0]!.subject_kind).toBe("pay_check");
    expect(rows[0]!.org_id).toBe(ORG_UUID);
    const payload = JSON.parse(rows[0]!.payload);
    expect(payload.checkId).toBe(c.id);
    expect(payload.overall).toBe("pass");
    expect(rows[0]!.payload).not.toContain("Senior Accountant ad text");
    expect(rows[0]!.payload).not.toContain("Compensation:");
  });

  it("runs a check that fails, naming the deciding rule and its citation", async () => {
    const w = world();
    const res = await check(w, MEMBER, FAILING);
    expect(res.status).toBe(200);
    const { check: c } = (await json(res)).data;
    expect(c.overall).toBe("fail");
    const co = c.results.find((r: any) => r.jurisdictionCode === "US-CO");
    expect(co.verdict).toBe("fail");
    expect(co.deciding.requirement).toBe("range_bounded");
    expect(co.deciding.citation).toContain("C.R.S. § 8-5-201(2)");
    expect(co.sourceUrl).toContain("cdle.colorado.gov");
  });

  it("refuses bad input with 422 before touching policy", async () => {
    const w = world();
    const bad = await check(w, OWNER, { adText: "", locations: ["US-XX", "CO"], employeeCount: 0, remote: "mars", checkDate: "2026-02-30" });
    expect(bad.status).toBe(422);
    const { error } = await json(bad);
    expect(Object.keys(error.details.fields).sort()).toEqual(["adText", "checkDate", "employeeCount", "locations", "remote"]);
    const nowhere = await check(w, OWNER, { adText: "x", employeeCount: 5 });
    expect(nowhere.status).toBe(422);
    const invalidJson = await call(w, CHECKS, { method: "POST", headers: { ...as(OWNER), "content-type": "application/json" }, body: "{" });
    expect(invalidJson.status).toBe(422);
  });

  it("hides the org from non-members (404), keeps viewers to reading, and needs an actor (401)", async () => {
    const w = world();
    expect((await call(w, RULES, { headers: as(STRANGER) })).status).toBe(404);
    expect((await check(w, STRANGER, PASSING)).status).toBe(404);
    expect((await check(w, VIEWER, PASSING)).status).toBe(404);
    expect((await call(w, RULES)).status).toBe(401);
    expect((await call(w, CHECKS, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await call(w, CHECKS, { headers: as(OWNER) })).status).toBe(405);
    expect((await call(w, `/v1/organizations/not-an-org/pay-rules`, { headers: as(OWNER) })).status).toBe(404);
    expect(audit(w)).toHaveLength(0);
  });

  it("reports health with its bindings", async () => {
    const w = world();
    const res = await call(w, "/health");
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.service).toBe("range-worker");
    expect(data.checks.database.configured).toBe(true);
  });
});
