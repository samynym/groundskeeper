# Groundskeeper — Closed-World Content Refresh Agent (Design)

- **Date:** 2026-07-01
- **Status:** Design approved in brainstorm; pending written-spec review
- **Working name:** `groundskeeper` (provisional)
- **First target site:** Steady web (`samynym/steady`, `growsteady.me`)

## Summary

Groundskeeper is an autonomous agent that keeps an existing content site fresh **without ever asserting a fact it can't cite**. On a schedule it pulls search performance, picks the single highest-value underperforming or stale page, drafts grounded edits to the site's content modules, proves every claim traces to a source in a vetted evidence base, verifies the build, and opens a pull request for human approval.

The entire product thesis is one rule:

> **A claim that can't cite a source in the evidence base does not ship.**

Every competitor (Outrank, Frase, Slate, et al.) runs an open-world writer that can hallucinate; the human is the safety net. Groundskeeper inverts this: the agent runs closed-world, and the guard — not the human — is the safety net. The human is only the merge gate.

## Goals

- Prove an agent can maintain a real YMYL site **unattended without producing garbage**.
- Refresh **existing** pages (not generate new ones) driven by underperformance + staleness.
- Ground every edit strictly in a curated, cited evidence base (closed-world).
- Ship review-ready PRs; human approves the merge.
- Dogfood on Steady first; keep clean seams so it can productize later.

## Non-goals (v1)

- New-page generation.
- GEO / AI-citation tracking and optimization.
- A web dashboard, auth, or multi-tenancy.
- CMS adapters (WordPress/Webflow/etc.).
- Auto-merge (human approves every PR in v1).
- Deciding the productization model (vertical vs horizontal) — revisited after dogfood.

## Background (why this seam)

Landscape research (Outrank / Frase / Slate) found:

- **Outrank** — autonomous but fire-and-forget; sprays *new* posts, never maintains; targets non-marketers.
- **Frase** — maintenance + AEO features exist, but **not autonomous** (human-in-loop dashboard) and aimed at marketing teams.
- **Slate** — genuinely autonomous closed-loop, but **enterprise-only** (1,000+ pages, $10–25k/yr).

The open seam: **an autonomous maintenance loop for the non-marketer / small site, below Slate's floor**, made safe by closed-world grounding. Steady is an ideal first target because its evidence base is already structured and cited, and it is a YMYL site where grounding matters most.

## Architecture

Groundskeeper is its **own repository**. It never stores the target site's content. It operates on a **local checkout of the target repo** at a configured path:

1. Reads content + citations from the checkout via a `ContentSource` adapter.
2. Reads performance via the target's existing GSC tooling.
3. Drafts edits, runs them through the grounding guard, and verifies the target's build.
4. Creates a branch in the checkout, commits, pushes, and opens a PR on the target repo via `gh`.

The **Steady adapter** is the first and only `ContentSource` implementation for the MVP. It encodes Steady's `lib/benchmarks/*` layout. A second site later means a second adapter, nothing else.

### Why a separate repo helps

- Forces the `ContentSource` boundary to be real from day one (the productization seam).
- Keeps agent logic, prompts, and the guard versioned independently of any target site.
- The target repo stays clean — it only ever receives PRs.

## Components

Each is independently testable with a single clear responsibility.

| Module | Responsibility | Reuses (Steady) |
|---|---|---|
| `ContentSource` (interface) | Read/write pages as structured objects; abstract the target's file layout | — |
| `ContentSource.Steady` | Steady-specific adapter over `lib/benchmarks/{curves,content,weekly}` + `sources[]` | `lib/benchmarks/*` |
| `PerformanceSignal` | Pull GSC 28d/7d clicks, impressions, CTR, position per URL | `scripts/seo-loop.mjs` |
| `TargetSelector` | Score & rank candidates; pick **one** target per run | — |
| `EvidenceRetriever` | Return all citable facts for a target: per-point `sourceUrl`, `sources[]`, dossier passages | `docs/benchmarks/recovery-data-sources.md` |
| `RefreshDrafter` | LLM proposes concrete edits to the content modules, constrained to retrieved evidence | `extend-procedure-cards` skill patterns |
| `GroundingGuard` | Reject any claim not traceable to a cited source; enforce `basis`/`sourceUrl` discipline | — |
| `BuildVerifier` | Run target's `tsc` + lint + tests; block PR on failure | target repo scripts |
| `PRWriter` | Branch, commit, push, open PR with a claim→source audit table | `gh` |
| `Orchestrator` | Run one cycle end-to-end on a schedule; dry-run mode | — |

