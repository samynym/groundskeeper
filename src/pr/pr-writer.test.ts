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

  it("finalize: correct command sequence, audit table in --body, no merge, returns PR URL", async () => {
    const calls: [string, string[]][] = [];
    const w = new PRWriter({
      targetRepoPath: "/tmp/s",
      baseBranch: "main",
      runner: async (c, a) => {
        calls.push([c, a]);
        if (c === "git" && a[0] === "rev-parse") return { stdout: "groundskeeper/hip-arthroscopy-fai-123\n", stderr: "" };
        return { stdout: "https://github.com/org/repo/pull/1\n", stderr: "" };
      },
    });
    const result = await w.finalize(goldenEvidence.ref, groundedOps, goldenEvidence);

    // Command sequence by first token
    const sequence = calls.map(([c, a]) => `${c} ${a[0]}`);
    expect(sequence).toEqual(["git rev-parse", "git add", "git commit", "git push", "gh pr"]);

    // gh pr call has --body with audit table header and PMC8530429
    const ghCall = calls.find(([c, a]) => c === "gh" && a[0] === "pr");
    expect(ghCall).toBeDefined();
    const bodyIdx = ghCall![1].indexOf("--body");
    expect(bodyIdx).toBeGreaterThan(-1);
    const bodyValue = ghCall![1][bodyIdx + 1];
    expect(bodyValue).toContain("| Change | Claim | Source |");
    expect(bodyValue).toContain("PMC8530429");

    // No merge command issued
    expect(calls.every(([c, a]) => !(c === "gh" && a.includes("merge")) && !(c === "git" && a[0] === "merge"))).toBe(true);

    // Returns trimmed PR URL
    expect(result).toBe("https://github.com/org/repo/pull/1");
  });

  it("abort: checks out base then deletes branch", async () => {
    const calls: [string, string[]][] = [];
    const w = new PRWriter({
      targetRepoPath: "/tmp/s",
      baseBranch: "main",
      runner: async (c, a) => { calls.push([c, a]); return { stdout: "", stderr: "" }; },
    });
    await w.abort("groundskeeper/x");

    const sequence = calls.map(([c, a]) => `${c} ${a[0]}`);
    expect(sequence).toEqual(["git checkout", "git branch"]);
    const branchDeleteCall = calls.find(([c, a]) => c === "git" && a[0] === "branch");
    expect(branchDeleteCall![1]).toContain("-D");
    expect(branchDeleteCall![1]).toContain("groundskeeper/x");
  });
});
