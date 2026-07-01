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

export class PerformanceSignal {
  private runner: Runner;
  constructor(private opts: PerfOpts) {
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }

  async snapshot(): Promise<Record<string, GscRow>> {
    const { stdout } = await this.runner("node", ["scripts/seo-loop.mjs", "--json"], {
      cwd: this.opts.targetRepoPath,
      env: { ...process.env, GSC_SA_JSON: this.opts.gscSaJson, GSC_PROPERTY: this.opts.gscProperty },
    });
    const data = JSON.parse(stdout) as { rows: Array<{ page: string; clicks: number; impressions: number; ctr: number; position: number }> };
    const out: Record<string, GscRow> = {};
    for (const r of data.rows) {
      const url = r.page.startsWith("http") ? r.page : this.opts.targetOrigin + r.page;
      out[url] = { url, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
    }
    return out;
  }
}
