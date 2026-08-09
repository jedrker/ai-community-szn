# Host participation and distribution (S-04) — Implementation Plan

## Overview

Give the large screen two numbers it does not have today: **how many attendees have answered the
open question**, updating live while it is open, and **what the room chose**, once the host reveals.

PRD FR-005 was revised during shaping precisely because these two cannot be the same payload — a
distribution on the projector while answering is open is a cheat sheet for anyone who glances up. So
the count and the distribution travel by two different routes, gated by two different mechanisms,
and the separation is enforced by the session schema rather than by the view choosing what to draw.

## Current State Analysis

S-03 delivered answering and reveal. What exists:

- `livequiz:answers` (`src/lib/session/keys.ts:86`) is one hash keyed `<questionId>:<playerId>` →
  answer record JSON. **Nothing counts.** There is no per-question or per-option tally anywhere, and
  no cheap way to derive one: the hash reaches ~2,100 fields by the last question, so `HSCAN` bills
  per iteration and `HGETALL` ships every answer record to the function.
- `submitAnswer` (`src/lib/session/store.ts:861`) bills **8 commands** on the accepted path
  (`readSession` + an `EVAL` with `GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE`) and runs
  150 × 14 times a real event. `HSETNX` is what makes the first answer final.
- `SessionState` (`src/lib/session/state.ts:50`) carries `playerCount` and `revealedOptionIds`. They
  sit adjacent and behave **oppositely**: `playerCount` is injected in `applyHostAction` for every
  action, `revealedOptionIds` is set only in `reveal.ts` and nulled by every other transition. The
  schema's `superRefine` (`state.ts:151`) refuses a non-null `revealedOptionIds` outside
  `question-revealed`.
- The host view (`src/pages/quiz/host.astro`) already is the large screen: phase, join count and
  version at projector scale, plus the secret field and the flow buttons. Its join count is fed by
  two sources — the snapshot, and a live `playerCount` returned *beside* the document by
  `/api/quiz/state` (`src/pages/api/quiz/state.ts:52-76`).
- **Nothing in this project polls.** The host's `odśwież` button is the only re-read, and the
  runbook's command tripwire is described there as "a polling detector, not a budget."
- The rehearsal harness (`scripts/rehearse-room.ts`, `bun run quiz:rehearse`) already drives 150
  joins and 150 answers against production and reads the answers and scores hashes back to check for
  lost or doubled writes.

## Desired End State

While a question is open, the projector shows a rising `answered / joined` figure, refreshed every
couple of seconds without the host touching anything, and holding its last value rather than
collapsing to zero when the venue network drops a request. On reveal, the same area becomes one bar
per option — absolute count and share — with the correct option marked.

Verify by running a question end to end on the host view with at least one phone answering: the
count rises without interaction, no distribution is visible or fetchable while the question is open,
and the bars appear at reveal with counts that match the answers hash.

### Key Discoveries

- **`src/pages/api/quiz/answer.ts:137-146` contains a warning written for this slice**: during
  `question-open`, `updatedAt` *is* the moment the question opened, and that is what bounds the speed
  clamp. The comment names "a live participation count, say" as the change that would silently
  shorten it. **The participation poll must therefore never write the session document.** It is a
  read; this is the single most important constraint in this plan.
- **`nextFrom` in `applyHostAction` (`src/lib/session/host.ts:145`) is synchronous**, so `reveal.ts`
  cannot read tallies inside it today. Making it async is the localized fix. Reading the distribution
  in `applyHostAction` beside `playerCount` is *the* forbidden shape — it would carry the previous
  question's distribution into the next question and publish it to 150 devices.
- **Every `livequiz:`-prefixed name must be a literal in `keys.ts`** (`src/lib/session/keys.test.ts`
  fails the suite otherwise), and `end`/`purge` operate on that registry alone.
- Question ids and option ids are lowercase slugs with no colon (`src/quiz/schema.ts` rejects
  anything else), so compound hash fields are unambiguous — the reasoning `answerField`
  (`src/lib/session/answers.ts:53`) already relies on.
- `/api/quiz/answer` refuses free-text, number and word-cloud kinds today (`answer.ts:132`), so those
  questions can have no participation to show.
- `renderQuestion` (`src/lib/client/render.ts:121`) builds with `createElement`/`textContent`, never
  `innerHTML`, and tags each option `data-option-id`. New rendering follows both.

