---
change_id: quiz-definition-and-validation
title: "Quiz definition authored in the repository"
roadmap_id: S-01
status: impl_reviewed
created: 2026-08-05
updated: 2026-08-06
---

# Quiz definition authored in the repository

Roadmap item **S-01** from `context/foundation/roadmap.md`. PRD refs: FR-001, FR-017.

## Outcome

The organizer can define the whole quiz — questions, types, options, accepted answers, true values,
scoring flags — in a file authored alongside the project's source, and a malformed or incomplete
definition is rejected loudly at build time rather than discovered on stage.

## Why this slice is first

S-01 is the only user-facing slice with no dependency on the realtime spine (F-02) or on any
platform decision, so it can proceed in parallel with F-01. It also produces the data contract that
S-02 through S-08 all read.

## Scope boundary against later slices

This change delivers the **definition and its validation**. It deliberately does not implement
scoring, matching, or any session behaviour:

- **S-03** owns the scoring model (speed weighting, all-or-nothing multi-answer).
- **S-05** owns free-text matching — but the Polish normalizer it needs ships here, because
  validation uses it to reject accepted-variant lists that collapse to duplicates. Called out
  explicitly so review does not read it as scope creep.
- **S-06** owns the relative-error award curve.

## Artifacts

- `plan.md` — implementation contract
- `plan-brief.md` — compressed handoff
- `reviews/plan-review.md` — plan review, all 5 findings triaged and fixed

## Links

- Roadmap: `context/foundation/roadmap.md` (S-01)
- PRD: `context/foundation/prd.md` (FR-001, FR-017)
- Drafted quiz content: `idea-notes.md` lines 41–56
