# rangewise-pay-range-compliance — design

Rangewise checks a job ad against a cited table of pay-transparency rules and
returns, for each jurisdiction where the role can be performed, a verdict and
the rule that decided it. This document is the intent. What actually shipped is
recorded in `IMPLEMENTATION-STATUS.md`.

Rangewise is not legal advice, and the product never says so either. Every
verdict says "passes (or fails) Rangewise's rule for X", and links the source
the rule was read from.

## 0. The rules — the product

### 0.1 How a rule gets into the table

1. Someone reads the rule in its **primary text** (the statute, the session law
   that gives its effective date, or the Official Journal), or in the official
   guidance of the agency that enforces it. The source URL and the date it was
   read are recorded with the row.
2. If the primary host blocks automated reads, the official agency's guidance
   is used instead and the row says which one was used (`source_kind`). If
   neither can be read, the jurisdiction is **not seeded**. It is listed in
   §0.4 and in `risks-and-open-questions.md` as unverified.
3. Rules are rows in D1, written only by migrations. A change in the law is a
   new version of the jurisdiction's rule, with its own `effective_from`. The
   version it replaces gets an `effective_to`. Old versions are never edited.
   That way a stored check (RW2) can always be replayed against the rules in
   force on its date.

All the rows below were read on **2026-09-23**. The quotations are from the
source named in each row.

### 0.2 The seeded jurisdictions (RW1, migration `200_range_rules`)

| Code | Jurisdiction | In force from | Employer size | Pay in the ad | Single figure | Benefits described | Source read |
|---|---|---|---|---|---|---|---|
| `US-CA` | California | 2023-01-01 | 15 or more employees | required | review | no | statute |
| `US-CO` | Colorado | 2021-01-01 | 1 or more employee in Colorado | required | allowed | **yes** | official guidance |
| `US-DC` | District of Columbia | 2024-06-30 | 1 or more employee in DC | required | review | no (see note) | statute + session law |
| `US-MD` | Maryland | 2024-10-01 | any employer | required | review | **yes** | statute + bill record |
| `US-MN` | Minnesota | 2025-01-01 | 30 or more employees in Minnesota | required | allowed | **yes** | statute + session law |
| `US-NJ` | New Jersey | 2025-06-01 | 10 or more employees over 20 calendar weeks | required | allowed | **yes** | official guidance |
| `US-NY` | New York State | 2023-09-17 | 4 or more employees | required | allowed | no | statute + bill record |
| `US-WA` | Washington | 2023-01-01 | 15 or more employees | required | allowed | **yes** | statute |
| `EU` | European Union (Directive) | 2026-06-07 (transposition deadline) | all employers | **on request** (advisory only) | allowed | no | Official Journal |

"Single figure: review" means that the text requires a *range*: a minimum and a
maximum. A single figure there gets `review`, not `fail`. Many employers post
one fixed rate, and we have not read an official statement for that
jurisdiction that settles whether a fixed rate is enough.

An **open-ended** range ("up to $60,000", "from $30/hour", "$70,000+") fails
wherever pay is required. Every seeded US text defines the disclosure as a
range with both ends, or as a fixed amount.

#### `US-CO` — Colorado Equal Pay for Equal Work Act, Part 2

- Citation: C.R.S. § 8-5-201(2); Posting, Screening, and Transparency (POST)
  Rules, 7 CCR 1103-18, Rule 11.1.
- Source: Colorado Department of Labor and Employment, Division of Labor
  Standards and Statistics, *INFO #9A: Transparency in Pay and Job
  Opportunities* (last updated 29 May 2024),
  `https://cdle.colorado.gov/sites/cdle/files/info_%239a_transparency_in_pay_and_job_opportunities_the_colorado_epewa_part_2_05.29.2024.pdf`.
  The statute site `leg.colorado.gov` answers 403 to automated reads, so the
  statute is cited through the agency's INFO, which quotes it section by
  section.
