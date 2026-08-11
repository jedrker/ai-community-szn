# Leaderboard beat (S-07) Implementation Plan

## Overview

Give the host a controllable beat between questions that puts the standings on the large screen, and
give every attendee a way to locate themselves on the same standings. The board is computed
server-side once per beat and published on the session snapshot as a **top 5**; each device fetches
its own rank through the route that already serves its own result.

This is roadmap slice **S-07 `leaderboard-beat`** (PRD FR-014, US-01, US-02). It also takes the
decision S-02 deliberately parked here: **display names now enter a published snapshot**, bounded to
five, and the reversal is recorded rather than absorbed.

## Current State Analysis

Everything the ranking needs is already in the store, in two hashes, and no new key is required:

- `livequiz:scores` — opaque player id → running total, an integer written only by `HINCRBY`
  (`keys.ts:161`). `keys.ts` states outright that S-07 is the slice that needs the join back to a
  name.
- `livequiz:players` — folded display name → `{ id, displayName, joinedAt }` (`keys.ts:130`). The
  record carries its own `id`, so the join is `scores[record.id]` and the reverse index
  (`livequiz:player-ids`) is not needed here.

What does not exist:

- No phase in which a board is the thing on screen. `SESSION_PHASES` is `lobby`, `question-open`,
  `question-revealed`, `ended` (`state.ts:27`).
- No host verb beyond `start`, `advance`, `reveal`, `end`, `purge`.
- No store read that returns more than one player's data. Every existing read is either an aggregate
  (`readPlayerCount`, `readAnsweredCount`, `readQuestionTallies`) or scoped to the calling device
  (`readOwnResult`, `readPlayerById`).

Constraints discovered that shape the work:

- **`SessionState` has a two-family field taxonomy and the docstrings warn at length about mixing
  them.** `playerCount` is decoration, injected once in `applyHostAction:248` for every action.
  `revealedOptionIds` / `revealedDistribution` / `revealedAnswerText` are transition payloads: set by
  `reveal.ts` alone, nulled by every other constructor, each with its own `superRefine` clause so a
  violation names the field. A standings payload is unambiguously the second family.
- **Every new snapshot field needs `.default(null)`** or a session document written before the deploy
  fails `parseSessionState` and 409s the host's next action mid-segment (`state.ts:105`).
- **`AnswerRecord.correct` is exact-hit-only for number questions** — `false` on an answer that scored
  800 of 1000 (CLAUDE.md; `result.ts:148`). Ranking reads the scores hash and never that flag.
- **`result.ts:29` already anticipates this slice**: "S-07's leaderboard inherits this gate and this
  exception rather than rediscovering them."
- **Ably retains a published snapshot ~120 s irreducibly** (measured, `ably-retention-probe.md`) and
  `GET /api/quiz/token` is deliberately open. Publishing names re-opens that window for the five names
  on the board.
- **`/api/quiz/state` returns the whole document** (`state.ts:98`), so the connection-limit fallback
  loop in `src/lib/client/session.ts` carries the board to degraded devices with no second path.

## Desired End State

The host, from `/quiz/host`, taps **Pokaż ranking** after revealing a question. The projector switches
to a five-row board — position, name, points. Every attendee's phone shows the same five rows in the
same order, with their own row highlighted if they are on it, and a line below it reading their own
position and total whether they are on it or not. The host taps **Następne pytanie** and the segment
continues.

Verify by: running a session with three or more devices, revealing a question, showing the standings,
and confirming the five rows and their order are byte-identical on the host screen and on each phone,
that a device outside the top five sees a correct personal position, and that advancing from the
standings opens the *next* question rather than question 1.

### Key Discoveries:

- **A questionless standings phase would reopen the quiz.** `advance.ts:30` documents that an ended
  session has `currentQuestionId: null` "exactly like the lobby — so without this guard
  `nextQuestionId(null)` would return question 1 and advance would REOPEN a quiz the host had closed".
  A standings phase added to `QUESTIONLESS_PHASES` inherits that same bug. Keeping
  `currentQuestionId` on the standings state removes it structurally and leaves `advance.ts`
  unmodified.
