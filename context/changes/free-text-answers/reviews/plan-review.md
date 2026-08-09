<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Free-text answers (S-05)

- **Plan**: `context/changes/free-text-answers/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE → **SOUND** (all 5 findings fixed in triage)
- **Findings**: 1 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After fixes |
|-----------|---------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | FAIL | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

10/10 paths ✓, 13/13 referenced test files ✓, brief↔plan ✓.
Progress contract ✓ — 1 `## Progress` heading, 5/5 phases matched, 46 checkboxes all inside Progress,
0 leaked into phase blocks. Re-verified after triage edits (Phase 1: 10 criteria ↔ 10 items).

## Findings

### F1 — Extending `normalizePolish` in place silently changes display-name identity

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §1 "The fold"; Key Discoveries; Migration Notes
- **Detail**: The plan justified editing `normalizePolish` in place and named one other consumer,
  `src/quiz/schema.ts:128`. There is a second: `src/lib/session/players.ts:100`, where
  `normalizePolish(displayName)` **is the FR-008 display-name claim key**. `ALLOWED_CHARACTERS`
  (`players.ts:41` = `/^[\p{L}\p{N} ._'-]+$/u`) permits `.`, so widening the shared fold would:
  (1) merge `"Ania."` and `"Ania"` into one claim, refusing one of two attendees who can both join
  today; (2) make `".."` — a valid name today — fold to empty and trip the `key.length === 0` guard
  at `players.ts:107`, the guard whose own comment predicts this exact edit ("a later edit to either
  could open it"); (3) **worst, during a deploy** — `livequiz:players` is keyed by folded name and
  `livequiz:player-ids` maps id → folded name, both written with the old fold, so a post-deploy
  `"Ania"` claim would find no collision with a pre-deploy `"Ania."` under `ania.` and be granted it,
  putting two visually identical names on the leaderboard. That is the guarantee F-02 called
  load-bearing and S-02 verified across 450 concurrent claims. The plan's Migration Notes said "there
  is no data migration and nothing to backfill" — true for the two new fields, false for this.
- **Fix A ⭐ Recommended**: Add `normalizeAnswer` to `normalize.ts`; leave `normalizePolish` alone.
  - Strength: Keeps the plan's actual goal — scoring and the accepted-variant collision check still
    share one function and cannot drift, because `schema.ts` moves to `normalizeAnswer` too. Only the
    name path keeps the punctuation-preserving fold, which is the path that never wanted it. Zero
    migration, zero live-session window, and the `players.ts` empty-key guard stays unreachable.
  - Tradeoff: Two exported folds in one small module; the docstring must say which is for what.
  - Confidence: HIGH — verified by grep; `players.ts:100` and `schema.ts:128` are the only two
    non-test callers, and they want different things.
  - Blind spot: None significant. `normalizeAnswer` composing `normalizePolish` keeps the ł/Ł
    regression covered by the existing test.
- **Fix B**: Extend in place and own the name consequences explicitly.
  - Strength: One fold, one concept; `"Ania." == "Ania"` is arguably the better collision rule.
  - Tradeoff: Needs a stated FR-008 decision, a test for the now-reachable empty-key guard, and a
    migration note for the mid-session collision window — three additions defending a change the
    slice never needed.
  - Confidence: MEDIUM — the semantics are defensible; the live-deploy window is not.
  - Blind spot: Whether a real attendee name would hit it is unknowable in advance.
- **Decision**: FIXED via Fix A. Phase 1 §1 rewritten to introduce `normalizeAnswer` with the
  three-effect rationale; new Phase 1 §1b moves `schema.ts:128` and `src/quiz/index.ts`'s re-export
  to the new fold; Phase 1 §2 now folds with `normalizeAnswer`; a Key Discoveries bullet records the
  two-caller fact; two success criteria added (1.4b — `normalizePolish` still preserves a trailing
  `.`; 1.4c — `players.test.ts` untouched); Phase 5's CLAUDE.md entry rewritten to document why there
  are two folds.

### F2 — The length bound has no named constant and no single source of truth

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1; Phase 4 §1
- **Detail**: Phase 3 said "refusing over ~80 characters" — a tilde in a spec value — and Phase 4 said
  `maxlength` "matching the server bound". No constant named, no home module, two files obliged to
  agree on a magic number with nothing enforcing it. Two further gaps: `answerRecordSchema` as
  specified carried no `.max()`, so `submitAnswer`'s validate-on-the-way-in at `store.ts:875` (which
  exists to be the last stop for a malformed record) would not catch an over-length one; and
  `index.astro`'s `<script>` cannot value-import from `src/lib/session/` (`boundary.test.ts`), so the
  constant must travel via frontmatter + `define:vars` — the route `PLAYER_STORAGE_KEY` already takes.
