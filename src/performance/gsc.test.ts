import { describe, it, expect } from "vitest";
import { PerformanceSignal } from "./gsc.js";

const fakeJson = JSON.stringify({ rows: [
  { page: "/hip-arthroscopy-recovery-timeline", clicks: 2, impressions: 400, ctr: 0.005, position: 17.4 },
] });

describe("PerformanceSignal", () => {
  it("parses seo-loop JSON into GscRow keyed by absolute URL", async () => {
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady", targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json", gscProperty: "sc-domain:growsteady.me",
      runner: async () => ({ stdout: fakeJson, stderr: "" }),
    });
    const snap = await perf.snapshot();
    const row = snap["https://growsteady.me/hip-arthroscopy-recovery-timeline"];
    expect(row.position).toBeCloseTo(17.4);
    expect(row.impressions).toBe(400);
  });
});
