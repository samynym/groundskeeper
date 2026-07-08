import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeBaseline, buildEngines } from "./cli.js";
import { FakeEngine } from "./geo-engine.js";

function tmpTargets(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "gk-cli-"));
  const path = join(dir, "targets.json");
  writeFileSync(path, JSON.stringify({
    brandDomain: "growsteady.me", brandPhrases: ["growsteady"],
    items: [{ pageUrl: "https://growsteady.me/a", procedureSlug: "a", control: false, questions: ["q1"] }],
  }));
  return { path, dir };
}

describe("measure CLI", () => {
  it("buildEngines returns [] when no engine credentials are present", () => {
    expect(buildEngines({})).toEqual([]);
  });
  it("takeBaseline snapshots SEO+GEO and writes a file", async () => {
    const { path, dir } = tmpTargets();
    const snapDir = join(dir, "snapshots");
    const perf = { snapshot: async () => ({ "https://growsteady.me/a": { url: "https://growsteady.me/a", clicks: 2, impressions: 300, ctr: 0.0066, position: 14 } }) };
    const engine = new FakeEngine("e", [{ answerText: "see growsteady.me", citedUrls: ["https://growsteady.me/a"], ok: true }]);
    const { snap, path: out } = await takeBaseline({ now: () => "2026-07-07T10:00:00.000Z", targetsPath: path, snapshotDir: snapDir, perf, engines: [engine], runs: 1 });
    expect(snap.seo["https://growsteady.me/a"].impressions).toBe(300);
    expect(snap.geo.targetScore.citationRate).toBe(1);
    expect(existsSync(out)).toBe(true);
  });
});