- **Row order and rank number must be computed differently, or a tied attendee's phone contradicts the
  projector.** Order needs a total order to be deterministic across devices; the rank *number* must be
  derivable from score alone, because the per-device fetch has only the scores hash. Competition
  ranking (ties share a number) satisfies both: the board renders rows in total order but labels them
  1, 2, 2, 4, 5, and the device's own computation lands on the same number.
- **`localStorage` holds the server-returned `displayName` verbatim** (`player.ts:81`, written from
  `join.ts:155`), so a client can highlight its own row by exact string equality without folding —
  which matters because `normalizePolish` lives in `src/quiz/` and a value import from there into a
  client module is refused by `boundary.test.ts`.
- **`reveal.ts` would silently re-reveal from a standings phase.** Its guards cover `lobby`, `ended`
  and `question-revealed`; a standings state carrying a `currentQuestionId` falls through and builds a
  valid `question-revealed` state. It needs an explicit branch.
- Option order is shuffled by `publicQuiz` (`join-contract.md`) — irrelevant here, since the board
  renders no options. Noted so it is not re-derived.

## What We're NOT Doing

- **The final winner reveal and any board in the `ended` phase.** That is S-10 `final-winner-reveal`,
  which names this slice as its prerequisite. `result.ts`'s existing `ended` branch (total alone, no
  verdict) is left exactly as it is.
- **Animation, count-ups, and rank-change indicators.** Hand-written DOM with no diffing is the
  accepted cost of the no-framework decision (`join-contract.md`); an animated reordering list is
  where that cost bites hardest.
- **A room-scale rehearsal re-run.** The beat adds one publish and at most one fetch per device, on a
  phase where nothing else is in flight — strictly lighter than a reveal, which F-04 already measured.
- **A host-only preview before showing the board.** The PRD accepts unmoderated content on the
  projector by explicit decision (§Non-Goals); a preview reopens a settled non-goal.
- **Name moderation, a blocklist, or any change to `validateDisplayName`.**
- **Any new store key.** Rank is derived, not stored.
- **Throttling `/api/quiz/result`.** Unchanged from S-03's accepted position.

## Implementation Approach

The board is computed **once, server-side, at the host action** and published on the snapshot. That is
what makes the PRD's no-divergence guardrail hold by construction rather than by agreement: every
device renders the same bytes, and no device sorts anything.

The personal rank travels the other way — per device, through `/api/quiz/result`, which already has
the phase gate, the `no-store` headers and the client fetch path. It returns only the calling device's
own numbers.

Splitting it this way follows the split S-03 already established and `result.ts:9` documents: quiz-ish
content that the whole room may see rides the broadcast; per-player data is fetched by the player.
The difference this slice introduces — and the reason it needs a recorded decision — is that five
display names are now in the first category.

## Critical Implementation Details

**State sequencing.** The standings phase must be entered *only* from `question-revealed`, and must
keep `currentQuestionId`. Adding it to `QUESTIONLESS_PHASES` would reintroduce the `advance.ts:30`
defect in a new place; the schema clause that "a non-questionless phase requires a question" is what
makes the retention of `currentQuestionId` enforced rather than conventional.

**Timing & lifecycle.** The host action reads two hashes *outside* the version guard, exactly as
`reveal.ts` reads tallies outside it. The accepted race is the same and smaller: an answer cannot land
during a standings transition, because the previous question is already closed. Do not move either
read into `COMPARE_AND_SET` — `store.test.ts` asserts that stays a single `EVAL`.

**User experience spec.** The board is legible from the back of a venue room: five rows, and
`MAX_DISPLAY_NAME_LENGTH` is 24 precisely because that is what fits a projected line (`players.ts:17`).
A name must truncate with an ellipsis rather than wrap, or five rows become seven and the layout the
bound was chosen for stops holding.

**Debug & observability.** `logSessionEvent`'s `LogFields` is a closed type and **must not** gain a
display name or a name-bearing field — that closure is the enforcement, not a comment beside one
(CLAUDE.md). Log the standings action with the rank count only.

---

## Phase 1: Domain core — the phase, the payload, and the ordering

### Overview

Everything that can be decided without a store or a network: the pure ranking module, the new phase,
the snapshot field and its invariants, and the guard that stops `reveal` acting from standings.

