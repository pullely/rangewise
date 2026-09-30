-- 220_range_watch
-- Saved ads, the weekly scan and the alert ledger (RW3).
-- Bounded context: range
-- A saved ad is pasted text or a public https careers-page URL the worker
-- fetches at each scan. A daily cron re-checks every active ad that is due:
-- new or edited (revision > scanned_revision), checked against a rule version
-- that has since changed (rules fingerprint), or 7 days after its last scan.
-- Each scan is CLAIMED first in range_scan_runs, UNIQUE (ad_id, window_key),
-- with INSERT … ON CONFLICT … RETURNING, so two ticks (or a tick and a manual
-- sweep) on the same day scan an ad once. A worse verdict writes one row in
-- range_alerts, UNIQUE (ad_id, check_id), before the email is sent, so each
-- worsening is emailed once. Every write uses RETURNING (runbook trap 22).
-- No seeds.

CREATE TABLE IF NOT EXISTS range_watched_ads (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL,
  title                   TEXT NOT NULL DEFAULT '',
  source_kind             TEXT NOT NULL CHECK (source_kind IN ('text','url')),
  source_url              TEXT CHECK (source_url IS NULL OR source_url LIKE 'https://%'),
  ad_text                 TEXT NOT NULL DEFAULT '' CHECK (length(ad_text) <= 20000),
  locations               TEXT NOT NULL DEFAULT '[]',
  remote                  TEXT NOT NULL CHECK (remote IN ('none','us','eu','anywhere')),
  employee_count          INTEGER NOT NULL CHECK (employee_count >= 1),
  recruiter_email         TEXT NOT NULL,
  active                  INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  revision                INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  scanned_revision        INTEGER NOT NULL DEFAULT 0,
  last_check_id           TEXT REFERENCES range_checks(id),
  last_overall            TEXT,
  last_rules_fingerprint  TEXT,
  last_checked_at         TEXT,
  next_due_on             TEXT NOT NULL,
  last_fetch_status       TEXT CHECK (last_fetch_status IS NULL OR last_fetch_status IN ('ok','refused','failed','too_large')),
  last_fetch_error        TEXT,
  last_fetched_at         TEXT,
  created_by              TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  CHECK ((source_kind = 'url') = (source_url IS NOT NULL)),
  CHECK (source_kind = 'url' OR length(ad_text) >= 1)
);

-- table range_watched_ads: A job ad an org keeps checked: pasted text or a public careers-page URL, with the facts it is checked under and its latest verdict.
-- column range_watched_ads.revision: Bumped by every edit of the ad or its facts; a scan records the revision it checked in scanned_revision.
-- column range_watched_ads.last_rules_fingerprint: Fingerprint of the rule versions in force for the ad's jurisdictions at its last scan; a change makes it due.
-- column range_watched_ads.recruiter_email: The member who saved the ad; the only address a worsening alert is sent to.

CREATE INDEX IF NOT EXISTS range_watched_ads_org_idx ON range_watched_ads (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS range_watched_ads_due_idx ON range_watched_ads (active, next_due_on);

CREATE TABLE IF NOT EXISTS range_scan_runs (
  id           TEXT PRIMARY KEY,
  ad_id        TEXT NOT NULL REFERENCES range_watched_ads(id),
  org_id       TEXT NOT NULL,
  window_key   TEXT NOT NULL,
  reason       TEXT NOT NULL CHECK (reason IN ('new','edited','rules_changed','weekly','manual')),
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('cron','sweep','manual')),
  status       TEXT NOT NULL CHECK (status IN ('claimed','checked','failed')),
  check_id     TEXT REFERENCES range_checks(id),
  error        TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT,
  UNIQUE (ad_id, window_key)
);

-- table range_scan_runs: One claimed scan of one saved ad for one due window ('rev:<n>', 'rules:<fingerprint>', 'week:<date>', 'manual:<id>'). The UNIQUE claim is what makes two ticks scan once.

CREATE INDEX IF NOT EXISTS range_scan_runs_ad_idx ON range_scan_runs (ad_id, started_at DESC);

CREATE TABLE IF NOT EXISTS range_alerts (
  id                 TEXT PRIMARY KEY,
  ad_id              TEXT NOT NULL REFERENCES range_watched_ads(id),
  org_id             TEXT NOT NULL,
  check_id           TEXT NOT NULL REFERENCES range_checks(id),
  previous_check_id  TEXT REFERENCES range_checks(id),
  previous_overall   TEXT,
  overall            TEXT NOT NULL,
  worsened           TEXT NOT NULL DEFAULT '[]',
  recipient          TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending','accepted','failed')),
  notification_id    TEXT,
  error              TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (ad_id, check_id)
);

-- table range_alerts: The alert ledger: one row per saved ad per check whose verdict got worse. 'accepted' means notifications-worker accepted the email, not that it was delivered.

CREATE INDEX IF NOT EXISTS range_alerts_ad_idx ON range_alerts (ad_id, created_at DESC);
