"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
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
import { CheckResult } from "@/components/range/result";
import {
  RANGE_REMOTE_AREAS,
  RANGE_REMOTE_LABELS,
  RANGE_VERDICTS,
  RANGE_VERDICT_LABELS,
  type PayCheckRequest,
  type PublicPayCheck,
  type RangeRemoteArea,
} from "@saas/contracts/range";

/** The last locations, remote area and headcount, per viewer and org (browser storage; a convenience, never required). */
const lastInputsKey = (orgId: string): string => `rangewise.lastCheck.${orgId}`;
interface LastInputs {
  locations: string[];
  remote: RangeRemoteArea;
  employees: string;
}
function readLast(orgId: string): LastInputs | null {
  try {
    const raw = window.localStorage.getItem(lastInputsKey(orgId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastInputs>;
    if (!Array.isArray(v.locations) || typeof v.remote !== "string" || typeof v.employees !== "string") return null;
    return { locations: v.locations.map(String), remote: v.remote as RangeRemoteArea, employees: v.employees };
  } catch {
    return null;
  }
}
function writeLast(orgId: string, v: LastInputs): void {
  try {
    window.localStorage.setItem(lastInputsKey(orgId), JSON.stringify(v));
  } catch {
    /* storage unavailable: nothing to remember */
  }
}

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const FIELD = "block text-sm font-medium mt-3 mb-1";

export default function PayChecksPage() {
  const params = useParams<{ orgSlug: string }>();
  const slug = params?.orgSlug ?? "";
  return <OrgScope slug={slug}>{(org) => <Inner orgId={org.id} orgSlug={slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const rules = useApiQuery(qk.payRules(orgId), () => wrap(async () => client.range.listRules(orgId)));
  const [title, setTitle] = React.useState("");
  const [adText, setAdText] = React.useState("");
  const [locations, setLocations] = React.useState<string[]>([]);
  const [remote, setRemote] = React.useState<RangeRemoteArea>("none");
  const [employees, setEmployees] = React.useState("50");
  const [checkDate, setCheckDate] = React.useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<PublicPayCheck | null>(null);
  const [filter, setFilter] = React.useState("");
  const history = useApiQuery(qk.payChecks(orgId, filter), () =>
    wrap(async () => client.range.listChecks(orgId, filter ? { overall: filter as PublicPayCheck["overall"], limit: 25 } : { limit: 25 })),
  );

  React.useEffect(() => {
    const last = readLast(orgId);
    if (last) {
      setLocations(last.locations);
      setRemote(last.remote);
      setEmployees(last.employees);
    }
  }, [orgId]);

  const jurisdictions = rules.data?.jurisdictions ?? [];
  const toggle = (code: string) =>
    setLocations((l) => (l.includes(code) ? l.filter((x) => x !== code) : [...l, code]));

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const body: PayCheckRequest = {
      title,
      adText,
      locations,
      remote,
      employeeCount: Number(employees),
      checkDate,
    };
    writeLast(orgId, { locations, remote, employees });
    setBusy(true);
    const r = await wrap(async () => client.range.runCheck(orgId, body));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not check the ad", description: r.error.message });
      return;
    }
    setResult(r.data.check);
    history.reload();
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Check an ad</h1>
        <p className="text-sm text-muted-foreground">
          Paste a job ad, say where the role can be done and how many people the employer has. Each jurisdiction gets a
          verdict and the rule that decided it, with its source. See the{" "}
          <Link className="underline" href={`/orgs/${orgSlug}/pay-rules`}>
            pay rules
          </Link>
          . Rangewise is not legal advice.
        </p>
      </header>

      <Card>
        <CardContent className="pt-6">
          <form onSubmit={run} className="grid max-w-4xl gap-x-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={FIELD} htmlFor="c-title">Title (optional)</label>
              <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Accountant, Denver" />
            </div>
            <div className="sm:col-span-2">
              <label className={FIELD} htmlFor="c-ad">The ad</label>
              <Textarea
                id="c-ad"
                rows={10}
                value={adText}
                onChange={(e) => setAdText(e.target.value)}
                placeholder="Paste the whole ad, including pay and benefits."
                required
              />
            </div>
            <fieldset className="sm:col-span-2">
              <legend className={FIELD}>Where the role can be done</legend>
              <div className="grid gap-1 sm:grid-cols-3">
                {jurisdictions.map((j) => (
                  <label key={j.code} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={locations.includes(j.code)} onChange={() => toggle(j.code)} />
                    {j.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <label className={FIELD} htmlFor="c-remote">Remote</label>
              <select id="c-remote" className={SELECT} value={remote} onChange={(e) => setRemote(e.target.value as RangeRemoteArea)}>
                {RANGE_REMOTE_AREAS.map((a) => (
                  <option key={a} value={a}>{RANGE_REMOTE_LABELS[a]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD} htmlFor="c-employees">Employer headcount</label>
              <Input id="c-employees" type="number" min={1} value={employees} onChange={(e) => setEmployees(e.target.value)} required />
            </div>
            <div>
              <label className={FIELD} htmlFor="c-date">Check against the rules in force on</label>
              <Input id="c-date" type="date" value={checkDate} onChange={(e) => setCheckDate(e.target.value)} required />
            </div>
            <div className="mt-5 flex items-end gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy || (locations.length === 0 && remote === "none")}>
                {busy ? "Checking…" : "Check the ad"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {result ? (
        <CheckResult
          check={result}
          footer={
            <p className="mt-3 text-sm">
              Stored as{" "}
              <Link className="underline" href={`/orgs/${orgSlug}/pay-checks/${result.id}`}>
                {result.id}
              </Link>
              : open it to see the evidence or re-check it later.
            </p>
          }
        />
      ) : (
        <div className="flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
          <ClipboardCheck className="mb-3 h-8 w-8 text-primary" />
          Nothing checked yet.
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Check history</CardTitle>
          <select aria-label="Filter by verdict" className="h-8 rounded-md border bg-background px-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">Every verdict</option>
            {RANGE_VERDICTS.map((v) => (
              <option key={v} value={v}>{RANGE_VERDICT_LABELS[v]}</option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {history.loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : history.error ? (
            <p className="text-sm text-destructive">{history.error.message}</p>
          ) : (history.data?.checks.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No stored checks yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Checked</TH>
                  <TH>Ad</TH>
                  <TH>Pay</TH>
                  <TH>Where</TH>
                  <TH>Verdict</TH>
                </TR>
              </THead>
              <TBody>
                {history.data!.checks.map((c) => (
                  <TR key={c.id}>
                    <TD className="text-xs">{c.checkedAt.slice(0, 16).replace("T", " ")}</TD>
                    <TD>
                      <Link className="underline" href={`/orgs/${orgSlug}/pay-checks/${c.id}`}>
                        {c.title || `ad ${c.adSha256.slice(0, 8)}`}
                      </Link>
                      {c.recheckedFrom ? <span className="text-xs text-muted-foreground"> · re-check</span> : null}
                    </TD>
                    <TD className="text-xs">{c.payText}</TD>
                    <TD className="text-xs">{[...c.locations, ...(c.remote !== "none" ? [RANGE_REMOTE_LABELS[c.remote]] : [])].join(", ")}</TD>
                    <TD>
                      <VerdictBadge verdict={c.overall} />
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
