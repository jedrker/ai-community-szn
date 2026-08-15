# Empty host rail — implementation plan

## Overview

The projector's right-hand rail stays on screen in every state where it has nothing to show,
leaving a 440px empty column with a divider border while the stage does not reclaim the width.
This plan makes the rail's presence follow its contents: it is on screen when at least one of its
three blocks is, and gone otherwise. The rule is derived from the blocks rather than written as a
phase list, and `#rail` keeps exactly one writer.

## Current State Analysis

The rail (`src/pages/quiz/host.astro:368`) holds three sections, each hidden by its own rule:

| Section | Hidden by | Visible when |
| --- | --- | --- |
| `#participation` (`participationBox`, `:758`) | `renderParticipation` (`:1215`) via `pollTargetFor(state)?.kind === "participation"` | `question-open` on a single- or multiple-choice question |
| `#word-cloud` (`wordCloudBox`, `:774`) | `renderWordCloudPanel` (`:1297`) via `pollTargetFor(state)?.kind === "words"` | `question-open` **and** `question-revealed` on the word-cloud question |
| `#host-countdown` (`hostCountdownBox`, `:795`) | `stopCountdown` / `renderCountdownPanel` (`:1949`) | `question-open` on a question carrying `timeLimitSeconds` |

`#rail` itself is hidden in one place — `applyShell` (`:1556`), `setHidden(railBox, ended)` — so it
survives every state except the close. Cross the two facts and the rail is empty and still on
screen in four situations:

1. **`question-revealed`** on single-choice, multiple-choice, text and number questions. This is the
   reported one. The distribution bars are on the stage (`#distribution-panel`, `:288`), and they
   are the widest thing the room reads all session.
2. **`standings`** — the board is on the stage (`#standings`, `:322`); no rail block has a rule that
   fires in that phase.
3. **The sessionless branch of `render`** (`:1580`–`:1620`) — a purge, a TTL expiry or the first
   paint. It hides all three sections explicitly (`:1594`, `:1596`, `:1607`) and calls
   `applyShell(NO_SESSION)`, which is not `ended`, so the rail stays.
4. **`ended`** — already handled, and the comment at `:1554` states the reasoning this plan
   generalises: *"The rail carries figures about a question in progress. There is none at the close,
   and the winner takes the width it leaves."*

The word-cloud reveal is the case that makes a phase list wrong. `renderWordCloudPanel`'s own
comment (`:1298`) records it: *"The panel survives the final read: `pollTargetFor` still returns a
words target in `question-revealed`, and only `pollWanted` stops the ticks. That split is what lets
the host talk over a frozen cloud."* A rule keyed on `phase === "question-revealed"` would take the
rail away from the one reveal that needs it.

### Key Discoveries

- **`applyShell`'s docstring already forbids the shortcut** (`:1533`): *"Deciding that here — and
  writing `data-phase` from the same call — is what keeps a region from being shown by one branch
  and hidden by another."* It then carves out the precedent this plan follows: *"Note what this does
  not decide: whether the board is on screen. That keys on `standings !== null` in `render`, because
  the schema owns the rule about where a board may appear and a phase list here would be a copy able
  to fall behind it."* The rail is the second region whose rule lives in its contents, not in the
  phase.
- **The three renderers already run in sequence at the tail of `render`** — `renderCountdownPanel`
  (`:1811`), `renderParticipation` (`:1812`), `renderWordCloudPanel` (`:1813`), then `syncControls`
  and `syncEndButton` (`:1814`–`:1815`). A `syncRail` placed after the three reads finished state,
  and sits in the existing `sync*` family rather than inventing a position.
- **`setHidden` writes the `hidden` property** (`src/lib/client/render.ts:40`), so the rail's own
  state is readable back off the DOM — `participationBox.hidden` and friends — which is what lets
  the rule be derived instead of recomputed.
- **The stage reclaims the width for free.** `#stage` is `flex min-w-0 flex-1` (`:272`) inside
  `#body-split`'s row (`:263`), so removing the rail from layout widens it with no CSS change. The
  close already relies on this.
