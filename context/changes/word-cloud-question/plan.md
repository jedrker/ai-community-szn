# Word-cloud question (S-08) Implementation Plan

## Overview

An attendee submits one word to the unscored word-cloud question that opens the segment, and the
aggregate fills visibly on the projector as the room answers (PRD FR-012, FR-015; roadmap S-08).

This is the last of the five question kinds and the only mechanic whose display updates
*continuously* rather than on a host action. That single difference decides the whole architecture:
the cloud is a **host-side polled read**, not a snapshot field. Everything else in this slice follows
patterns S-03 through S-07 already established.

## Current State Analysis

The kind is half-built. `word-cloud` is a real member of the discriminated union
(`src/quiz/schema.ts:66`), the build gate already refuses a scored one (`schema.ts:173`, message in
Polish), `publicQuiz` already projects it as prompt-only (`src/quiz/public.ts:152`), and
`quiz.questions[0]` — `smieszne-slowo-ai`, "Napisz śmieszne słowo związane z AI" — is a word cloud
that opens the drafted quiz (`definition.ts:23`).

Nothing stores, reads or renders a word. Four seams are stubbed with comments naming this slice:

| Seam | Today |
| --- | --- |
| `src/pages/api/quiz/answer.ts:147` | Refuses the kind with `MESSAGES.unsupportedKind` (409) rather than crashing |
| `src/pages/quiz/index.astro:679` | `answerable` excludes the kind; prompt renders as static text, no control |
| `src/pages/api/quiz/host/reveal.ts:159` | `revealedAnswerText` is `null` — "no correct answer to carry (S-08)" |
| `src/lib/client/render.ts:120,162` | `textContent` never `innerHTML`, written *because* this slice feeds it attendee text |

The two constraints that shape the design:

- **`infrastructure.md:216`** — Ably's free tier allows 200 peak connections but only **100
  messages/second**, and one broadcast to 150 clients bills as 150 messages *simultaneously*. A cloud
  that published on each submission is the O(N²) fan-out `spine-contract.md` forbids, and there is no
  host action to attach it to either.
- **FR-005's scope note (`prd.md:257`)** — "It does not override FR-015 — an unscored word-cloud
  question has no correct answer to leak, so its aggregate may display live." The leak reasoning that
  keeps `revealedDistribution` off the wire until reveal does not apply here.

## Desired End State

The host advances to Q1. The projector shows the prompt and, below it, `odpowiedzi N / M` and a cloud
of words whose type size scales with how many people typed each one, refreshing every ~2.5 s. An
attendee types one word, taps send, and sees their own word echoed with a line pointing at the big
screen. The host reveals; the cloud takes one final read and freezes for the host to talk over. The
host advances; the cloud disappears and the panel resets.

Verified by: `bun run test`, `bun run type-check`, and a two-device manual run against a real session
(the manual half is where the affordance either delivers or quietly does not — `lessons.md` rule 1).

### Key Discoveries

- **`participation.ts` is the template, in full.** Host-secret gated (unlike the open
  `/api/quiz/state`), writes nothing, echoes `questionId` back so a reply landing after the host
  advanced is discarded, returns `null`-not-`0` on a failed read, and asserts the writes-nothing rule
  against its own source in `participation.test.ts:212`.
- **`participation.ts:20` names this slice's trap directly.** During `question-open` the session
  document's `updatedAt` *is* the moment the question opened, and it bounds the speed clamp — "a live
  participation count, say" is called out as the change that would silently inflate every award after
  it. The words route must write nothing, for the same reason and with the same assertion.
- **`SUBMIT_ANSWER`'s counter tail is already generic** (`store.ts:366`): `for i = 8, #ARGV do
  redis.call('HINCRBY', KEYS[5], ARGV[i], 1) end`. A word counter is one more entry in it, below the
  `HSETNX` — so a duplicate submission can never double-count a word, inheriting the atomicity that
  makes the first answer final.
- **`normalize.ts:5` asserts "There are two [folds] on purpose"**, and CLAUDE.md repeats it as a
  table. A third fold makes that sentence false. `lessons.md`'s "Check every path that emits a shared
  document" entry is about exactly this class of stale guarantee, and its rule is to amend the
  documents that state the old one *in the same change*.
- **`keys.ts:104` says the tallies hash is "NOT attendee data — the first registered key that is
  not."** A word family makes it attendee-*authored* text. Aggregated, keyed by no player id and no
  name, so it still identifies nobody and is still re-armed by `end` and deleted by `purge` — but the
  registry entry's claim has to be corrected where it is made, the way `playerCount`'s note in
  `state.ts:97` was corrected when S-07 falsified it.
- **`lessons.md` rule 3** forbids widening a shared fold in place. The new fold is added *beside*
  `normalizePolish` and `normalizeAnswer`, and `normalize.test.ts`'s existing tripwire
  (`normalizePolish("Ania.") !== normalizePolish("Ania")`) must stay green untouched.
- **The `answered` count is free.** `readWordCloud` reads the tallies hash with one `HGETALL`, and
  that reply already contains `answered:<questionId>`. No second command is needed for the numerator.

## What We're NOT Doing

- **No snapshot field.** The cloud never enters `SessionState`. No sixth field, no new phase, no
  change to `state.ts` at all. (`leaderboard-contract.md` requires reading it before adding either;
  this slice adds neither.)
- **No cloud on attendee phones.** FR-015 asks the *host* to display it; 150 devices polling an
  aggregate is the densest command path this slice could add and buys nothing the projector does not
  already give the room.
- **No moderation, and no host-side blank-the-cloud control.** PRD §Non-Goals parks it
  (`prd.md:420`); building half of it here would reopen a closed decision by the back door. The host
  can advance past the question, which is the escape hatch that already exists.
- **No new store key.** The counters go in `livequiz:tallies`, so `keys.ts`'s registry, `end`,
  `purge` and `scripts/check-purge-residue.ts` need no change.
- **No scoring function.** The build gate guarantees `points === null` for this kind, so there is
  nothing to score. `scoring.ts:17` already states that this slice "takes none of" the seam.
- **No room-scale rehearsal re-run.** S-07 drew this boundary and this slice follows it; the stale
  comment in `scripts/rehearse-room.ts:1500` is corrected and the gap is recorded in the contract.
  Accepted risk, named in the brief.
- **No emoji.** Excluded by the character allowlist, same reasoning and same accepted cost as
  `players.ts:37`: predictable rendering at projector scale on whatever the venue laptop is.

## Implementation Approach

The mechanic splits along the same seam every other kind does: a pure domain module holds the rule, a
route enforces it, the store counts it atomically, and two views render it. The one novel piece is
that the aggregate reaches the room by **polling on the host's device** rather than by broadcast.

```
attendee phone                  server                          projector
─────────────                   ──────                          ─────────
type one word
  POST /api/quiz/answer ───▶  validateWord → foldWord
                              SUBMIT_ANSWER (one Lua):
                                HSETNX answers  (the lock)
                                HINCRBY tallies word:<q>:<fold>
  ◀─── { accepted: true }
