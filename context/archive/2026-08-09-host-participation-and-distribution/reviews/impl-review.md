<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Host participation and distribution (S-04)

- **Plan**: context/changes/host-participation-and-distribution/plan.md
- **Scope**: Phases 1–5 (full plan)
- **Date**: 2026-08-09
- **Verdict**: NEEDS ATTENTION → RESOLVED (8 fixed, 2 skipped)
- **Findings**: 0 critical, 5 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Architecture passes on the points the slice was built around, and they are enforced structurally
rather than by comment: the two-function read split makes per-option data unreachable from the polled
path, the `superRefine` clause is what confines `revealedDistribution` to `question-revealed`, the
increments sit below the `HSETNX`, and `livequiz:tallies` is a registry entry so `end` and `purge`
reach it. All four were verified in the real store, not only in tests.

Every warning but two lives in one place: the `host.astro` poll loop — the only genuinely new runtime
shape this slice introduced, and the only part with no automated coverage.

## Findings

### F1 — The 401 path polls forever from a deliberately public page

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:520-524
- **Detail**: A `401` deliberately does not back off and reschedules at `POLL_BASE_MS` indefinitely.
  The stated reason is sound — a host who has not yet typed the secret, "the first thirty seconds" —
  but nothing bounds it. `/quiz/host` is unprotected by design (its own frontmatter says so), so any
  attendee who opens the host URL while a choice question is open runs a permanent 2.5 s poll. Each
  request is a Vercel invocation and emits one `session.auth.rejected` line — which `log.ts` calls
  "the only security-relevant signal this system emits". A few curious attendees at 0.4 lines/sec
  each would bury a real unauthorized attempt in the host's log during the segment. No Redis cost:
  `authorizeHost` precedes both reads, asserted by `participation.test.ts`.
- **Fix**: Allow N fast 401 retries (~5, covering the intended 30-second window), then fall back to
  the `pollFailed` backoff. The secret-field `input` handler already resets on the real fix, so
  recovery stays immediate.
  - Strength: Keeps the intended fast recovery for the real case while bounding the log-flood and
    invocation cost for the case the design did not consider.
  - Tradeoff: One more counter in a loop that already has a delay and a stale flag.
  - Confidence: HIGH — the backoff mechanism already exists; this reuses it.
  - Blind spot: Whether anyone but the host realistically opens `/quiz/host` during an event. The URL
    is not published, but it is guessable and the page is intentionally unguarded.
- **Decision**: FIXED — `UNAUTHORIZED_FAST_RETRIES = 5`; consecutive 401s past that back off like
  `pollFailed`, and the secret-field `input` handler resets both the counter and `pollDelay`.

### F2 — Overlapping in-flight polls; `finally` reschedules unconditionally

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:477-479, 556-558
- **Detail**: `schedulePoll` guards on `pollTimer !== null`, but the timer callback sets
  `pollTimer = null` *before* awaiting `runPoll`. So for the whole duration of a fetch there is no
  timer handle, and any `render()` — which fires on every snapshot, i.e. on every host action —
  schedules a new one. Chain: timer fires → `pollTimer = null` → `runPoll#1` awaits a slow fetch →
  snapshot arrives → `render()` → `schedulePoll()` sees `null` → schedules → 2.5 s later `runPoll#2`
  opens a **second concurrent** fetch while #1 is still open → #1's `finally` schedules a third.
  Timer count stays at 1, but in-flight requests are not bounded by that guard. It degrades exactly
  when the network is bad — which is when the backoff was supposed to reduce load, so the two work
  against each other. Related: the same `finally` reschedules even after `render()` has called
  `stopPolling()` because participation stopped applying (e.g. the host revealed mid-fetch), leaving
  one dead timer that early-returns without a fetch.
- **Fix**: Add a `let polling = false` set at the top of `runPoll` and cleared in its `finally`, and
  check it in `schedulePoll` alongside `pollTimer`; make the `finally` conditional on
  `participationApplies(client.current())`.
  - Strength: Closes both the overlap and the dead timer with one flag, and makes the guard mean what
    the code already assumes it means.
  - Tradeoff: One more piece of loop state to keep correct.
  - Confidence: HIGH — the chain is confirmed by reading; `pollTimer = null` at :478 is the cause.
  - Blind spot: Not reproduced live. In practice it is bounded by host-action frequency, so this is
    degradation under a bad network rather than a runaway.
- **Decision**: FIXED — added a `polling` in-flight flag checked by `schedulePoll` and by `runPoll`
  itself; every branch now simply returns and the `finally` is the single place a tick is re-armed,
  conditional on `participationApplies`.

### F3 — The secret field fires one poll per keystroke

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:660-668
- **Detail**: The `input` handler calls `stopPolling(); void runPoll();`. `input` fires per character,
  so correcting a 25-character secret while a choice question is open issues ~25 requests in a couple
  of seconds — 25 invocations and 50 Redis commands. `stopPolling()` prevents timer duplication but
  does nothing about concurrent in-flight fetches (see F2). Mitigating: in the lobby
  `participationApplies` is false and `runPoll` returns before the fetch, so the common
  type-the-secret-at-the-start case is free. The expensive case is a host fixing a mistyped secret
  mid-question — exactly the situation this handler was written for.
- **Fix**: Debounce the retry (~300 ms), or trigger on `change` rather than `input`.
- **Decision**: SKIPPED — materially mitigated by F2's fix rather than left open. The `polling` guard
  means a fast keystroke burst now issues one request, not one per character; the residue is a
  request per round trip while typing slowly, judged acceptable.

