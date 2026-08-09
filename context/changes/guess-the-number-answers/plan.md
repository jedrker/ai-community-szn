# Guess-the-number answers — Implementation Plan

## Overview

Roadmap S-06. An attendee submits a numeric guess and earns points scaled by how close it was, on one
relative-error rule that behaves identically whether the true answer is 67 or 10,000 (PRD FR-013,
US-01).

This is the third kind through the seam S-03 built, and the **first partial-credit answer in the
system**. Everything binary until now — `scoreChoiceAnswer` returns zero or the full weighted value,
`AnswerRecord.correct` is a boolean, the reveal renders `"Dobrze!"` or `"Tym razem nie."` — has to
accommodate a guess that was 4% off and earned 800 of 1000 points.

**This plan assumes S-05 (`free-text-answers`) is implemented first.** It extends S-05's shape rather
than duplicating it: the same `AnswerRecord` field pattern, the same `revealedAnswerText` reveal
channel, the same static-input-in-`index.astro` placement, the same route branch structure. That
decision is what shrinks this slice and removes its collision with both S-04 and S-05.

## Current State Analysis

The scoring module states this slice's contract in its own docstring
(`src/lib/session/scoring.ts:56`): `speedWeight` is exported separately "because S-06's relative-error
curve multiplies this same weight against a partial-credit base." So the award is

```
awarded = round(points × closeness(guess, correctValue) × speedWeight(elapsedMs))
```

and this slice owns only the middle factor. Re-deriving the speed curve would be the one mistake the
module's design was arranged to prevent.

**The magnitude objection is already litigated and closed.** `prd.md:263` records the counter-argument
verbatim — "one distance rule can't span an answer of 67 and an answer of 10,000 — being 30 off is
catastrophic on one and a bullseye on the other" — and resolves it: relative error, magnitude-
independent, one rule covering both drafted questions. That is settled input, not a decision this plan
re-opens.

Both number questions exist in the definition and were deliberately chosen two orders of magnitude
apart, with a comment at `src/quiz/definition.ts:145` saying exactly that:

| Question | `correctValue` | Prompt |
| --- | --- | --- |
| `lyro-automatyzacja` | 67 | Ile procent rozmów z klientami automatyzuje Lyro AI? |
| `ai-devs-absolwenci` | 10000 | Ilu absolwentów ma sam kurs AI_devs? |

Both scored at `POINTS`. Neither can be answered today: `/api/quiz/answer:132` refuses the kind.

Three gaps block the mechanic, and after S-05 two of them are shallow:

1. **There is no closeness function.** `scoring.ts` scores choice only; S-05 adds text correctness
   beside it. Partial credit exists nowhere.
2. **`AnswerRecord` has nowhere to put a number.** S-05 adds `text`; a numeric guess wants to be a
   number, not a string to re-parse at every read.
3. **Nothing parses a Polish decimal.** No code in the project converts user-typed numeric input, and
   Polish writes decimals with a comma.

### Key Discoveries:

- **`correctValue: 0` would make the rule undefined and the schema currently permits it.**
  `src/quiz/schema.ts:137` refuses a non-finite `correctValue` but not a zero one. A relative-error
  rule divides by the true value. This is caught at authoring time, in the same build-time gate that
  already fails a deploy on a malformed quiz.
- **`Intl.NumberFormat("pl-PL")` separates thousands with U+00A0, not U+0020.** Verified on this
  project's Node (22.12.0, full ICU): `format(10000)` is `"10 000"`. A test asserting `"10 000"`
  typed with an ordinary space fails with a diff in which both sides look identical. Any assertion on
  the formatted reveal value must construct the expected string from the formatter or use the escape.
- **The client must not parse the guess.** `boundary.test.ts` forbids a client module value-importing
  from `src/quiz/` or `src/lib/session/`, so a shared parser would have to be duplicated or moved
  across the boundary. It is not needed: the server is the scoring authority and already parses
  untrusted input, and the client only needs to decide whether to enable the submit button — a test
  for "contains a digit" answers that. One parser, no drift.
- **`clampElapsed` and the whole timing contract are kind-agnostic** and applied before the kind
  branch (`answer.ts:164`). Numeric answers inherit them unchanged, as text ones do.
- **The client clock, lock and storage machinery is kind-agnostic** — `markSeen`, `markSubmitted`,
  `hasSubmitted`, `clearSeen` key on question id only. Reload-keeps-its-clock comes free.
