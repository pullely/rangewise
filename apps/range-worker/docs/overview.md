# range-worker — overview

Owns the `range` bounded context. In RW1 that is the **pay-transparency rules
table** (which jurisdictions require pay in job ads, from when, for which
employer sizes, what counts as a compliant range, whether benefits must be
described, each row with its citation, source and verification date) and the
**manual check**: paste an ad, name its locations (or mark it remote), give the
employer's headcount, and get a verdict per jurisdiction with the rule that
decided it. RW2 stores checks with their evidence; RW3 adds saved ads, the
weekly scan and alerts.

The invariants this worker holds:

- the rules table is read-only here — rules change only through migrations, as
  a new version with its own `effective_from`;
- a verdict is a pure function of the ad text, the stated facts and the rule
  version in force on the check date (`src/engine/`, no I/O, unit-tested);
- only verified rows are seeded; a place without a row is `not_covered`, never
  "no law";
- the EU Directive row is advisory: it can give `review`, never `fail`;
- the audit event for a check carries verdicts and the ad's SHA-256, never the
  ad text;
- (RW2) a stored check is never edited: a re-check is a new row in the same
  lineage (`root_id`), so the verdict an ad got on a day stays exactly as given;
- (RW2) every finding quotes the span of the ad it was read from, and the
  parser's labelled set (`tests/range-worker/fixtures/labelled-ads.json`) must
  pass at 100 percent.

## What it serves

| Route | Who |
|---|---|
| `GET /v1/organizations/{org}/pay-rules` | `range.read` (every role) |
| `POST /v1/organizations/{org}/pay-checks` (201, stored) | `range.write` (owner, admin, builder) |
| `GET /v1/organizations/{org}/pay-checks` (history; `?overall=`, `?limit=`, `?cursor=`) | `range.read` |
| `GET /v1/organizations/{org}/pay-checks/{rwc}` (detail, ad text, lineage) | `range.read` |
| `POST /v1/organizations/{org}/pay-checks/{rwc}/recheck` (optionally edited) | `range.write` |