### Changes Required:

#### 1. The pure ranking module

**File**: `src/lib/session/standings.ts` (new)

**Intent**: Turn "every player, and every score" into the ordered, ranked board that gets published.
Pure — no store access, no `import.meta.env` — so the ordering rules are unit-testable on their own,
mirroring how `players.ts` holds the pure half of joining and `scoring.ts` the pure half of awarding.

**Contract**: Exports `STANDINGS_SIZE = 5`; a `StandingsRow` type of `{ rank, displayName, points }`
(deliberately **no `playerId`** — see the module note below); a `Standings` type of
`{ rows: StandingsRow[]; playerCount: number }`; `buildStandings(players, scores)` returning the top
`STANDINGS_SIZE` rows; and `rankOf(total, scores)` returning the competition rank of a total.

Two rules the module owns, and the reason they differ:

- **Order** is the total order `points desc, joinedAt asc, id asc`. It must be total, because a
  partial order leaves ties to the input's iteration order and two devices could then disagree — the
  divergence the PRD guardrail forbids. In practice no device sorts, since the board is published
  pre-sorted; the total order is what makes the *server's* output reproducible.
- **Rank** is a competition rank: `1 + (number of players with a strictly greater total)`, so ties
  share a number (1, 2, 2, 4, 5). It must be computable from totals alone, because `rankOf` is what
  the per-device path calls and that path has only the scores hash. Ranking by position in the sorted
  array instead would give a tied second-place attendee "2" on the projector and "1" on their own
  phone.

A player present in `players` with no entry in `scores` counts as zero and is included — the chosen
behaviour, and it makes the board's denominator equal the `playerCount` already on screen.

`STANDINGS_SIZE` lives here rather than in a view because both views and the host route read it.

#### 2. The `standings` phase

**File**: `src/lib/session/state.ts`

**Intent**: Add `standings` to `SESSION_PHASES`, between `question-revealed` and `ended`, so a device
can tell "the board is up" from "a question is revealed" without inspecting a payload.

**Contract**: `standings` is **not** added to `QUESTIONLESS_PHASES` — it requires a
`currentQuestionId`, which the existing clause at `state.ts:207` then enforces. Add a docstring on the
phase stating why: a questionless standings phase makes `nextQuestionId(null)` return question 1, so
`advance` would reopen the quiz — the same defect `advance.ts:30` guards `ended` against.

Verify no code indexes `SESSION_PHASES` positionally before inserting mid-array (a grep at the time of
writing found no importer outside `state.ts`).

#### 3. The standings payload field

**File**: `src/lib/session/state.ts`

**Intent**: Carry the published board on the snapshot, as a transition payload in the same family as
`revealedOptionIds` — set by one constructor, nulled by every other.

**Contract**: `standings: z.object({ rows: [...], playerCount: number }).nullable().default(null)`.
`.default(null)` is load-bearing for the reason the three existing fields document: a document written
before this ships must still parse, or the host's next action 409s mid-segment.

Two `superRefine` clauses, each its own so the failure names the field:

- `phase !== "standings"` requires `standings === null` — the clause that makes "set only by the
  standings route" true. Without it a stale board rides the next question's snapshot.
- `phase === "standings"` requires `standings !== null` — the board *is* the content of this phase, so
  a null one is a blank projector. This is the schema half of the chosen "refuse the transition on a
  failed read" behaviour; the route half is Phase 2.

Note in the docstring that this is the **first snapshot field to carry attendee display names**, that
it is bounded to `STANDINGS_SIZE`, and that `leaderboard-contract.md` (Phase 5) records why.

#### 4. The three existing constructors null the new field

**Files**: `src/lib/session/state.ts` (`initialSessionState`, `endedSessionState`),
`src/pages/api/quiz/host/advance.ts`, `src/pages/api/quiz/host/reveal.ts`

**Intent**: Write `standings: null` explicitly in every state literal, following the convention those
files already state — "written explicitly anyway, because a reader scanning the transitions should see
all the fields in each of them" (`advance.ts:55`).

**Contract**: Type-driven; omitting it fails `astro check`. The explicitness is a convention, not a
correctness requirement, and matching it is the point.