## What We're NOT Doing

- **No distribution on attendee phones.** The field rides the snapshot, so it reaches them; the
  `/quiz` view ignores it. Its reveal layout is S-03's and stays unchanged.
- **No separate projector view.** `/quiz/host` remains the large screen, secret field and buttons
  included.
- **No live word-cloud aggregate.** FR-015 and the continuously-updating view are S-08.
- **No leaderboard, no standings, no names on the screen.** S-07.
- **No participation display for free-text, number or word-cloud questions.** The panel is hidden for
  kinds the answer route refuses; S-05/S-06/S-08 turn it on as they land.
- **No throttling or rate limiting** on the new endpoint beyond the host-secret gate.
- **No change to scoring**, to `speedWeight`, or to what the attendee is told at reveal.

## Implementation Approach

Three mechanisms, deliberately separate:

1. **Tallies are written at submit**, into a new registered hash, inside the existing `SUBMIT_ANSWER`
   `EVAL` after the `HSETNX` succeeds. Counting where the write already happens means both reads are
   O(1) with a tiny payload, and it inherits the atomicity that makes the first answer final — a
   rejected duplicate cannot double-count because it never reaches the increments.
2. **The open-question count is polled** by the host page from a new host-secret-gated endpoint,
   scoped to `question-open`. One device polls, not 150. The endpoint reads two hash fields and
   writes nothing.
3. **The distribution rides the snapshot**, in a new field set only by `reveal.ts` and refused by the
   schema outside `question-revealed` — the same discipline, and the same enforcement,
   `revealedOptionIds` already has.

## Critical Implementation Details

**The poll must not write the session document.** `answer.ts:137-146` explains why: during
`question-open`, `updatedAt` is the moment the question opened and is the upper bound the speed clamp
uses. Any host-side action that writes the document mid-question shortens that bound and inflates
every subsequent award. The participation endpoint is `GET`, reads two hash fields, and touches
neither `writeSession` nor `applyHostAction`.

**The distribution is set in `reveal.ts` only.** It is the second field with `revealedOptionIds`'
behaviour and must not acquire `playerCount`'s. Injecting it in `applyHostAction` would publish the
previous question's distribution while the next question is open — the exact leak FR-005 was revised
to prevent, and it would look correct on screen.

**Increment after `HSETNX`, never before.** The lock and the answer write are one operation; placing
the tally increments above it would count a duplicate submission that the lock then rejects.

## Phase 1: Tally storage

### Overview

A registered hash of aggregate counts, written inside the submission script and read back by field.

### Changes Required

#### 1. The key registry

**File**: `src/lib/session/keys.ts`

**Intent**: Declare the tallies hash so `end` re-arms it and `purge` deletes it. Its `holds` string
should say plainly that this is the first registered key that is *not* attendee data — aggregate
counts over a 150-person room identify nobody — while noting it is purged anyway, because the
registry has no exemption list.

**Contract**: A sixth entry in `REGISTERED_KEYS` and an exported `TALLIES_KEY = "livequiz:tallies"`.
Nothing else in the module changes.

#### 2. Field naming

**File**: `src/lib/session/tallies.ts` (new)

**Intent**: Own the two field formats so the write path and the read path cannot disagree — the role
`answerField` plays for the answers hash. Prefixed field names rather than bare ids, so the two
families are distinguishable when someone inspects the hash by hand and so neither can collide with
the other.

**Contract**: `answeredField(questionId): string` → `answered:<questionId>`;
`optionField(questionId, optionId): string` → `opt:<questionId>:<optionId>`. Pure module, no store
access, no `zod` — mirrors `answers.ts`.

#### 3. The submission script

**File**: `src/lib/session/store.ts`

**Intent**: Increment the answered counter and one counter per selected option, after the `HSETNX`
that makes the answer final, and arm the key's TTL in the same script for the reason every other key
is armed there. The option ids arrive as a variadic argv tail so a multiple-choice answer needs no
encoding scheme.

**Contract**: `SUBMIT_ANSWER` gains `KEYS[5]` (tallies) and `ARGV[7]` (answered field) plus
`ARGV[8..]` (option fields). `submitAnswer` builds those from the record's `optionIds`. The docstring's
command-count paragraph is updated: **8 → 11 billed commands** for a single-choice submission
(`k + 2` added, where `k` is the number of selected options). The `EVAL`-count assertions in
`store.test.ts` still apply — this stays one script.

