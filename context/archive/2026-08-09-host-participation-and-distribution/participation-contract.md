# The participation contract (S-04)

The fifth contract, after spine, retention, join and answer — and, like them, **a pointer rather than
a second copy of the plan**. What is here is what a later slice can break without noticing.

## The two-payload rule, and what enforces it

PRD FR-005 was revised during shaping because these cannot be the same payload:

- **How many have answered** — safe while the question is open. It is a count of people, not of
  choices, and it tells nobody what to pick.
- **What the room chose** — a cheat sheet, if it appears before the question is over. Anyone who
  glances at the projector sees where the room is going and follows it.

So they travel by two routes gated by two mechanisms:

| | Route | Gate |
| --- | --- | --- |
| Count | `GET /api/quiz/host/participation`, polled by the host page | host secret; scoped to `question-open` |
| Distribution | `SessionState.revealedDistribution`, on the published snapshot | the schema's `superRefine`, which refuses a non-null value outside `question-revealed` |

**The separation is structural, not a matter of the route remembering to drop a field.** `store.ts`
exposes two functions — `readAnsweredCount` and `readQuestionTallies` — and the endpoint calls only
the first. There is no shape in which per-option data could reach it. A single function returning
both, with the handler trimming its response, would leave the whole slice's reason for existing
resting on one line in a route, and the failure would be invisible because the screen would still
look right.

`participation.test.ts` asserts this against the route's own source, not against a response body.

## Three snapshot fields, and which side each is on

`playerCount`, `revealedOptionIds` and `revealedDistribution` sit adjacent in `state.ts` and split
two-to-one:

- `playerCount` is **decoration on a transition**. A stale value costs nothing, so `applyHostAction`
  overwrites it for every action and the state constructors merely copy it.
- `revealedOptionIds` and `revealedDistribution` are **part of** a transition. Both are set by
  `reveal.ts` alone and nulled by every other transition.

**Putting the distribution on `playerCount`'s side is the forbidden shape.** Injecting it in
`applyHostAction` would attach it to every action — including the `advance` that opens the next
question — publishing the previous question's bars to 150 devices while that question is being
answered. That is the exact leak FR-005 was revised to prevent, and on screen it would look correct.

The one place the two reveal-only fields diverge: for a non-choice kind, `revealedOptionIds` is `[]`
(a fact — no options are correct) while `revealedDistribution` is `null` (an absence).

**A failed tally read publishes `null`, never `{ answered: 0, options: {} }`.** Zeroes render as
every bar empty, which on a projector is the claim "nobody answered", made to a room that just
answered. The reveal itself still succeeds — it is the beat that must not break — and
`revealedOptionIds` still marks the correct answer, so FR-016 is unaffected.

`nextFrom` became awaitable (`host.ts`) for this one caller. That is why.

## The poll reads and must never write

`src/pages/api/quiz/answer.ts` carries a warning written before this slice existed: during
`question-open`, the session document's `updatedAt` **is** the moment the question opened, and it is
the upper bound the speed clamp measures every award against. It names "a live participation count,
say" as the change that would silently shorten it.

So the endpoint is a `GET` that touches neither `writeSession` nor `applyHostAction`. A host-side
write mid-question would move `updatedAt` forward and inflate every award after it, with nothing
anywhere to report that scoring had changed. **This is the single most important constraint in the
slice**, and it is asserted by a source scan rather than left as a comment.

### The one sanctioned polling loop

Nothing else in this project polls, and the runbook's command tripwire is described there as a
polling detector rather than a budget. This is the exception, and it is bounded so the detector still
works:

- **one device** — the host page, never an attendee's
- **only while a choice question is open** — one predicate governs both the panel and the poll, so
  the loop cannot run for a kind whose panel is hidden
- **~2.5 s**, doubling to a ~20 s ceiling on failure and resetting on recovery

A `401` is **not** treated as a failure and does not back off: the ordinary cause is a host who has
not yet typed the secret, which is the first thirty seconds of every session. It reports through the
page's message line and retries on the next keystroke in the secret field.

On any other failure the count **keeps its last value and shows a staleness marker** — never zero.
`readPlayerCount`'s discipline: on a large screen a number that drops to zero reads as the room
having left.

## The new key

`livequiz:tallies` — `answered:<questionId>` and `opt:<questionId>:<optionId>`, formats owned by
`tallies.ts`.

**It is the first registered key that is not attendee data.** Aggregate counts over a 150-person room
identify nobody, and no field is keyed by a player id or a name. It is registered and purged anyway,
because **the registry has no exemption list** — an invariant with one is an invariant that rots, and
the cheapest way to keep "every namespaced name is in `keys.ts`" true is to keep it true without
exceptions. See `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`.

Counted at submission rather than derived at read time: the answers hash reaches ~1,500 fields by the
last question, so deriving would trade a bounded per-submission cost for an unbounded per-read one —
on the one read this slice intends to poll.

**The increments sit below the `HSETNX`**, so they inherit the atomicity that makes the first answer
final and a rejected duplicate cannot double-count. Above it, they would count a submission the lock
then rejects.

## Accepted risks

- **Cost.** Predicted ~32.4k per event against ~26.8k before; ten events a month at ~65% of the 500K
  ceiling, up from ~54%. The prediction is unverified until the counter reading in
  `participation-cost-report.md` is taken. S-05 through S-08 each add per-attendee paths on top of
  this one, and the next slice to raise it should say so deliberately.
- **The projector poll is unmeasured under venue conditions.** One device, so the risk is a frozen
  number rather than a room-scale failure, and the backoff bounds it.
- **A one-answer drift at reveal.** The tally read sits outside the version guard, so an answer
  landing between it and the compare-and-set is in the hash but not in the published distribution.
  Accepted and documented, not eliminated — the same asymmetry `playerCount` already carries: the
  count needs no serialization, the version does.
- **The distribution reaches 150 phones** on the snapshot even though nothing renders it there. It is
  aggregate data published only after the question is over, so it leaks nothing — but it is a field on
  the wire with no visible consumer until a later slice wants one.
- **Counter drift under real concurrency is invisible to the test suite.** The increments are inside
  the Lua; `store.test.ts` can only assert structurally. `scripts/rehearse-room.ts` carries the two
  findings that check the tallies against the answers hash under 150 simultaneous submissions, and it
  is the only place that can.
