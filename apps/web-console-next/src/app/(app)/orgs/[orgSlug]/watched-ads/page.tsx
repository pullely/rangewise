"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BellRing } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { VerdictBadge } from "@/components/range/badges";
import { RANGE_REMOTE_AREAS, RANGE_REMOTE_LABELS, type RangeRemoteArea, type SaveWatchedAdRequest } from "@saas/contracts/range";

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mt-3 mb-1";

export default function WatchedAdsPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const ads = useApiQuery(qk.watchedAds(orgId), () => wrap(async () => client.range.listWatchedAds(orgId)));
  const rules = useApiQuery(qk.payRules(orgId), () => wrap(async () => client.range.listRules(orgId)));
  const [source, setSource] = React.useState<"text" | "url">("text");
  const [title, setTitle] = React.useState("");
  const [adText, setAdText] = React.useState("");
  const [sourceUrl, setSourceUrl] = React.useState("");
  const [locations, setLocations] = React.useState<string[]>([]);
  const [remote, setRemote] = React.useState<RangeRemoteArea>("none");
  const [employees, setEmployees] = React.useState("50");
  const [busy, setBusy] = React.useState(false);
  const toggle = (code: string) => setLocations((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));

  async function saveAd(e: React.FormEvent) {
    e.preventDefault();
    const body: SaveWatchedAdRequest = {
      title,
      locations,
      remote,
      employeeCount: Number(employees),
      ...(source === "url" ? { sourceUrl } : { adText }),
    };
    setBusy(true);
    const r = await wrap(async () => client.range.saveWatchedAd(orgId, body));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not save the ad", description: r.error.message });
      return;
    }
    toast({ kind: "success", title: "Saved", description: "It is checked at the next daily sweep, then every week and whenever a rule changes." });
    setTitle("");
    setAdText("");
    setSourceUrl("");
    ads.reload();
  }

  async function sweep() {
    setBusy(true);
    const r = await wrap(async () => client.range.sweepWatchedAds(orgId));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Sweep failed", description: r.error.message });
      return;
    }
    const alerts = r.data.scanned.filter((s) => s.alert).length;
    toast({ kind: "success", title: `Scanned ${r.data.scanned.length} due ad(s)`, description: alerts ? `${alerts} got worse; the recruiter was emailed.` : "No verdict got worse." });
    ads.reload();
  }

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Saved ads</h1>
          <p className="text-sm text-muted-foreground">
            Ads Rangewise keeps checked: every day at 06:00 UTC it re-checks the ones that are new or edited, a week old, or
            checked against a rule that has since changed, and emails the member who saved an ad when its verdict gets worse.
          </p>
        </div>
        <Button variant="outline" disabled={busy} onClick={() => void sweep()}>
          Run today&apos;s sweep now
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Save an ad</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveAd} className="grid max-w-4xl gap-x-4 sm:grid-cols-2">
            <div className="sm:col-span-2 flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" checked={source === "text"} onChange={() => setSource("text")} /> Paste the ad
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={source === "url"} onChange={() => setSource("url")} /> A public careers-page URL
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className={FIELD} htmlFor="w-title">Title (optional)</label>
              <Input id="w-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              {source === "text" ? (
                <>
                  <label className={FIELD} htmlFor="w-ad">The ad</label>
                  <Textarea id="w-ad" rows={8} value={adText} onChange={(e) => setAdText(e.target.value)} required />
                </>
              ) : (
                <>
                  <label className={FIELD} htmlFor="w-url">Careers-page URL (https, public)</label>
                  <Input id="w-url" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://careers.example.com/jobs/123" required />
                </>
              )}
            </div>
            <fieldset className="sm:col-span-2">
              <legend className={FIELD}>Where the role can be done</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {(rules.data?.jurisdictions ?? []).map((j) => (
                  <label key={j.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={locations.includes(j.code)} onChange={() => toggle(j.code)} />
                    {j.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className={FIELD} htmlFor="w-remote">Remote</label>
              <select id="w-remote" className={SELECT} value={remote} onChange={(e) => setRemote(e.target.value as RangeRemoteArea)}>
                {RANGE_REMOTE_AREAS.map((a) => (
                  <option key={a} value={a}>{RANGE_REMOTE_LABELS[a]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD} htmlFor="w-employees">Employer headcount</label>
              <Input id="w-employees" type="number" min={1} value={employees} onChange={(e) => setEmployees(e.target.value)} required />
            </div>
            <div className="mt-5 sm:col-span-2">
              <Button type="submit" disabled={busy || (locations.length === 0 && remote === "none")}>
                Save the ad
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {ads.loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (ads.data?.ads.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
          <BellRing className="mb-3 h-8 w-8 text-primary" />
          No saved ads yet.
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <Table>
              <THead>
                <TR>
                  <TH>Ad</TH>
                  <TH>Source</TH>
                  <TH>Last checked</TH>
                  <TH>Next due</TH>
                  <TH>Verdict</TH>
                </TR>
              </THead>
              <TBody>
                {ads.data!.ads.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      <Link className="underline" href={`/orgs/${orgSlug}/watched-ads/${a.id}`}>
                        {a.title || a.id}
                      </Link>
                      {a.active ? null : <span className="text-xs text-muted-foreground"> · paused</span>}
                    </TD>
                    <TD className="text-xs">{a.sourceKind === "url" ? a.sourceUrl : "pasted text"}</TD>
                    <TD className="text-xs">{a.lastCheckedAt ? a.lastCheckedAt.slice(0, 16).replace("T", " ") : "not yet"}</TD>
                    <TD className="text-xs">{a.nextDueOn}</TD>
                    <TD>{a.lastOverall ? <VerdictBadge verdict={a.lastOverall} /> : <span className="text-xs text-muted-foreground">pending</span>}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