- **Reusing `revealedAnswerText` means no `host.astro` change at all.** S-05 adds the branch that
  renders that field on the large screen; a number formatted into the same field renders through it
  unchanged. This slice therefore has **no collision with S-04**, which is also editing `host.astro`.
- **The retention gate is passed for the same reason S-05's was.** `revealedAnswerText` carries the
  correct answer to an already-revealed question — quiz content, nothing about who played. The
  attendee's own guess travels on the per-device `/api/quiz/result` response, where per-player data
  already lives.
- **`logSessionEvent` must never see the guess.** `LogFields` is closed and that closure is the
  enforcement (retention contract rule 2). `{ questionId }` is sufficient.
- **`lessons.md` rule 2 governs the parse.** S-03's `elapsedMs` bug was an absent field taking the
  *favourable* path through a guard written for a hostile one. An absent, empty or unparseable `value`
  field must be refused, and the test must assert the outcome rather than the status code.

## Desired End State

The host advances to `lyro-automatyzacja`. Every phone shows the prompt and a numeric field. An
attendee types `65` and is told at reveal that the answer was 67, that they guessed 65, and that they
earned points — roughly 80% of the question's value before the speed weight, because 65 is within 5%.
One who types `50` earns nothing: 25% off is outside every band. One who types `67,5` is parsed
correctly rather than silently scored as nothing.

The same rule, unchanged and with no per-question tuning, behaves identically on `ai-devs-absolwenci`:
`9,800` is within 5%, `7,000` is outside every band.

At reveal the large screen shows the correct value — through the branch S-05 already built — and each
phone shows the correct value, its own guess, the award and the running total.

Verified by: `bun run test`, `bun run type-check`, `bun run build`, and a two-device manual run
through both number questions.

## What We're NOT Doing

- **No per-question tolerance or difficulty knob.** One rule, magnitude-independent, per the PRD's
  resolution of FR-013. A question that needs its own curve is a question the host cannot explain.
- **No numeric proximity ranking, no "closest guess wins" bonus.** That is a different mechanic and
  is not in any FR.
- **No exposure of the banding thresholds to the attendee UI.** The reveal shows the answer, the guess
  and the award — not an arithmetic breakdown that invites disputes mid-segment.
- **No `host.astro` change.** Reusing `revealedAnswerText` means S-05's branch already covers it.
- **Not S-05's text kind and not S-08's word cloud.** The route keeps refusing `word-cloud` with the
  existing message, and that refusal stays the seam.
- **Not S-04's participation count or distribution.** A numeric distribution is a histogram — a
  different shape from a choice bar chart — and is not designed here.
- **No throttle on `/api/quiz/answer`.** The accepted risk stands as recorded in `answer-contract.md`.
- **No contract document.** Same reasoning S-05 recorded: no new key, no new downstream decision, no
  invariant not enforced in code. Durable notes go to `CLAUDE.md`.
- **No renaming of `ChoiceScore`.** The `{ correct, awarded }` shape fits all three kinds and S-05
  reuses it; a rename now would be churn across a file two slices are landing in.

## Implementation Approach

Identical outward-in shape to S-05, because the seam is the same and consistency between the two
mechanics is worth more here than any local optimisation:

1. **The rule** — pure functions plus the authoring guard.
2. **The data contracts** — the record field and the reveal value.
3. **The request paths** — the route branch and the result payload.
4. **The attendee view** — control, submit, reveal copy.
5. **Docs and the room run.**

Each phase leaves the tree green and leaves both the choice and text paths untouched.

## Critical Implementation Details

**The banding rule, stated once so it cannot drift between the scorer and its tests.** Relative error
is `|guess − correctValue| / |correctValue|`. Bands are inclusive at their upper edge:

| Relative error | Closeness |
| --- | --- |
| exactly 0 | 1.00 |
| ≤ 0.05 | 0.80 |
| ≤ 0.10 | 0.60 |
| ≤ 0.25 | 0.30 |
| > 0.25 | 0 |

`correct` is true **only** on an exact hit, and is therefore false for a guess that earned 800 points.
Any future consumer of that flag must not read it as "scored nothing" — the reveal copy for this kind
is driven by the award and the two numbers, not by the flag.

**Floating point will land on a band edge and must not decide the band by luck.** `0.1 + 0.2 !== 0.3`,
and a guess engineered to sit exactly on 5% (`63.65` against 67) can compare either way depending on
the arithmetic order. Compare with a small epsilon so the boundary falls consistently on the generous
side, and assert the exact-edge cases in tests rather than only the comfortable interiors.

