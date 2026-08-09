# Free-text answers — Implementation Plan

## Overview

Roadmap S-05. An attendee types an answer instead of tapping one, and it is judged correct if it
matches any accepted variant once case, surrounding and repeated whitespace, Polish diacritics and
trailing sentence punctuation are folded away (PRD FR-011, US-01).

This is an extension along an axis S-03 built and labelled, not new architecture. The per-device
clock, the one-answer-per-question lock, the speed weight, the reveal beat and the per-device result
fetch are all reused unchanged. What this slice adds is a *correctness* function, a place to put a
typed answer, and a text-shaped channel for the reveal.

## Current State Analysis

The answer path exists end to end for the two choice kinds and refuses everything else at a seam
that names this slice:

- `src/pages/api/quiz/answer.ts:132` — refuses any kind but `single-choice` / `multiple-choice` with
  `MESSAGES.unsupportedKind`, commented as "the seam S-05 (text), S-06 (number) and S-08 (word
  cloud) extend".
- `src/lib/session/scoring.ts:15` — "S-05 and S-06 add a *correctness* function beside
  `scoreChoiceAnswer` and reuse `speedWeight` unchanged."
- `src/pages/quiz/index.astro:317` — text, number and word cloud render as static text with no
  control, because "something tappable that does nothing reads as a broken quiz".
- `src/pages/api/quiz/host/reveal.ts:63` — a text question is handed `revealedOptionIds: []`, and
  "Text and number questions get their own reveal in S-05/S-06."

Three gaps block the mechanic:

1. **`normalizePolish` exists but nothing scores with it.** `src/quiz/normalize.ts` folds case,
   spacing and diacritics — including the `ł`/`Ł` stroke-letter trap NFD misses — but its only
   caller today is `src/quiz/schema.ts:128`, which uses it to reject accepted-answer variants that
   collapse onto each other. There is no correctness function.
2. **`AnswerRecord` has nowhere to put a typed answer.** `src/lib/session/answers.ts:25` carries
   `optionIds: string[]` and no text field.
3. **The correct answer cannot reach the room.** `SessionState.revealedOptionIds`
   (`src/lib/session/state.ts:109`) is choice-shaped. S-03 deliberately put correctness in the
   *broadcast* rather than the per-device fetch so that a phone whose `/api/quiz/result` call fails
   still sees the right answer highlighted, and so a device that stayed silent sees it too. Without
   a text-shaped field that property simply does not exist for this kind.

The drafted quiz has exactly **one** text question — `zmyslanie-faktow` (`src/quiz/definition.ts:67`),
scored, with four accepted variants. So this slice ships one live question but a general mechanic,
and its correctness is verifiable on stage in one beat.

### Key Discoveries:

- **The speed weight is global by construction and must not be re-derived.** `speedWeight` is
  exported separately from `scoreChoiceAnswer` precisely so a second kind reuses it
  (`src/lib/session/scoring.ts:52`). A second copy of the curve would be a second thing to get wrong.
- **`clampElapsed` and the whole `elapsedMs` contract are kind-agnostic** and already applied before
  the kind branch in `answer.ts:164`. Text answers inherit them with no change.
- **The client's clock, lock and storage machinery is already kind-agnostic.** `markSeen`,
  `markSubmitted`, `hasSubmitted` and `clearSeen` (`src/lib/client/answer.ts`) key on question id
  only. The reload-keeps-its-clock property comes free.
- **The retention gate is passed, and this is the reasoning, not a shrug.** The retention contract's
  rule 3 (`context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`) says
  everything published to Ably is readable for ~2 minutes and that floor cannot be configured away.
  `revealedAnswerText` carries the correct answer to a question the host has *already revealed to the
  room* — quiz content, identical in standing to `revealedOptionIds`, and carrying nothing about who
  played. No attendee data enters the snapshot. The attendee's own typed answer travels on the
  per-device `/api/quiz/result` response instead, which is where per-player data already lives.
- **`logSessionEvent` must never see the typed answer.** `LogFields` is a closed type and that
  closure is the enforcement (retention contract rule 2). A free-text answer is the most
  attendee-identifying payload the system has held; the existing `{ questionId }` fields are
  sufficient and no field may be added for this.
- **The keys registry needs nothing.** No new `livequiz:`-prefixed name is introduced — the text
  answer lives inside the existing `ANSWERS_KEY` hash record, which `end` and `purge` already reach.
- **`lessons.md` rule 2 applies directly.** S-03's `elapsedMs` bug was an absent field taking the
  *favourable* path. The text field must have its "said nothing" case decided before its "lied" case,
  and asserted in a test by outcome rather than by rejection.
- **`normalizePolish` has two non-test callers, and the second one is player identity.**
  `src/quiz/schema.ts:128` is the obvious one. `src/lib/session/players.ts:100` is the one that makes
  editing it in place unsafe: the folded display name *is* the FR-008 uniqueness key, `.` is a legal
  name character (`players.ts:41`), and the stored keys in `livequiz:players` / `livequiz:player-ids`
  were written with whatever fold was live at join time. This slice therefore adds `normalizeAnswer`
  beside it rather than widening it — see Phase 1.
- **`host.astro:300` never passes `correctOptionIds`,** so the large screen does not mark the correct
  option at reveal for choice questions either. That is a pre-existing choice-question gap in S-04's
  territory and is explicitly not fixed here.

