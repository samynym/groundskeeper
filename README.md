# groundskeeper

[![ci](https://github.com/samynym/groundskeeper/actions/workflows/ci.yml/badge.svg)](https://github.com/samynym/groundskeeper/actions/workflows/ci.yml)

An autonomous content-refresh agent with a closed-world grounding guard. Each run, it picks one underperforming or stale page of a target site, drafts edits with an LLM, proves every claim traces to a source already in the site's own evidence base, verifies the site still builds, and opens a PR for human review.

The rule the whole system enforces: **a claim that can't cite a source already in the evidence base does not ship.**

## Why closed-world

Every AI content tool is an open-world writer: it can introduce plausible new "facts", and the human reviewer is the only safety net. For a YMYL site that's disqualifying. Groundskeeper is dogfooded on [growsteady.me](https://growsteady.me), which publishes measured recovery-timeline data for medical procedures — a hallucinated "pain-free at 6 weeks" there isn't a typo, it's harm.

So the trust model is inverted:

- the agent operates **closed-world** — it may only restate facts already present in the site's structured evidence base (curve points, cited studies);
- a **two-layer guard** is the safety net, not the human;
- the human is only the **merge gate**, reviewing a claim→source audit table in the PR body instead of hunting for fabrications in a diff.

## One cycle

```
GSC snapshot ──▶ select ONE page ──▶ assemble evidence ──▶ LLM drafts edit ops
                (page-2/3 rank,      (curve points +        (replaceProse /
                 low CTR, thin        sources ──▶ facts      addSource / updateMeta /
                 sources, staleness)  + knownSourceUrls)     promoteToMeasured)
                                                                    │
        PR with claim→source ◀── target build ◀── AST apply ◀── grounding guard
        audit table               (tsc gate)      (ts-morph,      (dry-run stops here)
                                                   oldText drift
                                                   check)
```

Failure anywhere after branching aborts the branch. Nothing ever auto-merges.

## The guard

Two independent layers, both fail-closed.

**Layer 1 — mechanical (`src/guard/mechanical.ts`), deterministic:**

- ops citing a source URL outside the evidence base are rejected;
- prose/meta edits carrying zero claims are rejected — they would otherwise sail past the number gate, which is a fabrication path;
- every numeric token in new prose must literally appear in a fact from a cited source;
- `addSource` must exact-match a canonical source record *including title, tier, and score* — a real URL with a fabricated title ("RCT: pain-free at 6 weeks") doesn't pass;
- `promoteToMeasured` requires a measured fact matching the same source, week, band, and value — the agent cannot launder the site's own interpolated estimates into "measured" claims.

**Layer 2 — adversarial LLM judge (`src/guard/judge.ts`):**

The judge sees the full replacement prose (not enumerated fragments) against a passage built only from the cited sources' facts, each line labeled with provenance ("SITE ESTIMATE, not a measured study value"), so estimate-to-measurement laundering is refusable. A cited source with no facts rejects without calling the LLM at all; judge errors, unparseable output, and schema mismatches all default to reject.

The guard was then hardened by an adversarial model review whose only goal was to find inputs where a fabricated claim could pass — it found 4 false-negative holes, each closed with a pinned test. The log is in [docs/HARDENING.md](docs/HARDENING.md).

## Running it

```bash
npm ci
npm test                    # 82 tests, hermetic (no network, LLM faked), ~1.5s
npm run build

cp .env.example .env        # set TARGET_REPO_PATH, TARGET_ORIGIN,
                            # ANTHROPIC_API_KEY (or GROUNDSKEEPER_LLM=cli)

npm run dev -- --dry-run    # full cycle, prints a JSON audit, opens no PR
```

`--dry-run` runs everything up to and including the guard verdicts. Without it, groundskeeper branches the target repo, applies the surviving ops via AST edits, gates on the target's `tsc --noEmit`, and opens a PR whose body is the claim→source audit table.

## Design notes

- **Fail-closed everywhere.** Any ambiguity — unknown URL, factless source, judge parse failure — resolves to reject. False negatives are the only unacceptable failure.
- **Degradation over failure.** Missing Search Console credentials degrade selection to staleness-only instead of aborting the cycle.
- **Keyless scheduled runs.** `ClaudeCliClient` drives the ambient `claude -p` CLI, so a scheduled cloud run carries no embedded API key.
- **Deliberately inert where the data model can't support it.** `promoteToMeasured` is disabled until the target schema carries per-band provenance; enabling it early would corrupt data that would re-feed as "measured" next cycle. The hazard is documented in the adapter rather than papered over.
- **Everything injected.** LLM, git, gh, subprocess runners are constructor-injected; the test suite sequence-asserts the exact commands without touching the network.

## Architecture

```
src/
  orchestrator.ts        one cycle; all stages constructor-injected
  cli.ts                 wiring + --dry-run entry (run under tsx)
  performance/gsc.ts     Search Console snapshot (optional; degrades gracefully)
  selector/              scores pages, picks exactly one, emits human-readable reasons
  evidence/              curve points + sources → EvidenceSet (knownSourceUrls + facts)
  drafter/               LLM → zod-validated EditOp[]
  guard/                 mechanical.ts + judge.ts composed by grounding-guard.ts
  content-source/        ContentSource interface + Steady adapter (ts-morph AST writes)
  build/verifier.ts      target's tsc --noEmit; failure aborts the branch
  pr/pr-writer.ts        branch/commit/push/PR with audit table; abort path
  llm/client.ts          Anthropic SDK | `claude -p` CLI | FakeLlm for tests
```

The design spec — competitive landscape, non-goals, decision log — is in [docs/DESIGN.md](docs/DESIGN.md). The repo was built spec-first with coding agents: spec → task decomposition ([docs/superpowers/plans](docs/superpowers/plans)) → implementation with tests per module → adversarial review of the guard → hardening. The commit history reflects that sequence.

## Current limitations

- One `ContentSource` adapter (Steady's data layout); a second site means writing a second adapter.
- Free-text dossier evidence isn't wired yet — facts come from structured curve data only.
- Spelled-out numbers ("twelve months") bypass the mechanical number gate; the LLM judge is the backstop by design.
- One page per run, by design.

## License

MIT
