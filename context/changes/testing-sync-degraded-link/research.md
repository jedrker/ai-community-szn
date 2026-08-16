---
date: 2026-08-16T17:44:27Z
researcher: Jedrzej Meder
git_commit: 354251ff644c9f76335476159a76ecfd3b88b897
branch: main
repository: ai-community-szn
topic: "Rollout Phase 2 — sync under a degraded link (test-plan risks #3 and #4)"
tags: [research, codebase, session-client, fallback-poll, answer-route, tallies, upstash, concurrency]
status: complete
last_updated: 2026-08-16
last_updated_by: Jedrzej Meder
---

# Research: Sync under a degraded link (test-plan risks #3 and #4)

**Date**: 2026-08-16T17:44:27Z
**Researcher**: Jedrzej Meder
**Git Commit**: `354251f`
**Branch**: `main`
**Repository**: ai-community-szn

## Research Question

Ground rollout Phase 2 of `context/foundation/test-plan.md`.

- **Risk #3** — a host transition reaches some phones and not others; the room desynchronises and
  nothing on stage indicates which devices are stuck.
- **Risk #4** — an answer submitted before the reveal is lost from the tally, or counted twice,
  under room-scale concurrency.

Verify — rather than accept — the plan's response guidance for each: what would prove protection,
the assumption to challenge, the context to ground, the cheapest useful layer, and the anti-pattern
to avoid.

## Summary

Both risks survive research, but **neither is shaped the way §2 states it**, and the corrections
change what Phase 2 should build.

1. **Risk #3's response guidance points at the wrong unit.** It prescribes "integration, with pinned
   interval randomness and manually-settled deferreds" — and that work already exists and is good.
   `createFallbackPoll` has 19 tests, pins `Math.random`, and holds a request genuinely open across
   an assertion in three of them (`src/lib/client/session.test.ts:544`, `:567`, `:582`). The cheap
   layer is close to saturated **for the loop**. What is uncovered is the thing the risk is actually
   about: **`createSessionClient` is never constructed in any test**, so the convergence rule itself
   — `apply`'s version guard — has no executing coverage at all. This is not a new discovery; the
   slice that built it recorded the same gap as accepted
   (`context/archive/2026-08-09-connection-limit-degradation/reviews/impl-review.md:202-208`).
   Phase 2's job is to close a named, still-open gap, not to invent one.

2. **Risk #3's second clause is not a test target.** "Nothing on stage indicates which devices are
   stuck" is confirmed true and is a *product* absence, not a defect a test can catch: attendees
   never report upward, and the host's only figure is `answered / joined`, which has at least three
   ordinary explanations. No test should be written against it; it belongs in the PRD or the runbook.

3. **Risk #4's "counted twice" is not reachable.** One `EVAL`, `HSETNX` above every `HINCRBY`, the
   answer field keyed `<questionId>:<playerId>` (`src/lib/session/store.ts:408-439`,
   `src/lib/session/answers.ts:150`). The lock and the write are one operation. A duplicate, a retry
   after a lost response, and a second tap are all refused without touching a counter.

4. **Risk #4's "lost" is real, and it is two different failures with different visibility** —
   neither exercised anywhere in this repo. (a) A reveal landing between the route's `readSession`
   and the script's own re-read produces a 409 that `src/lib/client/answer.ts:452-463` treats as
   **final**: the phone locks its control and believes it answered, while the store holds nothing.
   (b) `reveal.ts` reads the tallies **outside** the version guard, so an answer landing before the
   compare-and-set is in the hash but not in the published bars — the number on the projector.

5. **The layer question §6.2 deferred to this phase has an answer, and it is cheaper than feared.**
   `test-plan.md:213-217` asks "whether the ad-hoc store fake is sufficient for the ordering
   guarantees Risk #4 depends on". It is not — but **the failures that are actually uncovered sit at
   seams above the Lua**, so most of #4's real signal is reachable without solving "which store
   instance", which has no good answer today (no local Redis, `workers: 1` in Playwright, and the
   only real-store concurrency tool points at production).