## Desired End State

The host advances to `zmyslanie-faktow`. Every phone shows the prompt with a text field and a submit
button. An attendee types `Halucynacje.` — capitalised, with a full stop a phone keyboard added — and
it is accepted and scored as correct, with the same speed weighting a choice answer gets. An attendee
who types `halucynacja` is also correct. One who types `halucynajce` is not, and sees why. The device
locks after one submission and survives a reload with its clock and its lock intact.

At the host's reveal, the large screen shows the accepted answer, and every phone shows the accepted
answer, its own typed answer beside it, the verdict, the award and the running total — with the
accepted answer arriving on the broadcast so it is on screen whether or not the per-device fetch
succeeds.

Verified by: `bun run test`, `bun run type-check`, and a two-device manual run through the text
question against a real session.

## What We're NOT Doing

- **No fuzzy or edit-distance matching.** The roadmap's scoping line: a fuzzy threshold is something
  the host would have to defend out loud in front of the room. `halucynajce` is wrong.
- **No stemming, no synonym expansion, no language detection.** Accepted variants are the author's
  job and `acceptedAnswers` is where they go.
- **No internal punctuation stripping.** Only trailing sentence punctuation on the whole answer. A
  hyphen or apostrophe inside an answer is content.
- **Not S-06's number question and not S-08's word cloud.** The route keeps refusing those kinds with
  the same message, and that refusal stays the seam.
- **Not the choice-question reveal marker on the host screen** (`host.astro` never passes
  `correctOptionIds`). Pre-existing, S-04's territory.
- **Not S-04's participation count or answer distribution.** A text-answer distribution is a
  different shape from a choice one and is not designed here.
- **No throttle on `/api/quiz/answer`.** The accepted risk stands as recorded in `answer-contract.md`;
  this slice adds a length bound, which is a different guard.
- **No fifth contract document.** S-03's `answer-contract.md` already warns that a contract growing
  past a page becomes a second copy of the plan that can disagree with it. This slice introduces no
  new key, no new open decision for a downstream slice, and no new invariant that is not enforced in
  code — so the durable notes go to `CLAUDE.md` and this plan, and there is no `text-contract.md`.

## Implementation Approach

Work outward from the pure rule to the views, so every phase has something to verify before the next
one depends on it:

1. **The fold and the rule** — pure functions, no I/O, fully unit-testable.
2. **The data contracts** — one field on the stored record, one on the session document, and the
   reveal transition that sets it.
3. **The request paths** — the route branch that uses the rule, and the result payload the reveal
   echo needs.
4. **The attendee view** — the control, the submit path, the reveal panel.
5. **The host view and the docs.**

Each phase leaves the tree green and the existing choice path untouched.

## Critical Implementation Details

**State sequencing — `revealedAnswerText` follows `revealedOptionIds`' rule, not `playerCount`'s.**
The two existing sibling fields behave oppositely and `state.ts:87` documents it at length:
`playerCount` is decoration injected by `applyHostAction` on every action, while `revealedOptionIds`
is *part of* the reveal transition, set only in `reveal.ts` and nulled by every other constructor.
A stale answer key is the previous question's answer published to the room while the next question is
open. The new field is in the second category. It must be set in `reveal.ts` alongside
`revealedOptionIds`, nulled in `initialSessionState` and `endedSessionState`, never injected in
`applyHostAction`, and guarded by the same `phase !== "question-revealed"` refusal.

**Timing — the input must not be rebuilt on every render.** `renderQuestion` calls
`container.replaceChildren()` and `render()` runs on every snapshot and every connection change. An
input built inside that container would be destroyed and recreated while the attendee is typing,
losing the value, the focus and the caret. This is why the control is a static element in
`index.astro` beside `answer-submit`, shown and hidden — not something `render.ts` emits.

## Phase 1: The fold and the correctness rule

### Overview

Extend the fold to trailing sentence punctuation and add `scoreTextAnswer` beside `scoreChoiceAnswer`.
Both pure, both unit-tested, nothing else in the tree changed.

### Changes Required:

#### 1. The fold

**File**: `src/quiz/normalize.ts`

**Intent**: Fold trailing sentence punctuation so a phone keyboard's auto-inserted full stop, or an
attendee answering in sentence form, does not turn a correct answer into a zero the host has to
explain from the stage. Deliberately only at the end of the whole folded string, and deliberately not
internal punctuation — a hyphen or apostrophe inside an answer is content, and a future question
whose accepted answer contains one must stay authorable.

**Contract**: A **new** export, `normalizeAnswer(value: string): string`, composed as
`normalizePolish(value)` followed by the trailing-punctuation strip. `normalizePolish` itself is
**unchanged** — same signature, same behaviour, same tests. Ordering matters and should be stated in
the docstring: the strip runs after the existing whitespace collapse and trim, so `"halucynacje ."`
folds the same as `"halucynacje."`. The characters folded are `.`, `!`, `?`, `,`, `;`, `:` — repeated
ones included.

