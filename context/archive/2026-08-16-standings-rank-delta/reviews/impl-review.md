<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Standings rank delta

- **Plan**: `context/changes/standings-rank-delta/plan.md`
- **Scope**: All 4 phases (full plan)
- **Date**: 2026-08-16
- **Verdict**: REJECTED → all findings fixed in triage (see Decisions)
- **Findings**: 1 critical, 0 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — Every player id in the room is written into the unpurgeable log stream

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/store.ts:1552`
- **Detail**:
  `readPreviousScores` logs `reason: \`awards read failed: ${String(error)}\`` when the `HMGET`
  throws. The Upstash client builds that message as
  `` `${body.error}, command was: ${JSON.stringify(req.body)}` ``
  (`node_modules/@upstash/redis/chunk-K7RP6Y36.mjs:203`) — it embeds the **entire command body**.
  The command is `HMGET livequiz:answers <questionId>:<playerId> …`, one field per player, so a
  single failed baseline read writes **up to 150 player ids** into the log.

  That breaks the guardrail `LogFields` exists to enforce. `src/lib/session/CLAUDE.md`: logs are
  "retained ~1 hour and are covered by no TTL, no purge and no rollback". A player id is not merely
  attendee data — `standings.ts` states plainly that "holding someone's id lets you answer as them",
  which is why a published row deliberately carries none. This route puts them somewhere the purge
  cannot reach.

  It is also the first `logSessionEvent` in `store.ts` to interpolate a raw error into `reason`;
  every other call there passes a bounded string (`parsed.problems.join("; ")`, or a constant), and
  the sibling route one file away passes the constant `"standings read failed"`. `LogFields`'
  own note calls out this exact failure shape: the closure is the enforcement, and free-text
  `reason` is the one hole left in it.
- **Fix**: Drop the interpolation — pass a constant `reason: "awards read failed"`, matching
  `src/pages/api/quiz/host/standings.ts:112`. Do **not** move the detail to `console.error`: Vercel
  captures that into the same stream, so it would relocate the leak rather than close it.
  - Strength: One line; restores the bounded-reason convention every other call site in this module
    already follows, and the lost detail is worth nothing — a store outage is visible from the
    event itself.
  - Tradeoff: A genuine Upstash error message is no longer in the log. Acceptable: the event's whole
    job is "the arrows are missing and the store is why".
  - Confidence: HIGH — the library's interpolation is read directly from the installed source, and
    the replacement pattern exists verbatim one file away.
  - Blind spot: Other `String(error)` interpolations elsewhere in the project were not audited as
    part of this review; this finding is scoped to the code this change introduced.
- **Decision**: FIXED — constant `reason: "awards read failed"`; the catch binding was dropped too, so the error is not merely unused but unreachable. Verified by reinstating the interpolation and watching the new test fail.

### F2 — The degradation's only signal is untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/lib/session/store.test.ts` (the "the rank baseline" describe)
- **Detail**:
  "still publishes a board when the awards read fails, without arrows" asserts the board and the
  null deltas, but nothing asserts that `session.standings.degraded` is emitted. That log line is
  the *only* evidence this degradation ever happened — an arrow-free board is indistinguishable
  from a legitimate one, which the runbook now says in as many words. Deleting the
  `logSessionEvent` call would leave the whole suite green.
- **Fix**: Assert the event name in the existing failure test (the log module is already mockable —
  `routes.test.ts` mocks it).
- **Decision**: FIXED — asserts the event reaches `console.log` AND that the line carries no player id, with the rejection shaped like a real Upstash message so the assertion can fail. Verified both ways: fails with the F1 leak reinstated, and fails with the `logSessionEvent` call deleted.

### F3 — `shrink-0` is inert on a grid child

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/index.astro` (the `delta` class string)
- **Detail**:
  The attendee row is `grid grid-cols-[auto_1fr_auto_auto]`, so `flex-shrink` does not apply to its
  children. `min-w-[3ch]` is what actually holds the column; `shrink-0` is a no-op carried over from
  flex-row reasoning. Harmless, but a future reader will take it as load-bearing.
- **Fix**: Drop `shrink-0` from the class string and leave the `min-w-[3ch]` note as the explanation.
- **Decision**: FIXED — `shrink-0` removed and the comment that justified it corrected to say what actually holds the column.

## Notes on dimensions that passed

- **Plan Adherence** — every "Changes Required" item landed as described across the four phases:
  the schema field with `.default(null)`, the optional `questionId`, the separate `try`/`catch`, the
  new log event, the route's argument, the always-present fourth span, the motion signature, both
  grids, the runbook line, and the two `CLAUDE.md` edits.
- **Scope Discipline** — three items beyond the plan's letter, all disclosed in commit messages and
  all mechanically required or in the plan's spirit: `delta: null` added to row fixtures in
  `state.test.ts` / `store.test.ts` / `render.test.ts` (the field is required on the output type, so
  `astro check` failed without them); an extra `session.standings.degraded` row in the runbook's log
  table beside the planned prose line; and an amendment to `render.ts`'s `animate` docstring, whose
  claim that the renderer "is in no position to make" a rank-change claim this change made false.
- **Architecture** — the decision stayed in the pure layer. `buildStandings` owns the sign and the
  zero rule, the store owns only the read, the renderer owns only the glyph, and the views own only
  the colour. No new Redis key, so `keys.ts`, `end` and `purge` are untouched.
- **Success Criteria** — `bun run test` 1598 passed / 43 files, `bun run type-check` 0 errors,
  `bun run lint` clean. All 11 manual rows confirmed by the user. Thirteen mutation checks across
  the four phases each failed their own named test.
- **Colour override verified against F1's predecessor** — on the projector's leader row,
  `[li:first-child>&]:text-quiz-ink` compiles to `li:first-child > .cls` (specificity 0,2,1) and beats
  `.text-quiz-mint` (0,1,0) regardless of source order, so the mint-on-yellow invisibility the plan
  flagged cannot occur.