#### 5. `reveal` refuses to act from standings

**File**: `src/pages/api/quiz/host/reveal.ts`

**Intent**: Without a branch, a standings state carrying a `currentQuestionId` falls through
`reveal.ts`'s existing guards and builds a valid `question-revealed` state — silently re-revealing a
question the room has moved past.

**Contract**: Return `null` from `nextFrom` for `phase === "standings"`, and map it to a 409 with a
Polish message beside the existing `lobby` and `ended` messages. `advance` is deliberately **not**
touched — from standings it reads a real `currentQuestionId` and opens the next question, which is the
whole reason the phase keeps one.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `standings.test.ts` covers: descending order; the `joinedAt` then `id` tiebreak with a fixture whose
  players genuinely tie (per `lessons.md`, "prove the fixture reaches the branch the test names" —
  assert something only the tie branch produces); competition ranks sharing a number across a tie;
  zero-score players included and ranked last; a room smaller than `STANDINGS_SIZE`; an empty room.
- `state.test.ts` asserts a `standings` phase with a null payload is rejected, a non-standings phase
  with a non-null payload is rejected, and a document written without the field parses to `null`.
- `state.test.ts` asserts a `standings` phase with `currentQuestionId: null` is rejected.
- A test asserts `reveal` from a standings state is a no-op and does not produce a
  `question-revealed` state.

#### Manual Verification:

- None for this phase — nothing user-visible ships until Phase 3.

**Implementation Note**: Phase blocks use plain bullets; the checkboxes live in `## Progress`.

---

## Phase 2: Store reads, the host verb, and the personal rank

### Overview

The two reads, the route that publishes the board, and the third branch in `result.ts`.

### Changes Required:

#### 1. The board read

**File**: `src/lib/session/store.ts`

**Intent**: Read both hashes and hand them to `buildStandings`.

**Contract**: `readStandings(): Promise<Standings | null>` — two `HGETALL`s issued through
`Promise.all` (one round trip, two billed commands) and joined on the player record's own `id`.
Deliberately **not** one `EVAL`: Upstash bills the `EVAL` *and* every call inside it, so a script would
make it three, the arithmetic `participation.ts:100` already documents for exactly this trade.

Returns `null` on any failure — "the store could not say", never an empty board, following
`readPlayerCount`'s posture and for a sharper version of its reason: an empty board on a projector
claims nobody scored.

A player record that fails `parsePlayerRecord` is skipped rather than failing the whole read; one
corrupt row must not cost the room its leaderboard.

#### 2. The personal rank read

**File**: `src/lib/session/store.ts`

**Intent**: Give one device its own position without giving it anybody else's name.

**Contract**: `readOwnRank(playerId): Promise<{ rank: number; total: number } | null>` — one `HGETALL`
of the scores hash, with `rankOf` applied in TypeScript.

One billed command, and the payload from Redis to the function is ~150 small integers in the same
region. A `livequiz:standings` rank map written at the host action was the alternative — one `HGET`
per device instead of one `HGETALL` — and was rejected because it adds an attendee-data key, a purge
surface and a second thing that can disagree with the published board, to derive a number that is
already derivable.

A player id absent from the hash is total `0` and the rank that follows from it, not an error — the
same reading `readOwnResult` already takes of a missing total.

#### 3. The host verb

**File**: `src/pages/api/quiz/host/standings.ts` (new)

**Intent**: The FR-014 beat: compute the board and publish it.

**Contract**: `POST`, secret-gated via `extractSecret` / `authorizeHost` / `toResponse`, driving
`applyHostAction` with an async `nextFrom` — the signature `reveal.ts` already widened it to
(`host.ts:144`).

- From any phase but `question-revealed`, return `null`; the route maps `lobby`, `question-open` and
  `ended` to a 409 with its own Polish message, as `reveal.ts` does. Standings is reachable only from a
  reveal — it is the between-questions beat, and showing it mid-question would put a board on screen
  while the room is still answering.
- Called from `standings`, it is a no-op rather than an error, matching `reveal.ts`'s treatment of a
  re-reveal.
