import { describe, it, expect } from "vitest";
import { classifyPage, classifyPresence, evalRung, type PageStatus } from "./classify.js";
import type { RungResult } from "./prober.js";
import type { Rung } from "./ladder.js";
import type { GeoAnswer } from "../measure/geo-engine.js";
import type { TargetItem, TargetSet } from "../measure/targets.js";

const BRAND = "growsteady.me";
const PAGE = "https://growsteady.me/acl";
const item: TargetItem = { pageUrl: PAGE, procedureSlug: "acl", control: false, questions: ["q"] };
const live: PageStatus = { pageUrl: PAGE, httpStatus: 200, phrase: "A phrase." };

const a = (over: Partial<GeoAnswer>): GeoAnswer =>
  ({ answerText: "", citedUrls: [], retrievedUrls: [], engineQueries: null, ok: true, ...over });

const rung = (id: Rung["id"], pageUrl: string | null = null): Rung =>
  ({ id, scope: pageUrl ? "page" : "domain", pageUrl, query: "q" });

const rr = (id: Rung["id"], pageUrl: string | null, answers: GeoAnswer[]): RungResult =>
  ({ rung: rung(id, pageUrl), runs: answers.map((answer) => ({ engine: "e", answer })) });

// Baseline scaffolding: R0 negative, R1 negative, R3 negative, R4 negative — a clean ABSENT.
const allNegative = (): RungResult[] => [
  rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://other.com/x"] })]),
  rr("R1_BRAND_PHRASE", null, [a({})]),
  rr("R3_VERBATIM", PAGE, [a({})]),
  rr("R4_NATURAL", PAGE, [a({ retrievedUrls: ["https://hss.edu/acl"] })]),
];

describe("evalRung", () => {
  it("unions over K runs; cited and retrieved are independent", () => {
    const e = evalRung([a({}), a({ citedUrls: ["https://growsteady.me/acl"] })], BRAND);
    expect(e).toEqual({ measured: true, cited: true, retrieved: false });
  });
  it("retrieved is null when NO ok run reports a retrieval set", () => {
    expect(evalRung([a({ retrievedUrls: null })], BRAND).retrieved).toBeNull();
  });
  it("subdomains count, lookalike domains do not", () => {
    expect(evalRung([a({ retrievedUrls: ["https://www.growsteady.me/x"] })], BRAND).retrieved).toBe(true);
    expect(evalRung([a({ retrievedUrls: ["https://notgrowsteady.me/x"] })], BRAND).retrieved).toBe(false);
  });
  it("all-failed runs = unmeasured", () => {
    expect(evalRung([a({ ok: false })], BRAND)).toEqual({ measured: false, cited: false, retrieved: null });
  });
});

describe("classifyPage — verdict table", () => {
  it("CITED: brand cited at R4", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ citedUrls: ["https://growsteady.me/acl"], retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("CITED"); // null retrieval cannot block a citation
  });
  it("RETRIEVED_NOT_CITED: brand retrieved at R4, not cited", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("RETRIEVED_NOT_CITED");
  });
  it("INDEXED_NOT_MATCHED: brand at a domain rung, trustworthy-negative R4", () => {
    const rs = allNegative();
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://growsteady.me/"] })]);
    const v = classifyPage(item, live, rs, "e", BRAND);
    expect(v.verdict).toBe("INDEXED_NOT_MATCHED");
    expect(v.reasons[0]).toContain("R0_DOMAIN_LITERAL");
  });
  it("INDEXED_NOT_MATCHED: brand at R3 only", () => {
    const rs = allNegative();
    rs[2] = rr("R3_VERBATIM", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INDEXED_NOT_MATCHED");
  });
  it("INDEXED_NOT_MATCHED: citation-only engine (R4 retrieval null) with R3 cited by URL", () => {
    // openai-search shape: retrievedUrls is always null, but citedUrls is reported.
    // A verbatim-phrase citation proves the page is indexed even though R4's
    // retrieval set is unreportable — it must not short-circuit to INCONCLUSIVE.
    const rs = allNegative();
    rs[2] = rr("R3_VERBATIM", PAGE, [a({ citedUrls: ["https://growsteady.me/acl"], retrievedUrls: null })]);
    rs[3] = rr("R4_NATURAL", PAGE, [a({ citedUrls: [], retrievedUrls: null })]);
    const v = classifyPage(item, live, rs, "e", BRAND);
    expect(v.verdict).toBe("INDEXED_NOT_MATCHED");
    expect(v.reasons[0]).toContain("R3_VERBATIM");
  });
  it("ABSENT: every needed rung a trustworthy negative", () => {
    expect(classifyPage(item, live, allNegative(), "e", BRAND).verdict).toBe("ABSENT");
  });
  it("ABSENT allowed with R3 skipped when domain rungs are negative (domain absence subsumes page absence)", () => {
    const rs = allNegative().filter((r) => r.rung.id !== "R3_VERBATIM");
    expect(classifyPage(item, { ...live, phrase: null }, rs, "e", BRAND).verdict).toBe("ABSENT");
  });
});

