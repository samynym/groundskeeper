# Steady Presence Probe — Design Spec (Sub-Project 2)

**Date:** 2026-07-10
**Status:** Approved design. Displaces the improvement engine as Sub-Project 2 (see "Renumbering" below).

## Goal

Determine — and then change — whether `growsteady.me` is present in AI answer engines' retrieval corpora at all. Presence is the prerequisite the parent spec's pipeline silently assumed: **presence in the retriever's index → passage shape → citation.** The 2026-07-09 baseline and a live probe (below) show Steady fails at step one, so content-shape work (the improvement engine) is currently unfalsifiable and is deferred.

## Evidence (2026-07-10, live probes against Claude web search)

- Baseline `snapshots/2026-07-09T16-33-06-184Z.json`: 14 runs across 7 questions, 33 distinct cited hosts (incl. tiny practice sites like `jeremyburnhammd.com` and a brace retailer's blog) — `growsteady.me` cited **0** times. Citations are deep pages, never homepages; they are NOT the top of Google's rankings.
- Escalating 5-probe ladder, 87 retrieved URLs total: `growsteady.me` **retrieved 0 times** — including when the engine itself issued `site:growsteady.me ...`, and when the literal string `growsteady.me` was the query (which surfaced `growsteady.net`, `.ai`, `.app`, `growingsteady.com` — every near-miss but the real domain).
- Steady's side is clean: target pages 200, `meta robots: index,follow`, correct canonicals, prose server-rendered, sitemap 200 with 153 URLs, GPTBot/ClaudeBot/bingbot/Googlebot all served 200. Not a noindex, not a render trap, not bot blocking.
- Google is NOT the missing index: GSC showed healthy indexing (14/~20 pages, 2026-06-17, per Steady `docs/seo-strategy.md`). That doc's line — "`site:growsteady.me` showed 0 — unreliable proxy; GSC is the truth" — is correct for SEO and backwards for GEO: against the answer engine, that query is a direct measurement of the only index that matters.
- Conclusion: the binding constraint is membership in the answer-engine retrieval corpus — an off-page presence problem, not a content problem. We do not know which index Anthropic's `web_search` reads, so every presence action is an experiment and the probe is the only oracle.

## Where it lives

New module `src/presence/` in the Groundskeeper repo. TypeScript/Node ESM, vitest, run under `tsx`, existing conventions (injectable clients, injected clock, fail-safe degradation, no network in tests). Reuses from `src/measure/`: `GeoEngineClient`, `GeoAnswer`, `FakeEngine`, `loadTargets`/`TargetSet`, `hostOf`.

Deliberate boundary: `src/presence/` does NOT depend on `SteadyContentSource`. It reads the **live site**, not the repo — the index contains what's deployed, not what's on `main`, and a repo-derived probe could report ABSENT for a phrase that simply hasn't shipped. Live-reading also keeps the module domain-agnostic (the sellable-instrument path).

## Change to Sub-Project 1 (prerequisite)

`GeoAnswer` gains two **required** fields; nullability is semantic:

```ts
export interface GeoAnswer {
  answerText: string;
  citedUrls: string[];
  /** Full retrieval set. null = engine cannot report retrieval. NEVER [] to mean "unknown". */
  retrievedUrls: string[] | null;
  /** Search queries the engine actually issued. null = engine cannot report them. */
  engineQueries: string[] | null;
  ok: boolean;
}
```

- `ClaudeSearchEngine` fills them from the `web_search_tool_result` / `server_tool_use` blocks it currently discards; its error path returns `retrievedUrls: null, engineQueries: null`.
- Required-not-optional is deliberate: an adapter must state "cannot report," never silently omit. Cost owned: every existing `GeoAnswer` literal (FakeEngine queues, measure tests) is updated — mechanical, ~10 sites.
- Old snapshot JSONs (e.g. the 2026-07-09 baseline) lack the fields; any reader treats `undefined` as `null` (cannot report), never as "nothing retrieved."
- `engineQueries` earns its place: the live probe's most legible signal was the engine spontaneously issuing `site:growsteady.me` — unreconstructable after the fact.

## Components (one file each, sibling tests)

- **`src/presence/ladder.ts`** — rung types + `buildLadder(targets: TargetSet, phrases: Record<pageUrl, string | null>): Rung[]`. Rungs, ordered by how much help they give the retriever:

  | Rung | Scope | Query (template) | Brand retrieval implies |
  |---|---|---|---|
  | `R0_DOMAIN_LITERAL` | domain | `growsteady.me` | domain in corpus |
  | `R1_BRAND_PHRASE` | domain | first `brandPhrases[]` entry that differs from `brandDomain` (skip R1 if none) | findable by name, not just URL |
  | `R2_SITE_SCOPED` | page | `site:growsteady.me <procedureSlug>` | corroborating only, never dispositive (unknown if backend honours `site:`) |
  | `R3_VERBATIM` | page | `Which website says the following, word for word? "<phrase>"` | THIS page in corpus |
  | `R4_NATURAL` | page | first entry of the target's `questions[]` | page surfaces for the query we care about |

  No unique-fact rung: R3 already establishes page membership, R4 topical match; it added cost and an invitation to invent facts without a distinguishable outcome. R4 deliberately overlaps `snapshotGeo`'s questions — different purpose (any-of-K existence + retrieval set vs. citation rates), tiny cost, accepted.

- **`src/presence/page-fetcher.ts`** — `fetchPage(url): Promise<{ status: number; html: string }>` (injectable fetch) and `extractPhrase(html): string | null`: strip tags, split sentences, longest sentence within 80–200 chars. Deterministic, unit-tested on fixture HTML. Live-derived phrase ⇒ "is it actually published?" is true by construction.

- **`src/presence/prober.ts`** — `runProbe(rungs, engines, opts: { runs: number }): Promise<RungResult[]>`. Each rung asked K times (default 2) per engine; brand-present = brand host (`hostOf`-style: equal or subdomain of `brandDomain`) appears in `retrievedUrls` (or `citedUrls`) in ANY of K runs — presence is an existence claim. All raw `GeoAnswer`s kept.

- **`src/presence/classify.ts`** — `classifyPresence(rungResults, page): PresenceVerdict`, per (page, engine):

  | Verdict | Condition | Routes to |
  |---|---|---|
  | `CITED` | brand in `citedUrls` at R4 | lift study (SP4) |
  | `RETRIEVED_NOT_CITED` | brand in `retrievedUrls` at R4, not cited | improvement engine (SP3): passage/extractability |
  | `INDEXED_NOT_MATCHED` | brand at R0/R1/R3, absent at R4 | improvement engine (SP3): relevance/shape |
  | `ABSENT` | brand at no rung | presence experiments (this SP) |
  | `INCONCLUSIVE` | any needed rung `ok:false`; `retrievedUrls` null; page not 200 (`PAGE_NOT_LIVE`); no phrase extractable and domain rungs positive | fix the instrument / re-run |

  Ranked `CITED > RETRIEVED_NOT_CITED > INDEXED_NOT_MATCHED > ABSENT`; `INCONCLUSIVE` short-circuits. Each verdict carries `reasons: string[]`. Subtlety encoded: if R3 is skipped (no phrase) while domain rungs are positive and R4 negative, the page-level question is unanswered → `INCONCLUSIVE`, not `INDEXED_NOT_MATCHED`; only when domain rungs are themselves negative does a missing R3 still permit `ABSENT` (domain absence subsumes page absence). Per-engine verdicts aggregate to the BEST verdict, per-engine breakdown always preserved (averaging would hide the only actionable detail). **Hard invariant, enforced by test: `INCONCLUSIVE` never collapses into `ABSENT`.** A failed call, a null retrieval set, and true invisibility are three different facts — conflating them is the `SeoMetrics` zero-fill defect that made the SP1 SEO baseline uninterpretable.

- **`src/presence/experiments.ts`** — the experiment log. Automated and manual interventions are the SAME record type; the interventions most likely to work (third-party links/mentions) are the ones no code can perform, and they must not go untracked:

  ```ts
  export type ExperimentScope = "url" | "domain";
  export interface PresenceExperiment {
    id: string;                       // `${at}-${name-slug}`, derived — no random IDs
    at: string;                       // ISO, injected clock
    kind: "automated" | "manual";
    name: string;                     // "indexnow-submit" | "reddit-post-r/HipImpingement"
    scope: ExperimentScope;
    urls: string[];                   // [] when scope === "domain"
    outcome: "applied" | "failed" | "recorded";
    notes: string;
  }
  export interface ExperimentRunner {
    name: string;
    scope: ExperimentScope;
    run(urls: string[]): Promise<{ outcome: "applied" | "failed"; notes: string }>;
  }
  ```

  `appendExperiment(dir, exp)` / `readExperiments(dir)` over append-only `presence/experiments.jsonl`. **Control safety:** `assertNoControlUrls(urls, targets)` throws if a url-scoped experiment names a `control: true` page (submitting the control would destroy the study's only attribution mechanism). Domain-scoped experiments cannot be fenced — domain presence lifts controls too — so the record carries `scope: "domain"` and the timeline annotates every window after one with an explicit attribution warning: the limitation becomes a rendered artifact, not a footnote.

- **`src/presence/indexnow.ts`** — `IndexNowSubmit implements ExperimentRunner` (url scope): POST to the IndexNow endpoint with key + urlList (injectable fetch; built against live IndexNow docs at implementation time, not guessed). v1 ships exactly this one runner. A `SitemapPing` runner was designed and cut: Google removed the ping endpoint (deprecated 2023) — it would be a no-op dressed as an action. Stated plainly:
  - Requires a key file served at `https://growsteady.me/<key>.txt` → a **cross-repo, human-approved PR into Steady's `public/`** before the runner can act.
  - IndexNow's participating engines are Bing/Yandex/Seznam/Naver/Yep; **whether Anthropic's `web_search` backend is downstream of any of them is unknown.** IndexNow is a hypothesis, not a fix; the probe adjudicates it. Sustained `ABSENT` after a successful submission is a real finding, and the remaining lever (third-party links) is GTM work, not engineering.

- **`src/presence/snapshot.ts`** — `PresenceSnapshot { takenAt: string; verdicts: PageVerdict[]; raw: RungResult[] }`; `writePresenceSnapshot(dir, snap)` under `presence/`, filename = `takenAt` with `:` and `.` → `-` (matches `writeSnapshot`); `diffPresence(before, after)` → per-page verdict transitions.

- **`src/presence/timeline.ts`** — `renderTimeline(snapshots, experiments): string`: interventions and verdict changes merged on one chronological axis, per-engine breakdown, domain-scope attribution warnings inline.

- **`src/presence/cli.ts`** — `npm run presence` (tsx), subcommands:
  - `probe` — fetch pages, extract phrases, build ladder, run, classify, persist snapshot, print verdicts.
  - `submit` — run `IndexNowSubmit` over non-control target `pageUrls` + the origin root; append the experiment record (also on failure, `outcome: "failed"`).
  - `log <name> <scope> [urls...] --notes` — record a manual intervention.
  - `timeline` — render the merged report.

  Env: `ANTHROPIC_API_KEY`, `TARGETS_PATH` (default `config/steady-targets.json`), `PRESENCE_DIR` (default `presence`), `PRESENCE_RUNS` (default 2), `INDEXNOW_KEY`, `INDEXNOW_KEY_LOCATION`. Clock injected at CLI level only, per repo pattern.

## Data flow

`loadTargets` → `fetchPage` (live) → `extractPhrase` → `buildLadder` → `runProbe` (K runs × engines) → `classifyPresence` → `PresenceSnapshot` → `writePresenceSnapshot`. Interventions: `submit`/`log` → `experiments.jsonl`. Reporting: snapshots + experiments → `renderTimeline`.

Cost at current targets: 2 domain rungs + 3 per-page rungs × 3 pages = 11 rungs × K=2 = **22 web-search calls per snapshot**.

## Error handling

One rule: **absence of evidence is recorded as absence of evidence.**

- Engine `ok:false` → rung unmeasured → `INCONCLUSIVE` (never `ABSENT`).
- `retrievedUrls === null` → retrieval unmeasurable → `INCONCLUSIVE`.
- Page fetch non-200 → `INCONCLUSIVE` (`PAGE_NOT_LIVE`), page rungs skipped.
- No phrase extractable → R3 skipped (verdict logic above).
- IndexNow HTTP failure → experiment recorded with `outcome: "failed"`; never throws, never unrecorded.

## Testing

Hermetic, no network, everything injected (`FakeEngine` retrieval sets, fake page fetcher, fixed clock).

- `classify` — table-driven over every verdict and every `INCONCLUSIVE` trigger; named regression tests: *a failed rung never yields ABSENT*; *`retrievedUrls: null` never yields ABSENT*.
- `claude-search-engine` — response with no `web_search_tool_result` blocks → `retrievedUrls: null`, not `[]`; retrieval + queries parsed from fixture blocks.
- `page-fetcher` — phrase extraction on fixture HTML (bounds, tag-stripping, no-sentence case).
- `ladder`/`prober` — rung construction incl. skipped-R3; any-of-K presence; per-engine separation.
- `experiments` — JSONL round-trip; control URL throws; failed runner still recorded.
- `snapshot`/`timeline` — round-trip, verdict transitions, domain-scope warning rendered.
- **Acceptance (live, manual):** `presence probe` against the live site must reproduce the 2026-07-10 hand-run result — `ABSENT` on all three target pages. If automation disagrees with the hand probe, the automation is wrong.

## Assumptions / risks

- **Unknown index:** we cannot name the corpus behind Anthropic `web_search`; only one engine is wired, so "presence" is presence-in-one-corpus. Perplexity/OpenAI adapters (credential-gated, interface-ready) widen the claim later.
- **Retriever nondeterminism:** K-run any-of union manages variance for an existence claim; raw answers persisted.
- **`site:` support unknown:** R2 is corroborating only, by design.
- **Attribution:** domain-level interventions lift controls; SP4's before/after can attribute page-level content edits against controls, but NOT domain-level presence — stated in the timeline, must be restated in SP4's report.

## Out of scope

- Content edits of any kind (improvement engine — now SP3).
- Backlink acquisition itself (GTM); the log records it, the probe measures it.
- Perplexity/OpenAI engine adapters; Google index coverage via GSC URL Inspection API.
- Fixing the known SP1 SEO-metric defect, recorded here so it isn't rediscovered: `PerformanceSignal` reads only `strikingDistance` + `ctrOpportunities` buckets, so `SeoMetrics` is non-monotonic (a page climbing to position 5 with healthy CTR exits both buckets and records as zeros, indistinguishable from GSC-not-configured); `seo-loop.mjs` already fetches full per-page rows and discards them. Must be fixed before SP4 reads SEO deltas.

## Renumbering

- **SP1** Measurement harness *(built, 2026-07-09 baseline committed)*
- **SP2** Presence probe + experiment log *(this spec)*
- **SP3** Improvement engine *(was SP2; deferred because the probe showed content-shape work is unfalsifiable while the domain is absent from the retrieval corpus)*
- **SP4** Prove/report loop *(was SP3)*

The parent spec (`2026-07-07-steady-seo-geo-lift-system-design.md`) is updated alongside this document to record the renumbering and its reason.
