/* eslint-disable @typescript-eslint/no-explicit-any -- test payloads are asserted field by field */
import { route } from "@range-worker/router";
import { orgPublicId } from "@range-worker/ids";
import { runScheduledSweep } from "@range-worker/index";
import { EMAILS, MEMBER, OWNER, STRANGER, VIEWER, as, json, world, type TestWorld } from "./harness";

const ORG = orgPublicId("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const OTHER_ORG = orgPublicId("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const BASE = "https://range.internal";
const ADS = `/v1/organizations/${ORG}/watched-ads`;
const SWEEP = `${ADS}/sweep`;
const REPORT = `/v1/organizations/${ORG}/reports/compliance`;

const BENEFITS = "Benefits: medical, dental, 401(k), 20 days PTO.";
const APPLY = "To apply, email jobs@acme.example by December 31, 2026.";
const GOOD = `Salary: $85,000 – $95,000 per year. ${BENEFITS} ${APPLY}`;

interface Sent {
  templateKey: string;
  recipient: { address: string };
  idempotencyKey: string;
  templateData: Record<string, string>;
}

function withNotifications(w: TestWorld, ok = true): Sent[] {
  const sent: Sent[] = [];
  (w.env as any).NOTIFICATIONS_WORKER = {
    async fetch(_url: string, init: RequestInit) {
      sent.push(JSON.parse(String(init.body)) as Sent);
      return ok ? Response.json({ data: { notification: { id: `ntf_${sent.length}`, status: "queued" } } }, { status: 202 }) : new Response("no", { status: 500 });
    },
  };
  return sent;
}

function call(w: TestWorld, path: string, init: RequestInit = {}): Promise<Response> {
  return route(new Request(`${BASE}${path}`, init), w.env);
}
function send(w: TestWorld, who: string, method: string, path: string, body?: unknown): Promise<Response> {
  return call(w, path, { method, headers: { ...as(who), "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function save(w: TestWorld, body: unknown, who = OWNER): Promise<any> {
  const res = await send(w, who, "POST", ADS, body);
  expect(res.status).toBe(201);
  return (await json(res)).data.ad;
}
async function sweep(w: TestWorld, who = OWNER): Promise<any> {
  const res = await send(w, who, "POST", SWEEP);
  expect(res.status).toBe(200);
  return (await json(res)).data;
}
const count = (w: TestWorld, table: string): number => (w.db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
const today = (): string => new Date().toISOString().slice(0, 10);

describe("saved ads and the sweep (RW3)", () => {
  it("scans a new saved ad once, however many sweeps and ticks run that day", async () => {
    const w = world();
    withNotifications(w);
    const ad = await save(w, { title: "Analyst", adText: GOOD, locations: ["US-CO", "US-NY"], employeeCount: 40 });
    expect(ad).toMatchObject({ sourceKind: "text", revision: 1, lastCheckId: null, nextDueOn: today(), recruiterEmail: EMAILS[OWNER] });
    expect(ad.id).toMatch(/^rwa_[0-9a-f]{32}$/);

    const first = await sweep(w);
    expect(first.scanned).toHaveLength(1);
    expect(first.scanned[0]).toMatchObject({ adId: ad.id, reason: "new", status: "checked", overall: "pass", alert: null });
    const second = await sweep(w, MEMBER);
    expect(second.scanned).toHaveLength(0);
    await runScheduledSweep(w.env, Date.now());
    expect(count(w, "range_scan_runs")).toBe(1);
    expect(count(w, "range_checks")).toBe(1);

    const detail = (await json(await call(w, `${ADS}/${ad.id}`, { headers: as(VIEWER) }))).data;
    expect(detail.ad).toMatchObject({ lastOverall: "pass", lastCheckId: first.scanned[0].checkId });
    expect(detail.ad.nextDueOn > today()).toBe(true);
    expect(detail.lastCheck.results.map((r: any) => [r.location, r.verdict])).toEqual([
      ["US-CO", "pass"],
      ["US-NY", "pass"],
    ]);
  });

  it("re-checks weekly: a week on, the ad is due once more", async () => {
    const w = world();
    withNotifications(w);
    const ad = await save(w, { adText: GOOD, locations: ["US-NY"], employeeCount: 40 });
    await sweep(w);
    // A week passes.
    w.db.exec(`UPDATE range_watched_ads SET next_due_on = '${today()}'`);
    const week = await sweep(w);
    expect(week.scanned.map((s: any) => [s.adId, s.reason])).toEqual([[ad.id, "weekly"]]);
    expect((await sweep(w)).scanned).toHaveLength(0);
    // The weekly re-check continues the ad's lineage.
    const rows = w.db.prepare("SELECT rechecked_from, root_id FROM range_checks ORDER BY created_at").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[1].root_id).toBe(rows[0].root_id);
  });

  it("alerts the recruiter exactly once when an edit makes the verdict worse; the notifications worker accepts it", async () => {
    const w = world();
    const sent = withNotifications(w);
    const ad = await save(w, { title: "Account Executive", adText: GOOD, locations: ["US-CO", "US-NY"], employeeCount: 40 }, MEMBER);
    await sweep(w);

    const edited = await send(w, OWNER, "PATCH", `${ADS}/${ad.id}`, { adText: `Earn up to $95,000! ${BENEFITS} ${APPLY}` });
    expect(edited.status).toBe(200);
    expect((await json(edited)).data.ad).toMatchObject({ revision: 2, nextDueOn: today() });

    const s = await sweep(w);
    expect(s.scanned).toHaveLength(1);
    expect(s.scanned[0]).toMatchObject({ reason: "edited", overall: "fail" });
    expect(s.scanned[0].alert).toMatchObject({ status: "accepted" });
    expect(s.scanned[0].alert.worsened).toEqual([
      { location: "US-CO", from: "pass", to: "fail" },
      { location: "US-NY", from: "pass", to: "fail" },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ templateKey: "range.ad.worsened", recipient: { address: EMAILS[MEMBER] } });
    expect(sent[0]!.templateData.changes).toContain("Colorado: Passes → Fails");
    expect(sent[0]!.idempotencyKey).toContain("range.ad.worsened");

    // Nothing more to do today; a manual scan of the same (still failing) ad is not a new worsening.
    expect((await sweep(w)).scanned).toHaveLength(0);
    const manual = (await json(await send(w, OWNER, "POST", `${ADS}/${ad.id}/scan`))).data;
    expect(manual.outcome).toMatchObject({ reason: "manual", overall: "fail", alert: null });
    expect(sent).toHaveLength(1);
    expect(count(w, "range_alerts")).toBe(1);

    const detail = (await json(await call(w, `${ADS}/${ad.id}`, { headers: as(OWNER) }))).data;
    expect(detail.alerts).toHaveLength(1);
    expect(detail.alerts[0]).toMatchObject({ status: "accepted", previousOverall: "pass", overall: "fail", recipient: EMAILS[MEMBER] });
    const types = (w.db.prepare("SELECT event_type FROM events_audit_entries ORDER BY occurred_at, rowid").all() as any[]).map((r) => r.event_type);
    expect(types.filter((t) => t === "range.ad.alerted")).toHaveLength(1);
    expect(types).toContain("range.ad.saved");
    expect(types).toContain("range.ad.updated");
  });

  it("re-checks at the next tick after a rule migration, and alerts once", async () => {
    const w = world();
    const sent = withNotifications(w);
    const ad = await save(w, { adText: `Salary: $85,000 per year. ${BENEFITS} ${APPLY}`, locations: ["US-CO"], employeeCount: 40 });
    expect((await sweep(w)).scanned[0]).toMatchObject({ overall: "pass" });
    expect((await sweep(w)).scanned).toHaveLength(0);

    // The rules migration: US-CO@1 ends today, US-CO@2 (which asks for a range) starts today.
    const t = today();
    w.db.exec(`UPDATE range_rules SET effective_to = '${t}' WHERE id = 'US-CO@1'`);
    w.db.exec(`INSERT INTO range_rules (id, jurisdiction_code, version, effective_from, effective_to, min_employees, employee_scope,
      pay_obligation, single_figure, benefits_required, benefits_scope, max_spread_pct, spread_status, remote_coverage, remote_note,
      summary, citation, source_url, source_kind, verification, verified_on, notes)
      SELECT 'US-CO@2', jurisdiction_code, 2, '${t}', NULL, min_employees, employee_scope, pay_obligation, 'review',
      benefits_required, benefits_scope, max_spread_pct, spread_status, remote_coverage, remote_note, summary, citation, source_url,
      source_kind, verification, verified_on, notes FROM range_rules WHERE id = 'US-CO@1'`);

    await runScheduledSweep(w.env, Date.now());
    const runs = w.db.prepare("SELECT reason, triggered_by, status FROM range_scan_runs ORDER BY started_at").all() as any[];
    expect(runs.map((r) => [r.reason, r.triggered_by, r.status])).toEqual([
      ["new", "sweep", "checked"],
      ["rules_changed", "cron", "checked"],
    ]);
    expect(sent).toHaveLength(1);
    const detail = (await json(await call(w, `${ADS}/${ad.id}`, { headers: as(OWNER) }))).data;
    expect(detail.lastCheck.results[0]).toMatchObject({ verdict: "review", ruleId: "US-CO@2" });
    expect(detail.alerts[0].worsened).toEqual([{ location: "US-CO", from: "pass", to: "review" }]);
    // The next tick (or a sweep) does nothing more.
    expect((await sweep(w)).scanned).toHaveLength(0);
    await runScheduledSweep(w.env, Date.now());
    expect(sent).toHaveLength(1);
  });

  it("records a failed send as a failed alert, still only once", async () => {
    const w = world();
    const sent = withNotifications(w, false);
    const ad = await save(w, { adText: GOOD, locations: ["US-NY"], employeeCount: 40 });
    await sweep(w);
    await send(w, OWNER, "PATCH", `${ADS}/${ad.id}`, { adText: "Competitive pay." });
    const s = await sweep(w);
    expect(s.scanned[0].alert).toMatchObject({ status: "failed" });
    expect(sent).toHaveLength(1);
  });

  it("fetches a URL ad at each scan, and refuses private, loopback, non-https and odd-port URLs at save", async () => {
    const w = world();
    withNotifications(w);
    const realFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string) => {
      fetched.push(url);
      return new Response(`<html><body><h1>Analyst</h1><p>Pay: $30–$36 per hour.</p><script>x</script></body></html>`, { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    try {
      const ad = await save(w, { title: "Careers page", sourceUrl: "https://careers.acme.example/jobs/7", locations: ["US-NY"], employeeCount: 40 });
      expect(ad).toMatchObject({ sourceKind: "url", sourceUrl: "https://careers.acme.example/jobs/7", adText: "" });
      const s = await sweep(w);
      expect(s.scanned[0]).toMatchObject({ status: "checked", overall: "pass" });
      expect(fetched).toEqual(["https://careers.acme.example/jobs/7"]);
      const detail = (await json(await call(w, `${ADS}/${ad.id}`, { headers: as(OWNER) }))).data;
      expect(detail.ad.adText).toContain("Pay: $30–$36 per hour.");
      expect(detail.ad.adText).not.toContain("<");
      expect(detail.ad.lastFetch).toMatchObject({ status: "ok" });
      expect(detail.lastCheck.extracted.pay).toMatchObject({ kind: "range", min: 30, max: 36, period: "hour" });
    } finally {
      globalThis.fetch = realFetch;
    }

    for (const bad of [
      "http://careers.acme.example/jobs/7",
      "https://127.0.0.1/jobs",
      "https://localhost/jobs",
      "https://10.1.2.3/",
      "https://169.254.169.254/latest/meta-data",
      "https://[::1]/",
      "https://careers.acme.example:8080/",
    ]) {
      const res = await send(w, OWNER, "POST", ADS, { sourceUrl: bad, locations: ["US-NY"], employeeCount: 40 });
      expect([bad, res.status]).toEqual([bad, 422]);
      expect(Object.keys((await json(res)).error.details.fields)).toContain("sourceUrl");
    }
    expect((await send(w, OWNER, "POST", ADS, { adText: GOOD, sourceUrl: "https://careers.acme.example/x", locations: ["US-NY"], employeeCount: 40 })).status).toBe(422);
    expect((await send(w, OWNER, "POST", ADS, { locations: ["US-NY"], employeeCount: 40 })).status).toBe(422);
  });

  it("records a page that is too large as a failed scan, not retried the same day", async () => {
    const w = world();
    withNotifications(w);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("x", { headers: { "content-type": "text/html", "content-length": "5000000" } })) as unknown as typeof fetch;
    try {
      const ad = await save(w, { sourceUrl: "https://careers.acme.example/huge", locations: ["US-NY"], employeeCount: 40 });
      const s = await sweep(w);
      expect(s.scanned[0]).toMatchObject({ status: "failed", checkId: null });
      expect(s.scanned[0].error).toContain("larger than 1000000 bytes");
      const again = await sweep(w);
      expect(again.scanned).toHaveLength(0);
      expect(again.alreadyClaimed).toBe(1);
      const detail = (await json(await call(w, `${ADS}/${ad.id}`, { headers: as(OWNER) }))).data;
      expect(detail.ad.lastFetch).toMatchObject({ status: "too_large" });
      expect(detail.ad.lastCheckId).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("reports every saved ad's latest verdict as JSON and CSV", async () => {
    const w = world();
    withNotifications(w);
    const a = await save(w, { title: "Analyst", adText: GOOD, locations: ["US-CO", "US-NY"], employeeCount: 40 });
    const b = await save(w, { title: "=HYPERLINK(\"https://evil.example\")", adText: "Earn up to $60,000!", locations: ["US-NY"], employeeCount: 40 });
    await sweep(w);
    const c = await save(w, { title: "Not yet scanned", adText: GOOD, locations: ["US-WA"], employeeCount: 40 });

    const report = (await json(await call(w, REPORT, { headers: as(VIEWER) }))).data;
    expect(report.ads.map((r: any) => [r.adId, r.overall])).toEqual([
      [a.id, "pass"],
      [b.id, "fail"],
      [c.id, "pending"],
    ]);
    expect(report.totals).toMatchObject({ pass: 1, fail: 1, pending: 1 });
    expect(report.ads[1].jurisdictions[0]).toMatchObject({ location: "US-NY", verdict: "fail", ruleId: "US-NY@1", deciding: "range_bounded" });

    const csv = await call(w, `${REPORT}?format=csv`, { headers: as(OWNER) });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    const lines = (await csv.text()).trim().split("\r\n");
    expect(lines[0]).toBe('"ad_id","title","source","last_checked_at","overall","location","jurisdiction","verdict","rule_id","deciding_rule","explanation"');
    expect(lines).toHaveLength(1 + 2 + 1 + 1);
    expect(lines.find((l) => l.includes(b.id))).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect((await call(w, `${REPORT}?format=xml`, { headers: as(OWNER) })).status).toBe(422);
  });

  it("keeps saved ads inside their org and writes to writers", async () => {
    const w = world();
    withNotifications(w);
    const ad = await save(w, { adText: GOOD, locations: ["US-NY"], employeeCount: 40 });
    const other = `/v1/organizations/${OTHER_ORG}/watched-ads`;
    expect((await call(w, `${other}/${ad.id}`, { headers: as(OWNER) })).status).toBe(404);
    expect((await send(w, OWNER, "PATCH", `${other}/${ad.id}`, { title: "x" })).status).toBe(404);
    expect((await send(w, OWNER, "POST", `${other}/${ad.id}/scan`)).status).toBe(404);
    expect((await json(await send(w, OWNER, "POST", `${other}/sweep`))).data.scanned).toEqual([]);

    expect((await call(w, ADS, { headers: as(VIEWER) })).status).toBe(200);
    expect((await send(w, VIEWER, "POST", ADS, { adText: GOOD, locations: ["US-NY"], employeeCount: 40 })).status).toBe(404);
    expect((await send(w, VIEWER, "PATCH", `${ADS}/${ad.id}`, { active: false })).status).toBe(404);
    expect((await send(w, VIEWER, "POST", `${ADS}/${ad.id}/scan`)).status).toBe(404);
    expect((await send(w, VIEWER, "POST", SWEEP)).status).toBe(404);
    for (const [method, path] of [
      ["GET", ADS],
      ["GET", `${ADS}/${ad.id}`],
      ["GET", REPORT],
      ["POST", SWEEP],
    ] as const) {
      expect((await call(w, path, { method, headers: as(STRANGER) })).status).toBe(404);
      expect((await call(w, path, { method })).status).toBe(401);
    }
    expect((await call(w, `${ADS}/${ad.id}`, { method: "DELETE", headers: as(OWNER) })).status).toBe(405);

    // Pausing is not an edit of what is checked: the revision stays, and a paused ad is not swept.
    const paused = (await json(await send(w, OWNER, "PATCH", `${ADS}/${ad.id}`, { active: false }))).data.ad;
    expect(paused).toMatchObject({ active: false, revision: 1 });
    expect((await sweep(w)).considered).toBe(0);
    expect((await send(w, OWNER, "PATCH", `${ADS}/${ad.id}`, { sourceUrl: "https://careers.acme.example/x" })).status).toBe(422);
  });
});
