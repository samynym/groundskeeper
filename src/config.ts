import { z } from "zod";

const Schema = z.object({
  TARGET_REPO_PATH: z.string().min(1),
  TARGET_ORIGIN: z.string().url(),
  GSC_SA_JSON: z.string().min(1),
  GSC_PROPERTY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  GROUNDSKEEPER_MODEL: z.string().default("claude-sonnet-4-6"),
  TARGET_BASE_BRANCH: z.string().default("main"),
});

export interface Config {
  targetRepoPath: string;
  targetOrigin: string;
  gscSaJson: string;
  gscProperty: string;
  anthropicApiKey: string;
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
  return {
    targetRepoPath: e.TARGET_REPO_PATH,
    targetOrigin: e.TARGET_ORIGIN,
    gscSaJson: e.GSC_SA_JSON,
    gscProperty: e.GSC_PROPERTY,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.GROUNDSKEEPER_MODEL,
    baseBranch: e.TARGET_BASE_BRANCH,
  };
}
