import { describe, it, expect } from "vitest";
import { FakeLlm } from "./client.js";

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
