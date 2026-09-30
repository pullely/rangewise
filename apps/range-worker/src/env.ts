export interface Env {
  PLATFORM_DB?: D1Database;
  MEMBERSHIP_WORKER?: Fetcher;
  POLICY_WORKER?: Fetcher;
  /** RW3: the "verdict got worse" email. range-worker is on notifications-worker's internal-caller allow-list since RW1. */
  NOTIFICATIONS_WORKER?: Fetcher;
  ENVIRONMENT: string;
}
