# rangewise-pay-range-compliance (RW) — Implementation status

As-built ≠ intent. This file records what actually shipped, and every place
the code departed from `design.md`.

| Milestone | State | PR |
|---|---|---|
| RW0 — the spec | ✅ merged 85b65da; docs pushed with `orun spec push` | #9 |
| RW1 — the jurisdiction rules table and a manual check | in review | RW-2 |
| RW2 — the deterministic check engine | | |
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
