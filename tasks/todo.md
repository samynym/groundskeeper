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
- [x] **V1** Surface `nativeScale` into fact claimText + numbers so "5.2/10"-style phrasing is backed. (expand-curve.ts, retriever.ts) — real points DO carry nativeScale ("VAS/NRS 0-10 …"). LIVE RESULT: first grounded edit passed the guard; estimate-laundering meta rejected by the basis-aware judge.
- [ ] **V2** updateMeta restatement mode: feed the page's CURRENT PROSE into the judge passage (labeled) and allow numbers in prose ∪ facts, so CTR meta edits can pass without admitting new medical claims. (Currently meta edits are rejected when they generalize past the measured points — V2 lets meta restate what's already on the page.)

## Gate
- [x] Full suite green (77/77) + `npm run build` clean.
- [x] Live dry-run: a grounded edit passes; every laundering attempt rejected (H1 confirmed on real data).
- [x] Commits: bafd3d0 (promote fix), 0f1f7cd (H1-H5 hardening), a918da2 (V1 scale). Pushed to github.com/samynym/groundskeeper (private).
- [x] Cloud routine scheduled: trig_01QF18ZdwvYcTdGeXkqgee7a, daily 07:00 UTC, dry-run mode, PushNotification digest. Test-fired 2026-07-02.

## Review
- Fable-5 review paid for itself: found 3 HIGH holes I missed (esp. H1, same laundering class as the promote bug through prose/meta).
- Correct ordering was harden-then-enrich (Fable's call), not enrich-first (mine).
- Remaining: V2 (meta restatement mode) for CTR edits; dossier wiring (blocked on H4 fix first); flip routine to PR mode once the daily digest is trusted.
