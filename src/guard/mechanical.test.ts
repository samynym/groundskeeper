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

  it("rejects a promote backed only by an interpolated fact (no laundering)", async () => {
    // week 4/typical=2 exists in the evidence but its basis is "interpolated".
    const op = {
      type: "promoteToMeasured" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      week: 4,
      band: "typical" as const,
      value: 2,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10 scale",
    };
    const v = await mechanicalGuard(op, goldenEvidence, deps);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => /measured fact/i.test(f))).toBe(true);
  });

  it("rejects a promote whose value is measured at a DIFFERENT week (no cross-week coincidence)", async () => {
    // 5.2 is measured at week 0, but this claims week 4.
    const op = {
      type: "promoteToMeasured" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      week: 4,
      band: "typical" as const,
      value: 5.2,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10 scale",
    };
    const v = await mechanicalGuard(op, goldenEvidence, deps);
    expect(v.ok).toBe(false);
    expect(v.failures.some((f) => /measured fact/i.test(f))).toBe(true);
  });

  it("accepts a promote backed by a measured fact at the same week/band/value", async () => {
    // week 0/typical=5.2 is a measured fact in the evidence base.
    const op = {
      type: "promoteToMeasured" as const,
      procedureSlug: goldenEvidence.ref.procedureSlug,
      week: 0,
      band: "typical" as const,
      value: 5.2,
      sourceUrl: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5721367/",
      nativeScale: "0-10 scale",
    };
    const v = await mechanicalGuard(op, goldenEvidence, deps);
    expect(v.ok, v.failures.join("; ")).toBe(true);
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