- What it says: the Act "covers all 'employers,' public or private, that
  employ at least one person in Colorado". Every posting must include "the
  compensation to be offered; the benefits to be offered; and how and when to
  apply". Compensation is "the rate of pay or a range of possible offered
  rates". "Ranges can't lack a top or bottom, like '$30,000 and up' or 'up to
  $60,000.'" Benefits must be described generally ("health care, retirement
  benefits, paid days off"), and employers "can't use open-ended phrases like
  'etc.,' or 'and more'". On remote jobs: "Remote Work Performable in Colorado
  Must Comply … even if it says Coloradans won't be considered". In force since
  "the start of 2021".
- Not checked by Rangewise: "how and when to apply" (a deadline). RW2 adds it
  as a `review` finding.

#### `US-NY` — New York Labor Law § 194-b

- Citation: N.Y. Lab. Law § 194-b(1). Source:
  `https://www.nysenate.gov/legislation/laws/LAB/194-B`.
- What it says: an employer may not advertise a job "that will physically be
  performed, at least in part, in the state of New York, including a job …
  performed outside of New York but reports to a supervisor, office, or other
  work site in New York without disclosing … the compensation or a range of
  compensation". A range is "the minimum and maximum annual salary or hourly
  range of compensation … that the employer in good faith believes to be
  accurate at the time of the posting". An employer is one "employing four or
  more employees".
- In force: S9427A (2021–22 session) "shall take effect on the two hundred
  seventieth day after it shall have become a law". It was signed on
  2022-12-21 as chapter 723, so it took effect on **2023-09-17**. The 2023
  chapter amendment (S1326) takes effect on the same date.
  Source: `https://www.nysenate.gov/legislation/bills/2021/S9427`.

#### `US-CA` — California Labor Code § 432.3

- Citation: Cal. Lab. Code § 432.3(c)(3). Source:
  `https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=432.3`.
- What it says: "An employer with 15 or more employees shall include the pay
  scale for a position in any job posting." A third party that posts for the
  employer must include it too. "'Pay scale' means a good faith estimate of the
  salary or hourly wage range that the employer reasonably expects to pay for
  the position upon hire". That is the 2026 wording (SB 642, Stats. 2025,
  ch. 468, effective 2026-01-01), which is the "stricter California definition
  in 2026" the brief mentions.
- In force: the posting duty was added by SB 1162 (Stats. 2022, ch. 559,
  approved 2022-09-27). It sets no operative date of its own, so the default of
  **2023-01-01** applies. Source:
  `https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=202120220SB1162`.
- A single figure gets `review`: the statute says "range", and we have not read
  the Labor Commissioner's FAQ (RW-F).

#### `US-WA` — Washington RCW 49.58.110

- Citation: RCW 49.58.110(1). Source:
  `https://app.leg.wa.gov/RCW/default.aspx?cite=49.58.110`.
- What it says: an employer with 15 or more employees must disclose in each
  posting "the wage scale or salary range, except where the employer is
  offering only a fixed wage amount … the fixed wage amount", and "a general
  description of all of the benefits and other compensation to be offered". A
  posting is "any solicitation intended to recruit job applicants for a
  specific available position, including recruitment done directly by an
  employer or indirectly through a third party".
- In force: 2022 c 242 s 1, effective **2023-01-01**. 2025 c 383 s 1 added a
  five-business-day cure period from 27 July 2025 to 27 July 2027. That affects
  penalties, not the verdict.

#### `US-MN` — Minnesota Statutes § 181.173

- Citation: Minn. Stat. § 181.173, subd. 2. Source:
  `https://www.revisor.mn.gov/statutes/cite/181.173`.
- What it says: an employer is "a person or entity that employs 30 or more
  employees at one or more sites in Minnesota". It "must disclose in each
  posting for each job opening … the starting salary range, and a general
  description of all of the benefits and other compensation, including but not
  limited to any health or retirement benefits". "An employer that does not
  plan to offer a salary range for a position must list a fixed pay rate. A
  salary range may not be open ended."
- In force: 2024 Minn. Laws ch. 110, art. 7, sec. 2: "This section is
  effective January 1, 2025." Source:
  `https://www.revisor.mn.gov/laws/2024/0/Session+Law/Chapter/110/`.

