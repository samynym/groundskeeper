# Steady Measurement Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable instrument that snapshots Steady's SEO (GSC) and GEO (AI-answer-engine citation/mention) visibility for a defined target set, persists a timestamped baseline, and diffs two snapshots into a before/after report — the prerequisite for validating (and selling) any SEO/GEO lift.

**Architecture:** A new `src/measure/` module in the Groundskeeper repo. Pure logic (targets, detection, aggregation, snapshot, diff, report) is fully unit-tested with a `FakeEngine` and a fake GSC runner — no network in tests. Real AI-engine HTTP adapters are a deliberate follow-on (built against verified live API docs, not guessed here). SEO reuses the existing `PerformanceSignal`. The CLI is the composition root and the only place that reads the clock or the network.

**Tech Stack:** TypeScript / Node ESM (NodeNext), vitest, run under `tsx`. Follows existing repo conventions (injected clients for testability, fail-safe degradation, `*.test.ts` excluded from tsconfig build).

## Global Constraints

- Language/runtime: TypeScript, ESM, `module: NodeNext`; production runs under `tsx`. Import paths use the `.js` extension.
- No live network in any test. All external clients (GSC runner, AI engines) are injected; tests use fakes.
- Fail-safe: a failing engine or missing GSC data is recorded as unavailable and excluded from aggregation — it never aborts a snapshot. Mirrors `src/performance/gsc.ts` `snapshot()`.
- Determinism: modules never read the clock. `Snapshot.takenAt` is supplied by the caller/CLI (injected-`now` pattern, as in `src/cli.ts`).
- Brand/target values (verbatim): target origin `https://growsteady.me`; `brandDomain` = `growsteady.me`. Mention detection uses the domain plus explicit configured `brandPhrases` — NEVER the bare word "Steady" (common English word → false positives).
- Citation detection is host-based: a cited URL counts only if its host equals `growsteady.me` or ends with `.growsteady.me`.
- One responsibility per file; keep files small.
- Commit after each task.

## File Structure

- `config/steady-targets.json` — versioned target set (pages, questions, control flags, brand phrases). *(Task 1)*
- `src/measure/targets.ts` — `TargetSet`/`TargetItem` types + `loadTargets(path)`. *(Task 1)*
- `src/measure/geo-engine.ts` — `GeoAnswer`, `GeoEngineClient` interface, `FakeEngine`. *(Task 2)*
- `src/measure/geo-tracker.ts` — `isCited`/`isMentioned`/`hostOf` + `snapshotGeo` (K-run aggregation, target vs control). *(Task 3)*
- `src/measure/seo-snapshot.ts` — `SeoMetrics` + `snapshotSeo` (wraps `PerformanceSignal`). *(Task 4)*
- `src/measure/snapshot.ts` — `Snapshot`/`SnapshotDiff` + `writeSnapshot`/`diffSnapshots`. *(Task 5)*
- `src/measure/report.ts` — `renderReport(snap, diff?)`. *(Task 6)*
- `src/measure/cli.ts` — `buildEngines`, `takeBaseline`, `main` (baseline/report/diff). *(Task 7)*
- Each module has a sibling `*.test.ts`.

---

### Task 1: Target set config + loader

**Files:**
- Create: `config/steady-targets.json`
- Create: `src/measure/targets.ts`
- Test: `src/measure/targets.test.ts`

**Interfaces:**
- Produces: `interface TargetItem { pageUrl: string; procedureSlug: string; questions: string[]; control: boolean }`; `interface TargetSet { brandDomain: string; brandPhrases: string[]; items: TargetItem[] }`; `function loadTargets(path: string): TargetSet`.

- [ ] **Step 1: Write the config** `config/steady-targets.json` (real Steady urlSlugs; last item is the control):

