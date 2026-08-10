# Connection-limit degradation — Implementation Plan

## Overview

Two fixes to what a LiveQuiz device does when it cannot open an Ably connection, most
plausibly because the free tier's 200 peak-connection ceiling is exhausted in a room
larger than ~180 people.

1. **Say the true thing.** The client currently discards the `ErrorInfo` Ably hands it and
   renders every non-`connected` state as one red "reconnecting" line. An account-limit
   rejection is not a flaky venue network, and the two need different words — and, on the
   host's screen, a different action.
2. **Keep the device in the game.** `/api/quiz/state` and `/api/quiz/answer` are plain HTTP
   and work fine for a device Ably refused. Today the view hides the answer controls anyway,
   so a dozen-plus attendees sit out the whole segment for a transport failure that never
   touched the paths they actually need.

## Current State Analysis

- `src/lib/client/session.ts:100-104` — `toStatus` folds Ably's five unhealthy connection
  states into `"lost"`. Correct as far as it goes, but the folding happens on `change.current`
  only: `change.reason` (an `ErrorInfo` carrying `code` and `statusCode`) is never read, and
  `onConnection` receives a bare state-name string.
- `src/pages/quiz/index.astro:289-294` — `lost` is checked before everything else and calls
  `hideAnswerControls()`. This is the line that removes a still-functional device from the quiz.
- `src/pages/quiz/host.astro:366-372` — the host prints `połączenie: ${detail}`, i.e. the raw
  Ably state name, in red. A host reading `disconnected` learns nothing about whether the fix
  is "wait" or "upgrade the Ably plan".
- `src/lib/client/session.ts:125-131` — `apply` drops any snapshot whose `version` is not
  higher and, crucially, **does not call `onSnapshot`** in that case. A poll that returns an
  unchanged state therefore triggers no re-render. This is what makes polling cheap in DOM
  terms as well as in requests.
- `src/pages/api/quiz/state.ts:76` — each fetch costs two Redis commands (`GET` + `HLEN`).
  Its docstring at lines 68-74 explicitly claims the endpoint is *"paced by connects and by
  the host, not by a timer"*. Phase 2 makes that false.
- `src/pages/quiz/host.astro:308-321` — declares itself *"THE PROJECT'S ONE SANCTIONED
  POLLING LOOP… Nothing else in this project polls"*. Phase 2 makes that false too. The same
  block is the best available template for the new loop: one timer only, never stacked behind
  an open request, skipped while the document is hidden, exponential backoff on failure,
  base/max constants named at the top.
- `src/lib/client/` has tests for `answer`, `render` and `boundary` — **`session.ts` has none.**
- No cap on participants exists anywhere in the server code; `join.ts` rejects only on
  invalid, taken, missing or closed. The ceiling is entirely Ably's.

### Key Discoveries:

