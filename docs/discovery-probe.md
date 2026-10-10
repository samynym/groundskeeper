# Product-discovery probe

Question: when someone asks an assistant for a recovery-tracking app, does it recommend Steady?

- Config: `config/steady-discovery.json`. The question set is FROZEN. To ask something new, add an item at the end; never edit, reorder or remove one.
- Snapshots go to `presence/discovery/`, apart from the exp1 history in `presence/`.

## Command

```bash
TARGETS_PATH=config/steady-discovery.json PRESENCE_DIR=presence/discovery GEO_ENGINE=both npm run presence probe
```

Timeline: `PRESENCE_DIR=presence/discovery npm run presence timeline`.

## Cost

One item per question (the ladder asks only `questions[0]`). Rungs per probe: R0 + R1 + R3 for each of the 2 pages + R4 for each of the 10 questions = 14. R2 is skipped (empty `procedureSlug`).

API calls = 14 rungs x `PRESENCE_RUNS` (default 2) x engines (2 with `both`) = **56 calls**. If a page gives no extractable sentence, its R3 is skipped (2 fewer calls per page).

## What a snapshot says

- `verdicts[]`: one per question (`question` field), same verdicts as the page probe. `CITED` = a growsteady.me URL was cited in the answer to that question. Any growsteady.me URL counts, not only `pageUrl`.
- `mentions[]`: one per answer (question x engine x run).
  - `named`: the answer names "Steady" (case-sensitive; adjective uses like "steady progress" are ignored) or a brand phrase. This catches a recommendation without a link.
  - `falseClaims`: the Steady part of the answer seems to say Steady charts your full recovery history against research (`TRAJECTORY_VS_RESEARCH`) or compares you with other patients (`COMPARES_WITH_OTHER_PATIENTS`). Both are false. These are keyword heuristics: read the raw answer in `raw[]` before acting on one.
  - `ok: false`: the call failed. It is not "not named".
