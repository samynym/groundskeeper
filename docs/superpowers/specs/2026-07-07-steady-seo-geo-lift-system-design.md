# Steady SEO + GEO Lift System — Design Spec

**Date:** 2026-07-07
**Status:** Approved shape (2026-07-07), detailed design for Sub-Project 1.
**Revised 2026-07-10:** a live retrievability probe (5 escalating queries, 87 retrieved URLs, including an engine-issued `site:growsteady.me`) found `growsteady.me` entirely absent from the answer engine's retrieval corpus, while the site itself is technically indexable (200s, index/follow, SSR prose, healthy sitemap, AI crawlers served). Citation requires retrieval; content shape cannot be tested against an index that has never seen the domain. Sub-Project 2 is therefore now the **presence probe + experiment log** (`docs/superpowers/specs/2026-07-10-steady-presence-probe-design.md`); the improvement engine moves to Sub-Project 3 and the prove/report loop to Sub-Project 4.

## Goal

Measurably raise Steady's visibility in **both** Google Search (SEO) and AI answer engines (GEO: ChatGPT, Perplexity, Google AI Overviews, Claude), using the grounded engine (Groundskeeper) so every change is accurate and cited, never slop. Prove the lift on Steady; the proof, plus the measurement instrument, becomes the sellable asset for the YMYL/health vertical.

## Success criteria (both, sequenced)

- **Near-term, provable:** target Steady pages gain measurable SEO traffic (GSC impressions/clicks/position) over a ~6–8 week window, vs. an untouched control set.
- **Strategic headline:** Steady's **GEO visibility score** (citation/mention rate across AI answer engines for target health questions) rises over the same window.

Both require a measurement instrument that can snapshot a baseline and be re-run to show a before/after. That instrument is the first thing we build, because you cannot validate or sell a lift you cannot measure, and because GEO has no native analytics, so the tracker is genuinely new IP.

## Full-system shape (context)

Four components, built in order *(renumbered 2026-07-10 — see Status note)*:

1. **Measurement harness** — snapshots SEO + GEO visibility for a defined target set. *(This spec. Built; baseline committed 2026-07-09.)*
2. **Presence probe + experiment log** — establishes whether the domain is in each answer engine's retrieval corpus at all, and tracks dated presence interventions (IndexNow, manual links/mentions) with the probe as oracle. Prerequisite discovered by the 2026-07-10 probe: `growsteady.me` is absent from the corpus, so shape-level work is currently unfalsifiable. *(Sub-Project 2, spec `2026-07-10-steady-presence-probe-design.md`.)*
3. **Improvement engine** — grounded content refresh (Groundskeeper, already built) + GEO-specific edits (answer-shaped content, on-page citations, schema, freshness), all human-approved PRs. Coordinates with, does not duplicate, Steady's existing structural SEO loop. Unblocked once the probe reports `INDEXED_NOT_MATCHED` or better. *(Sub-Project 3, later spec.)*
4. **Prove/report loop** — baseline → apply improvements → re-measure → before/after report, target vs control. The report is the validation and the sales case study. Note: domain-level presence interventions lift control pages too, so only page-level content edits can be attributed against controls. *(Sub-Project 4, later spec.)*

Groundskeeper stays the content brain (the actual claims/prose); Steady's existing every-2-days loop keeps structural SEO/GEO (llms.txt, JSON-LD, robots). The measurement harness is new and shared.

---

## Sub-Project 1: Measurement Harness (this spec's implementation scope)

A repeatable instrument that snapshots Steady's SEO and GEO visibility for a defined target set and persists a timestamped baseline that later re-runs diff against.

### Where it lives

New module in the Groundskeeper repo, `src/measure/`. TypeScript/Node ESM, vitest, run under `tsx`, following existing conventions (injectable clients for testability, zod config, fail-safe degradation, no network in tests).

### Components (one file each, one responsibility)

- **`src/measure/targets.ts`** — the target set. A typed config: a list of target items, each `{ pageUrl, procedureSlug, questions: string[], control: boolean }`. `questions` are the health questions that page should win (e.g. "how long does ACL recovery take?"). `control: true` marks pages/questions we deliberately will NOT optimize, so lift can be attributed. Loaded from a committed config file (`config/steady-targets.json`) so it is versioned and reviewable. Exposes `loadTargets(path): TargetSet`.
  - Consumes: nothing.
  - Produces: `TargetSet`, `TargetItem`.

- **`src/measure/seo-snapshot.ts`** — per-page SEO metrics. Thin wrapper over the existing `PerformanceSignal` (GSC via `seo-loop.mjs`). For each target `pageUrl`, resolve `{ impressions, clicks, ctr, position }` (28-day). Missing GSC data → zeros, never throws (reuses the existing fail-safe). Exposes `snapshotSeo(targets, perf): Promise<Record<pageUrl, SeoMetrics>>`.
  - Consumes: `TargetSet`, a `PerformanceSignal`.
  - Produces: `SeoMetrics` per page.