#### `US-MD` — Maryland Labor and Employment § 3-304.2

- Citation: Md. Code, Lab. & Empl. § 3-304.2(a)(2)(i); definition of "wage
  range" in § 3-301(f). Sources:
  `https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gle&section=3-304.2&enactments=false`
  and `…section=3-301…`.
- What it says: for "a position for work that will be physically performed, at
  least in part, in the State", an employer shall "disclose in each public or
  internal posting for each position the wage range and a general description
  of benefits and any other compensation offered". A wage range is "the minimum
  and maximum hourly rate or minimum and maximum salary for a position, set in
  good faith". The § 3-301(b) definition of "employer" has no size threshold,
  so the rule is seeded with a threshold of 1.
- In force: SB 525 (2024 session), chapter 272, "Effective Date(s): October 1,
  2024". Source:
  `https://mgaleg.maryland.gov/mgawebsite/Legislation/Details/sb0525?ys=2024RS`.

#### `US-NJ` — New Jersey pay and benefits transparency law

- Citation: N.J.S.A. 34:6B-23 (P.L. 2024, c. 91); proposed N.J.A.C. 12:74.
- Source: New Jersey Department of Labor and Workforce Development, *New Jersey
  pay and benefits transparency law*,
  `https://www.nj.gov/labor/myworkrights/wages/pay-transparency/`. The statute
  PDF on `pub.njleg.state.nj.us` refused the connection, so the rule is cited
  through the department's page, which separates statutory text from the
  proposed rules.
- What it says: covered employers have "10 or more employees over 20 or more
  calendar weeks" and do business, employ or take applications in New Jersey.
  Postings must include "the hourly wage or salary of the position, or a range
  of the hourly wage or salary; a general description of the benefits; and any
  other compensation programs". "The job posting should not leave out the
  bottom range, such as 'up to $35 per hour'", nor the top. The law "went into
  effect on June 1, 2025". Covered employers include a business outside New
  Jersey that takes applications for work "remotely from NJ".
- The **60 percent spread cap** (the gap between the bottom and the top of the
  range may be at most 60 percent of the bottom) is in the *proposed*
  departmental rules, which the page says "have not been adopted and are
  currently non-binding". Rangewise stores it with `spread_status = proposed`,
  so a wider range gets `review`, never `fail`.

#### `US-DC` — District of Columbia Code § 32–1453.01

- Citation: D.C. Code § 32–1453.01(a). Sources:
  `https://code.dccouncil.gov/us/dc/council/code/sections/32-1453.01` and
  `https://code.dccouncil.gov/us/dc/council/laws/25-138`.
- What it says: an employer shall "provide the minimum and maximum projected
  salary or hourly pay in all job listings and position descriptions
  advertised", and the range "shall extend from the lowest to the highest
  salary or hourly pay that the employer in good faith believes at the time of
  the posting it would pay". It shall also "disclose to prospective employees
  the existence of healthcare benefits … before the first interview". That is
  not required in the ad, so Rangewise records it as a note and does not check
  it. An employer is one "that employs at least one employee in the District"
  (§ 32–1451(2)).
- In force: D.C. Law 25-138 (the Wage Transparency Omnibus Amendment Act of
  2023) took effect on 5 March 2024, and its § 3 says "This act shall apply as
  of June 30, 2024."

#### `EU` — Directive (EU) 2023/970 (Pay Transparency Directive)

- Citation: Directive (EU) 2023/970, Art. 5(1), Art. 2(1) and (3), and
  Art. 34(1); OJ L 132, 17.5.2023, p. 21. Source: the Publications Office
  copy, `http://publications.europa.eu/resource/celex/32023L0970` (cellar
  `5bbb9daf-f470-11ed-a05c-01aa75ed71a1`). EUR-Lex itself serves a bot
  challenge.
- What it says: "Applicants for employment shall have the right to receive,
  from the prospective employer, information about: (a) the initial pay or its
  range …". That information is provided "such as in a published job vacancy
  notice, prior to the job interview or otherwise". The Directive "applies to
  employers in public and private sectors". Member States "shall bring into
  force the laws … necessary to comply with this Directive by 7 June 2026".
