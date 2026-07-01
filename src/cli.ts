import "dotenv/config";
import { loadConfig, type Config } from "./config.js";
import { AnthropicClient } from "./llm/client.js";
import { SteadyContentSource } from "./content-source/steady.js";
import { PerformanceSignal } from "./performance/gsc.js";
import { TargetSelector } from "./selector/target-selector.js";
import { EvidenceRetriever } from "./evidence/retriever.js";
import { RefreshDrafter } from "./drafter/refresh-drafter.js";
import { GroundingGuard } from "./guard/grounding-guard.js";
import { BuildVerifier } from "./build/verifier.js";
import { PRWriter } from "./pr/pr-writer.js";
import { Orchestrator } from "./orchestrator.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PageRef } from "./types.js";

export function buildOrchestrator(config: Config): Orchestrator {
  const llm = new AnthropicClient(config.anthropicApiKey, config.model);
  const cs = new SteadyContentSource({ repoPath: config.targetRepoPath, targetOrigin: config.targetOrigin });

  const retriever = new EvidenceRetriever({
    readContent: (ref) => cs.readContent(ref),
    loadCurvePoints: async (slug) => {
      const mod = await import(`file://${join(config.targetRepoPath, "lib/benchmarks/curves/index.ts")}`).catch(() => ({}));
      const curve = (Object.values(mod as any).flat() as any[]).find?.((c) => c?.slug === slug);
      return curve?.points ?? [];
    },
    readDossier: async (slug) => readFile(join(config.targetRepoPath, "docs/benchmarks/recovery-data-sources.md"), "utf8").catch(() => ""),
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
