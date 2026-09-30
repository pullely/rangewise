import type { Env } from "./env.js";
import { route } from "./router.js";
import { openDb } from "./context.js";
import { generateRequestId } from "./ids.js";
import { SYSTEM_ACTOR, runSweep } from "./watch.js";

/** The daily sweep over every org (RW3): new, edited, rules-changed and weekly-due saved ads, each claimed once per window. */
export async function runScheduledSweep(env: Env, scheduledTime: number): Promise<void> {
  const db = openDb(env);
  if (!db) return;
  const requestId = generateRequestId();
  try {
    const r = await runSweep(env, db, { now: new Date(scheduledTime).toISOString(), orgId: null, triggeredBy: "cron", actor: SYSTEM_ACTOR, requestId });
    // eslint-disable-next-line no-console -- one structured line per daily run
    console.log(
      JSON.stringify({
        level: "info",
        msg: "range watch sweep",
        requestId,
        today: r.today,
        considered: r.considered,
        scanned: r.scanned.length,
        failed: r.scanned.filter((s) => s.status === "failed").length,
        alerted: r.scanned.filter((s) => s.alert).length,
        alreadyClaimed: r.alreadyClaimed,
      }),
    );
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "range watch sweep failed", requestId }));
  } finally {
    await db.dispose();
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return route(request, env);
  },

  /** Daily at 06:00 UTC (wrangler `triggers.crons`). */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledSweep(env, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
