<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Host participation and distribution (S-04)

- **Plan**: `context/changes/host-participation-and-distribution/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-09
- **Verdict**: REVISE → **SOUND** after triage (all 8 findings fixed)
- **Findings**: 2 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

9/9 paths ✓, 3/3 symbols ✓, brief↔plan ✓. `docs/reference/contract-surfaces.md` absent — surface
check skipped. Riskiest claims verified directly against the code and against
`context/archive/2026-08-08-answer-choice-question-and-reveal/answer-cost-report.md`.

## Findings

### F1 — The one rule this slice exists to enforce is left to the route's memory

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 1 §4, Phase 2 §1
- **Detail**: `readQuestionTallies(questionId, optionIds)` returned `{ answered, options }` and the poll
  endpoint was to respond with a subset. The per-option counts would therefore be in the handler's hand
  during `question-open`, with only the route's omission keeping them off the wire, and no test
  asserting it. This is the risk the roadmap names for S-04, and the failure is invisible — the
  projector still looks right.
- **Fix**: Split into `readAnsweredCount(questionId)` (poll; one `HGET`; no shape for option data to
  travel in) and `readQuestionTallies` (reveal only). Added a Phase 2 criterion asserting the 200
  body's key set exactly.
- **Decision**: FIXED

### F2 — Progress section did not map 1:1 to phase criteria in 4 of 5 phases

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress`
- **Detail**: Measured — Phase 1 6 body bullets vs 7 Progress entries, Phase 2 4 vs 5, Phase 3 5 vs 7,
  Phase 4 4 vs 6. Compound body bullets had been split when writing Progress, breaking the mechanical
  contract `/10x-implement` parses.
- **Fix**: Split the compound bullets in the phase bodies (the finer grain is the better one).
  Re-verified: 7/1, 6/2, 8/1, 7/5, 6/3 on both sides, zero checkboxes outside `## Progress`.
- **Decision**: FIXED

### F3 — A store blip at reveal published a confident zero to the room

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3
- **Detail**: The plan applied the null-not-zero discipline to the poll and violated it at reveal: a
  `null` tally read yielded `{ answered: 0, options: {} }`, rendering every bar at zero — the same
  "everyone has left" message the plan rejects elsewhere, at the higher-stakes beat.
- **Fix A ⭐ Recommended**: Publish `revealedDistribution: null` on a failed read; the view renders
  nothing where the bars would be.
  - Strength: consistent with the discipline the plan argues for; reveal still succeeds and
    `revealedOptionIds` still marks the correct answer, so FR-016 is unaffected.
  - Tradeoff: the view needs a third branch (open / revealed-with-bars / revealed-without).
  - Confidence: HIGH — the field is nullable and the schema gate is satisfied by null.
  - Blind spot: none significant.
- **Fix B**: Retry the tally read once before falling back.
  - Strength: most blips are transient.
  - Tradeoff: latency on the one action that must not stall; still needs a fallback.
  - Confidence: MEDIUM — untested against Upstash failure modes.
- **Decision**: FIXED via Fix A. Non-choice kinds now also publish `null` rather than an empty shape,
  and the plan states why this is the one place the field diverges from `revealedOptionIds`.

### F4 — Cost figures overstated, and they propagate into the runbook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Performance Considerations, Phase 5 §2–3, plan-brief
- **Detail**: The plan claimed ~27k → ~37k and ~54% → ~74%. The drafted quiz is 8 single-choice,
  2 multiple-choice, 2 number, 1 text, 1 word-cloud, and `/api/quiz/answer` refuses the last four
  kinds — so only 10 questions generate submissions. Real added cost ≈ 5,600, giving ~32.4k per event
  and ~65% at ten events. Overstated by ~10%, and Phase 5 writes the figure into the runbook, where an
  inflated prediction hides a real overage from the tripwire.
- **Fix**: Recomputed with a per-path table over the 10 answerable questions, the multi-choice `k` term
  stated explicitly, and Phase 5 instructed to write the **measured** delta into the runbook rather
  than the prediction — with a disagreement of more than a few percent treated as the finding.
- **Decision**: FIXED

### F5 — The poll was scoped by phase but the panel by kind

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2
- **Detail**: For 4 of the 14 drafted questions the host page would poll an endpoint that can only
  return zero, feeding a panel that is not rendered — the mirror of `lessons.md`'s first rule (there an
  affordance with no data path; here a data path with no affordance).
- **Fix**: One predicate governs both, written once: phase is `question-open` **and** kind is
  `single-choice` or `multiple-choice`.
- **Decision**: FIXED

### F6 — A missing host secret was treated as a network blip

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §2
- **Detail**: A `401` — the ordinary state of the first thirty seconds, before the host types the
  secret — took the hold-and-back-off path, so the projector showed a staleness marker that said
  nothing about the cause, and recovery was delayed by up to the backed-off interval.
- **Fix**: Branch on `401` — report it through the existing `#message` element, leave the interval
  alone, and retry on the next `input` on the secret field.
- **Decision**: FIXED

### F7 — Multi-choice shares legitimately sum past 100%

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §1
- **Detail**: Shares are computed against `answered` (people, not selections), so on the two
  multiple-choice questions the bars can total more than 100%. Correct, and it reads as a bug someone
  will normalize away.
- **Fix**: Stated in Phase 4 §1 that this is correct and must not be normalized, with a `render.test.ts`
  criterion asserting the unnormalized rendering.
- **Decision**: FIXED

### F8 — The rollback note overstated the orphan risk

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Migration Notes
- **Detail**: An orphaned tallies key carries `SESSION_TTL_SECONDS`, so it self-clears within four
  hours and holds only aggregate counts.
- **Fix**: Reframed as a verification step — self-clearing within 4h, run `quiz:check-purge` anyway
  since it is the only thing that can see the orphan.
- **Decision**: FIXED

## What held up

The two constraints the plan was built around — the poll never writing the session document (the
`src/pages/api/quiz/answer.ts:137-146` clamp) and the distribution being set only in `reveal.ts` — are
correct and correctly reasoned. Every claimed path and symbol verified.