- **No guard covers `#rail` today.** `src/pages/quiz/host.test.ts` scans for the poll loop, the
  action URL and `syncControls();` (`:488`) but never mentions the rail.
- **The correctness figure the redesign's §2 sketch promised is not being built**, and the reason is
  in `change.md`: it is derivable only for single-choice. See "What We're NOT Doing".

## Desired End State

On the projector, the right-hand rail is present exactly when it has something in it:

- `lobby` — no split at all (unchanged; the lobby replaces the body).
- `question-open` — rail present, carrying the answered count and/or the clock, or the cloud's two
  counters.
- `question-revealed` — rail present **only** on the word-cloud question, carrying its counters
  until the host moves on; gone on every other kind, and the distribution bars take the full width.
- `standings` — rail gone, the board takes the full width.
- `ended` — rail gone (unchanged behaviour, new mechanism).
- No session — rail gone, `brak sesji` sits on a full-width stage.

Verified by loading `/quiz/host` and walking a session, plus a source guard that the single-writer
invariant this rests on has not been quietly broken.

## What We're NOT Doing

- **Not building the correctness figure** from the archived redesign's §2 sketch
  (`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:133-134`). It has no backing data
  for four of the five question kinds: multiple-choice correctness is "all and only" while
  `revealedDistribution` counts selections rather than people; text and number publish nothing
  per-player on the snapshot; and on a number question the word is actively misleading, because
  `AnswerRecord.correct` is exact-hit-only and reads `false` on an answer that scored 800 of 1000.
  Building it for single-choice alone would put a figure on the projector that appears and vanishes
  by question kind for reasons the room cannot see.
- **Not touching `SessionState`**, any route, any `livequiz:` key, or the poll loop. This is a view
  rule over state that already reaches the page.
- **Not amending the archived redesign plan.** `context/archive/` is immutable; this change folder
  records the deviation instead.
- **Not changing the attendee view.** The phone has no rail.
- **Not adding a phase list anywhere.** Explicitly out of scope — it is the mechanism this plan
  exists to avoid.

## Implementation Approach

Give `#rail` a single writer, `syncRail`, and derive its argument from the three sections' own
`hidden` state rather than from the phase or from a second copy of their predicates. Remove
`setHidden(railBox, ended)` from `applyShell`, whose docstring gains the same "what this does not
decide" note the board already has. Call `syncRail` from both paths through `render` — the ordinary
tail and the sessionless early return — after the sections have settled.

The close keeps working without a special case: at `ended`, `pollTargetFor` returns `null` (it
requires `question-open`, or `question-revealed` for the cloud), and the countdown is cleared by
`stopCountdown` at the top of `render`, so all three blocks are hidden and the derived rule hides
the rail — which is what `applyShell`'s comment was describing all along.

## Critical Implementation Details

**Ordering.** `syncRail` must run *after* `renderCountdownPanel`, `renderParticipation` and
`renderWordCloudPanel`, because it reads what they wrote. In the sessionless branch it must run
after the three explicit `setHidden(..., true)` calls and *before* the `return`. Placing it with
`syncControls`/`syncEndButton` in both paths satisfies this in both — those two calls are already
the last thing each path does.

**Do not read `#participation-count-box`.** `renderParticipation` hides the section
(`participationBox`) and the inner count box (`countBox`) with the same predicate; the section is
the one that decides whether anything is on screen, and the inner box is an implementation detail
of that panel.

## Phase 1: The empty-rail rule

### Overview

`#rail` follows its contents, with one writer.

### Changes Required

#### 1. The rail's visibility

**File**: `src/pages/quiz/host.astro`

**Intent**: Add `syncRail`, which hides `#rail` when all three of its sections are hidden, and make
it the only thing that writes `railBox`. This covers the reveal, the standings phase, the
sessionless branch and the close with one rule, and keeps the word-cloud reveal's counters on screen
because the rule asks the sections rather than the phase.

