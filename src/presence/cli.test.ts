import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probeCommand } from "./cli.js";
import { readPresenceSnapshot } from "./snapshot.js";
import { FakeEngine, type GeoAnswer } from "../measure/geo-engine.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gk-pcli-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const NEG: GeoAnswer = { answerText: "", citedUrls: [], retrievedUrls: ["https://other.com/x"], engineQueries: null, ok: true };

describe("probeCommand", () => {
  it("fetch -> ladder -> probe -> classify -> persist, with an injected clock", async () => {
    const targetsPath = join(dir, "targets.json");
    writeFileSync(targetsPath, JSON.stringify({
      brandDomain: "growsteady.me",
      brandPhrases: ["Steady recovery"],
      items: [{ pageUrl: "https://growsteady.me/acl", procedureSlug: "acl", control: false,
                questions: ["when can i walk after acl"] }],
    }));
    const LONG = "Modern MOON guidelines have you full weight-bearing from day one, with crutches used for balance rather than offloading.";
    // Rungs built: R0, R1, R2, R3, R4 = 5 rungs x runs=1 -> FakeEngine needs 5 answers.
    const engine = new FakeEngine("claude-search", [NEG, NEG, NEG, NEG, NEG]);
    const { snap, path } = await probeCommand({
      now: () => "2026-07-10T12:00:00.000Z",
      targetsPath,
      presenceDir: join(dir, "presence"),
      engines: [engine],
      runs: 1,
      pageFetch: async () => ({ status: 200, text: async () => `<p>${LONG}</p>` }),
    });
    expect(snap.takenAt).toBe("2026-07-10T12:00:00.000Z");
    expect(snap.verdicts).toHaveLength(1);
    expect(snap.verdicts[0].best).toBe("ABSENT");
    expect(snap.raw.map((r) => r.rung.id)).toEqual(
      ["R0_DOMAIN_LITERAL", "R1_BRAND_PHRASE", "R2_SITE_SCOPED", "R3_VERBATIM", "R4_NATURAL"]);
    expect(readPresenceSnapshot(path)).toEqual(snap);
  });
  it("a dead page yields INCONCLUSIVE (PAGE_NOT_LIVE), and no page rungs beyond R2 are built", async () => {
    const targetsPath = join(dir, "targets.json");
    writeFileSync(targetsPath, JSON.stringify({
      brandDomain: "growsteady.me", brandPhrases: [],
      items: [{ pageUrl: "https://growsteady.me/dead", procedureSlug: "d", control: false, questions: ["q"] }],
    }));
    // R0 + R2 + R4 = 3 rungs (no R1: no distinct phrase; no R3: no phrase extractable from a dead page)
    const engine = new FakeEngine("claude-search", [NEG, NEG, NEG]);
    const { snap } = await probeCommand({
      now: () => "t", targetsPath, presenceDir: join(dir, "p"), engines: [engine], runs: 1,
      pageFetch: async () => ({ status: 404, text: async () => "" }),
    });
    expect(snap.verdicts[0].best).toBe("INCONCLUSIVE");
    expect(snap.verdicts[0].perEngine[0].reasons[0]).toContain("PAGE_NOT_LIVE");
  });
  it("zero engines (no API key) yields INCONCLUSIVE, never ABSENT", async () => {
    const targetsPath = join(dir, "targets.json");
    writeFileSync(targetsPath, JSON.stringify({
      brandDomain: "growsteady.me", brandPhrases: [],
      items: [{ pageUrl: "https://growsteady.me/acl", procedureSlug: "a", control: false, questions: ["q"] }],
    }));
    const { snap } = await probeCommand({
      now: () => "t", targetsPath, presenceDir: join(dir, "p"), engines: [], runs: 1,
      pageFetch: async () => ({ status: 200, text: async () => "<p>x</p>" }),
    });
    expect(snap.verdicts[0].best).toBe("INCONCLUSIVE");
  });
});