echo own word                                            GET /api/quiz/host/words ◀── every ~2.5s
                                HGETALL tallies ──▶ filter, total-order, top 30
                                                         ◀─ { answered, playerCount, words, distinct }
                                                            renderWordCloud (chips, size ∝ count)
```

Nothing is published to Ably by any of it. The host's own snapshot subscription is untouched.

## Critical Implementation Details

**Timing & lifecycle.** The poll must re-arm from exactly one place and must not stack — `host.astro`
already carries a `polling` flag whose docstring records the bug that produced it (`host.astro:379`:
`render` runs on every snapshot, and a tick armed from there while a fetch was open held several
requests at once). The word-cloud loop reuses that machinery rather than adding a second timer. The
final read at `question-revealed` needs its own idempotence: without a per-question "final read
landed" flag, the loop re-arms forever on a question that can no longer receive submissions.

**Performance constraints.** One `HGETALL` + one `HLEN` per tick, on one device, ~2.5 s while a
word-cloud question is on screen — ~24 ticks ≈ 48 billed commands for the whole beat. Per submission
the count is unchanged at **11** (a `readSession` plus a 10-command `EVAL`): the word counter replaces
the option counters a choice answer would have incremented. The budget baseline this sits against is
unexplained, per `command-counter-diagnostic.md`, which is what makes "negligible" an assumption
rather than a measurement.

**User experience spec.** The word field is a **static sibling** of `#answer-text` and
`#answer-number`, never something `renderQuestion` emits: that function calls `replaceChildren()` and
`render()` fires on every snapshot, so an input inside the question container is destroyed
mid-keystroke by another attendee joining (`index.astro:130`). The same `dataset.questionId`
reconciliation rule applies.

---

## Phase 1: The word rule

### Overview

The pure half: what a word is, what makes two words the same word, and how the counter field is
spelled. No store access, no route, no `import.meta.env` — the split `players.ts` holds for joining
and `scoring.ts` for awarding.

### Changes Required

#### 1. The new domain module

**File**: `src/lib/session/words.ts` (new)

**Intent**: Own the word-cloud domain rule — the third fold, the submission validation, and the two
display bounds — so the route, the store and both views read one definition. Mirrors `players.ts`
(validation returning a display form plus a grouping key) and `guess.ts` (one parser, server-side).

**Contract**:

- `MAX_WORD_LENGTH = 24` — the same number and the same reasoning as `MAX_DISPLAY_NAME_LENGTH`: what
  fits a projected line at the type size the back of a venue room needs. Three readers that must not
  drift: the route's visible refusal, `answerRecordSchema`'s `.max()`, and the input's `maxlength`
  (which reaches the markup through frontmatter, never through the `<script>` block —
  `boundary.test.ts`).
- `WORD_CLOUD_SIZE = 30` — how many words reach the projector. Two readers: the store's slice and the
  host panel's "N z M" line.
- `foldWord(value: string): string` — trim, collapse internal whitespace, lowercase. **Diacritics are
  deliberately preserved**, which is the whole reason this is not `normalizeAnswer`: the folded form
  *is* what the projector displays, and a Polish word with its diacritics stripped reads as a typo on
  a screen the room is looking at. Accepted cost, stated in the docstring: a word typed both with and
  without diacritics counts as two entries — cosmetic on an unscored question, where the same slip in
  answer matching would cost points. Plain `toLowerCase()`, not `toLocaleLowerCase("pl")`: Polish has
  no locale-specific case mapping (unlike Turkish dotless i), and the docstring should say so, since
  the omission otherwise looks like one.
- `validateWord(raw: string): { ok: true; word: string; key: string } | { ok: false; error: string }`
  — trimmed; refuses empty, refuses **any** internal whitespace (FR-012 asks for one word, and a
  refusal an attendee can read beats a truncation they cannot see), refuses over `MAX_WORD_LENGTH`
  measured on the trimmed value, refuses anything outside `/^[\p{L}\p{N}._'-]+$/u` (`players.ts`'s
  allowlist minus the space). Messages in Polish — the attendee view renders them directly. `key` is
  `foldWord(word)`, with the same empty-key guard `players.ts:107` carries and for the same stated
  reason: unreachable through the allowlist as it stands, and the two rules are far enough apart in
  the file that a later edit to either could open it.