**Why a second fold rather than extending the first — this is the load-bearing part.**
`normalizePolish` has two non-test callers, not one. The obvious one is `src/quiz/schema.ts:128`,
which uses it to reject accepted-answer variants that collapse onto each other. The other is
**`src/lib/session/players.ts:100`, where it *is* the display-name claim key** — FR-008's uniqueness
is decided on the folded name. `ALLOWED_CHARACTERS` (`players.ts:41`) permits `.`, so extending the
shared fold in place would have three effects nobody asked for:

- `"Ania."` and `"Ania"` would become one claim, so one of two attendees who can both join today is
  refused as taken.
- `".."` is a valid name today and would fold to empty, tripping the `key.length === 0` guard at
  `players.ts:107` — the guard whose own comment predicts precisely this edit ("a later edit to
  either could open it"). It fails safe, but it fires.
- **Worst, and only during a deploy:** `livequiz:players` is keyed by the folded name and
  `livequiz:player-ids` maps id → folded name, both written with the *old* fold. A post-deploy
  `"Ania"` claim would fold to `ania`, find no collision with a pre-deploy `"Ania."` stored under
  `ania.`, and be granted — two visually identical names on the leaderboard. That is the exact
  guarantee F-02 called load-bearing and S-02 verified across 450 concurrent claims.

Splitting the fold keeps the plan's actual goal intact: the scoring check and the authoring-collision
check still share **one** function, so they still cannot drift — see the `schema.ts` change below.
Only the name path keeps the punctuation-preserving fold, which is the path that never wanted
punctuation folded. No migration, no live-session window, and `players.ts` is not touched at all.

#### 1b. The authoring-collision check moves to the new fold

**File**: `src/quiz/schema.ts`

**Intent**: Keep the build-time check that rejects colliding accepted variants in exact agreement with
the rule that scores them at runtime. If these two ever fold differently, an author can ship two
variants that the schema accepts and the scorer treats as identical.

**Contract**: `checkQuestion`'s text branch (`schema.ts:128`) uses `normalizeAnswer` instead of
`normalizePolish`. The import at `schema.ts:2` changes accordingly. Verified against the current
definition — the four variants of `zmyslanie-faktow` contain no punctuation and produce no new
collision, and `definition.test.ts` is the standing gate on that.

`src/quiz/index.ts` re-exports `normalizeAnswer` alongside `normalizePolish`, since `index.ts` is the
sanctioned import site for everything under `src/quiz/`.

#### 2. The rule

**File**: `src/lib/session/scoring.ts`

**Intent**: Add the text correctness function the module docstring already promises, reusing
`speedWeight` unchanged so there is exactly one implementation of the timing curve.

**Contract**: `scoreTextAnswer(question: TextQuestion, answerText: string, elapsedMs: number,
windowMs?: number): ChoiceScore` — the same return type as `scoreChoiceAnswer`, since the shape
`{ correct, awarded }` is what every caller downstream already handles.

Behaviour mirrors `scoreChoiceAnswer` exactly where it can:

- `question.points === null` yields `{ correct: false, awarded: 0 }`, for the same reason stated
  there — an unscored question has no correct answer to match, and the view distinguishes a warm-up
  from a wrong answer via `PublicQuestion.scored`, never via `awarded === 0`.
- Correct when `normalizeAnswer(answerText)` equals `normalizeAnswer(variant)` for any variant in
  `acceptedAnswers`. Both sides folded — folding only the input would make an accepted variant
  authored with a capital letter unmatchable. `normalizeAnswer`, never `normalizePolish`: the latter
  is the display-name fold and must not acquire a second job here either.
- A folded input that is empty is never correct, whatever the accepted variants are.
- Award is `Math.round(question.points * speedWeight(elapsedMs, windowMs))`, identical to the choice
  path.

The exported `ChoiceQuestion` type alias comment ("The two kinds this slice scores") needs updating —
it now names the kinds the *choice* scorer handles, not the kinds the module handles.

**Also export `MAX_TEXT_ANSWER_LENGTH = 80`** from this module, beside `SPEED_WINDOW_MS` and for the
same reason it lives there: it is a domain bound, not a route detail. **It has three readers and they
must not drift** — `answerRecordSchema`'s `.max()` (Phase 2), the route's refusal (Phase 3), and the
input's `maxlength` (Phase 4). 80 is a judgement call, comfortably above the longest variant in the
drafted quiz; enforced in one place, it stays cheap to change.

Note the plumbing constraint the third reader carries: `index.astro`'s `<script>` block **may not
value-import from `src/lib/session/`** (`boundary.test.ts`), so this constant reaches the input the
same way `PLAYER_STORAGE_KEY` already does — imported in frontmatter, passed down through
`define:vars`. Stated here, at the constant, rather than only at the call site.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `normalize.test.ts` covers `normalizeAnswer` for trailing punctuation, repeated terminators,
  punctuation with trailing whitespace, and asserts internal punctuation is preserved
- `normalize.test.ts` still asserts the `ł`/`Ł` cases — the existing regression stays green
- `normalize.test.ts` asserts `normalizePolish` is **unchanged**: it still preserves a trailing `.`,
  so `normalizePolish("Ania.") !== normalizePolish("Ania")`. This is the assertion that fails if a
  later edit collapses the two folds back together and takes player identity with it
- `players.test.ts` still passes untouched — the display-name claim key is not in this slice's blast
  radius
- `scoring.test.ts` covers: each accepted variant matching; case, diacritic, spacing and punctuation
  folding; a near-miss misspelling scoring zero; an unscored text question yielding
  `{ correct: false, awarded: 0 }`; an empty and a whitespace-only input scoring zero
- `scoring.test.ts` asserts a correct text answer and a correct choice answer at the same
  `elapsedMs` receive the identical award — the one assertion that fails if the speed curve is
  reimplemented rather than reused
- `schema.test.ts` still passes — the fold change flows into the accepted-variant collision check
- `definition.test.ts` still passes — the live quiz's four variants must not newly collide

#### Manual Verification:

- None. This phase is pure functions with no user-visible surface.

**Implementation Note**: No manual pause needed after this phase; proceed once automated verification
is green.

---

## Phase 2: The record field and the reveal field

### Overview

Give a typed answer somewhere to live, and give the correct answer a way onto the wire.

### Changes Required:

#### 1. The stored record

**File**: `src/lib/session/answers.ts`

**Intent**: Carry what the attendee actually typed, so the reveal can show it back to them and a
scoring dispute on stage can be checked against the real input rather than against a fold.

**Contract**: `answerRecordSchema` gains
`text: z.string().max(MAX_TEXT_ANSWER_LENGTH).nullable().default(null)`, importing the constant from
`scoring.ts`. Choice answers leave it `null`; text answers leave `optionIds` empty.

**The `.max()` is not redundant with the route's refusal.** The route's bound is what produces a
*visible* Polish refusal; this one is the backstop `submitAnswer` already relies on at `store.ts:875`
— "the last point at which a record that breaks its own shape can be stopped from becoming a stored
value". Without it, a future writer of this record bypasses the bound entirely and the failure is
silent.

`.default(null)` is load-bearing for exactly the reason `playerCount` and `revealedOptionIds` carry
theirs (`state.ts:76`): a session running when this ships holds records written before the field
existed, and `readOwnResult` parses what it reads. A required field would make those records fail
`parseAnswerRecord`, come back `null`, and report `answered: false` to a device that watched its
answer land.

Store the **raw trimmed** text, not the folded form. The folded form is a comparison artefact; it is
not what the attendee typed and showing it back would be confusing at best.

Document in the field comment that this is attendee-authored free text — the most identifying payload
in the store — and that it must never reach `logSessionEvent`.

#### 2. The reveal field

**File**: `src/lib/session/state.ts`

**Intent**: Carry the accepted answer for a revealed text question on the broadcast, so it reaches
150 phones without 150 requests and survives a failed per-device fetch.

**Contract**: `sessionStateSchema` gains `revealedAnswerText: z.string().nullable().default(null)`.

It belongs to the `revealedOptionIds` family, not the `playerCount` family — see Critical
Implementation Details. Concretely:

- `.default(null)` so a document written before this ships still parses.
- `initialSessionState` and `endedSessionState` both set it to `null` explicitly, as they do for
  `revealedOptionIds`.
- The existing `superRefine` invariant that refuses a non-null `revealedOptionIds` outside
  `question-revealed` is extended to cover this field, with its own Polish message.

The field's docstring should say why it is a *second* field rather than a generalisation of
`revealedOptionIds`: the union rewrite was considered and rejected because it would rewrite a field
S-03 had just hardened, break documents in flight, and touch three test files for no user-visible
gain.

#### 3. The reveal transition

**File**: `src/pages/api/quiz/host/reveal.ts`

**Intent**: Populate the new field for a text question, leaving every other kind's behaviour exactly
as it is.

**Contract**: The returned `question-revealed` state sets `revealedAnswerText` to the question's
**first** accepted variant when `question.kind === "text"`, and `null` otherwise. `revealedOptionIds`
keeps its current expression untouched.

First variant, by convention: `acceptedAnswers[0]` is the canonical form the author wrote first, and
the alternative — showing all four — turns the reveal into a list that reads as though several
different answers were expected. Worth a line in the schema docstring for `acceptedAnswers` so a
future author knows the first entry is the one the room sees.

This is the one route allowed to put an answer key on the wire, and its module docstring already says
so and why. Extend that docstring rather than adding a parallel one.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `state.test.ts` asserts a non-null `revealedAnswerText` is refused in `lobby`, `question-open` and
  `ended`, and accepted in `question-revealed`
- `state.test.ts` asserts a document without the field parses and yields `null` — the mid-session
  deploy case
- `answers.test.ts` asserts a record without `text` parses and yields `null`
- `routes.test.ts` asserts revealing a text question sets `revealedAnswerText` to the first accepted
  variant and leaves `revealedOptionIds` empty
- `routes.test.ts` asserts revealing a choice question leaves `revealedAnswerText` null
- `routes.test.ts` asserts advancing past a revealed text question clears `revealedAnswerText`
- `keys.test.ts` still passes — no new namespaced literal is introduced

#### Manual Verification:

- None. No user-visible surface reaches a screen until Phase 4.

**Implementation Note**: No manual pause needed; proceed once automated verification is green.

---

## Phase 3: The submission route and the result payload

### Overview

Teach `/api/quiz/answer` the third kind, and give `/api/quiz/result` the one extra field the reveal
echo needs.

### Changes Required:

#### 1. The route branch

**File**: `src/pages/api/quiz/answer.ts`

**Intent**: Accept and score a text submission, keeping every guard the choice path already has and
bounding the one new class of input the route has never taken.

**Contract**: The `text` form field joins `optionIds`. The kind check at line 132 narrows to refuse
only `number` and `word-cloud` — the seam stays, with the same message, for the kinds S-06 and S-08
own.

Four things must hold, in this order:

- **Parse the field explicitly, not by coercion.** `lessons.md` rule 2, and the `elapsedMs` comment
  immediately above in this same file, are both about exactly this: decide what "said nothing" means
  before deciding what "lied" means. A `text` field that is absent, non-string or whitespace-only is
  refused with `MESSAGES.missing`, never scored as an empty-but-valid answer.
- **Bound the length before touching the store**, refusing anything longer than
  `MAX_TEXT_ANSWER_LENGTH` (imported from `scoring.ts` — never a literal here) with a new Polish
  message. Measured on the raw string, before folding, so the bound is on what gets stored. `join.ts` runs `validateDisplayName` before touching the store and this route already
  bounds `optionIds` against the definition for the same stated reason: the endpoint is open, takes
  `formData`, and `curl` ignores an input's `maxlength`. A refusal, not a truncation — scoring a
  prefix the attendee did not type is worse than a clean refusal.
- **Score with `scoreTextAnswer`**, using the same `clampElapsed(rawElapsed, now - updatedAt)` value
  the choice path computes. That line moves above the kind branch if it is not already shared.
- **Store the trimmed raw text** in the record's new field, with `optionIds: []`.

The kind branch decides which scorer runs and what goes in the record; everything around it — the
phase gate, the player check, the `submitAnswer` outcome handling, the response shape — is untouched.
The response still carries no verdict.

`logSessionEvent` calls are unchanged. The typed answer must not appear in any of them, and `LogFields`
having no field it fits is the enforcement.

#### 2. The result payload

**File**: `src/pages/api/quiz/result.ts`

**Intent**: Return this device its own typed answer alongside the verdict, so the reveal can show it
back even after a reload — the in-memory `selections` map does not survive one.

**Contract**: The `answered: true` response gains `text: result.answer.text`. The two
`answered: false` responses and the `ended` response carry `text: null`.

No new leak: this route already returns `correct`, `awarded` and `total` for the requesting player,
and the phase gate that protects those protects this identically. The gate itself is unchanged.

The module docstring's note about why this route logs nothing stays true and stays.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `answer.test.ts` asserts a correct text submission is accepted, and that the stored record carries
  the raw trimmed text with empty `optionIds`
- `answer.test.ts` asserts a submission with **no** `text` field at all is refused — the outcome
  asserted, not merely the status, per `lessons.md` rule 2
- `answer.test.ts` asserts an empty and a whitespace-only `text` are refused
- `answer.test.ts` asserts an over-length `text` is refused and nothing is written to the store
- `answer.test.ts` asserts `number` and `word-cloud` still receive `unsupportedKind`
- `answer.test.ts` asserts the existing choice-path cases are unchanged
- `result.test.ts` asserts `text` is returned for an answered text question and `null` for a device
  that stayed silent
- `result.test.ts` asserts the phase gate still refuses a text question that is not revealed

#### Manual Verification:

- `curl` the answer route with an over-length text body against a running dev session and confirm the
  refusal is a 400 with a Polish message, and that no record was written.

**Implementation Note**: Pause after this phase for confirmation that the manual check passed before
starting Phase 4.

---

## Phase 4: The attendee view

### Overview

The control, the submit path, and the reveal panel. The one phase with real DOM risk.

### Changes Required:

#### 1. The input control

**File**: `src/pages/quiz/index.astro`

**Intent**: Give a text question a field to type into, without letting `render()` destroy it
mid-keystroke.

**Contract**: A hidden `<input type="text">` in the markup beside `answer-submit`, following the
`display-name` input's attribute set (`autocomplete="off"`, `autocorrect="off"`, `spellcheck="false"`,
`inputmode="text"`) and its type scale, plus `maxlength` set from `MAX_TEXT_ANSWER_LENGTH` —
imported in **frontmatter** and passed down through the existing `define:vars` block beside
`seenStorageKey`. Not a literal in the markup, and not a value-import inside the `<script>` block,
which `boundary.test.ts` would fail.

