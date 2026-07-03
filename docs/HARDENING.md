# Guard hardening log

After the initial build, an adversarial model review of the grounding guard (2026-07-02) was run with one goal: find inputs where a fabricated claim could pass. It found 3 HIGH + 2 MED false-negative holes — after an earlier laundering bug had already been fixed (`bafd3d0`). Ordering rule for the fixes: harden the guard's false-negative net first, then do any value unlock.

## Phase 1 — close false-negative holes ✅

- [x] **H1** Judge passage carries basis tag + source title; judge prompt forbids a "site estimate" line from supporting a "study measured/reported" claim. (`grounding-guard.ts`, `judge.ts`) + test.
- [x] **H2** Mechanically reject `replaceProse`/`updateMeta` with `claims.length === 0`; fail C1 on an empty passage. (`mechanical.ts`, `grounding-guard.ts`) + tests.
- [x] **H3** `addSource` must exact-match a canonical source record in the evidence base; drafter-supplied title/tier/score cannot be trusted. Reject otherwise. (`mechanical.ts`) + fixture/tests.

## Phase 2 — cheap correctness ✅

- [x] **H5** `replaceProse` asserts current field text === `op.oldText` before replacing (fail loud). (`steady.ts`) + test.
- [x] **H4** Document the whole-point basis-flip hazard in `applyOps`; keep `promoteToMeasured` inert; mark as a hard prerequisite before any dossier-backed structured facts. (`steady.ts` comment.)

## Phase 3 — value unlock (after Phase 1)

- [x] **V1** Surface `nativeScale` into fact claimText + numbers so "5.2/10"-style phrasing is backed. (`expand-curve.ts`, `retriever.ts`) — real points carry `nativeScale` ("VAS/NRS 0-10 …"). Live result: first grounded edit passed the guard; an estimate-laundering meta edit was rejected by the basis-aware judge.
- [ ] **V2** `updateMeta` restatement mode: feed the page's CURRENT PROSE into the judge passage (labeled) and allow numbers in prose ∪ facts, so CTR meta edits can pass without admitting new medical claims. (Currently meta edits are rejected when they generalize past the measured points — V2 lets meta restate what's already on the page.)

## Gate

- [x] Full suite green + `npm run build` clean.
- [x] Live dry-run: a grounded edit passes; every laundering attempt rejected (H1 confirmed on real data).
- [x] Commits: `bafd3d0` (promote fix), `0f1f7cd` (H1–H5 hardening), `a918da2` (V1 scale).
- [x] Scheduled daily dry-run with a notification digest.

## Retro

- The adversarial review paid for itself: it found 3 HIGH holes the build missed (especially H1 — the same laundering class as the promote bug, but through prose/meta).
- Correct ordering was harden-then-enrich, not enrich-first.
- Remaining: V2 (meta restatement mode) for CTR edits; dossier wiring (blocked on H4 fix first); flip the routine to PR mode once the daily digest is trusted.