## Data flow (one cycle)

1. `PerformanceSignal` → GSC snapshot for `sc-domain:growsteady.me`.
2. `TargetSelector` → ranks all procedure/week pages by **underperformance** (position on page 2–3; high-impression/low-CTR) + **staleness** (`basis:"interpolated"` data, thin `sources[]`, aging dossier entries); picks the top **one**.
3. `EvidenceRetriever` → assembles the citable fact set for that target.
4. `RefreshDrafter` → proposes a concrete diff to the TS modules: prose tightening, FAQ/search-intent fixes, replacing an `interpolated` value with a newly-cited `measured` one, metadata / internal-link improvements for CTR.
5. `GroundingGuard` → validates **every** asserted claim against the evidence set. Unsupported claim → strip it or reject the edit; log the reason.
6. `BuildVerifier` → typecheck + lint + test the edited checkout. Fail → abort, no PR.
7. `PRWriter` → opens a PR whose body enumerates each change with the exact source it traces to.
8. Human reviews the PR. Merge → ships via Vercel SSG.

## The grounding guard (the crux)

This module is why the agent can run unattended. It runs on the agent's **own output**, before any human sees it. Two layers; a claim must pass **both**.

**Layer 1 — Mechanical (deterministic, cheap).** Leverages the fact that Steady's citations are structured objects, not free text:

- Every numeric value in a `curves` edit must carry a `basis` and a resolvable `sourceUrl`.
- Every new prose claim must reference a `sources[]` entry that already exists.
- No `sourceUrl` may be invented — it must already exist in the base or the dossier.
- `measured` values may never be replaced by a worse `interpolated` value.
- The `basis: "measured" | "interpolated"` honesty flag must be preserved/upgraded, never silently downgraded.

**Layer 2 — Adversarial LLM judge (for prose).** A separate pass reads each new sentence and asks "is this supported by the cited passage — yes/no?", **defaulting to reject when uncertain**. Only claims surviving both layers ship.

Design stance: **false negatives (a fabricated claim that slips through) are the only unacceptable failure.** The guard is tuned to over-reject; a rejected-but-true claim just doesn't get made this cycle, which is fine.

## Autonomy model

- v1: **autonomous up to the PR, human approves the merge.** No auto-merge on a YMYL site.
- Later (post-trust): consider auto-merging low-risk change classes only (metadata, internal links) once the guard's reject rate and human accept rate are proven. Explicitly not v1.

## Configuration & secrets

- `TARGET_REPO_PATH` — local checkout of the target site repo.
- `GSC_SA_JSON`, `GSC_PROPERTY` — reused from Steady's `seo-loop.mjs` (service-account, `webmasters.readonly`).
- `gh` auth — for opening PRs on the target repo.
- LLM API key — for the drafter and the judge.
- No secrets committed; all via env / local key store.

## MVP scope & success criteria

**In scope:** the loop above, one target per run, on Steady, producing review-ready PRs.

**Success = all three:**

1. **Zero ungrounded claims.** Across the first batch of PRs, every claim in every diff traces to a real source (manual audit confirms the guard). This is the pass/fail bar — nothing else matters if this fails.
2. **Useful, not noise.** Human would merge ≥50% of PRs with at most light edits.
3. **Unattended.** A full cycle runs end-to-end on a schedule with no hand-holding.

Traffic lift is the eventual proof but too slow to gate the MVP; it is a post-MVP metric.

## Testing strategy

- **Guard unit tests** with a golden set: hand-built edits mixing grounded and subtly fabricated claims. The guard must catch **100%** of fabricated claims (false negatives fail the build).
- **Dry-run mode:** produce the diff + audit table without opening a PR, for fast iteration.
- **One real end-to-end PR** on Steady as the acceptance test.

## Open questions / later branches

- **Productization model:** vendor-curated per-vertical evidence bases (vertical product) vs customers bring their own base (horizontal tool). Revisit after dogfood proves the loop.
- **Second `ContentSource` adapter** (which site/CMS first) — the trigger to extract shared logic.
- **Auto-merge change classes** — which, and what trust threshold.
- **GEO/AI-citation layer** — additive later; the evidence base and guard are reused.

## Decision log (from brainstorm)

- Ambition: **dogfood first, then productize.**
- Core job: **maintain & refresh existing pages** (not new-page generation).
- Trigger: **underperformance + staleness** (works on a young site).
- Grounding: **curated evidence base only** (closed-world).
- MVP shape: **Approach A — git-native, PR-based.**
- Housing: **separate repo** (not in the target repo).
- Batch size: **one target per run.**