- **`src/measure/geo-engine.ts`** — the engine abstraction (the new, injectable boundary).
  - `interface GeoEngineClient { name: string; ask(question: string): Promise<GeoAnswer>; }`
  - `interface GeoAnswer { answerText: string; citedUrls: string[]; ok: boolean; }` — `citedUrls` is the engine's returned source list (empty for engines that don't emit citations); `ok:false` on failure.
  - Concrete clients (added incrementally, credential-gated): `PerplexityEngine`, `OpenAiSearchEngine`, `ClaudeSearchEngine`. Google AI Overviews has no API → **out of programmatic scope for v1; sampled manually** and recorded via a `ManualEngine` stub that reads a hand-filled JSON. Each client is constructed only if its credential is present; absent → excluded from the snapshot (logged), never fatal.
  - `FakeEngine` (test double) returns scripted `GeoAnswer`s.
  - **Important framing:** GEO citation is only meaningful for *retrieval-augmented* answer engines (they return sources). A bare LLM completion recalls training data and cannot "cite," so we target search-grounded engines. For engines that answer but do not emit `citedUrls`, we fall back to brand-mention detection (weaker signal), see below.
  - Consumes: env credentials.
  - Produces: `GeoAnswer`.

- **`src/measure/geo-tracker.ts`** — detection + aggregation.
  - For each `(question, engine)`, call `ask()` **K times** (default 3; LLM answers are non-deterministic) and record all raw answers.
  - Per answer, compute two booleans: **cited** = any `citedUrl` host matches the target origin (`growsteady.me`); **mentioned** = the target domain (`growsteady.me`) or a configured brand phrase appears in `answerText`. Note: the bare word "Steady" is a common English word, so mention detection uses the domain plus an explicit configured brand phrase (not "Steady" alone) to avoid false positives, and mention is treated as a weaker secondary signal to citation. (Detection is deterministic string/host matching, unit-testable.)
  - Aggregate per question: `citationRate` = cited/K, `mentionRate` = mentioned/K, per engine and averaged across engines. Aggregate across the target (non-control) question set into a single **GEO visibility score** = mean `citationRate` (primary) with `mentionRate` reported alongside. Compute the same for the control set separately.
  - Store the raw answers (for audit) plus the computed rates.
  - Exposes `snapshotGeo(targets, engines, opts): Promise<GeoSnapshot>`.
  - Consumes: `TargetSet`, `GeoEngineClient[]`.
  - Produces: `GeoSnapshot` (per-question rates + aggregate scores + raw answers).

- **`src/measure/snapshot.ts`** — combine + persist + diff.
  - `Snapshot { takenAt: string; seo: Record<pageUrl, SeoMetrics>; geo: GeoSnapshot; }` (`takenAt` is supplied by the caller/CLI via an injected clock, so snapshots stay deterministic in tests, matching the repo's injected-`now` pattern).
  - `writeSnapshot(dir, snap)` persists timestamped JSON under `snapshots/`. `diffSnapshots(before, after)` returns per-page SEO deltas and GEO score deltas (target and control).
  - Consumes: SEO + GEO snapshots.
  - Produces: persisted `Snapshot`, `SnapshotDiff`.

- **`src/measure/report.ts`** — render a `SnapshotDiff` (or a single baseline) as a scannable text/markdown report: per-page SEO table, GEO citation/mention rates, target-vs-control side by side.
  - Consumes: `Snapshot` / `SnapshotDiff`.
  - Produces: a report string.

- **CLI entry** — `src/measure/cli.ts` (run under tsx): `baseline` (take + persist a snapshot), `report <snapshot.json>`, `diff <before.json> <after.json>`. Engine credentials and target origin from env; degrade gracefully when engines/GSC are absent.

### Data flow

`loadTargets` → (`snapshotSeo` ∥ `snapshotGeo`) → `Snapshot` → `writeSnapshot`. Later runs: two snapshots → `diffSnapshots` → `report`.

### Error handling

Every external call is a signal, not a requirement. A failing engine or missing GSC is recorded as unavailable for that snapshot and excluded from aggregation (never aborts the run), mirroring `gsc.snapshot()`'s fail-safe. Raw answers are always persisted so a bad snapshot is auditable rather than silently wrong.

### Testing

- `targets` — config parse, control-flag handling.
- `geo-tracker` — detection logic with `FakeEngine`: citation-by-host-match (including subdomain/trailing-slash edge cases), mention-by-substring, K-run aggregation, target-vs-control separation. No network.
- `snapshot` — write/read round-trip, `diffSnapshots` deltas (SEO up/down, GEO up/down, control isolation).
- `report` — renders expected sections from a fixture diff.
- `seo-snapshot` — wraps `PerformanceSignal` with a fake runner; missing-data → zeros.
- No live network in any test; engine clients are injected.

### Assumptions / risks

- **Engine credentials:** which of Perplexity / OpenAI-search / Claude-search we can query programmatically depends on available API keys. The interface is credential-gated; v1 wires whichever are available and logs the rest as unavailable. Google AI Overviews is manual/sampled in v1.
- **GEO detection fidelity:** host-match citation is high-precision; brand-mention is a weaker fallback. We report both and keep raw answers so the methodology can be tightened.
- **Attribution:** the control set is how we separate our lift from Google/AI-engine noise; it must be chosen to resemble the target set (similar procedures/queries) but be left untouched.
- **Non-determinism:** K-run averaging + persisted raw answers manage LLM answer variance; we report variance, not just the mean.

### Out of scope (this spec)

The presence probe (Sub-Project 2), the improvement engine (Sub-Project 3), the multi-week validation study orchestration (Sub-Project 4), any dashboard/product UI, and any auto-shipping of changes. This spec builds only the instrument that makes validation possible.
