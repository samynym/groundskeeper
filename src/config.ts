import { z } from "zod";

const Schema = z.object({
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_ORIGIN: z.string().url(),
  // GSC is optional: absent creds → performance snapshot degrades to staleness-only selection.
  GSC_SA_JSON: z.string().default(""),
  GSC_PROPERTY: z.string().default(""),
  // Optional: only required in "sdk" LLM mode (see below). In "cli" mode the ambient claude CLI is used.
  ANTHROPIC_API_KEY: z.string().default(""),
  GROUNDSKEEPER_LLM: z.enum(["sdk", "cli"]).default("sdk"),
  GROUNDSKEEPER_MODEL: z.string().default("claude-sonnet-4-6"),
  TARGET_BASE_BRANCH: z.string().default("main"),
});

export interface Config {
  targetRepoPath: string;
  targetOrigin: string;
  gscSaJson: string;
  gscProperty: string;
  anthropicApiKey: string;
  llmMode: "sdk" | "cli";
  model: string;
  baseBranch: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const p = Schema.safeParse(env);
  if (!p.success) {
    const missing = p.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid/missing config: ${missing}`);
  }
  const e = p.data;
  if (e.GROUNDSKEEPER_LLM === "sdk" && !e.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required when GROUNDSKEEPER_LLM=sdk (use GROUNDSKEEPER_LLM=cli to use the ambient claude CLI instead)");
  }
  return {
    targetRepoPath: e.TARGET_REPO_PATH,
    targetOrigin: e.TARGET_ORIGIN,
    gscSaJson: e.GSC_SA_JSON,
    gscProperty: e.GSC_PROPERTY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    llmMode: e.GROUNDSKEEPER_LLM,
    model: e.GROUNDSKEEPER_MODEL,
    baseBranch: e.TARGET_BASE_BRANCH,
  };
}
