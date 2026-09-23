import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { D1ApiAdapter } from "@saas/db/runner";
import type { Env } from "@range-worker/env";

// A real SQLite engine under the worker, not a mocked executor: D1 is SQLite,
// so a statement node:sqlite runs is a statement D1 runs — including the
// RETURNING-based writes this context relies on (runbook trap 22).

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = resolve(__dirname, "../../..", "packages/db/src/migrations");

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const dirs = readdirSync(MIGRATIONS_ROOT)
    .filter((d) => existsSync(join(MIGRATIONS_ROOT, d, "up.sql")))
    .sort();
  for (const dir of dirs) {
    const sql = readFileSync(join(MIGRATIONS_ROOT, dir, "up.sql"), "utf8");
    for (const statement of D1ApiAdapter.splitStatements(sql)) db.exec(statement);
  }
  return db;
}

export function d1Over(db: DatabaseSync): D1Database {
  return {
    prepare(query: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        all<T>() {
          const rows = db.prepare(query).all(...(bound as never[])) as T[];
          return Promise.resolve({ results: rows, success: true, meta: {} });
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

export const OWNER = "11111111-1111-4111-8111-111111111111";
export const MEMBER = "22222222-2222-4222-8222-222222222222";
export const VIEWER = "33333333-3333-4333-8333-333333333333";
export const STRANGER = "99999999-9999-4999-8999-999999999999";

/**
 * membership-worker + policy-worker stand-ins, mirroring the policy engine:
 * OWNER is an org owner and MEMBER a builder (both read the rules and run checks);
 * VIEWER only reads the rules; STRANGER is nobody.
 */
const ROLE: Record<string, string> = { [OWNER]: "owner", [MEMBER]: "builder", [VIEWER]: "viewer" };
const ROLE_ACTIONS: Record<string, ReadonlySet<string>> = {
  owner: new Set(["range.read", "range.write"]),
  builder: new Set(["range.read", "range.write"]),
  viewer: new Set(["range.read"]),
};

export function fakeFleet(): { MEMBERSHIP_WORKER: Fetcher; POLICY_WORKER: Fetcher } {
  const membership = {
    async fetch(_url: string, init: RequestInit) {
      const body = JSON.parse(String(init.body)) as { subject: { id: string } };
      const role = ROLE[body.subject.id] ?? null;
      return Response.json({ data: { memberships: role ? [{ kind: "organization", role }] : [] } });
    },
  };
  const policy = {
    async fetch(_url: string, init: RequestInit) {
      const body = JSON.parse(String(init.body)) as { subject: { id: string }; action: string };
      const role = ROLE[body.subject.id];
      const allow = role !== undefined && (ROLE_ACTIONS[role]?.has(body.action) ?? false);
      return Response.json({ data: { allow } });
    },
  };
  return {
    MEMBERSHIP_WORKER: membership as unknown as Fetcher,
    POLICY_WORKER: policy as unknown as Fetcher,
  };
}

export interface TestWorld {
  env: Env;
  db: DatabaseSync;
}

export function world(): TestWorld {
  const db = migratedDatabase();
  const fleet = fakeFleet();
  const env = {
    ENVIRONMENT: "test",
    PLATFORM_DB: d1Over(db),
    MEMBERSHIP_WORKER: fleet.MEMBERSHIP_WORKER,
    POLICY_WORKER: fleet.POLICY_WORKER,
  } as Env;
  return { env, db };
}

export const EMAILS: Record<string, string> = {
  [OWNER]: "owner@acme.example",
  [MEMBER]: "builder@acme.example",
  [VIEWER]: "viewer@acme.example",
  [STRANGER]: "stranger@elsewhere.example",
};

/** The headers api-edge sets after resolving the session. */
export function as(subjectId: string): Record<string, string> {
  return {
    "x-actor-subject-id": subjectId,
    "x-actor-subject-type": "user",
    "x-actor-email": EMAILS[subjectId] ?? "someone@example.com",
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test payloads are asserted field by field
export async function json(res: Response): Promise<Record<string, any>> {
  return (await res.json()) as Record<string, any>;
}
