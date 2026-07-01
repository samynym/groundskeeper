import { describe, it, expect } from "vitest";
import { expandPainBand } from "./expand-curve.js";
import type { CurveWithPainBand } from "./expand-curve.js";

const singlePointCurve: CurveWithPainBand = {
  slug: "hip-arthroscopy-fai",
  painBand: [
    { week: 0, low: 4, typical: 5, high: 7.4, basis: "measured", sourceUrl: "https://example.com/study", nativeScale: "0-10", converted: false },
  ],
};

const multiPointCurve: CurveWithPainBand = {
  slug: "hip-arthroscopy-fai",
  painBand: [
    { week: 0,  low: 4, typical: 5, high: 7.4, basis: "measured",     sourceUrl: "https://example.com/study" },
    { week: 6,  low: 2, typical: 3, high: 4,   basis: "interpolated", sourceUrl: "" },
    { week: 12, low: 1, typical: 2, high: 3,   basis: "interpolated", sourceUrl: "" },
  ],
};

describe("expandPainBand", () => {
  it("emits exactly 3 entries per painBand point", () => {
    const out = expandPainBand(singlePointCurve);
    expect(out).toHaveLength(3);
  });

  it("emits entries for all 3 bands with correct labels", () => {
    const out = expandPainBand(singlePointCurve);
    const bands = out.map((p) => p.band);
    expect(bands).toContain("low");
    expect(bands).toContain("typical");
    expect(bands).toContain("high");
  });

  it("maps the correct numeric value to each band", () => {
    const out = expandPainBand(singlePointCurve);
    expect(out.find((p) => p.band === "low")?.value).toBe(4);
    expect(out.find((p) => p.band === "typical")?.value).toBe(5);
    expect(out.find((p) => p.band === "high")?.value).toBe(7.4);
  });

  it("carries sourceUrl through to every band entry", () => {
    const out = expandPainBand(singlePointCurve);
    for (const p of out) {
      expect(p.sourceUrl).toBe("https://example.com/study");
    }
  });

  it("carries basis through to every band entry", () => {
    const out = expandPainBand(singlePointCurve);
    for (const p of out) {
      expect(p.basis).toBe("measured");
    }
  });

  it("carries week through to every band entry", () => {
    const out = expandPainBand(singlePointCurve);
    for (const p of out) {
      expect(p.week).toBe(0);
    }
  });

  it("emits 9 entries for a 3-point curve", () => {
    const out = expandPainBand(multiPointCurve);
    expect(out).toHaveLength(9);
  });

  it("keeps entries with empty sourceUrl (retriever filters those itself)", () => {
    const out = expandPainBand(multiPointCurve);
    const emptySrc = out.filter((p) => p.sourceUrl === "");
    expect(emptySrc).toHaveLength(6); // 2 interpolated points × 3 bands
  });

  it("handles empty painBand gracefully", () => {
    const out = expandPainBand({ painBand: [] });
    expect(out).toHaveLength(0);
  });
});
