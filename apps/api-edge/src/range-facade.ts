import type { Env } from "./env.js";
import { errorResponse, withEdgeTimings } from "./http.js";
import { replayOrExecute } from "./idempotency.js";
import { resolveActor } from "./resolve-actor.js";
import { createTimings } from "@saas/contracts/timing";

// Rangewise (range-worker). One authenticated lane, /v1/organizations/{org}/…:
// the pay-transparency rules table (pay-rules) and the job-ad check
// (pay-checks). resolveActor → actor headers over the RANGE_WORKER binding,
// like every other org route; the worker runs membership + policy itself.

const RANGE_RE = /^\/v1\/organizations\/[^/]+\/pay-(?:rules|checks)$/;

const FORWARDED_HEADERS = ["content-type", "content-length", "traceparent", "idempotency-key"];
const BODY_METHODS = new Set(["POST", "PATCH", "PUT"]);

export function isRangeRoute(pathname: string): boolean {
  return RANGE_RE.test(pathname);
}

export async function handleRangeRoute(
  request: Request,
  env: Env,
  requestId: string,
  pathname: string,
): Promise<Response> {
  return replayOrExecute(request, requestId, env, "range", async () => {
    if (!env.RANGE_WORKER) {
      return errorResponse("internal_error", "Pay rules service unavailable", 503, requestId);
    }
    if (!env.IDENTITY_WORKER) {
      return errorResponse("internal_error", "Authentication service unavailable", 503, requestId);
    }
    const timings = createTimings();
    const endTotal = timings.start("edge_total");
    const session = await timings.measure("edge_auth", () => resolveActor(request, env, requestId));
    if ("error" in session) return session.error;

    const headers = new Headers();
    headers.set("x-request-id", requestId);
    headers.set("x-actor-subject-id", session.subjectId);
    headers.set("x-actor-subject-type", session.subjectType);
    headers.set("x-actor-email", session.email);
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const url = new URL(request.url);
    const target = new URL(pathname + url.search, "https://range.internal");
    const init: RequestInit = { method: request.method, headers };
    if (BODY_METHODS.has(request.method)) init.body = request.body;

    try {
      const downstream = await timings.measure("edge_downstream", () =>
        env.RANGE_WORKER!.fetch(target.toString(), init),
      );
      const res = new Response(downstream.body, { status: downstream.status, headers: downstream.headers });
      endTotal();
      return withEdgeTimings(res, requestId, "edge.range", timings);
    } catch {
      return errorResponse("internal_error", "Pay rules service unavailable", 503, requestId);
    }
  });
}