- **A `null` from `readStandings` refuses the transition** — a 503 with a Polish message, the room left
  on the reveal it was already showing. This is the one place this slice deliberately departs from
  `reveal.ts`, which publishes a `null` distribution and completes: there, the answer key is still on
  screen and only a bar chart is missing; here the board *is* the phase, so completing would put a
  blank screen in front of the room with nothing for the host to say about it. The schema clause from
  Phase 1 makes the departure structural rather than conventional.
- Builds the state literal directly, carrying `currentQuestionId` and `playerCount` (overwritten by
  `applyHostAction`) and nulling all three reveal fields.
- `logSessionEvent` with the row count only. **No display name and no name-bearing field** —
  `LogFields` is closed and must stay closed.

#### 4. The third branch in `result.ts`

**File**: `src/pages/api/quiz/result.ts`

**Intent**: Serve a device its own rank during the standings phase, through the gate that already
exists.

**Contract**: A branch beside the `ended` exception, taken when `state.phase === "standings"`, calling
`readOwnRank` and returning `{ answered: false, correct: null, awarded: null, text: null, value: null,
total, rank }`. Every verdict field stays null: the question is closed and the board is not about it.

The route keeps requiring a non-empty `questionId` — the client has one and sends it — but this branch
**ignores it**, because a rank is not about a question. State that in the docstring, and extend the
docstring's existing "S-07 inherits this gate and this exception" note to say what S-07 in fact did
with it.

`rank` is added to the response for the other branches too, as `null`, so the client has one shape to
parse rather than two.

#### 5. Client-side result type

**File**: `src/lib/client/answer.ts`

**Intent**: Carry `rank` through the existing `OwnResult` type and `fetchResult`.

**Contract**: `rank: number | null` on `OwnResult`. `fetchResult` is otherwise unchanged; the standings
call reuses it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `store.test.ts` (against the existing module-level `@upstash/redis` mock) asserts: `readStandings`
  joins scores to names by record id; it returns `null` on a throw and never an empty board; it skips
  an unparseable record; `readOwnRank` returns rank and total for a known id, and zero-and-last for an
  unknown one.
- `store.test.ts` asserts `readStandings` issues exactly two commands and no `eval`.
- A route test asserts `POST /api/quiz/host/standings` requires the secret, 409s from `lobby`,
  `question-open` and `ended`, is a no-op from `standings`, and 503s without transitioning when the
  read fails.
- `routes.test.ts` (or its equivalent) picks up the new route under whatever check it applies to the
  host route family.
- A `result.test.ts` case asserts the standings branch returns rank and total with every verdict field
  null, and that it does so for a `questionId` that is not the current one.
- `keys.test.ts` still passes — this slice adds no namespaced literal.

#### Manual Verification:

- None for this phase — nothing user-visible ships until Phase 3.

---

## Phase 3: The host view

### Overview

The control that triggers the beat, and the board on the large screen.

### Changes Required:

#### 1. The control

**File**: `src/pages/quiz/host.astro`

**Intent**: A **Pokaż ranking** button beside the existing flow controls, posting to the new route.

**Contract**: Follows whatever the existing host controls do for the secret, the in-flight state and
the error line — this view already has one pattern for all four verbs and the fifth joins it rather
than inventing a shape. Enabled only in `question-revealed`, disabled elsewhere, so the 409s from
Phase 2 are the backstop rather than the interaction.

#### 2. The projector board

**File**: `src/pages/quiz/host.astro`

**Intent**: Render the five published rows at a size legible from the back of the room.

**Contract**: A section shown when `phase === "standings"` and hidden otherwise, rendering
`state.standings.rows` in the order received — **no client-side sort**, which is the whole mechanism
behind the no-divergence guardrail. Each row is position, name, points.

Names truncate with an ellipsis rather than wrapping (`players.ts:17` sizes `MAX_DISPLAY_NAME_LENGTH`
for a projected line; a wrap turns five rows into seven and breaks the layout that bound was chosen
for). The question panel and the participation counter hide in this phase.

The `<script>` block is subject to `boundary.test.ts` like any client module: `import type` only from
`src/lib/session/`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — no value import from `src/lib/session/` or `src/quiz/` and no
  `import.meta.env` read in the page's `<script>` blocks.
- Unit tests pass: `bun run test`

