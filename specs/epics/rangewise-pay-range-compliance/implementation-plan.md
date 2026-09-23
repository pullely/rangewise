# rangewise-pay-range-compliance — implementation plan

Milestones land in order. Each one is made of one or more tasks, each task is
one pull request, and each pull request is landed with `orun pr land`. A
milestone is marked ✅ here when its "done when" list is true, and it is
recorded in `IMPLEMENTATION-STATUS.md`.

A workspace can mint only 200 brokered credentials per rolling 24 hours, and
every CI job that deploys spends one. The bootstrap, this spec and RW1 fit into
one day. RW2 and RW3 land the next day. Each milestone's tests run green
locally before its pull request opens, because every push to a pull request
spends mints.

## RW0 — the spec ✅

This doc set, merged to `main` and attached to the epic with `orun spec push`.

**Done when**
- the five documents are on `main`
- `orun spec list --epic rangewise-pay-range-compliance` shows them

## RW1 — the jurisdiction rules table and a manual check

This milestone builds the `range` bounded context end to end:

- Migration `200_range_rules`: `range_jurisdictions` and `range_rules`, with
  their CHECKs, seeded with the nine verified rows of design §0.2. Each row
  carries its citation, source URL, source kind and verification date.
- `packages/db/src/range`: a read-only repository (`listJurisdictions`,
  `listRules`).
- `packages/contracts/src/range.ts`: the verdict, requirement and remote
  enums, the location-code grammar, the wire types and labels. A `RangeClient`
  in the SDK.
- `apps/range-worker`: `GET …/pay-rules` and `POST …/pay-checks`; the engine
  in `src/engine/` (extract, benefits, evaluate); membership plus policy;
  `range.check.run` audit events. It depends on `db-migrate`, so its migration
  always deploys first.
- The api-edge range facade, its binding and its `range` rate-limit family.
- `range.read` (every role) and `range.write` (owner, admin, builder) in the
  policy engine.
- `range-worker` on the notifications allow-list (used from RW3), and the
  `pay_check` subject prefix `rwc_` in events-worker.
- The console "Check an ad" and "Pay rules" pages.
- The Solo profile is turned off.

RW1 also carries two baseline fixes. Every cirrus product needs them before its
first audited write works on D1:

- the tested `cirrus-d1-fix.patch`, which fixes events/audit and membership SQL
  that SQLite cannot run. Without it, no organization can be created.
- a redeploy marker on every worker's `component.yaml`, because a
  shared-package change does not redeploy the workers that bundle it.

**Done when**
- migration `200_range_rules` is applied on stage and prod, and `GET
  …/pay-rules` on stage lists the nine seeded rules, each with a source URL and
  `verification: verified`
- on stage a signed-in user creates an organization (201)
- a check of an ad with "$80,000 – $100,000 per year" plus health, 401(k) and
  PTO benefits, located in Colorado and New York, headcount 50, **passes** both
- a check of an ad with "up to $60,000" and no benefits, remote in the US,
  headcount 50, **fails** Colorado with the deciding rule
  `range_bounded` (open-ended) and the citation `C.R.S. § 8-5-201(2)`. New York
  and New Jersey (remote coverage `covered`) fail too. The five states whose
  remote coverage is `unsettled` get `review`, and the EU row is not checked
- the same check at headcount 3 gives New York `not_applicable`, naming the
  threshold of 4
- a second signed-in user who is not a member gets 404 on both routes
- on prod `/health` is 200, both routes answer 401 unauthenticated, and
  `DEBUG_DELIVERY` is false

## RW2 — the deterministic check engine

- Migration `210_range_checks` (`range_checks`, design §1.3).
- The full parser, replacing RW1's first cut:
  - every pay statement, with its text span
  - US and EU number formats (`80,000`, `80.000`, `80 000`, `80k`, `80K`,
    `€80.000,00`) and currency codes before or after
  - per-location ranges mapped to jurisdictions
  - hourly, daily, weekly, monthly and annual, normalised to annual (2,080
    hours, 260 days, 52 weeks, 12 months) for comparison
  - "up to", "from", "+", "starting at", single figures
  - non-pay money ignored: funding rounds, revenue, 401(k) match percentages,
    sign-on bonuses as a separate finding
  - vague pay words flagged
  - "how and when to apply" (Colorado) as a `review` finding
- A labelled fixture set of at least 60 real-world ad snippets. The parser's
  verdicts must match all of them. This is the brief's "false-flag rate under
  2%" made into a test.
- Checks are stored with evidence (span start and end, the quoted text), the
  rule ids and versions used, and the rules fingerprint. There are history,
  detail and re-check routes, and the console gets history and detail pages.
- The console check form keeps the last inputs per viewer.

**Done when**
- the fixture suite passes at 100 percent in CI
- on stage a stored check lists the exact span each finding came from and
  `US-CO@1` among the rules used
- a re-check of a stored check after a rule migration gives the new verdict
  and leaves the original row unchanged
- a per-location ad gives Colorado and New York their own ranges

## RW3 — the weekly scan and alerts

- Migration `220_range_watch` (saved ads, scan runs, alert ledger).
- A saved ad is either pasted text or a public careers-page URL. URLs are
  fetched by the worker with a 1 MB cap and a 10 s timeout, and the HTML is
  stripped to text.
- `scheduled()` with `triggers.crons: ["0 6 * * *"]`. Each tick re-checks saved
  ads that are due (weekly), plus every saved ad whose jurisdictions have a
  rule version newer than the ad's last check. Re-checks are claimed with
  `INSERT … ON CONFLICT DO NOTHING RETURNING id`.
- The `range.ad.worsened` email to the ad's recruiter, sent once per worsening
  (the alert ledger is UNIQUE per ad and check).
- A compliance report per org: each saved ad's latest verdict per
  jurisdiction, as JSON and CSV.
- The console gets saved ads and the report.
- Mark the README `✅ Shipped` only after this milestone's deploy run on `main`
  is fully green.

**Done when**
- on stage a saved ad re-checked across two ticks is scanned once per due
  window
- after a rule migration the next tick re-checks it, and its recruiter gets
  exactly one alert
- a URL ad is fetched and checked
- the report lists every saved ad's latest verdict

## Sequencing

RW1 is independent of everything after it. RW2 replaces RW1's extractor
behind the same `extract()` signature and adds storage. RW1's response shape
is kept, and extended with fields, never changed. RW3 needs RW2's stored
checks. Adding jurisdiction rows (the unverified states, EU member states) is
a separate migration each time, `2xx_range_rules_<code>`, and it can land
between any two milestones.
