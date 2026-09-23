import { Badge } from "@/components/ui/badge";
import { RANGE_VERDICT_LABELS, type RangeVerdict } from "@saas/contracts/range";

const VERDICT_VARIANT: Record<RangeVerdict, "default" | "secondary" | "destructive" | "warning" | "success" | "outline"> = {
  pass: "success",
  fail: "destructive",
  review: "warning",
  not_applicable: "secondary",
  not_in_force: "secondary",
  not_covered: "outline",
};

export function VerdictBadge({ verdict }: { verdict: RangeVerdict }) {
  return <Badge variant={VERDICT_VARIANT[verdict] ?? "outline"}>{RANGE_VERDICT_LABELS[verdict] ?? verdict}</Badge>;
}

/** A citation, linked to the source it was read from when there is one. */
export function Citation({ citation, sourceUrl }: { citation: string | null; sourceUrl: string | null }) {
  if (!citation) return <span className="text-xs text-muted-foreground">—</span>;
  return sourceUrl ? (
    <a className="text-xs underline" href={sourceUrl} target="_blank" rel="noreferrer noopener">
      {citation}
    </a>
  ) : (
    <span className="text-xs">{citation}</span>
  );
}
