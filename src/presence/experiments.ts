import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TargetSet } from "../measure/targets.js";

export type ExperimentScope = "url" | "domain";

/** One dated presence intervention. Automated and manual share this record —
 *  the interventions most likely to work (real links) are the manual ones. */
export interface PresenceExperiment {
  id: string;                          // `${at}-${slug(name)}`, derived — no random IDs
  at: string;                          // ISO, injected clock
  kind: "automated" | "manual";
  name: string;
  scope: ExperimentScope;
  urls: string[];                      // [] when scope === "domain"
  outcome: "applied" | "failed" | "recorded";
  notes: string;
}

export interface ExperimentRunner {
  name: string;
  scope: ExperimentScope;
  run(urls: string[]): Promise<{ outcome: "applied" | "failed"; notes: string }>;
}

export function experimentId(at: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${at}-${slug}`;
}

const FILE = "experiments.jsonl";

/** Append-only: history cannot be quietly rewritten. */
export function appendExperiment(dir: string, exp: PresenceExperiment): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FILE), JSON.stringify(exp) + "\n");
}

export function readExperiments(dir: string): PresenceExperiment[] {
  const p = join(dir, FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as PresenceExperiment);
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return u.trim().replace(/\/$/, "").toLowerCase();
  }
}

/** A url-scoped experiment naming a control page would destroy the study's
 *  only attribution mechanism. Refuse loudly. */
export function assertNoControlUrls(urls: string[], targets: TargetSet): void {
  const controls = new Set(targets.items.filter((i) => i.control).map((i) => normUrl(i.pageUrl)));
  for (const u of urls) {
    if (controls.has(normUrl(u))) throw new Error(`refusing experiment on control page: ${u}`);
  }
}
