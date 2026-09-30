"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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

export default function WatchedAdPage() {
  const params = useParams<{ orgSlug: string; adId: string }>();
  const slug = params?.orgSlug ?? "";
  const adId = params?.adId ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} adId={adId} />}</OrgScope>;
}

function Inner({ orgId, orgSlug, adId }: { orgId: string; orgSlug: string; adId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const detail = useApiQuery(qk.watchedAd(orgId, adId), () => wrap(async () => client.range.getWatchedAd(orgId, adId)));
  const [editing, setEditing] = React.useState(false);
  const [adText, setAdText] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    const r = await wrap(async () => fn());
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: `${label} failed`, description: r.error.message });
      return;
    }
    toast({ kind: "success", title: label });
    setEditing(false);
    detail.reload();
  }

  if (detail.loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (detail.error || !detail.data) return <p className="text-sm text-destructive">{detail.error?.message ?? "Not found"}</p>;
  const { ad, lastCheck, alerts } = detail.data;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{ad.title || "Saved ad"}</h1>
          <p className="text-sm text-muted-foreground">
            {ad.sourceKind === "url" ? ad.sourceUrl : "Pasted text"} · alerts go to {ad.recruiterEmail} · next due {ad.nextDueOn}
            {ad.active ? "" : " · paused"} ·{" "}
            <Link className="underline" href={`/orgs/${orgSlug}/watched-ads`}>
              all saved ads
            </Link>
          </p>
          {ad.lastFetch && ad.lastFetch.status !== "ok" ? (
            <p className="text-sm text-destructive">Last fetch: {ad.lastFetch.status} — {ad.lastFetch.error}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void act("Scanned", () => client.range.scanWatchedAd(orgId, adId))}>
            Scan now
          </Button>
          {ad.sourceKind === "text" ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAdText(ad.adText);
                setEditing((v) => !v);
              }}
            >
              Edit the ad
            </Button>
          ) : null}
          <Button variant="outline" disabled={busy} onClick={() => void act(ad.active ? "Paused" : "Resumed", () => client.range.updateWatchedAd(orgId, adId, { active: !ad.active }))}>
            {ad.active ? "Pause" : "Resume"}
          </Button>
        </div>
      </header>

      {editing ? (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <Textarea rows={10} value={adText} onChange={(e) => setAdText(e.target.value)} aria-label="The edited ad" />
            <Button disabled={busy || !adText.trim()} onClick={() => void act("Saved; due at the next sweep", () => client.range.updateWatchedAd(orgId, adId, { adText }))}>
              Save the edit
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {lastCheck ? (
        <CheckResult
          check={lastCheck}
          footer={
            <p className="mt-3 text-sm">
              <Link className="underline" href={`/orgs/${orgSlug}/pay-checks/${lastCheck.id}`}>
                Open this check and its history
              </Link>
            </p>
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">Not checked yet: it is checked at the next daily sweep, or now with Scan now.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alerts</CardTitle>
        </CardHeader>
        <CardContent>
          {alerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No verdict has got worse.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Change</TH>
                  <TH>Email</TH>
                  <TH>Verdict</TH>
                </TR>
              </THead>
              <TBody>
                {alerts.map((a) => (
                  <TR key={a.id}>
                    <TD className="text-xs">{a.createdAt.slice(0, 16).replace("T", " ")}</TD>
                    <TD className="text-xs">
                      {a.worsened.map((w) => `${w.location}: ${w.from ? RANGE_VERDICT_LABELS[w.from] : "—"} → ${w.to ? RANGE_VERDICT_LABELS[w.to] : "—"}`).join("; ")}
                    </TD>
                    <TD className="text-xs">
                      {a.recipient} · {a.status === "accepted" ? "accepted for sending" : a.status}
                    </TD>
                    <TD>
                      <VerdictBadge verdict={a.overall} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
