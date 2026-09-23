import type { RangeJurisdiction, RangeRule } from "@saas/db/range";
import type { PublicJurisdiction, PublicPayRule } from "@saas/contracts/range";

export function toPublicRule(rule: RangeRule): PublicPayRule {
  return { ...rule };
}

export function toPublicJurisdiction(j: RangeJurisdiction): PublicJurisdiction {
  return { code: j.code, name: j.name, kind: j.kind, country: j.country };
}

/** A short, stable fingerprint of the rules table: every rule id with its dates. */
export async function rulesFingerprint(rules: readonly RangeRule[]): Promise<string> {
  const basis = rules
    .map((r) => `${r.id}:${r.effectiveFrom}:${r.effectiveTo ?? ""}:${r.verifiedOn}`)
    .sort()
    .join("|");
  return `rules_${(await sha256Hex(basis)).slice(0, 16)}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
