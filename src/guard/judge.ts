import { z } from "zod";
import type { LlmClient } from "../llm/client.js";

const Verdict = z.object({ supported: z.boolean(), reason: z.string() });

const SYSTEM = [
  "You are an adversarial fact-checker for a medical (YMYL) content pipeline.",
  "You are given ONE claim and the cited source passage.",
  "Answer ONLY whether the passage directly supports the claim.",
  'Reply with STRICT JSON: {"supported": boolean, "reason": string}. No prose outside JSON.',
  "If the passage does not clearly and directly support the claim, set supported=false.",
  "When uncertain, default to supported=false.",
].join(" ");

export async function judgeClaim(
  llm: LlmClient,
  claim: string,
  passage: string,
): Promise<{ supported: boolean; reason: string }> {
  const user = `CLAIM:\n${claim}\n\nCITED PASSAGE:\n${passage}`;
  let raw: string;
  try {
    raw = await llm.complete({ system: SYSTEM, user, maxTokens: 300 });
  } catch (e) {
    return { supported: false, reason: `judge error, reject: ${(e as Error).message}` };
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { supported: false, reason: "unparseable judge output, default reject" };
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return { supported: false, reason: "unparseable judge output, default reject" };
  }
  const parsed = Verdict.safeParse(obj);
  if (!parsed.success) return { supported: false, reason: "unparseable judge output, default reject" };
  return parsed.data;
}
