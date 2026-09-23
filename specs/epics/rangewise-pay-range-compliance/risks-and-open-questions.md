# rangewise-pay-range-compliance — risks and open questions

Each entry has a letter, a title and a state:

- **RISK**: open, with a mitigation.
- **RESOLVED**: decided. The entry says what was decided and why.
- **ACCEPTED**: a cost we carry knowingly.
- **SETTLED**: decided for now, to be revisited on a stated cadence.

## RW-A — Jurisdictions whose citations could not be verified (RISK, open)

On 2026-09-23, Illinois (`ilga.gov`, connection refused), Massachusetts
(`malegislature.gov` connection refused, `mass.gov` 403), Vermont
(`legislature.vermont.gov`, connection refused) and Hawaii
(`capitol.hawaii.gov`, Cloudflare block) could not be read from a primary or
official source by an automated fetch. Secondary sources say each one requires
pay in job postings. We did not seed them, because a guessed row that fails an
ad on a wrong threshold or date is worse than an honest `not_covered`. The
brief's M1 asked for ten US states. RW1 ships eight US jurisdictions (seven
states and DC).

Mitigation: a person with a browser (the brief is recruiting an
employment-law researcher) reads each statute and its effective-date clause,
and each one lands as its own migration with `verified_on`. Until then, the
console's Rules page lists these four as "not covered: citation not yet
verified", and a check naming one says `not_covered`.

## RW-B — No LLM extraction (ACCEPTED)

The brief wants "one LLM call per ad" to pull out the pay text and judge
whether it is a real range. No model credential was provided to this
workspace. Disclosure is a rules problem once the pay is extracted, and pay
statements are formulaic enough for a tested parser. RW2's labelled fixture
set measures that. If the false-flag rate on real ads is above the brief's 2
percent, an LLM pass may be added as a *second opinion* that can only turn a
`fail` into a `review`, never decide a verdict. It needs a credential, and it
would be a later milestone.

## RW-C — No ATS webhook adapters (RISK, open)

Greenhouse, Lever and Ashby integrations need partner or sandbox accounts and
webhook signing secrets, and nobody has them. RW3's saved ads (pasted text or
a public careers-page URL) cover the "check before it goes live" and "catch
drift" jobs without them. Later: one adapter per ATS, each landing a posting
as a saved ad.

## RW-D — EU member-state transposition (RISK, open)

The Directive's deadline was 7 June 2026 (Art. 34(1)), and member states are
transposing it on different dates. Each national law decides whether pay must
be *in the ad* or only "prior to the job interview or otherwise"
(Art. 5(1)). RW1 seeds only the Directive, as advice. Every national row needs
its own verified text (usually in the national language) and lands as its own
migration. Until then an `EU-DE` location is checked against the Directive's
advisory row, and the result says national law is not covered.

## RW-E — Cities and counties (RISK, open)

New York City, Jersey City, Cleveland, Columbus and others have their own
ordinances. RW1 models states, DC and the EU only. A `US-NY-NYC` style code is
reserved for later. New York State's rule already covers New York City roles.

## RW-F — Single figures where the text says "range" (SETTLED, review each quarter)

California, Maryland and DC define the disclosure as a range (a minimum and a
maximum). Agency FAQs reportedly accept a single fixed rate when the employer
will pay exactly that. We have not read those FAQs from an official source, so
a single figure there gets `review`, not `pass` or `fail`. Revisit when the
FAQs are read.

## RW-G — Remote coverage is unsettled in five seeded jurisdictions (SETTLED)

Colorado, New York and New Jersey say in text or official guidance that remote
work performable there is covered. For California, Washington, Minnesota,
Maryland and DC, the texts we read do not say. A remote-only `fail` there is
reported as `review`, with the reason. Revisit per jurisdiction when official
guidance is read.

## RW-H — Employer-size thresholds count different people (ACCEPTED)

Minnesota counts employees "at one or more sites in Minnesota". Colorado and DC
count at least one employee there. New Jersey counts "10 or more employees over
20 calendar weeks". RW1 asks for one headcount and compares it with each
threshold, and each rule's `employee_scope` says what it counts. This can say
`fail` for an employer that the rule does not cover (for example, 50
employees in total but 5 in Minnesota). It never says `pass` for an employer
that the rule does cover. RW2 may add per-jurisdiction headcounts.

## RW-I — Benefits: presence, not completeness (ACCEPTED)

Colorado, Washington, Minnesota, Maryland and New Jersey require a general
description of *all* benefits. A deterministic check can see whether benefits
are described, but it cannot see whether the list is complete. Rangewise
`fail`s an ad that describes none, and flags filler words ("and more",
"etc."). It never claims the list is complete.

## RW-J — New Jersey's 60 percent spread is only proposed (SETTLED)

NJDOL's page says the proposed N.J.A.C. 12:74 rules "have not been adopted and
are currently non-binding". The cap is stored with `spread_status = proposed`,
so a wider range gets `review`. When the rules are adopted, a new version of
`US-NJ` with `spread_status = in_force` lands as a migration, and RW3 re-checks
saved New Jersey ads.

## RW-K — Keeping the rules current (RISK, open)

The product is only as good as its table. Laws change at the start of a year
or a quarter (Delaware in 2027 per the brief, and the EU transpositions).
Mitigation: every row carries `verified_on`. The Rules page shows it. RW3
re-checks saved ads when a rule version lands. A quarterly review of every row
is an operating task for the rules researcher.

## RW-L — The baseline's Postgres-only SQL on D1 (RESOLVED in RW1)

The cirrus baseline's `appendEventWithAudit` and its membership writes use
Postgres-only SQL that D1 cannot run, so organization create fails. RW1 applies
the portfolio's tested `cirrus-d1-fix.patch` and marks every worker for
redeploy. `range-worker` writes its audit rows with portable SQL either way.
Any repository code that branches on `rowCount` after a write uses `RETURNING`,
because the D1 executor reports `rowCount` as the number of returned rows.

## RW-M — Production sign-in needs a sending domain (RISK, open)

Magic-link email on prod needs a verified sending domain. `rangewise.app` is
not held. Stage works through `DEBUG_DELIVERY`, which hands the link back in
the response. On prod, only `/health` and the unauthenticated 401s are
checked. Buying the domain and verifying the sender are the owner's decisions.
