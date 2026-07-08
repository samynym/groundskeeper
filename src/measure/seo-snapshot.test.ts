import { describe, it, expect } from "vitest";
import { snapshotSeo } from "./seo-snapshot.js";
import type { TargetSet } from "./targets.js";

const targets: TargetSet = {
  brandDomain: "growsteady.me", brandPhrases: [],
  items: [
    { pageUrl: "https://growsteady.me/a", procedureSlug: "a", control: false, questions: [] },
    { pageUrl: "https://growsteady.me/b", procedureSlug: "b", control: false, questions: [] },
  ],
};

describe("snapshotSeo", () => {
  it("maps GSC rows to metrics and zero-fills missing pages", async () => {
    const perf = { snapshot: async () => ({
      "https://growsteady.me/a": { url: "https://growsteady.me/a", clicks: 3, impressions: 400, ctr: 0.0075, position: 12.5 },
    }) };
    const seo = await snapshotSeo(targets, perf);
    expect(seo["https://growsteady.me/a"]).toEqual({ impressions: 400, clicks: 3, ctr: 0.0075, position: 12.5 });
    expect(seo["https://growsteady.me/b"]).toEqual({ impressions: 0, clicks: 0, ctr: 0, position: 0 });
  });
});