**Partial credit changes what `awarded > 0` means, and one existing behaviour depends on it.** The
attendee view currently decides whether to render the reveal panel from `hasSubmitted`, and the copy
from `correct`. Neither breaks, but the copy branch must be selected by question *kind* before it is
selected by `correct` — otherwise a 60%-scoring guess renders "Tym razem nie." beside a positive
award, which is the conflation the correctness decision was made to avoid.

## Phase 1: The closeness curve and the authoring guard

### Overview

The rule, and the build-time guard that stops a question the rule cannot score from ever deploying.

### Changes Required:

#### 1. The curve

**File**: `src/lib/session/scoring.ts`

**Intent**: Add the relative-error scorer the module docstring already promises, as a third function
beside the choice and text ones, reusing `speedWeight` unchanged so there stays exactly one
implementation of the timing curve.

**Contract**: `scoreNumberAnswer(question: NumberQuestion, guess: number, elapsedMs: number,
windowMs?: number): ChoiceScore` — same return shape as its two siblings, since `{ correct, awarded }`
is what the route and the store already handle.

Behaviour:

- `question.points === null` yields `{ correct: false, awarded: 0 }`, matching both siblings and for
  the reason stated there.
- A non-finite `guess` yields `{ correct: false, awarded: 0 }` — the route refuses these before
  reaching here, so this is the defensive floor, not the guard.
- A `correctValue` of zero yields `{ correct: false, awarded: 0 }` rather than dividing. Phase 1's
  schema refinement makes this unreachable through the build gate; the check exists because a scorer
  that divides by an author's typo should not produce `Infinity` in a stored integer field.
- Relative error uses `Math.abs(correctValue)` as the denominator, so a future negative true value
  does not invert the rule.
- Banding exactly as tabulated in Critical Implementation Details, with an epsilon on the comparisons.
- `correct` is true only when `guess === correctValue`.
- Award is `Math.round(question.points × closeness × speedWeight(elapsedMs, windowMs))`.

Export the band table as a named constant rather than inlining the numbers in comparisons — the plan,
the tests and the CLAUDE.md note all refer to the same five rows, and three copies of a threshold is
how one of them ends up different.

The module docstring should record *why* banded and not linear: a host has to be able to state the
whole rule from the stage in one sentence, which is the same test that made S-05 reject fuzzy text
matching; and a linear curve with a generous tolerance hands most of a question's points to a shrug,
which is the leaderboard-flattening risk the roadmap names for this slice.

#### 2. The authoring guard

**File**: `src/quiz/schema.ts`

**Intent**: Refuse a `number` question whose `correctValue` is zero, at build time, with a message
naming the question — because a relative-error rule divides by it and there is no sensible reading of
"within 5% of zero".

**Contract**: The existing `checkQuestion` refinement's `number` branch gains a second issue for
`question.correctValue === 0`, in the established Polish style (`${where}: ...`).

This is the same gate that already fails `astro build` on a non-finite `correctValue`, so a zero one
now fails the deploy and the previous good quiz stays live. No current question is affected.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `scoring.test.ts` asserts every band against **both** live values (67 and 10,000), proving the rule
  is magnitude-independent — the property FR-013's resolution rests on
- `scoring.test.ts` asserts the exact-edge cases at 5%, 10% and 25% relative error, on both sides
- `scoring.test.ts` asserts an exact hit gives `correct: true` and full closeness
- `scoring.test.ts` asserts a near-miss gives `correct: false` with a **positive** award — the
  partial-credit case the reveal copy depends on
- `scoring.test.ts` asserts an unscored number question yields `{ correct: false, awarded: 0 }`
- `scoring.test.ts` asserts a zero `correctValue` yields no award rather than `Infinity` or `NaN`
- `scoring.test.ts` asserts a number answer and a choice answer at identical closeness and
  `elapsedMs` receive the identical award — the assertion that fails if `speedWeight` is reimplemented
- `schema.test.ts` asserts a `correctValue: 0` question is rejected with a message naming the id
- `definition.test.ts` still passes — neither live question is affected

#### Manual Verification:

- None. Pure functions and a build-time refinement.

**Implementation Note**: No manual pause; proceed once automated verification is green.

---

## Phase 2: The record field and the reveal value

### Overview

Somewhere to put the guess, and the correct value on the wire — through the field S-05 already added.

### Changes Required:

#### 1. The stored guess

**File**: `src/lib/session/answers.ts`

**Intent**: Carry the parsed numeric guess so the reveal can show it back, and so a future numeric
distribution or a stage dispute reads a number rather than re-parsing a string.

