"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { VerdictBadge } from "@/components/range/badges";
import { RANGE_REQUIREMENT_LABELS, type ComplianceReportResponse, type RangeRequirement } from "@saas/contracts/range";

/** The same columns and formula guard as the API's ?format=csv. */
function toCsv(report: ComplianceReportResponse): string {
  const cell = (v: string | null): string => {
    let s = v ?? "";
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const rows = [["ad_id", "title", "source", "last_checked_at", "overall", "location", "jurisdiction", "verdict", "rule_id", "deciding_rule", "explanation"]];
  for (const a of report.ads) {
    const base = [a.adId, a.title, a.source, a.lastCheckedAt, a.overall];
    if (a.jurisdictions.length === 0) rows.push([...base, "", "", "", "", "", ""] as string[]);
    for (const j of a.jurisdictions) rows.push([...base, j.location, j.jurisdictionName, j.verdict, j.ruleId, j.deciding, j.explanation] as string[]);
  }
  return rows.map((r) => r.map((c) => cell(c)).join(",")).join("\r\n") + "\r\n";
}

export default function ComplianceReportPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const report = useApiQuery(qk.complianceReport(orgId), () => wrap(async () => client.range.complianceReport(orgId)));

  function download() {
    if (!report.data) return;
    const url = URL.createObjectURL(new Blob([toCsv(report.data)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `rangewise-compliance-${report.data.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (report.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (report.error || !report.data) return <p className="text-sm text-destructive">{report.error?.message ?? "Unavailable"}</p>;
  const r = report.data;
  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Compliance report</h1>
          <p className="text-sm text-muted-foreground">
            Each <Link className="underline" href={`/orgs/${orgSlug}/watched-ads`}>saved ad</Link>&apos;s latest verdict per jurisdiction, with the rule
            that decided it. Rules {r.rulesVersion}; generated {r.generatedAt.slice(0, 16).replace("T", " ")} UTC. Not legal advice.
          </p>
        </div>
        <Button variant="outline" onClick={download}>
          Download CSV
        </Button>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Totals</CardTitle>
          <CardDescription>
            {Object.entries(r.totals)
              .filter(([, n]) => n > 0)
              .map(([v, n]) => `${n} ${v.replace("_", " ")}`)
              .join(" · ") || "No saved ads yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Ad</TH>
                <TH>Jurisdiction</TH>
                <TH>Verdict</TH>
                <TH>Deciding rule</TH>
              </TR>
            </THead>
            <TBody>
              {r.ads.flatMap((a) =>
                (a.jurisdictions.length ? a.jurisdictions : [null]).map((j, i) => (
                  <TR key={`${a.adId}-${j?.location ?? "pending"}`}>
                    <TD className="text-sm">{i === 0 ? <Link className="underline" href={`/orgs/${orgSlug}/watched-ads/${a.adId}`}>{a.title || a.adId}</Link> : null}</TD>
                    <TD className="text-xs">{j ? `${j.jurisdictionName} (${j.location})` : "—"}</TD>
                    <TD>{j ? <VerdictBadge verdict={j.verdict} /> : <span className="text-xs text-muted-foreground">pending</span>}</TD>
                    <TD className="max-w-lg text-xs">
                      {j?.deciding ? `${RANGE_REQUIREMENT_LABELS[j.deciding as RangeRequirement] ?? j.deciding} · ${j.ruleId ?? ""}` : ""}
                    </TD>
                  </TR>
                )),
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
