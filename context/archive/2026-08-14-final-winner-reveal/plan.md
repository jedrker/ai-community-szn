# Final Winner Reveal Implementation Plan

## Overview

Give the host a closing beat: one confirmed action on the host view that ends the segment **on a
winner screen** rather than on the plain "To już koniec" text the `ended` phase renders today. The
board is the S-07 leaderboard, carried onto the terminal document; the winner is the top row, set at
the largest type on the projector. Every phone shows the same five rows plus its own final position —
including the attendees outside the top five, who currently leave the room knowing only their total.

Roadmap S-10, PRD FR-006 (`nice-to-have`) and US-02. It is the last slice on the roadmap and the one
the roadmap names as the natural cut if effort runs out.

## Current State Analysis

Almost all of the machinery exists. What is missing is the *closing* beat, not a leaderboard.

- **`ended` deliberately clears the board.** `endedSessionState` (`src/lib/session/state.ts:403`)
  nulls `standings` with a comment naming this slice as the one that decides what the ended screen
  shows. The schema clause at `state.ts:332` refuses a board in any phase but `standings`.
- **The per-device close serves a total and nothing else.** `result.ts:102` returns
  `{ total, rank: null }` in `ended`. `leaderboard-contract.md:99` records both this and the ended
  board as inherited by S-10.
- **`end` is off the host view by an explicit F-03 decision** (`host.astro:32`, and
  `docs/runbook-live-session.md:297`). The irreversible verbs live on `/quiz/spine-check` behind
  `LIVEQUIZ_HARNESS`, and the runbook tells the host to close from a terminal with
  `bun run quiz:reset`. FR-006 says the *host* triggers the closing sequence; a terminal window in
  front of a room does not satisfy that in any useful sense, so this slice reverses that decision for
  `end` alone — and must say so in both places that record it.
- **`end` already has the guard that makes the reversal defensible.** It takes a `confirmVersion` the
  caller can only know by having read current state (`end.ts:93`, `host.ts:98`), refuses while a
  question is open, and passes the confirmed version through to `applyHostAction` so the check and the
  write cannot straddle two reads.
- **The host projector needs no render logic.** `host.astro:792` keys the board on
  `standings !== null`, not on the phase — an `ended` document carrying a board renders it as-is. Only
  the winner styling is new.
- **The attendee `ended` branch is the one real restructure.** `index.astro:526` treats `ended` and
  `state === null` (a purge) as one branch: it hides everything, clears `rank` / `rankVersion` /
  `results` / `typed` / `selections` and returns. The board must render there, and the rank must be
  fetched rather than cleared — while the purge half keeps clearing everything.

### Key Discoveries:

- `buildStandings` / `rankOf` (`src/lib/session/standings.ts:90,116`) are shared by the projector and
  the per-device path. That shared call is the only reason a tied attendee's phone cannot contradict
  the big screen — the closing screen must go through them, not around them.
- `readStandings` and `readOwnRank` still work after `end`: `endSession` re-arms the namespace onto
  `ENDED_TTL_SECONDS` rather than deleting it, which is what the ten-minute window is for.
- `LogFields` already carries `rowCount` (`src/lib/session/log.ts:189`) and `session.ended` already
  exists (`log.ts:41`) — the closing log line needs no new field and no new event.
- `OwnResult.rank` already exists on the client type (`src/lib/client/answer.ts:66`), so the phone
  needs no new response shape; only its docstring's "only during the standings phase" is now false.
- No new `livequiz:` key. Rank is derived, the board is derived, so `keys.ts`, `end`, `purge` and
  `scripts/check-purge-residue.ts` need no change at all — the same property S-07 had.
- `fire()` in `host.astro:1070` posts **no body**, only the secret header. `end` needs `version` in a
  form body (`extractHostFields` reads the version only from the form), so the closing button cannot
  reuse `fire` unchanged.

## Desired End State