#### 2. The third tallies field family

**File**: `src/lib/session/tallies.ts`

**Intent**: Add the word counter's field format beside `answeredField` and `optionField`, plus the
inverse the read path needs, so the write and read paths cannot disagree about a name — the reason
this module exists.

**Contract**: `wordField(questionId, foldedWord): string` → `word:<questionId>:<foldedWord>`, and
`wordFromField(questionId, field): string | null` returning the word for a field belonging to that
question and `null` otherwise.

The inverse must be a **prefix strip, never `split(":")`**. A folded word may contain a colon (the
fold removes nothing but case and whitespace), so splitting would silently truncate it to the segment
before the colon and merge two distinct words into one chip. The question id cannot contain a colon
(`QUESTION_ID` in `src/quiz/schema.ts:16` rejects it), which is what makes the prefix unambiguous —
the same reasoning `answerField` already rests on.

Extend the module docstring: it currently says "two field families" in the collision note; there are
three, and the third is the only one whose cardinality is unbounded.

#### 3. Correct the "two folds" claim

**File**: `src/quiz/normalize.ts`

**Intent**: The module docstring asserts there are two folds on purpose and tabulates them. A third
now exists and a reader arriving here — the natural place to look — must be told, or the assertion is
a false guarantee of the kind `lessons.md`'s newest entry is about.

**Contract**: Extend the docstring's table with a third row naming `foldWord` in
`src/lib/session/words.ts`, what it folds (case and whitespace, **not** diacritics), what it owns
(FR-012/FR-015 word grouping), and **why it lives outside this file**: it is a session-aggregation
rule, not a definition rule — the same reasoning that keeps `scoring.ts` out of `src/quiz/` per
CLAUDE.md. State that the two folds here are unchanged, because "a third fold was added" and "one of
these two was widened" are the two readings and only one of them is safe.

### Success Criteria

#### Automated Verification

- `bun run test` passes
- `bun run type-check` reports 0 errors
- New `src/lib/session/words.test.ts` covers: case folding merges `AI`/`ai`/`Ai`; diacritics survive
  the fold (`Żółw` → `żółw`, not `zolw`); internal whitespace is refused, not collapsed into an
  accepted entry; the length bound is measured on the trimmed value; the allowlist refuses an emoji
  and accepts a hyphen and an apostrophe; an empty and a whitespace-only input are refused
- `normalize.test.ts` asserts `foldWord` and `normalizeAnswer` disagree on a diacritic-bearing word —
  the tripwire against a future edit collapsing the third fold into the second
- `normalize.test.ts`'s existing `normalizePolish("Ania.") !== normalizePolish("Ania")` still passes,
  unmodified
- `tallies.test.ts` extends the collision matrix to three families and round-trips a word containing
  a colon through `wordField` → `wordFromField`
- `keys.test.ts` still passes (no namespaced literal is introduced outside the registry)

#### Manual Verification

- Reading `normalize.ts`'s docstring cold leaves no doubt that there are three folds and why the new
  one is not in that file

**Implementation Note**: After the automated checks pass, **break each guard and watch its named test
fail, then restore** — `lessons.md`'s "Break the guard and watch the named test fail" entry, as a
routine step in this edit and not a flourish. Specifically: remove the single-token refusal, the
diacritic preservation, and the prefix-strip in `wordFromField`, and confirm the three tests that name
those behaviours each fail. Then pause for manual confirmation before Phase 2.

---

## Phase 2: The write path

### Overview

An attendee's word becomes a stored answer and an incremented counter, indivisibly, through the script
that already makes the first answer final.

### Changes Required

#### 1. The record grows one field

**File**: `src/lib/session/answers.ts`

**Intent**: Carry the folded word on the answer record so `submitAnswer` can derive the counter field
from the record alone — the contract that module's docstring rests on — and so a later reader can
reproduce the cloud from the answers hash without re-folding through a function that may have changed
since.

**Contract**: `word: z.string().max(MAX_WORD_LENGTH).nullable().default(null)`, the third per-kind
field beside `text` and `value` and carrying the same three notes: `null` for every other kind, the
`.max()` as the backstop behind the route's visible refusal, and the `.default(null)` as the
load-bearing part — a session running when this ships holds records written before the field existed,
and `readOwnResult` parses what it reads, so a required field would report `answered: false` to a
device that watched its answer land.

State the division explicitly, because two fields holding one word looks redundant: **`text` holds
what the attendee typed, `word` holds what the counter was keyed by.** `text` is what a stage dispute
and the reveal echo read; `word` is the grouping key. They differ by the fold.

#### 2. One more counter in the submission script

**File**: `src/lib/session/store.ts`

**Intent**: Append the word counter to `SUBMIT_ANSWER`'s existing variadic tail, so the increment sits
below the `HSETNX` and inherits its atomicity — a duplicate submission is rejected before it can
double-count a word.

**Contract**: `submitAnswer` derives the extra `ARGV` entry from `record.word` (absent when `null`).
The Lua itself needs **no change** — the loop from `ARGV[8]` is already generic. Update the docstring's
command accounting: a word-cloud submission bills **10** for the `EVAL` (`GET`, `HEXISTS`, `HSETNX`,
`HINCRBY` score, `HINCRBY` answered, `HINCRBY` word, 3× `EXPIRE`), identical to a single-choice
answer, so the room-scale figure the docstring warns about is unchanged.