#### Manual Verification:

- With a session running and at least three players holding different scores, revealing a question and
  tapping **Pokaż ranking** puts a five-row board on the host screen.
- The board is legible at projector distance, and a 24-character name does not wrap.
- **Pokaż ranking** is refused (or disabled) from the lobby, from an open question, and after the
  session has ended.
- Tapping **Następne pytanie** from the board opens the **next** question — not question 1. This is the
  `advance.ts:30` trap; verify it on a real session, not only in a test.

**Implementation Note**: Pause here for manual confirmation before starting Phase 4.

---

## Phase 4: The attendee view

### Overview

The same five rows on 150 phones, plus the line that tells an attendee where they actually are.

### Changes Required:

#### 1. The board renderer

**File**: `src/lib/client/render.ts`

**Intent**: A `renderStandings` beside the existing `renderQuestion` and `renderDistribution`, so DOM
construction stays in the module the render tests already cover.

**Contract**: Takes the published rows, a class-name bag in the shape the two existing renderers use,
and the device's own `displayName` for highlighting. `StandingsRow` arrives as an `import type` from
`src/lib/session/standings` — erased at compile time and therefore allowed by `boundary.test.ts`,
which is how `SessionState` and `PublicQuestion` already reach these modules.

Renders rows in the given order and never sorts.

#### 2. The standings branch in the attendee view

**File**: `src/pages/quiz/index.astro`

**Intent**: Show the board and the personal line when the phase is `standings`, hiding the question,
the answer controls and the result panel.

**Contract**: A branch beside the existing `lobby`, `question-open`, `question-revealed` and `ended`
handling. The device's own row is highlighted by **exact string equality** against the `displayName` in
`localStorage` — which is the server-returned name written verbatim at `player.ts:81`, so no folding is
needed and none is possible from a client module anyway.

On entering the phase, the view calls `fetchResult` once and renders "Twoja pozycja: N z M" from the
returned `rank` and the snapshot's `playerCount`. A failed fetch shows the board and a neutral line —
never a zero or a guessed position, per the project's standing rule that an absent value must not
become a favourable or authoritative-looking one (`lessons.md`).

A device that has not joined (no stored player) sees the board and no personal line.

#### 3. Degraded devices

**File**: none — verification only

**Intent**: Confirm the fallback polling loop needs no change.

**Contract**: `/api/quiz/state` returns the whole document including `standings`, so a device on the
polling fallback renders the board on its next tick. The personal-rank fetch is an ordinary `POST` and
is unaffected by the Ably channel being down. Confirm rather than assume, and add a `session.test.ts`
case if the loop turns out to filter fields.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes for `render.ts` and for `index.astro`'s `<script>` blocks.
- `render.test.ts` (happy-dom) asserts: rows render in the given order; the own-row highlight matches
  on exact name equality and does **not** match a differently-cased name; a board shorter than five
  rows renders without padding.
- A test asserts a failed rank fetch renders neither a rank of 0 nor a rank of 1.

#### Manual Verification:

- With three or more devices, the five rows and their order are identical on every phone and on the
  host screen.
- A device in the top five sees its own row highlighted **and** a personal line agreeing with that
  row's position — including when it is tied with another player.
- A device outside the top five sees a correct personal position.
- A device that reloads during the standings phase comes back to the same board and the same position.
- A device that never answered anything sees a position and a total of 0, not an error.

**Implementation Note**: Pause here for manual confirmation before starting Phase 5.

---

## Phase 5: Contracts and record-keeping

### Overview

Record the retention reversal where the people checking the guardrail will look, and leave S-08 and
S-10 a pointer rather than a reconstruction.

### Changes Required:

#### 1. The PRD deviation

**File**: `context/foundation/prd.md`

**Intent**: Amend Deviation 2 under the retention guardrail. S-02's own correction there — which
quotes the superseded sentence rather than rewriting it — is the format to follow, because the value
of the entry is that the expectation and its reversal both stay visible.

**Contract**: A dated `**Amended 2026-08-11 (S-07).**` paragraph stating that display names now enter a
published snapshot, bounded to five, that the ~2-minute window applies to those five names, why the
alternative was rejected (150 per-device fetches per beat against an unexplained command baseline), and
that nothing else about who played reaches the wire. Do not edit S-02's correction — it remains true
about S-02.

