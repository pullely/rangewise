-- 200_range_rules
-- Pay-transparency rules table — which jurisdictions require pay in job ads,
-- from when, for which employer sizes, and what counts as a compliant range
-- Bounded context: range
-- schema range: Rangewise bounded context — owns the jurisdiction rules table
-- (RW1), the stored checks (RW2) and the saved ads and weekly scan (RW3).
-- Rules are global reference data, written only by migrations. A change in the
-- law is a NEW version row with its own effective_from; the version it
-- replaces gets effective_to. Rows are never edited in place, so a stored check
-- can always be replayed against the rules in force on its date. Only rows
-- whose citation was read from the primary text or the enforcing agency's
-- official guidance are seeded (verification = 'verified'). Seeds are
-- ON CONFLICT DO NOTHING so the file re-runs cleanly; a changed rule is a new
-- version row in a later migration, never an edit here.

CREATE TABLE IF NOT EXISTS range_jurisdictions (
  code        TEXT PRIMARY KEY CHECK (code = 'EU' OR code GLOB 'US-[A-Z][A-Z]'),
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('us_state','us_district','eu')),
  country     TEXT NOT NULL CHECK (country IN ('US','EU')),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- table range_jurisdictions: A place Rangewise has at least one rule for. Global, not org-scoped.

CREATE TABLE IF NOT EXISTS range_rules (
  id                 TEXT PRIMARY KEY,
  jurisdiction_code  TEXT NOT NULL REFERENCES range_jurisdictions(code),
  version            INTEGER NOT NULL CHECK (version >= 1),
  effective_from     TEXT NOT NULL,
  effective_to       TEXT,
  min_employees      INTEGER NOT NULL CHECK (min_employees >= 1),
  employee_scope     TEXT NOT NULL,
  pay_obligation     TEXT NOT NULL CHECK (pay_obligation IN ('in_posting','on_request')),
  single_figure      TEXT NOT NULL CHECK (single_figure IN ('allowed','review')),
  benefits_required  INTEGER NOT NULL CHECK (benefits_required IN (0,1)),
  benefits_scope     TEXT NOT NULL DEFAULT '',
  max_spread_pct     INTEGER CHECK (max_spread_pct IS NULL OR max_spread_pct > 0),
  spread_status      TEXT CHECK (spread_status IS NULL OR spread_status IN ('in_force','proposed')),
  remote_coverage    TEXT NOT NULL CHECK (remote_coverage IN ('covered','unsettled')),
  remote_note        TEXT NOT NULL DEFAULT '',
  summary            TEXT NOT NULL,
  citation           TEXT NOT NULL,
  source_url         TEXT NOT NULL CHECK (source_url LIKE 'http%'),
  source_kind        TEXT NOT NULL CHECK (source_kind IN ('statute','official_guidance','official_journal')),
  verification       TEXT NOT NULL CHECK (verification = 'verified'),
  verified_on        TEXT NOT NULL,
  notes              TEXT NOT NULL DEFAULT '',
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (jurisdiction_code, version),
  CHECK (id = jurisdiction_code || '@' || version),
  CHECK ((max_spread_pct IS NULL) = (spread_status IS NULL)),
  CHECK (effective_to IS NULL OR effective_to > effective_from)
);

-- table range_rules: One version of one jurisdiction's pay-transparency rule. Global reference data; never edited, superseded by a new version.
-- column range_rules.id: '<jurisdiction_code>@<version>', e.g. 'US-CO@1'.
-- column range_rules.single_figure: 'allowed' when the text accepts one fixed figure; 'review' when it asks for a range and a single figure is unsettled.
-- column range_rules.remote_coverage: 'covered' when the text or guidance says remote roles performable there are in scope.
-- column range_rules.verified_on: The date the citation was read from source_url.

CREATE INDEX IF NOT EXISTS range_rules_jurisdiction_idx ON range_rules (jurisdiction_code, effective_from);

INSERT INTO range_jurisdictions (code, name, kind, country, sort_order) VALUES
  ('US-CA', 'California', 'us_state', 'US', 10),
  ('US-CO', 'Colorado', 'us_state', 'US', 20),
  ('US-DC', 'District of Columbia', 'us_district', 'US', 30),
  ('US-MD', 'Maryland', 'us_state', 'US', 40),
  ('US-MN', 'Minnesota', 'us_state', 'US', 50),
  ('US-NJ', 'New Jersey', 'us_state', 'US', 60),
  ('US-NY', 'New York State', 'us_state', 'US', 70),
  ('US-WA', 'Washington', 'us_state', 'US', 80),
  ('EU', 'European Union (Pay Transparency Directive)', 'eu', 'EU', 100)