#### 3. The answer route takes the last seam

**File**: `src/pages/api/quiz/answer.ts`

**Intent**: Replace the word-cloud refusal with the branch that accepts one word.

**Contract**: Parse `form.get("word")` **explicitly, never coerced** — `lessons.md` rule 2, the
discipline the `text`, `number` and `elapsedMs` blocks above it already follow: an absent field, a
non-string, and a whitespace-only string are all refusals, not empty-but-valid answers. Run
`validateWord` before the store is touched (the reason `join.ts` validates before claiming: this
endpoint is open, takes `formData`, and `curl` ignores an input's `maxlength`), returning its Polish
message with **400** — not 409, because nothing was written and the client must keep the field
(`client/answer.ts`'s `invalid` vs `rejected` split, which S-06 made reachable).

Set `text` to the validated raw word and `word` to its fold. `correct: false, awarded: 0` written
directly, with a comment naming why no scorer is called: the build gate guarantees `points === null`
for this kind, so there is nothing to score, and a fabricated `correct: true` would be a lie the
reveal copy would then have to work around (`scoreChoiceAnswer`'s stated rule for an unscored
question). `elapsedMs` is still clamped and stored — the record's shape requires it and it costs
nothing — but it weights nothing.

Update the module docstring: the "seam S-08 still extends" paragraph is now history, and the per-call
command figure needs the word case named.

#### 4. Registry descriptions that are no longer true

**File**: `src/lib/session/keys.ts`

**Intent**: Two `holds` strings now describe their keys incorrectly. A future reader deciding whether
a key is safe to purge reads these, so a stale one is worse than a missing one.

**Contract**:

- `TALLIES_KEY` — add the `word:<questionId>:<foldedWord>` family, and **correct the "NOT attendee
  data — the first registered key that is not" claim in place** rather than deleting it, the way
  `state.ts:97` corrects `playerCount`'s note: the hash now holds attendee-*authored* text.
  Aggregated, keyed by no player id and no name, so it still identifies nobody — but it is no longer
  only counters, and the sentence a reader checks the retention guardrail against should meet the
  reversal where the old claim was made. Note also that this is the one family whose field count grows
  with the room rather than with the quiz.
- `ANSWERS_KEY` — the record field list is already stale (missing `text` and `value` from S-05/S-06);
  bring it current and add `word`.

### Success Criteria

#### Automated Verification

- `bun run test` passes; `bun run type-check` reports 0 errors
- `src/pages/api/quiz/answer.test.ts`: the existing "refuses a word-cloud question" test is
  **replaced** by acceptance coverage — accepted with `{ accepted: true }`; the record carries the raw
  word in `text` and the folded word in `word`; `awarded` is 0 and `correct` is false; the `EVAL`
  `ARGV` carries exactly one `word:` field and no `opt:` field; two attendees whose words differ only
  in case increment **one** field; a second submission from the same player is refused
  `already-answered`
- Refusals, each asserting the **outcome** and not merely the rejection (`lessons.md` rule 2): absent
  `word` field, empty string, whitespace-only, two tokens, over 24 characters, and a disallowed
  character each return 400 with the Polish message — and none of them reaches `submitAnswer`
- `store.test.ts`: `submitAnswer` appends the word counter for a record carrying `word`, and appends
  nothing extra for one carrying `null`
- `answers.test.ts`: a record written before the field existed still parses, with `word` defaulting to
  `null`

#### Manual Verification

- A word submitted from a phone against a real session appears in the Upstash console as a
  `word:smieszne-slowo-ai:<word>` field with value 1, and a second tap from the same device does not
  raise it to 2

**Implementation Note**: Break-the-guard pass again, and the one that matters most here is the
**increment's position below the `HSETNX`**: move it above, confirm the duplicate test fails, restore.
Then pause for manual confirmation before Phase 3.

---

## Phase 3: The read and the host route

### Overview

One read that turns the counter family into an ordered, bounded cloud, and one host-gated route that
serves it and writes nothing.

### Changes Required

#### 1. The store read

**File**: `src/lib/session/store.ts`

**Intent**: Read the whole tallies hash once, project the word family for one question into a bounded
ordered list, and report the `answered` count that the same reply already contains.

**Contract**: `readWordCloud(questionId: string): Promise<WordCloud | null>` where `WordCloud` is
`{ answered: number; distinct: number; words: readonly { word: string; count: number }[] }`.

- One billed command: `HGETALL` over `TALLIES_KEY`. The reply carries `answered:<questionId>` already,
  so the numerator costs nothing extra — stated at the function, because adding a second read for it
  is the obvious change that would make the cost note wrong.
- Fields are selected through `wordFromField`, never by a local prefix test, for the reason that
  function exists.
- **Ordered by `count` desc, then `word` asc — a total order, and it is load-bearing here in a way it
  is not for a full list.** The truncation below means ordering decides *what is shown at all*, so a
  partial order would let two consecutive reads drop different words with nothing to explain why. Same
  reasoning as `buildStandings`, different consequence.
- Sliced to `WORD_CLOUD_SIZE`; `distinct` reports the pre-slice count so the panel can say how many
  were dropped rather than silently claiming completeness.
- **`null` only on a throw.** An absent hash is an empty cloud, not a failure — the key is simply not
  written until the first submission — exactly as `readQuestionTallies` documents. A failed read must
  never surface as an empty cloud: on a projector that is the claim "nobody wrote anything", at the
  one moment it is most damaging.

#### 2. The host route

**File**: `src/pages/api/quiz/host/words.ts` (new)

**Intent**: Serve the cloud to the projector, gated by the host secret, writing nothing.

**Contract**: `export const GET: APIRoute`, replying
`{ questionId, answered, playerCount, words, distinct }` with `Cache-Control: no-store` on every
branch. Built from `participation.ts` and keeping every one of its decisions, each of which has a
stated reason there:

- Secret via `extractSecret`/`authorizeHost`, refusal status from `unauthorized()` rather than a
  retyped 401. Gated because an endpoint built to be polled is the cheapest way to run up commands,
  and because — unlike `/api/quiz/state` — this is not something already broadcast.
- `questionId` from the query string, parsed explicitly; absent, empty or unknown is a **400**, never
  a fallback to whatever the session has open and never a zeroed cloud (`lessons.md` rule 2).
- **A question whose kind is not `word-cloud` is refused**, rather than answered with an empty cloud.
  There is no cloud for a choice question, and inventing an empty one would let a client render a
  panel for a question that has none.
- `Promise.all([readWordCloud(questionId), readPlayerCount()])` — two billed commands, and
  deliberately **not** folded into one `EVAL`, for the reason `participation.ts:100` gives: Upstash
  bills the script *and* every call inside it, so a script would make two commands three on the one
  path this slice polls.
- `null` from either read: the cloud read failing is a **503** with a Polish message so the page takes
  its staleness path and keeps the words it has; a `null` player count is passed through as `null`, as
  participation does, so the page keeps the join figure it already holds.

**Writes nothing**, and this is asserted rather than commented — see the test below. The reason is the
one `participation.ts:20` states: during `question-open` the session document's `updatedAt` bounds the
speed clamp, so a host-side write here would inflate every award after it, with nothing on any screen
to report that scoring had changed.

### Success Criteria

#### Automated Verification

- `bun run test` passes; `bun run type-check` reports 0 errors
- `src/pages/api/quiz/host/words.test.ts` mirrors `participation.test.ts`, including the **source
  scan**: the file references none of `writeSession`, `endSession`, `applyHostAction`,
  `createSession`, and the "still has code left to scan after comments are stripped" guard that stops
  an over-matching stripper turning both assertions green vacuously
- Refuses without the secret (401 from `unauthorized()`); refuses an absent, empty and unknown
  `questionId` (400); refuses a choice question's id (400)
- Echoes `questionId` back; every response carries `Cache-Control: no-store`
- Ordering: two words with equal counts come back alphabetically, and the fixture is deliberately
  **not** pre-sorted, so a route that returned the hash's order fails
- Truncation: 35 distinct words return 30 rows with `distinct: 35`
- A throwing store read is a 503, and an absent tallies hash is a 200 with an empty `words` array and
  `answered: 0` — the two must not collapse

#### Manual Verification

- `curl` with the host header against a live session returns the cloud; without it, 401
- The session document's `updatedAt` and `version` are unchanged after a minute of polling

**Implementation Note**: Break-the-guard pass on the kind refusal and on the `null`-vs-empty split.
Then pause for manual confirmation before Phase 4.

---

## Phase 4: The projector

### Overview

The cloud on the host's screen, and one poll loop that serves two panels.

### Changes Required

#### 1. The renderer

**File**: `src/lib/client/render.ts`

**Intent**: Draw the words as size-scaled chips, in the order given.

**Contract**: `renderWordCloud(container, words, options)` taking
`readonly { word: string; count: number }[] | undefined` and a class-name bag, matching the options-bag
shape `renderQuestion` and `renderDistribution` use (not positional parameters — that module already
records why).

- `createElement` + `textContent`, **never `innerHTML`.** This is the call site the module's docstring
  was written for: attendee-typed text going onto a projector. The PRD accepts unmoderated *content*
  and accepts nothing about unmoderated markup.
- **Paints the order given and never sorts** — `renderStandings`' rule, and its test fixture must
  deliberately *not* be in count order, because a sorted fixture makes a sorting renderer pass
  (`lessons.md`, and the S-07 test that could not fail).
- Type size scales linearly between a floor and a ceiling by `count` relative to the largest count
  present. When every count is equal the whole cloud takes the **ceiling**, not the floor: one word
  typed once on an otherwise empty screen is the first thing the room sees, and the floor would make
  the opening beat look broken.
- `data-word` on each chip, so the DOM carries what was rendered independently of the stylesheet —
  `renderDistribution`'s `data-correct` rule, for the same venue-network reason.
- An empty list draws a Polish sentence, not an empty frame — the choice `renderDistribution` and
  `renderStandings` both make.
- A companion `wordCloudCountText(shown, distinct)` for the "N z M słów" line, in this module and
  unit-tested for the same reason `standingsPositionText` is: it has a branch (nothing was dropped)
  and a page has no harness to reach it from.

#### 2. The panel

**File**: `src/pages/quiz/host.astro`

**Intent**: A section for the cloud below the prompt, and one poll loop whose endpoint is chosen by
the question's kind.

**Contract**:

- Markup: `#word-cloud` section holding the count line and a `#word-cloud-words` container, hidden by
  the `hidden` attribute (needs no CSS — `setHidden`'s reason). Below the prompt, deliberately, for
  the reason the participation panel is: a panel above it pushes the question down the projector.
- **One loop, not two.** Replace `participationApplies` with a single `pollTargetFor(state)` returning
  the URL and the panel kind, or `null`. The "ONE predicate governs both the panel and the poll"
  property (`host.astro:477`) is preserved and is the reason for the shape: two conditions would let
  the poll run for a question whose panel is not rendered. The existing timer, backoff, in-flight
  flag, 401 handling, `visibilitychange`, `pagehide` and `pageshow` behaviour are all reused
  unchanged — `host.astro:379` records that a second timer is the failure this file guards hardest
  against.
- The word-cloud target applies in **`question-open` and `question-revealed`**; the participation
  target keeps its current `question-open`-only rule.
- **The final read is idempotent.** A per-question "final read landed" flag stops the loop re-arming
  in `question-revealed`, where no submission can arrive and every further tick is guaranteed to
  return the same thing.
- Panel state (`words`, `distinct`, `answered`, staleness) resets when `panelQuestionId` changes,
  before anything renders — the rule `renderParticipation` already applies, and for the same reason: a
  first paint under a new prompt carrying the previous question's numbers is plausible and wrong.
- A reply whose `questionId` does not match the live snapshot is discarded, not painted.
- A failed read keeps the last cloud and shows the existing staleness marker; it never empties the
  cloud, for the reason `pollFailed` documents.

### Success Criteria

#### Automated Verification

- `bun run test` passes; `bun run type-check` reports 0 errors
- `render.test.ts`: paints the order given with a fixture **not** in count order; a word containing
  `<b>` renders as text and creates no element; the largest count gets the ceiling size and the
  smallest the floor; an all-equal cloud takes the ceiling; an empty list draws the sentence;
  `data-word` is present; `wordCloudCountText` covers both branches
- `boundary.test.ts` passes — the new `<script>` code value-imports nothing from `src/quiz/` or
  `src/lib/session/` and reads no `import.meta.env`

#### Manual Verification

- With a word-cloud question open, the cloud fills within ~2.5 s of each submission from a second
  device, and the count line moves with it
- Revealing freezes the cloud with the final count, and the network panel shows the poll stopping
- Advancing to the next question clears the cloud and shows the participation panel instead
- Backgrounding the tab stops the poll; returning resumes it
- Removing the host secret shows the existing "wpisz sekret" message rather than a staleness marker

**Implementation Note**: The loop's tests are the shape `lessons.md`'s timer entry is about — pin the
interval source so one advance is exactly one tick, and hold the fetch open with a manually resolved
deferred for any test naming an overlap. Pause for manual confirmation before Phase 5.

---

## Phase 5: The phone

### Overview

A field, a submit gate, a lock, and an echo at the reveal.

### Changes Required

#### 1. The client payload arm

**File**: `src/lib/client/answer.ts`

**Intent**: Carry the word to the route.

**Contract**: `AnswerPayload` gains `{ kind: "word"; word: string }`, and `submitAnswer` sets
`body.set("word", payload.word)`. Sent **raw**, as the text arm is: the server trims, bounds, folds
and refuses, so there is one implementation of each rule. The existing `SeenEntry.text` carries it for
the reload case, unchanged — it already holds "a string the attendee typed into a field that has to
look the same after a reload", which is exactly this.

#### 2. The field and the branches

**File**: `src/pages/quiz/index.astro`

**Intent**: Let the attendee type one word, lock it once accepted, and echo it at the reveal.

**Contract**:

- `MAX_WORD_LENGTH` imported in **frontmatter** and written into a new static `#answer-word` input's
  `maxlength` — the plumbing `MAX_TEXT_ANSWER_LENGTH` already uses, because the `<script>` block may
  not value-import from `src/lib/session/`. A third static sibling of the two existing fields, never
  inside the question container.
- `word-cloud` joins the `answerable` set; `hideAnswerControls` gains the new field; the `ended`
  cleanup clears its value and `dataset.questionId` alongside the other two.
- `renderOpenWord(question)`: prompt-only render, `markSeen`, the `dataset.questionId` reconciliation
  rule, `submittedText` → `typed` → empty for the restored value, disabled-not-hidden once locked so
  the attendee still sees what they sent. Note copy points at the projector rather than mentioning
  points — this is the beat FR-015 exists for, and "bez punktów" frames it as something missed.
- Submit gate: non-empty after trim **and** no internal whitespace. A loose test, not a parse — the
  server is the judge, the same posture `hasTypedGuess` documents. An over-permissive gate costs a
  refusal the attendee can read; an over-strict one silently blocks a legitimate word.
- `sendAnswer` gains the arm and includes the word in `sentText`, so a reload restores the locked
  field.
- The reveal: **branch on kind before `correct` or `scored`** — the ordering S-06 established, and the
  reason is the same class of conflation. Echo the attendee's own word from storage and point at the
  cloud; **issue no result fetch**, since an unscored question has no award to ask for and this keeps
  the fan-in gate intact. `answer-accepted` stays hidden, which the schema already guarantees:
  `revealedAnswerText` is `null` for this kind.

### Success Criteria

#### Automated Verification

- `bun run test` passes; `bun run type-check` reports 0 errors
- `client/answer.test.ts`: the word arm sends a `word` field and no `text`/`optionIds`; a 400 comes
  back as `invalid` (the field is kept), a 409 as `rejected` (the field is locked)
- `boundary.test.ts` passes for the new script code
- `render.test.ts` covers the reveal-echo copy helper's absent-word branch

#### Manual Verification

- Two phones submit different words; both see their own word echoed and neither sees a score line
- A phone submitting an empty field cannot tap send; one submitting two words sees the Polish refusal
  and keeps its text
- Reloading mid-question keeps the paint clock and, once submitted, restores the word in a disabled
  field
- At the reveal the phone shows its own word and no verdict; at the next question the field is clear
- A word typed with Polish diacritics appears on the projector spelled correctly

**Implementation Note**: Pause for manual confirmation of the full two-device run before Phase 6.

---

## Phase 6: Contract and documents

### Overview

The slice's decisions written where the next slice will look for them, and every document this change
falsifies corrected in the same change.

### Changes Required

#### 1. The contract

**File**: `context/changes/word-cloud-question/word-cloud-contract.md` (new)

**Intent**: The fifth contract after `spine-`, `retention-`, `join-` and `leaderboard-contract.md`,
inheriting their warning: a pointer, not a second copy of the plan. **One page.**

**Contract**: The cloud does not ride the snapshot, and why (the 100 msg/s ceiling and the absence of
a host action to attach it to) · the third fold, why diacritics survive, and the accepted cost ·
the tallies hash is no longer counters-only, and what that does and does not mean for retention · the
top-30 bound and that `distinct` reports what was dropped · the two numbers and where each comes from
· cost per beat, honestly, against an unexplained baseline · scope boundary: no moderation, no
phone-side cloud, no snapshot field, no new store key, no rehearsal re-run.

#### 2. CLAUDE.md

**Intent**: The generated block is untouched; the project guide gains what a future agent would
otherwise get wrong.

**Contract**: The folds table becomes three rows · the tallies field families become three, with the
unbounded one named · the word bound and its three readers · the polling story: two loops, three
endpoints, and the runbook's tripwire wording · a line stating that the word cloud's aggregate reaches
the room by a host-side poll and must not be moved onto the snapshot.

#### 3. Roadmap, PRD, infrastructure, runbook, harness

**Intent**: Close the slice and correct what it falsifies.

**Contract**:

- `roadmap.md` — S-08 status `proposed` → `done` with the delivery date and a one-paragraph outcome
  note in the delivery table, per the S-05/S-06/S-07 entries. Also fix the **two stale pointers** to
  `context/changes/leaderboard-beat/leaderboard-contract.md` (lines 141 and 528): that change is
  archived and the file now lives under `context/archive/2026-08-11-leaderboard-beat/`.
- `prd.md` — the success criterion "The word-cloud question's aggregate visibly updates as answers
  arrive" is now delivered; note it where the other delivered criteria are noted. Re-check the
  retention guardrail's wording against this change and record that it is unaffected: the cloud
  carries words, never names, and never enters a published snapshot.
- `infrastructure.md` — a row for the cloud poll's cost and its bound (one device, one question kind,
  ~2.5 s), consistent with the participation row.
- `docs/runbook-live-session.md` — the word-cloud beat in the run order, and the unmoderated-projector
  note so the host knows what they are accepting before they are on stage with it.
- `scripts/rehearse-room.ts:1500` — the comment claiming the word cloud "cannot be answered by this
  slice" is now false. Correct it and state that a room-scale word burst was deliberately not added,
  with the pointer to the contract's scope boundary.

### Success Criteria

#### Automated Verification

- `bun run test` passes; `bun run type-check` reports 0 errors; `bun run build` succeeds (the quiz
  definition gate runs at config load)
- No document still asserts "there are two folds", "the tallies hash holds no attendee-authored
  content", or points at `context/changes/leaderboard-beat/`

#### Manual Verification

- The contract reads as a pointer and fits on one page
- A reader who knows only `leaderboard-contract.md` can pick up this slice's decisions from the new
  contract without opening the plan

---

## Testing Strategy

### Unit Tests

- `words.test.ts` — the fold's three rules and the four refusals, including the diacritic case that
  distinguishes this fold from `normalizeAnswer`
- `tallies.test.ts` — three-family collision matrix; a word containing a colon round-trips
- `normalize.test.ts` — the existing name-claim tripwire unchanged, plus the new fold-divergence one
- `answers.test.ts` — the `word` field's default for a record written before it shipped
- `store.test.ts` — the extra counter in `submitAnswer`'s `ARGV`; `readWordCloud`'s ordering,
  truncation, and its `null`-vs-empty split
- `render.test.ts` — `renderWordCloud`'s order preservation, escaping, size scale, empty state; the
  two copy helpers' branches

### Integration Tests

- `answer.test.ts` — the full word branch: acceptance, the record's two forms of the word, the single
  counter, case merging across two players, the duplicate refusal, and six refusals each asserted by
  outcome
- `words.test.ts` (route) — auth, the four `questionId` refusals, ordering, truncation, the
  `null`-vs-empty split, `no-store`, and the writes-nothing source scan

### Manual Testing Steps

1. Start a session on `/quiz/host`, join from two phones, advance to Q1.
2. Submit a different word from each phone; watch both appear on the projector within ~2.5 s and the
   count line move.
3. Submit the same word from both, differing only in case, and confirm one chip at double size.
4. Submit an empty field, two words, and 30 characters; confirm each is refused with a readable
   message and the field keeps its text.
5. Reload one phone mid-question, then after submitting; confirm the clock and the locked field.
6. Reveal; confirm the cloud freezes with the final count and each phone echoes its own word with no
   verdict.
7. Advance; confirm the cloud clears and the participation panel takes over.
8. Background the host tab for a minute; confirm the poll stops and resumes, and that the session
   document's `version` never moved.

## Performance Considerations

Per submission: **11** billed commands, identical to a single-choice answer — the word counter takes
the place of the option counters. Per cloud beat: **2** per tick on one device at ~2.5 s, ~48 for a
minute-long question. A four-beat segment's word cloud is under 100 commands.

The `HGETALL` payload grows with distinct words rather than with the quiz: ~200 fields at 150 words,
which is small. The top-30 slice is a *display* bound, not a cost one, and `distinct` is what keeps it
honest.

None of it touches the Ably message budget, which is the point of the whole design.

## Migration Notes

No key is added, so `end`, `purge` and `check-purge-residue.ts` are unchanged. The one in-flight
concern is a **deploy during a live session**: `answerRecordSchema` gains a field, so `word` carries
`.default(null)` for the reason its two siblings do — a record written before the deploy must still
parse, or `readOwnResult` reports `answered: false` to a device that watched its answer land. No
`SessionState` field is added, so no document can fail to parse and no host action can 409 mid-segment.

## References

- Roadmap slice: `context/foundation/roadmap.md:463`
- Requirements: `context/foundation/prd.md:292` (FR-012), `:313` (FR-015), `:257` (FR-005's scope note)
- Prior contracts: `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`,
  `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`,
  `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
- The template this slice copies: `src/pages/api/quiz/host/participation.ts`,
  `src/pages/api/quiz/host/participation.test.ts`, and `host.astro:347`'s poll loop
- Recurring rules: `context/foundation/lessons.md` (rules 1, 2, 3, and the two test-integrity entries)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The word rule

#### Automated

- [x] 1.1 `bun run test` passes — ab05c1d
- [x] 1.2 `bun run type-check` reports 0 errors — ab05c1d
- [x] 1.3 `words.test.ts` covers the fold's rules and every refusal — ab05c1d
- [x] 1.4 `normalize.test.ts` asserts `foldWord` and `normalizeAnswer` disagree on a diacritic — ab05c1d
- [x] 1.5 `normalize.test.ts`'s existing name-claim tripwire still passes, unmodified — ab05c1d
- [x] 1.6 `tallies.test.ts` covers three families and a colon-bearing word round-trip — ab05c1d
- [x] 1.7 `keys.test.ts` still passes — ab05c1d

#### Manual

- [x] 1.8 `normalize.ts`'s docstring leaves no doubt there are three folds and why one is elsewhere — ab05c1d
- [x] 1.9 Break-the-guard pass: single-token refusal, diacritic preservation, prefix strip — ab05c1d

### Phase 2: The write path

#### Automated

- [x] 2.1 `bun run test` passes — bbfbf53
- [x] 2.2 `bun run type-check` reports 0 errors — bbfbf53
- [x] 2.3 `answer.test.ts` acceptance coverage replaces the refusal test — bbfbf53
- [x] 2.4 Six refusals asserted by outcome, none reaching `submitAnswer` — bbfbf53
- [x] 2.5 `store.test.ts` covers the extra counter and its absence — bbfbf53
- [x] 2.6 `answers.test.ts` covers the `word` default for a pre-deploy record — bbfbf53

#### Manual

- [ ] 2.7 A submitted word appears once in the Upstash console and a double tap does not raise it
- [x] 2.8 Break-the-guard pass: the increment's position below the `HSETNX` — bbfbf53

### Phase 3: The read and the host route

#### Automated

- [x] 3.1 `bun run test` passes
- [x] 3.2 `bun run type-check` reports 0 errors
- [x] 3.3 `words.test.ts` (route) mirrors participation, including the writes-nothing source scan
- [x] 3.4 Auth and the four `questionId` refusals covered
- [x] 3.5 Ordering covered with a fixture not pre-sorted
- [x] 3.6 Truncation reports `distinct` above the bound
- [x] 3.7 The `null`-vs-empty split covered on both sides

#### Manual

- [ ] 3.8 `curl` with and without the host header behaves as specified
- [ ] 3.9 A minute of polling leaves `updatedAt` and `version` untouched
- [x] 3.10 Break-the-guard pass: the kind refusal and the `null`-vs-empty split

### Phase 4: The projector

#### Automated

- [ ] 4.1 `bun run test` passes
- [ ] 4.2 `bun run type-check` reports 0 errors
- [ ] 4.3 `render.test.ts` covers order, escaping, size scale, empty state, `data-word`, copy helper
- [ ] 4.4 `boundary.test.ts` passes for the new script code

#### Manual

- [ ] 4.5 The cloud fills within ~2.5 s of a submission and the count line moves
- [ ] 4.6 Revealing freezes the cloud and stops the poll
- [ ] 4.7 Advancing clears the cloud and restores the participation panel
- [ ] 4.8 Tab backgrounding stops and resumes the poll
- [ ] 4.9 A missing host secret shows the secret message, not a staleness marker

### Phase 5: The phone

#### Automated

- [ ] 5.1 `bun run test` passes
- [ ] 5.2 `bun run type-check` reports 0 errors
- [ ] 5.3 `client/answer.test.ts` covers the word arm and the 400-vs-409 split
- [ ] 5.4 `boundary.test.ts` passes
- [ ] 5.5 `render.test.ts` covers the reveal-echo helper's absent-word branch

#### Manual

- [ ] 5.6 Two phones submit and each sees its own word echoed with no score line
- [ ] 5.7 Empty, two-word and over-length submissions behave as specified
- [ ] 5.8 Reload keeps the clock and restores the locked word
- [ ] 5.9 The reveal shows the word and no verdict; the next question clears the field
- [ ] 5.10 A diacritic-bearing word reaches the projector spelled correctly

### Phase 6: Contract and documents

#### Automated

- [ ] 6.1 `bun run test` passes
- [ ] 6.2 `bun run type-check` reports 0 errors
- [ ] 6.3 `bun run build` succeeds
- [ ] 6.4 No document asserts the two falsified claims or points at `context/changes/leaderboard-beat/`

#### Manual

- [ ] 6.5 The contract is a one-page pointer
- [ ] 6.6 A reader coming from `leaderboard-contract.md` can pick up this slice's decisions from it
