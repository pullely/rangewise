-- 210_range_checks
-- Stored pay checks (RW2): every check of a job ad, with the ad text, the
-- facts it was checked under, the full result (verdicts, deciding rules,
-- evidence spans) and the rule versions it used.
-- Bounded context: range
-- A check is never edited. A re-check is a NEW row that points at the check it
-- re-runs (rechecked_from) and shares its lineage's root (root_id), so the
-- original verdict stays exactly as it was given. The id is the same UUID RW1
-- already minted as the audit subject of range.check.run (public form rwc_…),
-- so audit rows and stored checks line up. Every write in the repository uses
-- RETURNING (runbook trap 22). No seeds.

CREATE TABLE IF NOT EXISTS range_checks (
  id                 TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL,
  title              TEXT NOT NULL DEFAULT '',
  ad_text            TEXT NOT NULL CHECK (length(ad_text) BETWEEN 1 AND 20000),
  ad_sha256          TEXT NOT NULL CHECK (length(ad_sha256) = 64),
  locations          TEXT NOT NULL DEFAULT '[]',
  remote             TEXT NOT NULL CHECK (remote IN ('none','us','eu','anywhere')),
  employee_count     INTEGER NOT NULL CHECK (employee_count >= 1),
  check_date         TEXT NOT NULL,
  overall            TEXT NOT NULL CHECK (overall IN ('pass','fail','review','not_applicable','not_in_force','not_covered')),
  result_json        TEXT NOT NULL,
  rules_fingerprint  TEXT NOT NULL,
  rule_ids           TEXT NOT NULL DEFAULT '[]',
  engine_version     TEXT NOT NULL,
  rechecked_from     TEXT REFERENCES range_checks(id),
  root_id            TEXT NOT NULL,
  created_by         TEXT,
  created_at         TEXT NOT NULL,
  CHECK (rechecked_from IS NULL OR rechecked_from <> id),
  CHECK ((rechecked_from IS NULL) = (root_id = id))
);

-- table range_checks: One check of one job ad against the rules in force on its check date. Org-scoped; never edited — a re-check is a new row.
-- column range_checks.result_json: The full PublicPayCheck as returned: extracted pay statements with spans, a verdict per jurisdiction, each requirement with its evidence span.
-- column range_checks.rule_ids: JSON array of the rule versions the verdicts used, e.g. ["US-CO@1","US-NY@1"].
-- column range_checks.root_id: The first check of this ad's lineage (its own id for an original check).

CREATE INDEX IF NOT EXISTS range_checks_org_created_idx ON range_checks (org_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS range_checks_org_overall_idx ON range_checks (org_id, overall, created_at DESC);
CREATE INDEX IF NOT EXISTS range_checks_root_idx ON range_checks (root_id, created_at);