`autocapitalize` should be `off` here rather than `words` — the fold makes case irrelevant, and an
auto-capitalised answer looks wrong to the attendee reading it back at reveal.

It is a static element shown and hidden, **not** something `render.ts` emits. See Critical
Implementation Details: `renderQuestion` calls `replaceChildren()` and `render()` runs on every
snapshot, so an input inside that container loses its value, focus and caret while the attendee is
typing.

`hideAnswerControls()` must hide it. That function exists so no branch can leave a control behind,
and a new control that skips it is exactly the bug it was written to prevent.

#### 2. The open beat

**File**: `src/pages/quiz/index.astro`

**Intent**: Render a text question as answerable rather than as static, with the same lock, note and
disabled-submit behaviour the choice path has.

**Contract**: `renderOpen`'s `answerable` test extends to `kind === "text"`. For that kind:

- The question renders through `renderQuestion` in `static` mode (prompt only — a text question has
  no options), with the input shown below it.
- `markSeen` is called, exactly as for choice — this is what makes a reload keep its clock.
- The submit button is disabled while the field holds nothing but whitespace, mirroring
  `answerSubmit.disabled = selected.length === 0`.
- When `hasSubmitted` is true the input is disabled (not hidden — the attendee should still see what
  they sent) and the existing "Odpowiedź zapisana" note shows.
