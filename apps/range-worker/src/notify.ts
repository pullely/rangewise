import { buildIdempotencyKey, enqueueNotification } from "@saas/notifications-client";
import { RANGE_REQUIREMENT_LABELS, RANGE_VERDICT_LABELS, type PublicPayCheck, type VerdictChange } from "@saas/contracts/range";
import type { WatchedAdRow } from "@saas/db/range";
import type { Env } from "./env.js";
import type { ActorContext } from "./router.js";
import { watchedAdPublicId } from "./ids.js";

export type SendResult = { ok: true; notificationId: string } | { ok: false; reason: string };

/**
 * Email the recruiter who saved an ad that its verdict got worse. Idempotent
 * per alert, so a retried scan never emails twice (the alert ledger's UNIQUE
 * row already guards it). "ok" means notifications-worker ACCEPTED the send;
 * delivery is out of our hands (runbook trap 27: no sending domain is held).
 */
export async function sendWorsened(
  env: Env,
  requestId: string,
  actor: ActorContext,
  ad: WatchedAdRow,
  change: { alertId: string; before: PublicPayCheck; after: PublicPayCheck; worse: VerdictChange[] },
): Promise<SendResult> {
  try {
    const lines = change.worse.map((w) => {
      const r = change.after.results.find((x) => x.location === w.location);
      const why = r?.deciding ? ` — ${RANGE_REQUIREMENT_LABELS[r.deciding.requirement]}: ${r.deciding.explanation}` : "";
      const from = w.from ? RANGE_VERDICT_LABELS[w.from] : "—";
      const to = w.to ? RANGE_VERDICT_LABELS[w.to] : "—";
      return `${r?.jurisdictionName ?? w.location}: ${from} → ${to}${why}`;
    });
    const result = await enqueueNotification(
      env,
      { internalActor: "range-worker", actorSubjectType: actor.subjectType, actorSubjectId: actor.subjectId, requestId },
      {
        orgId: ad.orgId,
        category: "product",
        templateKey: "range.ad.worsened",
        templateData: {
          adTitle: ad.title || "Untitled ad",
          adId: watchedAdPublicId(ad.id),
          sourceUrl: ad.sourceUrl ?? "",
          previousOverall: RANGE_VERDICT_LABELS[change.before.overall],
          overall: RANGE_VERDICT_LABELS[change.after.overall],
          changes: lines.join("\n"),
          checkId: change.after.id,
          checkDate: change.after.checkDate,
        },
        recipient: { channel: "email", address: ad.recruiterEmail },
        idempotencyKey: buildIdempotencyKey("range.ad.worsened", watchedAdPublicId(ad.id), change.after.id),
      },
    );
    return result.ok ? { ok: true, notificationId: result.notificationId } : { ok: false, reason: result.reason };
  } catch {
    return { ok: false, reason: "threw" };
  }
}
