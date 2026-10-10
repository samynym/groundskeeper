import type { TargetSet } from "../measure/targets.js";
import type { RungResult } from "./prober.js";

/**
 * Discovery answers: does the assistant NAME the product, and does it say
 * something false about it? Citation (classify.ts) only sees URLs; an answer
 * can recommend "Steady" by name without linking growsteady.me.
 *
 * Heuristic, pure, and conservative. The flags are prompts for a human to
 * read the raw answer (kept in snapshot.raw), not verdicts.
 */

/**
 * "Steady" as a proper noun, case-sensitive. The lookahead drops the usual
 * adjective uses that start a sentence ("Steady progress", "Steady-state").
 */
const NAME_RE = /\bSteady\b(?![\s-]+(?:progress|pace|state|improvements?|gains?|increases?|rate|growth|decline|recovery)\b)/;

export type FalseClaim =
  /** Says Steady charts your full recovery history / trajectory against research. */
  | "TRAJECTORY_VS_RESEARCH"
  /** Says Steady compares you with other patients / users. */
  | "COMPARES_WITH_OTHER_PATIENTS";

export interface MentionCheck {
  named: boolean;
  /** What matched: "Steady" and/or the configured brand phrases found. */
  matched: string[];
  falseClaims: FalseClaim[];
}

const TRAJECTORY_RE = /\b(?:trajector(?:y|ies)|history|histories|curves?|over time|(?:whole|full|entire) recovery)\b/i;
const RESEARCH_RE = /\b(?:research|stud(?:y|ies)|published|literature|clinical (?:data|outcomes|norms)|evidence|benchmarks?)\b/i;
const OTHERS_RE = /\b(?:other|similar|fellow|real)\s+(?:patients|users|people|athletes|members)\b(?!\s+in\s+(?:published\s+)?(?:studies|research|trials|the literature))|\bothers\s+(?:who|with|recovering)\b|\b(?:peer|community)[\s-](?:data|comparisons?|benchmarks?)\b/i;
const COMPARE_RE = /\b(?:compar\w*|benchmark\w*|against|versus|vs\.?|stack(?:s)? up|relative to|match\w*)\b/i;

function hasName(text: string, phrases: string[]): string[] {
  const out: string[] = [];
  if (NAME_RE.test(text)) out.push("Steady");
  const lower = text.toLowerCase();
  for (const p of phrases) if (p && lower.includes(p.toLowerCase()) && !out.includes(p)) out.push(p);
  return out;
}

/** Paragraphs and top-level list items, each with its indented continuation lines. */
function blocks(text: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) out.push(cur.join("\n")); cur = []; };
  for (const line of text.split("\n")) {
    if (line.trim() === "") { flush(); continue; }
    if (/^(?:[-*+]\s|\d+[.)]\s|#)/.test(line)) flush(); // a new top-level item or heading
    cur.push(line);
  }
  flush();
  return out;
}

const sentences = (block: string): string[] =>
  block.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

export function checkMention(answerText: string, brandPhrases: string[]): MentionCheck {
  const phrases = brandPhrases.filter((p) => p.trim() !== "");
  const matched = hasName(answerText, phrases);
  const falseClaims = new Set<FalseClaim>();
  // Claims are read only in the block that names the product, from the first
  // naming sentence on — so a claim about a competitor listed earlier is not
  // pinned on Steady.
  for (const block of blocks(answerText)) {
    const ss = sentences(block);
    const first = ss.findIndex((s) => hasName(s, phrases).length > 0);
    if (first === -1) continue;
    for (const s of ss.slice(first)) {
      if (TRAJECTORY_RE.test(s) && RESEARCH_RE.test(s)) falseClaims.add("TRAJECTORY_VS_RESEARCH");
      if (OTHERS_RE.test(s) && COMPARE_RE.test(s)) falseClaims.add("COMPARES_WITH_OTHER_PATIENTS");
    }
  }
  return { named: matched.length > 0, matched, falseClaims: [...falseClaims] };
}

export interface MentionRecord extends MentionCheck {
  pageUrl: string;
  question: string;
  engine: string;
  model?: string;
  /** 0-based run index within this engine. */
  run: number;
  /** false = the call failed; named/falseClaims are then meaningless (always false/[]). */
  ok: boolean;
}

/** One record per R4 answer (question x engine x run). */
export function collectMentions(targets: TargetSet, raw: RungResult[]): MentionRecord[] {
  const out: MentionRecord[] = [];
  for (const r of raw) {
    if (r.rung.id !== "R4_NATURAL" || r.rung.pageUrl === null) continue;
    const perEngine = new Map<string, number>();
    for (const run of r.runs) {
      const i = perEngine.get(run.engine) ?? 0;
      perEngine.set(run.engine, i + 1);
      const check = run.answer.ok
        ? checkMention(run.answer.answerText, targets.brandPhrases)
        : { named: false, matched: [], falseClaims: [] };
      out.push({
        pageUrl: r.rung.pageUrl, question: r.rung.query, engine: run.engine,
        ...(run.model !== undefined ? { model: run.model } : {}),
        run: i, ok: run.answer.ok, ...check,
      });
    }
  }
  return out;
}