- The FR-017 note branch picks a text-appropriate line for a scored question; the unscored line is
  unchanged.

Typing must call `render()` only if it does not fight the input — prefer tracking the value in the
same per-question `Map` pattern `selections` uses and toggling the submit button's disabled state
directly on input, rather than re-rendering the whole view on every keystroke.

Keeping the value per question id rather than in a single variable matters for the same reason
`selections` is keyed: the snapshot decides which question is current and it can move underneath us.

**State the reconciliation rule explicitly, because both of the obvious readings are wrong.** The
input is a live DOM element holding its own value, and the Map is the per-question record — so the
one thing that has to be pinned down is *when the element is written from the Map*:

> Write `input.value` from the Map **only when the question being rendered differs from the one the
> input currently holds** — track that with a `data-question-id` on the element. Never on a re-render
> of the same question.

Written on every `render()`, it clobbers whatever the attendee is mid-way through typing, which is
the exact bug this phase's static-element decision exists to prevent — and `render()` fires on every
snapshot, so another attendee joining is enough to trigger it. Written never, the Map is dead weight
and advancing between two text questions leaves the previous answer sitting in the field. The
drafted quiz has one text question and advance is forward-only, so neither is reachable today; the
rule is here because the mechanic is general and this is the line an implementer would otherwise
guess at.

