import { hostOf } from "../measure/geo-tracker.js";
import type { GeoAnswer } from "../measure/geo-engine.js";
import type { TargetItem, TargetSet } from "../measure/targets.js";
import type { RungId } from "./ladder.js";
import type { RungResult } from "./prober.js";

export type Verdict = "CITED" | "RETRIEVED_NOT_CITED" | "INDEXED_NOT_MATCHED" | "ABSENT" | "INCONCLUSIVE";

export interface PageStatus { pageUrl: string; httpStatus: number; phrase: string | null }
export interface EngineVerdict { engine: string; verdict: Verdict; reasons: string[] }
export interface PageVerdict {
  pageUrl: string;
  procedureSlug: string;
  control: boolean;
  perEngine: EngineVerdict[];
  /** Highest-ranked evidential verdict across engines; INCONCLUSIVE only if no engine produced evidence. */
  best: Verdict;
}

function isBrandHost(url: string, brandDomain: string): boolean {
  const h = hostOf(url);
  const d = brandDomain.toLowerCase();
  return h === d || (h ? h.endsWith("." + d) : false);
}

/** One rung, one engine, unioned over its K runs. */
export interface RungEval {
  measured: boolean;          // >=1 ok run
  cited: boolean;             // brand in citedUrls of any ok run
  /** true/false when >=1 ok run reported a retrieval set; null when none did (unreportable). */
  retrieved: boolean | null;
}

export function evalRung(answers: GeoAnswer[], brandDomain: string): RungEval {
  const ok = answers.filter((x) => x.ok);
  if (ok.length === 0) return { measured: false, cited: false, retrieved: null };
  const cited = ok.some((x) => x.citedUrls.some((u) => isBrandHost(u, brandDomain)));
  const reporting = ok.filter((x) => x.retrievedUrls !== null);
  const retrieved = reporting.length === 0
    ? null
    : reporting.some((x) => (x.retrievedUrls as string[]).some((u) => isBrandHost(u, brandDomain)));
  return { measured: true, cited, retrieved };
}

const positive = (e: RungEval | undefined): boolean => !!e && (e.cited || e.retrieved === true);

/**
 * The verdict router. Fail-closed everywhere: a failed call, a null retrieval
 * set, and true invisibility are three different facts — INCONCLUSIVE must
 * never collapse into ABSENT (the SeoMetrics zero-fill lesson).
 * R2_SITE_SCOPED is deliberately never consulted: corroborating only.
 */
