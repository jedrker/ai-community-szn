# Standings rank delta — Implementation Plan

## Overview

Each row of the leaderboard gains **how many places that player moved since before the last
question** — `▲3` in mint, `▼1` in signal red, nothing at all when there is no movement to
report. The delta is computed **server-side, once, from the same `rankOf` that already numbers
the rows**, and published on the row so that 150 phones and the projector cannot arrive at
different answers.

The baseline is reconstructed rather than stored: `SUBMIT_ANSWER` increments the scores hash by
exactly `AnswerRecord.awarded`, so `previousTotal = total − awarded(<question>, <player>)` is
exact, and **no new Redis key is introduced** — the retention guardrail's surface is unchanged.

## Current State Analysis

The leaderboard beat is complete and carefully bounded; nothing in it knows anything about a
previous state.

- **Positions come from totals alone.** `rankOf(total, totals)` (`src/lib/session/standings.ts:90`)
  is competition ranking — tied players share a number — and it is called from **two** places on
  purpose: `buildStandings` for the published board (`:141`) and `readOwnRank` for a single
  device's own line (`src/lib/session/store.ts:1536`). That shared call is the only thing stopping
  a tied attendee's phone from contradicting the projector.
- **No previous board survives anywhere.** `SessionState.standings` belongs to the four-field
  "part of a transition" family (`src/lib/session/state.ts:228`): set by the standings route and by
  `endedSessionState`, **nulled by every other constructor**. `reveal` and `advance` therefore erase
  the last board before the next one is built.
- **The scores hash moves by exactly the award.** `SUBMIT_ANSWER` does
  `HINCRBY scores <playerId> <awarded>` (`src/lib/session/store.ts:427`), and `awarded` is a
  non-negative integer stored on the answer record (`src/lib/session/answers.ts:95`) precisely
  because it depends on an elapsed time only the submission knew. So the subtraction is exact
  arithmetic, not an estimate.
- **The answers hash is addressable per player.** `answerField(questionId, playerId)`
  (`src/lib/session/answers.ts:150`) is the single owner of the field format, so the awards for one
  question are one `HMGET` away once the player ids are in hand.
- **`end.ts` reads its board with no arguments** (`src/pages/api/quiz/host/end.ts:146`), which is
  what keeps the closing screen out of this change without a single conditional.
- **The renderer paints and never decides.** `renderStandings`
  (`src/lib/client/render.ts:755`) builds a row from three `<span>`s, takes the rank from the row
  rather than the loop index, and never sorts. Its motion signature is keyed on
  `rank:displayName:points` (`:814`).
- **Both views lay a row out on the same grid** — `grid-cols-[auto_1fr_auto]` — in two visual
  registers each: standings and closing (`src/pages/quiz/host.astro:2373`,
  `src/pages/quiz/index.astro:1048`).
