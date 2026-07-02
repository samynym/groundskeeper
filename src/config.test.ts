import { describe, it, expect } from "vitest";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("parses a full env", () => {
    const c = loadConfig({
      TARGET_REPO_PATH: "/tmp/steady", TARGET_ORIGIN: "https://growsteady.me",
      GSC_SA_JSON: "/tmp/sa.json", GSC_PROPERTY: "sc-domain:growsteady.me",
      ANTHROPIC_API_KEY: "sk-ant-x", TARGET_BASE_BRANCH: "main",
    });
    expect(c.targetRepoPath).toBe("/tmp/steady");
    expect(c.model).toBe("claude-sonnet-4-6"); // default
  });
  it("throws on missing required var", () => {
    expect(() => loadConfig({})).toThrow(/TARGET_REPO_PATH/);
  });
  it("defaults llmMode to sdk", () => {
    const c = loadConfig({ TARGET_REPO_PATH: "/x", TARGET_ORIGIN: "https://x.io", ANTHROPIC_API_KEY: "sk-ant-x" });
    expect(c.llmMode).toBe("sdk");
  });
  it("cli mode needs no API key and no GSC creds", () => {
    const c = loadConfig({ TARGET_REPO_PATH: "/x", TARGET_ORIGIN: "https://x.io", GROUNDSKEEPER_LLM: "cli" });
    expect(c.llmMode).toBe("cli");
    expect(c.anthropicApiKey).toBe("");
    expect(c.gscSaJson).toBe("");
  });
  it("sdk mode without an API key throws a clear error", () => {
    expect(() => loadConfig({ TARGET_REPO_PATH: "/x", TARGET_ORIGIN: "https://x.io" })).toThrow(/ANTHROPIC_API_KEY/);
  });
});