#### 3. The submit path

**File**: `src/lib/client/answer.ts` and `src/pages/quiz/index.astro`

**Intent**: Send a text answer through the same request, guard and outcome handling the choice path
uses.

**Contract**: `submitAnswer` gains a way to carry text — an added parameter or an options object,
implementer's choice, provided the existing per-question `inFlight` guard, the 10s timeout, and the
`accepted` / `rejected` / `failed` split are all reused unchanged rather than duplicated.

The 5xx-is-not-a-refusal reasoning documented at `answer.ts:220` is the most important thing in the
module and must survive whatever shape the signature takes.

`sendAnswer` in the view gains the text branch: read the value for the current question, refuse to
send whitespace-only, and on `accepted` or `rejected` call `markSubmitted` exactly as the choice path
does.

#### 4. The reveal beat

**File**: `src/pages/quiz/index.astro`

**Intent**: Show the accepted answer, what this device typed, the verdict and the award.

**Contract**: `renderRevealed` takes the accepted answer from `state.revealedAnswerText` and renders
it for a text question in place of the option highlighting. The existing gates are unchanged and all
still apply: a device that never submitted sees the accepted answer and no verdict panel; an unscored
question shows the warm-up line without spending a fetch; the per-device fetch is issued once via
`resultRequested`.

`showResult` gains the echoed line, driven by `text` from the result payload — not from the in-memory
value, which a reload loses. When `text` is absent or null the line is omitted rather than rendered
empty.

**The accepted answer must render before and independently of the fetch.** That is the whole reason
it rides the snapshot, and a failed fetch must cost the attendee their score line and the echo, never
the answer.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — the new `<script>` code reads no `import.meta.env` and value-imports
  nothing from `src/quiz/` or `src/lib/session/`
- `answer.test.ts` (client) covers the text submission path, including that a store failure returns
  `failed` and not `rejected`
- `answer.test.ts` (client) still passes its `withBrokenWrite` localStorage cases — the happy-dom
  Proxy trap in CLAUDE.md means a leaked spy here fails unrelated assertions later in the file
- `render.test.ts` still passes unchanged — `render.ts` is not modified by this phase

#### Manual Verification:

- On a phone-sized viewport, the text question shows a usable field; the keyboard does not cover the
  submit button
- Typing and submitting locks the control and shows the saved note
- Reloading mid-question keeps the clock (award is not full-speed) and, after submitting, keeps the
  lock
- At reveal, the accepted answer and the typed answer both appear, with the verdict and the running
  total
- With the network throttled so `/api/quiz/result` fails, the accepted answer is still on screen and
  no error is shown
- A correct answer typed with a capital letter and a trailing full stop scores as correct

**Implementation Note**: Pause after this phase for confirmation that the manual testing was
successful before proceeding to Phase 5.

---

## Phase 5: The host view and the docs

### Overview

Close the room-facing half, and record the two things a future reader would otherwise have to
re-derive.

### Changes Required:

#### 1. The large screen

**File**: `src/pages/quiz/host.astro`

**Intent**: Show the accepted answer on the projector when a text question is revealed. A reveal beat
where 150 phones show the answer and the large screen shows nothing is the failure the host notices
from the stage.

**Contract**: `render()` gains a branch that displays `state.revealedAnswerText` when it is non-null,
below the prompt, at the large screen's type scale (`text-6xl` family — legible from the back of the
room, which is a real constraint here). Hidden whenever the field is null, which the schema already
guarantees for every phase but `question-revealed`.

The field is already on the wire and already in `SessionState`, so this is a display branch and
nothing more. `renderQuestion` is not modified.

**Merge note**: this file is also touched by S-04 (`host-participation-and-distribution`), planned in
parallel. Whichever lands second should re-read the other's changes rather than assuming this
function's shape.

