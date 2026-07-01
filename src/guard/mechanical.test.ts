import { describe, it, expect } from "vitest";
import { mechanicalGuard } from "./mechanical.js";
import { goldenEvidence, groundedOps, fabricatedOps } from "../../test/fixtures/evidence.js";

const deps = { currentBasis: async () => "interpolated" as const };

describe("mechanicalGuard", () => {
  it("passes grounded ops", async () => {
    for (const op of groundedOps) {
      const v = await mechanicalGuard(op, goldenEvidence, deps);
      expect(v.ok, `${op.type}: ${v.failures.join("; ")}`).toBe(true);
    }
  });
  it("rejects every fabricated op (zero false negatives)", async () => {
    for (const op of fabricatedOps) {
      const v = await mechanicalGuard(op, goldenEvidence, deps);
      expect(v.ok, `should have rejected ${op.type} / ${JSON.stringify(op).slice(0, 60)}`).toBe(false);
      expect(v.failures.length).toBeGreaterThan(0);
    }
  });

  it("rejects promoteToMeasured when current basis is not interpolated", async () => {
    const localDeps = { currentBasis: async () => "measured" as const };
    const op = {
      type: "promoteToMeasured" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      week: 0,
      band: "typical" as const,
      value: 5.2,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10 scale",
    };
    const v = await mechanicalGuard(op, goldenEvidence, localDeps);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => /interpolated|basis/i.test(f))).toBe(true);
  });
});