#### 4. Reading tallies back — two functions, deliberately

**File**: `src/lib/session/store.ts`

**Intent**: The two payloads FR-005 separates are read by **two separate functions**, so the poll
path is structurally incapable of returning per-option data. A single function returning both, with
the route trimming the response, would put the distribution in the handler's hand during
`question-open` and leave the whole slice's reason for existing resting on the route remembering to
drop a field — the failure would be invisible, because the screen still looks right. This module
enforces the split the same way the schema enforces the reveal-only field.

Both must distinguish "nobody has answered" from "the store could not say" — the
`LookupResult`/`readPlayerCount` discipline — so a projector keeps its last number instead of
rendering an empty room.

**Contract**:
- `readAnsweredCount(questionId): Promise<number | null>` — the poll's only read. One `HGET` on the
  answered field. Cannot return option data; there is no shape for it to travel in.
- `readQuestionTallies(questionId, optionIds): Promise<QuestionTallies | null>` — the reveal's read,
  returning `{ answered: number; options: Record<string, number> }`. One `HMGET` over the answered
  field plus one field per option; a missing field is `0`.

Both `null` on any failure. One billed command each.

### Success Criteria

#### Automated Verification

- Type checking passes: `bun run type-check`
- Test suite passes: `bun run test`
- `keys.test.ts` passes with the new key registered, and still fails if the literal is moved out
- `store.test.ts`: an accepted submission increments the answered counter by exactly one and each
  selected option by exactly one
- `store.test.ts`: a duplicate submission (`already-answered`), and one refused for phase, question id
  or unknown player, increments nothing
- `store.test.ts`: `readAnsweredCount` and `readQuestionTallies` each return zeros for an untouched
  question and `null` when the store throws
- `tallies.test.ts`: field formats, and that an option field can never collide with an answered field

#### Manual Verification

- `bun run quiz:reset` then a single local answer leaves exactly the expected fields in
  `livequiz:tallies`, inspected in the Upstash console

---

## Phase 2: The participation endpoint

### Overview

A host-only read of the open question's answered count, cheap enough to poll.

### Changes Required

#### 1. The route

**File**: `src/pages/api/quiz/host/participation.ts` (new)

**Intent**: Return the answered count for a named question alongside the live join count, gated by
the host secret, writing nothing. It is gated — unlike `/api/quiz/state`, which is open on the stated
ground that it returns only what is already broadcast — because an answered count is *not* broadcast,
and because an endpoint built to be polled is the cheapest way to run up commands against a budget
already near three-quarters of its ceiling.

**Contract**: `export const GET: APIRoute`. Reads the secret via the existing header
(`HOST_SECRET_HEADER`; `extractSecret` falls back to a form body, which a `GET` has none of — that is
fine and it returns `null`). Takes `questionId` from the query string. Responds
`{ questionId, answered, playerCount }` at 200; `401` with the standard Polish message when the
secret fails; `400` when `questionId` is absent, empty, or not a question in the definition. Two
billed commands (`HGET` + `HLEN`). `Cache-Control: no-store`.

**It calls `readAnsweredCount`, never `readQuestionTallies`.** The distribution is not withheld here
by the handler choosing what to serialize — it is unreachable from this code path. See Phase 1 §4.

**Why the client names the question**: it saves a `readSession` per poll, and the host page holds the
authoritative snapshot already. The response echoes `questionId` so a client whose question changed
mid-flight discards the answer rather than painting a stale count under a new prompt.

**The absent case fails safe** (`lessons.md`, "Absent untrusted input must fail toward the safe end"):
a missing or unknown `questionId` is a `400`, never a fallback to the session's current question and
never a `0` that would read as "nobody has answered".

### Success Criteria

#### Automated Verification

- Type checking passes: `bun run type-check`
- `participation.test.ts`: 200 with the correct count for a valid request, echoing the requested
  `questionId`
- `participation.test.ts`: 401 with no secret and with a wrong secret; 400 for absent, empty and
  unknown `questionId`
- `participation.test.ts`: the 200 body's key set is exactly `questionId`, `answered`, `playerCount`
  — asserted against the key set, so a future field cannot be added without the test noticing
- Test asserting the handler calls no write path — no `writeSession`, no `applyHostAction`
- `keys.test.ts` still passes (the route is under a scanned directory)