#### 2. The docs

**File**: `CLAUDE.md`

**Intent**: Record the two facts that are not derivable from reading a single file.

**Contract**: Two short additions:

- Under the quiz-definition section, that `src/quiz/normalize.ts` now exports **two** folds and why
  they are not one: `normalizeAnswer` (answer matching + the authoring-collision check, deliberately
  the same function so they cannot drift) and `normalizePolish` (the display-name claim key at
  `players.ts:100`, which must keep punctuation because `.` is a legal name character and the stored
  claim keys were written with it). Plus the trailing-punctuation rule and the explicit non-goal of
  fuzzy matching.
- Under the LiveQuiz session-data section, that `revealedAnswerText` joined `revealedOptionIds` in
  the `part of the transition` family rather than the `playerCount` decoration family, and that
  `acceptedAnswers[0]` is the variant the room sees.

**File**: `context/foundation/roadmap.md`

**Contract**: Note in the Baseline that free-text scoring now exists, matching how S-02 and S-03
recorded theirs — specifically that `src/quiz/normalize.ts` carries two folds and which one is the
display-name key.

**Do not flip S-05's status or write its Done entry by hand.** That file's Done section records that
`/10x-archive` appends the entry *and* flips the matching item's Status. Doing it here means doing it
twice, and a hand-written entry will not match the format the other six carry. The Baseline note is
the part `/10x-archive` does not write, which is why it is the only part listed above.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Production build succeeds: `bun run build` — this is also the quiz-definition gate, and it is the
  only automated thing standing between a commit and production

#### Manual Verification:

- On a projector-sized window, the accepted answer is legible from across a room at reveal and absent
  in every other phase
- A full two-device run: host advances to the text question, one phone answers correctly and one
  incorrectly, host reveals, and both phones plus the large screen show the right thing
- `docs/runbook-live-session.md` pre-session check still describes reality

**Implementation Note**: This is the last phase; confirm the manual run before archiving.

---

## Testing Strategy

### Unit Tests:

- **The fold** (`src/quiz/normalize.test.ts`) — for `normalizeAnswer`: trailing terminators singly and
  repeated; terminator followed by whitespace; internal hyphen and apostrophe preserved. For
  `normalizePolish`: the existing `ł`/`Ł` regression, plus a new assertion that it does **not** strip
  a trailing `.`, which is what pins it to player identity and keeps the two folds from being merged
  back together by a later edit.
- **The rule** (`src/lib/session/scoring.test.ts`) — every accepted variant of the live question;
  each fold dimension in isolation (case, diacritics, spacing, punctuation) and combined; a near-miss
  misspelling scoring zero; unscored yielding `{ correct: false, awarded: 0 }`; empty and
  whitespace-only inputs; and the cross-kind assertion that text and choice awards agree at equal
  `elapsedMs`.
- **The contracts** (`answers.test.ts`, `state.test.ts`) — the `.default(null)` back-compat cases in
  both, and the phase invariant for `revealedAnswerText` across all four phases.

### Integration Tests:

- **The route** (`answer.test.ts`) — accepted, absent-field, empty, whitespace-only, over-length, and
  the two still-refused kinds; plus the existing choice cases as regression.
- **The reveal** (`routes.test.ts`) — set for text, null for choice, cleared on advance.
- **The result** (`result.test.ts`) — `text` present when answered, null when silent, and the phase
  gate unchanged.

### Manual Testing Steps:

1. Start a session, join from two devices, advance to `zmyslanie-faktow`.
2. On device A type `Halucynacje.` and submit; on device B type `halucynajce` and submit.
3. Reload device A mid-question before submitting and confirm the award is not full-speed.
4. Reveal. Confirm the large screen shows `halucynacje`, device A shows correct with its award and
   its echoed text, device B shows incorrect with its echoed text.
5. Throttle the network on device A, advance and reveal a second time, and confirm the accepted
   answer still appears with no error.
6. `curl` an over-length answer and confirm the refusal.

**Not doing a 150-device rehearsal run.** S-03 ran one because it introduced a new fan-in shape — 150
devices hitting `/api/quiz/result` within a second of each reveal. This slice adds no new shape: the
same routes, the same fan-in, one more question kind through them, and one live text question in a
14-question quiz. The cost model in `answer-contract.md` is unchanged. Stated as a decision so it is
not mistaken for an omission.

## Performance Considerations

Per-request cost is unchanged: the same `readSession` plus the same 7-command `EVAL`, priced at 8
commands per submission in `answer-contract.md`. The fold is a handful of string operations on a
string bounded at 80 characters.

The snapshot grows by one nullable string field, non-null only during `question-revealed` and only
for text questions — one question in fourteen. Negligible against the Ably message budget the spine
contract sizes.

## Migration Notes

Two new fields gain `.default(null)` — `text` on `AnswerRecord` and `revealedAnswerText` on
`SessionState` — for the same reason the existing `revealedOptionIds` and `playerCount` carry theirs,
and it matters in the same way: a session that is *live* when this deploys holds a session document
and answer records written before these fields existed. Required fields would fail `parseSessionState` and `parseAnswerRecord` on the next read — a
409 on the host's next action, on stage, and a device told it never answered.

There is no data migration and nothing to backfill. The session store is short-TTL by construction
and a purge is always available as the escape hatch.

