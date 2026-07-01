import { describe, it, expect } from "vitest";
import { judgeClaim } from "./judge.js";
import { FakeLlm } from "../llm/client.js";

describe("judgeClaim", () => {
  it("accepts a supported claim", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: true, reason: "passage states 87%" })]);
    const r = await judgeClaim(llm, "87% return to sport", "Memon: 87% returned to sport by 12 months");
    expect(r.supported).toBe(true);
  });
  it("defaults to reject on unparseable output", async () => {
    const llm = new FakeLlm(["I think it's fine, probably."]);
    const r = await judgeClaim(llm, "claim", "passage");
    expect(r.supported).toBe(false);
    expect(r.reason).toMatch(/unparseable|reject/i);
  });
  it("rejects an unsupported claim", async () => {
    const llm = new FakeLlm([JSON.stringify({ supported: false, reason: "no such number in passage" })]);
    const r = await judgeClaim(llm, "95% return", "passage says 87%");
    expect(r.supported).toBe(false);
  });
});