- **Ably error `40111` is "Connection limits exceeded"** — the hard peak-connection limit;
  new connections are refused until existing ones drop
  (<https://faqs.ably.com/error-code-40111-connection-limits-exceeded>,
  <https://ably.com/docs/platform/errors/codes>). Ably's docs do **not** clearly commit
  40111 to `failed` versus `disconnected`, so discriminating on connection state would be a
  guess. Discriminating on `reason.code` is exact.
- **`elapsedMs` is measured from the local paint** (`index.astro:699`,
  `markSeen(config.seenStorageKey, questionId)`), not from the host's advance. A polled device
  therefore starts its clock up to one poll interval late and honestly earns fewer speed
  points. Per `context/foundation/lessons.md:5-10`, this is exactly the promise-versus-data-path
  gap that has to be traced before it is shipped: it is being **stated in the UI**, not fixed
  in the scorer.
- **`src/lib/client/boundary.test.ts`** scans these files. Nothing in this change may
  value-import from `src/quiz/` or `src/lib/session/`, or read `import.meta.env` — the new
  constants live in `session.ts` itself and Polish copy lives in the views.
- `happy-dom` is selected per file by a `// @vitest-environment happy-dom` docblock
  (CLAUDE.md); the new test needs it for `window.setTimeout` and `document.visibilityState`.

## Desired End State

A device that Ably refuses because the account's connection limit is exhausted:

- shows an amber "backup mode" banner, not a red failure;
- receives the host's question within ~6 seconds of everyone else;
- can still select, type and submit an answer, and still sees the reveal;
- is told, in one sentence, that its speed points may be lower;
- falls back to the existing red "lost" screen if the fallback itself stops working.

The host's own screen names the cause when it is an account limit, so the person who can act
on it knows whether to wait or to raise the plan.

Verified by: `bun run test`, `bun run type-check`, and a manual two-browser run where Ably is
made to fail (block `realtime.ably.io` in devtools) while `/api/quiz/state` stays reachable.

## What We're NOT Doing

- **Not adding a participant cap or a lobby queue.** Refusing at `join.ts` would trade a
  degraded player for no player.
- **Not throttling `/api/quiz/token`.** Rejected during F-02 planning for the venue-NAT reason
  recorded in `context/foundation/infrastructure.md:273`; unchanged here.
- **Not touching scoring.** No new field on `/api/quiz/answer`, no branch in
  `src/lib/session/scoring.ts`, no client-side compensation of `elapsedMs`.
- **Not changing `/api/quiz/state`'s response shape**, and not adding a "skip the `HLEN`"
  parameter. Halving 2 commands to 1 does not change any verdict below.
- **Not updating `context/foundation/infrastructure.md`.** The 200-connection risk row and the
  open-token row still describe real risks; re-scoring their impact is a separate call.
- **Not raising the Ably plan.** That is an account action, not a code change, and it remains
  the only real fix for a room over ~180.

## Implementation Approach

Phase 1 is pure classification and copy: carry `reason.code` through to the views and let each
one say something specific. It ships and helps on its own, with no behavioural change beyond
the words on screen.

Phase 2 adds a fourth `ConnectionStatus`, `degraded`, and a polling loop inside `session.ts`
so both views get it from one implementation. The loop is modelled directly on the host's
existing participation poll. The attendee view stops hiding its controls in that state.

The order is forced: Phase 2 needs Phase 1's cause to decide whether a fallback is worth
starting, and Phase 1 alone is deployable before the next event.

## Critical Implementation Details

**Optimistic degraded is wrong; earned degraded is right.** The status must stay `lost` when
Ably drops, and become `degraded` only after the *first successful poll*. Announcing a backup
mode before it has been shown to work would put a calm amber banner on a device that is simply
offline — the same class of lie this change exists to remove.

**Two docstrings assert the property Phase 2 removes.** `state.ts:68-74` ("not paced by a
timer") and `host.astro:308-321` ("the project's one sanctioned polling loop") both become
false. Neither is decoration: the runbook's Upstash command counter is described as a *polling
detector*, so a reader who trusts them will diagnose the next command-count anomaly against a
model that no longer holds.

---

## Phase 1: Classify the disconnect cause

### Overview

Read the `ErrorInfo` Ably already provides, map account-limit error codes to a distinct cause,
and give each view its own sentence for it. No change to what is hidden or shown.

### Changes Required:

#### 1. Connection classification

**File**: `src/lib/client/session.ts`

**Intent**: Stop discarding `change.reason`. Introduce a cause alongside the status so a view
can distinguish "the account's limits are exhausted" from "the network wobbled", and expose the
mapping as a pure function so it can be tested without an Ably instance.

**Contract**: New exported type `ConnectionCause = "account-limit" | "transient" | null`. New
exported pure function `classifyConnection(state: string, code: number | undefined):
{ status: ConnectionStatus; cause: ConnectionCause }` — `status` keeps `toStatus`'s existing
mapping; `cause` is `"account-limit"` when `code` is in the account-limit set, otherwise
`"transient"` when `status === "lost"`, otherwise `null`. `toStatus` folds into this function
rather than living beside it. The account-limit set is a module-level `const` of
`[40111, 40115, 42910, 42911]` — connection limit, account restricted, and the two rate-limit
codes — each named in a comment with what it means, since the numbers are unreadable otherwise.

`onConnection`'s signature changes from `(status, detail: string)` to
`(status: ConnectionStatus, info: { detail: string; cause: ConnectionCause })`. Both call sites
are updated in this phase. `detail` keeps carrying the raw Ably state name the host already
prints.

#### 2. Attendee copy

**File**: `src/pages/quiz/index.astro`

**Intent**: The `lost` branch currently promises "próbujemy połączyć ponownie" — which for an
account-limit rejection may be a promise the SDK will not keep. Give that cause its own line,
without naming Ably or blaming the room.

**Contract**: The module-scope `connection` variable gains a sibling holding the cause; the
`lost` branch at `index.astro:289` picks between the existing transient text and a new
account-limit text. Copy is Polish and neutral: no mention of limits, plans or a full room —
the attendee cannot act on any of it. Everything else in the branch, `hideAnswerControls()`
included, is unchanged in this phase.

#### 3. Host diagnostic line

**File**: `src/pages/quiz/host.astro`

**Intent**: The host is the one person who can act, so this is where the cause is named
explicitly, error code included, so it can be matched against Ably's dashboard and this plan.

**Contract**: `onConnection` at `host.astro:366` takes the new object parameter. On
`cause === "account-limit"` the `#connection` element reads as a limit-exhausted message
carrying the numeric code; otherwise it keeps today's `połączenie: ${detail}`. Colour rule is
unchanged (red for anything but `connected`).

#### 4. Tests for the classifier

**File**: `src/lib/client/session.test.ts` (new)

**Intent**: `session.ts` has no test at all today, and a lookup table of error codes is exactly
the thing that rots silently. Cover the mapping directly rather than through an Ably mock.

**Contract**: Table-driven cases over `classifyConnection`: each of the four account-limit
codes yields `cause: "account-limit"`; an unhealthy state with an unrelated or absent code
yields `"transient"`; `connected` and `connecting` yield `null` and the statuses they map to
today. Per `context/foundation/lessons.md:48-70`, each case asserts the *pair* returned, so a
test cannot pass by reaching the wrong branch with a coincidentally right status.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` still passes with the edited `<script>` blocks
- `session.test.ts` covers all four account-limit codes and the absent-code case

#### Manual Verification:

- With Ably reachable, host and attendee screens read exactly as they do today
- With `realtime.ably.io` blocked in devtools, the attendee sees the transient wording (not the
  account-limit wording) — a blocked host is not a limit
- Host's `#connection` line is legible from projector distance

**Implementation Note**: After completing this phase and all automated verification passes,
pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Degrade to polling instead of sitting out

### Overview

A fourth status, a polling loop in the shared client, and an attendee view that keeps its
answer controls while that loop is working.

### Changes Required:

#### 1. The `degraded` status and the fallback loop

**File**: `src/lib/client/session.ts`

**Intent**: When Ably is unavailable but HTTP is not, keep the snapshot fresh by re-fetching
`/api/quiz/state` on a timer, and report the resulting half-healthy condition as its own status
so views can render it as neither fine nor broken.

**Contract**: `ConnectionStatus` gains `"degraded"`. `SessionClientOptions` gains
`readonly fallbackPolling?: boolean` (default off, so the type change is additive).
Module constants: `POLL_BASE_MS = 6_000`, `POLL_JITTER_MS = 1_500`,
`POLL_FAILURES_BEFORE_LOST = 2`.

Loop rules, following `host.astro:517-534` and `host.astro:636-643`:

- Armed when `classifyConnection` yields `lost` and `fallbackPolling` is on; cancelled the
  moment Ably reports `connected`, and by `close()`.
- One `window.setTimeout` at a time. Never armed while a `refresh()` is in flight; re-armed in
  exactly one place, the `finally` of the poll.
- Delay is `POLL_BASE_MS ± POLL_JITTER_MS`, randomised per tick. Jitter matters because every
  refused device is refused within the same second, and a fixed interval would keep them in
  lockstep for the whole segment.
- Skipped while `document.visibilityState === "hidden"`, re-armed on `visibilitychange`.
- Stops when the held snapshot's `phase` is `"ended"` — nothing further will change, and this
  is what bounds the spend of a device left open on a table after the session.
- **Status is earned, not assumed**: stays `lost` until the first poll succeeds, then
  `degraded`. `POLL_FAILURES_BEFORE_LOST` consecutive failures return it to `lost`; the loop
  keeps running so a device can climb back to `degraded`.
- Each transition reports through the existing `onConnection` with
  `cause` carried forward from the Ably rejection and `detail` naming the fallback.

Command budget, to be recorded in the docstring: 2 Redis commands per poll. ~20 refused devices
over a 15-minute segment ≈ 7k commands. The worst case — Ably unreachable for an entire
220-device room — is ≈ 66k, against a 500k/month free tier. Both are inside the tripwire, and
saying so is what stops the next reader treating the loop as the runaway it is watching for.

#### 2. Attendee view keeps playing

**File**: `src/pages/quiz/index.astro`

**Intent**: Stop treating a working fallback as a dead device, and say plainly that it is a
fallback — including the one honest cost, lower speed points.

**Contract**: The guard at `index.astro:289` narrows to `lost` only; `degraded` falls through to
the normal rendering path. A new static element in the `#follow` section — sibling of
`#follow-status`, styled amber — is shown only in `degraded` and hidden otherwise; it is static
markup rather than something `renderQuestion` emits, for the same reason `#answer-text` is
(`index.astro:108-113`): the question container is rebuilt by `replaceChildren()`.

Copy states three things in one or two sentences: the game still works, updates arrive every few
seconds, and time-based points may be lower. `createSessionClient` is constructed with
`fallbackPolling: true`.

No change to `sendAnswer`, `markSeen`, `hasSubmitted` or the result fetch. They are HTTP and
already work in this state — that is the premise of the whole phase.

#### 3. Host view opts in

**File**: `src/pages/quiz/host.astro`

**Intent**: The host is the single device whose failure stops the room, and its actions already
return authoritative state over HTTP, so the fallback degrades cleanly there too.

**Contract**: `fallbackPolling: true` on the client, and the `#connection` line gains a
`degraded` rendering (amber, naming the backup mode) distinct from both `connected` and `lost`.
The existing participation poll is untouched and may run concurrently; note in a comment that
the two loops are independent and bounded differently.

#### 4. The two docstrings this phase invalidates

**Files**: `src/pages/api/quiz/state.ts`, `src/pages/quiz/host.astro`

**Intent**: Both assert the project has no timer-driven read. Leaving them would send the next
reader to the wrong conclusion about a command-count anomaly.

**Contract**: `state.ts:68-74` gains the fallback as a named, bounded second caller with the
budget figures above. `host.astro:308-321` stops claiming to be the only polling loop and points
at `session.ts` for the other one, keeping its own bound intact.

#### 5. Runbook

**File**: `docs/runbook-live-session.md`

**Intent**: Give the host a symptom-to-action entry, since the tripwire in
`context/foundation/infrastructure.md:272` already names them as owner, per event.

**Contract**: An entry under `## If something breaks` — symptom (attendees reporting the amber
backup banner, or the host's own connection line naming the limit), immediate action (nothing;
the session continues degraded), and the real fix (raise the Ably plan before a room this size,
not during it). Also note that a degraded device scores lower on speed, so a leaderboard
question from the floor has an honest answer.

#### 6. Tests for the loop

**File**: `src/lib/client/session.test.ts`

**Intent**: A timer that outlives its purpose is the specific failure mode the command tripwire
exists to catch, so the lifecycle is what gets asserted — not just that a poll happens.

**Contract**: `// @vitest-environment happy-dom` docblock (per CLAUDE.md; the suite default is
`node`). Fake timers plus a stubbed `globalThis.fetch`. Cases: first successful poll moves
`lost` → `degraded`; two consecutive failures move it back to `lost`; a success after that
returns it to `degraded`; Ably reporting `connected` cancels the timer; `close()` cancels the
timer; a `phase: "ended"` snapshot stops the loop; no second timer is ever armed while a poll is
in flight; and a poll returning an unchanged `version` fires no `onSnapshot`. Assert on the
statuses emitted and on the fetch call count, so a test cannot pass against a loop that never
armed. Restore any spy on a global by hand — `answer.test.ts`'s `withBrokenWrite` is the pattern
CLAUDE.md points at, and `vi.restoreAllMocks()` is not sufficient for globals under happy-dom.

### Success Criteria:

#### Automated Verification:

- Test suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — no new value import from `src/quiz/` or `src/lib/session/`, no
  `import.meta.env` read in either edited `<script>` block
- `session.test.ts` asserts timer cancellation on `connected`, on `close()`, and on `ended`

#### Manual Verification:

- With `realtime.ably.io` blocked in devtools on one phone and reachable on another: the blocked
  device shows the amber banner, receives each new question within ~7 s, and can submit an answer
  that the host's participation count registers
- The blocked device's reveal panel shows a verdict and a running total
- Advancing between two text questions on the blocked device does not clobber a partly typed
  answer (the `data-question-id` guard at `index.astro:485` still holds under polling)
- Unblocking the connection returns the device to normal and the banner disappears
- Putting the blocked device's browser in the background stops the polling (verify in the
  network tab) and resumes it on return
- After the host ends the session, the blocked device issues no further `/api/quiz/state` requests
- Upstash command counter after a rehearsal is within the budget recorded in the docstring

---

## Testing Strategy

### Unit Tests:

- `classifyConnection`: all four account-limit codes, an unrelated code, an absent code, and each
  healthy state — asserting the `{ status, cause }` pair
- Fallback loop: the full status lifecycle, timer cancellation on every exit path, single-timer
  invariant, and the no-render-on-unchanged-version property

### Integration Tests:

None. The seam that matters is Ably's connection behaviour, which the project deliberately does
not mock end-to-end — `session.test.ts` covers the loop, and the manual run covers the seam.

### Manual Testing Steps:

1. Two devices on `/quiz`, one with `realtime.ably.io` blocked in devtools.
2. Host advances through a choice question, a text question and a reveal.
3. Confirm on the blocked device: amber banner, question arrives, answer submits, reveal shows.
4. Background the blocked device's browser for 30 s; confirm no polls, then confirm resumption.
5. Unblock; confirm the banner clears and updates return to instant.
6. End the session; confirm polling stops.

## Performance Considerations

Two Redis commands and one Vercel invocation per poll, per degraded device. Budgets are in
Phase 2 change 1 and are recorded in `state.ts`'s docstring so the numbers live next to the
endpoint that pays them. The jitter exists to keep the refused cohort from re-synchronising —
without it every device refused in the same second polls in the same second, forever.

The loop does no DOM work when nothing changed: `apply` (`session.ts:125-131`) suppresses
`onSnapshot` on a non-newer version, so an idle poll costs a fetch and nothing else.

## Migration Notes

None. No stored data, no schema, no key, no published-snapshot field changes. Both phases are
client-only plus documentation, and either can be reverted by reverting its commit.

## References

- Ably error 40111: <https://faqs.ably.com/error-code-40111-connection-limits-exceeded>
- Ably error codes: <https://ably.com/docs/platform/errors/codes>
- Connection-limit risk row: `context/foundation/infrastructure.md:272-273`
- Polling loop to model: `src/pages/quiz/host.astro:308-334`, `:517-534`, `:636-643`
- Affordance-versus-data-path lesson: `context/foundation/lessons.md:5-10`
- Branch-reaching-fixture lesson: `context/foundation/lessons.md:48-70`

## Addenda — decisions taken during implementation and review

Recorded here because the plan is the document the next author reads as ground truth.

1. **The loop lives in an exported `createFallbackPoll`, not inside `createSessionClient`.** The
   plan put it inside the client; a loop whose only entry point is an Ably callback can be tested
   only by mocking the SDK, and a mock of a third-party client keeps passing after a real upgrade
   breaks production. `createSessionClient` wires it up.
2. **Views compose the wording; the client reports the status.** The Phase 2 contract said `detail`
   would name the fallback. It does not — `info` passes through untouched and `host.astro` prepends
   "tryb zapasowy —". The rule is: **`status` is what a view branches on**, and Polish copy stays in
   the views, which is also what keeps `detail` free to carry Ably's own words. A third view must
   compose its own wording from the status.
3. **`detail` is a display string, not a state name.** Three producers: Ably's state name,
   `channel-failed`, and a failed prime's error text. Never parse it.
4. **The lifecycle latch is sticky, and the cost is a reload.** Polling stops for good once a
   session has been seen and then ends or is purged. A host who purges and restarts mid-event
   leaves a *degraded* device on "To już koniec" until the attendee reloads. Chosen over unbounded
   command spend after every session on every phone left open. See `advanceLifecycle`.
5. **`pause` / `stop` / `dispose` are three different things** and substituting one for another is a
   bug with no visible symptom: `pause` for a quiet page (keeps the status), `stop` for a recovered
   channel (drops it), `dispose` for teardown (terminal, survives an in-flight tick's re-arm).
6. **Failure kinds are deliberately not named.** Unlike `answer.ts`, every failure of
   `/api/quiz/state` means "try again" to this loop, so there is no per-kind action to take.
7. **A channel that fails after a successful attach is still invisible** — only the attach
   rejection is caught. Folding channel state into `transportStatus` is follow-up work, not part of
   this change.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Classify the disconnect cause

#### Automated

- [x] 1.1 Test suite passes: `bun run test` — a24a7ce
- [x] 1.2 Type checking passes: `bun run type-check` — a24a7ce
- [x] 1.3 `boundary.test.ts` still passes with the edited `<script>` blocks — a24a7ce
- [x] 1.4 `session.test.ts` covers all four account-limit codes and the absent-code case — a24a7ce

#### Manual

- [x] 1.5 With Ably reachable, host and attendee screens read exactly as they do today — a24a7ce
- [x] 1.6 Blocked `realtime.ably.io` shows the transient wording, not the account-limit wording — a24a7ce
- [x] 1.7 Host's `#connection` line is legible from projector distance — a24a7ce

### Phase 2: Degrade to polling instead of sitting out

#### Automated

- [x] 2.1 Test suite passes: `bun run test` — 903a8e9
- [x] 2.2 Type checking passes: `bun run type-check` — 903a8e9
- [x] 2.3 `boundary.test.ts` passes — no forbidden import or env read in either `<script>` block — 903a8e9
- [x] 2.4 `session.test.ts` asserts the loop's cancellation seam (`stop`/`dispose`), plus the `shouldFallbackPoll` and `advanceLifecycle` predicates that bind `fallbackPolling` and the end of the session to it — 903a8e9, corrected during impl review (F5)

#### Manual

- [x] 2.5 Blocked device shows the amber banner, receives questions within ~7 s, and submits an answer the host's count registers — 903a8e9
- [x] 2.6 Blocked device's reveal panel shows a verdict and a running total — 903a8e9
- [x] 2.7 A partly typed text answer survives a poll and a question change — 903a8e9
- [x] 2.8 Unblocking returns the device to normal and clears the banner — 903a8e9
- [x] 2.9 Backgrounding stops the polling; returning resumes it — 903a8e9
- [x] 2.10 After the host ends the session, no further `/api/quiz/state` requests are issued — 903a8e9
- [x] 2.11 Upstash command counter after a rehearsal is within the recorded budget — 903a8e9