#### Manual Verification

- `curl` without the secret returns 401; with the secret returns the count
- Answering from one phone raises the number the next `curl` returns

---

## Phase 3: Distribution on the snapshot

### Overview

The reveal payload gains the room's answers, under the same gate that protects the answer key.

### Changes Required

#### 1. The state schema

**File**: `src/lib/session/state.ts`

**Intent**: Add the distribution as a reveal-only field, documented beside `revealedOptionIds` as
the *third* field in the "read this before editing either" comparison — and explicitly on
`revealedOptionIds`' side of it, not `playerCount`'s.

**Contract**: `revealedDistribution`, an object `{ answered: number; options: Record<string, number> }`,
`.nullable().default(null)` — defaulted for the same load-bearing reason the other two are: a session
document written before this ships must still parse, or the host's next action 409s mid-segment. A
new `superRefine` clause refuses a non-null value outside `question-revealed`, mirroring the existing
one. `initialSessionState` and `endedSessionState` set it to `null`.

#### 2. Async transition computation

**File**: `src/lib/session/host.ts`

**Intent**: Let a host route read data it needs to build the next state, without moving that read
into the shared body where it would apply to every action.

**Contract**: `applyHostAction`'s `nextFrom` becomes
`(current, now) => SessionState | null | Promise<SessionState | null>`, awaited at the call site. The
`playerCount` injection and its comment are unchanged. `start.ts` and `advance.ts` need no edit.

#### 3. The reveal route

**File**: `src/pages/api/quiz/host/reveal.ts`

**Intent**: Read the tallies for the question being revealed and attach them to the revealed state,
in the same place and for the same reason `revealedOptionIds` is set here.

**Contract**: The `nextFrom` closure becomes async and calls `readQuestionTallies`. One extra billed
command, on reveal only (~14 a session).

**A failed tally read publishes `null`, never a zero.** The reveal still succeeds — it is the beat
that must not break, and `revealedOptionIds` still marks the correct answer, so FR-016 is unaffected —
but the distribution is reported as absent rather than as empty. `{ answered: 0, options: {} }` would
render as every bar at zero, which on a projector reads as "nobody answered": the same wrong message
this plan rejects for the poll, at the higher-stakes moment. `null` is the field's own vocabulary for
"there is nothing to show", and the view renders nothing where the bars would be.

For a non-choice kind the read is skipped and the field is `null` too — the panel is hidden for those
kinds anyway (Phase 4). This is the one place the distribution and `revealedOptionIds` diverge:
`revealedOptionIds` yields `[]` there, because "no options are correct" is a fact, while "no
distribution" is an absence.

**The race is accepted and documented**: the tally read happens outside the version guard, so an
answer landing between the read and the compare-and-set is counted in the hash but not in the
published distribution — at most a one-answer drift, at the instant the question closes. The same
asymmetry `playerCount` already documents: the count needs no serialization, the version does.

### Success Criteria

#### Automated Verification

- Type checking passes: `bun run type-check`
- `state.test.ts`: a non-null distribution is refused in `lobby`, `question-open` and `ended`, and
  accepted in `question-revealed`
- `state.test.ts`: a document written without the field still parses
- `host.test.ts`: an async `nextFrom` is awaited, and a rejected one does not commit
- `routes.test.ts`: reveal publishes a snapshot carrying the distribution; `start` and `advance`
  publish snapshots with it `null`
- `routes.test.ts`: a reveal whose tally read fails still succeeds, and publishes the distribution as
  `null` — **not** as `{ answered: 0 }`
- `routes.test.ts`: revealing a non-choice question publishes the distribution as `null`
- Full suite passes: `bun run test`

#### Manual Verification

- Watching `/api/quiz/state` across a start → advance → reveal → advance cycle, the field is null
  everywhere except the revealed step

---

## Phase 4: The host view

### Overview

The panel the room actually reads.

### Changes Required

#### 1. Distribution rendering

**File**: `src/lib/client/render.ts`

**Intent**: A sibling to `renderQuestion` that draws one bar per option with its count and share, and
marks the correct option. Kept here rather than inline in the page for the reason the module exists:
hand-written DOM is the accepted cost of having no framework, and it is paid once.

**Contract**: `renderDistribution(container, question, distribution, correctOptionIds, classNames)`.
Built with `createElement` and `textContent`, never `innerHTML` — S-08 will feed this module
attendee-supplied strings. Shares are computed against `answered`, and an `answered` of zero renders
every bar at zero width rather than dividing by it.

