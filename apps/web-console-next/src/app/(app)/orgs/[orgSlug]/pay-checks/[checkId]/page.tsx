"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { VerdictBadge } from "@/components/range/badges";
import { CheckResult } from "@/components/range/result";
import { RANGE_VERDICT_LABELS } from "@saas/contracts/range";

export default function PayCheckDetailPage() {
  const params = useParams<{ orgSlug: string; checkId: string }>();
  const slug = params?.orgSlug ?? "";
  const checkId = params?.checkId ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} checkId={checkId} />}</OrgScope>;
}

function Inner({ orgId, orgSlug, checkId }: { orgId: string; orgSlug: string; checkId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const detail = useApiQuery(qk.payCheck(orgId, checkId), () => wrap(async () => client.range.getCheck(orgId, checkId)));
  const [editing, setEditing] = React.useState(false);
  const [adText, setAdText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function recheck(edited: boolean) {
    setBusy(true);
    const r = await wrap(async () => client.range.recheck(orgId, checkId, edited ? { adText } : {}));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not re-check", description: r.error.message });
      return;
    }
    const changed = r.data.changes.length
      ? r.data.changes.map((c) => `${c.location}: ${c.from ? RANGE_VERDICT_LABELS[c.from] : "—"} → ${c.to ? RANGE_VERDICT_LABELS[c.to] : "—"}`).join("; ")
      : "no verdict changed";
    toast({ kind: "success", title: "Re-checked", description: changed });
    router.push(`/orgs/${orgSlug}/pay-checks/${r.data.check.id}`);
  }

  if (detail.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (detail.error || !detail.data) return <p className="text-sm text-destructive">{detail.error?.message ?? "Not found"}</p>;
  const { check, lineage } = detail.data;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{check.title || "Stored check"}</h1>
          <p className="text-sm text-muted-foreground">
            {check.id} · checked {check.checkedAt.slice(0, 16).replace("T", " ")} UTC ·{" "}
            <Link className="underline" href={`/orgs/${orgSlug}/pay-checks`}>
              all checks
            </Link>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void recheck(false)}>
            Re-check against today&apos;s rules
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setAdText(detail.data!.adText);
              setEditing((v) => !v);
            }}
          >
            Edit the ad
          </Button>
        </div>
      </header>

      {editing ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Textarea rows={10} value={adText} onChange={(e) => setAdText(e.target.value)} aria-label="The edited ad" />
            <Button disabled={busy || !adText.trim()} onClick={() => void recheck(true)}>
              {busy ? "Checking…" : "Re-check the edited ad"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <CheckResult check={check} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">The ad as checked</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="whitespace-pre-wrap text-sm">{detail.data.adText}</pre>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This ad&apos;s checks</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <TR>
                <TH>Checked</TH>
                <TH>Check</TH>
                <TH>Rules</TH>
                <TH>Verdict</TH>
              </TR>
            </THead>
            <TBody>
              {lineage.map((l) => (
                <TR key={l.id}>
                  <TD className="text-xs">{l.checkedAt.slice(0, 16).replace("T", " ")}</TD>
                  <TD className="text-xs">
                    {l.id === check.id ? (
                      <span className="font-medium">{l.id} (this one)</span>
                    ) : (
                      <Link className="underline" href={`/orgs/${orgSlug}/pay-checks/${l.id}`}>
                        {l.id}
                      </Link>
                    )}
                    {l.recheckedFrom ? " · re-check" : " · original"}
                  </TD>
                  <TD className="text-xs">{l.ruleIds.join(", ")}</TD>
                  <TD>
                    <VerdictBadge verdict={l.overall} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
