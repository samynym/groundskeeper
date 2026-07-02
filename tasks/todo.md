# Groundskeeper — post-Fable-5-review hardening

**Trigger:** Fable 5 adversarial review (2026-07-02) found 3 HIGH + 2 MED holes after the promote-laundering fix (bafd3d0). Order = harden the guard's false-negative net FIRST, then do the value unlock.

## Phase 1 — close false-negative holes (non-negotiable) ✅ DONE
- [x] **H1** Judge passage carries basis tag + source title; judge prompt forbids a "site estimate" line from supporting a "study measured/reported" claim. (grounding-guard.ts, judge.ts) + test.
- [x] **H2** Mechanically reject replaceProse/updateMeta with `claims.length === 0`; fail C1 on an empty passage. (mechanical.ts, grounding-guard.ts) + tests.
- [x] **H3** addSource must exact-match a canonical source record in the evidence base; drafter-supplied title/tier/score cannot be trusted. Reject otherwise. (mechanical.ts) + fixture/tests.

## Phase 2 — cheap correctness ✅ DONE
- [x] **H5** replaceProse asserts current field text === op.oldText before replacing (fail loud). (steady.ts) + test.
- [x] **H4** Document the whole-point basis-flip hazard in applyOps; keep promote inert; mark as a HARD prerequisite before any dossier-backed structured facts. (steady.ts comment) — memory note pending.

## Phase 3 — value unlock (after Phase 1)
- [ ] **V1** Surface `nativeScale` into measured-fact claimText + numbers so "5.2/10"-style phrasing is backed. (expand-curve.ts, retriever.ts) — VERIFY real Steady painBand points actually carry nativeScale first.
- [ ] **V2** updateMeta restatement mode: feed the page's CURRENT PROSE into the judge passage (labeled) and allow numbers in prose ∪ facts, so CTR meta edits can pass without admitting new medical claims.

## Gate
- [ ] Full suite green + `npm run build` clean.
- [ ] Live dry-run: at least one grounded edit passes, and re-confirm every laundering attempt is rejected.
- [ ] Commit; then decide cloud-routine scheduling.

## Review
(to fill in)
