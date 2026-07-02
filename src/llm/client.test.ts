import { describe, it, expect } from "vitest";
import { FakeLlm, ClaudeCliClient } from "./client.js";

describe("ClaudeCliClient", () => {
  it("invokes `claude -p` with the model and folds system+user into the prompt, returning stdout", async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const client = new ClaudeCliClient("sonnet", async (cmd, args) => {
      calls.push({ cmd, args });
      return { stdout: '{"supported":true}' };
    });
    const out = await client.complete({ system: "SYSTEM_RULES", user: "USER_INPUT" });
    expect(out).toBe('{"supported":true}');
    expect(calls[0].cmd).toBe("claude");
    expect(calls[0].args).toContain("-p");
    expect(calls[0].args).toContain("--model");
    expect(calls[0].args).toContain("sonnet");
    const prompt = calls[0].args[calls[0].args.indexOf("-p") + 1];
    expect(prompt).toContain("SYSTEM_RULES");
    expect(prompt).toContain("USER_INPUT");
  });
  it("omits --model when none is given", async () => {
    let seen: string[] = [];
    const client = new ClaudeCliClient(undefined, async (_c, args) => { seen = args; return { stdout: "x" }; });
    await client.complete({ system: "s", user: "u" });
    expect(seen).not.toContain("--model");
  });
});

describe("FakeLlm", () => {
  it("returns scripted responses in order and records calls", async () => {
    const llm = new FakeLlm(["first", "second"]);
    expect(await llm.complete({ system: "s", user: "u1" })).toBe("first");
    expect(await llm.complete({ system: "s", user: "u2" })).toBe("second");
    expect(llm.calls.map((c) => c.user)).toEqual(["u1", "u2"]);
  });
  it("throws when exhausted", async () => {
    const llm = new FakeLlm([]);
    await expect(llm.complete({ system: "s", user: "u" })).rejects.toThrow(/exhausted/);
  });
});