**Contract**: `answerRecordSchema` gains `value: z.number().finite().nullable().default(null)`. Choice
answers and text answers leave it `null`.

`.default(null)` is load-bearing for exactly the reason S-05's `text` and S-03's `revealedOptionIds`
carry theirs: a record written before this ships must still parse, or `readOwnResult` returns `null`
and the route tells a device it never answered.

`.finite()` matters here specifically — this is the only field in the record whose value comes from
arithmetic on untrusted input, and `Infinity` serialises to `null` through `JSON.stringify`, which
would round-trip into a record that parses but has silently lost its value.

#### 2. The reveal value

**File**: `src/pages/api/quiz/host/reveal.ts`

**Intent**: Put the correct number on the broadcast, reusing the string field S-05 added rather than
introducing a third sibling into a family whose two existing members already needed a long docstring
explaining that they behave oppositely.

**Contract**: The `question-revealed` state sets `revealedAnswerText` to the formatted correct value
when `question.kind === "number"`, extending the branch S-05 wrote for `text`. `revealedOptionIds`
keeps its current expression.

Formatting is `Intl.NumberFormat("pl-PL")` — `10000` becomes `10 000`, which is what a Polish reader
expects on a projector. **The group separator is U+00A0**, verified on this project's Node 22.12; a
test asserting a normal space fails with a diff in which both strings look identical, so the expected
value must come from the formatter or an explicit escape.

Formatting server-side rather than per device is a consequence of reusing a string field, and is
correct here: the host's screen and 150 phones must show the same string, and a per-device locale
would let them disagree.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `answers.test.ts` asserts a record without `value` parses and yields `null`
- `answers.test.ts` asserts a non-finite `value` is rejected
- `routes.test.ts` asserts revealing each live number question sets `revealedAnswerText` to the
  pl-PL-formatted value, with the expected string built from the formatter rather than typed
- `routes.test.ts` asserts revealing a number question leaves `revealedOptionIds` empty
- `routes.test.ts` asserts advancing past a revealed number question clears `revealedAnswerText`
- `state.test.ts` still passes — no new state field, so its invariants are unchanged
- `keys.test.ts` still passes — no new namespaced literal

#### Manual Verification:

- None. Nothing reaches a screen until Phase 4.

**Implementation Note**: No manual pause; proceed once automated verification is green.

---

## Phase 3: The route and the result payload

### Overview

Parse an untrusted number the way Polish attendees actually type one, bound it, score it, and return
it.

### Changes Required:

#### 1. The parser

