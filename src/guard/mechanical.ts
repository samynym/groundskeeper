import type { Basis, EditOp, EvidenceSet, GuardVerdict } from "../types.js";
import { claimsOf } from "../types.js";
import { extractNumbers } from "../evidence/retriever.js";

export interface MechanicalDeps {
  currentBasis(procedureSlug: string, week: number, band: "low" | "typical" | "high"): Promise<Basis | null>;
}

function numbersBackedBySource(nums: number[], sourceUrl: string, ev: EvidenceSet): boolean {
  const allowed = new Set<number>();
  for (const f of ev.facts) if (f.sourceUrl === sourceUrl) for (const n of f.numbers) allowed.add(n);
  return nums.every((n) => allowed.has(n));
}

export async function mechanicalGuard(op: EditOp, ev: EvidenceSet, deps: MechanicalDeps): Promise<GuardVerdict> {
  const failures: string[] = [];

  // Rule 1: no invented source URLs anywhere.
  for (const c of claimsOf(op)) {
    if (!ev.knownSourceUrls.has(c.sourceUrl)) failures.push(`unknown sourceUrl: ${c.sourceUrl}`);
  }

  if (op.type === "replaceProse" || op.type === "updateMeta") {
    const text = op.type === "replaceProse" ? op.newText : op.value;
    const nums = extractNumbers(text);
    if (nums.length > 0) {
      // each number must be backed by at least one cited source in the claims
      const citedUrls = op.claims.map((c) => c.sourceUrl);
      const backed = nums.every((n) => citedUrls.some((u) => numbersBackedBySource([n], u, ev)));
      if (!backed) failures.push(`prose contains number(s) not backed by a cited fact: ${nums.join(", ")}`);
      if (op.claims.length === 0) failures.push("prose asserts numbers but carries no claims");
    }
  }

  if (op.type === "addSource") {
    if (!ev.knownSourceUrls.has(op.source.url)) failures.push(`addSource url not in evidence base: ${op.source.url}`);
  }

  if (op.type === "promoteToMeasured") {
    if (!ev.knownSourceUrls.has(op.sourceUrl)) failures.push(`promote sourceUrl unknown: ${op.sourceUrl}`);
    if (!numbersBackedBySource([op.value], op.sourceUrl, ev)) failures.push(`promote value ${op.value} not found in that source's facts`);
    const basis = await deps.currentBasis(op.procedureSlug, op.week, op.band);
    if (basis !== "interpolated") failures.push(`refusing to promote: current basis is ${basis}, not interpolated`);
  }

  return { op, ok: failures.length === 0, failures };
}
