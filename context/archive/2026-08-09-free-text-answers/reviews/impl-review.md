<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Free-text answers

- **Plan**: `context/changes/free-text-answers/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-09
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 3 observations
- **Triage**: all four fixed (2026-08-09). Suite 693 → 701; type-check 0 errors; build clean.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Scope

29 files changed across `bb2a0e8..faebe6a` (2,355 insertions). Every file named in the plan's
"Changes Required" appears in the diff; no file appears in the diff that the plan did not name or
that is not a necessary consequence of a planned change (test fixtures updated because two zod
`.default(null)` fields made their output types required).

Automated success criteria re-run at review time: `bun run test` 693/693 pass, `bun run type-check`
0 errors / 0 warnings, `bun run build` completes. All 30 Progress rows are `[x]` and carry a SHA.

## Findings

### F1 — A locked text answer is invisible after a reload, which the plan promised it would not be

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/quiz/index.astro` (`renderOpenText`), `src/lib/client/answer.ts` (`SeenEntry`)
- **Detail**:
  Phase 4 states: *"When `hasSubmitted` is true the input is disabled (not hidden — the attendee
  should still see what they sent)."* The implementation disables rather than hides, but the value
  it would show comes from the in-memory `typed` Map, which does not survive a reload.

  After a reload on a locked text question: `answerText.dataset.questionId` is `undefined` on the
  fresh DOM, so the reconciliation branch fires and writes `typed.get(id) ?? ""` — and `typed` is
  empty. The attendee sees an **empty disabled box** above "Odpowiedź zapisana. Czekamy na
  prowadzącego…". The server holds the text but `/api/quiz/result` is phase-gated until reveal, so
  the device cannot recover it during `question-open`.

  This is `lessons.md` rule 1 exactly — a plan promising a UI affordance while separately specifying
  a data rule that cannot deliver it. Notably the **choice path has the same gap and shipped with it
  in S-03**: `selections` is also in-memory, so a reloaded locked choice question shows no "you
  picked this" marker either. So this is an inherited class, not a regression — but the plan made the
  promise explicit for the text field, and the promise is not kept.
- **Fix A ⭐ Recommended**: Persist the submitted text in the existing seen map, beside `submitted`.
  - Strength: `SeenEntry` already carries `{ at, submitted? }` in `QUESTION_SEEN_STORAGE_KEY`, which
    is a registered name and is cleared by `clearSeen` on the `ended` transition — so no new key, no
    new retention surface, and the answer does not outlive the session on the device.
    `readSeen` already tolerates unknown/legacy shapes, so old entries keep parsing. Delivers the
    affordance the plan named, and sets the pattern S-06 will want for the same reason.
  - Tradeoff: Widens what the device stores about the attendee from "that they answered" to "what
    they answered". Bounded by `MAX_TEXT_ANSWER_LENGTH` and by `clearSeen`, and it is the attendee's
    own answer on their own device — but it is a real widening and worth stating rather than
    absorbing.
  - Confidence: HIGH — the storage, the clearing path and the tolerant parser all already exist.
  - Blind spot: Has not been checked against Safari private mode, where `writeSeen` silently
    no-ops — in that mode the field stays empty and the behaviour is unchanged from today.
- **Fix B**: Hide the field when locked instead of disabling it, and let the note carry the whole
  confirmation.
  - Strength: Removes the promise instead of half-keeping it, so the plan and the code agree. One
    line. No storage change and no new decision about what the device holds.
  - Tradeoff: The attendee loses sight of their own answer in *every* case, not just after a reload —
    a strictly worse experience than today for the common path, traded for consistency.
  - Confidence: HIGH — trivially correct.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. `SeenEntry` gained `text?`, `markSubmitted` takes an options object
  (`{ text?, now? }`), and `submittedText()` reads it back; `renderOpenText` prefers storage over the
  in-memory Map. 8 new tests in `answer.test.ts`, including the reload case and the pre-deploy entry
  shape. **The storage primitive is covered; the view wiring is not** — `index.astro`'s script has no
  unit harness in this project, so that line rests on the manual reload check.