**On the two multiple-choice questions the shares will sum past 100%, and that is correct** — the
denominator counts people, not selections, so someone who picked two options is in two bars. Do not
normalize it to 100%: that would misreport what share of the room chose each option, which is the
question the display answers. Stated here because it reads as a bug. Options keep their `data-option-id`, and a
correct option is marked in the DOM (`data-correct`) as well as by class, so the marking survives a
stylesheet that fails to load on a venue network.

#### 2. The participation panel and the poll loop

**File**: `src/pages/quiz/host.astro`

**Intent**: Show `answered / joined` at projector scale while a question is open, refreshed on a
timer; show the distribution instead once revealed; show neither for a question kind that cannot be
answered. The loop is a read-only client concern and lives in this page's `<script>` block, which
already holds the secret it needs.

**Contract**:
- A new section between the three figures and the question, rendered from the snapshot the page
  already reconciles.
- **One predicate governs both the panel and the poll**, and it is written once: the phase is
  `question-open` *and* the current question's `kind` is `single-choice` or `multiple-choice`. The
  panel is hidden (via the `hidden` attribute, which needs no CSS) and the poll does not run whenever
  it is false. Two conditions here would mean the poll runs for the four drafted questions the answer
  route refuses — feeding a panel that is not rendered from an endpoint that can only return zero.
  A data path with no affordance is the mirror of `lessons.md`'s first rule, and it fails just as
  quietly.
- The poll also stops on `document.visibilityState === "hidden"` and on page teardown. Interval
  ~2.5 s.
- Each poll sends the current `questionId` and the secret header; a response whose `questionId` does
  not match the page's current one is discarded.
- **On a network failure**: keep the last count, show a small staleness marker beside it, and lengthen
  the interval (e.g. doubling to a ceiling of ~20 s) rather than stopping. Recovery resets it. This
  mirrors `readPlayerCount` returning `null` rather than `0` — a count that drops to zero on a blip
  reads to the room as everyone having left.
- **A `401` is not a network failure and must not take that path.** The ordinary cause is a host who
  has opened the page and not yet typed the secret, which is the first thirty seconds of every
  session. Backing off would leave the projector showing a stale marker that says nothing about what
  is wrong, and would then delay recovery by up to the backed-off interval after the secret is
  finally typed. Instead: report it through the existing `#message` element as a missing-secret
  problem, leave the interval alone, and retry on the next `input` event on the secret field.
- The denominator is the same `liveCount` the page already maintains; the poll's `playerCount`
  updates it, so the join count stops needing a manual refresh during a question.
- At `question-revealed`, the option list is replaced by the distribution bars; `revealedOptionIds`
  supplies the marking.

### Success Criteria

#### Automated Verification

- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — the new `<script>` block reads no `import.meta.env` and value-imports
  nothing from `src/quiz/` or `src/lib/session/`
- `render.test.ts`: bars in definition order with correct counts and shares, and the correct option
  marked in the DOM
- `render.test.ts`: `answered: 0` renders without dividing by zero
- `render.test.ts`: a multiple-choice distribution whose shares sum past 100% renders each share
  against `answered`, unnormalized
- `render.test.ts`: option text is never interpreted as markup
- Full suite passes: `bun run test`

#### Manual Verification

- With two devices against a preview or production deploy: the count rises without touching the page
  while a question is open, and no distribution is visible on the host view or obtainable from
  `/api/quiz/state` during `question-open`
- Killing the network mid-question freezes the count with the staleness marker rather than zeroing it,
  and it resumes when the network returns
- At reveal, bars appear with the correct option marked, and the counts match what the two devices
  submitted
- Read from the back of a room (or at equivalent distance): the count and the bars are legible, and
  the panel does not push the prompt off screen
- A question kind the answer route refuses shows no panel rather than a stuck zero

---

## Phase 5: Verification and cost

### Overview

Prove the counters under concurrency, measure what the slice actually costs, and write down both.

### Changes Required

#### 1. Harness tally check

**File**: `scripts/rehearse-room.ts`

**Intent**: The harness already drives 150 answers and reads the answers and scores hashes back to
check for lost or doubled writes. Extend that stage to ask the question this slice adds: **does the
tally agree with the answers hash?** Counter drift under 150 concurrent submissions is invisible to a
mocked test, and this is the only place it can be seen before an event.

