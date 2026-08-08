<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Attendee answers a choice question and learns their result

- **Plan**: `context/changes/answer-choice-question-and-reveal/plan.md`
- **Scope**: Full plan — Phases 1–5
- **Date**: 2026-08-08
- **Verdict**: REJECTED at review; all 10 findings triaged and FIXED (see Decisions)
- **Findings**: 1 critical, 6 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run at review time: `bun run test` 533/533, `bun run type-check` 0 errors,
`bun run build` succeeds. No manual row is checked without evidence — nine are honestly pending
against a deploy.

## Findings

### F1 — A 503 from the answer route locks the question and tells the attendee it was saved

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/client/answer.ts:125 and src/pages/quiz/index.astro:472
- **Detail**: `submitAnswer` maps *any* non-`ok` response carrying an `error` string to
  `{outcome: "rejected"}`. But `/api/quiz/answer` returns `503 {error: "Nie udało się zapisać
  odpowiedzi. Spróbuj ponownie."}` for both `unconfigured` and store `failed` — nothing was written.
  The view treats `rejected` as final: `submitted.add(questionId)`, which makes `renderOpen` render
  `locked`, hide the submit button, and print "Odpowiedź zapisana. Czekamy na prowadzącego…" *beside*
  a red line telling the attendee to try again. There is no way back — the control is gone until the
  host advances, and at reveal `submitted.has(id)` is true so a result is fetched for an answer that
  does not exist. One Upstash blip during a 150-device burst costs that attendee the question, while
  telling them the opposite.
  This is the exact `failed`-vs-`rejected` conflation `store.ts`'s `LookupResult` docstring and this
  module's own header call out; the distinction exists in the type and is discarded at the branch.
- **Fix**: In `submitAnswer`, return `{outcome: "failed"}` for any 5xx regardless of an error body,
  and keep `rejected` for the 409/404 classes that are genuinely final.
  - Strength: One branch, in the module that already documents why the two must stay apart; the view
    needs no change because its `failed` path already re-enables the control.
  - Tradeoff: The server's Polish 503 message is dropped in favour of the client's generic one.
  - Confidence: HIGH — reproduced by reading both call sites; the 503 branches are `answer.ts:186`
    and `answer.ts:192`.
  - Blind spot: `answer.test.ts` covers rejection and network failure but not a 5xx-with-body, so the
    fix needs a test alongside it.
- **Decision**: FIXED — 5xx now returns `failed` before the body is read; regression tests for 5xx-with-body and for a 409 still being a refusal.

### F2 — `showResult` ignores `answered: false` and reports a wrong answer

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/quiz/index.astro:433
- **Detail**: The result payload's `answered` field is never read. A 200 with
  `{answered: false, correct: null}` renders "Tym razem nie." and "+0 pkt". Reachable because
  `sendAnswer` adds the question to `submitted` on the **rejected** path too, so a device refused
  `not-open` (or hit by F1) fetches at reveal, is told `answered: false`, and is shown a wrong-answer
  verdict for a question it never got to answer. The plan says the opposite at plan.md:602: "A device
  that never answered sees the correct answer and no verdict."