The host taps **zakończ**, confirms, and the room lands on a closing screen: the winner's name at the
largest type the projector carries, the rest of the top five beneath it, and on every phone the same
five rows with the attendee's own row highlighted and their own final position under it. The session
is ended — every key on the ~10-minute lifetime — and a device reloading inside that window still
finds the same screen.

Verified by: `bun run test`, `bun run type-check`, and a two-device manual run through a full segment
ending on the new button (host laptop + one phone), including the store-failure and reload paths.

## What We're NOT Doing

- **No staged 3 → 2 → 1 sequence and no animation.** One published state, one screen. A client-side
  timed reveal would put 150 phones on their own clocks against the projector in the one moment
  everyone is watching both — the divergence the PRD guardrail is about.
- **No podium shape.** Five rows, `STANDINGS_SIZE` unchanged; the winner is a styling difference, not
  a schema one. No new bound to keep in step with the retention decision.
- **No change to `ENDED_TTL_SECONDS`** and no stripping of `standings` from `GET /api/quiz/state` —
  see the exposure decision below.
- **No new store key, no new log event, no new `SessionState` field, and no new phase.**
- **No removal of `bun run quiz:reset`.** It stays as the recovery path when the host view is
  unreachable.
- **No F-04 harness re-run.** One publish of an existing document shape is not a new fan-out risk;
  S-07 skipped it for the same reason.
- **`purge` stays off the host view.** This slice reverses the F-03 placement for `end` only.

## Implementation Approach

Carry the existing board onto the existing terminal document, and let the existing renderers paint
it. The whole slice is four small server-side edits, two view edits and a button — deliberately, since
this is the roadmap's only nice-to-have and the last thing to land before an event.

Two decisions shape everything below:

**The close must never be blocked.** `reveal.ts` publishes a null payload and completes; the standings
route refuses the transition when the store cannot answer. `end` follows *reveal*, not standings: a
failed board read still ends the session and the room gets today's plain closing screen. Ending is what
moves attendee data onto the ten-minute lifetime, so a host who cannot end because an `HGETALL` blipped
is stuck in front of a room with the retention guardrail unserved. The board is the nice-to-have; the
close is not.

**The exposure is accepted and written down, not mitigated.** Five display names now sit on the `ended`
document for the full `ENDED_TTL_SECONDS`, readable by anyone with the attendee URL through the
deliberately unauthenticated `GET /api/quiz/state`. That is a *longer and differently-bounded* window
than S-07's "as long as the host leaves the board up" — bounded by a TTL rather than by the host's
attention. It is accepted: the same five names went to the same devices minutes earlier during the
standings beat, and the alternatives each break something built on purpose. `lessons.md:101` is
explicitly about amending the documents that state the old guarantee **in the same change**, so
Phase 5 is not optional trimming.

## Critical Implementation Details

**State sequencing in `end.ts`.** The board must be read *inside* the `applyHostAction` transition
closure, as `reveal.ts` and the standings route both do — never beside `playerCount` in
`applyHostAction`. The closure is already allowed to be async (`host.ts:152`). A read placed in the
shared helper attaches a board to every action, including the `advance` that opens the next question.

**The confirmed version must survive the extra read.** `end.ts` already reads state, validates
`confirmVersion`, and passes it through to `applyHostAction`. Adding the board read must not introduce
a second read-then-write across that boundary: the board is read inside the closure, after
`applyHostAction`'s own read and under the same version guard. This is spine-contract rule 3 and the
reason the `expectedVersion` parameter exists.

**The attendee `ended` branch has two callers with opposite needs.** `state === null` (a purge, or an
expired session) must keep clearing `rank`, `rankVersion`, `results`, `typed`, `selections` and the
seen-marks — a stale rank from a purged session can otherwise match a version in the next one. The
`ended` phase must clear the *answer* state but keep and refresh the rank. Splitting them is the whole
of Phase 3's risk.

## Phase 1: The ended document carries the board

### Overview

Make `ended` a phase that can hold a leaderboard, and have the closing action build one. Testable end
to end through `/quiz/spine-check`'s existing `end` button before any host-view work exists.

