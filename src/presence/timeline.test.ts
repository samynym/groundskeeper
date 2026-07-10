import { describe, it, expect } from "vitest";
import { renderTimeline } from "./timeline.js";
import type { PresenceSnapshot } from "./snapshot.js";
import type { PresenceExperiment } from "./experiments.js";
import type { PageVerdict } from "./classify.js";

const pv = (best: PageVerdict["best"], control = false): PageVerdict => ({
  pageUrl: "https://g.me/a", procedureSlug: "s", control,
  perEngine: [{ engine: "claude-search", verdict: best, reasons: [] }], best,
});
const snap = (takenAt: string, best: PageVerdict["best"]): PresenceSnapshot =>
  ({ takenAt, verdicts: [pv(best)], raw: [] });
const exp = (at: string, scope: "url" | "domain"): PresenceExperiment => ({
  id: `${at}-x`, at, kind: "manual", name: "backlink from PT clinic", scope, urls: [], outcome: "recorded", notes: "",
});

describe("renderTimeline", () => {
  it("merges snapshots and experiments chronologically", () => {
    const out = renderTimeline([snap("2026-07-12T00:00:00.000Z", "ABSENT")], [exp("2026-07-11T00:00:00.000Z", "url")]);
    const iSnap = out.indexOf("2026-07-12");
    const iExp = out.indexOf("2026-07-11");
    expect(iExp).toBeGreaterThan(-1);
    expect(iSnap).toBeGreaterThan(iExp);
    expect(out).toContain("ABSENT");
    expect(out).toContain("backlink from PT clinic");
  });
  it("marks every snapshot after a domain-scoped experiment with the attribution warning", () => {
    const out = renderTimeline(
      [snap("2026-07-10T00:00:00.000Z", "ABSENT"), snap("2026-07-14T00:00:00.000Z", "CITED")],
      [exp("2026-07-12T00:00:00.000Z", "domain")],
    );
    const [beforeLine, afterLine] = out.split("\n").filter((l) => l.includes("snapshot"));
    expect(beforeLine).not.toContain("post-domain-intervention");
    expect(afterLine).toContain("post-domain-intervention");
    expect(out).toContain("cannot be attributed against controls");
  });
  it("labels control pages and renders the per-engine breakdown", () => {
    const s: PresenceSnapshot = { takenAt: "t", verdicts: [pv("ABSENT", true)], raw: [] };
    const out = renderTimeline([s], []);
    expect(out).toContain("[control]");
    expect(out).toContain("claude-search: ABSENT");
  });
  it("says so when there is nothing to show", () => {
    expect(renderTimeline([], [])).toContain("no snapshots or experiments");
  });
});
