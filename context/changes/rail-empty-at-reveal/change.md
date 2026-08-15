---
change_id: rail-empty-at-reveal
title: Hide the host rail at reveal instead of leaving an empty column
status: impl_reviewed
created: 2026-08-15
updated: 2026-08-15
archived_at: null
---

## Notes

Seed: the signage redesign's plan §2 sketch
(`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:133-134`) says the rail carries
"the clock (open) **or the correctness figure (revealed)**" at the bottom. No step in that plan
ordered the correctness figure, and none of the impl-review findings caught it. It is not a
regression — the block was never built.

Consequence in `src/pages/quiz/host.astro`: at `question-revealed` the rail's three sections all
hide — `#participation` via `showCount` (`renderParticipation`, which reads `pollTargetFor`;
that returns `null` outside `question-open` for choice kinds), `#word-cloud` for any non-cloud
question, `#host-countdown` with the closed question. `#rail` itself is only hidden on `ended`
(`setHidden(railBox, ended)`). So for single-choice, multiple-choice, text and number questions
the reveal shows a 440px empty column with a `border-l-2` divider, and the stage does not
reclaim the width for the distribution bars. Word-cloud questions are the one exception: their
counters stay up until `cloudFinalReadFor` closes the poll.

The correctness figure was not built because it has no backing data for four of five kinds, and
that is the reason to drop it rather than implement it:

- single-choice — derivable from `revealedDistribution` (the count on the correct option id);
- multiple-choice — not derivable: correctness is "all and only", and the distribution counts
  selections rather than people (which is why its bars sum past 100%);
- text and number — the snapshot carries nothing per-player; `revealedAnswerText` is the answer
  itself, and what an attendee typed travels on `/api/quiz/result`;
- number additionally makes the word misleading: `AnswerRecord.correct` is exact-hit-only, so it
  is `false` on an answer that scored 800 of 1000.

Chosen direction: hide the rail at `question-revealed` as well as at `ended`, and let the stage
take the full width. The rail already carries "figures about a question in progress" — the
comment at `setHidden(railBox, ended)` says so — and a revealed question is not in progress.

Open point for the plan: the word-cloud reveal must keep its rail, so the condition is not a
plain phase check. It is closer to "hide when the rail has no visible block", which the render
path can already answer from `pollTargetFor` plus the countdown's own condition. Deciding that
in one place matters — a second phase list in a view is the copy that falls behind, the same
reasoning `standings !== null` is keyed on rather than on `BOARD_PHASES`.