## Detailed Findings

### Risk #3 — the fallback loop is well covered; the client that uses it is not

**The loop's mechanics, confirmed.** `src/lib/client/session.ts:422-438` arms a single
`window.setTimeout`, guarded four ways (`disposed`, `timer !== null || inFlight`, `shouldPoll()`,
`visibilityState === "hidden"`). It is re-armed in exactly one place — `tick`'s `finally`,
`session.ts:469-475`. Interval is `6_000 ± 1_500` (`session.ts:237-238`), doubling to a `20_000`
ceiling on failure and resetting on success (`session.ts:463-467`).

**Jitter is `Math.random` called directly** (`session.ts:403-407`) — no seed, no injected clock, and
`createFallbackPoll`'s deps are exactly `{ refresh, shouldPoll, onDegraded }` (`session.ts:386-390`).
The existing tests pin it with a global spy restored by hand (`session.test.ts:215`, `:219`), which
is the correct treatment under the happy-dom Proxy rule and matches `lessons.md:92-94`.

**The convergence rule is `version`, and only `version`** — `session.ts:525-534`:

```ts
const apply = (state: Snapshot, source: SnapshotSource): boolean => {
  if (state && current && state.version <= current.version) return false;
  current = state;
  lifecycle = advanceLifecycle(lifecycle, state);
  options.onSnapshot(state, source);
  return true;
};
```

