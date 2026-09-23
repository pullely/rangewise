import type { Env } from "./env.js";
import type { RangeRepository } from "@saas/db/range";
import type { SqlExecutor } from "@saas/db/d1";
import { createRangeRepository } from "@saas/db/range";
import { createSqlExecutor } from "@saas/db/d1";

export interface Db {
  executor: SqlExecutor;
  range: RangeRepository;
}

/** Open the request's database handle, or null when the binding is missing. */
export function openDb(env: Env): (Db & { dispose(): Promise<void> }) | null {
  if (!env.PLATFORM_DB) return null;
  const executor = createSqlExecutor(env.PLATFORM_DB);
  return { executor, range: createRangeRepository(executor), dispose: () => executor.dispose() };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayUtc(now: string = nowIso()): string {
  return now.slice(0, 10);
}