**File**: `src/pages/api/quiz/answer.ts` (or a small pure helper beside it, implementer's choice)

**Intent**: Convert what a phone sent into a number, accepting the separators a Polish attendee will
actually use, and refusing everything else rather than coercing it.

**Contract**: One function, server-side only, that takes the raw form value and returns a number or a
sentinel for "not a number". It must:

- Accept `67`, `67.5`, `67,5`, and values with spaces used as thousands separators (including U+00A0,
  which is what a paste from a formatted source carries).
- Treat a comma as a decimal separator, not a thousands separator — `67,5` is 67.5, never 675.
- Refuse an absent field, an empty string, a whitespace-only string, and anything with a non-numeric
  remainder. **Not** a bare `Number()`: `Number("")` is `0` and `Number(null)` is `0`, which is the
  exact shape of the `elapsedMs` bug `lessons.md` rule 2 was written about, and here it would score a
  device that sent nothing as having guessed zero.

This is the only parser. The client does not have one — see Key Discoveries.

#### 2. The route branch

**File**: `src/pages/api/quiz/answer.ts`

**Intent**: Accept and score a numeric submission with every guard the other kinds have, plus the one
bound this kind needs.

**Contract**: A `value` form field joins `optionIds` and S-05's `text`. The kind check narrows again,
now refusing only `word-cloud` with `MESSAGES.unsupportedKind` — the seam stays for S-08.

Order matters:

- Parse explicitly. An unparseable or absent value is refused with a Polish message, never scored.
- Bound the magnitude before the store: refuse anything non-finite, and refuse `Math.abs(value)`
  beyond `1e12` with its own message. Negatives pass through and simply score zero — a guess below
  zero is wrong, not malformed. The bound closes the same write-anything class the route already
  closed for `optionIds`, and keeps `NaN`/`Infinity` out of an arithmetic path whose result is stored
  as an integer.
- Score with `scoreNumberAnswer`, using the same `clampElapsed(rawElapsed, now - updatedAt)` the other
  kinds use.
- Store the parsed number in the record's `value`, with `optionIds: []` and `text: null`.

Everything around the branch — the phase gate, the player check, the `submitAnswer` outcome handling,
the verdict-free response — is untouched.

#### 3. The result payload

**File**: `src/pages/api/quiz/result.ts`

**Intent**: Return this device its own guess, so the reveal can show it after a reload — the in-memory
value does not survive one.

**Contract**: The `answered: true` response gains `value: result.answer.value`; the two
`answered: false` responses and the `ended` response carry `value: null`. The phase gate is unchanged
and protects this exactly as it protects `correct` and `awarded`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Parser tests cover: `67`, `67.5`, `67,5`, `10 000` with both space kinds, leading/trailing
  whitespace, and that `67,5` is 67.5 and not 675
- Parser tests assert refusal of: absent, empty, whitespace-only, `abc`, `67abc`, `--5`, `Infinity`,
  `NaN`
- `answer.test.ts` asserts a submission with **no** `value` field is refused, asserted by outcome and
  not merely by status — `lessons.md` rule 2
- `answer.test.ts` asserts a correct guess is accepted and stored with the parsed number, empty
  `optionIds` and null `text`
- `answer.test.ts` asserts a near-miss is accepted with a positive award and `correct: false`
- `answer.test.ts` asserts an over-magnitude value is refused and nothing is written
- `answer.test.ts` asserts a negative guess is accepted and scores zero
- `answer.test.ts` asserts `word-cloud` still receives `unsupportedKind`
- `answer.test.ts` asserts the existing choice and text cases are unchanged
- `result.test.ts` asserts `value` is returned when answered and null when silent
- `result.test.ts` asserts the phase gate still refuses an unrevealed number question

#### Manual Verification:

- `curl` the answer route with `value=1e300` against a running dev session: refused, nothing written
- `curl` with `value=67,5`: accepted and scored as 67.5

**Implementation Note**: Pause after this phase for confirmation that the manual checks passed before
starting Phase 4.

---

## Phase 4: The attendee view

### Overview

The field, the submit path, and the third reveal-copy branch.

### Changes Required:

#### 1. The input control

**File**: `src/pages/quiz/index.astro`

**Intent**: Give a number question a field, following the placement S-05 established rather than
inventing a second pattern.

**Contract**: A hidden `<input type="text" inputmode="decimal">` in the markup beside S-05's text
input, shown when the open question is `number`.

**A text input with `inputmode`, not `type="number"`** — and this is the decision, not an oversight.
`type="number"` picks its accepted decimal separator from the browser locale, so the same typed
characters parse differently on two phones in the same room; and it reports an empty string for any
value it considers invalid, which collides directly with `lessons.md` rule 2. `inputmode="decimal"`
gets the numeric keypad without either problem.

Attribute set follows the `display-name` input: `autocomplete="off"`, `autocorrect="off"`,
`spellcheck="false"`, and a `maxlength` comfortably above any plausible guess.

`hideAnswerControls()` must hide it. That function exists precisely so no branch can leave a control
on screen, and it now has three to remember.

#### 2. The open beat

**File**: `src/pages/quiz/index.astro`

**Intent**: Render a number question as answerable, with the same lock, note and disabled-submit
behaviour the other two kinds have.

**Contract**: `renderOpen`'s `answerable` test extends to `kind === "number"`. For that kind:

- The question renders prompt-only through `renderQuestion` in `static` mode, with the input below.
- `markSeen` is called, exactly as for the other kinds — this is the reload-keeps-its-clock property.
- The submit button is disabled until the field contains at least one digit. **A loose test, not a
  parse** — the server is the only parser, and a client-side parse would either duplicate it or cross
  the boundary `boundary.test.ts` enforces.
- When `hasSubmitted` is true the input is disabled rather than hidden, so the attendee still sees
  what they sent.
- The FR-017 note branch gets a number-appropriate line for a scored question. It should say that
  closeness counts, without stating the bands — the thresholds are deliberately not exposed.

Keep the typed value in the same per-question `Map` pattern `selections` uses, and toggle the submit
button's disabled state directly on input rather than calling `render()` per keystroke — `render()`
rebuilds the question container and would fight the field.

#### 3. The submit path

**File**: `src/lib/client/answer.ts` and `src/pages/quiz/index.astro`

**Intent**: Send the raw typed string through the same request, guard and outcome handling the other
kinds use.

**Contract**: `submitAnswer` carries the raw string in a `value` field. The per-question `inFlight`
guard, the 10s timeout and the `accepted` / `rejected` / `failed` split are reused unchanged.

The raw string travels, not a client-parsed number — one parser, server-side.

The 5xx-is-not-a-refusal reasoning at `answer.ts:220` is the most important thing in that module and
must survive whatever shape the signature has taken after S-05.

#### 4. The reveal beat

**File**: `src/pages/quiz/index.astro`

**Intent**: Show the correct value, this device's guess and the award, in copy that reads as a
near-miss rather than a pass/fail.

**Contract**: `renderRevealed` shows `state.revealedAnswerText` for a number question exactly as it
does for a text one — the same field, so this is largely already true after S-05.

`showResult` gains the number branch, and **the branch must be selected by question kind before it is
selected by `correct`**. `correct` is true only on an exact hit for this kind, so a kind-blind branch
renders "Tym razem nie." beside an award of 800 — the conflation the correctness decision was made to
avoid.

The panel shows: the correct value, the device's guess (from the result payload's `value`, not from
memory, which a reload loses), the award, and the running total. It does **not** show the relative
error or the band — those invite arithmetic disputes at the busiest moment of the beat.

