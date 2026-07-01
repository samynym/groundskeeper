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
  it("does not add age bonus when lastEditedAt is unknown (0)", async () => {
    const unknownPage = { procedureSlug: "unknown", urlSlug: "unknown", week: null, url: "https://s/unknown" };
    const recentPage = { procedureSlug: "recent", urlSlug: "recent", week: null, url: "https://s/recent" };
    const oldPage = { procedureSlug: "old", urlSlug: "old", week: null, url: "https://s/old" };

    const testDeps = {
      interpolatedCount: async () => 0,
      sourceCount: async () => 8,
      lastEditedAt: async (slug: string) => {
        if (slug === "unknown") return 0;           // Unknown edit time
        if (slug === "recent") return now - 5 * 864e5;  // 5 days old
        if (slug === "old") return now - 200 * 864e5;   // 200 days old
        return 0;
      },
    };

    const sel = new TargetSelector(testDeps);
    const ranked = await sel.rank([unknownPage, recentPage, oldPage], {}, now);

    const unknownCandidate = ranked.find(c => c.ref.procedureSlug === "unknown");
    const oldCandidate = ranked.find(c => c.ref.procedureSlug === "old");

    // Unknown page must NOT have "since last edit" in reasons
    expect(unknownCandidate?.reasons.some(r => r.includes("since last edit"))).toBe(false);

    // Old page MUST have "since last edit" in reasons
    expect(oldCandidate?.reasons.some(r => r.includes("since last edit"))).toBe(true);
  });
});
