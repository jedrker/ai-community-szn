# Sync Under a Degraded Link — Implementation Plan

## Overview

Rollout phase 2 of `context/foundation/test-plan.md`. It closes two named, still-open gaps:

- **Risk #3** — the rule that decides whether a device *adopts* a newer snapshot has no executing
  test, because `createSessionClient` is never constructed anywhere in the suite. The fallback
  loop's own layer is saturated; delivery and adoption are different steps and only the first is
  covered.
- **Risk #4** — double-counting is structurally impossible, but two *loss* mechanisms are exercised
  by nothing in the repo: a refusal the phone reports to the attendee as a recorded answer, and an
  answer that reaches the stored tally but not the distribution the projector draws.

**This phase pins behaviour; it does not fix it.** That is the test plan's recorded decision
(`test-plan.md:105-111`) and it is load-bearing: a test written against already-repaired code has
never been observed failing, which §1's fourth rule counts as *checked, not verified*. Two live
defects are in reach and both are left alone, asserted as they are, and named as findings.

## Current State Analysis

**Risk #3.** `apply` (`src/lib/client/session.ts:525-534`) is a closure inside
`createSessionClient`. It is the single reconciliation rule — apply the higher `version`, drop
anything not newer, and always apply `null` — and all three snapshot sources funnel through it.
It has no test. `session.test.ts` covers three exported pure predicates plus `createFallbackPoll`
(19 tests, `Math.random` pinned, three of them holding a request genuinely open across an
assertion). The archive recorded this exact gap and accepted it at the time
(`connection-limit-degradation/reviews/impl-review.md:202-208`).

Two defects were found in the loop while grounding, both to be pinned rather than fixed:

- `session.test.ts:567` — *"stop during an open request is resumable, unlike dispose"*. After
  `poll.stop()` and `settleInFlight()`, `tick`'s `finally` has already re-armed (`shouldPoll` is
  `() => true`, document visible), so the test's own `poll.arm()` is a no-op and the
  `refresh === 2` assertion holds whether `stop` is resumable-by-arm or merely
  undone-by-`finally`. It never asserts `isArmed()` between the settle and the arm.
- `pause()` is `() => clearTimer()` (`session.ts:481`) and sets no flag, so an in-flight tick's
  `finally` re-arms past it. Same class as impl-review F3, in the one sibling of `stop`/`dispose`
  that was never given a terminal flag.

**Risk #4(a).** The route maps a store-level `not-open` to a 409 **with no `refusal` class**
(`src/pages/api/quiz/answer.ts:413-421`), and the client maps any refusal-less 409 to `rejected`,
which is final and causes the page to mark the question submitted
(`src/lib/client/answer.ts:456-463`). Both halves are green today —
`src/pages/api/quiz/answer.test.ts:1011-1022` asserts the status code, and
`src/lib/client/answer.test.ts:703` asserts the client's mapping — and neither can see the
composition, which is where the failure lives. The interleaving that produces it is a reveal
landing between the route's `readSession` (`answer.ts:128`) and the script's own re-read
(`store.ts:409`).

**Risk #4(b).** `reveal.ts:110-114` reads the tallies inside its computer callback; the real
`applyHostAction` then makes a further round trip (`readPlayerCount`, `host.ts:265`) before the
compare-and-set. An answer landing in that gap is in `livequiz:tallies` but not in
`revealedDistribution`. The drift is documented in prose at `reveal.ts:104-108` and
`participation-contract.md:114-118` — "at most a one-answer drift" is an assertion in a comment,
not a bound anything enforces. `routes.test.ts` cannot reach it: that file mocks `applyHostAction`
itself, so the gap it would interleave into does not exist there.

**What is already adequate and must not be rebuilt.** The deadline boundary is covered at the
route and already built from `SUBMISSION_GRACE_MS` and each question's own `timeLimitSeconds`,
including a guard that the two fixtures' limits differ (`answer.test.ts:783-880`). Below the Lua,
`scripts/rehearse-room.ts` is at its practical ceiling. `store.test.ts` is saturated at the mock
level and says so itself (`:1010-1015`).

