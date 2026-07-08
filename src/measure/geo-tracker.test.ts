import { describe, it, expect } from "vitest";
import { isCited, isMentioned, snapshotGeo } from "./geo-tracker.js";
import { FakeEngine, type GeoAnswer } from "./geo-engine.js";
import type { TargetSet } from "./targets.js";

const cited = (u: string): GeoAnswer => ({ answerText: "x", citedUrls: [u], ok: true });

describe("isCited", () => {
  it("matches host and subdomain, not lookalikes", () => {
    expect(isCited(cited("https://growsteady.me/acl"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://www.growsteady.me/x/"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://notgrowsteady.me/x"), "growsteady.me")).toBe(false);
    expect(isCited({ answerText: "", citedUrls: ["not a url"], ok: true }, "growsteady.me")).toBe(false);
  });
});

describe("isMentioned", () => {
  it("matches domain or a brand phrase, case-insensitive; not bare 'Steady'", () => {
    expect(isMentioned({ answerText: "see growsteady.me", citedUrls: [], ok: true }, "growsteady.me", [])).toBe(true);
    expect(isMentioned({ answerText: "the GrowSteady app", citedUrls: [], ok: true }, "growsteady.me", ["growsteady"])).toBe(true);
    expect(isMentioned({ answerText: "keep a steady pace", citedUrls: [], ok: true }, "growsteady.me", ["growsteady"])).toBe(false);
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
      cited("https://growsteady.me/1"), cited("https://growsteady.me/1"), { answerText: "n", citedUrls: [], ok: true },
      { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true },
    ]);
    const g = await snapshotGeo(targets, [engine], { runs: 3 });
    expect(g.targetScore.citationRate).toBeCloseTo(2 / 3);
    expect(g.controlScore.citationRate).toBe(0);
  });
  it("excludes failed runs from the denominator", async () => {
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"), { answerText: "", citedUrls: [], ok: false }, // q1: 1 cited of 1 ok run = 1.0
      { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true }, // qc runs
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
      { answerText: "", citedUrls: [], ok: false },
    ]);
    const g = await snapshotGeo(t, [engine], { runs: 1 });
    expect(g.targetScore.citationRate).toBe(1);
    expect(g.results.find((r) => r.question === "q2")?.measured).toBe(false);
  });
});
