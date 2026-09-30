import type {
  ListPayChecksResponse,
  ListPayRulesResponse,
  PayCheckDetailResponse,
  PayCheckRequest,
  PayCheckResponse,
  RangeVerdict,
  RecheckRequest,
  RecheckResponse,
} from "@saas/contracts/range";

import type { RequestOptions, Transport } from "./transport.js";

const org = (orgId: string): string => `/v1/organizations/${encodeURIComponent(orgId)}`;

/**
 * Rangewise client — the pay-transparency rules table and the job-ad check.
 * Org-scoped; maps to `apps/range-worker` through the api-edge range facade.
 */
export class RangeClient {
  constructor(private readonly transport: Transport) {}

  /** GET /v1/organizations/:orgId/pay-rules — every rule version, with its citation and source. */
  listRules(orgId: string, opts: RequestOptions = {}): Promise<ListPayRulesResponse> {
    return this.transport.request<ListPayRulesResponse>({ method: "GET", path: `${org(orgId)}/pay-rules` }, opts);
  }

  /** POST /v1/organizations/:orgId/pay-checks — check one ad; a verdict per jurisdiction with the deciding rule. */
  runCheck(orgId: string, body: PayCheckRequest, opts: RequestOptions = {}): Promise<PayCheckResponse> {
    return this.transport.request<PayCheckResponse>({ method: "POST", path: `${org(orgId)}/pay-checks`, body }, opts);
  }

  /** GET /v1/organizations/:orgId/pay-checks — the stored check history, newest first. */
  listChecks(orgId: string, query: { overall?: RangeVerdict; limit?: number; cursor?: string } = {}, opts: RequestOptions = {}): Promise<ListPayChecksResponse> {
    return this.transport.request<ListPayChecksResponse>(
      { method: "GET", path: `${org(orgId)}/pay-checks`, query: { overall: query.overall, limit: query.limit, cursor: query.cursor } },
      opts,
    );
  }

  /** GET /v1/organizations/:orgId/pay-checks/:checkId — one stored check with its ad text, evidence and lineage. */
  getCheck(orgId: string, checkId: string, opts: RequestOptions = {}): Promise<PayCheckDetailResponse> {
    return this.transport.request<PayCheckDetailResponse>({ method: "GET", path: `${org(orgId)}/pay-checks/${encodeURIComponent(checkId)}` }, opts);
  }

  /** POST /v1/organizations/:orgId/pay-checks/:checkId/recheck — a new check in the same lineage (optionally of an edited ad). */
  recheck(orgId: string, checkId: string, body: RecheckRequest = {}, opts: RequestOptions = {}): Promise<RecheckResponse> {
    return this.transport.request<RecheckResponse>({ method: "POST", path: `${org(orgId)}/pay-checks/${encodeURIComponent(checkId)}/recheck`, body }, opts);
  }
}