- **Fix**: Branch on `own.answered` first — hide the result panel (or show a neutral "brak
  odpowiedzi" line with the running total) when it is false.
- **Decision**: FIXED — `showResult` branches on `answered` first and shows a neutral line plus the running total.

### F3 — The seen-timestamp store is never cleared, so a returning device scores at the floor

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/client/answer.ts:76, src/lib/client/player.ts:88
- **Detail**: `livequiz:seen` is written per question id and removed by nothing — not `clearPlayer`
  (which only removes the player key), not the `ended` phase, not a 404 resume. Question ids in
  `definition.ts` are stable across sessions. So a host who purges and restarts mid-event, or an
  attendee returning to a second meetup on the same phone, hits `markSeen` returning a timestamp from
  the previous session: `elapsedMs` is enormous, `clampElapsed` caps it at the server window, and
  every correct answer is worth the 0.5 floor. Silent — no signal to the attendee or the host.
- **Fix A ⭐ Recommended**: Clear the seen map wherever `clearPlayer` is called and on the `ended`
  transition.
  - Strength: Small, and it reuses the lifecycle hooks that already exist for the player record.
  - Tradeoff: Two call sites to keep in step; a purge that the device never observes still leaves it.
  - Confidence: MEDIUM — covers the realistic paths, not every one.
  - Blind spot: A device that never sees `ended` (closed tab) keeps stale entries.
- **Fix B**: Key the stored entries by `state.startedAt` so a new session structurally cannot read an
  old one's paints.
  - Strength: Correct by construction — no lifecycle hook to forget.
  - Tradeoff: `markSeen` needs the session's `startedAt` threaded through from the view.
  - Confidence: HIGH on correctness, MEDIUM on churn.
  - Blind spot: Grows the stored object across sessions unless old keys are pruned.
- **Decision**: FIXED via Fix A — `clearSeen` added and called on the `ended` transition and beside `clearPlayer`.

### F4 — `optionIds` is unvalidated and unbounded, and the record is never schema-parsed before the write

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/quiz/answer.ts:58, src/lib/session/store.ts (submitAnswer)
- **Detail**: `form.getAll("optionIds")` is filtered only for non-empty strings — not against the
  question's real option ids, not for count, not for length — and the array is stored verbatim in the
  answers hash. `submitAnswer` accepts a typed `AnswerRecord` but never runs `answerRecordSchema`
  before `JSON.stringify`, while the read path does parse. Two consequences: an open endpoint lets
  any holder of a player id write an arbitrarily large value per question into Redis (the route's
  accepted-risk note reasons about command *count*, not payload size); and a record that fails the
  schema round-trips as `null` at read, so `result.ts` reports `answered: false` to a device that
  watched its answer land. Structurally, this is the gap against `join.ts`, which validates before
  touching the store — `players.ts` owns an input validator and `answers.ts` has no equivalent.
- **Fix**: Intersect `optionIds` with the question's own option ids before scoring and storing, and
  parse with `answerRecordSchema` in `submitAnswer` before the `EVAL`.
  - Strength: Closes both consequences at once and puts the validator where `players.ts` puts its own.
  - Tradeoff: A few lines in the route plus one parse on the hot path.
  - Confidence: HIGH — the question's options are already in hand at that point in the route.
  - Blind spot: Unknown ids currently just fail correctness, so scoring is not wrong today — only the
    stored payload is unbounded.
- **Decision**: FIXED — the route intersects `optionIds` with the question's own ids and de-duplicates; `submitAnswer` parses with `answerRecordSchema` before the EVAL.

### F5 — `clampElapsed` fails toward the maximum award on a negative server window

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/session/scoring.ts:126
- **Detail**: `if (!Number.isFinite(serverElapsedMs) || serverElapsedMs < 0) return 0;` — and
  `speedWeight(0)` is 1.0, i.e. full points. Five lines below, the sibling guard for a garbage
  *client* value deliberately fails to the floor with the comment "Garbage should not be rewarded".
  The two nonsense-input branches fail in opposite directions. `now - updatedAt` goes negative on
  clock skew between the instance that handled `advance` and the one handling the answer.
  This is the failure mode `lessons.md`'s new entry — added by this very change — exists to prevent.
- **Fix**: Return `SPEED_WINDOW_MS` (floor weight) rather than `0`, matching the branch below it.
- **Decision**: FIXED — returns `SPEED_WINDOW_MS`, so both nonsense-input branches now fail toward the floor.

### F6 — The in-flight guard is module-scope and neither fetch has a timeout

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/client/answer.ts:103
- **Detail**: `inFlight` is module scope — not per question, not per call — and neither `fetch`
  carries an `AbortSignal.timeout`, which `scripts/rehearse-room.ts` sets on every call for exactly
  this reason. It is reset in `finally`, so it cannot leak on error, but a request hanging on a venue
  network holds it until the browser's own timeout, which can span a host advance. During that window
  every tap on the *next* question returns `{outcome: "failed"}` instantly and the view shows a
  network error that is not one. `session.ts` keeps its mutable state in a `createSessionClient`
  closure; this module diverges from that.
- **Fix**: Scope the guard per question id and add `AbortSignal.timeout(...)` to both fetches.
  - Strength: Removes the cross-question coupling and bounds the window; matches `session.ts`.
  - Tradeoff: Slightly more state in the module, or a factory refactor.
  - Confidence: HIGH on the timeout, MEDIUM on how far to take the scoping.
  - Blind spot: The concurrent-call branch is the one case `answer.test.ts` does not cover.
- **Decision**: FIXED — the guard is a `Set` keyed by question id, and both fetches carry `AbortSignal.timeout(10_000)`.

### F7 — A reload during the reveal loses the verdict and the attendee's own selection

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/index.astro:199
- **Detail**: The seen timestamp is deliberately persisted; `submitted`, `selections` and `results`
  are in-memory only. After a reload, `renderRevealed` hits `!submitted.has(question.id)` and hides
  the result panel entirely, and the empty `selections` means the attendee's own pick is unmarked —
  so someone who answered, reloaded, and is watching the reveal sees the correct answer and nothing
  about themselves, including a running total the server would happily serve. Related: reloading
  during `question-open` after answering re-offers the controls, and the resubmit's 409 lands in the
  red error line rather than the neutral confirmation.
  Note the scope overlap: the roadmap assigns "score-intact resume across reconnects" to **S-09**, so
  part of this may be deliberate deferral rather than a defect — but the plan does not say so.
- **Fix**: Drive the reveal panel from the fetch result rather than from local `submitted` (the
  server already knows whether this device answered), and persist `selections` beside the seen map.
  - Strength: Uses the authority that already has the answer; removes one in-memory dependency.
  - Tradeoff: Issues a result fetch for devices that stayed silent, which the plan deliberately
    avoided to cut the reveal fan-in.
  - Confidence: MEDIUM — the fan-in tradeoff is real and was a stated design decision.
  - Blind spot: Whether S-09 intends to own this; worth checking before spending effort here.
- **Decision**: FIXED — `submitted` is persisted in the seen store (`markSubmitted` / `hasSubmitted`), which keeps the fan-in gate intact; the older bare-number shape is still read.

### F8 — `/api/quiz/result` emits no session events and drops the failure reason

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/quiz/result.ts:81
- **Detail**: Every other route in the slice logs its accepted and rejected classes, and
  `SESSION_EVENTS` is explicitly the closed vocabulary a host greps during a segment. This is the
  densest fan-in path in the project (150 devices × 12 scored questions) and it is silent, so a host
  cannot see whether result fetches are landing. `console.error("Result read failed")` also drops
  `result.reason`, unlike the answer route.
- **Fix**: Log the reason on the 503 path; decide deliberately whether a per-fetch event is worth
  150 lines per reveal (it may well not be — but the silence should be a decision, not an omission).
- **Decision**: FIXED — the 503 logs its reason, and the absence of a per-fetch event is now recorded as a decision in the module docstring with its reasoning.

### F9 — `happy-dom` is not recorded in CLAUDE.md

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: package.json
- **Detail**: A devDependency the plan did not ask for was added to satisfy the plan's own DOM-test
  criterion (4.5). It is scoped per file via `// @vitest-environment happy-dom` and explained in
  `render.test.ts`, which is the right shape — but CLAUDE.md's own rule, stated in its `qrcode`
  paragraph, is that an unmentioned dependency is indistinguishable from an unconsidered one. The
  lockfile also bumped hoisted `entities` 6.0.1 → 7.0.1.
- **Fix**: Add a short paragraph to CLAUDE.md's Commands section: why it exists, that it is selected
  per file rather than globally, and that the suite default is still `node`.
- **Decision**: FIXED — CLAUDE.md documents happy-dom, its per-file selection, and the Proxy/restoreAllMocks trap.

### F10 — A malformed `eval` reply is reported as an accepted answer

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/session/store.ts (submitAnswer status branching)
- **Detail**: A `null` or malformed result makes `Number(result?.[0])` `NaN`, which fails every
  comparison and falls through to `{outcome: "accepted", total: 0}` — reporting an unwritten answer
  as accepted. This mirrors the existing house pattern in `claimPlayer` and `writeSession`, so it is
  not new drift, but on this path the fall-through direction is the unsafe one.
- **Fix**: Make the accepted branch explicit (`if (status === 1)`) and treat anything else as
  `failed`.
- **Decision**: FIXED — the accepted branch is now explicit (`status === 1`); anything else is `failed`.
