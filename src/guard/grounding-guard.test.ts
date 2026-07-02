import { describe, it, expect } from "vitest";
import { GroundingGuard } from "./grounding-guard.js";
import { FakeLlm } from "../llm/client.js";
import { goldenEvidence, groundedOps, fabricatedOps, KNOWN_C } from "../../test/fixtures/evidence.js";

const deps = { currentBasis: async () => "interpolated" as const };

describe("GroundingGuard", () => {
  it("passes grounded ops when judge agrees", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "ok" })]); // one prose claim in groundedOps
    const guard = new GroundingGuard(llm, deps);
    const res = await guard.check({ ref: goldenEvidence.ref, ops: groundedOps, rationale: "" }, goldenEvidence);
    expect(res.allPassed).toBe(true);
    expect(res.passedOps.length).toBe(groundedOps.length);
  });
  it("drops a mechanically-fabricated op even if judge would accept", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "ok" }), JSON.stringify({ supported: true, reason: "ok" })]);
    const guard = new GroundingGuard(llm, deps);
    const res = await guard.check({ ref: goldenEvidence.ref, ops: fabricatedOps, rationale: "" }, goldenEvidence);
    expect(res.passedOps.length).toBe(0);
  });
  it("drops a mechanically-valid prose op when the judge rejects its claim", async () => {
    const proseOp = groundedOps.find((o) => o.type === "replaceProse")!;
    const draft = { ref: goldenEvidence.ref, ops: [proseOp], rationale: "" };
    const llm = new FakeLlm([JSON.stringify({ supported: false, reason: "passage does not support the claim" })]);
    const guard = new GroundingGuard(llm, deps);
    const res = await guard.check(draft, goldenEvidence);
    expect(res.passedOps.length).toBe(0);
    expect(res.allPassed).toBe(false);
    expect(res.verdicts[0].ok).toBe(false);
    expect(res.verdicts[0].failures.join(" ")).toMatch(/judge/i);
  });

  it("fails closed when a cited source has no evidentiary fact", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "x" })]);
    const guard = new GroundingGuard(llm, deps);
    const op = {
      type: "replaceProse" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      field: "outlook",
      oldText: "x",
      newText: "Patients recover within six weeks according to this study.",
      claims: [{ text: "Patients recover within six weeks according to this study.", sourceUrl: KNOWN_C }],
    };
    const res = await guard.check({ ref: goldenEvidence.ref, ops: [op], rationale: "" }, goldenEvidence);
    expect(res.passedOps.length).toBe(0);
    expect(res.allPassed).toBe(false);
    expect(res.verdicts[0].failures.some((f) => f.includes("no evidentiary fact"))).toBe(true);
    expect(llm.calls.length).toBe(0); // judge must not be called
  });

  it("shows the judge each fact's basis and source title (no estimate laundering)", async () => {
    // KNOWN_A carries a MEASURED fact (wk0) and an INTERPOLATED fact (wk4=2).
    // A claim citing KNOWN_A must reach the judge with the estimate clearly labelled,
    // so the judge can refuse to let a site estimate back a "research reports" claim.
    const KNOWN_A = "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/";
    const llm = new FakeLlm([JSON.stringify({ supported: false, reason: "estimate cannot back a research claim" })]);
    const guard = new GroundingGuard(llm, deps);
    const op = {
      type: "replaceProse" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      field: "outlook",
      oldText: "x",
      newText: "Published research reports typical pain around 2 by week 4.",
      claims: [{ text: "typical pain around 2 by week 4", sourceUrl: KNOWN_A }],
    };
    await guard.check({ ref: goldenEvidence.ref, ops: [op], rationale: "" }, goldenEvidence);
    expect(llm.calls.length).toBe(1);
    const passage = llm.calls[0].user;
    expect(passage).toMatch(/site estimate/i);      // the wk4 interpolated fact is labelled
    expect(passage).toMatch(/measured study value/i); // the wk0 measured fact is labelled
    expect(passage).toContain("Cunningham 2017");     // source title is shown
  });

  it("judges the full newText, not just enumerated fragments", async () => {
    const KNOWN_B = "https://pmc.ncbi.nlm.nih.gov/articles/PMC8530429/";
    const fullText = "Return to sport averages twelve months for most patients.";
    const llm = new FakeLlm([JSON.stringify({ supported: false, reason: "not supported" })]);
    const guard = new GroundingGuard(llm, deps);
    const op = {
      type: "replaceProse" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      field: "outlook",
      oldText: "x",
      newText: fullText,
      claims: [{ text: "12 months", sourceUrl: KNOWN_B }],
    };
    const res = await guard.check({ ref: goldenEvidence.ref, ops: [op], rationale: "" }, goldenEvidence);
    expect(res.passedOps.length).toBe(0);
    expect(llm.calls.length).toBe(1);
    expect(llm.calls[0].user).toContain(fullText);
  });
});