### Changes Required:

#### 1. The schema clause that confines the board

**File**: `src/lib/session/state.ts`

**Intent**: `standings` may now live in `ended` as well as in `standings`. The clause at line 332
currently refuses it everywhere but its own phase; widen it to a two-phase allowance, and leave the
companion clause ("a `standings` phase requires a board") untouched — `ended` must remain valid
*without* a board, because the failed-read path publishes exactly that.

**Contract**: `state.phase !== "standings" && state.standings !== null` becomes an allowance over
`{ "standings", "ended" }`. The Polish message stays field-naming. Update the `standings` field
docstring: it is no longer set by one constructor, and the reader must be told that the second one
exists and why the "required non-null in its own phase" half still applies only to `standings`.

#### 2. `endedSessionState` takes the board

**File**: `src/lib/session/state.ts`

**Intent**: The terminal constructor stops hard-coding `standings: null` and takes the board it should
carry, which may be `null`. Its docstring currently says S-10 will decide what the ended screen shows —
replace that with the decision.

**Contract**: `endedSessionState(current: SessionState, now: number, standings?: Standings | null)`.
Defaulting to `null` keeps the "clears everything" behaviour for any caller that has nothing to carry,
which is what makes the failed-read path a one-word change at the call site rather than a branch.
`currentQuestionId` still clears — the closing screen is about the session, not the last question.

#### 3. The closing route reads the board

**File**: `src/pages/api/quiz/host/end.ts`

**Intent**: Read the standings inside the transition closure and pass them to `endedSessionState`. A
`null` read is **not** a refusal: log it and end anyway, so the room gets the plain closing screen and
the session still closes.

**Contract**: The `applyHostAction` call's first argument becomes async and calls `readStandings()`.
On success, log `session.ended` with `playerCount` and `rowCount` (both fields already exist); on a
null read, log `session.standings.failed` with a reason naming the close, then proceed. No new event
name, no new `LogFields` member, and nothing that could carry a name or a total.

> **Deviation, as implemented (2026-08-14, recorded in review F3).** The `session.ended` line stayed
> where it already was — `endSession` in `src/lib/session/store.ts:730` — and gained `rowCount` there,
> rather than a second line being emitted from the route. `endSession` was already emitting the event,
> and the runbook tells a host to read the stream by "one line per mutation, one JSON object", which
> two lines per close would break at the moment they are checking the session really closed.
> `playerCount` was dropped from it: that layer holds no fresh count, and `session.action.applied`
> already carries one. `purge`'s terminal write passes through the same function and reports
> `rowCount: 0` by construction, which is correct — it abandons a session rather than landing it.

#### 4. Tests

**Files**: `src/lib/session/state.test.ts`, `src/pages/api/quiz/host/*` route tests

**Intent**: Pin the widened clause in both directions and the failed-read fallback.

**Contract**: An `ended` document *with* a board parses; an `ended` document *without* one still
parses; a board in `lobby` / `question-open` / `question-revealed` still fails, each naming
`standings`. For the route: a failed `readStandings` still produces a 200 with `applied: true` and a
null board. Per `lessons.md:122`, break each guard and watch the specific test fail before moving on —
the widening is one character away from allowing the board everywhere.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- A board in a non-closing phase still fails to parse (assert per-phase, not just one phase)
- The end route ends the session when `readStandings` returns `null`

#### Manual Verification:

- With `LIVEQUIZ_HARNESS` set, `end` from `/quiz/spine-check` puts a board on the host projector
- The projector's board disappears on `purge`, not just on the next session

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: The attendee's final position

### Overview

Close the gap the leaderboard contract handed this slice: a phone in the `ended` phase learns where it
finished, not just what it scored.

### Changes Required:

#### 1. The ended branch of the result route

**File**: `src/pages/api/quiz/result.ts`

