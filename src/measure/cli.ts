import "dotenv/config";
import { readFileSync } from "node:fs";
import { PerformanceSignal } from "../performance/gsc.js";
import { loadTargets } from "./targets.js";
import { snapshotSeo } from "./seo-snapshot.js";
import { snapshotGeo } from "./geo-tracker.js";
import { writeSnapshot, diffSnapshots, type Snapshot } from "./snapshot.js";
import { renderReport } from "./report.js";
import type { GeoEngineClient } from "./geo-engine.js";
import type { GscRow } from "../types.js";

/**
 * Credential-gated real engines. v1 wires none — real HTTP adapters
 * (Perplexity / OpenAI-search / Claude-search) are the follow-on, built
 * against each API's verified live schema, NOT guessed. GEO logic is fully
 * covered by unit tests via FakeEngine.
 */
export function buildEngines(_env: NodeJS.ProcessEnv): GeoEngineClient[] {
  return [];
}

export interface CliDeps {
  now: () => string;
  targetsPath: string;
  snapshotDir: string;
  perf: { snapshot(): Promise<Record<string, GscRow>> };
  engines: GeoEngineClient[];
  runs: number;
}

export async function takeBaseline(d: CliDeps): Promise<{ snap: Snapshot; path: string }> {
  const targets = loadTargets(d.targetsPath);
  const [seo, geo] = await Promise.all([
    snapshotSeo(targets, d.perf),
    snapshotGeo(targets, d.engines, { runs: d.runs }),
  ]);
  const snap: Snapshot = { takenAt: d.now(), seo, geo };
  const path = writeSnapshot(d.snapshotDir, snap);
  return { snap, path };
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const repo = process.env.TARGET_REPO_PATH ?? ".";
  const origin = process.env.TARGET_ORIGIN ?? "https://growsteady.me";
  const targetsPath = process.env.TARGETS_PATH ?? "config/steady-targets.json";
  const snapshotDir = process.env.SNAPSHOT_DIR ?? "snapshots";

  if (cmd === "baseline") {
    const perf = new PerformanceSignal({ targetRepoPath: repo, targetOrigin: origin, gscSaJson: process.env.GSC_SA_JSON ?? "", gscProperty: process.env.GSC_PROPERTY ?? "" });
    const runsEnv = Number(process.env.GEO_RUNS ?? 3);
    const runs = Number.isFinite(runsEnv) && runsEnv > 0 ? runsEnv : 3; // guard: malformed GEO_RUNS must not silently zero out GEO
    const { path } = await takeBaseline({ now: () => new Date().toISOString(), targetsPath, snapshotDir, perf, engines: buildEngines(process.env), runs });
    console.log(`baseline written: ${path}`);
    return;
  }
  if (cmd === "report") {
    console.log(renderReport(JSON.parse(readFileSync(argv[1], "utf8")) as Snapshot));
    return;
  }
  if (cmd === "diff") {
    const before = JSON.parse(readFileSync(argv[1], "utf8")) as Snapshot;
    const after = JSON.parse(readFileSync(argv[2], "utf8")) as Snapshot;
    console.log(renderReport(after, diffSnapshots(before, after)));
    return;
  }
  console.error("usage: baseline | report <snap.json> | diff <before.json> <after.json>");
  process.exit(1);
}

if (process.argv[1] && /measure\/cli\.(js|ts|mts|cts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
