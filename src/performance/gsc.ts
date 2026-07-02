import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { GscRow } from "../types.js";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string }>;

export interface PerfOpts {
  targetRepoPath: string;
  targetOrigin: string;
  gscSaJson: string;
  gscProperty: string;
  runner?: Runner;
}

interface SeoLoopRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SeoLoopOutput {
  generatedAt: string;
  search:
    | { ok: false; reason: string }
    | {
        ok: true;
        property?: string;
        ranges?: unknown;
        trend?: unknown;
        counts?: unknown;
        mode?: unknown;
        topQueries?: unknown[];
        strikingDistance: SeoLoopRow[];
        ctrOpportunities: SeoLoopRow[];
      };
  audit?: unknown;
}

export class PerformanceSignal {
  private runner: Runner;
  constructor(private opts: PerfOpts) {
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }

  async snapshot(): Promise<Record<string, GscRow>> {
    // Performance data is a SIGNAL, not a requirement. If GSC creds are absent or the loop script
    // errors (e.g. the keyless cloud run drops GSC), degrade to {} so selection falls back to
    // staleness — never let a missing signal abort the whole cycle.
    let data: SeoLoopOutput;
    try {
      const { stdout } = await this.runner("node", ["scripts/seo-loop.mjs"], {
        cwd: this.opts.targetRepoPath,
        env: { ...process.env, GSC_SA_JSON: this.opts.gscSaJson, GSC_PROPERTY: this.opts.gscProperty },
      });
      data = JSON.parse(stdout) as SeoLoopOutput;
    } catch {
      return {};
    }

    if (!data.search || !data.search.ok) {
      return {};
    }

    const search = data.search;
    const rows: SeoLoopRow[] = [
      ...(search.ctrOpportunities ?? []),
      ...(search.strikingDistance ?? []),
    ];

    // Aggregate by page
    const agg = new Map<string, { clicks: number; impressions: number; weightedPositionSum: number }>();

    for (const r of rows) {
      const url = r.page.startsWith("http") ? r.page : this.opts.targetOrigin + r.page;
      const existing = agg.get(url);
      if (existing) {
        existing.clicks += r.clicks;
        existing.impressions += r.impressions;
        existing.weightedPositionSum += r.position * r.impressions;
      } else {
        agg.set(url, {
          clicks: r.clicks,
          impressions: r.impressions,
          weightedPositionSum: r.position * r.impressions,
        });
      }
    }

    const out: Record<string, GscRow> = {};
    for (const [url, acc] of agg) {
      const impressions = acc.impressions;
      const clicks = acc.clicks;
      const ctr = impressions > 0 ? clicks / impressions : 0;
      const position = impressions > 0 ? acc.weightedPositionSum / impressions : 0;
      out[url] = { url, clicks, impressions, ctr, position };
    }
    return out;
  }
}
