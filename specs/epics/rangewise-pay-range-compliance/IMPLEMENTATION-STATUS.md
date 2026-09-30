# rangewise-pay-range-compliance (RW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| RW0 — the spec | ✅ merged 85b65da; docs pushed with `orun spec push` | #9 |
| RW1 — the jurisdiction rules table and a manual check | ✅ merged e3ff164; `main` deploy run 35922168119 green 66/66; stage smoke green (org 201, pass, fail on `range_bounded` citing C.R.S. § 8-5-201(2), NY `not_applicable` at 3, non-member 404); prod `/health` 200, routes 401, `DEBUG_DELIVERY` false | #10 (RW-2) |
| RW2 — the deterministic check engine | in review | RW-3 |
| RW3 — the weekly scan and alerts | | |

## Departures from the design

### RW1

- **From the baseline (runbook trap 16):** RW1 applies the portfolio's tested
  `cirrus-d1-fix.patch`. The cirrus baseline's `appendEventWithAudit` is a
  Postgres data-modifying CTE, and its membership writes use SQL that SQLite
  cannot parse, so organization create answers 503 on D1 without the patch.
  `range-worker` writes its own audit rows with portable SQL either way.
- **From the baseline (trap 17):** every worker's `component.yaml` carries a
  redeploy marker, because `packages/db`, `packages/policy-engine` and
  `packages/contracts` changed and a worker only redeploys when its own
  component changes.
- **Seeds are `ON CONFLICT DO NOTHING`.** The baseline's SQLite schema test
  applies every migration twice. A plain seed `INSERT` fails the second time
  with `UNIQUE constraint failed`. `INSERT OR IGNORE` was rejected, because it
  would also silently skip a row that fails a CHECK.
- **Benefit filler gives `review` for every rule that requires benefits**, not
  only Colorado and New Jersey. Every such rule asks for a general description
  of *all* benefits (design §2.2, step 7, updated).
- **`POST …/pay-checks` answers 200, not 201.** RW1 stores nothing. The check id
  (`rwc_…`) is minted and used as the audit subject, so RW2's stored rows line
  up with RW1's audit trail.
- `range-worker` is on the notifications allow-list already, but has no
  `NOTIFICATIONS_WORKER` binding until RW3 needs one.

### RW2

- **`POST …/pay-checks` answers 201, not 200.** RW2 stores the check, so the
  call creates a resource. The response body is RW1's, extended with
  `ruleIds`, `recheckedFrom`, `rootId` and `engineVersion`.
- **Colorado's "how and when to apply" is a requirement (`apply_info`) that
  gives `review` when Rangewise cannot find both**, as design §0.2 planned. It
  is keyed off the jurisdiction in `src/engine/evaluate.ts`, not a rules-table
  column: adding a column would edit the seeded `US-CO@1` row, which §0.1
  forbids, and the source gives no separate effective date for it. A Colorado
  ad without application instructions and a deadline (or "ongoing basis" for
  an evergreen role) now gets `review` where RW1 said `pass`; RW1's stage smoke
  ad carries "To apply, email … by <date>" from RW2 on. "Open until filled" is
  reported as not a deadline, per INFO #9A §3.
- **A new requirement, `pay_currency`:** pay stated in a currency other than
  US dollars for a US jurisdiction gets `review` (Rangewise cannot tell whether
  it is the pay for that role). The EU row accepts the euro and the seven
  non-euro member-state currencies; being advisory, it never fails either way.
  `ExtractedPay.currency` widened from `USD | EUR | GBP` to any ISO code.
- **Per-location pay:** a statement labelled with a place ("Denver: …",
  "… in New York City", "CA/WA: …") applies to that place's jurisdiction; an
  unlabelled statement applies everywhere. When the ad gives pay only for
  other places, the jurisdiction gets `pay_disclosed` failed, naming the places
  it does cover. Places outside the US and EU are scoped as `XX-…`, so a
  "London: £60k" range is never read as a US jurisdiction's pay.
- **Period inference:** with no period written, ≥ 10,000 reads as a year and
  < 200 as an hour (`periodInferred: true`); anything between is left unknown
  and not annualised. Hourly pay is annualised with the ad's weekly hours when
  it states them ("20 hours per week"), otherwise 2,080 hours.
- **The labelled set is 73 snippets and 86 verdicts** (plan: at least 60),
  including the adversarial cases (a salary range next to a signing bonus,
  "competitive", hourly with weekly hours, CAD/GBP/EUR for US roles, "up to"
  with no floor, OTE, tips — CDLE INFO #9A's own "$18 per hour plus $5-$10
  hourly tips" example — funding, revenue and 401(k) dollars). 86/86 on the
  first green run.
- **Re-check semantics:** the body may change any field of the original
  request (an edited ad); omitted fields are the stored check's, and
  `checkDate` defaults to today, so a bare re-check applies today's rules. The
  response lists the per-jurisdiction verdict `changes`. Audit type
  `range.check.rechecked`.
- **A rules migration on stage can't be staged on demand**, so "a re-check
  after a rule migration gives the new verdict and keeps the old row" is
  proven in `tests/range-worker` (a real `US-CO@2` row over node:sqlite); the
  stage smoke proves the same path with an edited ad.
- **Console:** check history (filter by verdict) on the Check an ad page, a
  detail page per check (evidence, ad text, lineage, re-check and edit-and-
  re-check), and the form remembers the last locations, remote area and
  headcount per viewer in browser storage.

