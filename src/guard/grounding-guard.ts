import type { Basis, Draft, EvidenceSet, GuardResult, GuardVerdict } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import { mechanicalGuard, type MechanicalDeps } from "./mechanical.js";
import { judgeClaim } from "./judge.js";

/** Human-readable label shown to the judge for each fact's provenance. */
function factKind(basis: Basis | undefined): string {
  if (basis === "measured") return "measured study value";
  if (basis === "interpolated") return "SITE ESTIMATE, not a measured study value";
  return "reference";
}

export class GroundingGuard {
  constructor(private llm: LlmClient, private deps: MechanicalDeps) {}

  async check(draft: Draft, ev: EvidenceSet): Promise<GuardResult> {
    const verdicts: GuardVerdict[] = [];

    for (const op of draft.ops) {
      const mech = await mechanicalGuard(op, ev, this.deps);
      if (!mech.ok) { verdicts.push(mech); continue; }

      const failures: string[] = [];
      if (op.type === "replaceProse" || op.type === "updateMeta") {
        const text = op.type === "replaceProse" ? op.newText : op.value;
        const citedUrls = op.claims.map((c) => c.sourceUrl);

        // C1: fail closed — if any cited source has no evidentiary fact, reject without judging
        for (const url of citedUrls) {
          if (!ev.facts.some((f) => f.sourceUrl === url)) {
            failures.push(`cited source has no evidentiary fact: ${url}`);
          }
        }

        // C2: judge the FULL prose text against all facts from cited sources (one call, not per-claim).
        // Each passage line is prefixed with its source title and basis, so the judge can (a) refuse to
        // let a "site estimate" back a "study measured/reported" claim and (b) catch cross-source
        // misattribution. Without the basis, a correct judge would launder interpolated guesses.
        if (failures.length === 0) {
          const cited = ev.facts.filter((f) => citedUrls.includes(f.sourceUrl));
          const passage = cited.map((f) => `[${f.sourceTitle} — ${factKind(f.basis)}] ${f.claimText}`).join("\n");
          // Fail closed: never judge against an empty passage (a claimless/factless edit must not ship).
          if (cited.length === 0) {
            failures.push("no cited evidentiary passage to judge against");
          } else {
            const v = await judgeClaim(this.llm, text, passage);
            if (!v.supported) failures.push(`judge rejected prose: ${v.reason}`);
          }
        }
      }
      verdicts.push({ op, ok: failures.length === 0, failures });
    }

    const passedOps = verdicts.filter((v) => v.ok).map((v) => v.op);
    return { verdicts, passedOps, allPassed: passedOps.length === draft.ops.length };
  }
}
