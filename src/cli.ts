import "dotenv/config";
import { loadConfig, type Config } from "./config.js";
import { AnthropicClient } from "./llm/client.js";
import { SteadyContentSource } from "./content-source/steady.js";
import { PerformanceSignal } from "./performance/gsc.js";
import { TargetSelector } from "./selector/target-selector.js";
import { EvidenceRetriever } from "./evidence/retriever.js";
import { expandPainBand } from "./evidence/expand-curve.js";
import { RefreshDrafter } from "./drafter/refresh-drafter.js";
import { GroundingGuard } from "./guard/grounding-guard.js";
import { BuildVerifier } from "./build/verifier.js";
import { PRWriter } from "./pr/pr-writer.js";
import { Orchestrator } from "./orchestrator.js";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PageRef } from "./types.js";

export function buildOrchestrator(config: Config): Orchestrator {
  const llm = new AnthropicClient(config.anthropicApiKey, config.model);
  const cs = new SteadyContentSource({ repoPath: config.targetRepoPath, targetOrigin: config.targetOrigin });

  const retriever = new EvidenceRetriever({
    readContent: (ref) => cs.readContent(ref),
    loadCurvePoints: async (slug) => {
      const curvesUrl = pathToFileURL(join(config.targetRepoPath, "lib/benchmarks/curves/index.ts")).href;
      const mod = await import(curvesUrl).catch(() => ({})) as Record<string, unknown>;
      // Prefer the named `curves` export; fall back to the first array export.
      let curvesArr: any[] = [];
      if (Array.isArray((mod as any).curves)) {
        curvesArr = (mod as any).curves;
      } else {
        for (const v of Object.values(mod)) {
          if (Array.isArray(v)) { curvesArr = v; break; }
        }
      }
      const curve = curvesArr.find((c: any) => c?.slug === slug);
      if (!curve || !Array.isArray(curve.painBand)) return [];
      return expandPainBand(curve);
    },
    readDossier: async (_slug) => {
      // TODO: scope docs/benchmarks/recovery-data-sources.md to the procedure section
      // Returning "" for now — per-procedure evidence comes from the curve's structured
      // sources and painBand points. The 166 KB whole-dossier would bloat the drafter
      // prompt and isn't scoped to the procedure being refreshed.
      return "";
    },
  });

  const selector = new TargetSelector({
    interpolatedCount: async (ref: PageRef) => cs.interpolatedCount(ref.procedureSlug),
    sourceCount: async (ref) => (await cs.readContent(ref)).sources.length,
    lastEditedAt: (slug) => cs.lastEditedAt(slug),
  });

  return new Orchestrator({
    performance: new PerformanceSignal({ targetRepoPath: config.targetRepoPath, targetOrigin: config.targetOrigin, gscSaJson: config.gscSaJson, gscProperty: config.gscProperty }),
    contentSource: cs,
    selector,
    retriever,
    drafter: new RefreshDrafter(llm),
    guard: new GroundingGuard(llm, { currentBasis: (s, w, b) => cs.currentBasis(s, w, b) }),
    build: new BuildVerifier({ targetRepoPath: config.targetRepoPath }),
    pr: new PRWriter({ targetRepoPath: config.targetRepoPath, baseBranch: config.baseBranch }),
    now: () => Date.now(),
  });
}

export async function main(argv: string[]): Promise<void> {
  const dryRun = argv.includes("--dry-run");
  const o = buildOrchestrator(loadConfig());
  const result = await o.runOnce({ dryRun });
  console.log(JSON.stringify(result, null, 2));
}

// Only run when executed directly.
if (process.argv[1] && process.argv[1].endsWith("cli.js")) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
