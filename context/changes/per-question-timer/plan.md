# Per-question time limit (S-11) Implementation Plan

## Overview

Every scored question gets its own time budget, authored in `src/quiz/definition.ts`, shown as a
countdown on the phone and the projector, and enforced server-side as a **submission window**: once
the budget is spent, `/api/quiz/answer` refuses. The host keeps every pacing lever they have today —
nothing advances, reveals or ends on its own.

The choice that shapes everything below is that the deadline is **derived, never stored**:
`updatedAt + timeLimitSeconds`. During `question-open` the session document's `updatedAt` already *is*
the moment the question opened, and every device already receives it. So this change adds **no
`SessionState` field, no `livequiz:` key, no Ably traffic, and no write while a question is open.**

## Current State Analysis

There is already a per-question clock, and it is not a limit. `speedWeight` (`src/lib/session/scoring.ts:82`)
decays an award over `SPEED_WINDOW_MS = 20_000` down to a floor of half, measured from the attendee's
**own first paint** (`src/lib/client/answer.ts:198`, `src/pages/quiz/index.astro:1450`) — deliberately
not from the host's advance, because a slow connection must not cost points (PRD FR-019,
`context/foundation/prd.md:353-357`). Nothing anywhere cuts a question off.

What exists to build on:

- `speedWeight(elapsedMs, windowMs)` takes a per-call window, defaulted and never overridden
  (`scoring.ts:82,110,150,252`). **This plan leaves it alone** — see Key Discoveries.
- `clampElapsed` (`scoring.ts:301`) already bounds a client's claim by the server's own elapsed,
  derived from `updatedAt`.
- `/api/quiz/answer` already refuses on phase and question id (`src/pages/api/quiz/answer.ts:129`) and
  already computes `now` and the server elapsed in one place (`answer.ts:156-157`).
- `LogFields.rejection` is a closed union of refusal classes (`src/lib/session/log.ts:202-225`), the
  documented place a new class goes.
- The quiz schema's build gate already refuses domain-invalid authoring, including
  "a word-cloud question must be unscored" (`src/quiz/schema.ts`), and it runs at config load so a bad
  definition fails `astro build` (`astro.config.ts`).

What is missing: any notion of a duration in `src/quiz/`, any expiry check on the write path, and any
countdown in either view.

## Desired End State

A host runs a session as they do today. Each scored question shows a countdown on the projector and on
every phone, both computed from the same server timestamp, so they agree. When it reaches zero the
phone locks its input and says so; a submission arriving after the deadline is refused with a Polish
message that says the time ran out, distinct from "already answered". The two unscored questions — the
opening word cloud and the warm-up — carry no clock at all and stay entirely host-paced.

Verify by: running a session locally with a short limit on one question, watching the projector and a
phone count down together, letting one expire, and confirming the host's `dalej` / `pokaż odpowiedź`
still behave exactly as the runbook describes.

### Key Discoveries:

- **`updatedAt` is the open moment only because nothing writes mid-question**
  (`src/pages/api/quiz/answer.ts:143-155`, `scoring.ts:297-300`). Two host routes are held read-only by
  source-scanning tests to preserve it (`participation.ts:14-22`, `words.ts:19-25`). Deriving the
  deadline from it costs nothing and preserves it; **storing or extending a deadline would not**, which
  is why there is no host override in this plan.
- **There is no scheduler.** `vercel.json` is `{framework, regions}` — no `crons`, no queue, no worker.
  Every transition in this system is an authenticated host request. Expiry is therefore *enforced
  lazily* on the next submission, never *fired*.
