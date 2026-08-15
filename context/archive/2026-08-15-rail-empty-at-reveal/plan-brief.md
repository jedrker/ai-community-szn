# Empty host rail — Plan Brief

> Full plan: `context/changes/rail-empty-at-reveal/plan.md`
> Seed and diagnosis: `context/changes/rail-empty-at-reveal/change.md`

## What & Why

The projector's right-hand rail stays on screen in states where it has nothing to show, leaving a
440px empty column with a divider border while the stage does not reclaim the width. The signage
redesign's §2 sketch had promised a "correctness figure" for that slot at the reveal, but no step
ordered it and no review caught the gap — so the rail is simply empty there. The figure is not being
built (see Scope); the rail is being made to follow its contents instead.

## Starting Point

The rail holds three sections, each hidden by its own rule: the answered count and the countdown
(both `question-open` only) and the word cloud's counters (`question-open` **and**
`question-revealed`). `#rail` itself is hidden in exactly one place — `applyShell`, on `ended`. Cross
the two and the rail is empty and still visible in four states, not one: the reveal of every
non-cloud question, the standings phase, the sessionless `brak sesji` branch, and — already handled
— the close.

## Desired End State

The rail is on screen exactly when at least one of its three blocks is. A choice-question reveal
gives the distribution bars the full width; the leaderboard beat gets the full width; `brak sesji`
sits on a full-width stage. The word-cloud reveal keeps its rail and its counters, including after
the final read freezes the cloud.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| The promised correctness figure | Do not build it | Derivable only for single-choice: multiple-choice correctness is "all and only" while the distribution counts selections, text and number publish nothing per-player, and on a number question `AnswerRecord.correct` is exact-hit-only so the word misleads. | Change |
| Mechanism | Derived — a new `syncRail()` reads the three sections' `hidden` state | No second copy of the predicates, and a phase list would be wrong for the word-cloud reveal, where the counters must survive. | Plan |
| Scope | Every empty rail, not only the reveal | One rule instead of a case list; the standings and sessionless screens carry the identical defect on the same projector. | Plan |
| `applyShell` | Drop its `setHidden(railBox, ended)` | Its own docstring forbids a region being shown by one branch and hidden by another; the derived rule already covers the close. | Plan |
| Guard | Two source assertions: one writer for `railBox`, two `syncRail();` call sites | Both are invariants rather than code shape, and both can be verified in each direction, as `lessons.md` requires. | Plan |

## Scope

**In scope:** `syncRail()` and its two call sites in `src/pages/quiz/host.astro`; removing the rail
from `applyShell`; two guards in `src/pages/quiz/host.test.ts`; a paragraph in `CLAUDE.md`.

**Out of scope:** the correctness figure; `SessionState`, any route, key or poll change; the
attendee view; amending the archived redesign plan; any phase list.

## Architecture / Approach

`#rail` gets a single writer. `syncRail()` sits with `syncControls`/`syncEndButton` at the tail of
`render`, after the three panel renderers have settled, and hides the rail when all three sections
report `hidden`. It takes no `state` argument — depending on one would reopen the door to a phase
condition. The close needs no special case: at `ended` the poll predicate returns `null` and the
countdown is already cleared, so all three blocks are hidden and the derived rule hides the rail.
The stage widens on its own — it is `flex-1 min-w-0` in the body split, which is how the closing
screen already works.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The empty-rail rule | `syncRail()`, `applyShell` edit, two guards | The word-cloud reveal is the case a careless rule breaks; manual step 3 exists to catch it |
| 2. Documentation | The single-writer invariant in `CLAUDE.md`; runbook check | The runbook check is expected to be a no-op and should be reported as one, not padded into an edit |

**Prerequisites:** none — no schema, route or key work, and no data migration.
**Estimated effort:** one session.

## Open Risks & Assumptions

- The behaviour itself cannot be tested automatically: an Astro inline script has no harness, so
  `host.test.ts` can only scan source. The guards pin the invariant the rule rests on; correctness
  rests on the eight manual steps.
- Assumes no other future rail block will want to appear in a phase where all three current ones are
  hidden. If one does, it joins the derived rule rather than adding a phase condition.

## Success Criteria (Summary)

- At a reveal the room sees the distribution bars across the full screen, with no empty column.
- The word-cloud reveal is unchanged — counters stay up while the host talks over a frozen cloud.
- The leaderboard and the `brak sesji` fallback also gain the full width, from the same one rule.
