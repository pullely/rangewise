import type { SqlExecutor, SqlRow } from "../d1/executor.js";

/**
 * Saved ads, their scan claims and the alert ledger (RW3, migration
 * 220_range_watch). Every write returns the rows it touched (`RETURNING`) and
 * callers count those, never `rowCount` — on D1 `rowCount` is the number of
 * rows RETURNED, so a write without RETURNING always reports 0 (trap 22).
 */

type Row = SqlRow & Record<string, unknown>;

export interface WatchedAdRow {
  id: string;
  orgId: string;
  title: string;
  sourceKind: "text" | "url";
  sourceUrl: string | null;
  adText: string;
  locations: string[];
  remote: "none" | "us" | "eu" | "anywhere";
  employeeCount: number;
  recruiterEmail: string;
  active: boolean;
  revision: number;
  scannedRevision: number;
  lastCheckId: string | null;
  lastOverall: string | null;
  lastRulesFingerprint: string | null;
  lastCheckedAt: string | null;
  nextDueOn: string;
  lastFetchStatus: "ok" | "refused" | "failed" | "too_large" | null;
  lastFetchError: string | null;
  lastFetchedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WatchedAdEdit {
  title?: string | undefined;
  adText?: string | undefined;
  sourceUrl?: string | undefined;
  locations?: string[] | undefined;
  remote?: WatchedAdRow["remote"] | undefined;
  employeeCount?: number | undefined;
  active?: boolean | undefined;
}

export interface ScanClaim {
  id: string;
  adId: string;
  orgId: string;
  windowKey: string;
  reason: "new" | "edited" | "rules_changed" | "weekly" | "manual";
  triggeredBy: "cron" | "sweep" | "manual";
  startedAt: string;
  /** A failed claim of the same window may be retried once on a later day. */
  today: string;
}

export interface AlertRow {
  id: string;
  adId: string;
  orgId: string;
  checkId: string;
  previousCheckId: string | null;
  previousOverall: string | null;
  overall: string;
  /** JSON array of {location, from, to}. */
  worsened: string;
  recipient: string;
  status: "pending" | "accepted" | "failed";
  notificationId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportRow {
  ad: WatchedAdRow;
  resultJson: string | null;
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function jsonArray(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const AD_COLUMNS = `id, org_id, title, source_kind, source_url, ad_text, locations, remote, employee_count, recruiter_email, active,
  revision, scanned_revision, last_check_id, last_overall, last_rules_fingerprint, last_checked_at, next_due_on,
  last_fetch_status, last_fetch_error, last_fetched_at, created_by, created_at, updated_at`;

function mapAd(row: Row, prefix = ""): WatchedAdRow {
  const r = (k: string): unknown => row[`${prefix}${k}`];
  return {
    id: r("id") as string,
    orgId: r("org_id") as string,
    title: (r("title") as string) ?? "",
    sourceKind: r("source_kind") as WatchedAdRow["sourceKind"],
    sourceUrl: str(r("source_url")),
    adText: (r("ad_text") as string) ?? "",
    locations: jsonArray(r("locations")),
    remote: r("remote") as WatchedAdRow["remote"],
    employeeCount: Number(r("employee_count")),
    recruiterEmail: r("recruiter_email") as string,
    active: Number(r("active")) === 1,
    revision: Number(r("revision")),
    scannedRevision: Number(r("scanned_revision")),
    lastCheckId: str(r("last_check_id")),
    lastOverall: str(r("last_overall")),
    lastRulesFingerprint: str(r("last_rules_fingerprint")),
    lastCheckedAt: str(r("last_checked_at")),
    nextDueOn: r("next_due_on") as string,
    lastFetchStatus: str(r("last_fetch_status")) as WatchedAdRow["lastFetchStatus"],
    lastFetchError: str(r("last_fetch_error")),
    lastFetchedAt: str(r("last_fetched_at")),
    createdBy: str(r("created_by")),
    createdAt: r("created_at") as string,
    updatedAt: r("updated_at") as string,
  };
}

function mapAlert(row: Row): AlertRow {
  return {
    id: row.id as string,
    adId: row.ad_id as string,
    orgId: row.org_id as string,
    checkId: row.check_id as string,
    previousCheckId: str(row.previous_check_id),
    previousOverall: str(row.previous_overall),
    overall: row.overall as string,
    worsened: (row.worsened as string) ?? "[]",
    recipient: row.recipient as string,
    status: row.status as AlertRow["status"],
    notificationId: str(row.notification_id),
    error: str(row.error),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export interface RangeWatchRepository {
  insertAd(ad: WatchedAdRow): Promise<boolean>;
  getAd(orgId: string, id: string): Promise<WatchedAdRow | null>;
  listAds(orgId: string, limit: number): Promise<WatchedAdRow[]>;
  /** Active ads the sweep looks at, soonest due first; one org or (the cron) all of them. */
  listActiveAds(orgId: string | null, limit: number): Promise<WatchedAdRow[]>;
  /**
   * Apply an edit. A change to the ad or its facts bumps `revision` and makes
   * the ad due today; toggling `active` alone does not. Null when not found.
   */
  editAd(orgId: string, id: string, edit: WatchedAdEdit, bumpRevision: boolean, now: string, today: string): Promise<WatchedAdRow | null>;
  /** Record a fetch of a URL ad (and the text it gave, when it gave one). */
  recordFetch(id: string, fetch: { status: NonNullable<WatchedAdRow["lastFetchStatus"]>; error: string | null; at: string; adText?: string | undefined }): Promise<boolean>;
  /** Record a completed scan: the check, its verdict and rules fingerprint, the revision it covered, and the next due date. */
  recordScan(
    id: string,
    scan: { checkId: string; overall: string; rulesFingerprint: string; checkedAt: string; scannedRevision: number; nextDueOn: string },
  ): Promise<boolean>;
  /** Claim one due window of one ad. Returns the run id when this caller won the claim, else null. */
  claimScan(claim: ScanClaim): Promise<string | null>;
  finishScan(runId: string, result: { status: "checked" | "failed"; checkId: string | null; error: string | null; finishedAt: string }): Promise<boolean>;
  /** Write an alert row; false when this ad already has one for this check (UNIQUE ad_id, check_id). */
  insertAlert(alert: AlertRow): Promise<boolean>;
  updateAlert(id: string, result: { status: AlertRow["status"]; notificationId: string | null; error: string | null; updatedAt: string }): Promise<boolean>;
  listAlerts(orgId: string, adId: string, limit: number): Promise<AlertRow[]>;
  /** Every saved ad of an org with its latest check's result, oldest saved first. */
  reportRows(orgId: string): Promise<ReportRow[]>;
}

export function createRangeWatchRepository(executor: SqlExecutor): RangeWatchRepository {
  const one = async (sql: string, params: unknown[]): Promise<boolean> => (await executor.execute<Row>(sql, params)).rows.length === 1;
  return {
    async insertAd(a) {
      return one(
        `INSERT INTO range_watched_ads (${AD_COLUMNS})
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          a.id, a.orgId, a.title, a.sourceKind, a.sourceUrl, a.adText, JSON.stringify(a.locations), a.remote, a.employeeCount,
          a.recruiterEmail, a.active ? 1 : 0, a.revision, a.scannedRevision, a.lastCheckId, a.lastOverall, a.lastRulesFingerprint,
          a.lastCheckedAt, a.nextDueOn, a.lastFetchStatus, a.lastFetchError, a.lastFetchedAt, a.createdBy, a.createdAt, a.updatedAt,
        ],
      );
    },

    async getAd(orgId, id) {
      const r = await executor.execute<Row>(`SELECT ${AD_COLUMNS} FROM range_watched_ads WHERE org_id = $1 AND id = $2`, [orgId, id]);
      return r.rows[0] ? mapAd(r.rows[0]) : null;
    },

    async listAds(orgId, limit) {
      const r = await executor.execute<Row>(
        `SELECT ${AD_COLUMNS} FROM range_watched_ads WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
        [orgId, limit],
      );
      return r.rows.map((row) => mapAd(row));
    },

    async listActiveAds(orgId, limit) {
      const r = orgId
        ? await executor.execute<Row>(
            `SELECT ${AD_COLUMNS} FROM range_watched_ads WHERE active = 1 AND org_id = $1 ORDER BY next_due_on, id LIMIT $2`,
            [orgId, limit],
          )
        : await executor.execute<Row>(`SELECT ${AD_COLUMNS} FROM range_watched_ads WHERE active = 1 ORDER BY next_due_on, id LIMIT $1`, [limit]);
      return r.rows.map((row) => mapAd(row));
    },

    async editAd(orgId, id, e, bump, now, today) {
      const r = await executor.execute<Row>(
        `UPDATE range_watched_ads SET
           title = COALESCE($3, title),
           ad_text = COALESCE($4, ad_text),
           source_url = COALESCE($5, source_url),
           locations = COALESCE($6, locations),
           remote = COALESCE($7, remote),
           employee_count = COALESCE($8, employee_count),
           active = COALESCE($9, active),
           revision = revision + $10,
           next_due_on = CASE WHEN $10 = 1 THEN $12 ELSE next_due_on END,
           updated_at = $11
         WHERE org_id = $1 AND id = $2
         RETURNING ${AD_COLUMNS}`,
        [
          orgId,
          id,
          e.title ?? null,
          e.adText ?? null,
          e.sourceUrl ?? null,
          e.locations ? JSON.stringify(e.locations) : null,
          e.remote ?? null,
          e.employeeCount ?? null,
          e.active === undefined ? null : e.active ? 1 : 0,
          bump ? 1 : 0,
          now,
          today,
        ],
      );
      return r.rows[0] ? mapAd(r.rows[0]) : null;
    },

    async recordFetch(id, f) {
      return one(
        `UPDATE range_watched_ads SET last_fetch_status = $2, last_fetch_error = $3, last_fetched_at = $4, ad_text = COALESCE($5, ad_text)
         WHERE id = $1 RETURNING id`,
        [id, f.status, f.error, f.at, f.adText ?? null],
      );
    },

    async recordScan(id, s) {
      return one(
        `UPDATE range_watched_ads SET last_check_id = $2, last_overall = $3, last_rules_fingerprint = $4, last_checked_at = $5,
           scanned_revision = MAX(scanned_revision, $6), next_due_on = $7
         WHERE id = $1 RETURNING id`,
        [id, s.checkId, s.overall, s.rulesFingerprint, s.checkedAt, s.scannedRevision, s.nextDueOn],
      );
    },

    async claimScan(c) {
      const r = await executor.execute<Row>(
        `INSERT INTO range_scan_runs (id, ad_id, org_id, window_key, reason, triggered_by, status, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'claimed', $7)
         ON CONFLICT (ad_id, window_key) DO UPDATE SET status = 'claimed', started_at = excluded.started_at,
           triggered_by = excluded.triggered_by, error = NULL, finished_at = NULL
         WHERE range_scan_runs.status = 'failed' AND substr(range_scan_runs.started_at, 1, 10) < $8
         RETURNING id`,
        [c.id, c.adId, c.orgId, c.windowKey, c.reason, c.triggeredBy, c.startedAt, c.today],
      );
      return r.rows[0] ? String(r.rows[0].id) : null;
    },

    async finishScan(runId, f) {
      return one(`UPDATE range_scan_runs SET status = $2, check_id = $3, error = $4, finished_at = $5 WHERE id = $1 RETURNING id`, [
        runId,
        f.status,
        f.checkId,
        f.error,
        f.finishedAt,
      ]);
    },

    async insertAlert(a) {
      return one(
        `INSERT INTO range_alerts (id, ad_id, org_id, check_id, previous_check_id, previous_overall, overall, worsened, recipient,
           status, notification_id, error, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (ad_id, check_id) DO NOTHING
         RETURNING id`,
        [a.id, a.adId, a.orgId, a.checkId, a.previousCheckId, a.previousOverall, a.overall, a.worsened, a.recipient, a.status, a.notificationId, a.error, a.createdAt, a.updatedAt],
      );
    },

    async updateAlert(id, u) {
      return one(`UPDATE range_alerts SET status = $2, notification_id = $3, error = $4, updated_at = $5 WHERE id = $1 RETURNING id`, [
        id,
        u.status,
        u.notificationId,
        u.error,
        u.updatedAt,
      ]);
    },

    async listAlerts(orgId, adId, limit) {
      const r = await executor.execute<Row>(
        `SELECT id, ad_id, org_id, check_id, previous_check_id, previous_overall, overall, worsened, recipient, status,
                notification_id, error, created_at, updated_at
           FROM range_alerts WHERE org_id = $1 AND ad_id = $2 ORDER BY created_at DESC, id DESC LIMIT $3`,
        [orgId, adId, limit],
      );
      return r.rows.map(mapAlert);
    },

    async reportRows(orgId) {
      const cols = AD_COLUMNS.split(",")
        .map((c) => c.trim())
        .map((c) => `a.${c} AS a_${c}`)
        .join(", ");
      const r = await executor.execute<Row>(
        `SELECT ${cols}, c.result_json AS c_result_json
           FROM range_watched_ads a
           LEFT JOIN range_checks c ON c.id = a.last_check_id AND c.org_id = a.org_id
          WHERE a.org_id = $1
          ORDER BY a.created_at, a.id
          LIMIT 1000`,
        [orgId],
      );
      return r.rows.map((row) => ({ ad: mapAd(row, "a_"), resultJson: str(row.c_result_json) }));
    },
  };
}
