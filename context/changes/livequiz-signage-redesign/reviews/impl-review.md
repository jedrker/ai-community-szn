<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: LiveQuiz signage redesign

- **Plan**: `context/changes/livequiz-signage-redesign/plan.md`
- **Scope**: all 11 steps (13 commits, `444e191..b4b49bf`)
- **Date**: 2026-08-15
- **Verdict**: REJECTED — two user-visible defects on paths every session hits. Both fixes are small.
- **Findings**: 2 critical, 5 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

`type-check` 0 errors · `test` 1286 pass / 36 files · `build` clean. Architecture is clean by
construction: nothing in the diff touches `src/lib/session/`, `src/quiz/`, the routes,
`logSessionEvent` or the snapshot schema; `boundary.test.ts`, `keys.test.ts` and `host.test.ts`
all pass, and the one-loop / one-fetch-site / one-`CONTROL_RULES`-reader guarantees hold.

## Findings

### F1 — The leader's score is invisible on every phone at every leaderboard beat

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:988-990`
- **Detail**: `renderBoard` branches `list`, `row`, `name` and `empty` on `closing`, but `rank`
  and `points` are unconditional and carry `[li:first-child>&]:text-quiz-ink-on-chrome` and
  `[li:first-child>&]:text-quiz-ink`. Those are ink-on-chrome colours, and the chrome ground
  under row 1 exists **only** in the closing branch. In the `standings` phase — the FR-014 beat
  after every reveal — the first row is `bg-quiz-asphalt` (or `chrome-tint` when it is this
  device's own), so the leader's points render at ≈1.06:1 against it. Confirmed in the
  screenshot from the two-device run: `2716` on the top row is near-black on a dark fill.
- **Fix**: Make `rank` and `points` ternaries on `closing` like their siblings — the
  non-closing arm drops the `[li:first-child>&]:` colour overrides and keeps `text-quiz-zinc` /
  inherited `signwhite`.
- **Decision**: PENDING

### F2 — The award line is sized as a figure but carries whole sentences

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:419`, written at `:1754`, `:1767`, `:1863`
- **Detail**: `#result-award` was restyled to `text-[72px] font-extrabold leading-[76px]`, which
  is right for `+800 pkt`. Three branches write sentences into it: the word-cloud reveal
  ("Na dużym ekranie zobaczysz je małymi literami."), the unscored reveal ("To była rozgrzewka
  — bez punktów.") and the `answered: false` line. Questions 1 and 2 of the definition are the
  word cloud and the unscored multiple choice, so **the first two reveals of every session hit
  it**: on a 390px screen the sentence fills the viewport at 72px and pushes the echo and the
  running total off screen. Visible in `run-03-word-revealed-phone.png` from the step-11 run.
- **Fix A ⭐ Recommended**: Give the award element a base class and let the caller pick
  `figure` (72/76) or `sentence` (30/38), exactly as `verdict()` already picks a tone.
  - Strength: One mechanism for both halves of the panel; the size becomes a stated decision
    per branch instead of an assumption about what the element holds.
  - Tradeoff: A second small helper beside `verdict()`.
  - Confidence: HIGH — `verdict()` proves the shape works and the call sites are three.
  - Blind spot: None significant.
- **Fix B**: Move the three sentences to `#result-answer` (30/38) and leave the award for
  figures only.
  - Strength: No new helper; the award element keeps one job.
  - Tradeoff: `result-answer` is the echo line ("Twoja odpowiedź: …"); the unscored branches
    would be borrowing a slot that means something else, and the word-cloud branch already
    writes the echo there.
  - Confidence: MEDIUM — needs a check that no branch writes both.
  - Blind spot: The `answered: false` branch clears `result-answer`; it would need rewiring.
- **Decision**: PENDING

### F3 — The branch is seven commits behind main, on the same two files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Plan Adherence
- **Location**: N/A (branch state)
- **Detail**: The branch was cut at `9554ab7`; `main` has since taken the per-question-timer
  impl-review fixes, which **extracted the countdown into `src/lib/client/countdown.ts`** (a
  unit-tested module with fake timers) in both views, and moved the phone countdown's
  `aria-hidden` off the panel onto the bar. Evidence from a trial merge in a throwaway
  worktree: `host.astro` auto-merges and correctly takes main's module; `index.astro` conflicts
  in 3 places, and in two of them "keep mine" reverts a main fix. Resolved the recommended way
  (main's countdown machinery, my styling) the suite is green at 1314 tests — but the resolved
  tree **silently loses the `data-urgent` write**, because it lived in the `paintCountdown` main
  replaced, leaving `URGENT_MS` defined and the last-five-seconds signal colour dead. Also:
  main's newer `host.test.ts` fails 5/38 against the pre-merge branch (it asserts the extracted
  shape), which is expected and resolves on merge — but it means the merge cannot be judged by
  "tests were green before".
- **Fix**: Merge `main` into the branch as its own commit before anything else, resolving the
  three conflicts as: main's countdown module wins outright, my markup and classes win, and
  `dataset.urgent` is re-attached inside `createCountdown`'s `onPaint`. Then delete the
  now-duplicate `paintCountdown(fromTick)` fix — main's extraction already removes that bug —
  and keep its docstring's account of the crash somewhere, because it is the only record of it.
- **Decision**: PENDING

### F4 — The live regions announce nothing, because the text is written while hidden

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:593-606`; `src/pages/quiz/host.astro:1821-1832`
- **Detail**: `joinError`, `answerError` and the host's `say` all `setText` first and unhide
  after. `#join-error`, `#answer-error` and `#message` keep their `role="alert"` /
  `role="status"` + `aria-live`, but a node inside a `display:none` subtree is not in the
  accessibility tree, so the mutation is not announced — and revealing a container that already
  holds its text is not reliably announced either. Before this change they were always-present
  `<p>` elements whose text changed in place, which did announce. So the join refusal, the send
  failure and every host message became silent to a screen reader.
- **Fix**: Unhide before writing — `setHidden(bubble, false); setText(...)` — and hide again
  when the text is empty.
- **Decision**: PENDING

### F5 — The phone's countdown is hidden from assistive tech entirely

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:245`
- **Detail**: `aria-hidden="true"` sits on the whole `#countdown` panel, so the seconds value —
  the one thing on that panel a non-sighted attendee needs — is not exposed. Carried over from
  the pre-redesign markup; **main already fixed exactly this** in the per-question-timer impl
  review (its F9 moved `aria-hidden` onto the bar alone). Related to F3: resolving the merge in
  favour of this branch's markup re-introduces the bug main closed.
- **Fix**: Move `aria-hidden="true"` from the panel to the bar `<div>`, matching main.
- **Decision**: PENDING

### F6 — Connection-lost leaves the previous question's options on screen and tappable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/quiz/index.astro:761-782`
- **Detail**: Plan step 10 asks for "connection lost (signal, answer controls hidden)". The
  branch calls `hideAnswerControls()`, which hides the submit and the fields — but the option
  buttons live inside `#question`, and this is the one `render()` path that never calls
  `showQuestion`. So the prompt and its buttons stay under the alarm headline, still live: a tap
  runs `onSelect` → `render()`, which returns at this branch without repainting, so
  `aria-pressed` never updates and the tap silently does nothing. `data-waiting` also keeps
  whatever the previous phase set, so the alarm lands top or bottom depending on history. The
  shape is pre-existing; the restyle made it reachable-looking rather than plainly dead.
- **Fix**: Call `showQuestion(false)` in this branch (and hide the board), making the alarm a
  screen of its own — which is what the plan's phone inventory shows.
- **Decision**: PENDING

### F7 — A stale docstring now contradicts its own function, and the "only behavioural change" claim is false

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/pages/quiz/host.astro:1773-1779`
- **Detail**: Step 5 left a docstring above `say()` reading "Still binary, and still wrong about
  two of its callers…"; step 6 added the real one directly beneath it without removing it, so
  the file now carries two adjacent docstrings, the first of which is false. Separately, the
  surviving one claims "**This is the only behavioural change in the redesign**" — no longer
  true: the countdown recursion fix (`d4d14bd`) and the `optionIds` persistence (`76ea6f5`) are
  both behavioural, both unplanned, and both justified in their own commits.
- **Fix**: Delete the stale block and soften the claim to name the two follow-up fixes.
- **Decision**: PENDING

### F8 — A purge leaves the projector's clock running under "brak sesji"

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/host.astro:1542-1577`
- **Detail**: `render()`'s `state === null` branch calls `stopPolling()` but not
  `stopCountdown()`, and returns before `renderCountdownPanel`. If the session is purged or
  expires while a scored question is open, the timer keeps ticking and the rail keeps the clock
  — which `applyShell(NO_SESSION)` leaves on screen. Pre-existing at the merge base; this change
  rewrote the branch, which makes it the natural place to close it.
- **Fix**: Add `stopCountdown()` beside `stopPolling()` in that branch.
- **Decision**: PENDING

### F9 — A stale send failure can survive into the next question

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:1387-1553`
- **Detail**: None of the four open-question renderers clears `answerError`. The ordinary
  open → reveal → advance flow clears it via `hideAnswerControls`/`renderRevealed`, but
  `CONTROL_RULES` deliberately keeps `advance` live during `question-open`, so open → open is
  reachable — and a stale "Nie udało się wysłać. Spróbuj ponownie." would then sit in a
  signal-marked bubble above the new question's submit, reading as a refusal of an answer that
  has not been given. Pre-existing; the bubble makes it louder.
- **Fix**: Call `answerError("")` where the question id changes.
- **Decision**: PENDING

### F10 — The revealed slab's colour depends on token declaration order in `global.css`

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/host.astro:1064-1082`
- **Detail**: `bandClass` concatenates `SLAB_SINGLE`/`SLAB_MULTIPLE` with `BAND_REVEALED`, and
  the two set the same properties on the same pseudo-element at the same specificity
  (`before:bg-quiz-chrome` vs `before:bg-quiz-slab-inactive`, and the same for text and border).
  This is the exact hazard the file's own docstring says it avoids by using `data-` variants. It
  resolves correctly today only because Tailwind orders same-utility rules by theme-token
  declaration order and `slab-inactive` is declared after `chrome` — **reordering the
  `--color-quiz-*` block would silently flip the reveal's slabs back to chrome**.
- **Fix**: Express the revealed slab as a `data-` variant like everything else, or pin the
  dependency with a comment in `global.css`.
- **Decision**: PENDING

## Not findings, recorded for completeness

- **Documented drifts from the plan**, each argued in-file: the multiple-choice note in the top
  strip rather than under the prompt; a third prompt tier at 60/62; four flow pills where the
  plan says three (the plan's count was wrong — `CONTROL_RULES` has four verbs); the lobby QR
  sized off available height rather than a flat 700px.
- **`#version` renders at 2.22:1** (`text-quiz-pill-disabled` on asphalt) — the only
  non-disabled use of the dimmest token. Host-only chrome, but below the 3:1 large-text floor.
- The `data-`-variant technique, the `--tw-content` counter, the `optionIds` store change and
  the retention guardrails were all checked against the built stylesheet and the tests, and are
  sound.
