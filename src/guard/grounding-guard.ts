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
        const claims = op.claims;
        for (const c of claims) {
          const passage = ev.facts.find((f) => f.sourceUrl === c.sourceUrl)?.claimText ?? c.text;
          const v = await judgeClaim(this.llm, c.text, passage);
          if (!v.supported) failures.push(`judge rejected "${c.text}": ${v.reason}`);
        }
      }
      verdicts.push({ op, ok: failures.length === 0, failures });
    }

    const passedOps = verdicts.filter((v) => v.ok).map((v) => v.op);
    return { verdicts, passedOps, allPassed: passedOps.length === draft.ops.length };
  }
}