```json
{
  "brandDomain": "growsteady.me",
  "brandPhrases": ["growsteady", "growsteady.me", "Steady recovery"],
  "items": [
    { "pageUrl": "https://growsteady.me/acl-recovery-timeline", "procedureSlug": "acl-reconstruction", "control": false,
      "questions": ["how long does acl surgery recovery take", "when can i walk after acl reconstruction", "acl recovery timeline week by week"] },
    { "pageUrl": "https://growsteady.me/knee-replacement-recovery-timeline", "procedureSlug": "total-knee-replacement", "control": false,
      "questions": ["how long to recover from total knee replacement", "knee replacement recovery timeline"] },
    { "pageUrl": "https://growsteady.me/rotator-cuff-surgery-recovery-timeline", "procedureSlug": "rotator-cuff-repair", "control": true,
      "questions": ["how long does rotator cuff surgery recovery take", "rotator cuff repair recovery timeline"] }
  ]
}
```

- [ ] **Step 2: Write the failing test** `src/measure/targets.test.ts`:

```ts
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
});
```

- [ ] **Step 3: Run test to verify it fails** — Run: `npx vitest run src/measure/targets.test.ts` — Expected: FAIL ("Cannot find module ./targets.js").

- [ ] **Step 4: Write** `src/measure/targets.ts`:

```ts
import { readFileSync } from "node:fs";

export interface TargetItem {
  pageUrl: string;
  procedureSlug: string;
  questions: string[];
  control: boolean;
}

export interface TargetSet {
  brandDomain: string;
  brandPhrases: string[];
  items: TargetItem[];
}

export function loadTargets(path: string): TargetSet {
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  if (typeof raw.brandDomain !== "string" || !raw.brandDomain) throw new Error("targets: brandDomain required");
  if (!Array.isArray(raw.items)) throw new Error("targets: items[] required");
  const brandPhrases = Array.isArray(raw.brandPhrases) ? (raw.brandPhrases as unknown[]).map(String) : [];
  const items: TargetItem[] = (raw.items as unknown[]).map((v, i) => {
    const it = v as Record<string, unknown>;
    if (typeof it.pageUrl !== "string" || !it.pageUrl) throw new Error(`targets: items[${i}].pageUrl required`);
    return {
      pageUrl: it.pageUrl,
      procedureSlug: String(it.procedureSlug ?? ""),
      questions: Array.isArray(it.questions) ? (it.questions as unknown[]).map(String) : [],
      control: Boolean(it.control),
    };
  });
  return { brandDomain: raw.brandDomain, brandPhrases, items };
}
```

- [ ] **Step 5: Run test to verify it passes** — Run: `npx vitest run src/measure/targets.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 6: Commit** — `git add config/steady-targets.json src/measure/targets.ts src/measure/targets.test.ts && git commit -m "feat(measure): target set config + loader"`

---

### Task 2: GEO engine interface + FakeEngine

**Files:**
- Create: `src/measure/geo-engine.ts`
- Test: `src/measure/geo-engine.test.ts`

**Interfaces:**
- Produces: `interface GeoAnswer { answerText: string; citedUrls: string[]; ok: boolean }`; `interface GeoEngineClient { name: string; ask(question: string): Promise<GeoAnswer> }`; `class FakeEngine` (scripted, in-order, throws when exhausted).

- [ ] **Step 1: Write the failing test** `src/measure/geo-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/geo-engine.test.ts` — Expected: FAIL ("Cannot find module ./geo-engine.js").

- [ ] **Step 3: Write** `src/measure/geo-engine.ts`:

```ts
export interface GeoAnswer {
  answerText: string;
  citedUrls: string[];
  ok: boolean;
}

export interface GeoEngineClient {
  name: string;
  ask(question: string): Promise<GeoAnswer>;
}

