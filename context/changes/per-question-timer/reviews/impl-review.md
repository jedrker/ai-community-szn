<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Per-question time limit (S-11)

- **Plan**: `context/changes/per-question-timer/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5 (commits `ea1ef22`, `d62c914`, `3949043`, `206e4c3`, `1311a96`, `9554ab7`)
- **Date**: 2026-08-15
- **Verdict**: REJECTED as landed → **NEEDS ATTENTION** after the two in-review fixes
- **Findings**: 1 critical · 6 warnings · 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL (both findings fixed during review) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | FAIL |

**Why not APPROVED.** The change shipped a crash on every attendee phone at the moment a
question's clock reached zero — the feature's central path. It was invisible to 1276 passing
tests, and *both* guards written in this change to protect the countdown certified the defects
instead. The architecture is sound and the plan's hard guardrails all held; the failure is
entirely in verification.

**What held, verified by empty diffs across the whole change:**
`src/lib/session/state.ts`, `src/lib/session/keys.ts`, `src/lib/session/scoring.ts` and
`src/lib/session/store.ts` are untouched. No `SessionState` field, no key, no Ably traffic, no
change to any award arithmetic, no host override, and no write on a polled or countdown path.

## Findings

### F1 — Countdown recursion crashes the attendee page at zero

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:877-930`, `:986-1002`
- **Detail**: `render()` called `stopCountdown()` as its first statement, which reset
  `timeUp = false`. `renderOpen` then called `startCountdown()` → `paintCountdown()`, which on
  an expired question saw `!timeUp`, set it, and called `render()` again — resetting the flag
  and repeating, unbounded. The flag meant to break the cycle was cleared by the first line of
  the function it called. Reproduced independently by both review agents (`RangeError` at
  ~1900 frames). Reachable two ways, both of them plan manual rows marked done at `3949043`:
  the tick reaching zero (3.7) and a device joining or reloading past the deadline (3.9).
  Consequence: `renderTimedOut` unreachable, exception thrown out of the snapshot handler, the
  phone frozen on a half-rendered screen until the host advances. Server-side enforcement
  unaffected.
- **Fix**: Return the closed state from `startCountdown` instead of holding a shared flag; keep
  `render()` off the paint path so only `tick` re-enters the state machine, once, at the
  crossing.
  - Strength: Removes the class, not the instance — a returned value cannot be stale and
    cannot be cleared by another function.
  - Tradeoff: Splits `paintCountdown` into `armNextTick` + `tick`; slightly more surface.
  - Confidence: HIGH — verified by simulating the fixed control flow across five scenarios
    (join past deadline, crossing mid-question, ordinary question, expired-but-answered,
    unscored), all terminating at depth 1 with the correct screen.
  - Blind spot: Still no executable test — see F4.
- **Decision**: FIXED — 8825875

### F2 — Projector countdown survives a session that no longer exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/host.astro:1005-1035`
- **Detail**: `renderCountdownPanel` cleared the clock at its own top, but is called near the
  end of `render()`; the `state === null` branch returns long before reaching it. A purge, a
  TTL expiry or `bun run quiz:reset` therefore left the timer chain re-arming and
  `#host-countdown` on screen, counting down a question from a session that is gone. The
  renderer's own `state === null` handling was dead code — the tell that the path was believed
  live.
- **Fix**: Hoist `stopCountdown()` to the first statement of `render()` and make
  `renderCountdownPanel` arm-only, matching the attendee page.
- **Decision**: FIXED — 8825875