**Contract**: After the answer stage, read `livequiz:tallies` and record two findings — the answered
counter equals the number of answer fields for that question, and the sum of the option counters
equals the total number of option ids across those records. Reported through the existing
`record(ok, label, detail)` helper.

#### 2. Cost record

**File**: `context/changes/host-participation-and-distribution/participation-cost-report.md` (new)

**Intent**: The observed command-counter delta for the run, attributed against the predicted model,
in the form S-02 and S-03 established. The runbook warns that a counter reading taken too soon looks
settled and is not — take the reading at least ~90 minutes after the run.

**Contract**: Predicted vs observed, with the per-path arithmetic: submission 8 → 11 (`k + 2`), reveal
+1, poll 2 per tick, counted over the **10 answerable questions** rather than all 14. Predicted event
total ~32.4k against ~26.8k before; ten events ~65% of the 500K ceiling against ~54%. If the observed
delta disagrees with the prediction by more than a few percent, that disagreement is the finding —
do not reconcile it by adjusting the model after the fact.

#### 3. Runbook

**File**: `docs/runbook-live-session.md`

**Intent**: The tripwire section states a per-event figure and calls itself a polling detector. Both
statements are now wrong in a way that matters: the event costs more, and there is a legitimate
polling loop. A host reading the counter after a session must be able to tell expected cost from a
leak.

**Contract**: Update the per-event figure and the ten-event percentage **from the measured delta, not
from the prediction above**; add one paragraph naming the host participation poll as the project's one
sanctioned polling loop, with its shape (one device, `question-open` on a choice question only,
~2.5 s) so an unexpected pattern is still detectable.

#### 4. Contract note

**File**: `context/changes/host-participation-and-distribution/participation-contract.md` (new)

**Intent**: The fifth contract, after spine, retention, join and answer — and, like them, a pointer
rather than a second copy of the plan.

**Contract**: One page. The two-payload rule and what enforces it; the three snapshot fields and which
side of the `playerCount` / `revealedOptionIds` divide the new one sits on; the poll's read-only
constraint and the `updatedAt` clamp it protects; the new key and why it is registered despite not
being attendee data; the accepted risks below.

#### 5. Change record

**File**: `context/changes/host-participation-and-distribution/change.md`

**Intent**: Reflect the delivered state.

**Contract**: `status: planned` → the implementation skill's convention; `updated` stamped.

### Success Criteria

#### Automated Verification

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- `bun audit` reports no new advisories
- `bun run build` succeeds (the `assertQuizValid` gate still runs at config load)
- `bun run quiz:rehearse --base=<production>` reports 150/150 answers accepted, zero lost or doubled
  writes, **and both new tally findings ok**
- `bun run quiz:check-purge` reports no residue after `end` and `purge` — including the new key

#### Manual Verification

- Command counter read before the run and again ≥90 minutes after, and the delta attributed to
  within a few percent of the predicted model
- The cost report, the runbook update and the contract note are written and internally consistent
- A full stage rehearsal: start → advance → watch the count rise → reveal → read the bars from a
  distance, with no interaction other than the flow buttons

---

## Testing Strategy

### Unit Tests

- Tally increments: exactly once per accepted answer, exactly once per selected option, and **zero**
  on every rejection path (`already-answered`, `not-open`, `unknown-player`, `no-session`)
- `readQuestionTallies` returning zeros vs `null`, and the caller behaving differently for each
- The schema gate on `revealedDistribution` in all four phases, plus backward parse of a document
  written before the field existed
- `applyHostAction` awaiting an async `nextFrom`
- Distribution rendering: order, counts, shares, zero-answered, correct marking, no markup
  interpretation
- The endpoint's 401 and its three 400 cases, and its `questionId` echo

### Integration Tests

- A start → advance → answer → reveal sequence asserting the published snapshots: distribution null
  until the reveal, populated at it, null again on the next advance
- The reveal path when the tally read fails: reveal still succeeds

### Manual Testing Steps

1. `bun run quiz:reset`, open `/quiz/host`, enter the secret, `start`, `advance`.
2. Confirm the panel appears with `0 / n` and no distribution anywhere, including in the raw
   `/api/quiz/state` response.
3. Answer from a phone; confirm the count rises within ~3 s without touching the host page.
4. Disable the network on the host machine briefly; confirm the count freezes with the staleness
   marker and resumes afterwards.
