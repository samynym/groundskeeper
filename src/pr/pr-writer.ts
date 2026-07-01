import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { EditOp, EvidenceSet, PageRef } from "../types.js";
import { claimsOf } from "../types.js";

const pexec = promisify(execFile);
type Runner = (cmd: string, args: string[], opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export interface PRWriterOpts {
  targetRepoPath: string;
  baseBranch: string;
  runner?: Runner;
}

export class PRWriter {
  private runner: Runner;
  constructor(private opts: PRWriterOpts) {
    this.runner = opts.runner ?? ((c, a, o) => pexec(c, a, o));
  }
  private git(args: string[]) { return this.runner("git", args, { cwd: this.opts.targetRepoPath }); }

  async startBranch(ref: PageRef): Promise<string> {
    const { stdout: statusOut } = await this.git(["status", "--porcelain"]);
    if (statusOut.trim()) {
      throw new Error("target repo has uncommitted changes; refusing to run (commit/stash them first)");
    }
    const branch = `groundskeeper/${ref.procedureSlug}-${Date.now()}`;
    await this.git(["fetch", "origin", this.opts.baseBranch]);
    await this.git(["checkout", "-B", branch, this.opts.baseBranch]);
    return branch;
  }

  buildAuditTable(ops: EditOp[], ev: EvidenceSet): string {
    const rows = ops.flatMap((op) =>
      claimsOf(op).map((c) => {
        const title = ev.facts.find((f) => f.sourceUrl === c.sourceUrl)?.sourceTitle ?? c.sourceUrl;
        return `| ${op.type} | ${c.text} | [${title}](${c.sourceUrl}) |`;
      })
    );
    return ["| Change | Claim | Source |", "| --- | --- | --- |", ...rows].join("\n");
  }

  async finalize(ref: PageRef, ops: EditOp[], ev: EvidenceSet): Promise<string> {
    const branch = (await this.git(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    await this.git(["add", "-A"]);
    await this.git(["commit", "-m", `content: refresh ${ref.procedureSlug}\n\nAutomated grounded refresh (groundskeeper).`]);
    await this.git(["push", "-u", "origin", branch]);
    const body = [
      `Automated grounded refresh of \`${ref.procedureSlug}\`.`,
      ``,
      `Every claim below traces to a source already in the evidence base.`,
      ``,
      this.buildAuditTable(ops, ev),
    ].join("\n");
    const { stdout } = await this.runner("gh", ["pr", "create", "--base", this.opts.baseBranch, "--head", branch, "--title", `Refresh: ${ref.procedureSlug}`, "--body", body], { cwd: this.opts.targetRepoPath });
    return stdout.trim();
  }

  async abort(branch: string): Promise<void> {
    await this.git(["checkout", this.opts.baseBranch]);
    await this.git(["branch", "-D", branch]);
  }
}