#### 2. The risk register

**File**: `context/foundation/infrastructure.md`

**Intent**: The Ably-retention row currently reads "the remedy is S-02's to take: publish opaque player
ids and keep names off the channel". That is now counterfactual.

**Contract**: Update that row's mitigation to state what S-07 decided and what the bound is. Leave the
tripwire (`bun scripts/probe-ably-retention.ts --expect-ephemeral`) unchanged — it matters more now,
not less.

#### 3. The slice contract

**File**: `context/changes/leaderboard-beat/leaderboard-contract.md` (new)

**Intent**: The pointer S-08 and S-10 read before touching a snapshot field or the board.

**Contract**: One page, following `join-contract.md`'s own warning that a contract past a page has
become a second copy of the plan. It states: names are published, bounded to `STANDINGS_SIZE`, and why;
order and rank are computed by different rules and why merging them breaks a tied attendee's screen;
the standings phase keeps `currentQuestionId` and what happens if a later slice makes it questionless;
no player id is ever published and why; and that S-10 inherits the board for the `ended` phase.

#### 4. The runbook

**File**: `docs/runbook-live-session.md`

**Intent**: The host now has a fifth verb and a beat they can trigger at the wrong moment.

**Contract**: Add the standings beat to the session flow, noting it is only available after a reveal.

#### 5. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: Mark S-07 delivered, in the format the delivered slices already use, and add the "Updated
YYYY-MM-DD (S-07 delivered)" note to the Baseline section that S-05 and S-06 both added — S-10 reads
that section, not this plan.

**Contract**: Status `done` in the At-a-glance table and in the S-07 block.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`

#### Manual Verification:

- The PRD's Deviation 2 reads correctly end to end — S-02's correction and S-07's amendment do not
  contradict each other.
- `leaderboard-contract.md` fits on a page.

---

## Testing Strategy

### Unit Tests:

- **`standings.test.ts`** — the ordering and ranking rules. The tie cases are the ones that matter, and
  each fixture must genuinely tie: assert something only the tie branch produces rather than trusting
  a fixture built from a shared base (`lessons.md`, "Prove the fixture reaches the branch the test
  names"). Cover zero-score inclusion, a room smaller than five, and an empty room.
- **`state.test.ts`** — the two new `superRefine` clauses, the `currentQuestionId` requirement on the
  standings phase, and that a document written without the `standings` field still parses.
- **`store.test.ts`** — `readStandings` and `readOwnRank` against the existing module-level mock,
  including the failure posture (`null`, never an empty board) and the command count.
- **`render.test.ts`** — the board renderer under happy-dom, including the highlight's case
  sensitivity.

### Integration Tests:

- Route-level tests for `POST /api/quiz/host/standings` (auth, every phase, the read-failure refusal)
  and for `result.ts`'s standings branch.
- No end-to-end harness run — see What We're NOT Doing.

### Manual Testing Steps:

1. Start a session on `/quiz/host`; join from two phones and a laptop under different names.
2. Answer question 1 from all three with deliberately different scores; reveal.
3. Tap **Pokaż ranking**. Confirm the five rows (or fewer) match across all four screens, in order.
4. Confirm each device's personal line agrees with its row, or with its position if off the board.
5. Tap **Następne pytanie**. Confirm question **2** opens, not question 1.
6. Reload a phone during a standings beat; confirm the same board and the same position return.
7. Join a fourth device that answers nothing, then show the standings; confirm it reads position last
   with 0 points rather than an error.
8. Try **Pokaż ranking** from the lobby, from an open question, and after ending — each refused with a
   Polish message.

## Performance Considerations

Per standings beat: **two** store commands for the host action, plus **one** per device that fetches
its rank (~150). A segment with four beats is roughly 600 commands — against a 500k monthly free tier
and the runbook's 200k-per-run tripwire, negligible beside the connection-limit fallback loop's
already-budgeted 7k–66k.

One publish per beat, carrying five rows (~200 bytes) — smaller than a reveal snapshot carrying a
distribution.

The 150 rank fetches arrive within a second or two of the host's tap. That is the same fan-in shape
`readOwnResult` already handles at each reveal, on a phase where nothing else is in flight, which is
why no rehearsal re-run is scheduled.

## Migration Notes

None, and the reason is worth stating: a session document written before this deploy lacks the
`standings` field, and `.default(null)` is what lets it parse. Without that default, deploying
mid-segment 409s the host's next action — the failure mode `state.ts:105` documents for all three
existing snapshot fields.

No store key is added, so `end`, `purge` and `scripts/check-purge-residue.ts` need no change.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-07
- The decision this slice inherits: `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
  §"Names are not in the snapshot — S-07 still owns the choice"