**Intent**: The `ended` branch (line 102) gains a `readOwnRank` call, exactly as the `standings` branch
above it does, so the returned `rank` is computed by the same `rankOf` that numbered the published
rows. Every verdict field stays `null` — the question is closed and its result was already served at
the reveal; this branch must not start answering `correct`.

**Contract**: `{ answered: false, correct: null, awarded: null, text: null, value: null, total, rank }`.
The `questionId` the caller sent is ignored here for the reason the standings branch ignores it. A
failed rank read must **not** 503 the way the standings branch does: at the close there is no beat to
retry into and the total is still worth serving, so degrade to `rank: null` and let
`standingsPositionText`'s neutral branch speak. This is a deliberate divergence from the branch above
and needs saying in the docstring.

#### 2. The client type's docstring

**File**: `src/lib/client/answer.ts`

**Intent**: `OwnResult.rank`'s comment says "only during the standings phase". That is now false. No
type change.

**Contract**: Comment only.

#### 3. Tests

**File**: `src/pages/api/quiz/result.test.ts`

**Intent**: Pin the new branch and its failure posture.

**Contract**: `ended` + a healthy scores hash returns a rank and a total with every verdict field null;
`ended` + a failed rank read returns 200 with `rank: null` and the total intact, **not** a 503. Build
the fixture so it can only reach the `ended` branch (`lessons.md:48`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- A failed rank read in `ended` yields 200 with a total and a null rank

#### Manual Verification:

- A phone that placed outside the top five sees its own position after the close
- A device that never joined stays on the join form — no board, no position line, no error

---

## Phase 3: The two closing screens

### Overview

The winner on the projector, and the board plus own position on the phone. The host view needs styling
only; the attendee view needs its `ended` branch split from its purge branch.

### Changes Required:

#### 1. Winner styling on the host projector

**File**: `src/pages/quiz/host.astro`

**Intent**: In `ended`, the first row is the winner and should read as one from the back of the room —
larger than the four rows under it — and the screen should say what it is showing. Nothing about the
board's *logic* changes: `render` already keys it on `standings !== null`, and it must keep doing so
rather than growing a phase test, which would be a second place for the rule to live.

**Contract**: The section heading switches between "Ranking" and a closing label by phase. The winner
emphasis is a first-row style — reachable through the `list` class string with a first-child variant,
needing no new `renderStandings` option; add an option only if that proves insufficient. `questionBox`
already hides whenever a board is present, which is the behaviour the closing screen wants.

#### 2. The attendee closing screen

**File**: `src/pages/quiz/index.astro`

**Intent**: Split the combined `state === null || state.phase === "ended"` branch. The purge/expiry
half keeps today's full reset. The `ended` half clears the *answer* state (seen marks, typed values,
selections, results, the input fields) but renders the board and fetches the final position instead of
clearing `rank` / `rankVersion`.

**Contract**: The board-visibility line at `index.astro:521` moves from a phase test to the same
`standings !== null` rule the host uses, so `ended` shows it without a second condition. The position
fetch reuses `renderStandingsBeat`'s guard shape — capture the version, and on reply check the **live**
snapshot for phase and version (`index.astro:682`, impl review F6) rather than the module-level
`rankVersion`; the phase check is what closes the purge-restart hole, and the closing branch needs it
for the same reason. The closing status line replaces "To już koniec. Dzięki za grę!" with copy naming
the result; the plain line stays as the fallback when there is no board.

#### 3. Tests

**Files**: `src/lib/client/render.test.ts` (if a render option is added), plus the manual rows below

**Intent**: An Astro inline script has no harness, so this phase is verified manually except for
anything that lands in `render.ts`.

**Contract**: Any new `renderStandings` option gets a test whose fixture would fail without it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `bun run test` still passes `boundary.test.ts` — no `<script>` block in `src/pages/quiz/*.astro`
  gained a value import from `src/lib/session/` or `src/quiz/`

#### Manual Verification:

