# Attendee answers a choice question and learns their result — Implementation Plan

## Overview

Roadmap **S-03**, the north star. An attendee taps an answer to a single- or multiple-choice question
on their phone; the server records and scores it in one atomic write; when the host reveals, the
phone shows whether it was right, how many points it earned, and the running total.

This slice carries the project's **first domain rule** — all-or-nothing choice correctness weighted by
a speed component measured on the attendee's own device (FR-010, FR-019). S-05, S-06 and S-08 are
meant to add a *mechanic* to that rule rather than a second scoring model, so the seam matters as much
as the behaviour.

## Current State Analysis

The spine, the join and the retention machinery all exist and are exercised at room scale. What does
not exist is anything that reads an attendee's input.

**What is already true:**

- `SessionState` (`src/lib/session/state.ts:50`) holds `version`, `phase`, `currentQuestionId`,
  `startedAt`, `updatedAt`, `playerCount`. Every host action publishes the whole document to Ably.
- Two attendee-data keys exist and are registered: `livequiz:players` (folded name → record) and
  `livequiz:player-ids` (opaque id → folded name) — `src/lib/session/keys.ts:61`.
- `src/lib/client/session.ts` implements the spine's client rule once: prime from `/api/quiz/state`,
  subscribe, apply the higher `version`. Both views use it; nothing reimplements it.
- `src/lib/client/render.ts:67` renders a question's options as **static `<li>` elements** with
  `data-optionId` already set — a hook left deliberately for this slice.
- `publicQuiz` (`src/quiz/public.ts:153`) shuffles each question's options deterministically and
  strips `correctOptionIds`, `acceptedAnswers`, `correctValue` and `points`.
- The store's only sanctioned mutation shapes are single `EVAL` scripts; `store.test.ts` asserts the
  version guard and the name claim each stay one call.

**What is missing:** an answers store, a scoring rule, a submission path, a per-device result path,
and controls on the attendee view.

**The constraints discovered while researching, which shape the design more than the requirements do:**

- **Every `livequiz:`-prefixed name must be a literal in `keys.ts`** (`keys.test.ts` scans for
  escapes). A per-question key name assembled at runtime is reached by neither `end` nor `purge`.
- **`LogFields` is a closed type** (`src/lib/session/log.ts`) and CLAUDE.md forbids passing a display
  name *or an answer* to `logSessionEvent`.
- **Nothing per-player may enter a published snapshot** — Ably retains snapshots ~120s irreducibly and
  `/api/quiz/token` is open (`join-contract.md:68`).
- **Upstash bills the `EVAL` and every `redis.call` inside it** (`command-counter-diagnostic.md:96`).
  This is the first path that runs once per attendee per question.

## Desired End State

A host runs the drafted 14-question quiz. On each choice question, up to 150 phones show tappable
options, a submit control, and a confirmation that locks the choice. On reveal, every phone shows the
correct answer highlighted, whether that attendee was right, the points that answer earned, and their
running total. The store holds one answer per player per question and one running total per player,
both purgeable. Nothing about who answered what leaves the store except to the device that owns it.

**How to verify:** the two-device run in Phase 4 and the 150-client submission burst in Phase 5. The
end state is not "the tests pass" — S-02's lesson was that a green suite and a clean type-check both
missed the failure that only a live run surfaced.

### Key Discoveries:

- `src/lib/client/render.ts:88` — `item.dataset.optionId` exists specifically so this slice can find
  its own options without re-deriving the shuffled order.
- `src/quiz/public.ts:98` — the raw definition's option order is **not** what the room saw. Anything
  that maps a selection back to a question must go through option ids, never indices.
- `src/lib/session/host.ts:207` — `applyHostAction` is the one injection point for per-action derived
  fields, and its comment explains why the three state constructors copy rather than compute. The
  revealed answer ids follow the *opposite* rule and must not be injected there — see Phase 3.
- `src/lib/session/store.ts:227` — `CLAIM_PLAYER` is the shape the submission script copies: phase
  check inside the script, both TTLs armed inside the script, the session document returned rather
  than re-read.
- `src/lib/session/store.ts:664` — `LookupResult` keeps `not-found` and `failed` distinguishable
  because conflating them locked attendees out. The result endpoint has the same trap.
- `src/quiz/definition.ts:17` — every scored question is worth `POINTS = 1000`, so a fractional speed
  weight produces integers in the 500–1000 range with no rounding awkwardness.

## What We're NOT Doing

- **Text, number and word-cloud answers.** S-05, S-06 and S-08. The submission route and store script
  are kind-agnostic; the scorer has two entries and refuses the rest.
- **The leaderboard.** S-07. This slice maintains the running total each device shows itself; ranking
  150 totals onto a large screen and 150 phones is a separate decision about names on the wire.
- **The host's participation count and answer distribution.** S-04. The host view is untouched by this
  slice apart from nothing — no new controls, no new payload.
