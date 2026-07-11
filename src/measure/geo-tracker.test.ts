import { describe, it, expect } from "vitest";
import { isCited, isMentioned, snapshotGeo } from "./geo-tracker.js";
import { FakeEngine, type GeoAnswer } from "./geo-engine.js";
import type { TargetSet } from "./targets.js";

const cited = (u: string): GeoAnswer => ({ answerText: "x", citedUrls: [u], retrievedUrls: null, engineQueries: null, ok: true });
const ans = (answerText: string, ok = true): GeoAnswer => ({ answerText, citedUrls: [], retrievedUrls: null, engineQueries: null, ok });

describe("isCited", () => {
  it("matches host and subdomain, not lookalikes", () => {
    expect(isCited(cited("https://growsteady.me/acl"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://www.growsteady.me/x/"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://notgrowsteady.me/x"), "growsteady.me")).toBe(false);
    expect(isCited({ ...ans(""), citedUrls: ["not a url"] }, "growsteady.me")).toBe(false);
  });
});

describe("isMentioned", () => {
  it("matches domain or a brand phrase, case-insensitive; not bare 'Steady'", () => {
    expect(isMentioned(ans("see growsteady.me"), "growsteady.me", [])).toBe(true);
    expect(isMentioned(ans("the GrowSteady app"), "growsteady.me", ["growsteady"])).toBe(true);
    expect(isMentioned(ans("keep a steady pace"), "growsteady.me", ["growsteady"])).toBe(false);
  });
});

describe("snapshotGeo", () => {
  const targets: TargetSet = {
    brandDomain: "growsteady.me", brandPhrases: ["growsteady"],
    items: [
      { pageUrl: "u1", procedureSlug: "a", control: false, questions: ["q1"] },
      { pageUrl: "u2", procedureSlug: "b", control: true, questions: ["qc"] },
    ],
  };
  it("averages citation rate over K runs and separates target vs control", async () => {
    // q1: engine cites 2 of 3 runs -> 0.667 ; qc: control cites 0 of 3
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"), cited("https://growsteady.me/1"), ans("n"),
      ans("n"), ans("n"), ans("n"),
    ]);
    const g = await snapshotGeo(targets, [engine], { runs: 3 });
    expect(g.targetScore.citationRate).toBeCloseTo(2 / 3);
    expect(g.controlScore.citationRate).toBe(0);
  });
  it("excludes failed runs from the denominator", async () => {
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"), ans("", false), // q1: 1 cited of 1 ok run = 1.0
      ans("n"), ans("n"), // qc runs
    ]);
    const g = await snapshotGeo(targets, [engine], { runs: 2 });
    expect(g.targetScore.citationRate).toBe(1);
  });
  it("scores over measured questions only — a fully-failed question is 'no data', not 0", async () => {
    const t: TargetSet = {
      brandDomain: "growsteady.me", brandPhrases: ["growsteady"],
      items: [{ pageUrl: "u", procedureSlug: "a", control: false, questions: ["q1", "q2"] }],
    };
    // runs=1: q1 -> cited (ok), q2 -> engine fails. targetScore must be 1 (q2 excluded), not 0.5.
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"),
      ans("", false),
    ]);
    const g = await snapshotGeo(t, [engine], { runs: 1 });
    expect(g.targetScore.citationRate).toBe(1);
    expect(g.results.find((r) => r.question === "q2")?.measured).toBe(false);
  });
});