- Projector: the winner is legible from the back of the room and the other four rows are not
- Phone: own row highlighted, own position under the board, both agreeing with the projector
- A phone reloaded after the close still shows the board and the position (inside the ~10 min window)
- A purge mid-session still returns the phone to the plain closing screen with nothing stale on it
- Ending after a `standings` beat (not just after a reveal) shows the closing screen, not the old board

---

## Phase 4: The host's closing button

### Overview

The reversal of the F-03 placement, and the only genuinely new interaction in the slice: an
irreversible verb on a screen driven from a stage, guarded by a confirmation rather than by absence.

### Changes Required:

#### 1. The button

**File**: `src/pages/quiz/host.astro`

**Intent**: A "zakończ" button placed and styled apart from the four flow verbs, so a mis-reach lands
on a flow verb rather than on this one. It requires two taps: the first arms it and changes its label
to a confirming one, the second fires. Disarm on any snapshot that moves the session, so a stale armed
button cannot fire into a state the host has not looked at.

**Contract**: Disabled in `lobby` (nothing to close), in `question-open` (the route refuses it anyway —
this is the interaction, the 409 is the backstop) and in `ended` (already closed). Enabled in
`question-revealed` and `standings`.

#### 2. The request

**File**: `src/pages/quiz/host.astro`

**Intent**: `fire()` sends only the secret header and no body, but `end` reads `version` from the form
body. The closing action therefore needs its own send path that posts a `FormData` carrying the version
from the snapshot the host is looking at — which is exactly the confirmation the route is asking for.

**Contract**: `POST /api/quiz/host/end` with the secret header and a `version` form field taken from
`client.current()?.version`. Reuse `fire`'s outcome vocabulary — 401, 502-committed-but-unbroadcast,
`applied: false`, plain error — rather than a second set of messages that could disagree with it; the
version-mismatch 409 already returns its own Polish text and must be surfaced verbatim, since the fix
is "refresh and look again", not "retry".

**Note**: `fire`'s `finally` re-enables **every** button unconditionally, which is why
`syncStandingsButton` is called after it (`host.astro:1126`). The closing button's phase rule and its
disarmed state need the same treatment or a blanket re-enable will leave it armed and enabled in a
phase that refuses it.

#### 3. The structural scan

**File**: `src/pages/quiz/host.test.ts`

**Intent**: The confirmation is the guard that stops a mis-click ending a live session, and the inline
script has no harness. Scan for the *property*, not the current shape (`lessons.md:144`).

**Contract**: Assert that the end request carries a version field and that no code path reaches
`/api/quiz/host/end` without passing through the arming step; assert the page still contains no
`purge` call site. Add the new function names to the "the scan can see the code it is checking"
non-vacuity block. Verify every assertion in both directions — passing on correct code and failing on
broken code — before the phase is called done.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `host.test.ts` still finds exactly one poll timer, one in-flight flag and one polled fetch site —
  the new action must not have added a second of any of them
- Each new scan assertion fails when the guard it names is removed

#### Manual Verification:

- A single tap on "zakończ" does not end the session
- A second tap ends it and the room lands on the closing screen
- Arming, then letting another action land, disarms it
- Ending with a stale version surfaces the route's own Polish confirmation-mismatch message
- The button is disabled while a question is open, and the route's 409 is never reached by tapping

---

## Phase 5: Contract, runbook, PRD

### Overview

The documents that state the old guarantee, amended in the same change as the behaviour — the rule
`lessons.md:101` exists to enforce.

### Changes Required:

#### 1. The slice contract

**File**: `context/changes/final-winner-reveal/winner-reveal-contract.md`

**Intent**: The fifth contract, and it inherits the warning the previous four carry: a pointer, not a
summary. A contract that grows past a page has become a second copy of the plan.

**Contract**: Names, at minimum — the ended-phase board and its `ENDED_TTL_SECONDS` window as a third
retention deviation with its bound (≤ 5 names, ≤ the TTL); the "end never refuses over a board read"
rule and why it differs from the standings route; the `ended` branch of `result.ts` degrading to a null
rank instead of a 503; and the F-03 reversal for `end` alone, with `purge` still off the host view.

