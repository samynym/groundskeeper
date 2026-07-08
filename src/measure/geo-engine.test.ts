import { describe, it, expect } from "vitest";
import { FakeEngine } from "./geo-engine.js";

describe("FakeEngine", () => {
  it("returns scripted answers in order", async () => {
    const e = new FakeEngine("fake", [
      { answerText: "a", citedUrls: ["https://growsteady.me/x"], ok: true },
      { answerText: "b", citedUrls: [], ok: true },
    ]);
    expect((await e.ask("q")).answerText).toBe("a");
    expect((await e.ask("q")).citedUrls).toEqual([]);
  });
  it("throws when exhausted", async () => {
    const e = new FakeEngine("fake", []);
    await expect(e.ask("q")).rejects.toThrow(/exhausted/);
  });
});