**Contract**: A new `function syncRail(): void` alongside `syncControls`/`syncEndButton`, reading
`participationBox.hidden`, `wordCloudBox.hidden` and `hostCountdownBox.hidden` and calling
`setHidden(railBox, …)`. It takes no `state` parameter — depending on one would reopen the door to
a phase condition. Called at two sites: the tail of `render` (after `renderWordCloudPanel`,
`:1813`) and the sessionless early return (beside `syncControls();`/`syncEndButton();`, `:1619`).
Its docblock names the four states the rail now leaves and states why the rule is derived, quoting
the word-cloud reveal as the case that makes a phase list wrong.

#### 2. `applyShell` stops deciding the rail

**File**: `src/pages/quiz/host.astro`

**Intent**: Remove `setHidden(railBox, ended)` (`:1556`) and its two-line comment, so `#rail` has
exactly one writer. Extend the docstring's existing "Note what this does not decide" paragraph
(`:1541`) to cover the rail beside the board, with the same reasoning — the contents own the rule,
and a phase list here would be a copy able to fall behind.

**Contract**: `applyShell(phase: string): void` keeps its signature and its other four
`setHidden` calls (`lobbyBox`, `bodySplit`, `topStrip`, `controlRow`, `endedNote`). `railBox` no
longer appears in the function. The `ended` local is still used by the remaining calls.

#### 3. The single-writer guard

**File**: `src/pages/quiz/host.test.ts`

**Intent**: Pin the two properties the rule rests on, in the file that already guards this page's
structure: `#rail` has one writer, and `syncRail` is reached from both paths through `render`. The
behaviour itself — "an empty rail disappears" — cannot be asserted here, because an Astro inline
script has no harness; that is what the manual verification below is for, and the test's comment
should say so rather than implying more coverage than it has.