export function classifyPage(
  item: TargetItem,
  status: PageStatus,
  rungResults: RungResult[],
  engine: string,
  brandDomain: string,
): EngineVerdict {
  if (status.httpStatus !== 200) {
    return { engine, verdict: "INCONCLUSIVE", reasons: [`PAGE_NOT_LIVE: http ${status.httpStatus}`] };
  }

  const evalFor = (id: RungId): RungEval | undefined => {
    const rr = rungResults.find(
      (r) => r.rung.id === id && (r.rung.scope === "domain" || r.rung.pageUrl === item.pageUrl),
    );
    if (!rr) return undefined;
    return evalRung(rr.runs.filter((x) => x.engine === engine).map((x) => x.answer), brandDomain);
  };

  const r4 = evalFor("R4_NATURAL");
  if (!r4) return { engine, verdict: "INCONCLUSIVE", reasons: ["no natural question configured (R4 missing)"] };
  if (r4.cited) return { engine, verdict: "CITED", reasons: ["brand cited at R4_NATURAL"] };
  if (r4.retrieved === true) {
    return { engine, verdict: "RETRIEVED_NOT_CITED", reasons: ["brand retrieved but not cited at R4_NATURAL"] };
  }
  if (!r4.measured) return { engine, verdict: "INCONCLUSIVE", reasons: ["R4_NATURAL failed all runs"] };

  // R4 neither cited nor retrieved the brand (its retrieval set may be reportable
  // or null). A positive citation at R0/R1/R3 is conclusive proof the page is
  // indexed regardless of whether R4's retrieval set is reportable, so it is
  // consulted BEFORE the null-retrieval short-circuit below — otherwise a
  // citation-only engine (e.g. openai-search, which never reports retrievedUrls)
  // could never reach INDEXED_NOT_MATCHED despite a verbatim-phrase hit.
  const r0 = evalFor("R0_DOMAIN_LITERAL");
  const r1 = evalFor("R1_BRAND_PHRASE"); // undefined when no distinct brand phrase configured
  const r3 = evalFor("R3_VERBATIM");     // undefined when R3 was skipped (no extractable phrase)

  if (positive(r0) || positive(r1) || positive(r3)) {
    if (!positive(r3) && r3 === undefined) {
      return {
        engine, verdict: "INCONCLUSIVE",
        reasons: ["domain rungs positive but R3 skipped (no extractable phrase): page-level membership unanswered"],
      };
    }
    const at: string[] = [];
    if (positive(r0)) at.push("R0_DOMAIN_LITERAL");
    if (positive(r1)) at.push("R1_BRAND_PHRASE");
    if (positive(r3)) at.push("R3_VERBATIM");
    return { engine, verdict: "INDEXED_NOT_MATCHED", reasons: [`brand present at ${at.join(", ")}; absent at R4_NATURAL`] };
  }

  // No positive citation anywhere. If R4's retrieval set is unreportable we cannot
  // tell "absent" from "not retrieved" — INCONCLUSIVE, never ABSENT.
  if (r4.retrieved === null) {
    return {
      engine, verdict: "INCONCLUSIVE",
      reasons: ["R4_NATURAL retrieval unreportable (retrievedUrls null); no positive citation at R0/R1/R3"],
    };
  }

  // R4 is a trustworthy negative from here on.
  // ABSENT only if every needed rung is a trustworthy negative.
  // Needed = R0 always; R1/R3 only if they were built (a skipped rung is not "needed" —
  // R3-skipped is fine here precisely because the domain rungs are negative).
  const reasons: string[] = [];
  const needed: Array<[string, RungEval | undefined]> = [["R0_DOMAIN_LITERAL", r0]];
  if (r1 !== undefined) needed.push(["R1_BRAND_PHRASE", r1]);
  if (r3 !== undefined) needed.push(["R3_VERBATIM", r3]);
  for (const [id, e] of needed) {
    if (!e) reasons.push(`${id} not run`);
    else if (!e.measured) reasons.push(`${id} failed all runs`);
    else if (e.retrieved === null) reasons.push(`${id} retrieval unreportable`);
  }
  if (reasons.length > 0) return { engine, verdict: "INCONCLUSIVE", reasons };
  return { engine, verdict: "ABSENT", reasons: ["brand at no rung"] };
}

const RANK: Record<Verdict, number> = {
  CITED: 4, RETRIEVED_NOT_CITED: 3, INDEXED_NOT_MATCHED: 2, ABSENT: 1, INCONCLUSIVE: 0,
};

export function classifyPresence(
  targets: TargetSet,
  statuses: PageStatus[],
  rungResults: RungResult[],
  engineNames: string[],
): PageVerdict[] {
  return targets.items.map((item) => {
    const status =
      statuses.find((s) => s.pageUrl === item.pageUrl) ?? { pageUrl: item.pageUrl, httpStatus: 0, phrase: null };
    const perEngine = engineNames.map((e) => classifyPage(item, status, rungResults, e, targets.brandDomain));
    const evidential = perEngine.filter((v) => v.verdict !== "INCONCLUSIVE");
    const best: Verdict = evidential.length === 0
      ? "INCONCLUSIVE"
      : evidential.reduce((x, y) => (RANK[y.verdict] > RANK[x.verdict] ? y : x)).verdict;
    return { pageUrl: item.pageUrl, procedureSlug: item.procedureSlug, control: item.control, perEngine, best };
  });
}
