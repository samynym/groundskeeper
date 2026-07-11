# Steady Presence Probe (SP2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `src/presence/` — a probe that determines whether `growsteady.me` is present in AI answer engines' retrieval corpora, classifies each target page into a routing verdict, and tracks dated presence interventions (IndexNow + manual) with the probe as oracle.

**Architecture:** A five-rung query ladder (domain-literal → brand-phrase → site-scoped → verbatim-phrase → natural-question) is run K times per engine through the existing `GeoEngineClient` boundary; a deterministic classifier maps rung outcomes to one of five verdicts per (page, engine); experiments are an append-only JSONL log rendered against snapshots on one timeline. Prerequisite: `GeoAnswer` grows `retrievedUrls`/`engineQueries` (both `string[] | null`, null = "cannot report") so retrieval and citation are separately observable.

**Tech Stack:** TypeScript/Node ESM (NodeNext, `.js` import specifiers), vitest, tsx, zod not needed (hand-rolled validation matches `targets.ts`), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-steady-presence-probe-design.md` — read it before starting.

## Global Constraints

- ESM with NodeNext resolution: every relative import ends in `.js` even from `.ts` files.
- TypeScript strict; `npm run build` (tsc) must pass at the end of every task.
- Tests are hermetic: NO network in any test; every external dependency (engine, page fetch, HTTP post, clock) is injected. `npm test` = `vitest run`.
- The real clock is read ONLY inside `main()` in a CLI file (`now: () => new Date().toISOString()`), matching `src/measure/cli.ts:44`.
- Fail-safe pattern: external calls degrade to recorded-unavailable, never abort a run. Fail-closed pattern: classification never upgrades missing evidence into a verdict (INCONCLUSIVE never becomes ABSENT).
- `null` vs `[]` is semantic on `retrievedUrls`/`engineQueries`: `null` = engine cannot report; `[]` = engine reported an empty set. Never conflate.
- Conventional commits: `feat(presence): ...`, `feat(measure): ...`, `test(presence): ...`.
- Brand-host matching everywhere = host equals `brandDomain` or ends with `"." + brandDomain` (same rule as `isCited` in `src/measure/geo-tracker.ts:8`).

---

### Task 1: Extend `GeoAnswer` with `retrievedUrls` + `engineQueries`

The measurement harness's `GeoAnswer` only records citations — the winners. The probe needs the full retrieval set and the engine's own reformulated queries. Both already exist in the Anthropic response (`web_search_tool_result` / `server_tool_use` blocks) and are currently discarded by `ClaudeSearchEngine`.

**Files:**
- Modify: `src/measure/geo-engine.ts` (interface + FakeEngine unchanged shape)
- Modify: `src/measure/claude-search-engine.ts` (parse the two new block types)
- Modify: `src/measure/geo-tracker.ts:52` (catch-literal gains the fields)
- Modify: `src/measure/geo-engine.test.ts`, `src/measure/geo-tracker.test.ts`, `src/measure/claude-search-engine.test.ts`, `src/measure/cli.test.ts` (every `GeoAnswer` literal gains the fields)
- Test: `src/measure/claude-search-engine.test.ts` (new cases)

**Interfaces:**
- Consumes: nothing new.
- Produces: `GeoAnswer { answerText: string; citedUrls: string[]; retrievedUrls: string[] | null; engineQueries: string[] | null; ok: boolean }` — every later task builds on this exact shape.

- [ ] **Step 1: Write the failing tests** — append to `src/measure/claude-search-engine.test.ts` inside `describe("ClaudeSearchEngine", ...)`:

```ts
  it("captures the full retrieval set and engine queries from tool blocks", async () => {
    const create = async () =>
      msg([
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "acl recovery site:growsteady.me" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [
          { type: "web_search_result", url: "https://hss.edu/acl", title: "t", encrypted_content: "e", page_age: null },
          { type: "web_search_result", url: "https://growsteady.me/acl-recovery-timeline", title: "t", encrypted_content: "e", page_age: null },
          { type: "web_search_result", url: "https://hss.edu/acl", title: "dupe", encrypted_content: "e", page_age: null },
        ] },
        { type: "text", text: "answer", citations: [webCite("https://hss.edu/acl")] },
      ]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toEqual(["https://hss.edu/acl", "https://growsteady.me/acl-recovery-timeline"]);
    expect(a.engineQueries).toEqual(["acl recovery site:growsteady.me"]);
  });

  it("returns retrievedUrls: null (NOT []) when no web_search_tool_result blocks exist", async () => {
    const create = async () => msg([{ type: "text", text: "no search ran", citations: null }]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toBeNull();
    expect(a.engineQueries).toBeNull();
  });

  it("returns retrievedUrls: [] when the search ran but returned nothing", async () => {
    const create = async () =>
      msg([
        { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
        { type: "web_search_tool_result", tool_use_id: "s1", content: [] },
        { type: "text", text: "nothing found", citations: null },
      ]);
    const a = await new ClaudeSearchEngine(create, { model: "m" }).ask("q");
    expect(a.retrievedUrls).toEqual([]);
    expect(a.engineQueries).toEqual(["q"]);
  });
```

Also update the existing error-path assertion at the `toEqual` on the throw test:

```ts
    expect(a).toEqual({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/measure/claude-search-engine.test.ts`
Expected: FAIL — new tests get `undefined` for `retrievedUrls`/`engineQueries`; the error-path `toEqual` fails on missing keys.

- [ ] **Step 3: Update the interface** — replace the `GeoAnswer` interface in `src/measure/geo-engine.ts` (FakeEngine and GeoEngineClient are unchanged):

```ts
export interface GeoAnswer {
  answerText: string;
  /** Absolute URLs. Real engine adapters MUST normalize to absolute (scheme + host);
   *  citation detection is host-based and treats a scheme-less string as not cited. */
  citedUrls: string[];
  /** Full retrieval set (every result the search backend returned, cited or not).
   *  null = this engine cannot report retrieval. NEVER use [] to mean "unknown". */
  retrievedUrls: string[] | null;
  /** Search queries the engine actually issued. null = engine cannot report them. */
  engineQueries: string[] | null;
  ok: boolean;
}
```

- [ ] **Step 4: Update `ClaudeSearchEngine.ask`** — replace the method body in `src/measure/claude-search-engine.ts` (imports, class shell, `anthropicCreate`, `buildEngines` unchanged):

```ts
  async ask(question: string): Promise<GeoAnswer> {
    try {
      const res = await this.create({
        model: this.opts.model,
        max_tokens: this.opts.maxTokens ?? 2048,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: this.opts.maxUses ?? 5 }],
        messages: [{ role: "user", content: question }],
      });
      const textBlocks = (res.content ?? []).filter(
        (b): b is Anthropic.TextBlock => b.type === "text",
      );
      const answerText = textBlocks.map((b) => b.text).join("");
      const urls: string[] = [];
      for (const b of textBlocks) {
        for (const c of b.citations ?? []) {
          if (c.type === "web_search_result_location" && typeof c.url === "string") urls.push(c.url);
        }
      }
      // Retrieval set + issued queries: read defensively via property checks so an
      // SDK type bump can't break parsing. null = the block type never appeared.
      let sawResults = false;
      const retrieved: string[] = [];
      let sawToolUse = false;
      const queries: string[] = [];
      for (const raw of (res.content ?? []) as unknown as Array<Record<string, unknown>>) {
        if (raw.type === "web_search_tool_result") {
          sawResults = true;
          if (Array.isArray(raw.content)) {
            for (const r of raw.content as Array<Record<string, unknown>>) {
              if (r.type === "web_search_result" && typeof r.url === "string") retrieved.push(r.url);
            }
          }
        } else if (raw.type === "server_tool_use") {
          sawToolUse = true;
          const input = raw.input as Record<string, unknown> | undefined;
          if (input && typeof input.query === "string") queries.push(input.query);
        }
      }
      return {
        answerText,
        citedUrls: [...new Set(urls)],
        retrievedUrls: sawResults ? [...new Set(retrieved)] : null,
        engineQueries: sawToolUse ? queries : null,
        ok: true,
      };
    } catch {
      return { answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false };
    }
  }
```

- [ ] **Step 5: Update every remaining `GeoAnswer` literal** (TypeScript will list them; here is the complete inventory):

`src/measure/geo-tracker.ts:52` — the catch literal:

```ts
          catch { raw.push({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false }); }
```

`src/measure/geo-engine.test.ts` — the two queue literals:

```ts
      { answerText: "a", citedUrls: ["https://growsteady.me/x"], retrievedUrls: null, engineQueries: null, ok: true },
      { answerText: "b", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: true },
```

`src/measure/geo-tracker.test.ts` — add a file-local helper right under the existing `cited` helper and route every inline literal through it (update `cited` too):

```ts
const cited = (u: string): GeoAnswer => ({ answerText: "x", citedUrls: [u], retrievedUrls: null, engineQueries: null, ok: true });
const ans = (answerText: string, ok = true): GeoAnswer => ({ answerText, citedUrls: [], retrievedUrls: null, engineQueries: null, ok });
```

Then replace inline literals: `{ answerText: "", citedUrls: ["not a url"], ok: true }` → `{ ...ans(""), citedUrls: ["not a url"] }`; `{ answerText: "see growsteady.me", citedUrls: [], ok: true }` → `ans("see growsteady.me")`; `{ answerText: "the GrowSteady app", ... }` → `ans("the GrowSteady app")`; `{ answerText: "keep a steady pace", ... }` → `ans("keep a steady pace")`; every `{ answerText: "n", citedUrls: [], ok: true }` → `ans("n")`; every `{ answerText: "", citedUrls: [], ok: false }` → `ans("", false)`.

`src/measure/cli.test.ts:23`:

```ts
    const engine = new FakeEngine("e", [{ answerText: "see growsteady.me", citedUrls: ["https://growsteady.me/a"], retrievedUrls: null, engineQueries: null, ok: true }]);
```

- [ ] **Step 6: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all 104 existing tests + 3 new PASS; tsc clean. If tsc reports a `GeoAnswer` literal site this plan missed, fix it the same way (add `retrievedUrls: null, engineQueries: null`).

- [ ] **Step 7: Commit**

```bash
git add src/measure
git commit -m "feat(measure): GeoAnswer records retrieval set and engine queries

null = engine cannot report; [] = reported empty. Claude adapter now
parses web_search_tool_result / server_tool_use blocks it discarded."
```

---

### Task 2: Ladder — `src/presence/ladder.ts`

**Files:**
- Create: `src/presence/ladder.ts`
- Test: `src/presence/ladder.test.ts`

**Interfaces:**
- Consumes: `TargetSet` from `../measure/targets.js`.
- Produces: `RungId`, `Rung { id: RungId; scope: "domain" | "page"; pageUrl: string | null; query: string }`, `buildLadder(targets: TargetSet, phrases: Record<string, string | null>): Rung[]`.

- [ ] **Step 1: Write the failing test** — `src/presence/ladder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildLadder } from "./ladder.js";
import type { TargetSet } from "../measure/targets.js";

const targets: TargetSet = {
  brandDomain: "growsteady.me",
  brandPhrases: ["growsteady.me", "Steady recovery"],
  items: [
    { pageUrl: "https://growsteady.me/acl", procedureSlug: "acl-reconstruction", control: false, questions: ["when can i walk after acl"] },
    { pageUrl: "https://growsteady.me/rcr", procedureSlug: "rotator-cuff-repair", control: true, questions: [] },
  ],
};

describe("buildLadder", () => {
  it("builds domain rungs once and page rungs per item", () => {
    const rungs = buildLadder(targets, { "https://growsteady.me/acl": "A distinctive sentence.", "https://growsteady.me/rcr": null });
    const ids = rungs.map((r) => `${r.id}:${r.pageUrl ?? "-"}`);
    expect(ids).toEqual([
      "R0_DOMAIN_LITERAL:-",
      "R1_BRAND_PHRASE:-",
      "R2_SITE_SCOPED:https://growsteady.me/acl",
      "R3_VERBATIM:https://growsteady.me/acl",
      "R4_NATURAL:https://growsteady.me/acl",
      "R2_SITE_SCOPED:https://growsteady.me/rcr",
      // rcr: R3 skipped (no phrase), R4 skipped (no questions)
    ]);
  });
  it("R0 queries the literal domain; R1 uses the first phrase differing from the domain", () => {
    const rungs = buildLadder(targets, {});
    expect(rungs[0].query).toBe("growsteady.me");
    expect(rungs[1].query).toBe("Steady recovery"); // "growsteady.me" phrase === domain, skipped
  });
  it("skips R1 when no phrase differs from the domain", () => {
    const t = { ...targets, brandPhrases: ["growsteady.me"] };
    expect(buildLadder(t, {}).some((r) => r.id === "R1_BRAND_PHRASE")).toBe(false);
  });
  it("R2 is site-scoped to the slug; R3 wraps the phrase in the word-for-word template", () => {
    const rungs = buildLadder(targets, { "https://growsteady.me/acl": "The MOON guideline removed the brace." });
    expect(rungs.find((r) => r.id === "R2_SITE_SCOPED")!.query).toBe("site:growsteady.me acl-reconstruction");
    expect(rungs.find((r) => r.id === "R3_VERBATIM")!.query).toBe(
      'Which website says the following, word for word? "The MOON guideline removed the brace."',
    );
  });
  it("R4 uses exactly the first configured question", () => {
    const rungs = buildLadder(targets, {});
    expect(rungs.find((r) => r.id === "R4_NATURAL")!.query).toBe("when can i walk after acl");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/ladder.test.ts`
Expected: FAIL — cannot find module `./ladder.js`.

- [ ] **Step 3: Implement** — `src/presence/ladder.ts`:

```ts
import type { TargetSet } from "../measure/targets.js";

export type RungId = "R0_DOMAIN_LITERAL" | "R1_BRAND_PHRASE" | "R2_SITE_SCOPED" | "R3_VERBATIM" | "R4_NATURAL";

export interface Rung {
  id: RungId;
  scope: "domain" | "page";
  /** null for domain-scoped rungs. */
  pageUrl: string | null;
  query: string;
}

/**
 * phrases: per-page verbatim sentence extracted from the LIVE page HTML
 * (see page-fetcher.ts); null/missing = no extractable sentence, R3 skipped.
 * R2 is corroborating-only (classify.ts never treats it as dispositive).
 */
export function buildLadder(targets: TargetSet, phrases: Record<string, string | null>): Rung[] {
  const rungs: Rung[] = [];
  rungs.push({ id: "R0_DOMAIN_LITERAL", scope: "domain", pageUrl: null, query: targets.brandDomain });
  const namePhrase = targets.brandPhrases.find(
    (p) => p !== "" && p.toLowerCase() !== targets.brandDomain.toLowerCase(),
  );
  if (namePhrase) rungs.push({ id: "R1_BRAND_PHRASE", scope: "domain", pageUrl: null, query: namePhrase });
  for (const item of targets.items) {
    rungs.push({
      id: "R2_SITE_SCOPED", scope: "page", pageUrl: item.pageUrl,
      query: `site:${targets.brandDomain} ${item.procedureSlug}`,
    });
    const phrase = phrases[item.pageUrl] ?? null;
    if (phrase) {
      rungs.push({
        id: "R3_VERBATIM", scope: "page", pageUrl: item.pageUrl,
        query: `Which website says the following, word for word? "${phrase}"`,
      });
    }
    if (item.questions[0]) {
      rungs.push({ id: "R4_NATURAL", scope: "page", pageUrl: item.pageUrl, query: item.questions[0] });
    }
  }
  return rungs;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/ladder.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/ladder.ts src/presence/ladder.test.ts
git commit -m "feat(presence): probe ladder R0-R4 with skip rules for R1/R3/R4"
```

---

### Task 3: Page fetcher + phrase extraction — `src/presence/page-fetcher.ts`

**Files:**
- Create: `src/presence/page-fetcher.ts`
- Test: `src/presence/page-fetcher.test.ts`

**Interfaces:**
- Consumes: nothing from this repo (global `fetch` injected).
- Produces: `FetchedPage { status: number; html: string }`, `PageFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>`, `fetchPage(url, fetchImpl?): Promise<FetchedPage>` (never throws; network error → `{ status: 0, html: "" }`), `extractPhrase(html): string | null` (longest sentence 80–200 chars, no embedded double-quotes).

- [ ] **Step 1: Write the failing test** — `src/presence/page-fetcher.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fetchPage, extractPhrase } from "./page-fetcher.js";

describe("fetchPage", () => {
  it("returns status and html on 200", async () => {
    const f = async () => ({ status: 200, text: async () => "<p>hi</p>" });
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 200, html: "<p>hi</p>" });
  });
  it("returns empty html on non-200 without reading the body", async () => {
    const f = async () => ({ status: 404, text: async () => { throw new Error("should not read"); } });
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 404, html: "" });
  });
  it("degrades a network error to status 0, never throws", async () => {
    const f = async () => { throw new Error("ECONNREFUSED"); };
    expect(await fetchPage("https://x.test/p", f)).toEqual({ status: 0, html: "" });
  });
});

describe("extractPhrase", () => {
  const LONG = "Modern MOON guidelines have you full weight-bearing from day one, with crutches used for balance rather than offloading.";
  it("picks the longest sentence within 80-200 chars from tag-stripped text", () => {
    const html = `<nav>Home</nav><script>var x = "Ignore this scripted sentence that is definitely long enough to qualify.";</script><p>Short one.</p><p>${LONG}</p>`;
    expect(extractPhrase(html)).toBe(LONG);
  });
  it("rejects sentences containing double quotes (they break the R3 query template)", () => {
    const quoted = 'This sentence has a "quoted fragment" inside it and is long enough to pass the eighty character floor easily.';
    expect(extractPhrase(`<p>${quoted}</p><p>${LONG}</p>`)).toBe(LONG);
  });
  it("returns null when no sentence fits the bounds", () => {
    expect(extractPhrase("<p>Too short.</p>")).toBeNull();
    expect(extractPhrase("")).toBeNull();
  });
  it("decodes basic entities so the phrase matches rendered text", () => {
    const html = "<p>Recovery isn&#39;t linear and the first weeks after surgery are usually the hardest part of the whole rehabilitation journey.</p>";
    expect(extractPhrase(html)).toContain("isn't");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/page-fetcher.test.ts`
Expected: FAIL — cannot find module `./page-fetcher.js`.

- [ ] **Step 3: Implement** — `src/presence/page-fetcher.ts`:

```ts
export interface FetchedPage { status: number; html: string }

/** Narrow injectable slice of fetch — enough to get a status and a body. */
export type PageFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

const defaultFetch: PageFetch = (url) => fetch(url);

/** Never throws: a network failure is status 0 (classified PAGE_NOT_LIVE), not an abort. */
export async function fetchPage(url: string, fetchImpl: PageFetch = defaultFetch): Promise<FetchedPage> {
  try {
    const res = await fetchImpl(url);
    if (res.status !== 200) return { status: res.status, html: "" };
    return { status: 200, html: await res.text() };
  } catch {
    return { status: 0, html: "" };
  }
}

const MIN_LEN = 80;
const MAX_LEN = 200;

/**
 * Longest sentence within [80, 200] chars from the tag-stripped page text.
 * Deriving the phrase from LIVE html makes "is it actually published?" true by
 * construction. Sentences with embedded double-quotes are rejected because the
 * R3 query wraps the phrase in double quotes.
 */
export function extractPhrase(html: string): string | null {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let best: string | null = null;
  for (const raw of text.split(/(?<=[.!?])\s+/)) {
    const s = raw.trim();
    if (s.length < MIN_LEN || s.length > MAX_LEN) continue;
    if (s.includes('"')) continue;
    if (!best || s.length > best.length) best = s;
  }
  return best;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/page-fetcher.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/page-fetcher.ts src/presence/page-fetcher.test.ts
git commit -m "feat(presence): live page fetch + deterministic verbatim-phrase extraction"
```

---

### Task 4: Prober — `src/presence/prober.ts`

**Files:**
- Create: `src/presence/prober.ts`
- Test: `src/presence/prober.test.ts`

**Interfaces:**
- Consumes: `Rung` (Task 2), `GeoEngineClient`/`GeoAnswer` + `FakeEngine` (Task 1).
- Produces: `RungRun { engine: string; answer: GeoAnswer }`, `RungResult { rung: Rung; runs: RungRun[] }`, `runProbe(rungs: Rung[], engines: GeoEngineClient[], opts: { runs: number }): Promise<RungResult[]>`.

- [ ] **Step 1: Write the failing test** — `src/presence/prober.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { runProbe } from "./prober.js";
import { FakeEngine, type GeoAnswer } from "../measure/geo-engine.js";
import type { Rung } from "./ladder.js";

const ans = (t: string): GeoAnswer => ({ answerText: t, citedUrls: [], retrievedUrls: [], engineQueries: null, ok: true });
const rung: Rung = { id: "R0_DOMAIN_LITERAL", scope: "domain", pageUrl: null, query: "growsteady.me" };

describe("runProbe", () => {
  it("asks each engine K times per rung and keeps every raw answer", async () => {
    const e = new FakeEngine("e1", [ans("a"), ans("b")]);
    const out = await runProbe([rung], [e], { runs: 2 });
    expect(out).toHaveLength(1);
    expect(out[0].runs.map((r) => r.answer.answerText)).toEqual(["a", "b"]);
    expect(out[0].runs.every((r) => r.engine === "e1")).toBe(true);
  });
  it("records an engine throw as a failed run (ok:false, nulls), never aborts", async () => {
    const e = new FakeEngine("e1", [ans("a")]); // 2nd ask throws "exhausted"
    const out = await runProbe([rung], [e], { runs: 2 });
    expect(out[0].runs[1].answer).toEqual({ answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false });
  });
  it("clamps runs to at least 1", async () => {
    const e = new FakeEngine("e1", [ans("a")]);
    const out = await runProbe([rung], [e], { runs: 0 });
    expect(out[0].runs).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/prober.test.ts`
Expected: FAIL — cannot find module `./prober.js`.

- [ ] **Step 3: Implement** — `src/presence/prober.ts`:

```ts
import type { GeoAnswer, GeoEngineClient } from "../measure/geo-engine.js";
import type { Rung } from "./ladder.js";

export interface RungRun { engine: string; answer: GeoAnswer }
export interface RungResult { rung: Rung; runs: RungRun[] }

/**
 * Ask every rung K times per engine. Presence is an existence claim, so the
 * classifier unions over runs; all raw answers are kept for audit. A throwing
 * engine records a failed run (mirrors snapshotGeo's catch), never aborts.
 */
export async function runProbe(
  rungs: Rung[], engines: GeoEngineClient[], opts: { runs: number },
): Promise<RungResult[]> {
  const k = Math.max(1, opts.runs);
  const out: RungResult[] = [];
  for (const rung of rungs) {
    const runs: RungRun[] = [];
    for (const engine of engines) {
      for (let i = 0; i < k; i++) {
        try {
          runs.push({ engine: engine.name, answer: await engine.ask(rung.query) });
        } catch {
          runs.push({
            engine: engine.name,
            answer: { answerText: "", citedUrls: [], retrievedUrls: null, engineQueries: null, ok: false },
          });
        }
      }
    }
    out.push({ rung, runs });
  }
  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/prober.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/prober.ts src/presence/prober.test.ts
git commit -m "feat(presence): K-run prober over the ladder, fail-safe per run"
```

---

### Task 5: Classifier — `src/presence/classify.ts`

The heart of the sub-project: deterministic verdicts that ROUTE work. Read the spec's verdict table before implementing.

**Files:**
- Create: `src/presence/classify.ts`
- Test: `src/presence/classify.test.ts`

**Interfaces:**
- Consumes: `RungResult` (Task 4), `RungId` (Task 2), `hostOf` from `../measure/geo-tracker.js`, `TargetItem`/`TargetSet` from `../measure/targets.js`.
- Produces: `Verdict = "CITED" | "RETRIEVED_NOT_CITED" | "INDEXED_NOT_MATCHED" | "ABSENT" | "INCONCLUSIVE"`, `PageStatus { pageUrl: string; httpStatus: number; phrase: string | null }`, `EngineVerdict { engine: string; verdict: Verdict; reasons: string[] }`, `PageVerdict { pageUrl: string; procedureSlug: string; control: boolean; perEngine: EngineVerdict[]; best: Verdict }`, `RungEval { measured: boolean; cited: boolean; retrieved: boolean | null }`, `evalRung(answers: GeoAnswer[], brandDomain: string): RungEval`, `classifyPage(item, status, rungResults, engine, brandDomain): EngineVerdict`, `classifyPresence(targets, statuses, rungResults, engineNames): PageVerdict[]`.

- [ ] **Step 1: Write the failing test** — `src/presence/classify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyPage, classifyPresence, evalRung, type PageStatus } from "./classify.js";
import type { RungResult } from "./prober.js";
import type { Rung } from "./ladder.js";
import type { GeoAnswer } from "../measure/geo-engine.js";
import type { TargetItem, TargetSet } from "../measure/targets.js";

const BRAND = "growsteady.me";
const PAGE = "https://growsteady.me/acl";
const item: TargetItem = { pageUrl: PAGE, procedureSlug: "acl", control: false, questions: ["q"] };
const live: PageStatus = { pageUrl: PAGE, httpStatus: 200, phrase: "A phrase." };

const a = (over: Partial<GeoAnswer>): GeoAnswer =>
  ({ answerText: "", citedUrls: [], retrievedUrls: [], engineQueries: null, ok: true, ...over });

const rung = (id: Rung["id"], pageUrl: string | null = null): Rung =>
  ({ id, scope: pageUrl ? "page" : "domain", pageUrl, query: "q" });

const rr = (id: Rung["id"], pageUrl: string | null, answers: GeoAnswer[]): RungResult =>
  ({ rung: rung(id, pageUrl), runs: answers.map((answer) => ({ engine: "e", answer })) });

// Baseline scaffolding: R0 negative, R1 negative, R3 negative, R4 negative — a clean ABSENT.
const allNegative = (): RungResult[] => [
  rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://other.com/x"] })]),
  rr("R1_BRAND_PHRASE", null, [a({})]),
  rr("R3_VERBATIM", PAGE, [a({})]),
  rr("R4_NATURAL", PAGE, [a({ retrievedUrls: ["https://hss.edu/acl"] })]),
];

describe("evalRung", () => {
  it("unions over K runs; cited and retrieved are independent", () => {
    const e = evalRung([a({}), a({ citedUrls: ["https://growsteady.me/acl"] })], BRAND);
    expect(e).toEqual({ measured: true, cited: true, retrieved: false });
  });
  it("retrieved is null when NO ok run reports a retrieval set", () => {
    expect(evalRung([a({ retrievedUrls: null })], BRAND).retrieved).toBeNull();
  });
  it("subdomains count, lookalike domains do not", () => {
    expect(evalRung([a({ retrievedUrls: ["https://www.growsteady.me/x"] })], BRAND).retrieved).toBe(true);
    expect(evalRung([a({ retrievedUrls: ["https://notgrowsteady.me/x"] })], BRAND).retrieved).toBe(false);
  });
  it("all-failed runs = unmeasured", () => {
    expect(evalRung([a({ ok: false })], BRAND)).toEqual({ measured: false, cited: false, retrieved: null });
  });
});

describe("classifyPage — verdict table", () => {
  it("CITED: brand cited at R4", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ citedUrls: ["https://growsteady.me/acl"], retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("CITED"); // null retrieval cannot block a citation
  });
  it("RETRIEVED_NOT_CITED: brand retrieved at R4, not cited", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("RETRIEVED_NOT_CITED");
  });
  it("INDEXED_NOT_MATCHED: brand at a domain rung, trustworthy-negative R4", () => {
    const rs = allNegative();
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://growsteady.me/"] })]);
    const v = classifyPage(item, live, rs, "e", BRAND);
    expect(v.verdict).toBe("INDEXED_NOT_MATCHED");
    expect(v.reasons[0]).toContain("R0_DOMAIN_LITERAL");
  });
  it("INDEXED_NOT_MATCHED: brand at R3 only", () => {
    const rs = allNegative();
    rs[2] = rr("R3_VERBATIM", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INDEXED_NOT_MATCHED");
  });
  it("ABSENT: every needed rung a trustworthy negative", () => {
    expect(classifyPage(item, live, allNegative(), "e", BRAND).verdict).toBe("ABSENT");
  });
  it("ABSENT allowed with R3 skipped when domain rungs are negative (domain absence subsumes page absence)", () => {
    const rs = allNegative().filter((r) => r.rung.id !== "R3_VERBATIM");
    expect(classifyPage(item, { ...live, phrase: null }, rs, "e", BRAND).verdict).toBe("ABSENT");
  });
});

describe("classifyPage — INCONCLUSIVE never collapses into ABSENT", () => {
  it("page not live", () => {
    const v = classifyPage(item, { pageUrl: PAGE, httpStatus: 0, phrase: null }, allNegative(), "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.reasons[0]).toContain("PAGE_NOT_LIVE");
  });
  it("no natural question configured", () => {
    const noQ: TargetItem = { ...item, questions: [] };
    const rs = allNegative().filter((r) => r.rung.id !== "R4_NATURAL");
    expect(classifyPage(noQ, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("REGRESSION: a failed rung never yields ABSENT", () => {
    const rs = allNegative();
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ ok: false, retrievedUrls: null })]);
    const v = classifyPage(item, live, rs, "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.verdict).not.toBe("ABSENT");
  });
  it("REGRESSION: retrievedUrls null on a needed rung never yields ABSENT", () => {
    const rs = allNegative();
    rs[1] = rr("R1_BRAND_PHRASE", null, [a({ retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("R4 retrieval unreportable (and uncited) is INCONCLUSIVE, not a negative", () => {
    const rs = allNegative();
    rs[3] = rr("R4_NATURAL", PAGE, [a({ retrievedUrls: null })]);
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("INCONCLUSIVE");
  });
  it("domain rungs positive + R3 skipped + R4 negative = page-level unanswered", () => {
    const rs = allNegative().filter((r) => r.rung.id !== "R3_VERBATIM");
    rs[0] = rr("R0_DOMAIN_LITERAL", null, [a({ retrievedUrls: ["https://growsteady.me/"] })]);
    const v = classifyPage(item, { ...live, phrase: null }, rs, "e", BRAND);
    expect(v.verdict).toBe("INCONCLUSIVE");
    expect(v.verdict).not.toBe("INDEXED_NOT_MATCHED");
  });
  it("R2 is never dispositive: a positive R2 alone changes nothing", () => {
    const rs = [...allNegative(), rr("R2_SITE_SCOPED", PAGE, [a({ retrievedUrls: ["https://growsteady.me/acl"] })])];
    expect(classifyPage(item, live, rs, "e", BRAND).verdict).toBe("ABSENT");
  });
});

describe("classifyPresence — aggregation", () => {
  const targets: TargetSet = { brandDomain: BRAND, brandPhrases: ["Steady recovery"], items: [item] };
  it("best = highest-ranked evidential verdict; INCONCLUSIVE engines don't drag it down", () => {
    const rs: RungResult[] = [
      { rung: rung("R0_DOMAIN_LITERAL"), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R1_BRAND_PHRASE"), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R3_VERBATIM", PAGE), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
      { rung: rung("R4_NATURAL", PAGE), runs: [
        { engine: "e1", answer: a({}) }, { engine: "e2", answer: a({ ok: false, retrievedUrls: null }) } ] },
    ];
    const out = classifyPresence(targets, [live], rs, ["e1", "e2"]);
    expect(out[0].perEngine.map((p) => p.verdict)).toEqual(["ABSENT", "INCONCLUSIVE"]);
    expect(out[0].best).toBe("ABSENT");
  });
  it("all engines INCONCLUSIVE (e.g. no API key -> zero engines) = INCONCLUSIVE", () => {
    const out = classifyPresence(targets, [live], [], []);
    expect(out[0].best).toBe("INCONCLUSIVE");
    expect(out[0].perEngine).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/classify.test.ts`
Expected: FAIL — cannot find module `./classify.js`.

- [ ] **Step 3: Implement** — `src/presence/classify.ts`:

```ts
import { hostOf } from "../measure/geo-tracker.js";
import type { GeoAnswer } from "../measure/geo-engine.js";
import type { TargetItem, TargetSet } from "../measure/targets.js";
import type { RungId } from "./ladder.js";
import type { RungResult } from "./prober.js";

export type Verdict = "CITED" | "RETRIEVED_NOT_CITED" | "INDEXED_NOT_MATCHED" | "ABSENT" | "INCONCLUSIVE";

export interface PageStatus { pageUrl: string; httpStatus: number; phrase: string | null }
export interface EngineVerdict { engine: string; verdict: Verdict; reasons: string[] }
export interface PageVerdict {
  pageUrl: string;
  procedureSlug: string;
  control: boolean;
  perEngine: EngineVerdict[];
  /** Highest-ranked evidential verdict across engines; INCONCLUSIVE only if no engine produced evidence. */
  best: Verdict;
}

function isBrandHost(url: string, brandDomain: string): boolean {
  const h = hostOf(url);
  const d = brandDomain.toLowerCase();
  return h === d || (h ? h.endsWith("." + d) : false);
}

/** One rung, one engine, unioned over its K runs. */
export interface RungEval {
  measured: boolean;          // >=1 ok run
  cited: boolean;             // brand in citedUrls of any ok run
  /** true/false when >=1 ok run reported a retrieval set; null when none did (unreportable). */
  retrieved: boolean | null;
}

export function evalRung(answers: GeoAnswer[], brandDomain: string): RungEval {
  const ok = answers.filter((x) => x.ok);
  if (ok.length === 0) return { measured: false, cited: false, retrieved: null };
  const cited = ok.some((x) => x.citedUrls.some((u) => isBrandHost(u, brandDomain)));
  const reporting = ok.filter((x) => x.retrievedUrls !== null);
  const retrieved = reporting.length === 0
    ? null
    : reporting.some((x) => (x.retrievedUrls as string[]).some((u) => isBrandHost(u, brandDomain)));
  return { measured: true, cited, retrieved };
}

const positive = (e: RungEval | undefined): boolean => !!e && (e.cited || e.retrieved === true);

/**
 * The verdict router. Fail-closed everywhere: a failed call, a null retrieval
 * set, and true invisibility are three different facts — INCONCLUSIVE must
 * never collapse into ABSENT (the SeoMetrics zero-fill lesson).
 * R2_SITE_SCOPED is deliberately never consulted: corroborating only.
 */
export function classifyPage(
  item: TargetItem,
  status: PageStatus,
  rungResults: RungResult[],
  engine: string,
  brandDomain: string,
): EngineVerdict {
  if (status.httpStatus !== 200) {
    return { engine, verdict: "INCONCLUSIVE", reasons: [`PAGE_NOT_LIVE: http ${status.httpStatus}`] };
  }

  const evalFor = (id: RungId): RungEval | undefined => {
    const rr = rungResults.find(
      (r) => r.rung.id === id && (r.rung.scope === "domain" || r.rung.pageUrl === item.pageUrl),
    );
    if (!rr) return undefined;
    return evalRung(rr.runs.filter((x) => x.engine === engine).map((x) => x.answer), brandDomain);
  };

  const r4 = evalFor("R4_NATURAL");
  if (!r4) return { engine, verdict: "INCONCLUSIVE", reasons: ["no natural question configured (R4 missing)"] };
  if (r4.cited) return { engine, verdict: "CITED", reasons: ["brand cited at R4_NATURAL"] };
  if (r4.retrieved === true) {
    return { engine, verdict: "RETRIEVED_NOT_CITED", reasons: ["brand retrieved but not cited at R4_NATURAL"] };
  }
  if (!r4.measured) return { engine, verdict: "INCONCLUSIVE", reasons: ["R4_NATURAL failed all runs"] };
  if (r4.retrieved === null) {
    return { engine, verdict: "INCONCLUSIVE", reasons: ["R4_NATURAL retrieval unreportable (retrievedUrls null)"] };
  }

  // R4 is a trustworthy negative from here on.
  const r0 = evalFor("R0_DOMAIN_LITERAL");
  const r1 = evalFor("R1_BRAND_PHRASE"); // undefined when no distinct brand phrase configured
  const r3 = evalFor("R3_VERBATIM");     // undefined when R3 was skipped (no extractable phrase)

  if (positive(r0) || positive(r1) || positive(r3)) {
    if (!positive(r3) && r3 === undefined) {
      return {
        engine, verdict: "INCONCLUSIVE",
        reasons: ["domain rungs positive but R3 skipped (no extractable phrase): page-level membership unanswered"],
      };
    }
    const at: string[] = [];
    if (positive(r0)) at.push("R0_DOMAIN_LITERAL");
    if (positive(r1)) at.push("R1_BRAND_PHRASE");
    if (positive(r3)) at.push("R3_VERBATIM");
    return { engine, verdict: "INDEXED_NOT_MATCHED", reasons: [`brand present at ${at.join(", ")}; absent at R4_NATURAL`] };
  }

  // No positives anywhere: ABSENT only if every needed rung is a trustworthy negative.
  // Needed = R0 always; R1/R3 only if they were built (a skipped rung is not "needed" —
  // R3-skipped is fine here precisely because the domain rungs are negative).
  const reasons: string[] = [];
  const needed: Array<[string, RungEval | undefined]> = [["R0_DOMAIN_LITERAL", r0]];
  if (r1 !== undefined) needed.push(["R1_BRAND_PHRASE", r1]);
  if (r3 !== undefined) needed.push(["R3_VERBATIM", r3]);
  for (const [id, e] of needed) {
    if (!e) reasons.push(`${id} not run`);
    else if (!e.measured) reasons.push(`${id} failed all runs`);
    else if (e.retrieved === null) reasons.push(`${id} retrieval unreportable`);
  }
  if (reasons.length > 0) return { engine, verdict: "INCONCLUSIVE", reasons };
  return { engine, verdict: "ABSENT", reasons: ["brand at no rung"] };
}

const RANK: Record<Verdict, number> = {
  CITED: 4, RETRIEVED_NOT_CITED: 3, INDEXED_NOT_MATCHED: 2, ABSENT: 1, INCONCLUSIVE: 0,
};

export function classifyPresence(
  targets: TargetSet,
  statuses: PageStatus[],
  rungResults: RungResult[],
  engineNames: string[],
): PageVerdict[] {
  return targets.items.map((item) => {
    const status =
      statuses.find((s) => s.pageUrl === item.pageUrl) ?? { pageUrl: item.pageUrl, httpStatus: 0, phrase: null };
    const perEngine = engineNames.map((e) => classifyPage(item, status, rungResults, e, targets.brandDomain));
    const evidential = perEngine.filter((v) => v.verdict !== "INCONCLUSIVE");
    const best: Verdict = evidential.length === 0
      ? "INCONCLUSIVE"
      : evidential.reduce((x, y) => (RANK[y.verdict] > RANK[x.verdict] ? y : x)).verdict;
    return { pageUrl: item.pageUrl, procedureSlug: item.procedureSlug, control: item.control, perEngine, best };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/classify.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/classify.ts src/presence/classify.test.ts
git commit -m "feat(presence): verdict router with fail-closed INCONCLUSIVE invariants"
```

---

### Task 6: Experiment log — `src/presence/experiments.ts`

**Files:**
- Create: `src/presence/experiments.ts`
- Test: `src/presence/experiments.test.ts`

**Interfaces:**
- Consumes: `TargetSet` from `../measure/targets.js`.
- Produces: `ExperimentScope = "url" | "domain"`, `PresenceExperiment { id; at; kind: "automated" | "manual"; name; scope; urls: string[]; outcome: "applied" | "failed" | "recorded"; notes }`, `ExperimentRunner { name; scope; run(urls): Promise<{ outcome: "applied" | "failed"; notes: string }> }`, `experimentId(at, name): string`, `appendExperiment(dir, exp): void`, `readExperiments(dir): PresenceExperiment[]`, `assertNoControlUrls(urls, targets): void`.

- [ ] **Step 1: Write the failing test** — `src/presence/experiments.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/experiments.test.ts`
Expected: FAIL — cannot find module `./experiments.js`.

- [ ] **Step 3: Implement** — `src/presence/experiments.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TargetSet } from "../measure/targets.js";

export type ExperimentScope = "url" | "domain";

/** One dated presence intervention. Automated and manual share this record —
 *  the interventions most likely to work (real links) are the manual ones. */
export interface PresenceExperiment {
  id: string;                          // `${at}-${slug(name)}`, derived — no random IDs
  at: string;                          // ISO, injected clock
  kind: "automated" | "manual";
  name: string;
  scope: ExperimentScope;
  urls: string[];                      // [] when scope === "domain"
  outcome: "applied" | "failed" | "recorded";
  notes: string;
}

export interface ExperimentRunner {
  name: string;
  scope: ExperimentScope;
  run(urls: string[]): Promise<{ outcome: "applied" | "failed"; notes: string }>;
}

export function experimentId(at: string, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${at}-${slug}`;
}

const FILE = "experiments.jsonl";

/** Append-only: history cannot be quietly rewritten. */
export function appendExperiment(dir: string, exp: PresenceExperiment): void {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, FILE), JSON.stringify(exp) + "\n");
}

export function readExperiments(dir: string): PresenceExperiment[] {
  const p = join(dir, FILE);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as PresenceExperiment);
}

function normUrl(u: string): string {
  try {
    const x = new URL(u);
    return (x.origin + x.pathname).replace(/\/$/, "").toLowerCase();
  } catch {
    return u.trim().replace(/\/$/, "").toLowerCase();
  }
}

/** A url-scoped experiment naming a control page would destroy the study's
 *  only attribution mechanism. Refuse loudly. */
export function assertNoControlUrls(urls: string[], targets: TargetSet): void {
  const controls = new Set(targets.items.filter((i) => i.control).map((i) => normUrl(i.pageUrl)));
  for (const u of urls) {
    if (controls.has(normUrl(u))) throw new Error(`refusing experiment on control page: ${u}`);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/experiments.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/experiments.ts src/presence/experiments.test.ts
git commit -m "feat(presence): append-only experiment log with control-page fence"
```

---

### Task 7: IndexNow runner — `src/presence/indexnow.ts`

**Files:**
- Create: `src/presence/indexnow.ts`
- Test: `src/presence/indexnow.test.ts`

**Interfaces:**
- Consumes: `ExperimentRunner` (Task 6).
- Produces: `PostJson = (url: string, body: unknown) => Promise<{ status: number }>`, `IndexNowOpts { key; host; keyLocation?; endpoint?; post? }`, `class IndexNowSubmit implements ExperimentRunner` (`name = "indexnow-submit"`, `scope = "url"`).

**Caveat from spec (repeat in the PR description when shipping):** the runner is inert until a key file is served at `https://growsteady.me/<key>.txt` — that's a human-approved PR into Steady's `public/`. Whether Anthropic's search backend is downstream of IndexNow's engines is unknown; the probe adjudicates. Verify the endpoint/body against the live IndexNow docs (indexnow.org) when implementing — the shapes below match the documented protocol as of 2026-07.

- [ ] **Step 1: Write the failing test** — `src/presence/indexnow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { IndexNowSubmit } from "./indexnow.js";

const opts = { key: "abc123", host: "growsteady.me" };

describe("IndexNowSubmit", () => {
  it("POSTs host/key/keyLocation/urlList and maps 200 to applied", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const post = async (url: string, body: unknown) => { captured = { url, body }; return { status: 200 }; };
    const r = await new IndexNowSubmit({ ...opts, post }).run(["https://growsteady.me/", "https://growsteady.me/acl"]);
    expect(r.outcome).toBe("applied");
    expect(captured!.url).toBe("https://api.indexnow.org/indexnow");
    expect(captured!.body).toEqual({
      host: "growsteady.me",
      key: "abc123",
      keyLocation: "https://growsteady.me/abc123.txt",
      urlList: ["https://growsteady.me/", "https://growsteady.me/acl"],
    });
  });
  it("202 is also applied; other statuses are failed with the status in notes", async () => {
    expect((await new IndexNowSubmit({ ...opts, post: async () => ({ status: 202 }) }).run(["u"])).outcome).toBe("applied");
    const r = await new IndexNowSubmit({ ...opts, post: async () => ({ status: 403 }) }).run(["u"]);
    expect(r).toEqual({ outcome: "failed", notes: "http 403" });
  });
  it("a thrown post is failed (recorded), never an exception", async () => {
    const r = await new IndexNowSubmit({ ...opts, post: async () => { throw new Error("ENOTFOUND"); } }).run(["u"]);
    expect(r.outcome).toBe("failed");
    expect(r.notes).toContain("ENOTFOUND");
  });
  it("honors explicit keyLocation and endpoint overrides", async () => {
    let captured: { url: string; body: unknown } | null = null;
    const post = async (url: string, body: unknown) => { captured = { url, body }; return { status: 200 }; };
    await new IndexNowSubmit({ ...opts, keyLocation: "https://growsteady.me/k/f.txt", endpoint: "https://bing.example/indexnow", post }).run(["u"]);
    expect(captured!.url).toBe("https://bing.example/indexnow");
    expect((captured!.body as { keyLocation: string }).keyLocation).toBe("https://growsteady.me/k/f.txt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/indexnow.test.ts`
Expected: FAIL — cannot find module `./indexnow.js`.

- [ ] **Step 3: Implement** — `src/presence/indexnow.ts`:

```ts
import type { ExperimentRunner } from "./experiments.js";

export type PostJson = (url: string, body: unknown) => Promise<{ status: number }>;

export interface IndexNowOpts {
  key: string;
  host: string;              // e.g. "growsteady.me"
  keyLocation?: string;      // default https://<host>/<key>.txt
  endpoint?: string;         // default https://api.indexnow.org/indexnow
  post?: PostJson;
}

const defaultPost: PostJson = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  return { status: res.status };
};

/**
 * The one automated presence lever in v1. It is a HYPOTHESIS, not a fix:
 * IndexNow feeds Bing/Yandex/Seznam/Naver/Yep, and whether the answer
 * engine's backend is downstream of any of them is unknown — the probe
 * adjudicates. Inert until <host>/<key>.txt is deployed (PR into Steady).
 */
export class IndexNowSubmit implements ExperimentRunner {
  readonly name = "indexnow-submit";
  readonly scope = "url" as const;
  constructor(private opts: IndexNowOpts) {}

  async run(urls: string[]): Promise<{ outcome: "applied" | "failed"; notes: string }> {
    const endpoint = this.opts.endpoint ?? "https://api.indexnow.org/indexnow";
    const keyLocation = this.opts.keyLocation ?? `https://${this.opts.host}/${this.opts.key}.txt`;
    try {
      const { status } = await (this.opts.post ?? defaultPost)(endpoint, {
        host: this.opts.host,
        key: this.opts.key,
        keyLocation,
        urlList: urls,
      });
      return status === 200 || status === 202
        ? { outcome: "applied", notes: `http ${status}, ${urls.length} urls` }
        : { outcome: "failed", notes: `http ${status}` };
    } catch (e) {
      return { outcome: "failed", notes: `error: ${(e as Error).message}` };
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/indexnow.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/indexnow.ts src/presence/indexnow.test.ts
git commit -m "feat(presence): IndexNow submission runner (injectable post, fail-safe)"
```

---

### Task 8: Presence snapshots — `src/presence/snapshot.ts`

**Files:**
- Create: `src/presence/snapshot.ts`
- Test: `src/presence/snapshot.test.ts`

**Interfaces:**
- Consumes: `PageVerdict`, `Verdict` (Task 5), `RungResult` (Task 4).
- Produces: `PresenceSnapshot { takenAt: string; verdicts: PageVerdict[]; raw: RungResult[] }`, `writePresenceSnapshot(dir, snap): string` (returns path; filename = takenAt with `:`/`.` → `-`, matching `src/measure/snapshot.ts`), `readPresenceSnapshot(path): PresenceSnapshot`, `VerdictTransition { pageUrl; before: Verdict | null; after: Verdict | null; changed: boolean }`, `diffPresence(before, after): VerdictTransition[]`.

- [ ] **Step 1: Write the failing test** — `src/presence/snapshot.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePresenceSnapshot, readPresenceSnapshot, diffPresence, type PresenceSnapshot } from "./snapshot.js";
import type { PageVerdict } from "./classify.js";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gk-psnap-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const pv = (pageUrl: string, best: PageVerdict["best"]): PageVerdict =>
  ({ pageUrl, procedureSlug: "s", control: false, perEngine: [{ engine: "e", verdict: best, reasons: [] }], best });

const snap = (takenAt: string, verdicts: PageVerdict[]): PresenceSnapshot => ({ takenAt, verdicts, raw: [] });

describe("write/read round-trip", () => {
  it("persists under a filesystem-safe timestamp name and reads back identically", () => {
    const s = snap("2026-07-10T10:00:00.000Z", [pv("https://g.me/a", "ABSENT")]);
    const path = writePresenceSnapshot(dir, s);
    expect(path).toBe(join(dir, "2026-07-10T10-00-00-000Z.json"));
    expect(readPresenceSnapshot(path)).toEqual(s);
  });
});

describe("diffPresence", () => {
  it("reports per-page verdict transitions, including pages present on one side only", () => {
    const before = snap("t1", [pv("https://g.me/a", "ABSENT"), pv("https://g.me/gone", "ABSENT")]);
    const after = snap("t2", [pv("https://g.me/a", "CITED"), pv("https://g.me/new", "ABSENT")]);
    const d = diffPresence(before, after);
    expect(d.find((t) => t.pageUrl === "https://g.me/a")).toEqual(
      { pageUrl: "https://g.me/a", before: "ABSENT", after: "CITED", changed: true });
    expect(d.find((t) => t.pageUrl === "https://g.me/gone")).toEqual(
      { pageUrl: "https://g.me/gone", before: "ABSENT", after: null, changed: true });
    expect(d.find((t) => t.pageUrl === "https://g.me/new")).toEqual(
      { pageUrl: "https://g.me/new", before: null, after: "ABSENT", changed: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/snapshot.test.ts`
Expected: FAIL — cannot find module `./snapshot.js`.

- [ ] **Step 3: Implement** — `src/presence/snapshot.ts`:

```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PageVerdict, Verdict } from "./classify.js";
import type { RungResult } from "./prober.js";

/** raw keeps every GeoAnswer for audit — same discipline as GeoSnapshot. */
export interface PresenceSnapshot {
  takenAt: string;
  verdicts: PageVerdict[];
  raw: RungResult[];
}

export function writePresenceSnapshot(dir: string, snap: PresenceSnapshot): string {
  mkdirSync(dir, { recursive: true });
  const safe = snap.takenAt.replace(/[:.]/g, "-");
  const path = join(dir, `${safe}.json`);
  writeFileSync(path, JSON.stringify(snap, null, 2));
  return path;
}

export function readPresenceSnapshot(path: string): PresenceSnapshot {
  return JSON.parse(readFileSync(path, "utf8")) as PresenceSnapshot;
}

export interface VerdictTransition {
  pageUrl: string;
  before: Verdict | null;
  after: Verdict | null;
  changed: boolean;
}

export function diffPresence(before: PresenceSnapshot, after: PresenceSnapshot): VerdictTransition[] {
  const pages = [...new Set([...before.verdicts.map((v) => v.pageUrl), ...after.verdicts.map((v) => v.pageUrl)])];
  return pages.map((pageUrl) => {
    const b = before.verdicts.find((v) => v.pageUrl === pageUrl)?.best ?? null;
    const a = after.verdicts.find((v) => v.pageUrl === pageUrl)?.best ?? null;
    return { pageUrl, before: b, after: a, changed: b !== a };
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/snapshot.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/snapshot.ts src/presence/snapshot.test.ts
git commit -m "feat(presence): snapshot persistence + verdict-transition diff"
```

---

### Task 9: Timeline — `src/presence/timeline.ts`

**Files:**
- Create: `src/presence/timeline.ts`
- Test: `src/presence/timeline.test.ts`

**Interfaces:**
- Consumes: `PresenceSnapshot` (Task 8), `PresenceExperiment` (Task 6).
- Produces: `renderTimeline(snapshots: PresenceSnapshot[], experiments: PresenceExperiment[]): string` — markdown, chronological, with a standing attribution warning on every snapshot after a domain-scoped experiment.

- [ ] **Step 1: Write the failing test** — `src/presence/timeline.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/timeline.test.ts`
Expected: FAIL — cannot find module `./timeline.js`.

- [ ] **Step 3: Implement** — `src/presence/timeline.ts`:

```ts
import type { PresenceExperiment } from "./experiments.js";
import type { PresenceSnapshot } from "./snapshot.js";

type Event =
  | { at: string; kind: "snapshot"; snap: PresenceSnapshot }
  | { at: string; kind: "experiment"; exp: PresenceExperiment };

/**
 * One chronological axis for interventions and verdict changes. After a
 * domain-scoped experiment, every later snapshot carries the attribution
 * warning — the spec's "limitation as rendered artifact, not footnote".
 */
export function renderTimeline(snapshots: PresenceSnapshot[], experiments: PresenceExperiment[]): string {
  const events: Event[] = [
    ...snapshots.map((s) => ({ at: s.takenAt, kind: "snapshot" as const, snap: s })),
    ...experiments.map((e) => ({ at: e.at, kind: "experiment" as const, exp: e })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const lines: string[] = ["# Presence timeline", ""];
  if (events.length === 0) {
    lines.push("(no snapshots or experiments recorded)");
    return lines.join("\n");
  }

  let domainInterventionSeen = false;
  for (const ev of events) {
    if (ev.kind === "experiment") {
      const e = ev.exp;
      lines.push(`- ${e.at} · experiment **${e.name}** (${e.kind}, ${e.scope}) → ${e.outcome}${e.notes ? ` — ${e.notes}` : ""}`);
      if (e.scope === "domain") {
        domainInterventionSeen = true;
        lines.push("  ⚠ domain-scoped intervention: control pages are lifted too — presence effects after this point cannot be attributed against controls");
      }
    } else {
      const s = ev.snap;
      lines.push(`- ${s.takenAt} · snapshot${domainInterventionSeen ? " ⚠ (post-domain-intervention window)" : ""}`);
      for (const v of s.verdicts) {
        const per = v.perEngine.map((p) => `${p.engine}: ${p.verdict}`).join(", ");
        lines.push(`  - ${v.pageUrl}${v.control ? " [control]" : ""} → **${v.best}**${per ? ` (${per})` : ""}`);
      }
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/presence/timeline.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/presence/timeline.ts src/presence/timeline.test.ts
git commit -m "feat(presence): merged timeline with domain-scope attribution warnings"
```

---

### Task 10: CLI + npm script — `src/presence/cli.ts`

**Files:**
- Create: `src/presence/cli.ts`
- Modify: `package.json` (add `"presence": "tsx src/presence/cli.ts"` to scripts)
- Modify: `.env.example` (document `PRESENCE_DIR`, `PRESENCE_RUNS`, `INDEXNOW_KEY`, `INDEXNOW_KEY_LOCATION`)
- Test: `src/presence/cli.test.ts`

**Interfaces:**
- Consumes: everything above, plus `loadTargets` and `buildEngines` from measure.
- Produces: `PresenceCliDeps { now: () => string; targetsPath: string; presenceDir: string; engines: GeoEngineClient[]; runs: number; pageFetch?: PageFetch }`, `probeCommand(d): Promise<{ snap: PresenceSnapshot; path: string }>`, `main(argv): Promise<void>` with subcommands `probe | submit | log <name> <url|domain> [urls...] [--notes "..."] | timeline`.

- [ ] **Step 1: Write the failing test** — `src/presence/cli.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/presence/cli.test.ts`
Expected: FAIL — cannot find module `./cli.js`.

- [ ] **Step 3: Implement** — `src/presence/cli.ts`:

```ts
import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadTargets } from "../measure/targets.js";
import { buildEngines } from "../measure/claude-search-engine.js";
import type { GeoEngineClient } from "../measure/geo-engine.js";
import { buildLadder } from "./ladder.js";
import { classifyPresence, type PageStatus } from "./classify.js";
import { extractPhrase, fetchPage, type PageFetch } from "./page-fetcher.js";
import { runProbe } from "./prober.js";
import { readPresenceSnapshot, writePresenceSnapshot, type PresenceSnapshot } from "./snapshot.js";
import {
  appendExperiment, assertNoControlUrls, experimentId, readExperiments, type ExperimentRunner,
} from "./experiments.js";
import { IndexNowSubmit } from "./indexnow.js";
import { renderTimeline } from "./timeline.js";

export interface PresenceCliDeps {
  now: () => string;
  targetsPath: string;
  presenceDir: string;
  engines: GeoEngineClient[];
  runs: number;
  pageFetch?: PageFetch;
}

export async function probeCommand(d: PresenceCliDeps): Promise<{ snap: PresenceSnapshot; path: string }> {
  const targets = loadTargets(d.targetsPath);
  const statuses: PageStatus[] = [];
  const phrases: Record<string, string | null> = {};
  for (const item of targets.items) {
    const { status, html } = await fetchPage(item.pageUrl, d.pageFetch);
    const phrase = status === 200 ? extractPhrase(html) : null;
    statuses.push({ pageUrl: item.pageUrl, httpStatus: status, phrase });
    phrases[item.pageUrl] = phrase;
  }
  const rungs = buildLadder(targets, phrases);
  const raw = await runProbe(rungs, d.engines, { runs: d.runs });
  const verdicts = classifyPresence(targets, statuses, raw, d.engines.map((e) => e.name));
  const snap: PresenceSnapshot = { takenAt: d.now(), verdicts, raw };
  const path = writePresenceSnapshot(d.presenceDir, snap);
  return { snap, path };
}

export async function main(argv: string[]): Promise<void> {
  const cmd = argv[0];
  const targetsPath = process.env.TARGETS_PATH ?? "config/steady-targets.json";
  const presenceDir = process.env.PRESENCE_DIR ?? "presence";

  if (cmd === "probe") {
    const runsEnv = Number(process.env.PRESENCE_RUNS ?? 2);
    const runs = Number.isFinite(runsEnv) && runsEnv > 0 ? runsEnv : 2; // malformed env must not zero the probe
    const { snap, path } = await probeCommand({
      now: () => new Date().toISOString(),
      targetsPath, presenceDir, engines: buildEngines(process.env), runs,
    });
    for (const v of snap.verdicts) {
      console.log(`${v.best}  ${v.pageUrl}${v.control ? " [control]" : ""}`);
      for (const p of v.perEngine) console.log(`  ${p.engine}: ${p.verdict} — ${p.reasons.join("; ")}`);
    }
    console.log(`presence snapshot written: ${path}`);
    return;
  }

  if (cmd === "submit") {
    const targets = loadTargets(targetsPath);
    const key = process.env.INDEXNOW_KEY ?? "";
    if (!key) { console.error("INDEXNOW_KEY required"); process.exit(1); }
    const urls = [`https://${targets.brandDomain}/`, ...targets.items.filter((i) => !i.control).map((i) => i.pageUrl)];
    assertNoControlUrls(urls, targets); // defense in depth: the filter above should already exclude controls
    const runner: ExperimentRunner = new IndexNowSubmit({
      key, host: targets.brandDomain, keyLocation: process.env.INDEXNOW_KEY_LOCATION || undefined,
    });
    const at = new Date().toISOString();
    const res = await runner.run(urls);
    appendExperiment(presenceDir, {
      id: experimentId(at, runner.name), at, kind: "automated", name: runner.name,
      scope: runner.scope, urls, outcome: res.outcome, notes: res.notes,
    });
    console.log(`${runner.name}: ${res.outcome} — ${res.notes}`);
    return;
  }

  if (cmd === "log") {
    const name = argv[1];
    const scope = argv[2];
    if (!name || (scope !== "url" && scope !== "domain")) {
      console.error('usage: log <name> <url|domain> [urls...] [--notes "..."]');
      process.exit(1);
    }
    const rest = argv.slice(3);
    const notesIdx = rest.indexOf("--notes");
    const urls = notesIdx === -1 ? rest : rest.slice(0, notesIdx);
    const notes = notesIdx === -1 ? "" : rest.slice(notesIdx + 1).join(" ");
    const targets = loadTargets(targetsPath);
    if (scope === "url") assertNoControlUrls(urls, targets);
    const at = new Date().toISOString();
    appendExperiment(presenceDir, {
      id: experimentId(at, name), at, kind: "manual", name, scope, urls, outcome: "recorded", notes,
    });
    console.log(`recorded: ${name} (${scope})`);
    return;
  }

  if (cmd === "timeline") {
    const snaps = !existsSync(presenceDir) ? [] : readdirSync(presenceDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => readPresenceSnapshot(join(presenceDir, e.name)))
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    console.log(renderTimeline(snaps, existsSync(presenceDir) ? readExperiments(presenceDir) : []));
    return;
  }

  console.error('usage: probe | submit | log <name> <url|domain> [urls...] [--notes "..."] | timeline');
  process.exit(1);
}

if (process.argv[1] && /presence\/cli\.(js|ts|mts|cts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
}
```

- [ ] **Step 4: Add the npm script** — in `package.json` scripts, after `"measure"`:

```json
    "presence": "tsx src/presence/cli.ts"
```

And append to `.env.example`:

```
# Presence probe (SP2)
PRESENCE_DIR=presence
PRESENCE_RUNS=2
# IndexNow (inert until https://<brandDomain>/<key>.txt is deployed via a Steady PR)
INDEXNOW_KEY=
INDEXNOW_KEY_LOCATION=
```

- [ ] **Step 5: Run the full suite and build**

Run: `npm test && npm run build`
Expected: all tests PASS (measure + presence), tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/presence/cli.ts src/presence/cli.test.ts package.json .env.example
git commit -m "feat(presence): CLI (probe/submit/log/timeline) + npm script"
```

---

### Task 11: Live acceptance run (manual, requires ANTHROPIC_API_KEY)

The automated probe must reproduce the 2026-07-10 hand-run result. If it disagrees with the hand probe, the automation is wrong — do not rationalize a mismatch.

**Files:**
- Create: `presence/<timestamp>.json` (committed — it is the study record)

- [ ] **Step 1: Run the probe against the live site**

```bash
set -a; . ~/.config/secrets/keys.env; set +a
npm run presence probe
```

Expected output: three verdict lines, all `ABSENT` (with `claude-search: ABSENT — brand at no rung` details), then `presence snapshot written: presence/<timestamp>.json`. Cost: ~22 web-search calls.

Acceptable deviations and what they mean: `INCONCLUSIVE` with `PAGE_NOT_LIVE` = the site or network is down, re-run; `INCONCLUSIVE` with `retrieval unreportable` = the engine response shape changed, fix Task 1's parsing before trusting anything; any verdict better than ABSENT = presence has changed since 2026-07-10 — great news, but verify by reading the raw answers in the snapshot before believing it.

- [ ] **Step 2: Sanity-read the snapshot**

Open `presence/<timestamp>.json`: confirm `raw` contains ~11 rungs × 2 runs with non-empty `retrievedUrls` arrays on ok runs (the engine reports retrieval), and `engineQueries` populated (the R2 rung should show the engine echoing or reformulating the `site:` query).

- [ ] **Step 3: Commit the baseline presence snapshot**

```bash
git add presence/
git commit -m "chore(presence): live acceptance baseline — ABSENT across all targets"
```

---

## Follow-ons (explicitly NOT in this plan)

- IndexNow key-file PR into Steady's `public/` (cross-repo, human-approved) — until then `presence submit` records `failed` (403/422), which is itself an honest experiment record.
- Perplexity / OpenAI-search engine adapters (interface-ready, credential-gated).
- The SP1 SEO-metric fix (`PerformanceSignal` bucket bias) — must land before SP4 reads SEO deltas; tracked in the spec's Out of scope.
- SP3 (improvement engine) unblocks when a target page reaches `INDEXED_NOT_MATCHED` or better.

## Self-Review

- **Spec coverage:** GeoAnswer change (T1), ladder incl. R1/R3/R4 skip rules (T2), live fetch + phrase (T3), K-run prober (T4), verdict router + both named invariants + R2-non-dispositive + skipped-R3 subtlety + best-across-engines (T5), experiment log + control fence (T6), IndexNow + caveats (T7), snapshot naming + diff (T8), timeline + domain-scope warning (T9), CLI 4 subcommands + env + npm script (T10), live acceptance vs hand probe (T11). Old-snapshot backward-compat needs no code: measure's readers never touch the new fields (verified: `geo-tracker.ts` reads only `answerText`/`citedUrls`/`ok`).
- **Placeholder scan:** none — every step carries full code and exact commands.
- **Type consistency:** `RungEval.retrieved: boolean | null` consistent between T5 code and tests; `PresenceExperiment.outcome` union consistent across T6/T7/T10; snapshot filename rule identical to `src/measure/snapshot.ts`; `FakeEngine` queue order in T10's first test matches T2's documented rung order.
