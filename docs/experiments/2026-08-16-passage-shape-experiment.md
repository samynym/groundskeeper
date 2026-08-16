# Experiment 1 — does passage shape cause citation?

Written 2026-08-16. Status: ready to run.

## The question

growsteady.me is now in the retrieval corpus of both engines. Neither cites it
on natural questions. The verdict is INDEXED_NOT_MATCHED on Brave/Claude and on
Bing/ChatGPT. Presence is solved. Something else blocks citation.

This experiment tests one candidate:

> An assistant cites the page that holds a short, self-contained sentence it can
> repeat as-is, and that it cannot find anywhere else.

## Why this is worth testing first

Measured on 2026-08-09: the question "PAO recovery timeline week by week pain
data" returns nine URLs — a university hospital, a surgeon's practice site, a
hip clinic. **None of them prints a number.** The engine takes them because it
has nothing better.

So the void is real, and the material to fill it already exists. Four procedures
carry complete study records. That is enough to write cross-study sentences that
appear on no other site in the world.

## A defect this experiment fixes on the way

The probe currently measures ACL, knee replacement and rotator cuff.

**None of those three has a study index.** The four procedures that do — PAO,
microdiscectomy, meniscus, shoulder labral — are not measured at all.

As configured, the probe could never have detected the study index working.
Fixing the target list is step one.

## Design

Three arms. Two comparisons. One variable each.

| Arm | Pages | Study records? | Change applied |
|---|---|---|---|
| **A** | `pao-recovery-timeline`, `meniscus-surgery-recovery-timeline` | yes | liftable answer blocks |
| **B** | `microdiscectomy-recovery-timeline`, `shoulder-labral-repair-recovery-timeline` | yes | none |
| **C** | `rotator-cuff-surgery-recovery-timeline` | no | none |

- **A against B** isolates passage shape. Both arms carry study data. Only A is
  rewritten.
- **B against C** isolates the study index itself. Neither is touched. Only B
  has records.

A null result on both is still a finding: neither content shape nor evidence
depth moves citation, and the next hypothesis is off-page — links and
third-party mentions.

## What "liftable" means, precisely

Vague definitions produce unrepeatable experiments. An answer block is liftable
when all four hold:

1. The heading is the question, in the words a person would use.
2. The next sentence answers it completely, and contains the number.
3. The sentence stands alone. No pronoun points backwards. No phrase refers to a
   chart, a table, or anything above it.
4. The spread and the evidence count follow in the same block.

Worked example:

> **When can you drive after meniscus surgery?**
>
> Most people drive again two weeks after meniscus surgery. Three studies report
> one, two and four weeks. The figures come from 412 patients.

Nothing in that block needs the rest of the page. That is the whole point.

## The frozen question set

Frozen before any page changes. Never edited mid-experiment. Editing it
invalidates every prior measurement.

No brand words — those belong to rungs R0 and R1. These are rung R4: what a real
person types into an assistant.

**PAO** (arm A)
- how long does recovery take after periacetabular osteotomy
- when can i walk without crutches after pao surgery
- pao recovery timeline week by week pain data

**Meniscus** (arm A)
- how long does meniscus surgery recovery take
- when can i drive after knee arthroscopy
- meniscus surgery pain week by week

**Microdiscectomy** (arm B)
- how long does microdiscectomy recovery take
- when can i return to work after microdiscectomy
- microdiscectomy recovery timeline week by week

**Shoulder labral repair** (arm B)
- how long does shoulder labral repair recovery take
- when can i lift my arm after labral repair
- shoulder labral repair recovery timeline week by week

**Rotator cuff** (arm C, control)
- how long does rotator cuff surgery recovery take
- rotator cuff repair recovery timeline

The third question in each set asks for a number across weeks. That is the shape
only Steady can answer.

## Phases

### Phase 0 — equalise indexing. Do not skip.

**If arm A is submitted and arm B is not, the experiment measures the submission,
not the writing.** That would destroy it before it starts. Every page goes into
every channel, before any content change.

The two engines read different indexes, so this needs two channels:

| Engine | Index behind it | Channel | Who does it |
|---|---|---|---|
| ChatGPT | Bing | IndexNow — `TARGETS_PATH=config/steady-targets-exp1.json npm run presence submit` | done 2026-08-16, http 200, 6 URLs |
| Claude | Brave | `search.brave.com/submit-url` | **manual, still outstanding** |

Brave takes no IndexNow feed and offers no API. Its form is browser-only and
bot-protected, so an agent cannot fire it. About thirty seconds per URL.

Brave presence is also URL-level, not domain-level: three URLs were submitted by
hand in July and August, and those three are the only ones a domain-scoped probe
returns. Submitting the homepage does not carry the rest.

Then probe until every page reads INDEXED_NOT_MATCHED or better on both engines.
Only then proceed.

### Phase 1 — baseline

Run the probe against the frozen question set on both engines. Two runs each.
Record the verdict per page, per engine, per rung.

**No page may change before this finishes.** A baseline taken after the change
measures nothing.

### Phase 2 — apply arm A

Rewrite the two arm A pages to carry liftable answer blocks, one per question in
their set. Deploy.

Change nothing else. Not the design, not the navigation, not the other pages. A
second simultaneous change makes the result unreadable.

### Phase 3 — measure weekly

One probe per week for four weeks, same question set, both engines.

## What counts as a result

Verdict rank: `CITED` > `RETRIEVED_NOT_CITED` > `INDEXED_NOT_MATCHED` > `ABSENT`.

- **Positive** — arm A rises at least one rank on its R4 questions, while arms B
  and C hold still.
- **Null** — nothing moves in four weeks. Passage shape is not the lever. Move to
  the off-page hypothesis.
- **Void** — arms B or C move too. Something external changed. The engine
  updated, or the crawl grew. Discard and re-run.

Two engines that disagree is a finding worth keeping, not a problem. It means the
advice has to be engine-specific, and that is exactly the kind of thing an AEO
product would sell.

## Recording

Every probe appends to `presence/experiments.jsonl`. For this experiment each
entry also carries the arm label, so a later reader can rebuild the comparison
without guessing.

The log is the asset. A tested hypothesis with a control is worth more than the
citation itself, because it transfers to the next site.

## Known limits

- **One domain.** Anything learned here may hold only for health content, or only
  for this domain. A second site in a different vertical is required before any
  of it can be sold as advice.
- **Four weeks may be short.** Crawl-to-index latency is not known for either
  engine. A null at week four is a soft null, not a hard one.
- **Two pages per arm is thin.** It detects a large effect. It will miss a small
  one.
