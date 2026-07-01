import type { Draft, EvidenceSet, GuardResult, GuardVerdict } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import { mechanicalGuard, type MechanicalDeps } from "./mechanical.js";
import { judgeClaim } from "./judge.js";

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

        // C2: judge the FULL prose text against all facts from cited sources (one call, not per-claim)
        if (failures.length === 0) {
          const passage = ev.facts
            .filter((f) => citedUrls.includes(f.sourceUrl))
            .map((f) => f.claimText)
            .join("\n");
          const v = await judgeClaim(this.llm, text, passage);
          if (!v.supported) failures.push(`judge rejected prose: ${v.reason}`);
        }
      }
      verdicts.push({ op, ok: failures.length === 0, failures });
    }

    const passedOps = verdicts.filter((v) => v.ok).map((v) => v.op);
    return { verdicts, passedOps, allPassed: passedOps.length === draft.ops.length };
  }
}
