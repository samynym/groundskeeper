import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTargets } from "./targets.js";

function tmpJson(obj: unknown): string {
  const p = join(mkdtempSync(join(tmpdir(), "gk-t-")), "targets.json");
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

describe("loadTargets", () => {
  it("parses items, questions, and control flags", () => {
    const p = tmpJson({ brandDomain: "growsteady.me", brandPhrases: ["growsteady"], items: [
      { pageUrl: "https://growsteady.me/a", procedureSlug: "acl", control: false, questions: ["q1", "q2"] },
      { pageUrl: "https://growsteady.me/b", procedureSlug: "hip", control: true, questions: ["q3"] },
    ] });
    const t = loadTargets(p);
    expect(t.brandDomain).toBe("growsteady.me");
    expect(t.items).toHaveLength(2);
    expect(t.items[0].questions).toEqual(["q1", "q2"]);
    expect(t.items[1].control).toBe(true);
  });
  it("throws when brandDomain is missing", () => {
    const p = tmpJson({ items: [] });
    expect(() => loadTargets(p)).toThrow(/brandDomain/);
  });
  it("loads the committed Steady config", () => {
    const t = loadTargets("config/steady-targets.json");
    expect(t.items.length).toBeGreaterThan(0);
    expect(t.items.some((i) => i.control)).toBe(true);
  });
  it("discovery is off unless the config sets it to true", () => {
    expect(loadTargets("config/steady-targets.json").discovery).toBeUndefined();
    const p = tmpJson({ brandDomain: "g.me", discovery: "yes", items: [] });
    expect(loadTargets(p).discovery).toBeUndefined();
  });
  it("loads the committed discovery config: 10 distinct questions, one per item, no R2 slug", () => {
    const t = loadTargets("config/steady-discovery.json");
    expect(t.discovery).toBe(true);
    expect(t.brandDomain).toBe("growsteady.me");
    expect(t.items).toHaveLength(10);
    expect(t.items.every((i) => i.questions.length === 1 && i.procedureSlug === "" && !i.control)).toBe(true);
    expect(new Set(t.items.map((i) => i.questions[0])).size).toBe(10);
    expect(new Set(t.items.map((i) => i.pageUrl))).toEqual(
      new Set(["https://growsteady.me/about", "https://growsteady.me/recovery"]));
  });
});