5. `reveal`; confirm bars appear with the correct option marked and counts matching.
6. `advance`; confirm the bars are replaced by the next question and the distribution is null again.
7. Advance to a free-text question; confirm no panel appears.
8. Step back to the far end of the room and read the screen.

## Performance Considerations

The submission path adds `k + 2` billed commands, where `k` is the number of options the attendee
selected: **8 → 11** for a single-choice answer, 8 → 12 for a two-option multiple-choice one.

The per-event arithmetic has to use the answerable questions, not all fourteen. The drafted quiz is
**8 single-choice, 2 multiple-choice, 2 number, 1 text, 1 word-cloud**, and `/api/quiz/answer` refuses
the last four kinds today — so only 10 questions generate submissions at all:

| Path | Added per event |
| --- | --- |
| 8 single-choice × 150 × 3 | 3,600 |
| 2 multiple-choice × 150 × (2 + k), at k ≈ 2 | ~1,200 |
| Poll (~2 commands / 2.5 s, one device, 10 questions) | ~750 |
| Reveal reads | 14 |
| **Added** | **~5,600** |

Against the S-03 baseline of ~26,800 (`answer-cost-report.md`), that is **~32,400 per event, and ten
events a month at ~65% of the 500K ceiling** — up from ~54%. Phase 5 measures the real delta and
corrects these figures; they are a prediction, and the runbook must carry the measured number rather
than this one.

Accepted deliberately: the alternative — deriving counts from the answers hash — trades a bounded
per-submission cost for an unbounded per-read one on a hash that reaches ~1,500 fields.

Payload: the snapshot grows by one small object (~100 bytes at 6 options). Fan-out is unchanged —
this slice adds no publish.

## Migration Notes

No data migration. `revealedDistribution` is defaulted so a session document written before the
deploy still parses; the tallies hash simply does not exist until the first answer after the deploy.
A session *running* across the deploy loses tallies for questions already answered — the counters
start from that point. This is acceptable and expected: deploying mid-segment is already outside what
the runbook sanctions.

Rollback is a redeploy of the previous commit. The tallies key is then unreachable by `end` and
`purge`, which are registry-driven and the previous commit's registry does not contain it — but the
key carries `SESSION_TTL_SECONDS`, so it **self-clears within four hours**, and it holds aggregate
counts rather than attendee data. So this is a verification step, not a hazard: run
`bun run quiz:check-purge` after a rollback, since it scans the real store rather than the registry
and is the only thing that can see the orphan.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-04)
- Requirement: `context/foundation/prd.md:219` (FR-005, and the revision that split the two payloads)
- Prior contracts, all load-bearing here:
  - `context/archive/2026-08-08-answer-choice-question-and-reveal/answer-contract.md`
  - `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
  - `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
- Recurring rules: `context/foundation/lessons.md` — both entries apply (the affordance/data-path
  check, and absent input failing safe)
- The warning this plan was written around: `src/pages/api/quiz/answer.ts:137-146`
- The pattern to mirror: `src/lib/session/state.ts:87-109` (`revealedOptionIds`)

## Open Risks & Assumptions

- **Cost.** Ten events a month reaches ~65% of the ceiling on the predicted model, and the prediction
  itself is unverified until Phase 5 measures it. Not a blocker at the real cadence, but
  S-05, S-06, S-07 and S-08 each add per-attendee paths on top of this one, and the next slice to
  raise it should say so deliberately.
- **The projector poll is unmeasured under venue conditions.** It is one device, so the risk is a
  frozen number rather than a room-scale failure, and the backoff bounds it.
- **The one-answer drift** between the tally read and the compare-and-set at reveal is accepted and
  documented, not eliminated.
- **The distribution reaches 150 phones** on the snapshot even though nothing renders it. It is
  aggregate data published only after the question is over, so it leaks nothing — but it is a field
  on the wire with no visible consumer until S-07 or a later slice wants one.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Tally storage

#### Automated

- [x] 1.1 Type checking passes: `bun run type-check` — 73cdce9
- [x] 1.2 Test suite passes: `bun run test` — 73cdce9
- [x] 1.3 `keys.test.ts` passes with the new key registered, and still fails if the literal is moved out — 73cdce9
- [x] 1.4 `store.test.ts`: increments exactly once per accepted answer and per selected option — 73cdce9
- [x] 1.5 `store.test.ts`: no increment on any rejection path — 73cdce9
- [x] 1.6 `store.test.ts`: `readAnsweredCount` and `readQuestionTallies` each return zeros vs `null` — 73cdce9
- [x] 1.7 `tallies.test.ts`: field formats and non-collision — 73cdce9

