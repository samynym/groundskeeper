import { describe, it, expect } from "vitest";
import { buildLadder } from "./ladder.js";
import type { TargetSet } from "../measure/targets.js";

const targets: TargetSet = {
  brandDomain: "growsteady.me",
  brandPhrases: ["growsteady.me", "Steady recovery"],
  items: [
    { pageUrl: "https://growsteady.me/acl", procedureSlug: "acl-reconstruction", control: false, questions: ["when can i walk after acl"] },
    { pageUrl: "https://growsteady.me/rcr", procedureSlug: "rotator-cuff-repair", control: true, questions: [] },
  ],
};

describe("buildLadder", () => {
  it("builds domain rungs once and page rungs per item", () => {
    const rungs = buildLadder(targets, { "https://growsteady.me/acl": "A distinctive sentence.", "https://growsteady.me/rcr": null });
    const ids = rungs.map((r) => `${r.id}:${r.pageUrl ?? "-"}`);
    expect(ids).toEqual([
      "R0_DOMAIN_LITERAL:-",
      "R1_BRAND_PHRASE:-",
      "R2_SITE_SCOPED:https://growsteady.me/acl",
      "R3_VERBATIM:https://growsteady.me/acl",
      "R4_NATURAL:https://growsteady.me/acl",
      "R2_SITE_SCOPED:https://growsteady.me/rcr",
      // rcr: R3 skipped (no phrase), R4 skipped (no questions)
    ]);
  });
  it("R0 queries the literal domain; R1 uses the first phrase differing from the domain", () => {
    const rungs = buildLadder(targets, {});
    expect(rungs[0].query).toBe("growsteady.me");
    expect(rungs[1].query).toBe("Steady recovery"); // "growsteady.me" phrase === domain, skipped
  });
  it("skips R1 when no phrase differs from the domain", () => {
    const t = { ...targets, brandPhrases: ["growsteady.me"] };
    expect(buildLadder(t, {}).some((r) => r.id === "R1_BRAND_PHRASE")).toBe(false);
  });
  it("R2 is site-scoped to the slug; R3 wraps the phrase in the word-for-word template", () => {
    const rungs = buildLadder(targets, { "https://growsteady.me/acl": "The MOON guideline removed the brace." });
    expect(rungs.find((r) => r.id === "R2_SITE_SCOPED")!.query).toBe("site:growsteady.me acl-reconstruction");
    expect(rungs.find((r) => r.id === "R3_VERBATIM")!.query).toBe(
      'Which website says the following, word for word? "The MOON guideline removed the brace."',
    );
  });
  it("R4 uses exactly the first configured question", () => {
    const rungs = buildLadder(targets, {});
    expect(rungs.find((r) => r.id === "R4_NATURAL")!.query).toBe("when can i walk after acl");
  });
});
