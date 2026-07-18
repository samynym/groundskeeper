import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadTargets } from "../measure/targets.js";
import { buildEngines } from "../measure/claude-search-engine.js";
import type { GeoEngineClient } from "../measure/geo-engine.js";
import { buildLadder } from "./ladder.js";
import { classifyPresence, type PageStatus } from "./classify.js";
import { extractPhrase, fetchPage, type PageFetch } from "./page-fetcher.js";
import { runProbe } from "./prober.js";
import { readPresenceSnapshot, writePresenceSnapshot, type PresenceSnapshot } from "./snapshot.js";
import {
  appendExperiment, assertNoControlUrls, experimentId, readExperiments, type ExperimentRunner,
} from "./experiments.js";
import { IndexNowSubmit } from "./indexnow.js";
import { renderTimeline } from "./timeline.js";

export interface PresenceCliDeps {
  now: () => string;
  targetsPath: string;
  presenceDir: string;
  engines: GeoEngineClient[];
  runs: number;
  pageFetch?: PageFetch;
  pageProxyFetch?: PageFetch;
}

export async function probeCommand(d: PresenceCliDeps): Promise<{ snap: PresenceSnapshot; path: string }> {
  const targets = loadTargets(d.targetsPath);
  const statuses: PageStatus[] = [];
  const phrases: Record<string, string | null> = {};
  for (const item of targets.items) {
    const { status, html } = await fetchPage(item.pageUrl, d.pageFetch, d.pageProxyFetch);
    const phrase = status === 200 ? extractPhrase(html) : null;
    statuses.push({ pageUrl: item.pageUrl, httpStatus: status, phrase });
    phrases[item.pageUrl] = phrase;
  }
  const rungs = buildLadder(targets, phrases);
  const raw = await runProbe(rungs, d.engines, { runs: d.runs });
  const verdicts = classifyPresence(targets, statuses, raw, d.engines.map((e) => e.name));
  const snap: PresenceSnapshot = { takenAt: d.now(), verdicts, raw };
  const path = writePresenceSnapshot(d.presenceDir, snap);
  return { snap, path };
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const targetsPath = process.env.TARGETS_PATH ?? "config/steady-targets.json";
  const presenceDir = process.env.PRESENCE_DIR ?? "presence";

  if (cmd === "probe") {
    const runsEnv = Number(process.env.PRESENCE_RUNS ?? 2);
    const runs = Number.isFinite(runsEnv) && runsEnv > 0 ? runsEnv : 2; // malformed env must not zero the probe
    const { snap, path } = await probeCommand({
      now: () => new Date().toISOString(),
      targetsPath, presenceDir, engines: buildEngines(process.env), runs,
    });
    for (const v of snap.verdicts) {
      console.log(`${v.best}  ${v.pageUrl}${v.control ? " [control]" : ""}`);
      for (const p of v.perEngine) console.log(`  ${p.engine}: ${p.verdict} — ${p.reasons.join("; ")}`);
    }
    console.log(`presence snapshot written: ${path}`);
    return;
  }

  if (cmd === "submit") {
    const targets = loadTargets(targetsPath);
    const key = process.env.INDEXNOW_KEY ?? "";
    if (!key) { console.error("INDEXNOW_KEY required"); process.exit(1); }
    const urls = [`https://${targets.brandDomain}/`, ...targets.items.filter((i) => !i.control).map((i) => i.pageUrl)];
    assertNoControlUrls(urls, targets); // defense in depth: the filter above should already exclude controls
    const runner: ExperimentRunner = new IndexNowSubmit({
      key, host: targets.brandDomain, keyLocation: process.env.INDEXNOW_KEY_LOCATION || undefined,
    });
    const at = new Date().toISOString();
    const res = await runner.run(urls);
    appendExperiment(presenceDir, {
      id: experimentId(at, runner.name), at, kind: "automated", name: runner.name,
      scope: runner.scope, urls, outcome: res.outcome, notes: res.notes,
    });
    console.log(`${runner.name}: ${res.outcome} — ${res.notes}`);
    return;
  }

  if (cmd === "log") {
    const name = argv[1];
    const scope = argv[2];
    if (!name || (scope !== "url" && scope !== "domain")) {
      console.error('usage: log <name> <url|domain> [urls...] [--notes "..."]');
      process.exit(1);
    }
    const rest = argv.slice(3);
    const notesIdx = rest.indexOf("--notes");
    const urls = notesIdx === -1 ? rest : rest.slice(0, notesIdx);
    const notes = notesIdx === -1 ? "" : rest.slice(notesIdx + 1).join(" ");
    const targets = loadTargets(targetsPath);
    if (scope === "url") assertNoControlUrls(urls, targets);
    const at = new Date().toISOString();
    appendExperiment(presenceDir, {
      id: experimentId(at, name), at, kind: "manual", name, scope, urls, outcome: "recorded", notes,
    });
    console.log(`recorded: ${name} (${scope})`);
    return;
  }

  if (cmd === "timeline") {
    const snaps = !existsSync(presenceDir) ? [] : readdirSync(presenceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => readPresenceSnapshot(join(presenceDir, e.name)))
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    console.log(renderTimeline(snaps, existsSync(presenceDir) ? readExperiments(presenceDir) : []));
    return;
  }

  console.error('usage: probe | submit | log <name> <url|domain> [urls...] [--notes "..."] | timeline');
  process.exit(1);
}

if (process.argv[1] && /presence\/cli\.(js|ts|mts|cts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
