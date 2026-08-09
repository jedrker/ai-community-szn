<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Attendee answers a choice question and learns their result

- **Plan**: `context/changes/answer-choice-question-and-reveal/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-08
- **Verdict**: REVISE → **SOUND** after triage (all 8 findings fixed)
- **Findings**: 2 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

10/10 existing paths ✓, 5/5 new paths correctly absent ✓, state constructors 4/4 ✓ (+1 unlisted, F7),
brief↔plan ✓ — 1 factual claim contradicted by `docs/runbook-live-session.md:72` (F2).

## Findings

### F1 — Unscored-question copy has no data path to reach the phone

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §3; Phase 1 §1
- **Detail**: Phase 4 promised unscored questions read as a warm-up, but the result payload
  `{ answered, correct, awarded, total }` is identical for a warm-up and a wrong answer. `public.ts:19`
  strips `points` on purpose and `FORBIDDEN_KEYS` keeps it out, so the client could not derive it. The
  drafted Q2 — the gather-the-room beat — would have told every latecomer they were wrong. This is
  `lessons.md`'s recorded rule almost verbatim.
- **Fix A ⭐ Recommended**: Add `scored: boolean` to the public projection
  - Strength: `public.ts:19` names this slice as the owner of the decision; the phone learns before
    answering and can skip the result fetch on unscored questions (pairs with F6).
  - Tradeoff: Touches the projection and `public.test.ts`; one more field on the wire.
  - Confidence: HIGH — verified at `src/quiz/public.ts:19`.
  - Blind spot: Whether the host view wants the same flag (S-04's problem).
- **Fix B**: Return `scored: false` from the result endpoint.
- **Decision**: FIXED via Fix A — new Phase 1 §4, Phase 4 §3 rewritten to drive copy from
  `question.scored` rather than infer it from `awarded: 0`, criterion 1.4 added.

### F2 — The plan's headline cost finding misreads the tripwire as monthly

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; the fix is a restatement, not a redesign
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details; Phase 5 §3; plan-brief; change.md
- **Detail**: The plan claimed ~247k/month crosses the 200K tripwire. `runbook:72` reads "Above ~200K
  attributable to **a single run**" and `runbook:70` already documents a 500K/month ceiling. At ~27k
  per event nothing is crossed; the tripwire's *margin* over a real session drops from ~125× to ~7×.
  Phase 5 instructed a runbook correction built on the false premise, and the same runbook section
  warns that raising the threshold is how it stops working.
- **Fix**: Restate as two true claims (~54% of the 500K ceiling at ten events; margin 125× → 7×) and
  change Phase 5 to record cost without moving the threshold.
- **Decision**: FIXED — cost block rewritten with a correction note, Phase 5 §3 retitled "The runbook
  cost update" with an explicit do-not-change-the-threshold instruction, criterion 5.6 reworded,
  brief and change.md updated.

### F3 — The answer route's clamp needs a session read the cost table omits

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3 step 3; cost table
- **Detail**: The plan said to clamp against `updatedAt` but never said where the route gets the
  document. Scoring happens in the route, before the script runs, so it needs its own `readSession()`
  — one more billed command. Submission 7 → 8, per-event ~14,700 → ~16,800, total ~26,800. Phase 5
  measures against the stated prediction, so an unstated read is what makes attribution fail to close.
- **Fix A ⭐ Recommended**: State the route read explicitly and reprice.
  - Strength: The route needs the session anyway to reject a closed question without spending a write.
  - Tradeoff: 8 commands per submission.
  - Confidence: HIGH — the clamp cannot be computed without it.
  - Blind spot: Route read vs script read disagreeing under a mid-submission advance — the script's
    question-id check catches it, now stated.
- **Fix B**: Move the clamp into Lua (rejected — puts the domain rule where there are no tests).
- **Decision**: FIXED via Fix A — cost table gains a row, Phase 3 §3 renumbered to five steps with the
  read, the `updatedAt` reasoning, and the "route decides the award, script decides whether it counts"
  note.

### F4 — Progress step 5.9 has no matching success criterion

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 Success Criteria ↔ Progress
- **Detail**: Phase 5 had 4 Manual bullets against 5 Progress entries (5.5–5.9). Every other phase
  matched exactly.
- **Fix**: Add the roadmap/lessons bullet to Phase 5's Manual Verification.
- **Decision**: FIXED — bullet added; Progress now matches on all five phases.

### F5 — No path to a final result once the host ends the session

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4
- **Detail**: The gate refused anything but `question-revealed`, so from the moment `end` runs no
  device could reach its totals — even though `ENDED_TTL_SECONDS` exists precisely so a device
  reloading after the close "should still find the final standings" (`store.ts:44`).
- **Fix**: Serve the running total (not a per-question verdict) in the `ended` phase; record that S-07
  inherits this gate.
- **Decision**: FIXED — exception added to Phase 3 §4, criterion 3.5 extended, answer-contract scope
  updated.

### F6 — Every device fetches a result even when it has nothing to fetch

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: Phase 4 §3; Performance Considerations
- **Detail**: The view fetched on every reveal, including for devices that never answered and for
  unscored questions. The phone knows both facts locally; skipping cuts the reveal fan-in — the one
  load shape the plan admits stays unmeasured — and removes 2 of 14 questions outright.
- **Fix**: Gate the fetch on "this device submitted" and on `question.scored`.
- **Decision**: FIXED — Phase 4 §3 gains the gating bullet, manual criterion 4.10 added.

### F7 — A fifth place a session document is constructed, unlisted

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §1
- **Detail**: `scripts/check-purge-residue.ts:158` builds a session literal the plan didn't list. It is
  untyped and `JSON.stringify`'d, so `astro check` won't flag it and `.default(null)` makes it parse —
  safe by accident of the default rather than by being updated.
- **Fix**: Add it to Phase 3 §1 with that note.
- **Decision**: FIXED.

### F8 — Open, unthrottled answer route is now a command-budget vector

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW
- **Dimension**: Blind Spots
- **Location**: What We're NOT Doing
- **Detail**: Not throttling inherits `/api/quiz/join`'s reasoning, formed when the whole room cost ~8
  commands. A loop now bills per call against a budget this slice pushes to ~54%. Unguessable player
  ids make it a nuisance, not an exploit.
- **Fix**: Name it in the answer contract's accepted-risks list rather than leaving it implied.
- **Decision**: FIXED — Phase 5 §4 contract now lists all four accepted risks explicitly.
