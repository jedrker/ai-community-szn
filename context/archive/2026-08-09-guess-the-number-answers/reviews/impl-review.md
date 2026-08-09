<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Guess-the-number answers

- **Plan**: `context/changes/guess-the-number-answers/plan.md`
- **Scope**: Phases 1–5 of 5 (full plan)
- **Date**: 2026-08-09
- **Verdict**: NEEDS ATTENTION (all 6 findings triaged and fixed 2026-08-10)
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated success criteria re-run at review time: `bun run test` 849 passed / 29 files; `bun run type-check` 0 errors; `bun run build` complete. Every "What We're NOT Doing" boundary held, including no `host.astro` change, no per-question tolerance knob, no band thresholds in the attendee UI, no `ChoiceScore` rename, and the word-cloud seam preserved. Retention rules verified clean: the guess never reaches `logSessionEvent` and never enters a published snapshot.

## Findings

### F1 — A 400 refusal of a numeric guess permanently locks the attendee out of a question they never answered

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:918-925`
- **Detail**: `sendAnswer`'s `rejected` branch calls `markSubmitted` and re-renders, which writes `submitted: true` to localStorage — so the field goes disabled, the submit button hides, and the note reads "Odpowiedź zapisana.", surviving a reload. That was safe while every reachable rejection was a 409 (`already-answered` / `not-open`), which is what the comment at :919-920 assumes. This slice makes a 400 reachable for the first time: the client gate is deliberately loose (`/\d/`) while the route added `MESSAGES.notANumber` (`answer.ts:223`) and `MESSAGES.outOfRange` (`answer.ts:237`). An attendee who types `50-60`, `około 500`, `12 tys` or `1e5` passes the client gate, is refused with 400, **nothing is written to the store**, and the view then tells them their answer was saved and takes the control away. At reveal they get the "Bez odpowiedzi" panel with no way back. Verified: `parseGuess("50-60")` and `parseGuess("1e5")` both return `NaN`.
- **Fix A ⭐ Recommended**: Add an `invalid` arm to `SubmitOutcome` in `src/lib/client/answer.ts`, returned for a 4xx that is not 409, and leave the control armed in that branch.
  - Strength: Fixes it at the source; every future caller and every future kind inherits the distinction, which is the same reasoning that made `failed` vs `rejected` a typed split rather than a call-site check.
  - Tradeoff: Touches a shared type and its tests; slightly more surface than a one-line guard.
  - Confidence: HIGH — mirrors the existing 5xx branch immediately above it.
  - Blind spot: Any other route that answers 400 for a condition that IS final would need checking; none currently does.
- **Fix B**: Gate the `markSubmitted` call in `index.astro` on the question kind or on a status the outcome carries.
  - Strength: Smallest possible diff, confined to the view.
  - Tradeoff: Leaves the trap armed for the next kind (S-08's word cloud) and for any new 400.
  - Confidence: MEDIUM — works, but the invariant lives in a comment rather than a type.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `invalid` arm on `SubmitOutcome` (409 is the only final refusal); `index.astro` shows the message and re-arms the button without marking the question submitted. Three new tests in `client/answer.test.ts` cover 400 / 409 / 404.

### F2 — The parser strips spaces anywhere, so a stray space silently changes the number

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/guess.ts:33,60`
- **Detail**: `GROUPING` is applied globally with no positional constraint, so a space is removed wherever it appears rather than only where grouping is legal. Verified: `parseGuess("6 7")` returns `67` and `parseGuess("1 2 3")` returns `123`. On a phone keypad a stray space is an ordinary slip, and this is the "wrong award rather than a refusal" shape — the attendee meant 6, the store records 67, and nothing on either screen says a transformation happened. It also contradicts the module's own stated posture ("An absent, empty or unparseable field is refused, never coerced") and the plan's wording, which describes spaces as *thousands separators*.
- **Fix**: Validate grouping shape before stripping — accept a separator only between 3-digit groups (`^[+-]?\d{1,3}(?:[\s\u00A0\u202F]\d{3})*(?:[.,]\d+)?$`) and refuse anything else. Every currently-accepted case in `guess.test.ts` (`10 000`, `1 234 567`, the U+00A0 and U+202F variants) keeps passing; `6 7` becomes a refusal the attendee can read and correct.
  - Strength: Turns a silent miscount into a visible message, without narrowing any input a real attendee would type.
  - Tradeoff: A more complex regex, and it interacts with F1 — a refusal is only safe once a 400 stops locking the question.
  - Confidence: HIGH — the accepted set is small and fully enumerated in the test file.
  - Blind spot: Whether any device produces a grouping character in a position this regex rejects; none observed in the pl-PL formatter's own output.
