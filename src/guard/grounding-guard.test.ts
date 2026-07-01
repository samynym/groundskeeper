import { describe, it, expect } from "vitest";
import { GroundingGuard } from "./grounding-guard.js";
import { FakeLlm } from "../llm/client.js";
import { goldenEvidence, groundedOps, fabricatedOps } from "../../test/fixtures/evidence.js";

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
});
