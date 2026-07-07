import { describe, it, expect } from "vitest";
import { renderReport } from "./report.js";
import type { Snapshot, SnapshotDiff } from "./snapshot.js";

const snap: Snapshot = {
  takenAt: "2026-07-07T10:00:00.000Z",
  seo: { "https://growsteady.me/a": { impressions: 400, clicks: 3, ctr: 0.0075, position: 12.5 } },
  geo: { results: [], targetScore: { citationRate: 0.4, mentionRate: 0.6 }, controlScore: { citationRate: 0.1, mentionRate: 0.2 } },
};

describe("renderReport", () => {
  it("renders SEO and GEO sections", () => {
    const out = renderReport(snap);
    expect(out).toContain("growsteady.me/a");
    expect(out).toContain("target citation rate: 40%");
    expect(out).toContain("control citation rate: 10%");
  });
  it("adds a change section when a diff is given", () => {
    const diff: SnapshotDiff = { seo: [{ pageUrl: "https://growsteady.me/a", impressions: 80, clicks: 0, position: -4 }], targetCitationDelta: 0.3, targetMentionDelta: 0, controlCitationDelta: 0.02, controlMentionDelta: 0 };
    const out = renderReport(snap, diff);
    expect(out).toContain("Change vs baseline");
    expect(out).toContain("target citation");
  });
});