/** Test double: returns scripted answers in order; throws when exhausted. */
export class FakeEngine implements GeoEngineClient {
  private i = 0;
  constructor(public name: string, private queue: GeoAnswer[]) {}
  async ask(_question: string): Promise<GeoAnswer> {
    if (this.i >= this.queue.length) throw new Error(`FakeEngine ${this.name} exhausted`);
    return this.queue[this.i++];
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/geo-engine.test.ts` — Expected: PASS (2 tests).

- [ ] **Step 5: Commit** — `git add src/measure/geo-engine.ts src/measure/geo-engine.test.ts && git commit -m "feat(measure): GEO engine interface + FakeEngine"`

---

### Task 3: GEO detection + aggregation (snapshotGeo)

**Files:**
- Create: `src/measure/geo-tracker.ts`
- Test: `src/measure/geo-tracker.test.ts`

**Interfaces:**
- Consumes: `GeoAnswer`, `GeoEngineClient` (Task 2); `TargetSet` (Task 1).
- Produces: `hostOf(url): string | null`; `isCited(answer, brandDomain): boolean`; `isMentioned(answer, brandDomain, brandPhrases): boolean`; `interface EngineResult { citationRate: number; mentionRate: number; runs: GeoAnswer[] }`; `interface QuestionResult { question: string; control: boolean; perEngine: Record<string, EngineResult>; citationRate: number; mentionRate: number }`; `interface GeoScore { citationRate: number; mentionRate: number }`; `interface GeoSnapshot { results: QuestionResult[]; targetScore: GeoScore; controlScore: GeoScore }`; `snapshotGeo(targets, engines, { runs }): Promise<GeoSnapshot>`.

- [ ] **Step 1: Write the failing test** `src/measure/geo-tracker.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isCited, isMentioned, snapshotGeo } from "./geo-tracker.js";
import { FakeEngine, type GeoAnswer } from "./geo-engine.js";
import type { TargetSet } from "./targets.js";

const cited = (u: string): GeoAnswer => ({ answerText: "x", citedUrls: [u], ok: true });

describe("isCited", () => {
  it("matches host and subdomain, not lookalikes", () => {
    expect(isCited(cited("https://growsteady.me/acl"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://www.growsteady.me/x/"), "growsteady.me")).toBe(true);
    expect(isCited(cited("https://notgrowsteady.me/x"), "growsteady.me")).toBe(false);
    expect(isCited({ answerText: "", citedUrls: ["not a url"], ok: true }, "growsteady.me")).toBe(false);
  });
});

describe("isMentioned", () => {
  it("matches domain or a brand phrase, case-insensitive; not bare 'Steady'", () => {
    expect(isMentioned({ answerText: "see growsteady.me", citedUrls: [], ok: true }, "growsteady.me", [])).toBe(true);
    expect(isMentioned({ answerText: "the GrowSteady app", citedUrls: [], ok: true }, "growsteady.me", ["growsteady"])).toBe(true);
    expect(isMentioned({ answerText: "keep a steady pace", citedUrls: [], ok: true }, "growsteady.me", ["growsteady"])).toBe(false);
  });
});

describe("snapshotGeo", () => {
  const targets: TargetSet = {
    brandDomain: "growsteady.me", brandPhrases: ["growsteady"],
    items: [
      { pageUrl: "u1", procedureSlug: "a", control: false, questions: ["q1"] },
      { pageUrl: "u2", procedureSlug: "b", control: true, questions: ["qc"] },
    ],
  };
  it("averages citation rate over K runs and separates target vs control", async () => {
    // q1: engine cites 2 of 3 runs -> 0.667 ; qc: control cites 0 of 3
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"), cited("https://growsteady.me/1"), { answerText: "n", citedUrls: [], ok: true },
      { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true },
    ]);
    const g = await snapshotGeo(targets, [engine], { runs: 3 });
    expect(g.targetScore.citationRate).toBeCloseTo(2 / 3);
    expect(g.controlScore.citationRate).toBe(0);
  });
  it("excludes failed runs from the denominator", async () => {
    const engine = new FakeEngine("e", [
      cited("https://growsteady.me/1"), { answerText: "", citedUrls: [], ok: false }, // q1: 1 cited of 1 ok run = 1.0
      { answerText: "n", citedUrls: [], ok: true }, { answerText: "n", citedUrls: [], ok: true }, // qc runs
    ]);
    const g = await snapshotGeo(targets, [engine], { runs: 2 });
    expect(g.targetScore.citationRate).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/geo-tracker.test.ts` — Expected: FAIL ("Cannot find module ./geo-tracker.js").

- [ ] **Step 3: Write** `src/measure/geo-tracker.ts`:

```ts
import type { GeoAnswer, GeoEngineClient } from "./geo-engine.js";
import type { TargetSet } from "./targets.js";

export function hostOf(url: string): string | null {
  try { return new URL(url).host.toLowerCase(); } catch { return null; }
}

export function isCited(answer: GeoAnswer, brandDomain: string): boolean {
  const d = brandDomain.toLowerCase();
  return answer.citedUrls.some((u) => {
    const h = hostOf(u);
    return h === d || (h ? h.endsWith("." + d) : false);
  });
}

export function isMentioned(answer: GeoAnswer, brandDomain: string, brandPhrases: string[]): boolean {
  const text = answer.answerText.toLowerCase();
  if (text.includes(brandDomain.toLowerCase())) return true;
  return brandPhrases.some((p) => p !== "" && text.includes(p.toLowerCase()));
}

export interface EngineResult { citationRate: number; mentionRate: number; runs: GeoAnswer[] }
export interface QuestionResult {
  question: string;
  control: boolean;
  perEngine: Record<string, EngineResult>;
  citationRate: number;
  mentionRate: number;
}
export interface GeoScore { citationRate: number; mentionRate: number }
export interface GeoSnapshot { results: QuestionResult[]; targetScore: GeoScore; controlScore: GeoScore }

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

export async function snapshotGeo(
  targets: TargetSet,
  engines: GeoEngineClient[],
  opts: { runs: number },
): Promise<GeoSnapshot> {
  const runs = Math.max(1, opts.runs);
  const results: QuestionResult[] = [];

  for (const item of targets.items) {
    for (const question of item.questions) {
      const perEngine: Record<string, EngineResult> = {};
      for (const engine of engines) {
        const raw: GeoAnswer[] = [];
        for (let k = 0; k < runs; k++) {
          try { raw.push(await engine.ask(question)); }
          catch { raw.push({ answerText: "", citedUrls: [], ok: false }); }
        }
        const ok = raw.filter((a) => a.ok);
        perEngine[engine.name] = {
          citationRate: ok.length ? ok.filter((a) => isCited(a, targets.brandDomain)).length / ok.length : 0,
          mentionRate: ok.length ? ok.filter((a) => isMentioned(a, targets.brandDomain, targets.brandPhrases)).length / ok.length : 0,
          runs: raw,
        };
      }
      const active = Object.values(perEngine).filter((e) => e.runs.some((r) => r.ok));
      results.push({
        question, control: item.control, perEngine,
        citationRate: mean(active.map((e) => e.citationRate)),
        mentionRate: mean(active.map((e) => e.mentionRate)),
      });
    }
  }

  const nonControl = results.filter((r) => !r.control);
  const control = results.filter((r) => r.control);
  return {
    results,
    targetScore: { citationRate: mean(nonControl.map((r) => r.citationRate)), mentionRate: mean(nonControl.map((r) => r.mentionRate)) },
    controlScore: { citationRate: mean(control.map((r) => r.citationRate)), mentionRate: mean(control.map((r) => r.mentionRate)) },
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/geo-tracker.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/measure/geo-tracker.ts src/measure/geo-tracker.test.ts && git commit -m "feat(measure): GEO detection + snapshotGeo aggregation"`

---

### Task 4: SEO snapshot (wraps PerformanceSignal)

**Files:**
- Create: `src/measure/seo-snapshot.ts`
- Test: `src/measure/seo-snapshot.test.ts`

**Interfaces:**
- Consumes: `GscRow` from `../types.js` (`{ url, clicks, impressions, ctr, position }`); `TargetSet` (Task 1); a `{ snapshot(): Promise<Record<string, GscRow>> }` (the existing `PerformanceSignal`).
- Produces: `interface SeoMetrics { impressions: number; clicks: number; ctr: number; position: number }`; `snapshotSeo(targets, perf): Promise<Record<string, SeoMetrics>>`.

- [ ] **Step 1: Write the failing test** `src/measure/seo-snapshot.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/seo-snapshot.test.ts` — Expected: FAIL ("Cannot find module ./seo-snapshot.js").

- [ ] **Step 3: Write** `src/measure/seo-snapshot.ts`:

```ts
import type { GscRow } from "../types.js";
import type { TargetSet } from "./targets.js";

export interface SeoMetrics {
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export async function snapshotSeo(
  targets: TargetSet,
  perf: { snapshot(): Promise<Record<string, GscRow>> },
): Promise<Record<string, SeoMetrics>> {
  const gsc = await perf.snapshot();
  const out: Record<string, SeoMetrics> = {};
  for (const item of targets.items) {
    const row = gsc[item.pageUrl];
    out[item.pageUrl] = row
      ? { impressions: row.impressions, clicks: row.clicks, ctr: row.ctr, position: row.position }
      : { impressions: 0, clicks: 0, ctr: 0, position: 0 };
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/seo-snapshot.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/measure/seo-snapshot.ts src/measure/seo-snapshot.test.ts && git commit -m "feat(measure): SEO snapshot over target pages"`

---

### Task 5: Snapshot type, persistence, and diff

**Files:**
- Create: `src/measure/snapshot.ts`
- Test: `src/measure/snapshot.test.ts`

**Interfaces:**
- Consumes: `SeoMetrics` (Task 4); `GeoSnapshot` (Task 3).
- Produces: `interface Snapshot { takenAt: string; seo: Record<string, SeoMetrics>; geo: GeoSnapshot }`; `interface SeoDelta { pageUrl: string; impressions: number; clicks: number; position: number }`; `interface SnapshotDiff { seo: SeoDelta[]; targetCitationDelta: number; targetMentionDelta: number; controlCitationDelta: number; controlMentionDelta: number }`; `writeSnapshot(dir, snap): string`; `diffSnapshots(before, after): SnapshotDiff`.

- [ ] **Step 1: Write the failing test** `src/measure/snapshot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSnapshot, diffSnapshots, type Snapshot } from "./snapshot.js";
import type { GeoSnapshot } from "./geo-tracker.js";

const geo = (tc: number, cc: number): GeoSnapshot => ({
  results: [],
  targetScore: { citationRate: tc, mentionRate: 0 },
  controlScore: { citationRate: cc, mentionRate: 0 },
});

const snap = (takenAt: string, impr: number, pos: number, tc: number, cc: number): Snapshot => ({
  takenAt,
  seo: { "https://growsteady.me/a": { impressions: impr, clicks: 1, ctr: 0.01, position: pos } },
  geo: geo(tc, cc),
});

describe("snapshot persistence + diff", () => {
  it("writes a timestamped json that round-trips", () => {
    const dir = mkdtempSync(join(tmpdir(), "gk-s-"));
    const s = snap("2026-07-07T10:00:00.000Z", 100, 15, 0.1, 0.1);
    const p = writeSnapshot(dir, s);
    expect(readFileSync(p, "utf8")).toContain("growsteady.me/a");
    expect(JSON.parse(readFileSync(p, "utf8")).takenAt).toBe(s.takenAt);
  });
  it("diffs SEO and GEO deltas, isolating control", () => {
    const before = snap("t0", 100, 15, 0.10, 0.10);
    const after = snap("t1", 180, 11, 0.40, 0.12);
    const d = diffSnapshots(before, after);
    expect(d.seo[0]).toEqual({ pageUrl: "https://growsteady.me/a", impressions: 80, clicks: 0, position: -4 });
    expect(d.targetCitationDelta).toBeCloseTo(0.30);
    expect(d.controlCitationDelta).toBeCloseTo(0.02);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/snapshot.test.ts` — Expected: FAIL ("Cannot find module ./snapshot.js").

- [ ] **Step 3: Write** `src/measure/snapshot.ts`:

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { SeoMetrics } from "./seo-snapshot.js";
import type { GeoSnapshot } from "./geo-tracker.js";

export interface Snapshot {
  takenAt: string;
  seo: Record<string, SeoMetrics>;
  geo: GeoSnapshot;
}

export interface SeoDelta {
  pageUrl: string;
  impressions: number; // after - before
  clicks: number;
  position: number;    // after - before; negative = improved (moved up the results)
}

export interface SnapshotDiff {
  seo: SeoDelta[];
  targetCitationDelta: number;
  targetMentionDelta: number;
  controlCitationDelta: number;
  controlMentionDelta: number;
}

export function writeSnapshot(dir: string, snap: Snapshot): string {
  mkdirSync(dir, { recursive: true });
  const safe = snap.takenAt.replace(/[:.]/g, "-");
  const path = join(dir, `${safe}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return path;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const seo: SeoDelta[] = [];
  for (const pageUrl of Object.keys(after.seo)) {
    const b = before.seo[pageUrl];
    const a = after.seo[pageUrl];
    if (!b || !a) continue;
    seo.push({
      pageUrl,
      impressions: a.impressions - b.impressions,
      clicks: a.clicks - b.clicks,
      position: a.position - b.position,
    });
  }
  return {
    seo,
    targetCitationDelta: after.geo.targetScore.citationRate - before.geo.targetScore.citationRate,
    targetMentionDelta: after.geo.targetScore.mentionRate - before.geo.targetScore.mentionRate,
    controlCitationDelta: after.geo.controlScore.citationRate - before.geo.controlScore.citationRate,
    controlMentionDelta: after.geo.controlScore.mentionRate - before.geo.controlScore.mentionRate,
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/snapshot.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/measure/snapshot.ts src/measure/snapshot.test.ts && git commit -m "feat(measure): snapshot persistence + diff"`

---

### Task 6: Report renderer

**Files:**
- Create: `src/measure/report.ts`
- Test: `src/measure/report.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `SnapshotDiff` (Task 5).
- Produces: `renderReport(snap: Snapshot, diff?: SnapshotDiff): string`.

- [ ] **Step 1: Write the failing test** `src/measure/report.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/report.test.ts` — Expected: FAIL ("Cannot find module ./report.js").

- [ ] **Step 3: Write** `src/measure/report.ts`:

```ts
import type { Snapshot, SnapshotDiff } from "./snapshot.js";

function pct(x: number): string { return `${(x * 100).toFixed(0)}%`; }
function pts(x: number): string { return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} pts`; }

export function renderReport(snap: Snapshot, diff?: SnapshotDiff): string {
  const lines: string[] = [];
  lines.push(`# Steady visibility snapshot — ${snap.takenAt}`, "");
  lines.push("## SEO (per target page)");
  lines.push("| page | impressions | clicks | position |", "|---|---|---|---|");
  for (const [url, m] of Object.entries(snap.seo)) {
    lines.push(`| ${url} | ${m.impressions} | ${m.clicks} | ${m.position.toFixed(1)} |`);
  }
  lines.push("", "## GEO visibility");
  lines.push(`- target citation rate: ${pct(snap.geo.targetScore.citationRate)} (mention ${pct(snap.geo.targetScore.mentionRate)})`);
  lines.push(`- control citation rate: ${pct(snap.geo.controlScore.citationRate)} (mention ${pct(snap.geo.controlScore.mentionRate)})`);
  if (diff) {
    lines.push("", "## Change vs baseline");
    lines.push(`- target citation ${pts(diff.targetCitationDelta)} (control ${pts(diff.controlCitationDelta)})`);
    for (const d of diff.seo) {
      lines.push(`- ${d.pageUrl}: impressions ${d.impressions >= 0 ? "+" : ""}${d.impressions}, position ${d.position.toFixed(1)}`);
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/report.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** — `git add src/measure/report.ts src/measure/report.test.ts && git commit -m "feat(measure): visibility report renderer"`

---

### Task 7: CLI (baseline / report / diff)

**Files:**
- Create: `src/measure/cli.ts`
- Test: `src/measure/cli.test.ts`

**Interfaces:**
- Consumes: `PerformanceSignal` from `../performance/gsc.js`; `loadTargets` (Task 1); `snapshotSeo` (Task 4); `snapshotGeo` (Task 3); `writeSnapshot`/`diffSnapshots`/`Snapshot` (Task 5); `renderReport` (Task 6); `GeoEngineClient` (Task 2).
- Produces: `buildEngines(env): GeoEngineClient[]`; `interface CliDeps { now: () => string; targetsPath: string; snapshotDir: string; perf: { snapshot(): Promise<Record<string, unknown>> }; engines: GeoEngineClient[]; runs: number }`; `takeBaseline(d: CliDeps): Promise<{ snap: Snapshot; path: string }>`; `main(argv: string[]): Promise<void>`.

- [ ] **Step 1: Write the failing test** `src/measure/cli.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { takeBaseline, buildEngines } from "./cli.js";
import { FakeEngine } from "./geo-engine.js";

function tmpTargets(): { path: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "gk-cli-"));
  const path = join(dir, "targets.json");
  writeFileSync(path, JSON.stringify({
    brandDomain: "growsteady.me", brandPhrases: ["growsteady"],
    items: [{ pageUrl: "https://growsteady.me/a", procedureSlug: "a", control: false, questions: ["q1"] }],
  }));
  return { path, dir };
}

describe("measure CLI", () => {
  it("buildEngines returns [] when no engine credentials are present", () => {
    expect(buildEngines({})).toEqual([]);
  });
  it("takeBaseline snapshots SEO+GEO and writes a file", async () => {
    const { path, dir } = tmpTargets();
    const snapDir = join(dir, "snapshots");
    const perf = { snapshot: async () => ({ "https://growsteady.me/a": { url: "https://growsteady.me/a", clicks: 2, impressions: 300, ctr: 0.0066, position: 14 } }) };
    const engine = new FakeEngine("e", [{ answerText: "see growsteady.me", citedUrls: ["https://growsteady.me/a"], ok: true }]);
    const { snap, path: out } = await takeBaseline({ now: () => "2026-07-07T10:00:00.000Z", targetsPath: path, snapshotDir: snapDir, perf, engines: [engine], runs: 1 });
    expect(snap.seo["https://growsteady.me/a"].impressions).toBe(300);
    expect(snap.geo.targetScore.citationRate).toBe(1);
    expect(existsSync(out)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/measure/cli.test.ts` — Expected: FAIL ("Cannot find module ./cli.js").

- [ ] **Step 3: Write** `src/measure/cli.ts`:

```ts
import "dotenv/config";
import { readFileSync } from "node:fs";
import { PerformanceSignal } from "../performance/gsc.js";
import { loadTargets } from "./targets.js";
import { snapshotSeo } from "./seo-snapshot.js";
import { snapshotGeo } from "./geo-tracker.js";
import { writeSnapshot, diffSnapshots, type Snapshot } from "./snapshot.js";
import { renderReport } from "./report.js";
import type { GeoEngineClient } from "./geo-engine.js";
import type { GscRow } from "../types.js";

/**
 * Credential-gated real engines. v1 wires none — real HTTP adapters
 * (Perplexity / OpenAI-search / Claude-search) are the follow-on, built
 * against each API's verified live schema, NOT guessed. GEO logic is fully
 * covered by unit tests via FakeEngine.
 */
export function buildEngines(_env: NodeJS.ProcessEnv): GeoEngineClient[] {
  return [];
}

export interface CliDeps {
  now: () => string;
  targetsPath: string;
  snapshotDir: string;
  perf: { snapshot(): Promise<Record<string, GscRow>> };
  engines: GeoEngineClient[];
  runs: number;
}

export async function takeBaseline(d: CliDeps): Promise<{ snap: Snapshot; path: string }> {
  const targets = loadTargets(d.targetsPath);
  const [seo, geo] = await Promise.all([
    snapshotSeo(targets, d.perf),
    snapshotGeo(targets, d.engines, { runs: d.runs }),
  ]);
  const snap: Snapshot = { takenAt: d.now(), seo, geo };
  const path = writeSnapshot(d.snapshotDir, snap);
  return { snap, path };
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const repo = process.env.TARGET_REPO_PATH ?? ".";
  const origin = process.env.TARGET_ORIGIN ?? "https://growsteady.me";
  const targetsPath = process.env.TARGETS_PATH ?? "config/steady-targets.json";
  const snapshotDir = process.env.SNAPSHOT_DIR ?? "snapshots";

  if (cmd === "baseline") {
    const perf = new PerformanceSignal({ targetRepoPath: repo, targetOrigin: origin, gscSaJson: process.env.GSC_SA_JSON ?? "", gscProperty: process.env.GSC_PROPERTY ?? "" });
    const { path } = await takeBaseline({ now: () => new Date().toISOString(), targetsPath, snapshotDir, perf, engines: buildEngines(process.env), runs: Number(process.env.GEO_RUNS ?? 3) });
    console.log(`baseline written: ${path}`);
    return;
  }
  if (cmd === "report") {
    console.log(renderReport(JSON.parse(readFileSync(argv[1], "utf8")) as Snapshot));
    return;
  }
  if (cmd === "diff") {
    const before = JSON.parse(readFileSync(argv[1], "utf8")) as Snapshot;
    const after = JSON.parse(readFileSync(argv[2], "utf8")) as Snapshot;
    console.log(renderReport(after, diffSnapshots(before, after)));
    return;
  }
  console.error("usage: baseline | report <snap.json> | diff <before.json> <after.json>");
  process.exit(1);
}

if (process.argv[1] && /measure\/cli\.(js|ts|mts|cts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Run test to verify it passes** — Run: `npx vitest run src/measure/cli.test.ts` — Expected: PASS.

- [ ] **Step 5: Run the whole suite + build** — Run: `npx vitest run && npm run build` — Expected: all tests pass, `tsc` clean.

- [ ] **Step 6: Commit** — `git add src/measure/cli.ts src/measure/cli.test.ts && git commit -m "feat(measure): CLI (baseline/report/diff) wiring"`

---

## Follow-on (separate plan, gated on credentials)

Real AI-engine adapters (`PerplexityEngine`, `OpenAiSearchEngine`, `ClaudeSearchEngine`) implementing `GeoEngineClient`, wired into `buildEngines` behind credential checks. **Build each against its API's live docs (verify the request + citation response schema; do not guess).** Until then, `measure baseline` produces real SEO + empty GEO (all logic already tested via `FakeEngine`). Also later: Sub-Project 2 (improvement engine wiring) and Sub-Project 3 (the multi-week validation study).

## Self-Review

- **Spec coverage:** targets+control (T1), SEO snapshot (T4), GEO tracker with K-runs + citation/mention + target/control (T2–T3), snapshot persist+diff (T5), report (T6), CLI baseline/report/diff (T7), fail-safe (engine try/catch in T3; GSC via existing fail-safe), determinism (injected `now` in CLI). Real engine adapters explicitly deferred (matches spec's "credential-gated, added incrementally"). No gaps.
- **Placeholder scan:** none — every step has complete code and exact commands.
- **Type consistency:** `GeoAnswer`/`GeoEngineClient` (T2) used verbatim in T3/T7; `SeoMetrics` (T4) used in T5; `GeoSnapshot`/`GeoScore` (T3) used in T5; `Snapshot`/`SnapshotDiff` (T5) used in T6/T7; `snapshotGeo(targets, engines, {runs})`, `snapshotSeo(targets, perf)`, `takeBaseline(CliDeps)` signatures consistent across tasks.