## Desired End State

- The snapshot-adoption rule is an exported, constructible unit with executing tests for the
  version guard, the `null`-applies wipe and the `sessionOver` latch; `createSessionClient`
  consumes it and behaves identically.
- `session.test.ts` no longer contains a test whose assertion holds either way, and `pause()`'s
  non-terminal behaviour is pinned with wording that says plainly it is the recorded gap.
- **Risk #3's third proof clause is met for `dispose` only, and that is written down.** §2's
  condition is "a device adopts a newer snapshot, an older one cannot overwrite a newer one, **and
  a cancel is not undone by a request already in flight**" (`test-plan.md:89`). Phase 1 delivers
  the first two; phase 2 delivers the third for `dispose` and pins its failure for `stop` and
  `pause`. The phase closes as complete on its deliverables, not on that clause, and the row says
  so.
- One integration test runs the real answer route and feeds its actual `Response` to the real
  client submitter, asserting the reveal-race refusal arrives as `rejected`.
- One integration test lands an answer inside the reveal's read-to-commit gap and asserts the
  published distribution is short by exactly it while the tallies hold it.
- Every test above has been broken and restored, with the breaking edit and the observed result
  written down.
- `test-plan.md` §6.2 is no longer "TBD", §6.6 carries phase 2's notes including the two pinned
  defects and the named residual, §3's row reads `complete`, and CLAUDE.md's extraction list names
  the new module.

Verify with: `bun run test`, `bun run type-check`, `bun run lint`, plus the phase 5 table.

### Key Discoveries

- `apply`'s state has exactly three readers in `createSessionClient` — `apply` itself,
  `shouldPoll`'s `lifecycle.sessionOver` (`session.ts:609`) and `current: () => current`
  (`session.ts:766`). The extraction is clean.
- `advanceLifecycle` and `INITIAL_LIFECYCLE` are already exported and tested
  (`session.ts:298-339`); the reconciler composes them rather than restating their rules.
- `boundary.test.ts` excludes `*.test.ts` from its scan (`:177`), so a test file may value-import
  a route. Product modules may not, and nothing in this plan asks them to.
- `scripts/scoped-tests.sh` hands `.ts` sources to `vitest related`, which walks the module graph —
  so both new seam tests are found from either side they import. No hook change is needed.
- `applyHostAction` takes `write` as an injectable parameter (`host.ts:176`) but `reveal.ts` does
  not pass one, so the drift test reaches the gap by mocking the **store module** and using the
  real `applyHostAction`.
- `routes.test.ts` mocks `applyHostAction`, which is why the drift test needs a file of its own
  rather than a new `describe` there.
- The Ably-module-mock prohibition (`connection-limit-degradation/plan-brief.md:40`) is why the
  whole client is not constructed: a fake freezes the SDK's surface and passes against a real
  breakage.

## What We're NOT Doing

- **Not fixing either defect.** `pause()` stays non-terminal and the `not-open` 409 keeps arriving
  without a refusal class. Both are raised as findings for a change of their own.
- **Not constructing `createSessionClient`** with an injected or faked Ably realtime, and not
  covering `close()`'s ordering, listener wiring or prime-before-subscribe.
- **Not extending `scripts/rehearse-room.ts`** with a reveal-during-burst. It runs by hand against
  the production namespace and gates nothing; phase 1's impl-review F1 showed what a misfiring
  hook against that store costs. The interleaving below the Lua stays uncovered and is recorded as
  the phase's named residual.
- **Not introducing a local or ephemeral Redis.** That is a stack change and belongs to phase 4.
- **Not rebuilding the deadline boundary tests** or adding mock-level assertions to
  `store.test.ts`.
- **Not writing a test for "nothing on stage indicates which devices are stuck."** Confirmed real
  and confirmed a product absence; a test there would assert a decision, not catch a defect.
