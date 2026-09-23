"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { Citation } from "@/components/range/badges";
import { RANGE_SOURCE_KIND_LABELS, type PublicPayRule } from "@saas/contracts/range";

export default function PayRulesPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const rules = useApiQuery(qk.payRules(orgId), () => wrap(async () => client.range.listRules(orgId)));

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Pay rules</h1>
        <p className="text-sm text-muted-foreground">
          The rules every check is run against. Each one was read from the statute or the enforcing agency&apos;s
          official guidance, on the date shown. Rangewise is not legal advice.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Jurisdictions</CardTitle>
          <CardDescription>
            A rule changes by a new version with its own start date, never by editing the old one.
            {rules.data ? ` Rules version ${rules.data.rulesVersion}.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rules.loading ? (
            <Skeleton className="h-40 w-full" />
          ) : rules.error ? (
            <p className="text-sm text-destructive">{rules.error.message}</p>
          ) : (
            <RulesTable rules={rules.data?.rules ?? []} />
          )}
        </CardContent>
      </Card>

      {rules.data && rules.data.notCovered.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Not covered yet</CardTitle>
            <CardDescription>
              These places have pay-transparency rules according to secondary sources, but Rangewise could not read
              their primary text, so it does not guess. A check that names one says &quot;not covered&quot;.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {rules.data.notCovered.map((n) => (
                <li key={n.code}>
                  <span className="font-medium">{n.code}</span>: {n.reason}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RulesTable({ rules }: { rules: PublicPayRule[] }) {
  return (
    <Table>
      <THead>
        <TR>
          <TH>Jurisdiction</TH>
          <TH>In force from</TH>
          <TH>Employer size</TH>
          <TH>What the ad must show</TH>
          <TH>Source</TH>
        </TR>
      </THead>
      <TBody>
        {rules.map((r) => (
          <TR key={r.id}>
            <TD className="align-top">
              <div className="font-medium">{r.jurisdictionName}</div>
              <div className="text-xs text-muted-foreground">{r.id}</div>
            </TD>
            <TD className="align-top whitespace-nowrap text-sm">
              {r.effectiveFrom}
              {r.effectiveTo ? ` to ${r.effectiveTo}` : ""}
            </TD>
            <TD className="align-top text-sm">
              {r.minEmployees}+ {r.employeeScope}
            </TD>
            <TD className="align-top max-w-md text-sm">
              <div className="mb-1 flex flex-wrap gap-1">
                {r.payObligation === "on_request" ? (
                  <Badge variant="secondary">advice only</Badge>
                ) : (
                  <Badge variant="default">pay range required</Badge>
                )}
                {r.benefitsRequired && <Badge variant="outline">benefits described</Badge>}
                {r.singleFigure === "review" && <Badge variant="outline">single figure: review</Badge>}
                {r.maxSpreadPct !== null && (
                  <Badge variant="warning">
                    spread ≤ {r.maxSpreadPct}%{r.spreadStatus === "proposed" ? " (proposed)" : ""}
                  </Badge>
                )}
                <Badge variant="outline">remote: {r.remoteCoverage}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{r.summary}</p>
            </TD>
            <TD className="align-top text-sm">
              <Citation citation={r.citation} sourceUrl={r.sourceUrl} />
              <div className="text-xs text-muted-foreground">
                {RANGE_SOURCE_KIND_LABELS[r.sourceKind]}, read {r.verifiedOn}
              </div>
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