- Why the row is advisory only: a directive is addressed to the Member States
  (Art. 37), and Art. 5 is satisfied if pay is given before the interview, not
  necessarily in the ad. So an EU ad without pay gets `review` ("national law
  may require it in the ad"), and an ad with pay gets `pass`. It never gets
  `fail`. National rows come later (RW-D).

### 0.3 Remote roles

A check says whether the role is remote: `none`, `us` (performable anywhere in
the US), `eu`, or `anywhere`. For a remote role, every seeded jurisdiction in
that area is checked, because an ad for a role that can be done from anywhere
reaches applicants in all of them. Each rule records its `remote_coverage`:

- `covered`: the text or guidance says remote roles performable there are in
  scope. That is Colorado (INFO #9A), New York ("performed, at least in part,
  in the state", or reporting to a New York office) and New Jersey (NJDOL).
- `unsettled`: the text we read does not say. A `fail` on such a rule, reached
  only through the remote flag, is reported as `review`, with the reason
  given. A jurisdiction the user names explicitly is always checked in full.

### 0.4 Not seeded: jurisdictions we could not verify

The brief's first milestone asks for ten US states. Eight US jurisdictions are
seeded, because the rest could not be read from a primary or official source
on 2026-09-23. Each of these has pay-transparency posting rules according to
secondary sources, and each is an open risk (RW-A):

| Jurisdiction | Where we tried | What happened |
|---|---|---|
| Illinois (Equal Pay Act, 820 ILCS 112) | `ilga.gov` | connection refused |
| Massachusetts (M.G.L. c. 149) | `malegislature.gov`, `mass.gov` | connection refused; 403 |
| Vermont (21 V.S.A.) | `legislature.vermont.gov` | connection refused |
| Hawaii (HRS ch. 378) | `capitol.hawaii.gov` | Cloudflare block page |
| Delaware (from 2027, per the brief) | not attempted: not in force | — |
| Cities (New York City, Jersey City, Cleveland, Columbus, …) | not attempted | out of RW1 scope (RW-E) |

A check that names one of these places gets `not_covered`. That means
Rangewise has no rule for it. It does not mean there is no law.

## 1. The resources

One bounded context, `range`, owned by `apps/range-worker`. Tables are prefixed
`range_`. Every org-scoped query filters by `org_id`. The rules tables are
global reference data.

### 1.1 `range_jurisdictions` (RW1)

`code` (PK, `US-CO`, `EU`), `name`, `kind` (`us_state`, `us_district`,
`eu`), `country` (`US`, `EU`), `sort_order`.

### 1.2 `range_rules` (RW1)

One row per jurisdiction per version. The public id is `<code>@<version>`,
for example `US-CO@1`.

| Column | Meaning |
|---|---|
| `id` | `US-CO@1` |
| `jurisdiction_code`, `version` | UNIQUE together |
| `effective_from`, `effective_to` | ISO dates. `effective_to` is null while the rule is current |
| `min_employees`, `employee_scope` | threshold and what is counted ("employees in Colorado") |
| `pay_obligation` | `in_posting` or `on_request` (the EU row) |
| `single_figure` | `allowed` or `review` |
| `benefits_required` | 0/1 |
| `benefits_scope` | what must be described |
| `max_spread_pct`, `spread_status` | the NJ proposal: 60, `proposed`. Null elsewhere |
| `remote_coverage`, `remote_note` | `covered` or `unsettled`, plus the text |
| `summary` | one-paragraph plain statement of the rule |
| `citation` | e.g. `C.R.S. § 8-5-201(2); 7 CCR 1103-18 Rule 11.1` |
| `source_url`, `source_kind` | `statute`, `official_guidance` or `official_journal` |
| `verification`, `verified_on` | `verified` plus the date read. The CHECK allows only `verified` for seeded rows |
| `notes` | what Rangewise does not check under this rule |

CHECKs: `pay_obligation`, `single_figure`, `remote_coverage` and `source_kind`
enums; `spread_status` is set if and only if `max_spread_pct` is set; and
`effective_to` is null or after `effective_from`.

### 1.3 `range_checks` (RW2): `rwc_`

`id`, `org_id`, `title`, `ad_text`, `ad_sha256`, the inputs (`locations`,
`remote`, `employee_count`, `check_date`), `overall`, `result_json` (the full
response, including evidence spans and the rule ids and versions used),
`rules_fingerprint` (a hash of the rule ids used), `rechecked_from` (the check
this re-runs), `created_by`, `created_at`. Checks are never edited. A re-check
is a new row. RW1 already mints a check id and uses it as the audit subject,
so audit rows written in RW1 line up with RW2's table.

### 1.4 `range_watched_ads` and `range_scan_runs` (RW3): `rwa_`, `rws_`

A saved ad (pasted text, or a public careers-page URL the worker fetches), its
inputs, the recruiter to alert, its latest check, and an alert ledger with
UNIQUE(`ad_id`, `check_id`) so each worsening is emailed once.

## 2. The engine

The engine is pure TypeScript inside `range-worker` (`src/engine/`). It has no
I/O and is unit-tested. The worker only loads rules from D1 and calls it.

### 2.1 Extraction (RW1: first cut; RW2: the full parser)

RW1 finds **one** pay statement in the ad:

- Money: `$`, `US$`, `USD`, `€`, `EUR`, `£`, `GBP` before or after a number.
  The number may have `,` or `.` thousands separators and a `k` suffix.
  Amounts with `M`, `B`, `million` or `billion` are skipped (funding and
  revenue, not pay).
- A range is money, then `-`, `–`, `—`, `to` or `and` (after "between"), then
  money or a bare number, so `$80-100k` works.
- An open-ended top is `up to`, `maximum` or `max` before the amount. An
  open-ended bottom is `from`, `starting at`, `minimum` or `at least` before it,
  or `+`, `and up`, `or more` or `and above` after it.
- The period is read from the next few words: `/hr`, `per hour`, `hourly`,
  `per year`, `annually`, `per annum`, `a year`, `/yr`, `per month`, `per
  week`, `per day`, `daily`.
- Precedence: the first bounded range, then a single figure, then an
  open-ended amount. If min > max it is not a range.
- Vague pay words ("competitive", "DOE", "depending on experience",
  "commensurate", "negotiable", "market rate") are reported. They never count
  as pay.
- Benefits: the categories health, retirement, paid time off, insurance,
  equity and bonus/commission are detected by keyword. Filler phrases
  ("and more", "etc.", "great benefits") are reported.

RW2 replaces this with the full parser described in the plan. It reports
every pay statement with its text span, and gives per-location ranges ("NYC:
$120k–$150k; Denver: $105k–$130k") to the right jurisdictions.

### 2.2 Evaluation, per jurisdiction

The rule used is the version whose `effective_from ≤ check_date <
effective_to`. Then:

1. There is no row for the place → `not_covered`.
2. No version is in force on the check date → `not_in_force`. The deciding rule
   is the earliest future version.
3. `employee_count < min_employees` → `not_applicable`.
4. `on_request` (EU): pay disclosed → `pass`; otherwise `review`.
5. Pay disclosure: none → `fail` ("no pay stated"; vague words quoted); open
   ended → `fail`; a single figure → `pass` if allowed, `review` otherwise; a
   bounded range → met.
6. Spread (only when `max_spread_pct` is set and the pay is a range):
   `(max − min) / min > max_spread_pct%` → `fail` if in force, `review` if
   proposed.
7. Benefits (only when required): no core category (health, retirement,
   paid time off, insurance) detected → `fail`. Filler phrases alongside
   detected categories → `review`. Colorado's and New Jersey's guidance
   forbid them explicitly, and every rule that requires benefits asks for a
   general description of *all* of them.
8. Remote-only inclusion with `remote_coverage = unsettled` turns a `fail`
   into `review`.

Every requirement is reported as `{requirement, outcome: met|failed|review,
explanation, citation}`. The verdict is `fail` if any requirement failed,
otherwise `review` if any needs review, otherwise `pass`. The **deciding
rule** is the first failed requirement, else the first one needing review,
else the pay requirement. The overall verdict is `fail` > `review` > `pass` >
the rest.

## 3. The API

Everything goes through api-edge. It resolves the session, and range-worker
runs membership plus policy itself. Non-members get 404. Envelopes are the
baseline's `{data, meta}` and `{error}`.

### 3.1 RW1

| Route | Action | Notes |
|---|---|---|
| `GET /v1/organizations/{org}/pay-rules` | `range.read` | `{rules: [...], jurisdictions: [...], rulesVersion}`. Current and upcoming versions, each with its citation, source and verification date |
| `POST /v1/organizations/{org}/pay-checks` | `range.write` | body `{title?, adText, locations[], remote, employeeCount, checkDate?}` → `{check: {id, overall, extracted, results[]}}`, status 200 |

Validation (422): `adText` 1–20,000 characters; `locations` 0–60 codes
matching `US-XX`, `EU` or `EU-XX` (the 27 member states map to the `EU` row);
`remote` one of `none`, `us`, `eu`, `anywhere`; at least one location or a
remote area; `employeeCount` an integer from 1 to 1,000,000; `checkDate` an ISO
date within ±5 years of today. A check writes a `range.check.run` audit event
with the verdict per jurisdiction and the ad's SHA-256, not its text.

Policy: `range.read` for every role; `range.write` for owner, admin and
builder. A viewer can read the rules but cannot run a check.

### 3.2 RW2

`GET /v1/organizations/{org}/pay-checks` (history, paged, filter by overall),
`GET …/pay-checks/{rwc}` (detail with evidence), `POST
…/pay-checks/{rwc}/recheck`.

### 3.3 RW3

`GET|POST …/watched-ads`, `GET|PATCH …/watched-ads/{rwa}`, `POST
…/watched-ads/{rwa}/scan`, `GET …/reports/compliance`. `scheduled()` runs
weekly (`0 6 * * 1`). A rule migration bumps `rulesVersion`, and the next
daily tick re-checks every saved ad whose jurisdictions changed.

## 4. The console

- **Check an ad** (`/orgs/[org]/pay-checks`): a textarea for the ad, a title,
  location checkboxes grouped US and EU, a remote selector, the headcount and
  the date (default today). The result shows an overall badge, the extracted
  pay ("$80,000–$100,000 per year") and the benefits found, then a table:
  jurisdiction, verdict badge, the deciding rule's explanation, and its
  citation linked to the source.
- **Rules** (`/orgs/[org]/pay-rules`): the table from §0.2, with effective
  dates, thresholds, what each rule requires, the citation and source link,
  and "verified on" dates. It also says which jurisdictions are not covered
  and why.
- RW2 adds check history and detail. RW3 adds saved ads and the report.

Nav: "Check an ad" (lucide `ClipboardCheck`) and "Pay rules" (lucide `Scale`).

## 5. Events, secrets, and integrations

- Audit and events: `range.check.run` (RW1); `range.check.rechecked` (RW2);
  `range.ad.saved`, `range.ad.scanned` and `range.ad.alerted` (RW3). The
  subject kinds `pay_check` (`rwc_`) and `watched_ad` (`rwa_`) are registered
  in events-worker's id prefixes.
- Notifications: `range-worker` is on notifications-worker's internal-caller
  allow-list from RW1, so RW3 adds only templates.
- No new secrets. RW3's page fetch is an unauthenticated `fetch()` of a
  public URL, with a size cap and a timeout.
- Cron: one trigger, from RW3.

## 6. Out of scope

- LLM extraction ("an LLM extracts the pay text"): no model credential (RW-B).
  The deterministic parser covers the common formats, and RW2 measures it on a
  labelled set.
- ATS webhooks for Greenhouse, Lever and Ashby: no partner credentials or
  sandbox accounts (RW-C).
- EU member-state transpositions (RW-D) and city ordinances (RW-E).
- Unverified US states (§0.4, RW-A).
- Legal advice, penalties and cure-period tracking.
- Billing by active ads (Polar, once priced), and the `rangewise.app` domain.