### F3 — Both countdown guards certified the defects they were written to prevent

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/pages/quiz/index.test.ts:153-157`, `src/pages/quiz/host.test.ts` (the
  countdown clause added in `206e4c3`)
- **Detail**: Two instances, in one change, of the failure `lessons.md` already has an entry
  about. (1) `index.test.ts` asserted `expect(CODE).toContain("timeUp = false")` — the exact
  statement causing F1 — while claiming to protect against a device being locked out of the
  next question. (2) `host.test.ts` scoped its "clears before an early return" assertion to
  `renderCountdownPanel`'s *body*, so it verified a clear inside a function that was never
  reached on the broken path, and passed over F2 throughout. Both were written in the same
  change as the code they failed to guard, and both were "verified in both directions" against
  breakages that did not include the real one.
- **Fix**: Replace shape assertions with property assertions and re-verify: the paint path
  cannot call `render`, the tick calls it exactly once, no module-level flag exists, and the
  clear precedes the first branch of `render()` at the call site.
  - Strength: Each new assertion was verified to fail against the actual defect, not a
    proxy for it.
  - Tradeoff: Still source scanning — see F4 for the limit of that.
  - Confidence: HIGH — five break-the-guard runs, each failing the intended assertion.
  - Blind spot: A scan cannot see behaviour; a third defect of a different shape would pass.
- **Decision**: FIXED — 8825875

### F4 — Neither countdown has any executable test

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Success Criteria
- **Location**: `src/pages/quiz/index.test.ts`, `src/pages/quiz/host.test.ts`
- **Detail**: Every assertion covering the countdowns is a source-text scan; the timer code is
  never executed by any test. Both F1 and F2 lived in that blind spot behind a green suite, a
  clean type-check and a passing structural guard. This is the project's known weakest surface
  — CLAUDE.md states an Astro inline script has no harness — but S-11 is the first slice to put
  a *state machine* there rather than a fetch loop.
- **Fix A ⭐ Recommended**: Extract the countdown into `src/lib/client/countdown.ts` as a pure
  state machine (arm / tick / crossing / stop) and drive both pages from it.
  - Strength: Matches how `render.ts`, `answer.ts` and `session.ts` were already extracted;
    makes `vi.useFakeTimers()` coverage of arm→tick→zero→re-arm possible. It is the one change
    that would have caught both F1 and F2.
  - Tradeoff: A real refactor across two pages, after the slice is already closed.
  - Confidence: HIGH — `session.ts`'s `createFallbackPoll` is the same shape and is thoroughly
    tested, so the pattern is proven in this codebase.
  - Blind spot: Not verified whether the two pages' countdowns differ enough to make one
    module awkward.
- **Fix B**: Leave as is and rely on the strengthened source guards plus manual checks.
  - Strength: No further churn on a closed slice.
  - Tradeoff: The next defect of a shape nobody predicted is invisible again.
  - Confidence: MEDIUM — depends entirely on the countdown not changing further.
  - Blind spot: None significant.
- **Decision**: PENDING

### F5 — Manual verification rows were marked complete without evidence

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/per-question-timer/plan.md` — Progress rows 3.6–3.10, 4.7–4.11
- **Detail**: 25 manual rows are `[x]` with a commit SHA. At least two are provably false: 3.7
  ("At zero the input locks with the note") and 3.9 ("Joining past the deadline shows the
  locked state and no input") could not have passed, because the page crashed on exactly those
  paths. This matters more here than it usually would: this project's own documents state that
  the live two-device pass is the only thing that can see what the suite cannot, and F1 is
  precisely what it exists to catch.
- **Fix**: Re-run the live pass for Phases 3 and 4 against the fixed code before the change is
  archived, and treat a manual row as unconfirmed unless it was actually exercised.
- **Decision**: PENDING

### F6 — Device clock skew is unclamped in the countdown text

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/client/render.ts:648-651`, `src/pages/quiz/index.astro:908-912`
- **Detail**: The remainder mixes a server epoch (`updatedAt`) with the device clock
  (`Date.now()`). `renderCountdown` clamps the *bar* but `countdownText` is unclamped, so a
  device several minutes behind renders "325 s" beside a full bar. A device running ahead
  computes `remaining <= 0` immediately and — now that F1 is fixed and the timed-out screen is
  reachable — removes the controls for a whole question the server would have accepted answers
  for. The module docstring's "a phone whose clock is a little fast costs its owner nothing"
  holds for seconds of skew, not for a mis-set clock.
- **Fix**: Clamp the text to `[0, limitMs]` as the bar already is, and treat an implausible
  remainder (`> limitMs` or `< -limitMs`) as "no reliable clock" — show the panel without
  locking, since the server is the authority regardless.
- **Decision**: PENDING

### F7 — `TYPE_SECONDS` diverges from the plan with no record of the decision

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/quiz/definition.ts:31`
- **Detail**: The plan specifies "25 for the eight single-choice and one multiple-choice
  questions, **40** for the two `number` questions and the one `text` question". The shipped
  value is **30**, changed after Phase 1 landed and outside any phase's work. The split itself
  is correct (9 × 25, 3 × 30, none on the two unscored) and the change was applied consistently
  through the runbook and plan-brief, so it is deliberate rather than stale — but nothing
  records why, and the plan still reads 40. A second, benign divergence sits alongside it:
  `countdownText` rounds **up** where the plan's contract said "floored", with a rationale
  written at the function (flooring shows "0 s" for the whole final second while the field
  still accepts answers).
- **Fix**: Add a one-line note to the plan's Progress or the contract recording the 40→30
  decision and its reason.
- **Decision**: PENDING

### F8 — `answer.test.ts`'s per-question-limit test sits on a boundary

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/pages/api/quiz/answer.test.ts:757-770`
- **Detail**: "reads each question's own limit rather than one shared number" probes at
  `NOW - 30_000`, and its comment says "past the 25s tap budget, inside the 40s typing one" —
  but the typed budget is 30, so the typed question's visible zero is *exactly* `NOW`. The
  assertion passes only because of `SUBMISSION_GRACE_MS`, not because of the limit difference
  it claims to demonstrate.
- **Fix**: Derive the probe from the two fixtures' own limits (e.g. midway between them) and
  correct the comment.
- **Decision**: PENDING

### F9 — `aria-hidden` removes the countdown from the accessibility tree entirely

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/index.astro:147-152`
- **Detail**: `aria-hidden="true"` sits on `#countdown`, the whole panel, so both the
  "Pozostały czas" label and the seconds value are hidden from screen readers. The comment
  justifying it ("the bar is decoration for the number above it") clearly intends the attribute
  to apply to the bar's wrapper only.
- **Fix**: Move `aria-hidden` to the bar wrapper.
- **Decision**: PENDING

### F10 — Two small inconsistencies in the countdown state

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/index.astro:875`, `:902`
- **Detail**: (1) `countdownFor.id` is written and never read — either drop it, or use it to
  compare against the current question id in the tick, which would be a genuine defence against
  a tick painting for a question that has moved on. (2) The attendee page has no
  `visibilitychange`/`pagehide` handling, unlike the host page, which gained both in Phase 4.
  Low impact — the timer fetches nothing and recomputes from `Date.now()` — but the asymmetry
  now reads as deliberate when it is not.
- **Fix**: Use `countdownFor.id` in the tick as a staleness check, and mirror the host page's
  lifecycle handlers.
- **Decision**: PENDING