- **Not editing the PRD or the runbook** in this change. The stage-blindness absence stays where
  research and §2 put it.
- **Not touching `client.close()`'s dead-code status** beyond recording it.

## Implementation Approach

Four test-bearing phases, then one that verifies and documents. Phase 1 is the only one that
changes product code, and its change is a move: the rule is lifted out of a closure into an
exported factory and the client is wired to it, with no behavioural delta. Phases 2–4 add or repair
tests only. Phase 5 is where §1's fourth rule is discharged as evidence rather than as intent.

Ordering matters in one place: phase 5's table cites tests from all four, so it runs last. Phases
1–4 are otherwise independent and could be reordered without consequence.

## Critical Implementation Details

**State sequencing (phase 4).** The interleaving must land the concurrent answer *after*
`readQuestionTallies` resolves and *before* `writeSession` is called. The natural hook is the
`readPlayerCount` mock, which the real `applyHostAction` awaits in exactly that gap
(`host.ts:265`) — it is the round trip the research names as what makes the window wider than
"the compare-and-set". Landing the answer anywhere else does not model the failure.

**Timing (phase 2).** `session.test.ts`'s deferred harness settles the in-flight request inside the
test. The repaired `:567` test must assert `isArmed()` **between** `settleInFlight()` and the
explicit `poll.arm()`; that single assertion is the whole difference between the two hypotheses the
current test cannot tell apart. Do not advance fake time between them — `lessons.md:72-99` records
what an extra advance does to a tick count.

## Phase 1: The Adoption Seam

### Overview

Extract the snapshot-reconciliation rule from `createSessionClient` into an exported factory in the
same module, wire the client to it, and cover the three properties that decide adoption.

### Changes Required:

#### 1. The reconciler

**File**: `src/lib/client/session.ts`

**Intent**: Lift `apply`, `current` and `lifecycle` out of `createSessionClient` into an exported
factory so the adoption rule can be constructed and driven by a test without any Ably surface. The
extraction is behaviour-preserving; the docstrings that currently sit on `apply` and on the
`lifecycle` declaration move with the code they describe, including the accepted-cost note about a
purge-and-restart leaving a degraded device latched.

**Contract**: `createSnapshotReconciler(deps: { onSnapshot: (state: Snapshot, source:
SnapshotSource) => void }): SnapshotReconciler`, where `SnapshotReconciler` exposes `apply(state,
source): boolean`, `current(): Snapshot` and `lifecycle(): SessionLifecycle`. Stateful factory, in
the shape of `countdown.ts` rather than of `shouldFallbackPoll` — it holds `current` and the latch.
It composes the already-exported `advanceLifecycle` and `INITIAL_LIFECYCLE` rather than restating
their rules.

#### 2. The client wired to it

**File**: `src/lib/client/session.ts`

**Intent**: `createSessionClient` constructs one reconciler and reads through it at the three sites
that touch this state today — `refresh`'s apply, the realtime message handler's apply,
`shouldPoll`'s `sessionOver`, and the returned `current()`. No other behaviour changes.

**Contract**: The exported `SessionClient` surface is unchanged, including `current()`'s signature.
`options.onSnapshot` is called exactly where it is today: once per adopted snapshot, after the
latch advances.

#### 3. The reconciler's tests

**File**: `src/lib/client/session.test.ts`

**Intent**: Cover the rule the risk is about. Each test drives the factory directly with a stub
`onSnapshot` and asserts both the return value and whether the callback fired — the two halves that
together mean "adopted".

**Contract**: At minimum, one test each for: a newer version is adopted; an equal version is
dropped; an older version is dropped and does not overwrite `current()`; the first snapshot is
adopted against an empty reconciler; `null` is adopted regardless of version and wipes `current()`;
`null` **before** any session does not latch `sessionOver`; `null` **after** a session does; an
`ended` phase latches `sessionOver`; the latch is sticky across a subsequent live snapshot. The
`source` argument is passed through to `onSnapshot` unaltered. Fixtures are literals built in the
file — no snapshot is taken from a route or a real session document.