- **Fix**: Export `MAX_TEXT_ANSWER_LENGTH = 80` from `scoring.ts` beside `SPEED_WINDOW_MS`; three
  readers — `answerRecordSchema`'s `.max()`, the route's refusal, the input's `maxlength`.
  - Strength: One constant, three readers, no drift; matches how `SPEED_WINDOW_MS` and
    `PLAYER_STORAGE_KEY` are already plumbed.
  - Tradeoff: None material.
  - Confidence: HIGH — the `define:vars` route is already proven for two other values.
  - Blind spot: 80 remains a judgement call; the brief already records that.
- **Decision**: FIXED. Constant declared in Phase 1 §2 with the `define:vars` constraint stated at the
  constant rather than only at the call site; Phase 2 §1 adds `.max()` with the reason it is not
  redundant with the route's refusal; Phase 3 §1 and Phase 4 §1 both reference the constant.

### F3 — The input-value reconciliation rule is stated only half

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2 "The open beat"
- **Detail**: The phase stated the invariant (don't rebuild the input — value, focus and caret are
  lost) and the storage (a per-question `Map`, keyed like `selections`), but never when `input.value`
  is written back *from* the Map. Both obvious readings are wrong: never, and the Map is dead weight
  while a question change leaves the previous text in the field; on every `render()`, and it clobbers
  typing — the exact bug the static-element decision exists to prevent, and `render()` fires on every
  snapshot, so another attendee joining is enough. Near-zero blast in the current quiz (one text
  question, forward-only advance), but the plan claims a general mechanic.
- **Fix**: Write `input.value` from the Map only when the rendered question id differs from the one
  the input currently holds (tracked via `data-question-id`); never on a re-render of the same
  question.
- **Decision**: FIXED. Rule added to Phase 4 §2 as a blockquote, with both failure modes named and the
  note that neither is reachable in the drafted quiz.

### F4 — Migration Notes says "three fields gain `.default(null)`"; this slice adds two

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Migration Notes
- **Detail**: Only `text` (AnswerRecord) and `revealedAnswerText` (SessionState) are added here; the
  third was presumably the pre-existing `revealedOptionIds`. A reader auditing the migration surface
  would look for a field that isn't there.
- **Fix**: Say "two new fields, for the same reason the existing `revealedOptionIds` and `playerCount`
  carry theirs."
- **Decision**: FIXED.

### F5 — Phase 5 hand-flips the roadmap status that `/10x-archive` owns

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 5 §2
- **Detail**: `roadmap.md`'s Done section records that `/10x-archive` appends the entry *and* flips
  that item's Status. Phase 5 did it by hand — so it gets done twice, and a hand-written Done entry
  would not match the format the other six carry.
- **Fix**: Drop the status flip from Phase 5; keep the Baseline note, which `/10x-archive` does not
  write.
- **Decision**: FIXED.

## Notes for implementation

What the plan already got right, recorded so it is not re-litigated: the
`revealedOptionIds`-family vs `playerCount`-family distinction is correctly identified and acted on;
the `replaceChildren()` reasoning for keeping the input out of `render.ts` is correct; `lessons.md`
rule 2 is applied by name to the absent-`text` case with outcome-level assertions; the rollback claim
is correct (Zod object schemas strip unknown keys rather than erroring); and declining both a fifth
contract document and a 150-device rehearsal is reasoned rather than skipped.

**F1 is the one that would have cost real hours**, and it is the same shape as the lesson already in
`lessons.md` — a change that is locally correct and whose second consumer nobody traced. Worth
considering for `/10x-lesson` as a recurring rule: *before editing a shared pure function, grep its
callers; a fold used as an identity key is not the same function as a fold used for comparison.*