Copy should distinguish an exact hit from a scoring near-miss from a zero, in Polish, without naming a
threshold.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — the new script code reads no `import.meta.env` and value-imports nothing
  from `src/quiz/` or `src/lib/session/`, which is what keeps the parser server-side
- client `answer.test.ts` covers the numeric submission path, including that a 5xx returns `failed`
  and not `rejected`
- client `answer.test.ts` still passes its `withBrokenWrite` localStorage cases — the happy-dom Proxy
  trap in CLAUDE.md means a leaked spy here fails unrelated assertions later in the file
- `render.test.ts` still passes unchanged — `render.ts` is not modified

#### Manual Verification:

- On a phone-sized viewport the numeric keypad appears, and the keyboard does not cover the submit
  button
- Typing `67,5` is accepted; typing letters leaves the submit button disabled
- Submitting locks the control and shows the saved note
- Reloading mid-question keeps the clock; reloading after submitting keeps the lock
- At reveal on `lyro-automatyzacja`: a guess of 65 shows the answer, the guess, a positive award and
  copy that does not say the attendee was wrong
- A guess of 50 shows zero points without implying a system failure
- With `/api/quiz/result` failing, the correct value is still on screen and no error is shown

**Implementation Note**: Pause after this phase for confirmation that the manual testing was
successful before proceeding to Phase 5.

---

## Phase 5: Docs and the room run

### Overview

Record the two things that are not derivable from one file, and prove the mechanic in a room-shaped
run.

### Changes Required:

#### 1. The docs

**File**: `CLAUDE.md`

**Intent**: Record the band table and the partial-credit consequence, both of which a future reader
would otherwise have to reconstruct from tests.

**Contract**: Two short additions to the LiveQuiz sections:

- The banding rule as the five-row table, stated once, with the note that it is exported as a
  constant and that the plan, tests and this table must agree.