### Success Criteria:

#### Automated Verification:

- Unit and integration suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- `src/lib/client/boundary.test.ts` still passes — the new export adds no forbidden import
- `bun run e2e` passes — **run here rather than at the end, because it is the only automated thing
  that can see a botched extraction.** `createSessionClient` stays untested by design, so the
  reconciler's own tests pass against a client that no longer calls it; both specs load a page that
  imports the module (`host.astro:1021`). **Precondition, not optional:** these specs drive the real
  Upstash namespace from `.env` — confirm no live session exists first, per `e2e/E2E-RULES.md`. The
  previous rollout phase's impl-review F1 is the cleanup hook that purged a live room.

#### Manual Verification:

- The extraction is a move, not a rewrite: read `apply`'s new body against `session.ts:525-534` at
  `354251f` and confirm the comparison, the assignment order and the `onSnapshot` call are
  unchanged
- `/quiz` still follows a host transition end to end on two devices, one of them with the tab
  backgrounded and restored

---

## Phase 2: Loop Lifecycle Pins

### Overview

Repair the test that cannot fail, and pin `pause()`'s non-terminal behaviour. Tests only — no
product code changes in this phase.

**What this phase settles about Risk #3's third clause.** "A cancel is not undone by a request
already in flight" holds for `dispose` and for nothing else. Both pins below therefore record a
*failure* of the stated condition, which is why phase 5 must carry that fact into §2 and §6.6
rather than let a green suite imply the clause is met.

**The inversion rule, which applies to both tests here and to phases 3 and 4.** Each pin asserts
behaviour the project would rather not have, so each one *must* fail the day somebody fixes it.
Every pinned assertion carries a note in the test itself: *if this fails, the defect was fixed —
invert the expectation and delete this note; do not restore the behaviour.* `test-plan.md:88` names
repairing a newly-failing guard back toward the bug as the anti-pattern, and a pin is its most
inviting instance.

### Changes Required:

#### 1. The repaired cancellation test

**File**: `src/lib/client/session.test.ts`

**Intent**: Make *"stop during an open request is resumable, unlike dispose"* able to fail for the
reason it names, by asserting the loop's armed state between the settle and the explicit `arm()`.
The test currently passes identically whether `stop` is resumable-by-arm or simply undone by the
in-flight tick's `finally`.

**Contract**: The assertion added between `settleInFlight()` and `poll.arm()` records what is
actually true today — the `finally` has already re-armed — so the test states the observed
behaviour rather than the intended one, and its comment must say which of the two it is asserting.
Its sibling at `:544` (`dispose`) is left alone; it already distinguishes the cases.

#### 2. The `pause` pin

**File**: `src/lib/client/session.test.ts`

**Intent**: Assert that a tick in flight when `pause()` is called re-arms the loop from its
`finally` — the recorded gap, in the one sibling of `stop`/`dispose` with no terminal flag.

**Contract**: Uses the existing deferred harness. The test's name and comment must state plainly
that this is a documented hole being pinned, not the intended contract, and point at the
`FallbackPoll.pause` docstring (`session.ts:345-354`) which describes the intent it does not
achieve. Wording matters here: a bare "pause is undone by the finally" test reads as endorsement.
Both tests carry the inversion note from this phase's overview.

### Success Criteria:

#### Automated Verification:

- Suite passes: `bun run test`
- Linting passes: `bun run lint`

#### Manual Verification:

- Confirm the repaired `:567` test now distinguishes the two hypotheses by reading it against the
  phase 5 table's row for it

---

## Phase 3: The Reveal-Race Refusal

### Overview

One integration test proving that an answer refused because the host revealed mid-flight reaches
the attendee's client as `rejected` — final, and indistinguishable from "your answer is recorded".

### Changes Required:

#### 1. The route→client seam test

