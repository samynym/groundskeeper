import { describe, it, expect } from "vitest";
import { TargetSelector } from "./target-selector.js";
import type { PageRef, GscRow } from "../types.js";

const pages: PageRef[] = [
  { procedureSlug: "a", urlSlug: "a", week: null, url: "https://s/a" },
  { procedureSlug: "b", urlSlug: "b", week: null, url: "https://s/b" },
];
const gsc: Record<string, GscRow> = {
  "https://s/a": { url: "https://s/a", clicks: 1, impressions: 500, ctr: 0.002, position: 18 }, // page 2, low ctr
  "https://s/b": { url: "https://s/b", clicks: 40, impressions: 500, ctr: 0.08, position: 3 },   // healthy
};
const now = 1_800_000_000_000;
const deps = {
  interpolatedCount: async (r: PageRef) => (r.procedureSlug === "a" ? 5 : 0),
  sourceCount: async (r: PageRef) => (r.procedureSlug === "a" ? 1 : 8),
  lastEditedAt: async (slug: string) => (slug === "a" ? now - 200 * 864e5 : now - 2 * 864e5),
};

describe("TargetSelector", () => {
  it("ranks the underperforming+stale page first", async () => {
    const sel = new TargetSelector(deps);
    const ranked = await sel.rank(pages, gsc, now);
    expect(ranked[0].ref.procedureSlug).toBe("a");
    expect(ranked[0].reasons.length).toBeGreaterThan(0);
  });
  it("pickOne returns the top candidate", async () => {
    const sel = new TargetSelector(deps);
    const top = sel.pickOne(await sel.rank(pages, gsc, now));
    expect(top?.ref.procedureSlug).toBe("a");
  });
});
