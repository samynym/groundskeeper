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
    // Every prose/meta edit must cite at least one claim. A claimless edit would otherwise
    // sail past the number gate and reach the judge with an empty passage — a fabrication path.
    if (op.claims.length === 0) failures.push("prose/meta edit must carry at least one cited claim");
    const nums = extractNumbers(text);
    if (nums.length > 0) {
      // each number must be backed by at least one cited source in the claims
      const citedUrls = op.claims.map((c) => c.sourceUrl);
      const backed = nums.every((n) => citedUrls.some((u) => numbersBackedBySource([n], u, ev)));
      if (!backed) failures.push(`prose contains number(s) not backed by a cited fact: ${nums.join(", ")}`);
    }
  }

  if (op.type === "addSource") {
    // The drafter's title/tier/reliabilityScore are free text with no fact-checker (addSource has no
    // judge). A real URL + a fabricated title ("RCT: pain-free at 6 weeks") would be a misattributed
    // YMYL claim. So the whole record must match a canonical source already in the evidence base.
    const canonical = ev.sources.find((s) => s.url === op.source.url);
    if (!canonical) {
      failures.push(`addSource has no canonical source record in the evidence base: ${op.source.url}`);
    } else if (
      canonical.title !== op.source.title ||
      canonical.tier !== op.source.tier ||
      canonical.reliabilityScore !== op.source.reliabilityScore
    ) {
      failures.push(`addSource metadata does not match the canonical record for ${op.source.url}`);
    }
  }

  if (op.type === "promoteToMeasured") {
    if (!ev.knownSourceUrls.has(op.sourceUrl)) failures.push(`promote sourceUrl unknown: ${op.sourceUrl}`);
    // A promote asserts "a source MEASURED this value at this week/band". That is only
    // grounded if the cited source contributes a fact that (a) is itself measured and
    // (b) matches the same week, band, and value. Matching the bare number anywhere in
    // the source's facts is NOT enough — it would launder the curve's own interpolated
    // point (or a coincidental value from another week) into a fabricated "measured" claim.
    const backed = ev.facts.some(
      (f) =>
        f.sourceUrl === op.sourceUrl &&
        f.basis === "measured" &&
        f.week === op.week &&
        f.band === op.band &&
        f.value === op.value,
    );
    if (!backed) failures.push(`promote not backed by a measured fact for ${op.sourceUrl} at week ${op.week} ${op.band}=${op.value}`);
    const basis = await deps.currentBasis(op.procedureSlug, op.week, op.band);
    if (basis !== "interpolated") failures.push(`refusing to promote: current basis is ${basis}, not interpolated`);
  }

  return { op, ok: failures.length === 0, failures };
}