- **The speed window stays at 20 s and stays per-device.** Coupling `windowMs` to the limit would change
  every award on every question and retire the documented 2× spread; keeping them apart means the
  cutoff is fair (one shared clock) while the reward is fair (each device's own paint time). The two
  clocks have different jobs and the plan states so at both sites.
- **The Lua script is the wrong place for this rule.** `SUBMIT_ANSWER` re-checks *phase* because the
  host can advance between the route's read and the script's run (`store.ts:402-404`). A deadline can
  only be crossed by time passing, and the grace window absorbs that. Decisive: the redis client is
  mocked throughout the suite, so the Lua never executes under test
  (`context/archive/2026-08-14-resilient-join/resume-contract.md:36-38`) — a branch there would be the
  least verifiable place for a rule this change depends on.
- **`SubmitOutcome.rejected` cannot carry this.** On `rejected` the phone calls `markSubmitted`
  (`index.astro:1488-1495`), which makes `hasSubmitted` true — so the reveal would show a result panel
  and the locked note would read "Odpowiedź zapisana" for an answer that was never recorded. Expiry
  needs its own outcome.
- **`host.test.ts` asserts a shape, not a property.** `occurrences("setTimeout") === 1`
  (`src/pages/quiz/host.test.ts:83`) fails on any second timer, countdown included. `lessons.md`'s
  entry "A source-scanning guard must assert the property, not the shape" is about exactly this file;
  the guard is rewritten in Phase 4 rather than worked around.
- **A duration is the first non-`points` field in the quiz schema**, which CLAUDE.md:204-207 currently
  says is the only scoring field. It is a pacing field rather than a scoring one, and the sentence is
  amended in Phase 5 rather than quietly falsified (`lessons.md`, "The CLAUDE.md edit is part of the
  slice").

## What We're NOT Doing

- **No automatic advance, reveal, standings or end.** PRD FR-003 and FR-004 keep manual pacing; this
  change reverses neither. `runbook:387`'s "there is no automatic end" stays true.
- **No host override, extension or pause.** It would be a write during `question-open`, which moves
  `updatedAt` and silently inflates every award after it.
- **No change to `speedWeight`, `SPEED_WINDOW_MS`, `clampElapsed`, or any award arithmetic.** No
  attendee's score changes on any answer that was already going to be accepted.
- **No new `SessionState` field, no new `livequiz:` key, no new Ably message, no new polling loop.**
- **No clock on the two unscored questions.** The word cloud keeps filling until the host reveals,
  exactly as `runbook:326-343` describes.
- **No per-question override of the speed window.** The `windowMs` parameter stays defaulted.
- **No client-side authority.** A phone locking at zero is a courtesy; the server decides.

## Implementation Approach

Five phases, each shippable and separately verifiable: the authoring rule and its build gate; the
server-side refusal; the phone; the projector plus the guard rewrite; the documents.

The cutoff is computed from server-held values **only** — `session.state.updatedAt` plus the
definition's limit. The attendee's `elapsedMs` never enters it. This matters: `elapsedMs` is
attacker-controlled and documented as such (`answer-contract.md:81-83`), and a cutoff that trusted it
would be a cutoff a phone could opt out of.

## Critical Implementation Details

**The visible clock and the enforced clock deliberately differ, and only the server knows by how
much.** The countdown hits zero at `updatedAt + limit`; the refusal fires at
`updatedAt + limit + SUBMISSION_GRACE_MS`. The grace exists so an answer already in flight when the bar
empties is not lost — the PRD calls losing a submitted answer "the most expensive requirement in this
PRD" (`prd.md:110-112`). The grace must **never** reach the client: a phone that knew about it would
show a clock that lies in the generous direction, and the honest reading of the countdown is "send now
or don't".

**Timer tests in this project have failed twice by naming a branch they never reached**
(`lessons.md`, both timer entries). For every countdown test: pin the clock source so one advance is
exactly one tick, and where a test claims an overlap ("expires while a request is open"), hold the
promise open with a manually resolved deferred and settle it inside the test.

## Phase 1: The rule

### Overview

A per-question limit becomes authorable, validated at the build gate, visible to the client, and given
one module that owns the deadline arithmetic.

### Changes Required:

#### 1. The schema field and its invariants

**File**: `src/quiz/schema.ts`

**Intent**: Make `timeLimitSeconds` part of the data contract, required exactly where it is meaningful
and refused where it is not, so an authoring mistake is a build failure rather than a live surprise.

**Contract**: `timeLimitSeconds?: number` added to `baseFields` as an optional positive integer, plus
three `superRefine` clauses on the question-level check (`checkQuestion`), each naming the question
through the existing `where` prefix:

- `points !== null` **requires** `timeLimitSeconds`.
- `points === null` **refuses** it — an unscored question is host-paced (this plan's decision), and a
  limit present but unenforced is the worst of both.
- The value must fall within `[MIN_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS]`, exported from this
  module as `5` and `180`. Bounds live here for the same reason `QUESTION_ID` does — they constrain
  authoring, not scoring.

Note for the implementer: a limit **below 20** is legal but interacts with `SPEED_WINDOW_MS = 20_000`
— nobody can reach the speed floor on such a question. That is a deliberate authoring choice, not an
error, so the gate permits it; the tradeoff is recorded in the contract document in Phase 5.

#### 2. The values

**File**: `src/quiz/definition.ts`

**Intent**: Give all twelve scored questions an explicit budget, chosen by how much work the answer is
rather than by a single global number.

**Contract**: `timeLimitSeconds` on every question with `points: POINTS`; absent on
`smieszne-slowo-ai` (word-cloud) and `czy-wszyscy-gotowi` (warm-up). Proposed values — 25 for the eight
single-choice and one multiple-choice questions, 40 for the two `number` questions and the one `text`
question, on the reasoning that typing a Polish word or parsing a magnitude takes longer than tapping
one of four options, and that every value stays at or above the 20 s speed window so the whole reward
curve remains reachable.

#### 3. Exposure to the client

**File**: `src/quiz/public.ts`

**Intent**: Let the phone and the projector render the countdown without either of them importing quiz
internals.

**Contract**: `readonly timeLimitSeconds?: number` on `PublicQuestion`, passed through in
`toPublicQuestion`, absent when the source question has none. `FORBIDDEN_KEYS` is **unchanged** — a
duration is not an answer key, and the room is meant to see it. The existing projection tests that
assert the public shape will need the new key added to their expectations; check whether any asserts an
exact key set before adding.

#### 4. The deadline module

**File**: `src/lib/session/deadline.ts` (new)

**Intent**: One place owning the arithmetic and the grace, so the route stays a route and the rule can
be tested directly.

**Contract**:

- `SUBMISSION_GRACE_MS = 2_000`, with the docstring explaining that it is the in-flight allowance and
  that it is deliberately invisible to clients.
- `deadlineAt(openedAt: number, question: Question): number | null` — `null` when the question carries
  no limit, meaning "never expires".
- `isSubmissionExpired(now: number, openedAt: number, question: Question): boolean` — `false` whenever
  there is no limit; otherwise `now > openedAt + limitMs + SUBMISSION_GRACE_MS`.

It lives in `src/lib/session/` rather than `src/quiz/` for the reason `scoring.ts` does: it is a
session rule that reads the definition, not part of the definition. Guard the degenerate inputs the way
`clampElapsed` does — a non-finite or non-positive `openedAt` must fail toward **not** expiring, since
refusing every answer in the room is far worse than accepting a late one (`lessons.md`, "absent
untrusted input must fail toward the safe end" — here the safe end is acceptance, because the input is
the server's own clock and a bad one means we do not know).

### Success Criteria:

#### Automated Verification:

- `bun run test` passes
- `bun run type-check` reports 0 errors
- `bun run build` succeeds — the gate runs at config load, so this proves the definition is valid
- `schema.test.ts` covers: a scored question missing the limit is refused; an unscored question with a
  limit is refused; out-of-range values are refused at both ends; the message names the question
- `public.test.ts` covers the limit reaching `PublicQuestion` for a scored question and being absent
  for an unscored one, and that no forbidden key leaked alongside it
- `deadline.test.ts` covers the no-limit case, the exact boundary, the grace boundary built from the
  constant rather than a literal, and the degenerate `openedAt` inputs

#### Manual Verification:

- Deleting one `timeLimitSeconds` from `definition.ts` fails `bun run build` with a message naming that
  question

**Implementation Note**: Break-the-guard pass on all three schema clauses — remove each and watch the
named test fail. Pause for manual confirmation before Phase 2.

---

## Phase 2: The write path

### Overview

An expired submission is refused, in one place, on server-held values only.

### Changes Required:

#### 1. The refusal

**File**: `src/pages/api/quiz/answer.ts`

**Intent**: Refuse a submission whose question's budget is spent, before any scoring happens and
before a write is spent.

**Contract**: A new `MESSAGES.expired` ("Czas na odpowiedź minął.") and a check placed **after** the
question lookup (`answer.ts:137`) and **after** `now` is taken (`answer.ts:156`), but **before** the
kind branches: `isSubmissionExpired(now, session.state.updatedAt, question)` → `409` with body
`{ error: MESSAGES.expired, refusal: "expired" }`, plus
`logSessionEvent("session.answer.rejected", { rejection: "expired", questionId })`.

Two things the implementer must not do. Do not derive the cutoff from `rawElapsed` or `elapsedMs` — the
client controls those, and a cutoff a phone can opt out of is not a cutoff. Do not move the check above
the phase gate — a submission to a question that is not open must keep saying `notOpen`, because that
is the truthful message and the two refusals are not interchangeable.

The `refusal` discriminator follows the precedent in
`context/archive/2026-08-14-resilient-join/resume-contract.md:68-73`: two 409s from one route need a
machine-readable class, or the client cannot tell the attendee which thing happened.

#### 2. The log class

**File**: `src/lib/session/log.ts`

**Intent**: Record the new refusal class without widening the closed union.

**Contract**: `"expired"` added to `LogFields.rejection`, with a one-line comment naming the slice and
what it means. Do not add any field carrying the elapsed time or the deadline — the union is the only
thing that grows.

### Success Criteria:

#### Automated Verification:

- `bun run test` passes; `bun run type-check` reports 0 errors
- `answer.test.ts` covers: a submission inside the window is accepted unchanged; one past the deadline
  **and** past the grace is a 409 whose body carries `refusal: "expired"`; one past the deadline but
  inside the grace is accepted
- The boundary expectations are computed from `SUBMISSION_GRACE_MS` and the question's own limit, never
  typed as literals
- An unscored question is never expired, however long the question has been open
- A submission that omits `elapsedMs` entirely is still refused when the server's clock says expired —
  proving the cutoff does not read the client's number
- A forged `elapsedMs: 0` on an expired question is still refused — the same property from the other
  direction
- `submitAnswer` is not reached on the refusal path

#### Manual Verification:

- With a short limit on one question, submitting late from a phone shows the Polish expiry message
- The session document's `version` and `updatedAt` are unchanged by a refused submission

**Implementation Note**: Break-the-guard pass: remove the expiry check and confirm the named test
fails; then revert it and instead swap `session.state.updatedAt` for a client-derived value and confirm
the two anti-forgery tests fail. Pause for manual confirmation before Phase 3.

---

## Phase 3: The phone

### Overview

The attendee sees the time they have, loses the input when it runs out, and is told which of the two
refusals happened.

### Changes Required:

#### 1. The render helper

**File**: `src/lib/client/render.ts`

**Intent**: Keep the countdown's text and geometry in a pure, tested helper rather than inline in the
page, following the file's existing "three helpers and a question renderer" convention.

**Contract**: `countdownText(remainingMs: number): string` (whole seconds, floored, clamped at zero,
Polish) and `renderCountdown(node: HTMLElement, remainingMs: number, limitMs: number): void` painting
the text plus a width percentage. No `innerHTML` — `textContent` only, as the module's escaping rule
requires. Degenerate inputs (`limitMs <= 0`, non-finite either argument) must render `0` and no `NaN`,
the same property `render.test.ts` already asserts for the distribution and word-cloud helpers.

#### 2. The countdown, the lock and the expiry branch

**File**: `src/pages/quiz/index.astro`

**Intent**: Run one countdown for the open question, take the input away at zero, and restore the
correct state on a reload or a late join.

**Contract**:

- A `#countdown` element in the question panel, hidden unless the open question has a limit.
- Exactly one `let countdownTimer`, armed only from the `question-open` render paths and cleared in
  **every** other branch — reveal, standings, lobby, ended, `connection === "lost"`, and
  `hideAnswerControls`. A timer that outlives its question is the failure
  `context/archive/2026-08-09-connection-limit-degradation/plan-brief.md:71` names.
- The remaining time is `state.updatedAt + timeLimitSeconds * 1000 - Date.now()`. Both inputs are
  already on the client: `updatedAt` on the snapshot, the limit on `config.questions`. **No new import**
  — `boundary.test.ts` must keep passing untouched.
- At zero: disable the field and the submit button, note reads that time ran out and the host will
  continue. This does **not** call `markSubmitted` — nothing was submitted.
- A device arriving mid-question gets the true remainder, and a remainder of zero renders the locked
  state immediately rather than a full bar. Note the deliberate asymmetry with FR-019: their *speed*
  clock still starts at their own first paint, because a latecomer genuinely did just see the question.
- The `expired` outcome from `submitAnswer` shows the server's message and locks the control, again
  without `markSubmitted`.

#### 3. The client outcome

**File**: `src/lib/client/answer.ts`

**Intent**: Let the page distinguish "time ran out" from "already recorded", both of which are final
409s today.

**Contract**: A fourth member of `SubmitOutcome`: `{ outcome: "expired"; error: string }`, returned
when a 409 body carries `refusal: "expired"`; every other 409 keeps returning `rejected`. The
docstring must say why it is not folded into `rejected`: the caller's `rejected` path calls
`markSubmitted`, which would make `hasSubmitted` true and paint a result panel at the reveal for an
answer that was never recorded.

### Success Criteria:

#### Automated Verification:

- `bun run test` passes; `bun run type-check` reports 0 errors
- `render.test.ts` covers `countdownText` and `renderCountdown`: whole seconds, the clamp at zero, no
  `NaN` for degenerate limits, no markup interpolation, and replace-not-append
- `answer.test.ts` (client) covers a 409 with `refusal: "expired"` producing the `expired` outcome, and
  a 409 without it still producing `rejected`
- `boundary.test.ts` passes with no change to its rules

#### Manual Verification:

- Two phones show the same remaining time on the same question, within a second of each other
- At zero the input locks and the note appears; the host's `pokaż odpowiedź` then behaves normally
- Reloading mid-question restores the true remainder, not a fresh full bar
- Joining a question already past its deadline shows the locked state and no input
- Backgrounding the tab and returning shows a corrected countdown rather than a stale one

**Implementation Note**: Break-the-guard pass on the timer-clearing paths — delete one `clear` call and
confirm a test fails. Pause for manual confirmation before Phase 4.

---

## Phase 4: The projector

### Overview

The room sees the same clock the phones see, and the one-loop guard is rewritten to assert what it was
always meant to assert.

### Changes Required:

#### 1. The projector countdown

**File**: `src/pages/quiz/host.astro`

**Intent**: Put the countdown on the large screen, legibly, without disturbing the poll loop.

**Contract**: A countdown region beside the question prompt, driven by exactly one
`let countdownTimer` — a name deliberately distinct from `pollTimer` — computed from the same
`updatedAt + limit` arithmetic as the phone, cleared on every phase change, on `visibilitychange` to
hidden, and on `pagehide`. It must not touch `pollDelay`, `polling`, `schedulePoll` or `runPoll`: the
countdown paints, the poll fetches, and nothing is shared but the current state.

#### 2. The guard rewrite

**File**: `src/pages/quiz/host.test.ts`

**Intent**: Restate the one-loop property so it still forbids a second *polling* loop while permitting
a timer that fetches nothing — and so it stops asserting a shape.

**Contract**: Replace `occurrences("setTimeout") === 1` and the `let *[Tt]imer` count with assertions
about the property: exactly one timer arms a `fetch`, exactly one `let polling`, exactly one
`let *[Dd]elay`, `schedulePoll` remains the only site that arms the poll, and `runPoll`'s `finally`
remains the only re-arm. Add a clause asserting the countdown timer is cleared wherever the phase
changes. Keep the existing "still has the loop's code after comments are stripped" vacuity guard and
add the countdown's identifiers to it.

`lessons.md` requires this guard to be verified **in both directions**: confirm it passes on the
finished code, and confirm it fails when a second fetch-arming timer is introduced. A guard that only
ran against correct code has been checked, not verified.

### Success Criteria:

#### Automated Verification:

- `bun run test` passes; `bun run type-check` reports 0 errors
- `host.test.ts`'s rewritten guard passes on the finished file
- The guard fails when a second fetch-arming timer is added to `host.astro` (verified by hand, then
  reverted)
- The guard fails when a countdown clear is removed from a phase-change path
- `boundary.test.ts` passes for the new `<script>` code

#### Manual Verification:

- The countdown is legible from the back of a room and does not push the question text off screen
- Projector and phone agree on the remaining time throughout a question
- Advancing mid-countdown restarts the clock for the new question; revealing stops it
- The participation and word-cloud panels behave exactly as before, including their staleness markers
- Backgrounding the host tab and returning does not leave two clocks running

**Implementation Note**: Break-the-guard pass as specified above — both directions, on the guard
itself. Pause for manual confirmation before Phase 5.

---

## Phase 5: Contract and documents

### Overview

Record the reversal where the old position was stated, and stop every document that now asserts
something false.

### Changes Required:

#### 1. The contract

**File**: `context/changes/per-question-timer/timer-contract.md` (new)

**Intent**: One page the next slice reads instead of rediscovering these constraints, in the shape of
the nine existing contracts.

**Contract**: The binding rules only — the deadline is derived from `updatedAt` and stored nowhere and
why that must stay true; the cutoff reads server values only; the visible clock and the enforced clock
differ by a grace the client never learns; two clocks with different jobs (shared cutoff, per-device
reward) and why merging them is a bug; unscored questions carry no clock; no host override, with the
`updatedAt` reason; the countdown timer is not the poll loop. Keep it to a page — a contract that grows
past one has become a second copy of the plan.

#### 2. The PRD

**File**: `context/foundation/prd.md`

**Intent**: State the new requirement and correct the two notes it falsifies, quoting the position
being overturned rather than deleting it — the convention FR-019 established.

**Contract**: A new FR (next free number) for the per-question submission window, marked as reversing
**half** of FR-003's rejection: the clock now bounds *answering*, while advancing, revealing and ending
stay manual. Amend FR-003's Socratic note to record the partial reversal and its date. Amend FR-014's
"consistent with FR-003 and FR-004 keeping manual control" clause, which is the sentence that makes
manual pacing a cross-FR property. Add the host override to Non-Goals with its `updatedAt` reason.

State explicitly in the FR that the retention deviation chain needs **no** new entry: nothing is added
to the published snapshot and no new key exists, so the chain's subject — what rides the wire — is
untouched.

#### 3. Roadmap, runbook, CLAUDE.md

**File**: `context/foundation/roadmap.md`

**Contract**: An `S-11` row in the slice table (change id `per-question-timer`, prerequisite S-03,
outcome "Attendee sees how long is left and cannot answer after time runs out"), and a parked entry for
the host override.

**File**: `docs/runbook-live-session.md`

**Contract**: The pacing section gains the clock: what the host still controls (everything), what the
clock does (refuses late answers only), that the word cloud and the warm-up are unchanged and still
fill until `pokaż odpowiedź`, and that a question sitting at zero waits for the host exactly as before.
Add the one-line answer for the attendee who asks why they were refused, beside the existing entry
about degraded devices scoring lower.

**File**: `CLAUDE.md`

**Contract**: Three claims to amend, named here so they are not discovered at the end:

- "`points` … is **the only scoring field**" in the `src/quiz/` section — now also `timeLimitSeconds`,
  with the note that it is a pacing field and that scoring rules still live in `scoring.ts`.
- "There are exactly two [polling loops]" — still two *polling* loops, plus two countdown timers that
  fetch nothing; state the distinction the rewritten guard now enforces.
- The `updatedAt` / "nothing polled may write" paragraph — add that the deadline is derived from it,
  which makes that invariant load-bearing for scoring **and** for the clock.

### Success Criteria:

#### Automated Verification:

- `bun run test` passes; `bun run type-check` reports 0 errors; `bun run build` succeeds
- No document still asserts that `points` is the only scoring field, or that a timer was rejected
  outright, or that there are exactly two timers

#### Manual Verification:

- The contract is a one-page pointer, not a second plan
- A reader coming from FR-003's note can see what was reversed, what was not, and why
- The runbook alone is enough for a host to run a session under the new behaviour

**Implementation Note**: Grep the four documents for each claim before editing, and quote the overturned
position rather than deleting it.

---

## Testing Strategy

### Unit Tests:

- `schema.test.ts` — the three authoring clauses, each verified by breaking it
- `deadline.test.ts` — no-limit, exact boundary, grace boundary from the constant, degenerate `openedAt`
- `render.test.ts` — countdown text and geometry, clamped, no `NaN`, no markup
- `answer.test.ts` (client) — the `expired` outcome versus `rejected`

### Integration Tests:

- `answer.test.ts` (route) — accepted inside the window, refused past deadline plus grace, accepted
  inside grace, unscored never expired, and the two anti-forgery cases proving the cutoff ignores the
  client's `elapsedMs`
- `host.test.ts` — the rewritten one-loop property, verified in both directions

### Manual Testing Steps:

1. Author a 5-second limit on one scored question, run `bun run dev`, join from two devices.
2. Watch the projector and both phones count down together; let one expire without answering.
3. Submit from the expired phone and confirm the Polish expiry message, not "already answered".
4. Submit from the other phone within a second of zero and confirm the grace accepts it.
5. Reload one phone mid-question and confirm the remainder is preserved.
6. Join a third device after the deadline passed and confirm the locked state with no input.
7. Reach the word-cloud question and confirm no clock appears and the cloud fills until reveal.
8. Confirm the session document's `version` climbs only on host actions throughout.

## Performance Considerations

No new billed store commands: the expiry check reads the session document the route already fetches
(`answer.ts:115`), and a refused submission spends **fewer** commands than an accepted one because it
never reaches `submitAnswer`'s eleven. No new HTTP requests and no new polling, so the runbook's
command tripwire keeps its meaning. Two new `setTimeout` chains repaint text on their own devices and
bill nothing.

## Migration Notes

A session running when this ships holds a document written before the change — and because no field was
added, it parses unchanged. There is nothing to default and no back-compat clause needed, which is the
main dividend of deriving the deadline. The only mid-deploy behaviour change is that a question already
open when the new code lands acquires a deadline measured from its existing `updatedAt`, so it may be
immediately expired; the host's next `dalej` clears it. Rolling back is a code revert with no data
shape to undo.

## References

- Change identity: `context/changes/per-question-timer/change.md`
- The rejected position being partly reversed: `context/foundation/prd.md:296-299` (FR-003)
- The per-device speed clock this must not disturb: `context/foundation/prd.md:353-357` (FR-019)
- The `updatedAt` invariant: `src/pages/api/quiz/answer.ts:143-155`, `src/lib/session/scoring.ts:297-300`
- The read-only-poll rule that protects it:
  `context/archive/2026-08-09-host-participation-and-distribution/participation-contract.md:56-66`
- The 409-discriminator precedent:
  `context/archive/2026-08-14-resilient-join/resume-contract.md:68-73`
- The one-loop property being rewritten: `src/pages/quiz/host.test.ts:82-97`
- Timer-test failure modes: `context/foundation/lessons.md` (both timer entries)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The rule

#### Automated

- [x] 1.1 `bun run test` passes — ea1ef22
- [x] 1.2 `bun run type-check` reports 0 errors — ea1ef22
- [x] 1.3 `bun run build` succeeds — ea1ef22
- [x] 1.4 `schema.test.ts` covers the three authoring clauses and names the question — ea1ef22
- [x] 1.5 `public.test.ts` covers exposure for scored and absence for unscored — ea1ef22
- [x] 1.6 `deadline.test.ts` covers no-limit, boundaries from the constant, degenerate `openedAt` — ea1ef22

#### Manual

- [x] 1.7 Deleting a `timeLimitSeconds` fails the build with a message naming that question — ea1ef22
- [x] 1.8 Break-the-guard pass on all three schema clauses — ea1ef22

### Phase 2: The write path

#### Automated

- [x] 2.1 `bun run test` passes
- [x] 2.2 `bun run type-check` reports 0 errors
- [x] 2.3 Accepted inside the window; 409 with `refusal: "expired"` past deadline plus grace
- [x] 2.4 Accepted past the deadline but inside the grace
- [x] 2.5 Boundary expectations computed from `SUBMISSION_GRACE_MS`, not literals
- [x] 2.6 An unscored question never expires
- [x] 2.7 Refused with `elapsedMs` absent, and refused with a forged `elapsedMs: 0`
- [x] 2.8 `submitAnswer` not reached on the refusal path

#### Manual

- [x] 2.9 A late submission from a phone shows the Polish expiry message
- [x] 2.10 A refused submission leaves `version` and `updatedAt` unchanged
- [x] 2.11 Break-the-guard pass on the expiry check and on the server-clock source

### Phase 3: The phone

#### Automated

- [ ] 3.1 `bun run test` passes
- [ ] 3.2 `bun run type-check` reports 0 errors
- [ ] 3.3 `render.test.ts` covers countdown text, geometry, the clamp, no `NaN`, no markup
- [ ] 3.4 `answer.test.ts` (client) covers `expired` versus `rejected`
- [ ] 3.5 `boundary.test.ts` passes with no rule change

#### Manual

- [ ] 3.6 Two phones agree on the remaining time
- [ ] 3.7 At zero the input locks with the note, and reveal still behaves normally
- [ ] 3.8 A reload mid-question restores the true remainder
- [ ] 3.9 Joining past the deadline shows the locked state and no input
- [ ] 3.10 Tab backgrounding and return shows a corrected countdown
- [ ] 3.11 Break-the-guard pass on a timer-clearing path

### Phase 4: The projector

#### Automated

- [ ] 4.1 `bun run test` passes
- [ ] 4.2 `bun run type-check` reports 0 errors
- [ ] 4.3 The rewritten `host.test.ts` guard passes on the finished file
- [ ] 4.4 The guard fails when a second fetch-arming timer is added
- [ ] 4.5 The guard fails when a countdown clear is removed
- [ ] 4.6 `boundary.test.ts` passes for the new `<script>` code

#### Manual

- [ ] 4.7 The countdown is legible from the back of the room
- [ ] 4.8 Projector and phone agree throughout a question
- [ ] 4.9 Advancing restarts the clock; revealing stops it
- [ ] 4.10 Participation and word-cloud panels unchanged, staleness markers included
- [ ] 4.11 Backgrounding the host tab leaves no second clock running

### Phase 5: Contract and documents

#### Automated

- [ ] 5.1 `bun run test` passes
- [ ] 5.2 `bun run type-check` reports 0 errors
- [ ] 5.3 `bun run build` succeeds
- [ ] 5.4 No document still asserts the three falsified claims

#### Manual

- [ ] 5.5 The contract is a one-page pointer
- [ ] 5.6 FR-003's note shows what was reversed and what was not
- [ ] 5.7 The runbook alone suffices for a host to run the new behaviour