- That `AnswerRecord.correct` is **exact-hit only** for number questions and is therefore false for
  answers that scored well — so no consumer may read it as "scored nothing". This is the single most
  likely thing for a later slice (S-07's leaderboard especially) to get wrong.

Also note that the reveal formats numbers server-side into `revealedAnswerText` with pl-PL grouping,
and that the separator is U+00A0.

**File**: `context/foundation/roadmap.md`

**Contract**: Flip S-06 to `done` in the At-a-glance table, its own section and the Backlog Handoff
row. Note in the Baseline that partial-credit numeric scoring now exists, matching how S-02 and S-03
recorded theirs.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Production build succeeds: `bun run build` — this is also the quiz-definition gate, and the only
  automated thing standing between a commit and production

#### Manual Verification:

- A full two-device run through **both** number questions, not just one — the magnitude-independence
  claim is the FR's whole resolution and is only observable across the pair
- On `ai-devs-absolwenci`, a guess of 9,800 scores well and 7,000 scores nothing, mirroring the 65/50
  behaviour on the 67-answer question
- The large screen shows the formatted correct value at reveal, with no `host.astro` change having
  been made
- `docs/runbook-live-session.md` still describes reality

**Implementation Note**: Last phase; confirm the manual run before archiving.

---

## Testing Strategy

### Unit Tests:

- **The curve** (`src/lib/session/scoring.test.ts`) — every band against both 67 and 10,000; the exact
  edges at 5%, 10% and 25% from both sides; exact hit; near-miss with positive award and
  `correct: false`; unscored; zero `correctValue`; negative guess; and the cross-kind assertion that
  number and choice awards agree at equal closeness and `elapsedMs`.
- **The parser** — the separator matrix (`.`, `,`, space, U+00A0), and the refusal set (absent, empty,
  whitespace, alphabetic, trailing garbage, non-finite).
- **The guard** (`schema.test.ts`) — `correctValue: 0` rejected by id.
- **The record** (`answers.test.ts`) — `.default(null)` back-compat, and non-finite rejection.

### Integration Tests:

- **The route** (`answer.test.ts`) — accepted, absent-field, unparseable, over-magnitude, negative,
  near-miss; plus the choice and text cases as regression.
- **The reveal** (`routes.test.ts`) — formatted value set for number, cleared on advance, and
  `revealedOptionIds` left empty.
- **The result** (`result.test.ts`) — `value` present when answered, null when silent, gate unchanged.

### Manual Testing Steps:

1. Start a session, join from two devices, advance to `lyro-automatyzacja`.
2. Device A guesses `65`; device B guesses `50`. Reveal.
3. Confirm A sees the answer 67, its guess 65, a positive award, and copy that does not call it wrong;
   B sees zero points without an error.
4. Advance to `ai-devs-absolwenci`. Device A guesses `9800`, device B guesses `7000`. Reveal.
5. Confirm the same relative behaviour at a different magnitude, and that the large screen shows
   `10 000` formatted.
6. Reload device A mid-question before submitting and confirm the award is not full-speed.
7. `curl` `value=1e300` and confirm the refusal; `curl` `value=67,5` and confirm it parses as 67.5.

**Not doing a 150-device rehearsal run**, for the same reason S-05 does not: no new fan-in shape. Same
routes, same per-reveal fan-in, one more kind through them. The cost model in `answer-contract.md` is
unchanged. Stated as a decision so it is not read as an omission.

## Performance Considerations

Per-request cost is unchanged — the same `readSession` plus the same 7-command `EVAL`, priced at 8
commands per submission in `answer-contract.md`. The curve is a handful of arithmetic operations.

The snapshot does not grow at all: the correct value reuses `revealedAnswerText`, the field S-05
already added.

## Migration Notes

`AnswerRecord.value` carries `.default(null)` for the same reason S-05's `text` and S-03's fields do:
a session live when this deploys holds records written before the field existed, and a required field
would fail `parseAnswerRecord` and report `answered: false` to a device that watched its answer land.

No data migration, nothing to backfill. The store is short-TTL by construction and purge is the escape
hatch.

Rollback is `vercel rollback` plus, mid-session, a purge and restart. No stored shape becomes
unreadable to the previous build — the earlier `parseAnswerRecord` ignores unknown fields.

The one deploy-ordering constraint: **this slice depends on S-05 having shipped**, because it reuses
`revealedAnswerText` and S-05's record and view structure. Shipping S-06 against a tree without S-05
will not type-check.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-06)
- The FR and its settled magnitude objection: `context/foundation/prd.md:263` (FR-013), and Business
  Logic Changes
- Prerequisite contract: `context/archive/2026-08-08-answer-choice-question-and-reveal/answer-contract.md`
- Sibling slice this extends: `context/changes/free-text-answers/plan.md`
- Retention rules: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Recurring rules: `context/foundation/lessons.md` (rule 2 governs the parse)
- The seam being extended: `src/lib/session/scoring.ts:56`, `src/pages/api/quiz/answer.ts:132`
- The two live questions and why they differ by two orders of magnitude: `src/quiz/definition.ts:145`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The closeness curve and the authoring guard

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — a99048b
- [x] 1.2 Type checking passes: `bun run type-check` — a99048b
- [x] 1.3 `scoring.test.ts` asserts every band against both 67 and 10,000 — a99048b
- [x] 1.4 `scoring.test.ts` asserts the exact edges at 5%, 10% and 25% from both sides — a99048b
- [x] 1.5 `scoring.test.ts` asserts an exact hit gives `correct: true` and full closeness — a99048b
- [x] 1.6 `scoring.test.ts` asserts a near-miss gives `correct: false` with a positive award — a99048b
- [x] 1.7 `scoring.test.ts` asserts an unscored number question yields no award — a99048b
- [x] 1.8 `scoring.test.ts` asserts a zero `correctValue` yields no award, not `Infinity` or `NaN` — a99048b
- [x] 1.9 `scoring.test.ts` asserts number and choice awards agree at equal closeness and `elapsedMs` — a99048b
- [x] 1.10 `schema.test.ts` asserts `correctValue: 0` is rejected with a message naming the id — a99048b
- [x] 1.11 `definition.test.ts` still passes — a99048b

