<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Sync Under a Degraded Link

- **Plan**: `context/changes/testing-sync-degraded-link/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-16
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (F1, F2 fixed)
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING → PASS (F1 fixed) |

## Evidence

Automated criteria re-run at review time: `bun run test` 1574 pass / 43 files; `bun run type-check`
0 errors 0 warnings; `bun run lint` clean; `scripts/scoped-tests.sh src/pages/api/quiz/answer.ts`
resolves 2 files / 89 tests. Commits `b613981`, `ba3d4be`, `f56a533`, `571a98b`, `064d418`,
`7a09d9e`.

Three new breaks were run **during this review** against `createSnapshotReconciler` — see F1.

## Findings

### F1 — The reconciler's 14 tests had never been observed failing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/testing-sync-degraded-link/verification.md` (phase 1 section)
- **Detail**: `verification.md`'s phase-1 row records no break. Its stated reason — "the whole block
  is new code exercising a function that had no caller in any test before it, so its failure mode is
  absence rather than silence" — does not hold up. The version guard is one comparison operator; a
  `<` where `<=` belongs is exactly the silent defect §1's fourth rule exists for, and "the tests are
  new" is not evidence that they can fail. The phase whose entire subject is *a rule nobody ever
  watched fail* shipped its own tests without watching them fail.

  Settled during this review by running three breaks. All three fail correctly:

  | Break | Observed |
  |---|---|
  | Accept an equal version (`<=` → `<`) | 1 failed — "drops a snapshot at the same version" |
  | Refuse `null` (the purge wipe) | 3 failed — both purge tests and the absent-session latch |
  | Advance the latch above the guard | 1 failed — "does not advance the latch on a snapshot the guard dropped" |

  `session.ts` restored byte-identical after each; suite green.
- **Fix**: Replace `verification.md`'s phase-1 placeholder with the three rows above, and delete the
  "failure mode is absence" rationale rather than leaving it as a precedent for skipping the step.
- **Decision**: FIXED — rows 1.a–1.c added, rationale deleted, and the review-time lateness recorded
  in the file itself. Row 1.d (a botched extraction is invisible to unit tests) kept and explained.

### F2 — The §3 Status cell carries prose where the table's vocabulary is a token

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/test-plan.md` §3, phase 2 row
- **Detail**: The cell reads `complete — on its deliverables; see §6.6 for the one proof clause it
  does *not* meet`. §3's own preamble says "Status moves left-to-right through the values below; the
  orchestrator updates Status as artifacts appear on disk", and every other row holds a bare token
  (`complete`, `not started`). A prose cell is a value no consumer can match, and `/10x-test-plan`
  is documented as re-running over this table. The caveat is right and belongs in the plan — the
  Status column is the wrong place for it.
- **Fix**: Put `complete` in the Status cell and move the caveat into the row's Goal column or the
  note directly beneath the table, where the Risk #3 clause-3 amendment already lives.
- **Decision**: FIXED — Status is the bare token `complete`; the caveat moved to the Goal cell and a
  new paragraph beneath the §3 table.

### F3 — The seam test's `expired` case touches ground "What We're NOT Doing" fenced off

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/pages/api/quiz/answer.seam.test.ts:184-207`
- **Detail**: The plan's scope list says "Not rebuilding the deadline boundary tests". The `expired`
  contrast derives its fixture from `SUBMISSION_GRACE_MS` and the question's own limit, which is the
  same construction `answer.test.ts:783-880` uses. It is one test rather than a rebuild, and it earns
  its place as the *composition* — the asymmetry between the two 409s is visible in one place only
  here. Recorded so a later reader does not mistake it for scope creep, and so the docstring's claim
  is checked rather than assumed.
- **Fix**: None. The file's docstring already states the justification.
- **Decision**: SKIPPED — recorded, no change.

### F4 — The docs contract named a file that no longer holds the content

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: plan.md Phase 5, change #3 vs `src/lib/client/CLAUDE.md`
- **Detail**: The plan named the root `CLAUDE.md`'s extraction list. Commit `1c20ede` (another
  session, mid-phase-1) split that file per directory; the root now delegates at line 153 and holds
  no list. The edit went to `src/lib/client/CLAUDE.md` instead, and nothing in the root became false.
  Correct outcome, but the plan text and the tree disagree for anyone reading the plan later.
- **Fix**: None required — the deviation is stated in `064d418`'s message and here.
- **Decision**: SKIPPED — recorded, no change.

### F5 — Tests beyond the plan's contract, in both seam files

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `answer.seam.test.ts` ("passes an accepted answer straight through"),
  `reveal.drift.test.ts` ("shows the room exactly what the store holds")
- **Detail**: Neither is in the plan's Contract for its phase. Both are controls: without them the
  refusal and drift assertions could pass against a broken transport stub or a hard-coded
  distribution. This is `lessons.md`'s "Prove the fixture reaches the branch the test names" applied
  as a positive case, so it is scope the plan should have asked for rather than scope that crept.
- **Fix**: None.
- **Decision**: SKIPPED — recorded, no change.

### F6 — One foreign commit sits inside the change's commit range

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `c1ff3b0 docs: add a root README`
- **Detail**: `git log b613981^..HEAD` includes `c1ff3b0` and `README.md`, which belong to the
  concurrent session, not to this change. Traceability by commit range is therefore approximate here;
  the per-phase SHAs in `## Progress` are exact and should be preferred. Related: the phase-1 commit
  had to be recovered after a staging race put this change's message on another change's renames
  (`3479bb8`, reset; renames re-landed as `4d676d6`).
- **Fix**: None. Noted so `/10x-archive` and any later reader use the Progress SHAs rather than a
  range.
- **Decision**: SKIPPED — recorded, no change.