- **Per-device join cap (FR-018) and score-intact resume across reconnects (FR-009's full form).** S-09.
- **Correcting a question mid-session.** FR-001's accepted operational risk stands: a wrong answer key
  is a code change and a deploy.
- **Throttling `/api/quiz/answer`.** Rejected for the same reason `/api/quiz/join` is unthrottled: a
  venue network puts many attendees behind one address.

## Implementation Approach

Three ideas carry the design.

**One atomic submission.** A single `EVAL` checks the phase and the open question, refuses a second
answer for that player, writes the scored record, and increments the running total. Scoring happens
before the script runs — the route computes correctness and the award from the definition and hands
the script a finished record — so the Lua stays short, which now has a price attached to it.

**Correctness travels in the snapshot; points travel per device.** The revealed correct option ids are
quiz content, not attendee data, so they can ride the broadcast the room already receives. The award
and the running total cannot — they are per-player — so each device fetches its own. Splitting it this
way means a phone whose fetch fails still sees the right answer highlighted, which is the thing FR-016
exists for.

**The clock is the attendee's, and it is written down.** FR-019 measures speed from when the question
became visible on that device. The roadmap names measuring from the host's advance as this slice's
trap. The subtler trap is that a reload repaints the question and would reset the clock — so the
first-paint timestamp is persisted per question on the device, and the server clamps what it is told.

## Critical Implementation Details

**The cost arithmetic, which is a plan-level finding rather than a detail.** Priced with the S-02
attribution method (`command-counter-diagnostic.md`), where an `EVAL` bills 1 plus every internal
`redis.call`:

| Path | Per call | Per event (150 attendees, 14 questions) |
| --- | --- | --- |
| Route's `readSession` before scoring (see below) | 1 | 2100 × 1 = **2,100** |
| Submission `EVAL` (`GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE`) | 7 | 2100 × 7 = **14,700** |
| Result `EVAL` (`GET`, 2× `HGET`) | 4 | 2100 × 4 = **8,400** |
| Joins, host actions, device connects (S-02 measured) | — | ~1,600 |
| | | **~26,800** |

S-02's measured figure was ~500–600 per event, so this is roughly a **40× rise**. Two consequences,
and they are different from each other:

- **Budget.** Ten events a month reaches ~270k against the documented **500K/month plan ceiling**
  (`docs/runbook-live-session.md:70`) — about **54%**, up from ~1%. Nobody has had that conversation;
  it is not a blocker, but it is no longer noise.
- **The tripwire's margin, not the tripwire itself.** The runbook's threshold is **per run** — "Above
  ~200K attributable to a single run, stop and look" (`runbook:72`) — so a real event at ~27k does
  **not** approach it. What changes is the margin the runbook quotes as its justification: it "sits
  roughly 125× above a real session", and after this slice it sits roughly **7×**. It still works as a
  polling detector; it is simply much less headroom than the sentence claims.

**Phase 2 states the prediction, Phase 5 measures it, and Phase 5 records both figures in the
runbook.** Phase 5 must **not** move the threshold — the runbook says in the same breath "Do not raise
it as usage grows: raising it is how it stops working", and this slice gives no reason to.

*(Corrected during plan review: an earlier draft of this section compared the monthly projection
against the per-run threshold and concluded it would be crossed. It is not. The arithmetic above is
unchanged; the conclusion drawn from it was wrong.)*

**The reload-resets-the-clock hole.** `performance.now()` captured at paint is reset by a reload, and a
reload during a 15-minute segment is near-certain (`state.ts` route docstring). Left alone, reloading
mid-question hands full speed weight to anyone who does it, deliberately or not. The first-paint
timestamp is therefore persisted per question in `localStorage` beside the player record, and read
back before it is written. The residual — a device that clears storage, or an attendee who joins after
a question opened — is accepted and recorded: FR-019 says the clock is the device's, and a latecomer
genuinely did just see the question.

**The result endpoint must gate on phase.** It returns a correctness verdict. Served while the
question is still open, it is a cheat sheet that any attendee can curl. It must refuse anything but
`question-revealed` for the question being asked about, and that check reads the session document
rather than trusting a parameter.

**`revealedOptionIds` must not be injected in `applyHostAction`.** That function is where
`playerCount` is overwritten on every action because a *stale* count is acceptable. The revealed ids
are the opposite: they are part of the phase transition itself and must be set by `reveal.ts` and
cleared by `advance.ts`, or a stale value survives into the next question and shows the room the
previous answer. The two fields look similar and behave oppositely; state that in the code.

**Both new keys need `EXPIRE` inside the submission script.** `end` re-arms only keys that exist at
end time and `purge` deletes them, but between creation and the first host action a key with no TTL is
a key that outlives the session if the host never ends it. Arm both in the script, as `CLAIM_PLAYER`
does for the two player hashes.

---

## Phase 1: The scoring rule and the answer model

### Overview

Everything pure: what an answer record is, what a correct answer is, and what a timely one is worth.
No store access, no env read, no route. This is where S-05 and S-06 will later add a scorer, so the
seam is defined here and nowhere else.

### Changes Required:

#### 1. The scoring module

**File**: `src/lib/session/scoring.ts` (new)

**Intent**: Hold the project's first domain rule in one testable place. Correctness is decided per
question kind; the speed weight is global and applies to every scored answer regardless of kind, so
that S-05/S-06 add a correctness function and inherit the timing rule rather than restating it.

Deliberately **not** in `src/quiz/` — CLAUDE.md records that `points` is the only scoring field the
definition carries and that scoring rules belong to the slices that need them. `src/quiz/` stays a
data contract.

**Contract**: Named exports, no default (project convention).

- `scoreChoiceAnswer(question, selectedOptionIds, elapsedMs, windowMs)` → `{ correct: boolean; awarded: number }`.
  All-or-nothing per FR-010: every id in `correctOptionIds` selected, nothing outside it. An unscored
  question (`points === null`) yields `correct: false, awarded: 0` — it has no correct answer to match
  and the attendee is told so at reveal, so a fabricated `correct: true` would be a lie the reveal copy
  would have to work around.
- `speedWeight(elapsedMs, windowMs)` → number in `[0.5, 1]`:

  ```
  weight = 0.5 + 0.5 * (1 - min(1, max(0, elapsedMs) / windowMs))
  ```

  Exported separately because S-06's relative-error curve multiplies the same weight against a
  partial-credit base, and a second implementation is a second thing to get wrong.
- `SPEED_WINDOW_MS = 20_000` — the decay window. Document why 20s: an unscored answer at 20s is still
  worth half, so knowing beats guessing fast, and the 2× ceiling is what bounds the forged-timing risk
  the plan accepts below.
- `clampElapsed(clientElapsedMs, serverElapsedMs)` → number. Rejects negatives and anything longer than
  the question has been open. Trusts the value otherwise. The docstring must state plainly that a
  device claiming `0` is undetectable and that this is an accepted risk under the PRD's no-accounts
  model, bounded by the 2× ceiling — not a defended one.
- Awards round to the nearest integer. With `POINTS = 1000` this gives 500–1000 and effectively no
  ties, which is what FR-019 was added for.

#### 2. The answer record

**File**: `src/lib/session/answers.ts` (new)

**Intent**: The shape the store holds, its parser, and the field-name convention for the answers hash.
Mirrors `players.ts`: a pure module with a Zod schema and no store access, so the atomicity question
stays entirely in `store.ts`.

**Contract**:

- `answerRecordSchema` → `{ playerId, questionId, optionIds: string[], elapsedMs, correct, awarded, answeredAt }`.
  **No display name.** The players hash already owns the mapping and duplicating it here would put a
  name in a second place the purge has to reach.
- `answerField(questionId, playerId)` → `` `${questionId}:${playerId}` ``. One function, so the read
  path and the write path cannot disagree about the separator. Question ids are lowercase slugs
  (`schema.ts:16`) and player ids are v4 UUIDs, so a colon is unambiguous.
- `parseAnswerRecord(raw)` → `AnswerRecord | null`. Never throws, per `parsePlayerRecord`.

#### 3. Two registry entries

**File**: `src/lib/session/keys.ts`

**Intent**: Register the answers hash and the scores hash so `end` re-arms them and `purge` deletes
them. Register the new `localStorage` name for the same reason `PLAYER_STORAGE_KEY` is registered —
the invariant is "one module owns every namespaced name", and an invariant with an exemption list
rots.

**Contract**: Two additions to `REGISTERED_KEYS`, each with a `holds` string that says **ATTENDEE
DATA** as the player hashes do:

- `livequiz:answers` — hash, field `<questionId>:<playerId>` → answer record JSON.
- `livequiz:scores` — hash, playerId → running total.

Plus `QUESTION_SEEN_STORAGE_KEY = "livequiz:seen"` exported alongside `PLAYER_STORAGE_KEY`, outside
the registry, carrying the same note that no purge reaches a browser and why that is compliant.

#### 4. `scored` on the public projection

**File**: `src/quiz/public.ts`

**Intent**: Let a phone tell an unscored question from a wrong answer. Without this the view cannot
deliver FR-017's warm-up copy at all: `points` is stripped from the projection, `FORBIDDEN_KEYS`
keeps it out, and the result payload's `{ correct: false, awarded: 0 }` is identical for a warm-up
and for a wrong answer — so the drafted Q2, the beat that exists to welcome latecomers, would tell
the whole room it got it wrong.

`public.ts:19` parks exactly this decision here: "`points` is deliberately absent too. It is not an
answer, but what an attendee is told about scoring is S-03's decision." This is that decision, taken
in its narrowest form — a boolean, not the value.

**Contract**: `PublicQuestion` gains `readonly scored: boolean`, set from `question.points !== null`
in `toPublicQuestion`. `FORBIDDEN_KEYS` is unchanged and still forbids `points` — the point value
does not travel, only whether one exists.

Two consequences the implementer should carry forward: the answering screen can now set expectations
before the reveal, and the view can skip the result fetch entirely on an unscored question (Phase 4
§3).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check` (0 errors)
- `scoring.test.ts` covers: exact multi-answer match scores, a superset does not, a subset does not,
  an unscored question awards 0, weight is 1.0 at 0ms, 0.5 at and beyond the window, monotonic in
  between, and a negative or absurd elapsed is clamped rather than trusted
- `public.test.ts` covers: `scored` is `false` for the two `points: null` questions and `true` for the
  rest, and `points` still appears nowhere in the serialized projection
- `keys.test.ts` still passes with the two new entries, and its non-empty-registry assertion holds
- `portability.test.ts` passes — neither new module imports an `astro:` specifier

#### Manual Verification:

- The scorer's seam reads as something S-05 would add a function to, not something it would work
  around — check by writing (not committing) the two-line signature a text scorer would need

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: The submission script and the result read

### Overview

The store half. One `EVAL` that records and scores an answer indivisibly, and one that reads a
player's own result back. This is the phase where the cost prediction is written down, because Phase 5
measures it against exactly what is stated here.

### Changes Required:

#### 1. The submission script

**File**: `src/lib/session/store.ts`

**Intent**: Record one answer per player per question, atomically, refusing anything the session's
phase does not allow. Copies `CLAIM_PLAYER`'s shape — phase check inside the script, TTLs inside the
script, no read-then-write in TypeScript (spine rule 3).

**Contract**: `SUBMIT_ANSWER`, a single `EVAL`, plus `submitAnswer(record: AnswerRecord): Promise<SubmitResult>`.

```
KEYS[1] = session doc, KEYS[2] = answers hash, KEYS[3] = scores hash, KEYS[4] = player-ids hash
ARGV[1] = answer field, ARGV[2] = record JSON, ARGV[3] = player id,
ARGV[4] = question id, ARGV[5] = awarded, ARGV[6] = ttl

Returns { 1, total }  accepted
        { 0, 0 }      already answered this question
        { -1, 0 }     no session
        { -2, 0 }     question not open, or a different question is open
        { -3, 0 }     unknown player id
```

Six internal `redis.call`s on the accepted path (`GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE`),
seven commands billed with the `EVAL`. **State that count in the docstring** — it is the number Phase 5
prices, and a future edit that adds a call needs to know it is being watched.

`HSETNX` is what makes the first answer final; the lock and the write are the same operation, so there
is no window in which a second submission can slip between them.

The question-id check is not redundant with the phase check: a phone that submits just as the host
advances would otherwise have its answer recorded against the *new* question.

`SubmitResult` is a discriminated union in the file's existing style —
`accepted | already-answered | not-open | no-session | unknown-player | unconfigured | failed` —
and `accepted` carries the new running total.

#### 2. The result read

**File**: `src/lib/session/store.ts`

**Intent**: Return one player's answer to one question plus their running total, in one round trip,
alongside the session document the caller needs to check the phase against.

**Contract**: `READ_ANSWER`, a read-only `EVAL` (`GET` session, `HGET` answers, `HGET` scores — four
commands billed), and `readOwnResult(playerId, questionId)`. Like `READ_PLAYER_BY_ID`, this is an
`EVAL` for the round trip and not for any guard — say so, or a reader looks for an invariant that
isn't there.

The returned type must keep **"no answer recorded" and "the store could not answer" distinguishable**,
for the reason `LookupResult` (`store.ts:664`) does: the client treats them differently, and
conflating them is how S-02 locked attendees out.

#### 3. Test coverage for both

**File**: `src/lib/session/store.test.ts`

**Intent**: Pin the properties that only hold because the logic is in Lua.

**Contract**: Assert `submitAnswer` issues exactly one `eval` and no other command — the same
assertion that already guards the version guard and the claim, and the one that stops a future
refactor from moving the phase check into TypeScript. Cover each return status mapping to its union
member.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `store.test.ts` asserts `submitAnswer` is a single `eval` call
- `keys.test.ts` passes — no namespaced literal introduced in `store.ts`

#### Manual Verification:

- The predicted per-event command cost is written into the plan's Critical Implementation Details and
  matches the script as implemented (count the `redis.call`s by hand against the table)
- A dev-server submission against the real store returns `accepted` once and `already-answered` on an
  immediate repeat

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Routes and the reveal payload

### Overview

The wire. A submission endpoint, a result endpoint, the state field that carries the correct answer to
the room, and the log vocabulary for both.

### Changes Required:

#### 1. The revealed answer in session state

**File**: `src/lib/session/state.ts`

**Intent**: Carry the correct option ids to every device at reveal, so correctness lands without a
round trip and a device whose result fetch fails still sees the right answer.

**Contract**: `revealedOptionIds: z.array(z.string()).nullable().default(null)`.

`.default(null)` for the same load-bearing reason `playerCount` carries `.default(0)`: a session
document written before this ships must still parse, or the host's next action 409s mid-segment.

A `superRefine` rule: non-null **only** in `question-revealed`. The three existing constructors
(`initialSessionState`, `endedSessionState`, and the literals in `advance.ts`) set it to `null`.

There is a fourth place a session document is built: `scripts/check-purge-residue.ts:158` seeds one.
It is an untyped object handed to `JSON.stringify`, so `astro check` will not flag it and
`.default(null)` makes it parse — **it is safe by accident of the default, not because it was
updated.** Leave it, and know that removing the default breaks it silently.

Document beside the field that this is the opposite of `playerCount`: it is part of the transition, is
set by `reveal.ts`, and must never be injected in `applyHostAction`. The two fields sit next to each
other and behave oppositely, which is exactly how a later edit gets it wrong.

#### 2. Reveal populates it

**File**: `src/pages/api/quiz/host/reveal.ts`

**Intent**: On the transition to `question-revealed`, look the current question up in the definition
and put its correct option ids on the state it returns.

**Contract**: The existing transition literal gains `revealedOptionIds`. For a choice question, the
question's `correctOptionIds`; for any other kind — and for an unscored question with none — an empty
array, which the client renders as "nothing to highlight" rather than as an error. `advance.ts` sets
`null`, as does `end`.

#### 3. The submission route

**File**: `src/pages/api/quiz/answer.ts` (new)

**Intent**: Validate a submission, score it, and hand the finished record to the store. Open with no
host secret, on the same reasoning as `/api/quiz/join`.

**Contract**: `export const POST: APIRoute`, reading `request.formData()` per project convention:
`playerId`, `questionId`, `optionIds` (repeated field), `elapsedMs`. Replies JSON with Polish
`error` strings.

The route is where the answer becomes a score:

1. `readSession()` — **an explicit, billed store read, and the plan prices it** (see the cost table).
   The clamp needs the question's open time and scoring happens here, before the script runs, so the
   route cannot borrow the `GET` the script does. It earns its cost twice over: it also lets an
   answer for a question that is no longer open be refused without spending a write.
2. Look the question up in the **raw** definition (server-side — this is the one place
   `correctOptionIds` is legitimately read).
3. Refuse a kind this slice does not handle, with a message rather than a crash — this is the seam
   S-05 and S-06 extend.
4. Clamp the elapsed time against that document's `updatedAt`, then score. During `question-open`,
   `updatedAt` *is* the moment the question opened, because the advance that opened it was the last
   write — and only host actions write. **State that reasoning in the code**: it stops holding the
   day a slice adds a host action that fires while a question is open.
5. Submit. The script re-checks phase and question id against its own read, so nothing here is a
   read-then-write: the route's read decides the *award*, the script's read decides whether the
   award counts.

**The response must not carry the verdict.** It says accepted, or why not, and the new total is
withheld until reveal too — a total that jumps by 800 is a verdict. Body: `{ accepted: true }`.

`session.answer.accepted` and `session.answer.rejected` join `SESSION_EVENTS`, and the `rejection`
union in `LogFields` gains `not-open` and `already-answered`. **Never log `optionIds`** — CLAIM: an
answer is attendee data under CLAUDE.md's rule, logs are retained ~1h and are covered by no TTL and
no purge. `questionId` is already an allowed field and carries nothing about a person.

#### 4. The result route

**File**: `src/pages/api/quiz/result.ts` (new)

**Intent**: Give one device its own result for one question, after that question has been revealed.

**Contract**: `POST`, form fields `playerId` and `questionId`. Returns
`{ answered, correct, awarded, total }`.

Two refusals that are the whole point of the endpoint existing separately from the submission:

- **Phase gate.** A per-question verdict is served only when that question is in `question-revealed`.
  Otherwise this is a cheat sheet reachable with one `curl` while the question is open.
- **`not-found` vs `failed` stay distinct**, and the client acts differently on each — a store blip
  must not make a phone conclude it never answered.

`answered: false` is a normal outcome (a latecomer, or someone who did not tap in time), not a 404.

**One exception to the gate, and it is deliberate: the `ended` phase serves the running total alone**
— no `correct`, no `awarded`, no question id. `ENDED_TTL_SECONDS` exists precisely so "a device that
reloads just after the host closes the segment should still find the final standings"
(`store.ts:44`), and a gate that refuses everything in `ended` would store those totals for ten
minutes with no way to read them. There is nothing to leak once the segment is over.

S-07 builds the screen that uses this; this slice only makes sure the data is reachable. Record in
the answer contract that **S-07 inherits this gate** rather than rediscovering it.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `state.test.ts` covers: the default parses a pre-deploy document, non-null is refused outside
  `question-revealed`, and every constructor sets the field
- `answer.test.ts` covers: a correct multi-select scores, a partial one does not, an unhandled kind is
  refused, elapsed is clamped, and **the response body contains neither `correct` nor `awarded`**
- `result.test.ts` covers: the phase gate refuses an open question, the `ended` phase returns a total
  and no verdict, `not-found` and `failed` produce different statuses
- `routes.test.ts` still passes — reveal's existing no-op and rejection behaviour is unchanged
- `keys.test.ts` and `boundary.test.ts` pass

#### Manual Verification:

- `curl` the result endpoint for a question that is open and confirm it refuses (with
  `-H "Origin: <base-url>"` — Astro's origin check applies, `spine-contract.md:42`)
- A reveal published to the channel visibly carries `revealedOptionIds`; an advance clears it

**Implementation Note**: Pause for manual confirmation before Phase 4.

---

## Phase 4: The attendee view

### Overview

Where the slice becomes visible. Options become controls, the clock starts when the question paints,
the submission locks, and the reveal shows the attendee what happened.

### Changes Required:

#### 1. Controls instead of static text

**File**: `src/lib/client/render.ts`

**Intent**: Let `renderQuestion` produce tappable options for the two choice kinds while keeping the
static rendering for everything else, and add the reveal state — correct option highlighted, the
attendee's own selection marked.

**Contract**: An options argument extending `QuestionClassNames` with a mode
(`static | answerable | revealed`), the selected ids, the correct ids, and an `onSelect` callback.
Single-choice selects one; multiple-choice toggles. Still `createElement` and `textContent`, never
`innerHTML` — S-08 will feed this attendee-supplied strings.

Buttons rather than list items in answerable mode, so a phone gets a real tap target and keyboard
focus works. Keep the `data-optionId` hook.

#### 2. The device's clock

**File**: `src/lib/client/answer.ts` (new)

**Intent**: Own the per-question timing and the submission, so `index.astro`'s script stays a state
machine rather than growing a second one.

**Contract**:

- `markSeen(storageKey, questionId)` → the first-paint epoch ms for that question, reading back a
  previously stored value rather than overwriting it. **This is the reload fix**: without persistence,
  reloading mid-question resets the clock and hands out the full speed weight. Stores one entry
  `{ [questionId]: timestamp }` under `QUESTION_SEEN_STORAGE_KEY`, and follows `player.ts`'s posture —
  nothing here throws, and unavailable storage degrades to "the clock starts now".
- `submitAnswer(playerId, questionId, optionIds, elapsedMs)` → posts to `/api/quiz/answer` and reports
  accepted / rejected. In-flight guard, exactly as the join button has one (`index.astro:312`) — two
  fast taps must not produce two submissions.
- `fetchResult(playerId, questionId)` → posts to `/api/quiz/result`.

May not value-import from `src/quiz/` or `src/lib/session/` and may not read `import.meta.env`
(`boundary.test.ts`). The storage key arrives through `define:vars` like `PLAYER_STORAGE_KEY` does.

#### 3. The view

**File**: `src/pages/quiz/index.astro`

**Intent**: Extend the existing `render()` state machine with the answering and reveal beats. Rendering
from state rather than from events is what already makes an out-of-order snapshot harmless; the new
beats must keep that property.

**Contract**: Additions to the existing script block, plus markup for a submit control and a result
panel.

- `question-open` — mark the paint time, render answerable options, enable submit when a selection
  exists. On an unscored question (`question.scored === false`) say so up front — a warm-up, no
  points. After acceptance: lock the options, confirm ("Odpowiedź zapisana"), and show nothing about
  correctness.
- `question-revealed` — render revealed options from `state.revealedOptionIds`, then fetch this
  device's own result and show verdict, award and running total. **If the fetch fails, the correct
  answer is still on screen** — that split is the reason the design carries the ids in the snapshot at
  all, so degrade to it explicitly rather than showing an error.
- **The fetch is gated on two things the phone already knows**: that it submitted an answer, and that
  `question.scored` is true. A device that stayed silent has no result, and an unscored question has
  no award — fetching either spends a request to be told nothing. This also cuts the reveal fan-in,
  which is the one load shape this plan admits stays unmeasured (§Performance Considerations), and
  removes 2 of 14 questions from it outright.
- Unscored questions get their own copy — a warm-up with no points, per FR-017 — never "wrong". This
  is driven by `question.scored` from the projection (Phase 1 §4), **not** inferred from
  `awarded: 0`: a wrong answer to a scored question produces the identical payload, and the drafted Q2
  is the gather-the-room beat that would otherwise tell every latecomer they failed.
- A device that never answered sees the correct answer and no verdict.

Polish copy throughout, large type, high contrast — the existing view's constraints.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — no `import.meta.env`, no value import from `src/quiz/` or
  `src/lib/session/` in `answer.ts` or in the page's `<script>` blocks
- `keys.test.ts` passes — the new storage key is a literal only in `keys.ts`
- `render.test.ts` (new or extended) covers: single-choice selects one, multiple-choice toggles,
  revealed mode marks the correct option, and option text is set via `textContent`

#### Manual Verification:

- **Two-device run against production**: both phones answer, both lock, the host reveals, both see
  their own verdict and award, and the totals differ by the speed weight
- Reload a phone mid-question, answer, and confirm the speed weight reflects the original paint time —
  not the reload
- Answer on one phone, leave the other silent; on reveal the silent phone shows the correct answer and
  no verdict
- Answer the unscored Q2 and confirm the copy reads as a warm-up, not as a wrong answer
- With the network tab open, confirm **no** result request is issued on the unscored question, or
  from a device that did not answer
- Kill one phone's network at reveal and confirm the correct answer still renders

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Room-scale submission burst, and the contract

### Overview

The measurement this slice owes, and the documents that stop the next slice from rediscovering its
decisions.

### Changes Required:

#### 1. An answer stage in the harness

**File**: `scripts/rehearse-room.ts`

**Intent**: Drive 150 simulated attendees through one choice question — join, receive the question,
submit — and report submission latency alongside the fan-out figures the harness already produces.

**Contract**: A new stage after the existing join and host-action stages, reusing the existing client
pool, the `--clients` flag and the finding-collection shape. Each client submits a randomly chosen
option with a plausible elapsed time. Report accepted / rejected / failed counts and the submission
round-trip distribution. One question, not fourteen: the second question re-measures what the first
proved, at real store cost.

#### 2. The counter reading

**File**: `context/changes/answer-choice-question-and-reveal/answer-cost-report.md` (new)

**Intent**: Price the observed command delta against Phase 2's stated prediction, using the
attribution method that worked for S-02 rather than an idle reading.

**Contract**: Baseline before the run, a **settled** reading after — and the interval it was read at,
because `command-counter-diagnostic.md:106` records that a reading taken minutes after a burst looks
exactly like a settled one and produced a cost model 3× too low. Predicted-vs-observed table for
writes and reads. Human-only step: the Upstash console is not reachable from this environment.

#### 3. The runbook cost update

**File**: `docs/runbook-live-session.md`

**Intent**: The cost section quotes S-02's ~1600-command event and says the per-run tripwire "sits
roughly 125× above a real session". Both figures go stale the moment this slice ships. Record the new
ones.

**Contract**: Update the measured per-event cost, the implied monthly figure at ten events against the
500K ceiling, and the tripwire's revised margin (~125× → ~7×).

**Do not change the threshold.** The same section says "Do not raise it as usage grows: raising it is
how it stops working", and at ~27k per event nothing approaches 200K within a single run. This edit
records that the margin shrank; it does not act on it. Add a pre-session check for the answer path if
the two-device run surfaced one.

#### 4. The answer contract

**File**: `context/changes/answer-choice-question-and-reveal/answer-contract.md` (new)

**Intent**: The fourth contract, after spine, retention and join — and it inherits their warning: a
contract that grows past a page has become a second copy of the plan, and a second copy can disagree
with it. A pointer, not a summary.

**Contract**: One page. The scoring rule and where it lives; the two new keys and what they hold; the
two fields that look alike and behave oppositely (`playerCount` vs `revealedOptionIds`); the result
endpoint's phase gate **and its `ended`-phase exception, which S-07 inherits**; the measured cost;
and the scope boundary naming what S-04, S-05, S-06, S-07 and S-09 still own.

The accepted risks, listed rather than implied — forged timing, the player id as a bearer credential,
the reload residual on the paint clock, and **the unthrottled answer route**. That last one inherits
`/api/quiz/join`'s reasoning (a venue network is one address), but that reasoning was formed when the
whole room cost ~8 commands; a loop against this route now bills per call against a budget this slice
pushes to ~54%. Unguessable player ids make it a nuisance rather than an exploit — say so in the
contract instead of leaving it to be inferred from the scope boundary.

#### 5. Roadmap and lessons

**Files**: `context/foundation/roadmap.md`, `context/foundation/lessons.md`

**Intent**: Mark S-03 `done` with its risk retired or restated, and record any recurring rule the
implementation surfaced.

**Contract**: The S-03 entry's Status and Risk paragraphs, in the shape S-02's "Retired 2026-08-08"
note uses. A `lessons.md` entry only if something recurring actually appeared — an empty finding is a
valid outcome and padding the register devalues it.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `bun run build` succeeds — the quiz definition gate still fires
- The harness runs to completion at `--clients=150` with 150/150 submissions accepted and zero
  duplicate answers recorded for any player

#### Manual Verification:

- The settled counter reading is recorded with its interval, and the predicted-vs-observed table
  closes to within the tolerance S-02 achieved (~1%)
- The runbook carries the measured per-event cost, the monthly figure against the 500K ceiling, and
  the tripwire's revised margin — **with the threshold itself unchanged**
- `answer-contract.md` fits on one page
- `scripts/check-purge-residue.ts` reports no residue after a purge — the two new keys included
- Roadmap S-03 is marked done with its risk retired or restated, and `lessons.md` is updated only if
  something recurring actually appeared (an empty finding is a valid outcome)

**Implementation Note**: This is the last phase; confirm the whole slice against the roadmap outcome
before archiving.

---

## Testing Strategy

### Unit Tests:

- **Scoring** — all-or-nothing correctness in both directions (superset and subset both fail), the
  speed weight's endpoints and monotonicity, clamping of negative and impossible elapsed values,
  unscored questions awarding zero
- **Answer record** — field-name round trip, malformed records parsing to `null` rather than throwing
- **Store** — `submitAnswer` is one `eval`; every return status maps to its union member; the result
  read keeps `not-found` and `failed` distinct
- **State** — `revealedOptionIds` defaults on a pre-deploy document and is refused outside
  `question-revealed`
- **Routes** — the submission response carries no verdict; the result endpoint's phase gate holds
- **Gates** — `keys.test.ts`, `boundary.test.ts`, `portability.test.ts` all still pass with the new
  modules

### Integration Tests:

There is no integration test runner in this project and this slice does not add one — testing strategy
is Module 3's subject. The equivalents here are the two-device run (Phase 4) and the 150-client
harness run (Phase 5), both against production, both with stated pass criteria.

### Manual Testing Steps:

1. Start a session, join on two phones, advance to a scored single-choice question.
2. Answer on both at visibly different speeds; confirm both lock and neither shows a verdict.
3. Reveal; confirm both see the correct option highlighted, their own verdict, their award, and that
   the faster answer scored higher.
4. Reload one phone mid-question on the next question, answer, reveal; confirm the speed weight
   reflects the original paint, not the reload.
5. Advance without answering on one phone; confirm reveal shows the answer and no verdict.
6. Advance to the unscored Q2, answer, reveal; confirm the warm-up copy.
7. Put one phone in airplane mode at reveal; confirm the correct answer still renders.
8. End the session, then purge; run `scripts/check-purge-residue.ts` and confirm no answers or scores
   remain.

## Performance Considerations

The submission path is the first in this project that scales with attendees × questions. Two figures
bound it:

- **Store cost** — ~25k commands per event, priced in Critical Implementation Details and measured in
  Phase 5. The plan ceiling is 500K/month.
- **Fan-in at reveal** — 150 devices fetch their own result within a second or so of each host reveal,
  14 times a session. This is a *new shape*: every prior burst was at join, once. The harness stage in
  Phase 5 exercises submission, not the reveal fetch, so this remains partly unmeasured — recorded
  here rather than left to be discovered.

Serverless concurrency, not the store, is the plausible limit on that fan-in. If Phase 4's two-device
run or Phase 5 shows strain, the fallback is already designed in: the correct answer is in the
snapshot, so the result fetch can be jittered across a second or two without leaving any phone blank.

## Migration Notes

No data migration. `revealedOptionIds` carries `.default(null)` precisely so a session document
written before this deploy still parses — the same mechanism `playerCount` used, and for the same
reason: a required field would 409 the host's next action mid-segment.

A deploy between two questions of a live session is safe. A deploy *during* a question is not, and
never was — `docs/runbook-live-session.md` already carries that.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-03
- PRD: `context/foundation/prd.md` — FR-004, FR-010, FR-016, FR-017, FR-019, §Business Logic Changes
- Spine contract: `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md`
- Retention contract: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Join contract: `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
- Cost model: `context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md`
- The atomic-script pattern to copy: `src/lib/session/store.ts:227` (`CLAIM_PLAYER`)
- The two-outcome trap to copy: `src/lib/session/store.ts:664` (`LookupResult`)
- Lessons: `context/foundation/lessons.md` — "Check the data path can deliver a promised UI affordance"

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: The scoring rule and the answer model

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — 1e19d5f
- [x] 1.2 Type checking passes: `bun run type-check` (0 errors) — 1e19d5f
- [x] 1.3 `scoring.test.ts` covers correctness, weight endpoints, monotonicity, unscored, clamping — 1e19d5f
- [x] 1.4 `public.test.ts` covers `scored` on both kinds and `points` still absent — 1e19d5f
- [x] 1.5 `keys.test.ts` passes with the two new entries — 1e19d5f
- [x] 1.6 `portability.test.ts` passes — no `astro:` specifier in the new modules — 1e19d5f

#### Manual

- [x] 1.7 The scorer's seam reads as something S-05 would extend, not work around — 1e19d5f

### Phase 2: The submission script and the result read

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 95ac6aa
- [x] 2.2 Type checking passes: `bun run type-check` — 95ac6aa
- [x] 2.3 `store.test.ts` asserts `submitAnswer` is a single `eval` call — 95ac6aa
- [x] 2.4 `keys.test.ts` passes — no namespaced literal introduced in `store.ts` — 95ac6aa

#### Manual

- [x] 2.5 Predicted per-event command cost written down and matching the implemented script — 95ac6aa
- [ ] 2.6 Dev-server submission returns `accepted` once, `already-answered` on repeat

### Phase 3: Routes and the reveal payload

#### Automated

- [x] 3.1 Unit tests pass: `bun run test` — 0fce857
- [x] 3.2 Type checking passes: `bun run type-check` — 0fce857
- [x] 3.3 `state.test.ts` covers the default, the phase invariant, and every constructor — 0fce857
- [x] 3.4 `answer.test.ts` covers scoring, kind refusal, clamping, and a verdict-free response — 0fce857
- [x] 3.5 `result.test.ts` covers the phase gate, the `ended`-phase total, and the `not-found`/`failed` split — 0fce857
- [x] 3.6 `routes.test.ts` still passes — reveal's no-op and rejection behaviour unchanged — 0fce857
- [x] 3.7 `keys.test.ts` and `boundary.test.ts` pass — 0fce857

#### Manual

- [ ] 3.8 The result endpoint refuses an open question over `curl` (with `Origin`)
- [ ] 3.9 A published reveal carries `revealedOptionIds`; an advance clears it

### Phase 4: The attendee view

#### Automated

- [x] 4.1 Unit tests pass: `bun run test` — 31473be
- [x] 4.2 Type checking passes: `bun run type-check` — 31473be
- [x] 4.3 `boundary.test.ts` passes for `answer.ts` and the page `<script>` blocks — 31473be
- [x] 4.4 `keys.test.ts` passes — the new storage key is a literal only in `keys.ts` — 31473be
- [x] 4.5 Render tests cover selection, toggling, revealed marking, and `textContent` — 31473be

#### Manual

- [ ] 4.6 Two-device run: both answer, both lock, both see their own verdict and award
- [ ] 4.7 Reload mid-question does not reset the speed weight
- [ ] 4.8 A silent phone sees the correct answer and no verdict at reveal
- [ ] 4.9 The unscored Q2 reads as a warm-up, not as a wrong answer
- [ ] 4.10 No result request is issued on an unscored question or from a device that did not answer
- [ ] 4.11 A phone with no network at reveal still renders the correct answer

### Phase 5: Room-scale submission burst, and the contract

#### Automated

- [x] 5.1 Full suite passes: `bun run test` — ae1078c
- [x] 5.2 Type checking passes: `bun run type-check` — ae1078c
- [x] 5.3 `bun run build` succeeds — ae1078c
- [x] 5.4 Harness at `--clients=150`: 150/150 accepted, zero duplicate answers

#### Manual

- [ ] 5.5 Settled counter reading recorded with its interval; prediction closes to ~1%
- [ ] 5.6 Runbook carries the new cost and margin, threshold unchanged
- [ ] 5.7 `answer-contract.md` written and fits on one page
- [x] 5.8 `check-purge-residue.ts` reports no residue, new keys included
- [ ] 5.9 Roadmap S-03 marked done; `lessons.md` updated only if something recurring appeared