Rollback is `vercel rollback` plus, if a session is mid-flight, a purge and restart. No stored shape
becomes unreadable by the previous build: the previous `parseSessionState` ignores unknown fields, so
a document written by this build parses under the old one.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-05)
- Prerequisite contract: `context/archive/2026-08-08-answer-choice-question-and-reveal/answer-contract.md`
- Retention rules: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Join and client-interactivity precedent: `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
- Recurring rules: `context/foundation/lessons.md` (rule 2 governs the absent-`text` case)
- The seam being extended: `src/pages/api/quiz/answer.ts:132`, `src/lib/session/scoring.ts:15`
- The fold and its trap: `src/quiz/normalize.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The fold and the correctness rule

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — bb2a0e8
- [x] 1.2 Type checking passes: `bun run type-check` — bb2a0e8
- [x] 1.3 `normalize.test.ts` covers `normalizeAnswer`: trailing punctuation, repeated terminators, punctuation with trailing whitespace, internal punctuation preserved — bb2a0e8
- [x] 1.4 `normalize.test.ts` still asserts the `ł`/`Ł` cases — bb2a0e8
- [x] 1.4b `normalize.test.ts` asserts `normalizePolish` is unchanged — a trailing `.` still survives it — bb2a0e8
- [x] 1.4c `players.test.ts` still passes untouched — bb2a0e8
- [x] 1.5 `scoring.test.ts` covers variants, all fold dimensions, near-miss, unscored, empty and whitespace-only — bb2a0e8
- [x] 1.6 `scoring.test.ts` asserts text and choice awards agree at equal `elapsedMs` — bb2a0e8
- [x] 1.7 `schema.test.ts` still passes — bb2a0e8
- [x] 1.8 `definition.test.ts` still passes — bb2a0e8

### Phase 2: The record field and the reveal field

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 3cd25f2
- [x] 2.2 Type checking passes: `bun run type-check` — 3cd25f2
- [x] 2.3 `state.test.ts` asserts non-null `revealedAnswerText` refused outside `question-revealed` — 3cd25f2
- [x] 2.4 `state.test.ts` asserts a document without the field parses to `null` — 3cd25f2
- [x] 2.5 `answers.test.ts` asserts a record without `text` parses to `null` — 3cd25f2
- [x] 2.6 `routes.test.ts` asserts revealing a text question sets the field to the first accepted variant — 3cd25f2
- [x] 2.7 `routes.test.ts` asserts revealing a choice question leaves it null — 3cd25f2
- [x] 2.8 `routes.test.ts` asserts advancing clears it — 3cd25f2
- [x] 2.9 `keys.test.ts` still passes — 3cd25f2

### Phase 3: The submission route and the result payload

#### Automated

- [x] 3.1 Unit tests pass: `bun run test`
- [x] 3.2 Type checking passes: `bun run type-check`
- [x] 3.3 `answer.test.ts` asserts a correct text submission is accepted and stored with raw trimmed text
- [x] 3.4 `answer.test.ts` asserts an absent `text` field is refused, by outcome
- [x] 3.5 `answer.test.ts` asserts empty and whitespace-only `text` are refused
- [x] 3.6 `answer.test.ts` asserts an over-length `text` is refused and nothing is written
- [x] 3.7 `answer.test.ts` asserts `number` and `word-cloud` still receive `unsupportedKind`
- [x] 3.8 `answer.test.ts` asserts the existing choice-path cases are unchanged
- [x] 3.9 `result.test.ts` asserts `text` returned when answered, null when silent
- [x] 3.10 `result.test.ts` asserts the phase gate still refuses an unrevealed text question

#### Manual

- [x] 3.11 `curl` an over-length text body: 400 with a Polish message, nothing written to the store

### Phase 4: The attendee view

#### Automated

- [ ] 4.1 Unit tests pass: `bun run test`
- [ ] 4.2 Type checking passes: `bun run type-check`
- [ ] 4.3 `boundary.test.ts` passes for the new `<script>` code
- [ ] 4.4 client `answer.test.ts` covers the text submission path including 5xx as `failed`
- [ ] 4.5 client `answer.test.ts` still passes its `withBrokenWrite` localStorage cases
- [ ] 4.6 `render.test.ts` still passes unchanged

#### Manual

- [ ] 4.7 Phone-sized viewport: usable field, keyboard does not cover the submit button
- [ ] 4.8 Submitting locks the control and shows the saved note
- [ ] 4.9 Reload mid-question keeps the clock; reload after submitting keeps the lock
- [ ] 4.10 At reveal: accepted answer, typed answer, verdict and running total all appear
- [ ] 4.11 With `/api/quiz/result` failing, the accepted answer is still on screen and no error shows
- [ ] 4.12 A correct answer with a capital letter and a trailing full stop scores correct

### Phase 5: The host view and the docs

#### Automated

- [ ] 5.1 Unit tests pass: `bun run test`
- [ ] 5.2 Type checking passes: `bun run type-check`
- [ ] 5.3 Production build succeeds: `bun run build`

#### Manual

- [ ] 5.4 Projector-sized window: accepted answer legible at reveal, absent in every other phase
- [ ] 5.5 Full two-device run through the text question
- [ ] 5.6 `docs/runbook-live-session.md` still describes reality
