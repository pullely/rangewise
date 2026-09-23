import type { ListPayRulesResponse, PayCheckRequest, PayCheckResponse } from "@saas/contracts/range";

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
}