Wholesale replacement, never a merge. `updatedAt` is not consulted by the client at all; there is no
sequence number and no per-source high-water mark. All three sources (`"fetch"`, `"realtime"`,
`"http"`) funnel through this one function — the join response at `index.astro:2140`, host action
responses at `host.astro:2891`. This is the spine contract's rule verbatim
(`context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md:34-38`: "Apply
whichever of the fetched snapshot and the subscribed snapshot carries the higher `version`; drop
anything not newer. That single rule makes the two sources safe to race").

**And it has no executing test.** `session.test.ts` covers three pure predicates
(`classifyConnection`, `shouldFallbackPoll`, `advanceLifecycle`) and `createFallbackPoll`. It never
constructs `createSessionClient`. Uncovered, each asserted only in prose comments:

| Property | Where | Covered? |
|---|---|---|
| `apply`'s version guard drops a non-newer snapshot | `session.ts:526` | no |
| `null` state applies regardless of version and latches `sessionOver` | `session.ts:504-511`, `:329-334` | no |
| `refresh`'s non-2xx throw and 10 s abort | `session.ts:536-553` | no |
| `close()` ordering (`connection.off` before `realtime.close()`, then `dispose`) | `session.ts:780-789` | no |
| `onConnectionChange`'s stop-on-connected / arm-otherwise branch | `session.ts:686-692` | no |
| channel-attach failure → `arm()` | `session.ts:758-761` | no |
| visibility / `pagehide` / `pageshow` listener wiring | `session.ts:624-656` | no |
| prime-before-subscribe order, failure non-fatal | `session.ts:697-715` | no |

The archive already named this and accepted it at the time —
`connection-limit-degradation/reviews/impl-review.md:202-208`: "Still uncovered and accepted for
now: `report()`'s status composition, **`apply`'s version-guard suppression**, `refresh`'s throw
path, and the `errorReason` precedence", and `:205`: "`createSessionClient` is never constructed in
any test."

**Three defect candidates found while grounding, in descending confidence:**

1. **A test that cannot fail for the reason it names** — `session.test.ts:567`, *"stop during an open
   request is resumable, unlike dispose"*. After `poll.stop()` and `settleInFlight()`, `tick`'s
   `finally` already calls `arm()` (`shouldPoll` is `() => true`, document visible), so the loop is
   re-armed **before** the test's own `poll.arm()` at `:577`, which is then a no-op. The assertion
   `refresh` = 2 holds identically whether `stop` is resumable-by-explicit-arm or simply
   undone-by-`finally`. It never asserts `isArmed()` between the settle and the arm — the one
   assertion that would distinguish them. This is exactly Risk #2's shape, inside the file the
   archive holds up as the remedy for Risk #2.

2. **`pause()` is undone by the `finally`.** `pause` is `() => clearTimer()` (`session.ts:484`) and
   sets no flag; `pagehide` calls it (`session.ts:646`). With a fetch open, a visible document and a
   live session, the `finally` re-arms past the pause. Practically bounded (real teardown kills the
   page; bfcache freezes the timer and `pageshow` would arm anyway), but mechanically it is the same
   defect class as impl-review F3, surviving in the one sibling of `stop`/`dispose` that was not
   given a terminal flag. `dispose`'s own docstring states the rule it is the exception to
   (`session.ts:361-366`).

3. **`client.close()` is never called anywhere in `src/`.** The terminal exit built by impl-review F3
   exists and is dead code in production — the same finding that slice made about its predecessor.

**Direction of travel this suggests:** the project's remedy for an untestable rule is extraction, not
a cleverer scan (`testing-host-control-rules/research.md:312-315`), and `shouldFallbackPoll` is
itself cited there as the precedent. `apply` is already a pure-enough decision to be lifted the same
way — but note the deliberate constraint that no Ably module mock may be introduced
(`connection-limit-degradation/plan-brief.md:40`: "a module mock would freeze the SDK's API and pass
against a real breakage"), which is a bound on any plan that reaches for `createSessionClient`
wholesale rather than for the decision inside it.

### Risk #4 — double-count impossible; loss real, at two seams above the Lua

**The write path is two round trips, one of them atomic.** `src/pages/api/quiz/answer.ts:128` reads
the session; `:142-151` gates on phase and question id; `:203` gates on the deadline; `:386` calls
`submitAnswer`, which issues exactly one `redis.eval` (`store.ts:1091-1110`). The script re-reads the
session and re-checks phase and question id itself (`store.ts:409-417`), takes the `HSETNX` lock
(`:423`), then increments the score and every tally family below it (`:427-432`).

**Why "counted twice" is not reachable.** Two `HSETNX` successes on one field is not expressible, and
no increment sits above the lock. The archive states the rule and the failure it prevents
(`host-participation-and-distribution/participation-contract.md:102-104`: "The increments sit below
the `HSETNX`… Above it, they would count a submission the lock then rejects"). A retry after a lost
response meets the lock and gets a 409; the already-scored first answer stands, and the retry's
different `elapsedMs` is discarded.

**Why "lost" is real, in two mechanisms:**

- **(a) The attendee-visible loss.** The reveal lands between `answer.ts:128` and the script's `GET`
  at `store.ts:409` → `{-2,0}` → `not-open` → 409. Nothing is written and the tally stays consistent
  — but `src/lib/client/answer.ts:452-463` maps **any** 409 without `refusal: "expired"` to
  `rejected`, which is final and calls `markSubmitted`. The phone locks its control and believes it
  answered. The window is one scoring pass plus one HTTP hop, and it is open for every device that
  submits near the close. Note the deliberate contrast: S-11 gave `expired` its own refusal class
  precisely so it would *not* take this path
  (`per-question-timer/timer-contract.md:113-119`: "It is not `rejected` on the client. That path
  calls `markSubmitted`…"). `not-open` at the reveal boundary was never given the same treatment.

- **(b) The projector loss.** `reveal.ts:110-114` reads the tallies before `applyHostAction` commits
  through the version guard (`host.ts:280` → `COMPARE_AND_SET`). An answer landing in that gap is in
  the hash and in `livequiz:tallies` but not in `revealedDistribution`. Accepted and documented at
  `reveal.ts:104-108` and `participation-contract.md:114-118` — but "at most a one-answer drift" is
  an assertion in a comment, not a bound the code enforces: the gap spans `readPlayerCount()`
  (`host.ts:265`, another round trip) plus the compare-and-set.

**The deadline is enforced at a different layer than the write, and this is deliberate.**
`isSubmissionExpired` runs only at `answer.ts:203`, against a value read at `:128`; the Lua has no
clock at all. `SUBMISSION_GRACE_MS = 2_000` (`deadline.ts:51`, applied `:89-99`). The rationale is on
record (`timer-contract.md:103-111`): the script re-checks *phase* because the host can advance
between read and run, whereas a deadline can only be crossed by time passing and the grace absorbs
that — "and the redis client is mocked throughout the suite, so a branch there would be the least
verifiable place for this rule." The consequence a test must respect: **the 2 s grace bounds the
decision moment, not the write**, and degenerate clocks fail toward acceptance
(`deadline.ts:95-97`).

**A trap for boundary fixtures, already lived once.** `per-question-timer/reviews/impl-review.md:202-217`
records a limit test that "passes only because of `SUBMISSION_GRACE_MS`, not because of the limit
difference it claims to demonstrate." Any Phase 2 boundary expectation must be computed from
`SUBMISSION_GRACE_MS` and the question's own limit, never from literals — and must assert the
fixtures' limits differ so the case cannot go vacuous.

**Do not conflate the two boundaries.** S-03 refused a grace at the *phase* boundary
(`answer-choice-question-and-reveal/plan-brief.md:43`: "a grace window would reopen the leak FR-005
was revised to close"); S-11 added one at the *deadline*, enforced in `answer.ts` only. A test that
treats them as one mechanism will assert a rule the project deliberately does not hold.

### What exists today, and what it can actually see

**`answer.test.ts`** (~90 tests) mocks the store at the module boundary
(`answer.test.ts:13-19`) and states its own limit at `:6-8` ("Atomicity is `store.test.ts`'s job").
`readSessionMock` returns the same value for the life of a test and `submitAnswerMock` never
disagrees with it — so the reveal-boundary window is never opened. **It would pass unchanged with the
`HSETNX` deleted and the increments hoisted above the lock.**

**`store.test.ts`** (68KB) calls the real `submitAnswer` against a mocked `Redis` class. `redis.eval`
is a `vi.fn()`: **the Lua is passed as a string argument and never executed**. Its atomicity
assertions are structural scans of that string — `toHaveBeenCalledTimes(1)` (`:943`),
`toContain("HSETNX")` / `.not.toContain("HSET ")` (`:973-983`), index ordering `firstTally > lock`
(`:1139-1153`). These would catch a refactor that deletes the lock token; they would not catch a Lua
change that keeps the tokens and breaks the semantics. The file admits it at `:1010-1015`: "Whether
150 concurrent submissions actually land 150 increments is invisible to this file by construction."
**The cheap layer here is saturated** — more mock-level tests would add assertions without signal.

**`scripts/rehearse-room.ts`** is the only place #4 is genuinely tested: `runAnswerBurst` (`:1303`)
fires 150 concurrent real submissions, and three audits check the answers hash, the scores hash and
both tally families for drift (`:1176`, `:1246`), plus an FR-004 re-submission 409 (`:1380-1400`).
It runs **by hand, against production**, and is wired to no gate. Critically: **it never reveals
during the burst** — it completes, then audits, then sends the duplicate. Interleavings (a) and (b),
the two the risk is actually about, are exercised by nothing anywhere.

**The store-instance problem, stated plainly.** There is no local or ephemeral Redis in this repo —
no docker-compose, no testcontainers, no emulator. Playwright is pinned `fullyParallel: false,
workers: 1` on measured evidence (`playwright.config.ts:33-48`), so the browser layer is
structurally single-threaded and cannot express a concurrent burst across specs. That leaves the one
shared production-ish database in `.env`, which the E2E rules already treat as a hazard requiring a
refuse-if-live precondition — and which impl-review F1 of the previous rollout phase showed can
destroy a live room when a cleanup hook misfires
(`testing-host-control-rules/reviews/impl-review.md:35-64`: "The guard written to protect a live room
is the thing that destroys it").

**The consequence for cost × signal:** the parts of #4 that need real Lua semantics are already
covered as well as this project can cover them, by a script that exists. The parts that are
**uncovered** — interleaving (a)'s client mapping, interleaving (b)'s read-outside-the-guard, and the
deadline decided against a stale read — sit **above** the Lua and need no real store at all. (a) is
reachable by letting the two existing mocks disagree, which no test currently does. (b) is reachable
at the `reveal.ts`/`host.ts` seam.

## Code References

- `src/lib/client/session.ts:422-438` — the single arm site and its four guards
- `src/lib/client/session.ts:469-475` — the one re-arm site (`tick`'s `finally`)
- `src/lib/client/session.ts:484-491` — `pause` / `stop` / `dispose`; only `dispose` is terminal
- `src/lib/client/session.ts:525-534` — `apply`: the version guard, untested
- `src/lib/client/session.ts:504-511` — the `null`-state wipe and its accepted cost
- `src/lib/client/session.ts:686-692` — connection-change stop/arm branch
- `src/lib/client/session.ts:780-789` — `close()`'s ordering; no caller in `src/`
- `src/lib/client/session.test.ts:226-283` — the deferred harness (`settleInFlight`)
- `src/lib/client/session.test.ts:567-580` — the test that cannot fail for its stated reason
- `src/lib/client/answer.ts:452-463` — any non-`expired` 409 → `rejected` (final) → `markSubmitted`
- `src/pages/api/quiz/answer.ts:128`, `:142-151`, `:203`, `:386` — read, phase gate, deadline gate, write
- `src/lib/session/deadline.ts:51`, `:89-99` — `SUBMISSION_GRACE_MS` and its application
- `src/lib/session/store.ts:408-439` — `SUBMIT_ANSWER`: the whole atomic unit
- `src/lib/session/store.ts:1091-1110` — the single `EVAL` call
- `src/lib/session/answers.ts:150` — the uniqueness key `<questionId>:<playerId>`
- `src/pages/api/quiz/host/reveal.ts:104-114` — the tally read outside the version guard
- `src/lib/session/store.test.ts:1010-1015` — the file's own statement of what it cannot see
- `scripts/rehearse-room.ts:1176`, `:1246`, `:1303` — the only real concurrency coverage
- `playwright.config.ts:33-48` — `workers: 1`, and why

## Architecture Insights

- **Every isolation-requiring invariant is a single `EVAL`**, because Upstash speaks HTTP and a
  read-then-write in TypeScript has no isolation (`store.ts:104-119`). The spine contract makes this
  a rule, not a habit (`spine-contract.md:16-21`).
- **`version` is the only convergence primitive** — for the client, for the harness, and for the
  compare-and-set. A test that reasons about convergence in terms of time or `updatedAt` is reasoning
  about a mechanism the client does not use.
- **The project's answer to an untestable rule is extraction** — `shouldPoll`, `countdown.ts`,
  `toast.ts`, `controls.ts`. Four precedents, each preceded by a source scan that failed to catch a
  real defect.
- **`pause` / `stop` / `dispose` are three different things**, and substituting one for another is a
  bug with no visible symptom (`connection-limit-degradation/plan.md:425-427`).

## Historical Context (from prior changes)

- `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md:34-38` — the version
  rule; `:7-21` the three non-reliances (no presence, no authoritative browser state, no read-then-write)
- `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md:112-113` — "**The
  write half is untested.** 'No lost answers' cannot be verified yet"
- `context/archive/2026-08-06-room-scale-rehearsal-harness/rehearsal-report.md:180-196` — 7 runs at
  N=150, zero lost snapshots, p95 111–592 ms against a 1000 ms budget; `:208-220` what it does not
  measure (no attendee writes, nothing renders, one process is a lower bound)
- `context/archive/2026-08-08-answer-choice-question-and-reveal/plan.md:314-341` — `HSETNX` makes the
  first answer final; the question-id check is not redundant with the phase check
- `context/archive/2026-08-08-answer-choice-question-and-reveal/plan-brief.md:43` — the *phase*
  boundary deliberately has no grace
- `context/archive/2026-08-09-host-participation-and-distribution/participation-contract.md:102-104`,
  `:114-124` — increments below the lock; the one-answer drift at reveal accepted and documented;
  "counter drift under real concurrency is invisible to the test suite"
- `context/archive/2026-08-09-connection-limit-degradation/reviews/impl-review.md:92-140` (F3, the
  `stop()`/`finally` defect), `:210-234` (F6, the fake-timer defects), `:202-208` (F5, the accepted
  `createSessionClient` gap)
- `context/archive/2026-08-14-per-question-timer/timer-contract.md:33-41`, `:103-111` — the 2 s
  grace, why it must never travel, and why the deadline is not in the Lua
- `context/archive/2026-08-16-testing-host-control-rules/reviews/impl-review.md:35-64` (F1, the
  cleanup hook that purged a live session), `:169-186` (F8, the hand-maintained table as residual risk)
- `context/foundation/lessons.md:72-99` — the timing lesson this phase is the direct heir of

## Corrections to the test plan (backport candidates for §2)

1. **Risk #4's wording overstates "counted twice."** Not reachable at `354251f`. Suggested reframe:
   *"An answer submitted just before the reveal is refused in a way the phone reports as answered, or
   is missing from the distribution the room sees."* Both halves are real and uncovered; the
   double-count half sends a plan hunting a defect that cannot exist.
2. **Risk #4's "likely cheapest layer" needs splitting.** "Integration at the store boundary" has no
   available instance. The uncovered failures are above the Lua and are reachable with the mocks that
   already exist; the below-the-Lua half is already at its practical ceiling via `rehearse-room.ts`.
3. **Risk #3's "must challenge" is satisfied, and a sharper one is available.** The
   fallback-loop-is-running assumption was already met by the deferred harness. The live assumption
   is *"the loop delivers, therefore the client converged"* — delivery and `apply` are different
   steps, and only the first has tests.
4. **Risk #3's second clause is not a test target.** The stage-side blindness is confirmed real and
   belongs in the PRD/runbook, not in a rollout phase.

## Open Questions

1. **Which store instance, if any?** Phase 2 can deliver real signal without answering this. If a
   plan still wants real-Lua coverage, the only options are extending `rehearse-room.ts` with a
   reveal-during-burst, or introducing an ephemeral Redis — the second is a stack change and belongs
   to Phase 4, not here.
2. ~~**Is interleaving (a) a defect to fix or a behaviour to pin?**~~ **Settled 2026-08-16: pin, do
   not fix.** A test proving the phone locks on a `not-open` 409 documents a real loss; giving that
   refusal its own class (as `expired` has) is a product change beyond a testing rollout's scope.
   The test asserts today's behaviour and the finding is raised for a change of its own. The reason
   is not only scope: a test written against already-repaired code has never been observed failing,
   which §1's fourth rule counts as *checked, not verified*.
3. **How far to go on `createSessionClient`?** Extraction of `apply` is cheap and matches four
   precedents; constructing the whole client is blocked by the no-Ably-mock rule. The plan must pick
   the seam.
4. ~~Should the `pause()`-undone-by-`finally` hole be fixed in this phase or reported?~~ **Settled
   2026-08-16 with (2): pinned, not fixed.** Same class as impl-review F3, same reasoning. Note the
   consequence for the test's wording — it asserts that `pause` is *not* terminal, which reads as
   endorsement unless the test says plainly that this is the recorded gap rather than the intent.
