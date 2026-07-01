import { describe, it, expect } from "vitest";
import { Orchestrator } from "./orchestrator.js";
import { goldenEvidence, groundedOps } from "../test/fixtures/evidence.js";

function baseDeps(overrides = {}) {
  return {
    performance: { snapshot: async () => ({ [goldenEvidence.ref.url]: { url: goldenEvidence.ref.url, clicks: 1, impressions: 400, ctr: 0.004, position: 18 } }) },
    contentSource: {
      listPages: async () => [goldenEvidence.ref],
      readContent: async () => ({ prose: { outlook: "Most return within a year." }, sources: goldenEvidence.sources }),
      applyOps: async () => {},
    },
    selector: { rank: async () => [{ ref: goldenEvidence.ref, score: 5, reasons: ["page-2"] }], pickOne: (c: any[]) => c[0] ?? null },
    retriever: { retrieve: async () => goldenEvidence },
    drafter: { draft: async () => ({ ref: goldenEvidence.ref, ops: groundedOps, rationale: "r" }) },
    guard: { check: async () => ({ verdicts: [], passedOps: groundedOps, allPassed: true }) },
    build: { verify: async () => ({ ok: true, log: "ok" }) },
    pr: { startBranch: async () => "groundskeeper/x", finalize: async () => "https://github.com/pr/1", abort: async () => {} },
    now: () => 1_800_000_000_000,
    ...overrides,
  } as any;
}

describe("Orchestrator", () => {
  it("dry-run returns audit without opening a PR", async () => {
    const deps = baseDeps();
    const o = new Orchestrator(deps);
    const r = await o.runOnce({ dryRun: true });
    expect(r.status).toBe("dry-run");
    expect(r.passedOps.length).toBe(groundedOps.length);
  });
  it("opens a PR on a full run", async () => {
    const o = new Orchestrator(baseDeps());
    const r = await o.runOnce({ dryRun: false });
    expect(r.status).toBe("pr-opened");
    expect(r.detail).toContain("github.com/pr/1");
  });
  it("aborts and reports when build fails", async () => {
    let aborted = false;
    const o = new Orchestrator(baseDeps({ build: { verify: async () => ({ ok: false, log: "TS2322" }) }, pr: { startBranch: async () => "b", finalize: async () => "x", abort: async () => { aborted = true; } } }));
    const r = await o.runOnce({ dryRun: false });
    expect(r.status).toBe("build-failed");
    expect(aborted).toBe(true);
  });
  it("reports no-target when selector picks nothing", async () => {
    const o = new Orchestrator(baseDeps({ selector: { rank: async () => [], pickOne: () => null } }));
    expect((await o.runOnce({ dryRun: false })).status).toBe("no-target");
  });
  it("returns nothing-passed when guard passes no ops", async () => {
    const o = new Orchestrator(baseDeps({ guard: { check: async () => ({ verdicts: [], passedOps: [], allPassed: false }) } }));
    const r = await o.runOnce({ dryRun: false });
    expect(r.status).toBe("nothing-passed");
    expect(r.passedOps.length).toBe(0);
  });
  it("aborts and re-throws if applyOps throws", async () => {
    let aborted = false;
    const base = baseDeps();
    const o = new Orchestrator(baseDeps({
      pr: { startBranch: async () => "groundskeeper/x", finalize: async () => "x", abort: async () => { aborted = true; } },
      contentSource: { listPages: base.contentSource.listPages, readContent: base.contentSource.readContent, applyOps: async () => { throw new Error("boom"); } },
    }));
    await expect(o.runOnce({ dryRun: false })).rejects.toThrow(/boom/);
    expect(aborted).toBe(true);
  });
});