**File**: `src/pages/api/quiz/answer.seam.test.ts` (new)

**Intent**: Compose the two modules whose individual halves are already green. Mock the store so
`readSession` reports a question genuinely open and `submitAnswer` reports `not-open` — the
disagreement no existing test creates, and the exact shape of a reveal landing between the route's
read and the script's. Run the real route handler, then hand its real `Response` to the real client
`submitAnswer` through a stubbed global `fetch`, and assert the outcome.

**Contract**: Asserts (a) the outcome is `rejected` — the client's final class, which the page uses
to mark the question submitted; (b) the 409 body carries no `refusal` field, which is *why* it maps
that way and is the difference from the `expired` path S-11 created deliberately — and it carries
the inversion note from phase 2's overview, since giving `not-open` its own refusal class is
exactly the fix that must turn this red; (c) for contrast
in the same file, the expired path from the same route yields `expired`, so the asymmetry is
asserted rather than described. The file's docstring states that (a) is a pinned defect and names
the finding.

The store mock must be the route's (`vi.mock` on `../../../lib/session/store`); the client module
is imported for real, and only `globalThis.fetch` is stubbed. Nothing here mocks the client.

### Success Criteria:

#### Automated Verification:

- Suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `scripts/scoped-tests.sh src/pages/api/quiz/answer.ts` runs the new file (module-graph reachable
  from the route)

#### Manual Verification:

- Read the new file against `answer.test.ts`'s opening docstring and confirm the two files' stated
  scopes do not now overlap or contradict

---

## Phase 4: The Distribution Drift

### Overview

Land an answer inside the reveal's read-to-commit gap and assert the published distribution is
short by exactly it, turning a prose bound into an executing one.

### Changes Required:

#### 1. The interleaved reveal test

**File**: `src/pages/api/quiz/host/reveal.drift.test.ts` (new)

**Intent**: Exercise the gap `routes.test.ts` cannot reach. That file mocks `applyHostAction`; this
one uses the real one and mocks the **store** (`readSession`, `readQuestionTallies`,
`readPlayerCount`, `writeSession`) plus `realtime`. A mutable fake tally object stands in for
`livequiz:tallies`; `readQuestionTallies` returns a snapshot of it, and the `readPlayerCount` mock —
awaited by `applyHostAction` in exactly the gap — increments it, modelling one answer landing after
the read and before the compare-and-set.

**Contract**: Asserts that the state handed to `writeSession` carries a `revealedDistribution`
whose `answered` is the pre-gap value while the fake tally holds one more; that
`readQuestionTallies` was called exactly once for the reveal; and that the same document is what
`publishSnapshot` receives — so the projector and the store demonstrably disagree by exactly one.
The fixture question comes from `questionOfKind("single-choice", { scored: true })`, never by id,
and the counts are derived from the fake rather than typed.

The docstring records this as the accepted, documented race (`reveal.ts:104-108`,
`participation-contract.md:114-118`) and states what the test is for: making the bound fail visibly
if the gap ever widens or the read moves. It carries the inversion note from phase 2's overview —
closing the drift is a legitimate fix, and this test going red is what that looks like.

### Success Criteria:

#### Automated Verification:

- Suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `src/pages/api/quiz/host/routes.test.ts` still passes unchanged — the new file's mocks are
  file-scoped and must not leak

#### Manual Verification:

- Confirm the increment really lands in the gap by temporarily moving it into the
  `readQuestionTallies` mock instead and watching the drift disappear

---

## Phase 5: Verification and Documents

### Overview

Discharge §1's fourth rule as recorded evidence, and finish the documents this phase owns.

### Changes Required:

#### 1. The break-and-restore table

**File**: `context/changes/testing-sync-degraded-link/verification.md` (new)

**Intent**: One row per test authored or repaired in phases 1–4: the test's name, the exact edit
that must make it fail, and the observed result. Phase 1 of the previous rollout found six guards
condemned by reading and vindicated by running — this table is what makes the run auditable later.