- **The palette already has the two colours.** `--color-quiz-mint` (#3ddc84) and
  `--color-quiz-signal` (#e5342a) are the existing correct/incorrect pair
  (`src/styles/global.css:52-53`).

## Desired End State

When the host shows the leaderboard, every row that moved carries a mint `▲N` or a red `▼N` to the
right of its points, on the projector and on every phone alike. A row that did not move, a player
who had no points before the question, and a board built from a failed awards read all render the
same thing: **an empty cell**. The closing screen is unchanged.

Verified by: `bun run test`, `bun run type-check`, `bun run lint`, plus a rehearsal where two
questions are answered by at least three players and the board is shown after each.

### Key Discoveries:

- `previousTotal = total − awarded` is exact — `src/lib/session/store.ts:427` and
  `src/lib/session/answers.ts:95`.
- `rankOf` must be the *only* way a position is computed, including the previous one —
  `src/lib/session/standings.ts:90`.
- `end.ts` calls `readStandings()` with no argument (`src/pages/api/quiz/host/end.ts:146`), so an
  optional parameter keeps the closing board delta-free by construction.
- The leader's row on the projector is `bg-quiz-chrome` (yellow) —
  `src/pages/quiz/host.astro:2375`. Mint on yellow is the same invisible-figure defect impl review
  F1 already caught once on this board.
- `SessionState` documents are read back and parsed (`readSession`), so a new row field needs
  `.default(null)` or a document written before the deploy fails to parse and the host's next
  action 409s mid-segment — the reason the four transition fields carry theirs
  (`src/lib/session/state.ts`).

### The zero-baseline rule, and why it is not an edge case

Before question 1 everybody holds 0 points, so **competition ranking puts the entire room in a tie
at position 1**. Without a rule, the first board would show the leader at `▲0` and places two
through five at `▼1`, `▼2`, `▼3`, `▼4` — the room would be told its top scorers had just fallen.

The rule: **a player whose previous total is 0 gets `delta: null`.** It fixes the first board at the
source and keeps behaving correctly later — a player entering the board from nothing has not
"climbed 40 places", they have appeared. The accepted cost is that the first board of a session
carries no arrows at all.

## What We're NOT Doing

- **No new Redis key, and therefore no change to the retention surface.** The baseline is derived.
- **No delta on the closing screen** (`ended`). The winner's row is a 224px name with the rank
  hidden; a delta has nowhere to sit and nothing to say once the segment is over.
- **No delta on the attendee's own position line** (`standingsPositionText`). That would need a
  second computation path through `/api/quiz/result` and an extra Redis command on the densest
  path in the project. Deliberately deferred, not forgotten.
- **No row-reorder animation.** Still deferred for the reason `motion-contract.md` records: it needs
  row identity across a `replaceChildren()` that this renderer does not have. A static delta is not
  that motion and does not unblock it.
- **No "unchanged" marker** (`–`). No movement renders as nothing.
- **No E2E spec.** Covered by unit tests plus the host-path guards; the visual half is manual.

## Implementation Approach

Push every decision into the pure layer and let the store and the views stay dumb.

`buildStandings` learns an optional third argument — previous totals per player id — and computes
`delta = previousRank − rank` through `rankOf`, applying the zero-baseline rule. `readStandings`
learns an optional `questionId`; with one, it reconstructs those totals from a single `HMGET` over
the answers hash. Without one, nothing changes, which is how `end.ts` stays untouched. The route
passes `current.currentQuestionId`. The renderer appends a fourth span it always creates and
sometimes fills. The views widen their grid by one column and pick the colour.

The awards read is wrapped in **its own** `try`/`catch`, separate from the outer one. That
separation *is* the degradation decision: an awards failure costs arrows, a players-or-scores
failure still refuses the transition.

## Critical Implementation Details

**Sign convention.** `delta` is positive when the player moved **up** (`previousRank − rank`).
Rank numbers get smaller as you climb, so the naive subtraction has the opposite sign — this is
the one line in the change where getting it backwards produces output that looks entirely
plausible on screen.

**`HMGET` with zero fields is an error, not an empty reply.** A room where no player record parsed
must skip the call rather than issue it.

**Upstash deserializes JSON values automatically.** The existing read paths route raw values
through `asDocument` before parsing; the awards read must do the same rather than assuming a
string.

**The leader's row is chrome-on-yellow.** Both delta colours need a `[li:first-child>&]` override to
`text-quiz-ink` in the projector's standings register. The triangle glyph carries direction on its
own, so the override loses nothing.

## Phase 1: The delta in the pure layer

### Overview

`StandingsRow` gains the field and `buildStandings` learns to compute it. No store, no route, no
view — this is the half that is unit-testable on its own, the same split the module already keeps.

### Changes Required:

#### 1. The row schema and the builder

**File**: `src/lib/session/standings.ts`

**Intent**: Publish how many places each row moved, computed from the same `rankOf` the current
rank comes from, so the two positions on one row cannot be produced by different rules.

**Contract**:
- `standingsRowSchema` gains `delta: z.number().int().nullable().default(null)`. The default is
  load-bearing for the mid-deploy read-back reason the transition fields document, not tidiness.
- `buildStandings(players, scores, previousScores?)` — the third argument is
  `Readonly<Record<string, number>> | null`, previous running total per player id.
- `delta` is `null` when `previousScores` is absent, **or when that player's previous total is 0**
  (the zero-baseline rule above). Otherwise `previousRank − rank`, where `previousRank` comes from
  `rankOf(previousTotal, previousTotals)` over the same contender set. `0` is a real value and is
  published as `0`; it is the *renderer* that draws nothing for it.

**Documentation**: the sign convention and the zero-baseline rule belong in this module's docstrings
— they are the two things a future reader cannot recover from the code.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- A row moving up yields a positive delta and a row moving down a negative one (sign pinned
  explicitly, in its own named test)
- A player whose previous total is 0 yields `delta: null`, including the whole-room case that
  reproduces the first board of a session
- Tied players share both their rank and their previous rank, so a tie produces no phantom movement
- Omitting `previousScores` leaves every row at `delta: null`
- A row parsed without `delta` still validates (the `.default(null)` back-compat case)

#### Manual Verification:

- None — this phase has no surface.

---

## Phase 2: Reconstructing the baseline in the store

### Overview

One extra `HMGET` turns the awards for the question just revealed into previous totals. The
degradation asymmetry lives here.

### Changes Required:

#### 1. The standings read

**File**: `src/lib/session/store.ts`

**Intent**: Give `readStandings` an optional question to measure movement against, reconstructing
each player's previous total by subtracting that question's award from their running total.

**Contract**:
- `readStandings(questionId?: string | null): Promise<Standings | null>` — the existing no-argument
  call site keeps its exact current behaviour.
- With a `questionId` and at least one parsed player: `HMGET` the answers hash over
  `answerField(questionId, player.id)` for every parsed player, parse each with `parseAnswerRecord`,
  and take `awarded`. An absent or unparseable record contributes an award of 0, so that player
  simply shows no movement rather than a fabricated one.
- `previousTotal = Math.max(0, total − awarded)`. The clamp guards against a negative total
  producing nonsense ranks; it can only fire on store corruption and should say so.
- **The awards read gets its own `try`/`catch`.** A throw there means `previousScores` is `null` and
  the board is built without deltas; the existing outer `catch` (players/scores) still returns
  `null` and still refuses the transition.

#### 2. The log vocabulary

**File**: `src/lib/session/log.ts`

**Intent**: Make a board that arrived without its arrows visible to a host tailing the stream,
without confusing it with a refused beat.

**Contract**: add `session.standings.degraded` to `SESSION_EVENTS`, carrying `reason` only. Distinct
from `session.standings.failed`, which means the room did not move. No new `LogFields` entry.

#### 3. The route

**File**: `src/pages/api/quiz/host/standings.ts`

**Intent**: Measure against the question the room has just been through.

**Contract**: pass `current.currentQuestionId` to `readStandings`. The transition is only reachable
from `question-revealed`, where that field is non-null. The `republished` branch recomputes nothing
— it re-broadcasts the stored document, so a double tap cannot change what the arrows say.

#### 4. The directory rules

**File**: `src/lib/session/CLAUDE.md`

**Intent**: Record the two things the code cannot state — that the baseline is *derived* rather than
stored (and that adding a key for it would be a retention change, not a refactor), and that the
awards read degrades while the standings read refuses.

**Contract**: a short subsection under the leaderboard material.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `readStandings()` with no argument issues no awards read and returns rows with `delta: null`
- A player who did not answer the question shows no movement
- An awards read that throws still returns a board, with every delta `null`
- A players-or-scores read that throws still returns `null` (refusal unchanged)
- An empty room issues no `HMGET`
- The key registry test still passes — no new namespaced literal anywhere
  (`src/lib/session/keys.test.ts`)
- The route passes the current question id (host-route guards in
  `src/pages/api/quiz/host/routes.test.ts`)

#### Manual Verification:

- With a session running locally, answer one question from two devices, show the board, and confirm
  the arrows match what the scores actually did.

---

## Phase 3: The renderer

### Overview

A fourth span, always created and sometimes filled. The renderer learns the glyphs and nothing else
— it does not learn the colours.

### Changes Required:

#### 1. `renderStandings`

**File**: `src/lib/client/render.ts`

**Intent**: Paint the published delta as a direction and a magnitude, and paint nothing when there
is nothing to say.

**Contract**:
- `StandingsClassNames` gains `delta`, `deltaUp`, `deltaDown` — the `rowOwn` pattern, so the views
  own the colours and the renderer owns the shape.
- The span is **always appended**, even when empty, so the grid column keeps its width and names do
  not shift between boards.
- `▲N` for a positive delta, `▼N` for a negative one, empty text for `null` and for `0`. The glyph
  is the direction's second carrier, so colour is never the only channel.
- `row.dataset.delta` is `"up"` / `"down"` when there is one, for the reason `data-own` and
  `data-correct` exist: the state survives a stylesheet that failed to load on a venue network.
- The motion signature gains the delta — two boards holding the same rows and different movement
  are different boards.

#### 2. The client rules

**File**: `src/lib/client/CLAUDE.md`

**Intent**: Stop a future reader from reading this as the deferred reorder motion having landed.

**Contract**: one sentence beside the existing "standings reorder is deliberately not done" note —
the delta is a published figure, not row identity across a re-render.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Linting passes: `bun run lint`
- A positive delta renders `▲` with its magnitude; a negative one renders `▼`
- `null` and `0` both render an empty span, and the span still exists in the DOM
- `data-delta` is set for a move and absent otherwise
- The same board re-rendered does not re-animate; the same rows with different deltas do
- The renderer still never sorts (existing guard)

#### Manual Verification:

- None — covered by the harness.

---

## Phase 4: The two views

### Overview

One extra grid column in each of the two pages, the colour pair, and the leader-row override.

### Changes Required:

#### 1. The projector

**File**: `src/pages/quiz/host.astro`

**Intent**: Put the arrow to the right of the points in the standings register, legible from the
back of the room and legible on the leader's yellow bar.

**Contract**: the standings register's row becomes `grid-cols-[auto_1fr_auto_auto]`; delta classes
are `text-quiz-mint` / `text-quiz-signal` with a `[li:first-child>&]:text-quiz-ink` override on
both, and a type size that reads as secondary to the 72px rank. The closing register is untouched
— it is a flex column and the span is empty there.

#### 2. The phone

**File**: `src/pages/quiz/index.astro`

**Intent**: The same information in the same place, at phone scale.

**Contract**: the row becomes `grid-cols-[auto_1fr_auto_auto]`; the same two colour classes. The own
row's `bg-quiz-chrome-tint` is dark, so no override is needed there.

#### 3. The runbook

**File**: `docs/runbook-live-session.md`

**Intent**: Stop a host reading a legitimately arrow-free board as a broken feature.

**Contract**: one line — the first board of a session and any board after a question that awards
nothing (a word cloud) carry no arrows, and that is correct.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- The host page's structural guards still pass (`src/pages/quiz/host.test.ts`), including the
  single-fetching-timer property and the rail rules
- The attendee page's guards still pass (`src/pages/quiz/index.test.ts`), including zero timers
- The client boundary test still passes (`src/lib/client/boundary.test.ts`)

#### Manual Verification:

- On a 1920 projector: arrows are readable from the back of the room, and the leader's arrow is
  legible against the yellow bar.
- Five rows still fit the stage — the fourth column has not pushed the board off screen.
- On a phone: the arrow does not push a long display name into truncation earlier than before.
- The first board of a session shows no arrows and does not look broken.
- The closing screen is pixel-unchanged from before this work.

---

## Testing Strategy

### Unit Tests:

- `src/lib/session/standings.test.ts` — the sign convention, the zero-baseline rule (including the
  whole-room-at-zero case), ties, and the absent-baseline case.
- `src/lib/session/store.test.ts` — the awards read: absent answer, unparseable answer, throwing
  read, empty room, and the no-argument call.
- `src/lib/client/render.test.ts` — glyphs, the empty-but-present span, `data-delta`, and the
  motion signature.

### Integration Tests:

- `src/pages/api/quiz/host/routes.test.ts` — the standings route passes the current question id and
  its refusal behaviour is unchanged.

### Manual Testing Steps:

1. Start a session locally, join from two devices, answer question 1, reveal, show the board —
   expect no arrows (zero baseline).
2. Answer question 2 with the scores deliberately reordered, reveal, show the board — expect arrows
   whose direction and magnitude match the reordering.
3. Show the board twice in a row — expect the arrows to stay identical.
4. Reveal a word-cloud question and show the board — expect no arrows.
5. Close the session — expect the closing screen unchanged.

## Performance Considerations

One extra Redis command per standings beat — an `HMGET` of up to ~150 fields, issued at most once
per host tap (~14 times a session, on the host's device only). It is a second round trip, since the
player ids come from the first. Nothing on a polled path is touched, so the deadline rule in
`src/lib/session/CLAUDE.md` is not in play.

## Migration Notes

`delta` carries `.default(null)`, so a `SessionState` document written before this ships parses
after it. A session running across the deploy shows its next board without arrows and recovers on
the one after — no host action 409s.

## References

- Change identity: `context/changes/standings-rank-delta/change.md`
- The leaderboard's original reasoning: `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`
- The retention guardrail this change deliberately does not touch:
  `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- The deferred reorder motion: `context/changes/quiz-animations-and-transitions/motion-contract.md`
- The shared-rank rule: `src/lib/session/standings.ts:90`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

- [x] 1.1 Unit tests pass: `bun run test` — bdf2833
- [x] 1.2 Type checking passes: `bun run type-check` — bdf2833
- [x] 1.3 Linting passes: `bun run lint` — bdf2833
- [x] 1.4 Sign convention pinned in its own named test — bdf2833
- [x] 1.5 Zero previous total yields `delta: null`, including the whole-room case — bdf2833
- [x] 1.6 Ties produce no phantom movement — bdf2833
- [x] 1.7 Omitting `previousScores` leaves every row at `delta: null` — bdf2833
- [x] 1.8 A row parsed without `delta` still validates — bdf2833

- [x] 2.1 Unit tests pass: `bun run test` — 897fe97
- [x] 2.2 Type checking passes: `bun run type-check` — 897fe97
- [x] 2.3 `readStandings()` with no argument issues no awards read — 897fe97
- [x] 2.4 A player who did not answer shows no movement — 897fe97
- [x] 2.5 A throwing awards read still returns a board, deltas `null` — 897fe97
- [x] 2.6 A throwing players-or-scores read still returns `null` — 897fe97
- [x] 2.7 An empty room issues no `HMGET` — 897fe97
- [x] 2.8 The key registry test still passes — 897fe97
- [x] 2.9 The route passes the current question id — 897fe97

#### Manual

- [ ] 2.10 Arrows match what the scores actually did, locally, across two devices

- [x] 3.1 Unit tests pass: `bun run test`
- [x] 3.2 Linting passes: `bun run lint`
- [x] 3.3 Positive renders `▲N`, negative renders `▼N`
- [x] 3.4 `null` and `0` render an empty but present span
- [x] 3.5 `data-delta` is set for a move and absent otherwise
- [x] 3.6 Motion signature distinguishes boards that differ only by delta
- [x] 3.7 The renderer still never sorts

### Phase 4: The two views

#### Automated

- [ ] 4.1 Unit tests pass: `bun run test`
- [ ] 4.2 Type checking passes: `bun run type-check`
- [ ] 4.3 Linting passes: `bun run lint`
- [ ] 4.4 Host page structural guards still pass
- [ ] 4.5 Attendee page guards still pass
- [ ] 4.6 The client boundary test still passes

#### Manual

- [ ] 4.7 Arrows readable from the back of the room, including on the leader's yellow bar
- [ ] 4.8 Five rows still fit the stage
- [ ] 4.9 A long display name on a phone truncates no earlier than before
- [ ] 4.10 The first board of a session shows no arrows and does not look broken
- [ ] 4.11 The closing screen is unchanged