#### Manual

- [x] 1.8 A single local answer leaves exactly the expected fields in `livequiz:tallies` — 73cdce9

### Phase 2: The participation endpoint

#### Automated

- [x] 2.1 Type checking passes: `bun run type-check` — d414ed4
- [x] 2.2 `participation.test.ts`: 200 with the correct count, echoing the requested `questionId` — d414ed4
- [x] 2.3 `participation.test.ts`: 401 without and with a wrong secret; 400 for absent, empty and unknown `questionId` — d414ed4
- [x] 2.4 `participation.test.ts`: the 200 body's key set is exactly `questionId`, `answered`, `playerCount` — d414ed4
- [x] 2.5 Test asserting the handler calls no write path — d414ed4
- [x] 2.6 `keys.test.ts` still passes — d414ed4

#### Manual

- [x] 2.6 `curl` without the secret returns 401; with it returns the count — d414ed4
- [x] 2.7 Answering from one phone raises the number the next `curl` returns — d414ed4

### Phase 3: Distribution on the snapshot

#### Automated

- [x] 3.1 Type checking passes: `bun run type-check` — 6607141
- [x] 3.2 `state.test.ts`: non-null distribution refused outside `question-revealed`, accepted in it — 6607141
- [x] 3.3 `state.test.ts`: a document written without the field still parses — 6607141
- [x] 3.4 `host.test.ts`: an async `nextFrom` is awaited, and a rejected one does not commit — 6607141
- [x] 3.5 `routes.test.ts`: reveal publishes the distribution; start and advance publish it null — 6607141
- [x] 3.6 `routes.test.ts`: a reveal whose tally read fails still succeeds and publishes `null`, not `{ answered: 0 }` — 6607141
- [x] 3.7 `routes.test.ts`: revealing a non-choice question publishes the distribution as `null` — 6607141
- [x] 3.8 Full suite passes: `bun run test` — 6607141

#### Manual

- [x] 3.8 Across start → advance → reveal → advance, the field is null everywhere but the revealed step — 6607141

### Phase 4: The host view

#### Automated

- [x] 4.1 Type checking passes: `bun run type-check` — 933bdd1
- [x] 4.2 `boundary.test.ts` passes for the new `<script>` block — 933bdd1
- [x] 4.3 `render.test.ts`: bar order, counts, shares, correct marking — 933bdd1
- [x] 4.4 `render.test.ts`: `answered: 0` renders without dividing by zero — 933bdd1
- [x] 4.5 `render.test.ts`: multiple-choice shares summing past 100% render unnormalized — 933bdd1
- [x] 4.6 `render.test.ts`: option text is never interpreted as markup — 933bdd1
- [x] 4.7 Full suite passes: `bun run test` — 933bdd1

#### Manual

- [x] 4.8 Two devices: count rises without interaction; no distribution during `question-open` — 933bdd1
- [x] 4.9 Network drop freezes the count with a staleness marker and it resumes — 933bdd1
- [x] 4.10 At reveal, bars appear with the correct option marked and counts matching — 933bdd1
- [x] 4.11 Legible from the back of a room; the panel does not push the prompt off screen — 933bdd1
- [x] 4.12 A refused question kind shows no panel rather than a stuck zero — 933bdd1

### Phase 5: Verification and cost

#### Automated

- [x] 5.1 Full suite passes: `bun run test` — 4531793
- [x] 5.2 Type checking passes: `bun run type-check` — 4531793
- [x] 5.3 `bun audit` reports no new advisories — 4531793
- [x] 5.4 `bun run build` succeeds — 4531793
- [x] 5.5 `bun run quiz:rehearse`: 150/150 accepted, zero lost or doubled writes, both tally findings ok
- [x] 5.6 `bun run quiz:check-purge` reports no residue, including the new key

#### Manual

- [x] 5.7 Command counter read before and ≥90 minutes after, delta attributed to the predicted model
- [x] 5.8 Cost report, runbook update and contract note written and consistent
- [x] 5.9 Full stage rehearsal read from a distance
