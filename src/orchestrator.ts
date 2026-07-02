import type { EditOp, EvidenceSet, GscRow, Candidate, Draft, GuardResult, PageRef } from "./types.js";
import type { ReadContent } from "./content-source/index.js";

export interface OrchestratorDeps {
  performance: { snapshot(): Promise<Record<string, GscRow>> };
  contentSource: { listPages(): Promise<PageRef[]>; readContent(ref: PageRef): Promise<ReadContent>; applyOps(ops: EditOp[]): Promise<void> };
  selector: { rank(pages: PageRef[], gsc: Record<string, GscRow>, now: number): Promise<Candidate[]>; pickOne(c: Candidate[]): Candidate | null };
  retriever: { retrieve(ref: PageRef): Promise<EvidenceSet> };
  drafter: { draft(c: Candidate, content: ReadContent, ev: EvidenceSet): Promise<Draft> };
  guard: { check(d: Draft, ev: EvidenceSet): Promise<GuardResult> };
  build: { verify(): Promise<{ ok: boolean; log: string }> };
  pr: { startBranch(ref: PageRef): Promise<string>; finalize(ref: PageRef, ops: EditOp[], ev: EvidenceSet): Promise<string>; abort(branch: string): Promise<void> };
  now: () => number;
}

export interface RunResult {
  status: "no-target" | "nothing-passed" | "build-failed" | "dry-run" | "pr-opened";
  detail: string;
  passedOps: EditOp[];
  /** Ops the drafter proposed but the guard refused, with the reason each was refused. */
  rejected?: Array<{ op: EditOp; failures: string[] }>;
  /** The drafter's stated reasoning for this cycle. */
  rationale?: string;
  /** The procedure slug that was selected this cycle. */
  target?: string;
}

export class Orchestrator {
  constructor(private d: OrchestratorDeps) {}

  async runOnce(opts: { dryRun: boolean }): Promise<RunResult> {
    const gsc = await this.d.performance.snapshot();
    const pages = await this.d.contentSource.listPages();
    const candidate = this.d.selector.pickOne(await this.d.selector.rank(pages, gsc, this.d.now()));
    if (!candidate) return { status: "no-target", detail: "selector found no target", passedOps: [] };

    const ev = await this.d.retriever.retrieve(candidate.ref);
    const content = await this.d.contentSource.readContent(candidate.ref);
    const draft = await this.d.drafter.draft(candidate, content, ev);
    const guard = await this.d.guard.check(draft, ev);
    const meta = {
      rejected: guard.verdicts.filter((v) => !v.ok).map((v) => ({ op: v.op, failures: v.failures })),
      rationale: draft.rationale,
      target: candidate.ref.procedureSlug,
    };
    if (guard.passedOps.length === 0) return { status: "nothing-passed", detail: "guard rejected all ops", passedOps: [], ...meta };

    if (opts.dryRun) return { status: "dry-run", detail: `${guard.passedOps.length} op(s) would ship for ${candidate.ref.procedureSlug}`, passedOps: guard.passedOps, ...meta };

    const branch = await this.d.pr.startBranch(candidate.ref);
    try {
      await this.d.contentSource.applyOps(guard.passedOps);
      const build = await this.d.build.verify();
      if (!build.ok) {
        await this.d.pr.abort(branch);
        return { status: "build-failed", detail: build.log.slice(0, 500), passedOps: guard.passedOps, ...meta };
      }
      const prUrl = await this.d.pr.finalize(candidate.ref, guard.passedOps, ev);
      return { status: "pr-opened", detail: prUrl, passedOps: guard.passedOps, ...meta };
    } catch (err) {
      await this.d.pr.abort(branch);
      throw err;
    }
  }
}
