import { describe, it, expect } from "vitest";
import { buildOrchestrator } from "./cli.js";

describe("buildOrchestrator", () => {
  it("wires an Orchestrator from config without touching the network", () => {
    const o = buildOrchestrator({
      targetRepoPath: "/tmp/steady", targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json", gscProperty: "sc-domain:growsteady.me",
      anthropicApiKey: "sk-ant-x", llmMode: "sdk", model: "claude-sonnet-4-6", baseBranch: "main",
    });
    expect(o).toBeTruthy();
    expect(typeof (o as any).runOnce).toBe("function");
  });
  it("wires a cli-mode Orchestrator with no API key", () => {
    const o = buildOrchestrator({
      targetRepoPath: "/tmp/steady", targetOrigin: "https://growsteady.me",
      gscSaJson: "", gscProperty: "",
      anthropicApiKey: "", llmMode: "cli", model: "sonnet", baseBranch: "main",
    });
    expect(o).toBeTruthy();
  });
});
