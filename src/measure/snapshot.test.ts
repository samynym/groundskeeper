import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSnapshot, diffSnapshots, type Snapshot } from "./snapshot.js";
import type { GeoSnapshot } from "./geo-tracker.js";

const geo = (tc: number, cc: number): GeoSnapshot => ({
  results: [],
  targetScore: { citationRate: tc, mentionRate: 0 },
  controlScore: { citationRate: cc, mentionRate: 0 },
});

const snap = (takenAt: string, impr: number, pos: number, tc: number, cc: number): Snapshot => ({
  takenAt,
  seo: { "https://growsteady.me/a": { impressions: impr, clicks: 1, ctr: 0.01, position: pos } },
  geo: geo(tc, cc),
});

describe("snapshot persistence + diff", () => {
  it("writes a timestamped json that round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "gk-s-"));
    const s = snap("2026-07-07T10:00:00.000Z", 100, 15, 0.1, 0.1);
    const p = writeSnapshot(dir, s);
    expect(readFileSync(p, "utf8")).toContain("growsteady.me/a");
    expect(JSON.parse(readFileSync(p, "utf8")).takenAt).toBe(s.takenAt);
  });
  it("diffs SEO and GEO deltas, isolating control", () => {
    const before = snap("t0", 100, 15, 0.10, 0.10);
    const after = snap("t1", 180, 11, 0.40, 0.12);
    const d = diffSnapshots(before, after);
    expect(d.seo[0]).toEqual({ pageUrl: "https://growsteady.me/a", impressions: 80, clicks: 0, position: -4 });
    expect(d.targetCitationDelta).toBeCloseTo(0.30);
    expect(d.controlCitationDelta).toBeCloseTo(0.02);
  });
});
