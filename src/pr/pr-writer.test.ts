import { describe, it, expect } from "vitest";
import { PRWriter } from "./pr-writer.js";
import { goldenEvidence, groundedOps } from "../../test/fixtures/evidence.js";

describe("PRWriter", () => {
  it("builds a claim→source audit table", () => {
    const w = new PRWriter({ targetRepoPath: "/tmp/s", baseBranch: "main", runner: async () => ({ stdout: "", stderr: "" }) });
    const md = w.buildAuditTable(groundedOps, goldenEvidence);
    expect(md).toContain("| Change | Claim | Source |");
    expect(md).toContain("PMC8530429");
  });
  it("startBranch issues git checkout -b off base", async () => {
    const calls: string[][] = [];
    const w = new PRWriter({ targetRepoPath: "/tmp/s", baseBranch: "main", runner: async (c, a) => { calls.push([c, ...a]); return { stdout: "", stderr: "" }; } });
    const branch = await w.startBranch(goldenEvidence.ref);
    expect(branch).toMatch(/^groundskeeper\/hip-arthroscopy-fai-/);
    expect(calls.some((c) => c[0] === "git" && c.includes("checkout") && c.includes("main"))).toBe(true);
  });
});