**Contract**: Two assertions in the existing `occurrences(...)` style —
`occurrences("setHidden(railBox")` is 1, and `occurrences("syncRail();")` is 2. The trailing
semicolon separates the call sites from the declaration, the same trick the `syncControls();`
assertion documents at `:487`. Per `lessons.md` ("A source-scanning guard must assert the property,
not the shape"), verify each in both directions before committing: add a second `setHidden(railBox`
and watch the first fail; delete one `syncRail();` call and watch the second fail; restore both.

### Success Criteria

#### Automated Verification

- Test suite passes: `bun run test`
- Type check reports 0 errors: `bun run type-check`
- Production build succeeds: `bun run build`
- Both new guards fail when their invariant is broken and pass when it is restored (see Contract
  above — this is a manual step over an automated test, run before committing)

#### Manual Verification

- Reveal a single-choice question: the rail is gone and the distribution bars take the full width
- Reveal the word-cloud question: the rail is still there with both counters, and stays after the
  final read closes the poll
- `pokaż ranking`: the rail is gone and the board takes the full width
- A question with a clock, while open: the rail carries the answered count and the countdown as
  before
- `zakończ sesję`: the closing screen is unchanged
- `bun run quiz:reset` (or a purge) mid-question: `brak sesji` sits on a full-width stage with no
  empty rail
- Advancing back into `question-open` from any of the above brings the rail back

**Implementation Note**: After the automated verification passes, pause for manual confirmation
before Phase 2.

---

## Phase 2: Documentation

### Overview

Record the new invariant where the next agent editing this page will read it.

### Changes Required

#### 1. The host-panel section

**File**: `CLAUDE.md`

**Intent**: The section "The host panel offers only the action the phase accepts" already states one
single-reader invariant for this page (`CONTROL_RULES` / `syncControls`). Add the rail's
single-writer invariant beside it: the rail is present exactly when one of its three blocks is,
`syncRail` is the only writer, the rule is derived from the blocks rather than from a phase list,
and the word-cloud reveal is why. Per `lessons.md` ("The CLAUDE.md edit is part of the slice"), this
is planned rather than discovered at the end.

**Contract**: A short paragraph in that section. No existing sentence in `CLAUDE.md` becomes false —
the file makes no claim about the rail today (grepped) — so this is an addition, not an amendment.

#### 2. Runbook check

**File**: `docs/runbook-live-session.md`

**Intent**: Confirm the runbook does not describe a rail at the reveal. Its only rail mention today
is the countdown at `:341`, *"the projector carries it in the right-hand rail, under the answered
count"*, which stays true — the clock only ever runs while a question is open. If the walk-through
turns out to describe the reveal screen's layout, correct it; otherwise leave the file alone and say
so.

**Contract**: Likely no change. A no-op is the expected outcome and should be reported as one rather
than padded into an edit.

### Success Criteria

#### Automated Verification

- Test suite still passes: `bun run test`
- Type check reports 0 errors: `bun run type-check`

#### Manual Verification

- The `CLAUDE.md` paragraph names the mechanism, the single writer, and the word-cloud reveal as the
  reason the rule is not a phase list
- The runbook was read and either corrected or explicitly confirmed unchanged

---

## Testing Strategy

### Unit tests

Nothing new beyond the two source guards in Phase 1. The rule lives in an Astro inline script, which
`host.test.ts` can only scan — the file's own header explains why, and `lessons.md` warns against a
guard that certifies the current shape instead of the property. The two chosen assertions are
invariants (one writer; both call sites present), not shape.

### Integration tests

None. No route, key or schema changes.

### Manual testing steps

1. `bun run dev`, open `/quiz/host` with no session — `brak sesji` on a full-width stage.
2. `start`, then `dalej` into question 1 (word cloud) — rail carries the two cloud counters.
3. `pokaż odpowiedź` — the cloud counters stay; the rail does **not** disappear.
4. `dalej` into a scored choice question — rail carries the answered count and the clock.
5. `pokaż odpowiedź` — the rail disappears; the bars take the full width.
6. `pokaż ranking` — the rail stays gone; the board takes the full width.
7. `zakończ sesję` — closing screen unchanged.
8. `bun run quiz:reset` mid-question, watch the panel fall back — no empty rail under `brak sesji`.

## Performance Considerations

None. One extra DOM property read per render, on a page that renders on host actions.

## Migration Notes

None — no persisted state, no schema, no key. A revert is a revert.

## References

- Seed and diagnosis: `context/changes/rail-empty-at-reveal/change.md`
- The §2 sketch that promised the correctness figure:
  `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:133-134`
- The precedent for a region whose rule lives in its contents: `applyShell`'s docstring,
  `src/pages/quiz/host.astro:1537-1544`, and `standings !== null` in `render`
- Why the word-cloud panel survives the reveal: `src/pages/quiz/host.astro:1298-1301`
- Guard discipline: `context/foundation/lessons.md` — "A source-scanning guard must assert the
  property, not the shape", "Break the guard and watch the named test fail", "The CLAUDE.md edit is
  part of the slice"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The empty-rail rule

#### Automated

- [x] 1.1 Test suite passes: `bun run test` — 0d24de0
- [x] 1.2 Type check reports 0 errors: `bun run type-check` — 0d24de0
- [x] 1.3 Production build succeeds: `bun run build` — 0d24de0
- [x] 1.4 Both new guards verified in both directions — 0d24de0

#### Manual

- [ ] 1.5 Single-choice reveal: rail gone, bars take the full width
- [ ] 1.6 Word-cloud reveal: rail present with both counters, survives the final read
- [ ] 1.7 `pokaż ranking`: rail gone, board takes the full width
- [ ] 1.8 Open scored question: answered count and countdown as before
- [ ] 1.9 `zakończ sesję`: closing screen unchanged
- [ ] 1.10 Purge mid-question: `brak sesji` on a full-width stage
- [ ] 1.11 Advancing back into `question-open` brings the rail back

### Phase 2: Documentation

#### Automated

- [x] 2.1 Test suite still passes: `bun run test` — bcea32b
- [x] 2.2 Type check reports 0 errors: `bun run type-check` — bcea32b

#### Manual

- [ ] 2.3 `CLAUDE.md` paragraph names mechanism, single writer, and the word-cloud reason
- [ ] 2.4 Runbook read and either corrected or explicitly confirmed unchanged
