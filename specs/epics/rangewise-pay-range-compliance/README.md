# Epic: rangewise-pay-range-compliance (RW)

**Pay-transparency laws now differ by state and by month. Colorado has required
pay in every job posting since 2021, New York since September 2023, Maryland
since October 2024, Minnesota since January 2025 and New Jersey since June 2025.
The EU Pay Transparency Directive's transposition deadline passed on 7 June
2026, and member states are transposing it on their own dates. A 20-to-500-person
company or a recruiting agency that posts one ad for a role open in several
places has no cheap way to know, before the ad goes live, whether it breaks a
rule somewhere. Pay-equity platforms are priced for HR analytics. This epic
builds the check itself, and treats the rules as the product: a maintained,
versioned, cited rules table (which jurisdictions require pay in the ad, from
when, for which employer sizes, what counts as a compliant range, whether
benefits must be described), and a deterministic engine that reads the pay out
of an ad and applies each jurisdiction's rule. Every verdict names the rule
that decided it and the statute or official guidance behind that rule. The one
design idea: a verdict is a pure function of three inputs, the ad text, the
facts the user states (locations, remote, headcount, date) and a rule version.
Nothing is guessed by a model, so the same inputs always give the same answer
and every answer can be traced to a citation.**

Rangewise is for HR teams at companies with 20 to 500 staff, and for recruiting
agencies, that hire across several US states or EU countries. A recruiter pastes
an ad, picks where the role can be done (or marks it remote) and states the
employer's headcount. Rangewise answers with pass, fail or review for each
jurisdiction, and says which rule decided it. Later milestones store every check
with its evidence, re-check saved ads when a rule changes, and email the
recruiter when a live ad stops complying.

## Status

| Field | Value |
|-------|-------|
| Status | Draft |
| Cluster | **RW** (RW0–RW3) |
| Owner(s) | `apps/range-worker` (the rules table reader, the check engine, the stored checks, the weekly scan) · `apps/api-edge` (the facade) · `packages/db` (migrations `200`–`220`) · `packages/contracts` + `packages/sdk` (the wire) · `apps/notifications-worker` (the alert templates, RW3) · `apps/web-console-next` (the surface) |
| Builds on | `cirrus baseline-v12`: organizations as employers or agencies, members as recruiters, the policy engine for who may check, `notifications-worker` for alerts, the audit trail in `events-worker`, api-edge rate limiting, cron triggers |
| Changes | Adds one bounded context (`range`), one worker, one cron trigger (RW3). Turns the Solo profile off, because a hiring team has several recruiters and an agency serves several clients. Every baseline context is reused, and none is changed beyond new actions, templates and subject prefixes. |
| Decisions locked | (1) The rules table is data in D1, seeded and changed only by migrations, never edited through the API. A rule change is a new *version* of a jurisdiction's rule with its own `effective_from`, so a check can be replayed against the rules that applied on its date. (2) A jurisdiction is seeded only when its citation was read from the primary text or the official agency's guidance. An unverifiable jurisdiction is an open risk, not a guessed row. (3) The check is deterministic: a regex-and-rules engine with unit tests, no LLM. (4) Verdicts are `pass`, `fail`, `review` (a human must decide: an unsettled point of law), `not_applicable` (the employer is below the size threshold), `not_in_force` (the rule starts after the check date) and `not_covered` (Rangewise has no rule for that place). The console never says "compliant with the law". It says "passes Rangewise's rule for X, as cited". (5) The EU Directive binds member states, not employers. Its row gives advice and never fails an ad. National transposition rows come later. |
| Gate | RW1 is the first user-visible change (the rules table and a manual check). RW2 makes the parser robust and stores checks with their evidence. RW3 keeps saved ads checked without anyone pressing a button. |
| Shipped as | |

## Read order

1. `design.md`: the rules and their citations, the resources, the engine, the routes, the surfaces, and what is out of scope
2. `implementation-plan.md`: the milestones and what "done" means for each
3. `risks-and-open-questions.md`: what could go wrong, which citations could not be verified, and what was decided
4. `IMPLEMENTATION-STATUS.md`: what actually shipped, kept separate from intent

## Milestones at a glance

| Milestone | What it lands | Done when |
|---|---|---|
| RW0 — the spec | this doc set | merged and pushed with `orun spec push` |
| RW1 — the jurisdiction rules table and a manual check | the `range` context (migration `200_range_rules` seeding 8 US jurisdictions and the EU Directive, every row cited), `range-worker`, `GET …/pay-rules`, `POST …/pay-checks` (paste an ad, its locations, remote, headcount and date; get a verdict per jurisdiction with the deciding rule and its citation), a first pay extractor (one range or figure, `$ € £`, hourly/annual, "up to", "from"), a benefits-mention check, audit events, the console Rules and Check an ad pages | on stage a signed-in user creates an org (201), runs a check that passes, runs one that fails with the deciding rule and citation named, and a non-member gets 404 |
| RW2 — the deterministic check engine | `210_range_checks`, the full tested parser (several ranges per ad, per-location ranges, `k`/thousands/decimal formats in US and EU style, hourly/daily/weekly/monthly/annual with normalisation, "up to", "from", "+", single figures, non-pay money such as funding rounds and 401(k) matches ignored, vague pay words flagged), stored checks with evidence spans and the rule versions they used, check history and detail, re-check against today's rules | on stage a stored check lists the exact text span each finding came from and the rule versions it used; the parser's labelled fixture set passes at 100 percent; a re-check of an old check after a rule migration gives the new verdict and keeps the old one |
| RW3 — the weekly scan and alerts | `220_range_watch`, saved ads (pasted text or a public careers-page URL fetched by the worker), a weekly cron plus a re-check when a rule version changes, email alerts when a saved ad's verdict gets worse, a per-org compliance report | on stage a saved ad whose rule tightens is re-checked on the next tick and its recruiter gets exactly one alert; a URL ad is fetched and checked; the report lists each saved ad's latest verdict |

Later, and not built here: LLM extraction of pay text (no model credential,
RW-B), ATS webhook adapters for Greenhouse, Lever and Ashby (no partner
credentials, RW-C), EU member-state rows as each transposition is published
(RW-D), city ordinances (RW-E), per-ad billing through Polar, and the
`rangewise.app` domain. See `risks-and-open-questions.md`.
