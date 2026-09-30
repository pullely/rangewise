import * as React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Citation, VerdictBadge } from "@/components/range/badges";
import {
  BENEFIT_CATEGORY_LABELS,
  NON_PAY_LABELS,
  RANGE_REQUIREMENT_LABELS,
  describePay,
  type PublicPayCheck,
} from "@saas/contracts/range";

/**
 * One check's result: the pay found (every statement, with its place), the
 * money that is not pay, and a row per jurisdiction with the deciding rule,
 * the pay applied to it and the ad text each finding was read from.
 */
export function CheckResult({ check, footer }: { check: PublicPayCheck; footer?: React.ReactNode }) {
  const e = check.extracted;
  const statements = e.statements ?? [];
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="text-base">{check.title || "Result"}</CardTitle>
          <CardDescription>
            Pay found: <span className="font-medium">{describePay(e.pay)}</span>
            {e.pay.text ? <> (&quot;{e.pay.text}&quot;)</> : null}
            {e.vaguePay.length ? <> · vague wording: {e.vaguePay.join(", ")}</> : null}
            {statements.length > 1 ? (
              <>
                <br />
                Every pay statement:{" "}
                {statements.map((s, i) => (
                  <span key={i}>
                    {i ? "; " : ""}
                    {s.scope ? `${s.scope}: ` : ""}
                    {describePay(s)}
                  </span>
                ))}
              </>
            ) : null}
            {e.nonPay?.length ? (
              <>
                <br />
                Not pay: {e.nonPay.map((n) => `${NON_PAY_LABELS[n.kind]} ("${n.text}")`).join("; ")}
              </>
            ) : null}
            <br />
            Benefits found: {e.benefits.length ? e.benefits.map((b) => BENEFIT_CATEGORY_LABELS[b]).join(", ") : "none"}
            {e.benefitFiller.length ? <> · filler: {e.benefitFiller.join(", ")}</> : null}
            <br />
            Checked for {check.checkDate}, {check.employeeCount} employees, rules {check.rulesVersion}
            {check.ruleIds?.length ? <> ({check.ruleIds.join(", ")})</> : null}.
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
                    {r.ruleId ? ` · ${r.ruleId}` : ""}
                  </div>
                  {r.pay && r.pay.kind !== "none" ? <div className="text-xs">{describePay(r.pay)}</div> : null}
                </TD>
                <TD className="align-top">
                  <VerdictBadge verdict={r.verdict} />
                </TD>
                <TD className="align-top max-w-lg text-sm">
                  {r.deciding ? (
                    <>
                      <div className="font-medium">{RANGE_REQUIREMENT_LABELS[r.deciding.requirement]}</div>
                      <div className="text-xs text-muted-foreground">{r.deciding.explanation}</div>
                      {r.deciding.evidence?.length ? (
                        <div className="mt-1 text-xs">
                          From the ad: {r.deciding.evidence.map((ev) => `"${ev.text}"`).join(", ")}
                        </div>
                      ) : null}
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
        {footer}
      </CardContent>
    </Card>
  );
}
