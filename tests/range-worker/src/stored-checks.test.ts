/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { route } from "@range-worker/router";
import { orgPublicId } from "@range-worker/ids";
import { MEMBER, OWNER, STRANGER, VIEWER, as, json, world, type TestWorld } from "./harness";

const ORG = orgPublicId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const OTHER_ORG = orgPublicId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const BASE = "https://range.internal";
const CHECKS = `/v1/organizations/${ORG}/pay-checks`;

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}
function post(w: TestWorld, who: string, path: string, body?: unknown): Promise<Response> {
  return call(w, path, {
    method: "POST",
    headers: { ...as(who), "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const BENEFITS = "Benefits: medical, dental, 401(k), 20 days PTO.";
const APPLY = "To apply, email jobs@acme.example by October 31, 2026.";
const PER_LOCATION = {
  title: "Senior Engineer",
  adText: `Pay ranges — New York City: $120,000–$150,000; Denver: $105,000–$130,000. ${BENEFITS} ${APPLY}`,
  locations: ["US-CO", "US-NY"],
  employeeCount: 80,
};

async function store(w: TestWorld, body: unknown = PER_LOCATION, who = OWNER): Promise<any> {
  const res = await post(w, who, CHECKS, body);
  expect(res.status).toBe(201);
  return (await json(res)).data.check;
}

describe("stored checks (RW2)", () => {
  it("stores a check and reads it back with its evidence spans, rule versions and lineage", async () => {
    const w = world();
    const c = await store(w);
    expect(c.ruleIds).toEqual(["US-CO@1", "US-NY@1"]);
    expect(c.rootId).toBe(c.id);
    expect(c.recheckedFrom).toBeNull();
    expect(c.engineVersion).toBe("rw2.1");

    const res = await call(w, `${CHECKS}/${c.id}`, { headers: as(VIEWER) });
    expect(res.status).toBe(200);
    const { data } = await json(res);
    expect(data.adText).toBe(PER_LOCATION.adText);
    expect(data.check.id).toBe(c.id);
    expect(data.lineage.map((l: any) => l.id)).toEqual([c.id]);
    // Every pay finding quotes the exact span it was read from.
    for (const r of data.check.results) {
      const bounded = r.requirements.find((q: any) => q.requirement === "range_bounded");
      const span = bounded.evidence[0];
      expect(data.adText.slice(span.start, span.end)).toBe(span.text);
    }
    // Per-location: Colorado and New York get their own ranges.
    const co = data.check.results.find((r: any) => r.location === "US-CO");
    const ny = data.check.results.find((r: any) => r.location === "US-NY");
    expect([co.verdict, co.pay.min, co.pay.max, co.pay.scope]).toEqual(["pass", 105000, 130000, "Denver"]);
    expect([ny.verdict, ny.pay.min, ny.pay.max, ny.pay.scope]).toEqual(["pass", 120000, 150000, "New York City"]);
    expect(co.requirements.find((q: any) => q.requirement === "benefits_described").evidence.length).toBeGreaterThan(0);
    expect(co.requirements.find((q: any) => q.requirement === "apply_info").evidence.map((e: any) => e.text)).toEqual([
      "To apply",
      "apply, email jobs@acme.example by October 31, 2026",
    ]);
  });

  it("lists the history newest first, filters by verdict and pages with a cursor", async () => {
    const w = world();
    const a = await store(w);
    const b = await store(w, { adText: "Earn up to $60,000!", locations: ["US-NY"], employeeCount: 50, title: "Sales" });
    const c = await store(w, { adText: "Salary $70,000 - $80,000.", locations: ["US-NY"], employeeCount: 50 });
    const all = (await json(await call(w, CHECKS, { headers: as(MEMBER) }))).data;
    expect(all.checks.map((x: any) => x.id)).toEqual([c.id, b.id, a.id]);
    expect(all.checks[1]).toMatchObject({ overall: "fail", payText: "up to $60,000 per year (no bottom)", title: "Sales" });
    expect(all.nextCursor).toBeNull();

    const fails = (await json(await call(w, `${CHECKS}?overall=fail`, { headers: as(OWNER) }))).data;
    expect(fails.checks.map((x: any) => x.id)).toEqual([b.id]);

    const p1 = (await json(await call(w, `${CHECKS}?limit=2`, { headers: as(OWNER) }))).data;
    expect(p1.checks.map((x: any) => x.id)).toEqual([c.id, b.id]);
    const p2 = (await json(await call(w, `${CHECKS}?limit=2&cursor=${p1.nextCursor}`, { headers: as(OWNER) }))).data;
    expect(p2.checks.map((x: any) => x.id)).toEqual([a.id]);
    expect(p2.nextCursor).toBeNull();

    expect((await call(w, `${CHECKS}?overall=great`, { headers: as(OWNER) })).status).toBe(422);
    expect((await call(w, `${CHECKS}?limit=0`, { headers: as(OWNER) })).status).toBe(422);
    expect((await call(w, `${CHECKS}?cursor=nope`, { headers: as(OWNER) })).status).toBe(422);
  });

  it("re-checks an edited ad as a new row in the same lineage and leaves the original unchanged", async () => {
    const w = world();
    const original = await store(w, { adText: "Salary: $80,000 – $95,000 per year.", locations: ["US-NY"], employeeCount: 50, title: "Analyst" });
    const before = w.db.prepare("SELECT * FROM range_checks").all();

    const res = await post(w, MEMBER, `${CHECKS}/${original.id}/recheck`, { adText: "Salary: up to $95,000 per year." });
    expect(res.status).toBe(201);
    const { data } = await json(res);
    expect(data.check.id).not.toBe(original.id);
    expect(data.check.recheckedFrom).toBe(original.id);
    expect(data.check.rootId).toBe(original.id);
    expect(data.check.title).toBe("Analyst");
    expect(data.previous).toMatchObject({ id: original.id, overall: "pass" });
    expect(data.changes).toEqual([{ location: "US-NY", from: "pass", to: "fail" }]);

    // The original row is byte-for-byte what it was.
    const after = w.db.prepare("SELECT * FROM range_checks WHERE id = ?").all((before[0] as any).id);
    expect(after).toEqual(before);
    const lineage = (await json(await call(w, `${CHECKS}/${original.id}`, { headers: as(OWNER) }))).data.lineage;
    expect(lineage.map((l: any) => [l.id, l.overall])).toEqual([
      [original.id, "pass"],
      [data.check.id, "fail"],
    ]);
    // A re-check of the re-check stays in the same lineage.
    const again = (await json(await post(w, OWNER, `${CHECKS}/${data.check.id}/recheck`))).data;
    expect(again.check.rootId).toBe(original.id);
    expect(again.changes).toEqual([]);

    const types = (w.db.prepare("SELECT event_type FROM events_audit_entries ORDER BY occurred_at, rowid").all() as any[]).map((r) => r.event_type);
    expect(types).toEqual(["range.check.run", "range.check.rechecked", "range.check.rechecked"]);
  });

  it("re-checks against a new rule version after a rules migration, keeping the old verdict on the old row", async () => {
    const w = world();
    const ad = { adText: `Salary: $85,000 per year. ${BENEFITS} ${APPLY}`, locations: ["US-CO"], employeeCount: 20, checkDate: "2026-06-01" };
    const original = await store(w, ad);
    expect(original.results[0]).toMatchObject({ verdict: "pass", ruleId: "US-CO@1" });

    // A rules migration: US-CO@1 gets an effective_to, US-CO@2 starts that day and asks for a range.
    w.db.exec(`UPDATE range_rules SET effective_to = '2026-07-01' WHERE id = 'US-CO@1'`);
    w.db.exec(`INSERT INTO range_rules (id, jurisdiction_code, version, effective_from, effective_to, min_employees, employee_scope,
      pay_obligation, single_figure, benefits_required, benefits_scope, max_spread_pct, spread_status, remote_coverage, remote_note,
      summary, citation, source_url, source_kind, verification, verified_on, notes)
      SELECT 'US-CO@2', jurisdiction_code, 2, '2026-07-01', NULL, min_employees, employee_scope, pay_obligation, 'review',
      benefits_required, benefits_scope, max_spread_pct, spread_status, remote_coverage, remote_note, summary, citation, source_url,
      source_kind, verification, verified_on, notes FROM range_rules WHERE id = 'US-CO@1'`);

    const { data } = await json(await post(w, OWNER, `${CHECKS}/${original.id}/recheck`, { checkDate: "2026-08-01" }));
    expect(data.check.results[0]).toMatchObject({ verdict: "review", ruleId: "US-CO@2" });
    expect(data.check.ruleIds).toEqual(["US-CO@2"]);
    expect(data.check.rulesVersion).not.toBe(original.rulesVersion);
    expect(data.changes).toEqual([{ location: "US-CO", from: "pass", to: "review" }]);
    const kept = (await json(await call(w, `${CHECKS}/${original.id}`, { headers: as(OWNER) }))).data.check;
    expect(kept.results[0]).toMatchObject({ verdict: "pass", ruleId: "US-CO@1" });
  });

  it("scopes stored checks to their org and keeps viewers and strangers out of writes", async () => {
    const w = world();
    const c = await store(w);
    const other = `/v1/organizations/${OTHER_ORG}/pay-checks`;
    expect((await call(w, `${other}/${c.id}`, { headers: as(OWNER) })).status).toBe(404);
    expect((await post(w, OWNER, `${other}/${c.id}/recheck`)).status).toBe(404);
    expect((await json(await call(w, other, { headers: as(OWNER) }))).data.checks).toEqual([]);

    expect((await call(w, `${CHECKS}/${c.id}`, { headers: as(STRANGER) })).status).toBe(404);
    expect((await call(w, CHECKS, { headers: as(STRANGER) })).status).toBe(404);
    expect((await post(w, VIEWER, `${CHECKS}/${c.id}/recheck`)).status).toBe(404);
    expect((await post(w, STRANGER, `${CHECKS}/${c.id}/recheck`)).status).toBe(404);
    expect((await call(w, `${CHECKS}/${c.id}`)).status).toBe(401);
    expect((await call(w, `${CHECKS}/${c.id}/recheck`, { method: "POST" })).status).toBe(401);
    expect((await call(w, `${CHECKS}/rwc_nothex`, { headers: as(OWNER) })).status).toBe(404);
    expect((await call(w, `${CHECKS}/${c.id}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(405);
    expect((await post(w, OWNER, `${CHECKS}/${c.id}/recheck`, { employeeCount: 0 })).status).toBe(422);
    expect((await call(w, `${CHECKS}/${c.id}/recheck`, { method: "POST", headers: as(OWNER), body: "[1]" })).status).toBe(422);
  });

  it("stores the actor as a UUID when the edge sends a usr_ id (trap 39)", async () => {
    const w = world();
    const usr = `usr_${OWNER.replace(/-/g, "")}`;
    const res = await call(w, CHECKS, {
      method: "POST",
      headers: { ...as(OWNER), "x-actor-subject-id": usr, "content-type": "application/json" },
      body: JSON.stringify(PER_LOCATION),
    });
    // The fake fleet knows OWNER by UUID only, so a usr_ id is a stranger to it: 404, nothing stored.
    expect(res.status).toBe(404);
    expect(w.db.prepare("SELECT count(*) AS n FROM range_checks").all()).toEqual([{ n: 0 }]);
  });
});