describe("classifyPage — INCONCLUSIVE never collapses into ABSENT", () => {
  it("page not live", () => {
    const v = classifyPage(item, { pageUrl: PAGE, httpStatus: 0, phrase: null }, allNegative(), "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reasons[0]).toContain("PAGE_NOT_LIVE");
  });
  it("no natural question configured", () => {
    const noQ: TargetItem = { ...item, questions: [] };
    const rs = allNegative().filter((r) => r.rung.id !== "R4_NATURAL");
    expect(classifyPage(noQ, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("REGRESSION: a failed rung never yields ABSENT", () => {
    const rs = allNegative();
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ ok: false, retrievedUrls: null })]);
    const v = classifyPage(item, live, rs, "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.verdict).not.toBe("ABSENT");
  });
  it("REGRESSION: retrievedUrls null on a needed rung never yields ABSENT", () => {
    const rs = allNegative();
    rs[1] = rr("R1_BRAND_PHRASE", null, [a({ retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("R4 retrieval unreportable (and uncited) is INCONCLUSIVE, not a negative", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("domain rungs positive + R3 skipped + R4 negative = page-level unanswered", () => {
    const rs = allNegative().filter((r) => r.rung.id !== "R3_VERBATIM");
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://growsteady.me/"] })]);
    const v = classifyPage(item, { ...live, phrase: null }, rs, "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.verdict).not.toBe("INDEXED_NOT_MATCHED");
  });
  it("R2 is never dispositive: a positive R2 alone changes nothing", () => {
    const rs = [...allNegative(), rr("R2_SITE_SCOPED", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })])];
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("ABSENT");
  });
});

describe("classifyPresence — aggregation", () => {
  const targets: TargetSet = { brandDomain: BRAND, brandPhrases: ["Steady recovery"], items: [item] };
  it("best = highest-ranked evidential verdict; INCONCLUSIVE engines don't drag it down", () => {
    const rs: RungResult[] = [
      { rung: rung("R0_DOMAIN_LITERAL"), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R1_BRAND_PHRASE"), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R3_VERBATIM", PAGE), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R4_NATURAL", PAGE), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
    ];
    const out = classifyPresence(targets, [live], rs, ["e1", "e2"]);
    expect(out[0].perEngine.map((p) => p.verdict)).toEqual(["ABSENT", "INCONCLUSIVE"]);
    expect(out[0].best).toBe("ABSENT");
  });
  it("all engines INCONCLUSIVE (e.g. no API key -> zero engines) = INCONCLUSIVE", () => {
    const out = classifyPresence(targets, [live], [], []);
    expect(out[0].best).toBe("INCONCLUSIVE");
    expect(out[0].perEngine).toEqual([]);
  });
});
