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
});