**Contract**: Every row names an edit precise enough to repeat (for example: invert the comparison
in the reconciler's version guard; delete the `null`-applies branch; remove the `arm()` from
`tick`'s `finally`; drop the `refusal` check in the client's 409 mapping; move
`readQuestionTallies` inside the write). A row whose test cannot be made to fail by any edit is
reported as such rather than quietly dropped — that is a finding, not a formatting problem.

#### 2. The cookbook's integration recipe

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in §6.2, which currently reads "TBD — see §3 Phase 2" and names the store-fake
question as this phase's to settle. Add a §6.6 notes block for phase 2 and flip §3's row to
`complete`.

**Contract**: §3's row reads `complete` **on the phase's deliverables**, and the §2 Risk #3 row
gains an amendment in the file's existing style: the third proof clause holds for `dispose` only,
with `stop` and `pause` pinned as non-conforming and the tests named. Without it the map reads as
though the clause were met. §6.2 states the settled answer (there is no store instance; the failures worth
covering sit above the script and need none), the seam recipe (let two existing mocks disagree; run
one real module against another; stub only the transport between them), the placement convention
(`<route>.seam.test.ts` / `<route>.drift.test.ts` beside the route, distinct from the route's own
mock-level suite), and the trap that a mocked-`applyHostAction` file cannot express an interleaving
inside it. §6.6's phase 2 block records: the two pinned defects with enough detail to open a change
against, the named residual (no automated layer reaches a reveal-during-burst below the Lua),
`client.close()` having no caller in `src/`, and **the inversion rule stated once**: these tests
pin defects, so a red one means the defect was fixed — invert the expectation, never restore the
behaviour. §8's freshness line is stamped.

#### 3. CLAUDE.md's extraction list

**File**: `CLAUDE.md`

**Intent**: The "Client interactivity" section enumerates the modules extracted so logic could
become testable — `countdown.ts`, `toast.ts`, `controls.ts` — and describes `session.ts` as holding
`apply` inside the client. Both statements go stale in phase 1.

**Contract**: Name the reconciler in that list as the fourth precedent, with its one-line reason
(the adoption rule was untestable inside a closure whose only entry point is an Ably callback, and
the no-module-mock rule forbids the alternative). Quote rather than delete the position it
supersedes, as the file does elsewhere.

#### 4. The change's own status

**File**: `context/changes/testing-sync-degraded-link/change.md`

**Intent**: Stamp the change complete at the end of implementation.

**Contract**: `status: complete`, `updated:` bumped.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- Linting and formatting pass: `bun run lint`, `bun run format`

#### Manual Verification:

- Every row of `verification.md` was actually observed, not reasoned about
- §6.2 no longer reads "TBD", and a reader who has not seen this change could write a third seam
  test from it
- §2's Risk #3 row and §6.6 both record that the third proof clause holds for `dispose` only
- Re-read CLAUDE.md's client section end to end and confirm no other sentence became false

---

## Testing Strategy

### Unit Tests

- The reconciler's version guard: newer adopted, equal dropped, older dropped, first adopted.
- The `null` rules: always applied; not terminal before a session; terminal after one; sticky.
- The loop's cancellation semantics, repaired and extended: `stop` versus `dispose` versus `pause`,
  each asserted through `isArmed()` at the moment that distinguishes them.

### Integration Tests

- Route → client, across a real `Response`: a reveal-race refusal arrives as `rejected` and carries
  no `refusal` class, while an expired one arrives as `expired`.
- Reveal route → real `applyHostAction` → store mocks, with an answer landing in the gap: the
  published distribution is short by exactly one.

### Manual Testing Steps

1. Open `/quiz/host` and `/quiz` on two devices; start a question and reveal it. Confirm the
   attendee view still follows the transition after phase 1's extraction.
2. Background the attendee tab through a transition and restore it; confirm it converges.
3. Submit an answer on one device at the instant the host reveals on the other, and confirm the
   phone reports it as answered — the pinned defect, observed once so the finding is grounded in
   something seen rather than only in a test.