### F2 — The plan document now contains two false statements about `host.astro`

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/free-text-answers/plan.md` (Key Discoveries, and "What We're NOT Doing")
- **Detail**:
  Both say `host.astro` never passes `correctOptionIds`, so the large screen does not mark the
  correct option at reveal — recorded as a pre-existing gap in S-04's territory. S-04 landed and
  fixed it before this slice began: `host.astro`'s `render()` now passes `mode: "revealed"`,
  `correctOptionIds` and `optionCorrect`. The plan is the artifact a future reader trusts, and two
  of its claims are now wrong.
- **Fix**: Strike or annotate both bullets, noting S-04 closed the gap.
- **Decision**: FIXED. Both bullets struck through with an "Updated 2026-08-09" note explaining that
  S-04 shipped the choice-question marker, and that this slice's text panel sits beside it rather
  than substituting for it.

### F3 — `answerText.maxLength` is set twice from the same constant

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/index.astro` (`renderOpenText`)
- **Detail**:
  The markup already sets `maxlength={MAX_TEXT_ANSWER_LENGTH}` server-side, and `renderOpenText`
  re-asserts `answerText.maxLength = config.maxTextLength` on every render. Both read the same
  constant through the same `define:vars` plumbing, so the assignment can never change anything.
  Harmless, but it reads as though the two could disagree.
- **Fix**: Drop the assignment; keep the markup attribute.
- **Decision**: FIXED, and further than the finding asked. Removing the assignment left the whole
  `define:vars` path for `maxTextLength` dead — the markup reads the frontmatter import directly — so
  the config field, the window handoff and the `Config` type entry went too. The module docstring now
  records that the `<script>` block never needs the bound, and that the server-side refusal is the
  real one.

### F4 — `typed` and `selections` survive a purge-and-restart within one page load

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/quiz/index.astro` (the `ended` / `state === null` branch)
- **Detail**:
  That branch calls `clearSeen` — with a comment explaining that question ids are stable across
  sessions, so leftovers would be read back by the next one — but does not clear the in-memory
  `typed` or `selections` Maps. If a host purges and restarts mid-event while a device stays on the
  page, the same text question re-opens with the previous answer still in the field (the
  `dataset.questionId` guard sees no change, so it does not even rewrite it). In-memory only, so any
  reload clears it, and `selections` has carried the same property since S-03.
- **Fix**: Clear `typed`, `selections`, `results` and `resultRequested` alongside `clearSeen` in that
  branch.
- **Decision**: FIXED. All four Maps/Sets cleared, plus the input's own `value` and
  `dataset.questionId` — the field is a live DOM element, so clearing the Map alone would have left
  the reconciliation guard seeing an unchanged question id and never rewriting it.

## Notes on what was checked and found clean

- **No attendee text reaches a log line.** `logSessionEvent` calls are unchanged and `LogFields`
  remains closed; `answer.test.ts` asserts the typed answer never appears in `console.log` output.
- **No new `livequiz:` key.** `keys.test.ts` passes; the typed answer lives inside the existing
  `ANSWERS_KEY` record, which `end` and `purge` already reach.
- **The snapshot carries no attendee data.** `revealedAnswerText` holds `acceptedAnswers[0]` — quiz
  content about an already-closed question — and the attendee's own text travels only on the
  per-device `/api/quiz/result` response, behind the unchanged phase gate.
- **Every render of attendee-authored text uses `textContent`**, never `innerHTML`
  (`setText` in both views).
- **The fold split holds.** `normalizePolish` is unchanged and still the `players.ts` claim key;
  `normalize.test.ts` pins it with `normalizePolish("Ania.") !== normalizePolish("Ania")`.
  `schema.ts` and `scoreTextAnswer` share `normalizeAnswer`, so the authoring check and the scorer
  cannot drift.
- **The client boundary holds.** `boundary.test.ts` passes, and was mutation-checked during Phase 4:
  a value import from `src/lib/session/` inside the `<script>` block fails it with the offending line.
- **`speedWeight` is reused, not re-derived.** `scoring.test.ts` asserts a text and a choice answer
  at equal `elapsedMs` receive identical awards.
- **Three guards were mutation-checked during implementation** (the reveal branch, the two text
  refusals, the boundary scan) — each failed exactly the assertions naming it.
