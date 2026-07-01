import { describe, it, expect } from "vitest";
import { BuildVerifier } from "./verifier.js";

describe("BuildVerifier", () => {
  it("ok when all commands succeed", async () => {
    const v = new BuildVerifier({ targetRepoPath: "/tmp/x", commands: [["true", []]], runner: async () => ({ stdout: "ok", stderr: "" }) });
    expect((await v.verify()).ok).toBe(true);
  });
  it("fails on non-zero exit", async () => {
    const v = new BuildVerifier({ targetRepoPath: "/tmp/x", commands: [["tsc", ["--noEmit"]]], runner: async () => { const e: any = new Error("type error"); e.stdout = "err TS2322"; throw e; } });
    const r = await v.verify();
    expect(r.ok).toBe(false);
    expect(r.log).toMatch(/TS2322/);
  });
});
