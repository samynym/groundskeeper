import type { TargetSet } from "../measure/targets.js";

export type RungId = "R0_DOMAIN_LITERAL" | "R1_BRAND_PHRASE" | "R2_SITE_SCOPED" | "R3_VERBATIM" | "R4_NATURAL";

export interface Rung {
  id: RungId;
  scope: "domain" | "page";
  /** null for domain-scoped rungs. */
  pageUrl: string | null;
  query: string;
}

/**
 * phrases: per-page verbatim sentence extracted from the LIVE page HTML
 * (see page-fetcher.ts); null/missing = no extractable sentence, R3 skipped.
 * R2 is corroborating-only (classify.ts never treats it as dispositive).
 */
export function buildLadder(targets: TargetSet, phrases: Record<string, string | null>): Rung[] {
  const rungs: Rung[] = [];
  rungs.push({ id: "R0_DOMAIN_LITERAL", scope: "domain", pageUrl: null, query: targets.brandDomain });
  const namePhrase = targets.brandPhrases.find(
    (p) => p !== "" && p.toLowerCase() !== targets.brandDomain.toLowerCase(),
  );
  if (namePhrase) rungs.push({ id: "R1_BRAND_PHRASE", scope: "domain", pageUrl: null, query: namePhrase });
  for (const item of targets.items) {
    rungs.push({
      id: "R2_SITE_SCOPED", scope: "page", pageUrl: item.pageUrl,
      query: `site:${targets.brandDomain} ${item.procedureSlug}`,
    });
    const phrase = phrases[item.pageUrl] ?? null;
    if (phrase) {
      rungs.push({
        id: "R3_VERBATIM", scope: "page", pageUrl: item.pageUrl,
        query: `Which website says the following, word for word? "${phrase}"`,
      });
    }
    if (item.questions[0]) {
      rungs.push({ id: "R4_NATURAL", scope: "page", pageUrl: item.pageUrl, query: item.questions[0] });
    }
  }
  return rungs;
}