- **Decision**: FIXED — `parseGuess` now validates shape before stripping (`GROUPED` / `PLAIN`), so a separator is legal only between a 1–3 digit leading group and further groups of exactly 3. Six new refusal cases in `guess.test.ts` fail against the old implementation. CLAUDE.md updated.

### F3 — The guess echo is formatted per-device, one line below a value formatted server-side

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:845`
- **Detail**: `own.value.toLocaleString("pl-PL")` runs in the browser, while the true value directly above it was formatted by `Intl.NumberFormat("pl-PL")` on the server — a choice `reveal.ts` and CLAUDE.md both justify as "150 phones and the projector cannot disagree about the string." This re-introduces that disagreement on the same screen. Independently, `toLocaleString`'s default `maximumFractionDigits` is 3, so a guess of `9800,5678` is echoed as `9800,568` — verified. The screen shows the attendee a number they did not type, at the exact moment a scoring dispute would start.
- **Fix**: Echo what the device sent rather than a re-format — `String(own.value)`, or the raw `submittedText(...)` that is already persisted for this purpose.
- **Decision**: FIXED — echo `own.value` directly; no per-device re-format and no fraction-digit truncation.

### F4 — The numeric input's `maxlength="20"` is a magic number unrelated to the server bound

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/index.astro:151`
- **Detail**: The text field directly above derives its bound from the shared constant (`maxlength={MAX_TEXT_ANSWER_LENGTH}`), imported in frontmatter precisely so the client and server bounds cannot drift — the file's own docstring explains that plumbing. The number field hardcodes `20` while `MAX_GUESS_MAGNITUDE` is `1e12`, i.e. 13 digits. The client therefore invites 20 characters the server refuses with `outOfRange`, which under F1 is an unrecoverable lock.
- **Fix**: Pass the digit width through frontmatter from `guess.ts` and derive `maxlength` from it, mirroring the text field.
- **Decision**: FIXED — `MAX_GUESS_INPUT_LENGTH` derived from `MAX_GUESS_MAGNITUDE` in `guess.ts` (21), imported in frontmatter, mirroring how the text field takes `MAX_TEXT_ANSWER_LENGTH`.

### F5 — CLAUDE.md and the roadmap both say "four of the twelve" exact-edge cases overshoot; it is three

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `CLAUDE.md:196`, `context/foundation/roadmap.md:826`
- **Detail**: Measured: of the twelve exact-edge cases across the two live questions, three overshoot their band in binary floating point (`67 × 1.05`, `67 × 0.95`, `67 × 1.1`) — all three at the 67-magnitude question; every 10,000 case is exact. Removing `BAND_EPSILON` fails exactly three tests. The claim is checkable, which is why it should be right — a reader who verifies it and finds four ≠ three has reason to distrust the rest of the note.
- **Fix**: Change "four of the twelve" to "three of the twelve" in both files.
- **Decision**: FIXED — corrected to "three of the twelve" in `CLAUDE.md` and `context/foundation/roadmap.md`.

### F6 — `closeness` treats near-exact as exact; `scoreNumberAnswer` uses strict equality

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/scoring.ts:268` (vs `:221`)
- **Detail**: The band lookup treats a relative error `≤ 1e-9` as the exact band (closeness 1.00), but `correct` is strict `guess === question.correctValue`. A guess inside the epsilon but not equal would yield `{ correct: false, awarded: 1000 }` — "Blisko!" beside a full award, and a stored record saying the exact answer was not hit. Unreachable from a keypad at the drafted magnitudes (it needs ~10 significant digits of agreement), which is why this is an observation and not a defect — but the two functions disagree about what "exact" means and only one of them says so.
- **Fix**: Add a one-line note at `:268` recording that `correct` is strict by intent while the band is generous, or define exactness once as `closeness(...) === 1`.
- **Decision**: FIXED — note added at `scoring.ts` recording that `correct` is strict by intent while the band carries `BAND_EPSILON`, and naming the gap between them.
