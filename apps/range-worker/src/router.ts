import type { Env } from "./env.js";
import { handleHealth } from "./handlers/health.js";
import { handleListRules } from "./handlers/rules.js";
import { handleRunCheck } from "./handlers/checks.js";
import { errorResponse, methodNotAllowed, notFound } from "./http.js";
import { generateRequestId, parseOrgPublicId } from "./ids.js";

const REQUEST_ID_RE = /^[\w-]{1,128}$/;

export interface ActorContext {
  subjectId: string;
  subjectType: string;
  /** The signed-in email api-edge resolved. */
  email: string | null;
}

function resolveRequestId(request: Request): string {
  const header = request.headers.get("x-request-id");
  return header && REQUEST_ID_RE.test(header) ? header : generateRequestId();
}

/**
 * This worker is unreachable except over a service binding from api-edge, so
 * the actor arrives as headers the edge resolved and set — never as a token.
 */
function resolveActor(request: Request): ActorContext | null {
  const subjectId = request.headers.get("x-actor-subject-id");
  const subjectType = request.headers.get("x-actor-subject-type");
  if (!subjectId || !subjectType) return null;
  const email = request.headers.get("x-actor-email");
  return { subjectId, subjectType, email: email ? email.toLowerCase() : null };
}

// Every route is org-scoped: /v1/organizations/{org}/pay-rules | pay-checks
const RULES_RE = /^\/v1\/organizations\/([^/]+)\/pay-rules$/;
const CHECKS_RE = /^\/v1\/organizations\/([^/]+)\/pay-checks$/;

function unauthenticated(requestId: string): Response {
  return errorResponse("unauthenticated", "Authentication required", 401, requestId);
}

async function routeOrg(request: Request, env: Env, requestId: string, path: string): Promise<Response | null> {
  let m: RegExpMatchArray | null;
  const method = request.method;

  if ((m = path.match(RULES_RE))) {
    const org = parseOrgPublicId(m[1]!);
    if (!org) return notFound(requestId);
    if (method !== "GET") return methodNotAllowed(requestId);
    const actor = resolveActor(request);
    if (!actor) return unauthenticated(requestId);
    return handleListRules(env, requestId, actor, org);
  }
  if ((m = path.match(CHECKS_RE))) {
    const org = parseOrgPublicId(m[1]!);
    if (!org) return notFound(requestId);
    if (method !== "POST") return methodNotAllowed(requestId);
    const actor = resolveActor(request);
    if (!actor) return unauthenticated(requestId);
    return handleRunCheck(request, env, requestId, actor, org);
  }
  return null;
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const requestId = resolveRequestId(request);
  try {
    if (url.pathname === "/health" && request.method === "GET") return handleHealth(env, requestId);
    const response = await routeOrg(request, env, requestId, url.pathname);
    return response ?? notFound(requestId, url.pathname);
  } catch {
    return errorResponse("internal_error", "An unexpected error occurred", 500, requestId);
  }
}
