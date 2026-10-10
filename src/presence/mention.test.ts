import { describe, it, expect } from "vitest";
import { checkMention, collectMentions } from "./mention.js";
import type { RungResult } from "./prober.js";
import type { TargetSet } from "../measure/targets.js";
import type { GeoAnswer } from "../measure/geo-engine.js";

const PHRASES = ["Steady: Post Surgery Tracker", "growsteady", "growsteady.me"];

describe("checkMention — is the product named?", () => {
  it("names Steady as a proper noun in a list of apps", () => {
    const r = checkMention("Good options:\n- **PT Pal** – exercise logs\n- **Steady** – daily voice check-ins", PHRASES);
    expect(r.named).toBe(true);
    expect(r.matched).toEqual(["Steady"]);
  });
  it("matches brand phrases case-insensitively", () => {
    const r = checkMention("See GrowSteady.me for a calculator.", PHRASES);
    expect(r.matched).toEqual(["growsteady", "growsteady.me"]);
  });
  it("ignores the adjective: lowercase, and capitalised adjective uses", () => {
    for (const text of [
      "Expect steady progress over 12 weeks.",
      "Steady progress is the goal.",
      "Steady pace matters more than speed.",
      "Steady-state cardio is fine at week 6.",
      "Steady improvement in range of motion is a good sign.",
      "Steady recovery takes months.",
    ]) {
      expect(checkMention(text, PHRASES).named, text).toBe(false);
    }
  });
  it("is case-sensitive on the bare word", () => {
    expect(checkMention("keep things STEADY and slow", PHRASES).named).toBe(false);
  });
});

describe("checkMention — false claims about Steady", () => {
  it("flags 'charts your full recovery trajectory against research'", () => {
    const r = checkMention("- **Steady** charts your whole recovery trajectory against published research.", PHRASES);
    expect(r.falseClaims).toEqual(["TRAJECTORY_VS_RESEARCH"]);
  });
  it("flags 'compares you with other patients'", () => {
    const r = checkMention("Steady compares your progress with other patients who had the same surgery.", PHRASES);
    expect(r.falseClaims).toEqual(["COMPARES_WITH_OTHER_PATIENTS"]);
  });
  it("does not flag the true claim: current pain vs published studies at one point", () => {
    const r = checkMention("Steady has a free calculator that compares your current pain with published studies.", PHRASES);
    expect(r.named).toBe(true);
    expect(r.falseClaims).toEqual([]);
  });
  it("does not flag 'patients in published studies' as other-patient comparison", () => {
    const r = checkMention("Steady compares your pain against similar patients in published studies.", PHRASES);
    expect(r.falseClaims).not.toContain("COMPARES_WITH_OTHER_PATIENTS");
  });
  it("does not pin a competitor's claim on Steady", () => {
    const text = [
      "1. **RecoverWell** charts your full recovery history against research and compares you with other users.",
      "2. **Steady** – a daily voice check-in.",
    ].join("\n");
    const r = checkMention(text, PHRASES);
    expect(r.named).toBe(true);
    expect(r.falseClaims).toEqual([]);
  });
  it("reads indented sub-bullets as part of the Steady item", () => {
    const text = "- **Steady**\n  - Plots your recovery curve over time against clinical data from studies.";
    expect(checkMention(text, PHRASES).falseClaims).toEqual(["TRAJECTORY_VS_RESEARCH"]);
  });
  it("no name, no claims", () => {
    expect(checkMention("Other users compare recovery history with research.", PHRASES))
      .toEqual({ named: false, matched: [], falseClaims: [] });
  });
});

describe("collectMentions", () => {
  const targets: TargetSet = { brandDomain: "growsteady.me", brandPhrases: PHRASES, items: [], discovery: true };
  const ans = (answerText: string, ok = true): GeoAnswer =>
    ({ answerText, citedUrls: [], retrievedUrls: null, engineQueries: null, ok });
  it("one record per R4 answer, run index per engine; failed calls are ok:false, never 'not named'", () => {
    const raw: RungResult[] = [
      { rung: { id: "R0_DOMAIN_LITERAL", scope: "domain", pageUrl: null, query: "growsteady.me" },
        runs: [{ engine: "openai", answer: ans("Steady is an app") }] },
      { rung: { id: "R4_NATURAL", scope: "page", pageUrl: "https://growsteady.me/about", query: "best app?" },
        runs: [
          { engine: "openai", model: "m1", answer: ans("Try Steady.") },
          { engine: "openai", model: "m1", answer: ans("Try PT Pal.") },
          { engine: "claude", answer: ans("", false) },
        ] },
    ];
    const out = collectMentions(targets, raw);
    expect(out.map((m) => [m.engine, m.run, m.ok, m.named])).toEqual([
      ["openai", 0, true, true], ["openai", 1, true, false], ["claude", 0, false, false],
    ]);
    expect(out[0]).toMatchObject({ pageUrl: "https://growsteady.me/about", question: "best app?", model: "m1" });
    expect("model" in out[2]).toBe(false);
  });
});
