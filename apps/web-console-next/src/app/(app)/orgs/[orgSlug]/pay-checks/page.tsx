"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ClipboardCheck } from "lucide-react";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/lib/session";
import { useApiQuery, qk } from "@/lib/query";
import { wrap } from "@/lib/api";
import { Citation, VerdictBadge } from "@/components/range/badges";
import {
  BENEFIT_CATEGORY_LABELS,
  RANGE_REMOTE_AREAS,
  RANGE_REMOTE_LABELS,
  RANGE_REQUIREMENT_LABELS,
  describePay,
  type PayCheckRequest,
  type PublicPayCheck,
  type RangeRemoteArea,
} from "@saas/contracts/range";

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
    setBusy(true);
    const r = await wrap(async () => client.range.runCheck(orgId, body));
    setBusy(false);
    if (!r.ok) {
      toast({ kind: "error", title: "Could not check the ad", description: r.error.message });
      return;
    }
    setResult(r.data.check);
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
        <Result check={result} />
      ) : (
        <div className="flex flex-col items-center py-8 text-center text-sm text-muted-foreground">
          <ClipboardCheck className="mb-3 h-8 w-8 text-primary" />
          Nothing checked yet.
        </div>
      )}
    </div>
  );
}

function Result({ check }: { check: PublicPayCheck }) {
  const e = check.extracted;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{check.title || "Result"}</CardTitle>
          <CardDescription>
            Pay found: <span className="font-medium">{describePay(e.pay)}</span>
            {e.pay.text ? <> (&quot;{e.pay.text}&quot;)</> : null}
            {e.vaguePay.length ? <> · vague wording: {e.vaguePay.join(", ")}</> : null}
            <br />
            Benefits found: {e.benefits.length ? e.benefits.map((b) => BENEFIT_CATEGORY_LABELS[b]).join(", ") : "none"}
            {e.benefitFiller.length ? <> · filler: {e.benefitFiller.join(", ")}</> : null}
            <br />
            Checked for {check.checkDate}, {check.employeeCount} employees, rules {check.rulesVersion}.
          </CardDescription>
        </div>
        <VerdictBadge verdict={check.overall} />
      </CardHeader>
      <CardContent>
        <Table>
          <THead>
            <TR>
              <TH>Jurisdiction</TH>
              <TH>Verdict</TH>
              <TH>Deciding rule</TH>
              <TH>Source</TH>
            </TR>
          </THead>
          <TBody>
            {check.results.map((r) => (
              <TR key={r.location}>
                <TD className="align-top">
                  <div className="font-medium">{r.jurisdictionName}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.location}
                    {r.via === "remote" ? " · via remote" : ""}
                  </div>
                </TD>
                <TD className="align-top">
                  <VerdictBadge verdict={r.verdict} />
                </TD>
                <TD className="align-top max-w-lg text-sm">
                  {r.deciding ? (
                    <>
                      <div className="font-medium">{RANGE_REQUIREMENT_LABELS[r.deciding.requirement]}</div>
                      <div className="text-xs text-muted-foreground">{r.deciding.explanation}</div>
                    </>
                  ) : (
                    "—"
                  )}
                </TD>
                <TD className="align-top">
                  <Citation citation={r.citation} sourceUrl={r.sourceUrl} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardContent>
    </Card>
  );
}