### Phase 2: The record field and the reveal value

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 88a0f52
- [x] 2.2 Type checking passes: `bun run type-check` — 88a0f52
- [x] 2.3 `answers.test.ts` asserts a record without `value` parses to `null` — 88a0f52
- [x] 2.4 `answers.test.ts` asserts a non-finite `value` is rejected — 88a0f52
- [x] 2.5 `routes.test.ts` asserts revealing each number question sets the pl-PL-formatted value, expected string built from the formatter — 88a0f52
- [x] 2.6 `routes.test.ts` asserts revealing a number question leaves `revealedOptionIds` empty — 88a0f52
- [x] 2.7 `routes.test.ts` asserts advancing clears `revealedAnswerText` — 88a0f52
- [x] 2.8 `state.test.ts` still passes — 88a0f52
- [x] 2.9 `keys.test.ts` still passes — 88a0f52

### Phase 3: The route and the result payload

#### Automated

- [x] 3.1 Unit tests pass: `bun run test` — 4db9aad
- [x] 3.2 Type checking passes: `bun run type-check` — 4db9aad
- [x] 3.3 Parser tests cover the separator matrix including U+00A0, and that `67,5` is 67.5 not 675 — 4db9aad
- [x] 3.4 Parser tests assert the refusal set: absent, empty, whitespace, alphabetic, trailing garbage, non-finite — 4db9aad
- [x] 3.5 `answer.test.ts` asserts an absent `value` field is refused, by outcome — 4db9aad
- [x] 3.6 `answer.test.ts` asserts a correct guess is stored with the parsed number, empty `optionIds`, null `text` — 4db9aad
- [x] 3.7 `answer.test.ts` asserts a near-miss is accepted with a positive award and `correct: false` — 4db9aad
- [x] 3.8 `answer.test.ts` asserts an over-magnitude value is refused and nothing is written — 4db9aad
- [x] 3.9 `answer.test.ts` asserts a negative guess is accepted and scores zero — 4db9aad
- [x] 3.10 `answer.test.ts` asserts `word-cloud` still receives `unsupportedKind` — 4db9aad
- [x] 3.11 `answer.test.ts` asserts the existing choice and text cases are unchanged — 4db9aad
- [x] 3.12 `result.test.ts` asserts `value` returned when answered, null when silent — 4db9aad
- [x] 3.13 `result.test.ts` asserts the phase gate still refuses an unrevealed number question — 4db9aad

#### Manual

- [x] 3.14 `curl` `value=1e300`: refused, nothing written — 4db9aad
- [x] 3.15 `curl` `value=67,5`: accepted and scored as 67.5 — 4db9aad

### Phase 4: The attendee view

#### Automated

- [x] 4.1 Unit tests pass: `bun run test` — 942039c
- [x] 4.2 Type checking passes: `bun run type-check` — 942039c
- [x] 4.3 `boundary.test.ts` passes for the new script code — 942039c
- [x] 4.4 client `answer.test.ts` covers the numeric submission path including 5xx as `failed` — 942039c
- [x] 4.5 client `answer.test.ts` still passes its `withBrokenWrite` localStorage cases — 942039c
- [x] 4.6 `render.test.ts` still passes unchanged — 942039c

#### Manual

- [x] 4.7 Phone-sized viewport: numeric keypad appears, keyboard does not cover the submit button — 942039c
- [x] 4.8 `67,5` accepted; letters leave the submit button disabled — 942039c
- [x] 4.9 Submitting locks the control and shows the saved note — 942039c
- [x] 4.10 Reload mid-question keeps the clock; reload after submitting keeps the lock — 942039c
- [x] 4.11 A guess of 65 shows answer, guess, positive award, and copy that does not say wrong — 942039c
- [x] 4.12 A guess of 50 shows zero points without implying a failure — 942039c
- [x] 4.13 With `/api/quiz/result` failing, the correct value is still on screen and no error shows — 942039c

### Phase 5: Docs and the room run

#### Automated

- [x] 5.1 Unit tests pass: `bun run test`
- [x] 5.2 Type checking passes: `bun run type-check`
- [x] 5.3 Production build succeeds: `bun run build`

#### Manual

- [x] 5.4 Two-device run through both number questions
- [x] 5.5 On `ai-devs-absolwenci`, 9,800 scores well and 7,000 scores nothing
- [x] 5.6 The large screen shows the formatted correct value with no `host.astro` change
- [x] 5.7 `docs/runbook-live-session.md` still describes reality