### F4 — `renderDistribution`'s docstring contradicts its body and the plan

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/client/render.ts:237-239 vs :263-269
- **Detail**: The plan specified that `answered: 0` "renders every bar at zero width rather than
  dividing by it". The implementation instead returns early with a Polish sentence and **no bars** —
  a defensible choice, and the test asserts the actual behaviour. But the docstring claims *both*:
  "renders every bar at zero width … and says so in words". The code does only the second. A comment
  that describes behaviour the function does not have is worse than no comment, and this one will be
  read by whoever extends the module in S-08.
- **Fix**: Correct the docstring to describe the early return, and state why a sentence beats zeroed
  bars (empty bars with no explanation read as broken rather than as unanswered).
- **Decision**: FIXED (docstring, not behaviour) — the comment now describes the early return and
  says why a sentence beats zeroed bars on a projector, and records that it diverges from the plan.

### F5 — `answer.ts` still states the pre-S-04 command cost inside its accepted-risk paragraph

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/quiz/answer.ts:17-18
- **Detail**: "this route bills 8 per call (a `readSession` plus a 7-command `EVAL`)". After this
  slice it bills 11 (`readSession` plus a 10-command `EVAL` at k = 1). This is the one place in the
  codebase still carrying the old number, and it is load-bearing: it sits in the paragraph arguing
  that leaving the route unauthenticated is "a bill rather than a nuisance", and the answer contract
  cites that reasoning. The bill is now ~38% larger than the sentence claims.
- **Fix**: Update the arithmetic to 11 and note the `k + 2` dependence on selected options.
- **Decision**: FIXED — the paragraph now states 11 per single-choice call, plus one per additional
  option, and names the `EVAL` going from 7 billed commands to `9 + k`.

### F6 — The plan's "start.ts and advance.ts need no edit" was wrong about advance.ts

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/api/quiz/host/advance.ts:53-58
- **Detail**: `advance.ts` builds a full `SessionState` literal, and Zod's `.default()` affects the
  *input* type while `SessionState` is the *output* type — so the file could not type-check without
  `revealedDistribution: null`. The plan's claim held for the `nextFrom` signature (both routes
  stayed synchronous) but not for the file. The edit was necessary and correct, and was flagged at
  the time; recorded here so the plan is not read later as ground truth on this point.
- **Fix**: None needed in code. Optionally note it in the plan.
- **Decision**: SKIPPED — no code issue; it was surfaced during implementation and is recorded here.

### F7 — Two sequential Upstash round trips on the one polled path

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/quiz/host/participation.ts:94, 112
- **Detail**: `readAnsweredCount` and `readPlayerCount` are awaited in sequence — two HTTP round
  trips on the path designed to be polled. Billed commands are unchanged (2 either way; folding them
  into an `EVAL` would make it 3 and is correctly avoided), but latency is doubled for free. Note
  this is the *opposite* trade from `READ_PLAYER_BY_ID` and `READ_ANSWER`, which combine reads into
  one `EVAL` — defensible given the billing model, but unstated, and the docstring's "Two billed
  commands" invites a future reader to "fix" it into an `EVAL` and make it three.
- **Fix**: `Promise.all` the two reads, and state in the docstring why this path deliberately does
  *not* combine them into an `EVAL`.
- **Decision**: FIXED — the two reads are now a `Promise.all`, with a docstring saying why this path
  deliberately does NOT fold them into an `EVAL` (it would make two billed commands three).

### F8 — `pagehide` stops the poll with no `pageshow` to restart it

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:657
- **Detail**: A bfcache restore (host navigates away and back) leaves the page showing a frozen count
  with no poll running and no staleness marker, until the next host action calls `render()`. It
  self-heals, but is silently misleading in between — the precise failure mode the staleness marker
  exists to prevent. Uncertain whether `visibilitychange` also fires on bfcache restore in the
  browsers used on stage; not tested.
- **Fix**: Add a `pageshow` handler calling `render()`.
- **Decision**: FIXED — added a `pageshow` handler calling `render()`.

### F9 — `json(401, unauthorized().body)` duplicates a status the outcome already carries

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/quiz/host/participation.ts:68
- **Detail**: Every other host route uses `toResponse(unauthorized())`. The local `json()` helper is
  itself justified — it adds `Cache-Control: no-store`, which `toResponse` does not — but hardcoding
  `401` beside `unauthorized()` means the two can drift.
- **Fix**: `json(unauthorized().status, unauthorized().body)`, or give `toResponse` an optional
  headers argument.
- **Decision**: FIXED — the status now comes from `unauthorized().status` instead of a retyped 401.

### F10 — `renderDistribution` takes five positional parameters where its sibling takes an options bag

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/client/render.ts:246-252
- **Detail**: `renderQuestion(container, question, options)` folds mode, selection, correctness and
  class names into one bag. `renderDistribution(container, question, distribution, correctOptionIds,
  classNames)` takes five positional parameters, two of them nullable and adjacent — so a call site
  can transpose `distribution` and `correctOptionIds` without a type error. In a module whose stated
  purpose is paying the no-framework cost once and *consistently*, this is worth aligning while there
  is one caller rather than after S-08 adds more.
- **Fix**: Collapse to `renderDistribution(container, question, options)` matching `renderQuestion`.
  - Strength: Removes the transposition hazard and restores the module's single convention.
  - Tradeoff: Touches the one call site and the render tests; pure churn if the signature never grows.
  - Confidence: MEDIUM — the hazard is real but has not bitten, and the tests would likely catch a
    transposition today.
  - Blind spot: Whether S-08's word-cloud aggregate wants this function at all, in which case the
    signature question is moot.
- **Decision**: FIXED — collapsed to `renderDistribution(container, question, options)` matching
  `renderQuestion`; `distribution` and `correctOptionIds` are now named fields and cannot be
  transposed. Call site and nine tests updated.