- Retention: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`;
  `ably-retention-probe.md` in the same folder
- The reveal transition this one is modelled on: `src/pages/api/quiz/host/reveal.ts`
- The gate this one extends: `src/pages/api/quiz/result.ts:17-48`
- The trap this one avoids: `src/pages/api/quiz/host/advance.ts:25-30`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Domain core — the phase, the payload, and the ordering

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — 0766f04
- [x] 1.2 Type checking passes: `bun run type-check` — 0766f04
- [x] 1.3 `standings.test.ts` covers order, both tiebreaks, shared competition ranks, zero-score players, a short room, an empty room — 0766f04
- [x] 1.4 `state.test.ts` asserts the two `superRefine` clauses and that a field-less document parses — 0766f04
- [x] 1.5 `state.test.ts` asserts a standings phase with `currentQuestionId: null` is rejected — 0766f04
- [x] 1.6 A test asserts `reveal` from standings is a no-op — 0766f04

### Phase 2: Store reads, the host verb, and the personal rank

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 153fa3f
- [x] 2.2 Type checking passes: `bun run type-check` — 153fa3f
- [x] 2.3 `store.test.ts` covers `readStandings` join, null-on-failure, skipped bad record, `readOwnRank` known and unknown id — 153fa3f
- [x] 2.4 `store.test.ts` asserts `readStandings` issues two commands and no `eval` — 153fa3f
- [x] 2.5 Route test: auth, 409 from every wrong phase, no-op from standings, 503 without transition on read failure — 153fa3f
- [x] 2.6 The host-route family test picks up the new route — 153fa3f
- [x] 2.7 `result.test.ts` covers the standings branch, including a non-current `questionId` — 153fa3f
- [x] 2.8 `keys.test.ts` still passes — 153fa3f

### Phase 3: The host view

#### Automated

- [x] 3.1 Type checking passes: `bun run type-check`
- [x] 3.2 `boundary.test.ts` passes for `host.astro`
- [x] 3.3 Unit tests pass: `bun run test`

#### Manual

- [ ] 3.4 A five-row board appears on the host screen after a reveal
- [ ] 3.5 The board is legible at projector distance and a 24-character name does not wrap
- [ ] 3.6 The control is refused or disabled from lobby, open question, and ended
- [ ] 3.7 Advancing from the board opens the **next** question, not question 1

### Phase 4: The attendee view

#### Automated

- [ ] 4.1 Unit tests pass: `bun run test`
- [ ] 4.2 Type checking passes: `bun run type-check`
- [ ] 4.3 `boundary.test.ts` passes for `render.ts` and `index.astro`
- [ ] 4.4 `render.test.ts` covers order, the case-sensitive own-row highlight, and a short board
- [ ] 4.5 A test asserts a failed rank fetch renders neither 0 nor 1

#### Manual

- [ ] 4.6 The rows and their order are identical on every phone and the host screen
- [ ] 4.7 A top-five device's personal line agrees with its highlighted row, including when tied
- [ ] 4.8 A device outside the top five sees a correct personal position
- [ ] 4.9 A reload during the beat returns the same board and position
- [ ] 4.10 A device that never answered reads last with 0 points, not an error

### Phase 5: Contracts and record-keeping

#### Automated

- [ ] 5.1 Unit tests pass: `bun run test`
- [ ] 5.2 Type checking passes: `bun run type-check`

#### Manual

- [ ] 5.3 PRD Deviation 2 reads correctly end to end with both corrections in place
- [ ] 5.4 `leaderboard-contract.md` fits on a page
