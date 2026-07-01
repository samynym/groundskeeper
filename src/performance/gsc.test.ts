import { describe, it, expect, vi } from "vitest";
import { PerformanceSignal } from "./gsc.js";

const PAGE_URL = "https://growsteady.me/hip-arthroscopy-recovery-timeline";

const fakeJson = JSON.stringify({
  generatedAt: "t",
  search: {
    ok: true,
    ctrOpportunities: [
      {
        query: "hip recovery",
        page: PAGE_URL,
        clicks: 1,
        impressions: 300,
        ctr: 0.0033,
        position: 12.1,
      },
    ],
    strikingDistance: [
      {
        query: "hip arthroscopy timeline",
        page: PAGE_URL,
        clicks: 1,
        impressions: 100,
        ctr: 0.01,
        position: 16.0,
      },
    ],
  },
  audit: {},
});

describe("PerformanceSignal", () => {
  it("aggregates ctrOpportunities + strikingDistance rows by page", async () => {
    const runner = vi.fn(async () => ({ stdout: fakeJson, stderr: "" }));
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady",
      targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json",
      gscProperty: "sc-domain:growsteady.me",
      runner,
    });

    const snap = await perf.snapshot();
    const row = snap[PAGE_URL];

    expect(row).toBeDefined();
    // impressions: 300 + 100 = 400
    expect(row.impressions).toBe(400);
    // clicks: 1 + 1 = 2
    expect(row.clicks).toBe(2);
    // ctr: 2 / 400 = 0.005
    expect(row.ctr).toBeCloseTo(2 / 400);
    // position: impression-weighted = (12.1*300 + 16.0*100) / 400 = (3630 + 1600) / 400 = 5230/400 = 13.075
    expect(row.position).toBeCloseTo(13.075);
  });

  it("returns {} when search.ok is false", async () => {
    const failJson = JSON.stringify({
      generatedAt: "t",
      search: { ok: false, reason: "no credentials" },
      audit: {},
    });
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady",
      targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json",
      gscProperty: "sc-domain:growsteady.me",
      runner: async () => ({ stdout: failJson, stderr: "" }),
    });

    const snap = await perf.snapshot();
    expect(snap).toEqual({});
  });

  it("does NOT pass --json flag to seo-loop.mjs", async () => {
    const runner = vi.fn(async () => ({ stdout: fakeJson, stderr: "" }));
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady",
      targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json",
      gscProperty: "sc-domain:growsteady.me",
      runner,
    });

    await perf.snapshot();

    expect(runner).toHaveBeenCalledOnce();
    const [, args] = runner.mock.calls[0];
    expect(args).toEqual(["scripts/seo-loop.mjs"]);
    expect(args).not.toContain("--json");
  });

  it("resolves relative page paths against targetOrigin", async () => {
    const relativeJson = JSON.stringify({
      generatedAt: "t",
      search: {
        ok: true,
        ctrOpportunities: [
          { query: "q", page: "/some-relative-page", clicks: 5, impressions: 100, ctr: 0.05, position: 10 },
        ],
        strikingDistance: [],
      },
      audit: {},
    });
    const perf = new PerformanceSignal({
      targetRepoPath: "/tmp/steady",
      targetOrigin: "https://growsteady.me",
      gscSaJson: "/tmp/sa.json",
      gscProperty: "sc-domain:growsteady.me",
      runner: async () => ({ stdout: relativeJson, stderr: "" }),
    });

    const snap = await perf.snapshot();
    expect(snap["https://growsteady.me/some-relative-page"]).toBeDefined();
  });
});
