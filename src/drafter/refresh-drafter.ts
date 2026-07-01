import { z } from "zod";
import type { Candidate, Draft, EditOp, EvidenceSet } from "../types.js";
import { claimsOf } from "../types.js";
import type { LlmClient } from "../llm/client.js";
import type { ReadContent } from "../content-source/index.js";
import { DRAFTER_SYSTEM, drafterUser } from "./prompts.js";

const SourceSchema = z.object({ title: z.string(), url: z.string(), tier: z.string(), reliabilityScore: z.number() });
const ClaimSchema = z.object({ text: z.string(), sourceUrl: z.string() });
const OpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("replaceProse"), procedureSlug: z.string(), field: z.string(), oldText: z.string(), newText: z.string(), claims: z.array(ClaimSchema) }),
  z.object({ type: z.literal("addSource"), procedureSlug: z.string(), source: SourceSchema }),
  z.object({ type: z.literal("updateMeta"), procedureSlug: z.string(), week: z.number().nullable(), field: z.enum(["title", "description"]), value: z.string(), claims: z.array(ClaimSchema) }),
  z.object({ type: z.literal("promoteToMeasured"), procedureSlug: z.string(), week: z.number(), band: z.enum(["low", "typical", "high"]), value: z.number(), sourceUrl: z.string(), nativeScale: z.string() }),
]);
const ReplySchema = z.object({ rationale: z.string(), ops: z.array(OpSchema) });

export class RefreshDrafter {
  constructor(private llm: LlmClient) {}

  async draft(candidate: Candidate, content: ReadContent, ev: EvidenceSet): Promise<Draft> {
    const user = drafterUser(candidate, content, ev);
    let parsed = await this.tryOnce(user);
    if (!parsed) parsed = await this.tryOnce(user + "\n\nYour previous reply was not valid JSON. Reply with STRICT JSON only.");
    const ops: EditOp[] = (parsed?.ops ?? []).filter((op) => claimsOf(op).every((c) => ev.knownSourceUrls.has(c.sourceUrl)));
    return { ref: candidate.ref, ops, rationale: parsed?.rationale ?? "" };
  }

  private async tryOnce(user: string): Promise<{ rationale: string; ops: EditOp[] } | null> {
    const raw = await this.llm.complete({ system: DRAFTER_SYSTEM, user, maxTokens: 4096 });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      const p = ReplySchema.safeParse(JSON.parse(match[0]));
      return p.success ? (p.data as { rationale: string; ops: EditOp[] }) : null;
    } catch {
      return null;
    }
  }
}
