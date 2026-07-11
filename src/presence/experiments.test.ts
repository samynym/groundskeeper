import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendExperiment, assertNoControlUrls, experimentId, readExperiments, type PresenceExperiment,
} from "./experiments.js";
import type { TargetSet } from "../measure/targets.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gk-presence-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const exp = (over: Partial<PresenceExperiment>): PresenceExperiment => ({
  id: "x", at: "2026-07-10T10:00:00.000Z", kind: "manual", name: "n",
  scope: "domain", urls: [], outcome: "recorded", notes: "", ...over,
});

describe("experimentId", () => {
  it("is derived from timestamp + slugged name, no randomness", () => {
    expect(experimentId("2026-07-10T10:00:00.000Z", "Reddit post r/HipImpingement"))
      .toBe("2026-07-10T10:00:00.000Z-reddit-post-r-hipimpingement");
  });
});

describe("append/read round-trip", () => {
  it("appends JSONL and reads back in order; missing file reads []", () => {
    expect(readExperiments(dir)).toEqual([]);
    const e1 = exp({ id: "1" });
    const e2 = exp({ id: "2", kind: "automated", name: "indexnow-submit", scope: "url", urls: ["https://g.me/a"], outcome: "applied" });
    appendExperiment(dir, e1);
    appendExperiment(dir, e2);
    expect(readExperiments(dir)).toEqual([e1, e2]);
  });
});

describe("assertNoControlUrls", () => {
  const targets: TargetSet = {
    brandDomain: "growsteady.me", brandPhrases: [],
    items: [
      { pageUrl: "https://growsteady.me/acl", procedureSlug: "a", control: false, questions: [] },
      { pageUrl: "https://growsteady.me/rcr", procedureSlug: "r", control: true, questions: [] },
    ],
  };
  it("throws on a control page, including trailing-slash and case variants", () => {
    expect(() => assertNoControlUrls(["https://growsteady.me/rcr"], targets)).toThrow(/control/);
    expect(() => assertNoControlUrls(["https://GROWSTEADY.me/rcr/"], targets)).toThrow(/control/);
  });
  it("passes non-control urls", () => {
    expect(() => assertNoControlUrls(["https://growsteady.me/acl", "https://growsteady.me/"], targets)).not.toThrow();
  });
});