ON CONFLICT (code) DO NOTHING;

INSERT INTO range_rules
  (id, jurisdiction_code, version, effective_from, effective_to, min_employees, employee_scope,
   pay_obligation, single_figure, benefits_required, benefits_scope, max_spread_pct, spread_status,
   remote_coverage, remote_note, summary, citation, source_url, source_kind, verification, verified_on, notes)
VALUES
  ('US-CA@1', 'US-CA', 1, '2023-01-01', NULL, 15, 'employees',
   'in_posting', 'review', 0, '', NULL, NULL,
   'unsettled', 'The statute text read does not address remote roles.',
   'An employer with 15 or more employees must include the pay scale for a position in any job posting, and give it to any third party that posts for it. Pay scale means a good faith estimate of the salary or hourly wage range the employer reasonably expects to pay upon hire (definition as amended by SB 642, effective 2026-01-01).',
   'Cal. Lab. Code § 432.3(c)(3)',
   'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=LAB&sectionNum=432.3',
   'statute', 'verified', '2026-09-23',
   'In force from 2023-01-01: SB 1162 (Stats. 2022, ch. 559, approved 2022-09-27) sets no other operative date. A single figure is review: the statute says range, and the Labor Commissioner FAQ was not read (RW-F).'),

  ('US-CO@1', 'US-CO', 1, '2021-01-01', NULL, 1, 'employees in Colorado',
   'in_posting', 'allowed', 1, 'a general description of all benefits (health care, retirement, paid days off, tax-reportable benefits) and of other compensation such as bonuses, commissions or tips', NULL, NULL,
   'covered', 'CDLE INFO #9A: remote work performable in Colorado must comply, even if the posting says Coloradans will not be considered.',
   'Every employer with at least one employee in Colorado must state in every job posting the compensation (the rate of pay or a range of possible rates, with whether hourly or salary), a general description of the benefits and other compensation, and how and when to apply. Ranges cannot lack a top or bottom.',
   'C.R.S. § 8-5-201(2); 7 CCR 1103-18 (POST Rules) Rule 11.1',
   'https://cdle.colorado.gov/sites/cdle/files/info_%239a_transparency_in_pay_and_job_opportunities_the_colorado_epewa_part_2_05.29.2024.pdf',
   'official_guidance', 'verified', '2026-09-23',
   'Read through CDLE INFO #9A (last updated 2024-05-29) because leg.colorado.gov answers 403 to automated reads. Not checked: how and when to apply (RW2 adds it as a review finding).'),

  ('US-DC@1', 'US-DC', 1, '2024-06-30', NULL, 1, 'employees in the District',
   'in_posting', 'review', 0, '', NULL, NULL,
   'unsettled', 'The code text read does not address remote roles.',
   'An employer with at least one employee in the District must provide the minimum and maximum projected salary or hourly pay in all job listings and position descriptions advertised, extending from the lowest to the highest pay it in good faith believes it would pay.',
   'D.C. Code § 32–1453.01(a)(1)',
   'https://code.dccouncil.gov/us/dc/council/code/sections/32-1453.01',
   'statute', 'verified', '2026-09-23',
   'Applies as of 2024-06-30 (D.C. Law 25-138 § 3). Healthcare benefits must be disclosed before the first interview, not necessarily in the ad, so Rangewise does not check them.'),

  ('US-MD@1', 'US-MD', 1, '2024-10-01', NULL, 1, 'employees (no size threshold)',
   'in_posting', 'review', 1, 'a general description of benefits and any other compensation offered for the position', NULL, NULL,
   'unsettled', 'Applies to work physically performed, at least in part, in Maryland; the text read does not address fully remote roles.',
   'For a position physically performed at least in part in Maryland, an employer must disclose in each public or internal posting the wage range (the minimum and maximum hourly rate or salary, set in good faith) and a general description of benefits and any other compensation offered.',
   'Md. Code, Lab. & Empl. § 3-304.2(a)(2)(i); § 3-301(f)',
   'https://mgaleg.maryland.gov/mgawebsite/Laws/StatuteText?article=gle&section=3-304.2&enactments=false',
   'statute', 'verified', '2026-09-23',
   'Effective 2024-10-01: SB 525 (2024 session), chapter 272. The § 3-301(b) definition of employer has no size threshold.'),

  ('US-MN@1', 'US-MN', 1, '2025-01-01', NULL, 30, 'employees at one or more sites in Minnesota',
   'in_posting', 'allowed', 1, 'a general description of all of the benefits and other compensation, including any health or retirement benefits', NULL, NULL,
   'unsettled', 'The statute text read does not address remote roles.',
   'An employer with 30 or more employees in Minnesota must disclose in each posting the starting salary range and a general description of all benefits and other compensation. An employer that does not offer a range must list a fixed pay rate. A salary range may not be open ended.',
   'Minn. Stat. § 181.173, subd. 2',
   'https://www.revisor.mn.gov/statutes/cite/181.173',
   'statute', 'verified', '2026-09-23',
   'Effective 2025-01-01: 2024 Minn. Laws ch. 110, art. 7, sec. 2.'),

  ('US-NJ@1', 'US-NJ', 1, '2025-06-01', NULL, 10, 'employees over 20 or more calendar weeks',
   'in_posting', 'allowed', 1, 'a general description of the benefits and of any other compensation programs (commissions, bonuses, profit-sharing)', 60, 'proposed',
   'covered', 'NJDOL: covered employers include a business outside New Jersey that takes applications for work performed remotely from New Jersey.',
   'An employer with 10 or more employees over 20 calendar weeks that does business, employs or takes applications in New Jersey must state in each posting the hourly wage or salary, or a range of it, a general description of benefits and any other compensation programs. The range needs a bottom and a top.',
   'N.J.S.A. 34:6B-23 (P.L. 2024, c. 91); proposed N.J.A.C. 12:74',
   'https://www.nj.gov/labor/myworkrights/wages/pay-transparency/',
   'official_guidance', 'verified', '2026-09-23',
   'In effect 2025-06-01. Read through NJDOL guidance because the statute PDF host refused the connection. The 60% spread cap is only in the proposed rules, which NJDOL says are not adopted and non-binding: a wider range gets review.'),

  ('US-NY@1', 'US-NY', 1, '2023-09-17', NULL, 4, 'employees',
   'in_posting', 'allowed', 0, '', NULL, NULL,
   'covered', 'Covers jobs performed at least in part in New York, and jobs performed outside New York that report to a supervisor, office or work site in New York.',
   'An employer with four or more employees may not advertise a job, promotion or transfer performed at least in part in New York without disclosing the compensation or a range of compensation (the minimum and maximum annual salary or hourly range it in good faith believes accurate) and the job description if one exists.',
   'N.Y. Lab. Law § 194-b(1)',
   'https://www.nysenate.gov/legislation/laws/LAB/194-B',
   'statute', 'verified', '2026-09-23',
   'In force 2023-09-17: S9427A (ch. 723 of 2022, signed 2022-12-21) takes effect on the 270th day after becoming law. Not checked: the job description.'),

  ('US-WA@1', 'US-WA', 1, '2023-01-01', NULL, 15, 'employees',
   'in_posting', 'allowed', 1, 'a general description of all of the benefits and other compensation to be offered', NULL, NULL,
   'unsettled', 'The statute text read does not address remote roles.',
   'An employer with 15 or more employees must disclose in each posting the wage scale or salary range (or the fixed wage when only a fixed wage is offered) and a general description of all of the benefits and other compensation to be offered.',
   'RCW 49.58.110(1)',
   'https://app.leg.wa.gov/RCW/default.aspx?cite=49.58.110',
   'statute', 'verified', '2026-09-23',
   'Effective 2023-01-01 (2022 c 242 s 1). 2025 c 383 adds a five-business-day cure period from 2025-07-27 to 2027-07-27; it affects penalties, not the verdict.'),

  ('EU@1', 'EU', 1, '2026-06-07', NULL, 1, 'workers (public and private employers)',
   'on_request', 'allowed', 0, '', NULL, NULL,
   'covered', 'The Directive applies to applicants for employment; national transposition decides the details.',
   'Applicants have the right to receive from the prospective employer the initial pay or its range, based on objective, gender-neutral criteria, provided so as to ensure an informed and transparent negotiation, such as in a published job vacancy notice, prior to the job interview or otherwise. Member States had to transpose by 7 June 2026.',
   'Directive (EU) 2023/970, Art. 5(1); Art. 34(1)',
   'http://publications.europa.eu/resource/celex/32023L0970',
   'official_journal', 'verified', '2026-09-23',
   'Advisory only: a directive is addressed to Member States (Art. 37) and Art. 5 is satisfied before the interview, so an ad without pay gets review, never fail. National transposition rows come later (RW-D).')
ON CONFLICT (id) DO NOTHING;