#### 2. The runbook

**File**: `docs/runbook-live-session.md`

**Intent**: Two sections are now false. Line ~297 says `end` and `purge` are not on the host view and
that closing is done from a terminal; the "After the session" section describes the close as a terminal
step. The log-event table needs the closing line's new `rowCount`.

**Contract**: The closing beat becomes an on-stage step with its two-tap confirmation described; the
terminal path is kept as the fallback for an unreachable host view; a row states that a closing screen
with no board means the store did not answer and the session still ended correctly.

#### 3. The PRD retention guardrail

**File**: `context/foundation/prd.md`

**Intent**: The Deviation 2 block is a chain of dated amendments, each quoting rather than rewriting
its predecessor. Add an S-10 amendment in that style.

**Contract**: State that the same ≤ 5 names now also ride the terminal document for
`ENDED_TTL_SECONDS`, that the binding surface is again `GET /api/quiz/state`, that the window is now
bounded by a TTL rather than by the host's attention, and that this was accepted rather than mitigated
— with the rejected alternatives (shorten the TTL; strip the field from the state route) and why each
breaks something built on purpose.

#### 4. The roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Mark S-10 delivered in the same shape the nine slices before it use — the status table, the
backlog-handoff row, and a Delivered entry recording what was built and what was learned.

**Contract**: Prose only.

#### 5. The agent instructions

**File**: `CLAUDE.md`

> **Added after the fact (2026-08-14, recorded in review F4, and now a `lessons.md` rule).** This entry
> was missing from the plan and the edit happened anyway, because Phase 1 made two of its statements
> false. It is written in rather than left out, so the plan matches what shipped.

**Intent**: Phase 1 falsifies two claims: that each transition field "is set by exactly one
constructor" (`standings` now has two), and the retention paragraph, which describes a window bounded
by the host's attention. Both must be amended in the same change that breaks them (`lessons.md`).

**Contract**: Correct both statements, quoting the overturned position rather than deleting it — the
convention the PRD's Deviation 2 chain and `state.ts` already follow — and add the `BOARD_PHASES`
asymmetry (permitted in two phases, required in one) as a rule of its own, pointing at the contract.

### Success Criteria:

#### Automated Verification:

- `bun run test` and `bun run type-check` still pass (no code touched, but the quiz gate runs on both)

#### Manual Verification:

- The runbook's closing section, read cold, describes the button that now exists
- The PRD's Deviation 2 chain reads as a sequence of amendments, not a rewrite
- The contract fits on a page

---

## Testing Strategy

### Unit Tests:

- `state.test.ts`: the widened clause, per phase, in both directions; `ended` valid with and without a
  board; `endedSessionState` carrying and clearing
- `end.ts` route test: the board reaches the published document; a failed read still ends the session
- `result.test.ts`: the `ended` branch's rank, and its degrade-to-null-rank posture on a failed read
- `host.test.ts`: the confirmation guard and the unchanged one-loop properties

### Integration Tests:

None beyond the route tests — there is no integration harness in this project, and the redis client is
mocked throughout the suite. That limit is real and is why the manual rows below carry the slice.

### Manual Testing Steps:

1. Run a short segment on two devices (host laptop + one phone) through to the new button.
2. Confirm the winner is legible from across a room on the projector.
3. Confirm the phone's own position matches the projector for a tied pair, if one can be produced.
4. Reload the phone after the close; confirm the screen survives inside the ten-minute window.
5. Tap "zakończ" once and walk away; confirm nothing ends.
6. End with a deliberately stale version (two tabs) and confirm the mismatch message.
7. Purge after a close and confirm every screen returns to nothing stale.

## Performance Considerations

Per close: two extra commands for the board read (`readStandings` is two `HGETALL`s through
`Promise.all`), plus one per device that fetches its final rank — the same shape and the same order of
magnitude as one S-07 standings beat, and it happens once. Against the unexplained command baseline
recorded in `command-counter-diagnostic.md` this is noise, which is an assumption inherited knowingly
rather than a measurement.

