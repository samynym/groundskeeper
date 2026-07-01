import type { Candidate, EvidenceSet } from "../types.js";
import type { ReadContent } from "../content-source/index.js";

export const DRAFTER_SYSTEM = [
  "You maintain a medical (YMYL) recovery-timeline site. You may ONLY state facts that appear in the provided EVIDENCE.",
  "You cannot invent sources or numbers. Every numeric claim must cite a source URL from the ALLOWED SOURCES list.",
  "Return STRICT JSON only: { \"rationale\": string, \"ops\": EditOp[] }.",
  "EditOp is one of:",
  '  {"type":"replaceProse","procedureSlug","field","oldText","newText","claims":[{"text","sourceUrl"}]}',
  '  {"type":"addSource","procedureSlug","source":{"title","url","tier","reliabilityScore"}}',
  '  {"type":"updateMeta","procedureSlug","week":number|null,"field":"title"|"description","value","claims":[...]}',
  '  {"type":"promoteToMeasured","procedureSlug","week":number,"band":"low"|"typical"|"high","value":number,"sourceUrl","nativeScale"}',
  "Prefer 1-3 high-confidence ops. If nothing can be improved within the evidence, return an empty ops array.",
].join("\n");

export function drafterUser(candidate: Candidate, content: ReadContent, ev: EvidenceSet): string {
  const allowed = [...ev.knownSourceUrls].map((u) => `- ${u}`).join("\n");
  const facts = ev.facts.map((f) => `- (${f.sourceUrl}) ${f.claimText}`).join("\n");
  const prose = Object.entries(content.prose).map(([k, v]) => `[${k}] ${v}`).join("\n");
  return [
    `TARGET: ${candidate.ref.procedureSlug} (${candidate.ref.url})`,
    `WHY SELECTED: ${candidate.reasons.join("; ")}`,
    `\nALLOWED SOURCES:\n${allowed}`,
    `\nEVIDENCE FACTS:\n${facts}`,
    `\nCURRENT PROSE:\n${prose}`,
  ].join("\n");
}
