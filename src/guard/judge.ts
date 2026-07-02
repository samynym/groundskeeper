import { z } from "zod";
import type { LlmClient } from "../llm/client.js";

const Verdict = z.object({ supported: z.boolean(), reason: z.string() });

const SYSTEM = [
  "You are an adversarial fact-checker for a medical (YMYL) content pipeline.",
  "You are given ONE claim and CITED EVIDENCE LINES. Each line is prefixed with [<source title> — <kind>].",
  "kind is one of:",
  "'measured study value' = a real figure that source actually reported;",
  "'SITE ESTIMATE, not a measured study value' = the site's own interpolated guess, which NO study measured or reported;",
  "'reference' = a supporting statement of fact.",
  "Answer ONLY whether the evidence lines directly support the claim.",
  "RULES:",
  "1. If the claim says or implies that research/a study/data MEASURED, REPORTED, FOUND, SHOWED, or PUBLISHED a value, it may rely ONLY on 'measured study value' lines. A 'SITE ESTIMATE' line can NEVER support a claim of measurement, reporting, or publication.",
  "2. A claim must not attribute one source's figure to a different source.",
  "3. The claim must not assert anything (numbers, timeframes, scales, comparisons) the lines do not directly state.",
  "4. When uncertain, set supported=false.",
  'Reply with STRICT JSON: {"supported": boolean, "reason": string}. No prose outside JSON.',
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