One publish, unchanged in shape from every other host action. No new fan-out.

## Migration Notes

No store key changes, so no migration and nothing for `check-purge-residue.ts`. A session document
written before this deploy still parses — the schema widens an allowance rather than adding a required
field, and `standings` already carries `.default(null)`. A session **running** across the deploy is
therefore safe, which is the property every prior slice bought with `.default(null)` and this one gets
for free.

## References

- Roadmap: `context/foundation/roadmap.md` (S-10, line 531)
- PRD: FR-006, US-02, and the retention guardrail's Deviation 2 chain
- `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md` — the board this slice carries,
  and the scope boundary that hands it the ended-phase board and the `ended` rank
- `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` — read before adding
  anything to a published snapshot
- `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md` — why the closing screen is
  one published state and not a continuously-updating display
- `context/archive/2026-08-14-resilient-join/resume-contract.md` — read before adding anything that
  refuses a request
- `context/foundation/lessons.md` — entries at lines 101 (amend the documents), 122 (break the guard),
  144 (scan the property, not the shape)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The ended document carries the board

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — 7955bd2
- [x] 1.2 Type checking passes: `bun run type-check` — 7955bd2
- [x] 1.3 A board in a non-closing phase still fails to parse — 7955bd2
- [x] 1.4 The end route ends the session when `readStandings` returns `null` — 7955bd2

#### Manual

- [x] 1.5 `end` from `/quiz/spine-check` puts a board on the host projector — 7955bd2
- [x] 1.6 The projector's board disappears on `purge` — 7955bd2

### Phase 2: The attendee's final position

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 404f7c3
- [x] 2.2 Type checking passes: `bun run type-check` — 404f7c3
- [x] 2.3 A failed rank read in `ended` yields 200 with a total and a null rank — 404f7c3

#### Manual

- [x] 2.4 A phone outside the top five sees its own position after the close — 72facda
- [x] 2.5 A device that never joined stays on the join form, not an error — 72facda

### Phase 3: The two closing screens

#### Automated

- [x] 3.1 Unit tests pass: `bun run test` — fc966b2
- [x] 3.2 Type checking passes: `bun run type-check` — fc966b2
- [x] 3.3 `boundary.test.ts` still passes — fc966b2

#### Manual

- [x] 3.4 Projector: the winner is legible from the back of the room — 72facda
- [x] 3.5 Phone: own row highlighted and own position agreeing with the projector — 72facda
- [x] 3.6 A reloaded phone still shows the board and the position — 72facda
- [x] 3.7 A purge mid-session returns the phone to the plain closing screen — 72facda
- [x] 3.8 Ending after a `standings` beat shows the closing screen, not the old board — 72facda

### Phase 4: The host's closing button

#### Automated

- [x] 4.1 Unit tests pass: `bun run test` — 72facda
- [x] 4.2 Type checking passes: `bun run type-check` — 72facda
- [x] 4.3 `host.test.ts` still finds one poll timer, one in-flight flag and one polled fetch site — 72facda
- [x] 4.4 Each new scan assertion fails when the guard it names is removed — 72facda

#### Manual

- [x] 4.5 A single tap does not end the session — 72facda
- [x] 4.6 A second tap ends it and the room lands on the closing screen — 72facda
- [x] 4.7 Another action landing disarms the armed button — 72facda
- [x] 4.8 A stale version surfaces the route's confirmation-mismatch message — 72facda
- [x] 4.9 The button is disabled while a question is open — 72facda

### Phase 5: Contract, runbook, PRD

#### Automated

- [x] 5.1 `bun run test` and `bun run type-check` still pass — 6ff675a

#### Manual

- [x] 5.2 The runbook's closing section describes the button that now exists — 6ff675a
- [x] 5.3 The PRD's Deviation 2 chain reads as a sequence of amendments — 6ff675a
- [x] 5.4 The contract fits on a page — 6ff675a