## Performance Considerations

None. Phase 1 moves code within one module and adds one object allocation per client; phases 2–4
add tests only.

## Migration Notes

Not applicable — no data, schema, key or wire-format change. `SessionState` is untouched, no
`livequiz:` key is added, and no published snapshot gains a field.

## References

- Research: `context/changes/testing-sync-degraded-link/research.md`
- Test plan: `context/foundation/test-plan.md` §1 (rule four), §2 rows #3/#4 and their 2026-08-16
  amendments, §6.2 (the recipe this phase owes), §6.6
- `context/foundation/lessons.md:72-99` — the timing lesson phase 2 is the direct heir of
- `context/archive/2026-08-09-connection-limit-degradation/reviews/impl-review.md:202-208` — the
  accepted `createSessionClient` gap phase 1 closes
- `context/archive/2026-08-09-host-participation-and-distribution/participation-contract.md:102-124`
  — increments below the lock; the reveal drift accepted and documented
- `context/archive/2026-08-14-per-question-timer/timer-contract.md:103-119` — why `expired` has its
  own refusal class and `not-open` does not
- Similar extraction: `src/lib/client/controls.ts` and `controls.test.ts` (rollout phase 1)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: The Adoption Seam

#### Automated

- [x] 1.1 Unit and integration suite passes: `bun run test` — b613981
- [x] 1.2 Type checking passes: `bun run type-check` — b613981
- [x] 1.3 Linting passes: `bun run lint` — b613981
- [x] 1.4 `boundary.test.ts` still passes — the new export adds no forbidden import — b613981
- [x] 1.5 `bun run e2e` passes, after confirming no live session exists (`e2e/E2E-RULES.md`) — b613981

#### Manual

- [x] 1.6 The extraction is a move, not a rewrite — read against `session.ts:525-534` at `354251f` — b613981
- [x] 1.7 `/quiz` follows a host transition on two devices, one backgrounded and restored — b613981

### Phase 2: Loop Lifecycle Pins

#### Automated

- [x] 2.1 Suite passes: `bun run test` — ba3d4be
- [x] 2.2 Linting passes: `bun run lint` — ba3d4be

#### Manual

- [x] 2.3 The repaired `:567` test distinguishes the two hypotheses — ba3d4be

### Phase 3: The Reveal-Race Refusal

#### Automated

- [x] 3.1 Suite passes: `bun run test` — f56a533
- [x] 3.2 Type checking passes: `bun run type-check` — f56a533
- [x] 3.3 `scripts/scoped-tests.sh src/pages/api/quiz/answer.ts` runs the new file — f56a533

#### Manual

- [x] 3.4 The new file's stated scope does not contradict `answer.test.ts`'s docstring — f56a533

### Phase 4: The Distribution Drift

#### Automated

- [x] 4.1 Suite passes: `bun run test` — 571a98b
- [x] 4.2 Type checking passes: `bun run type-check` — 571a98b
- [x] 4.3 `routes.test.ts` still passes unchanged — no mock leakage — 571a98b

#### Manual

- [x] 4.4 The increment really lands in the gap — moving it earlier makes the drift disappear — 571a98b

### Phase 5: Verification and Documents

#### Automated

- [x] 5.1 Full suite passes: `bun run test` — 064d418
- [x] 5.2 Type checking passes: `bun run type-check` — 064d418
- [x] 5.3 Linting and formatting pass: `bun run lint`, `bun run format` — 064d418

#### Manual

- [x] 5.4 Every row of `verification.md` was observed, not reasoned about — 064d418
- [x] 5.5 §6.2 no longer reads "TBD" and a third seam test could be written from it — 064d418
- [x] 5.6 §2's Risk #3 row and §6.6 both record that clause 3 holds for `dispose` only — 064d418
- [x] 5.7 No other sentence in CLAUDE.md's client section became false — 064d418
