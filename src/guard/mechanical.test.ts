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
});
