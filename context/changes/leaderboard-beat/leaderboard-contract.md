# Leaderboard contract (S-07)

Fourth after `spine-contract.md` (F-02), `retention-contract.md` (F-03) and `join-contract.md` (S-02),
and it inherits their warning: **a contract that grows past a page has become a second copy of the
plan, and a second copy can disagree with it.** A pointer, not a summary.

Read before S-08 or S-10 adds a snapshot field, a phase, or anything that renders the board.

## Names are published now. The bound is five, and the id is not included

`SessionState.standings` carries at most `STANDINGS_SIZE` (5) rows of `{ rank, displayName, points }`.
This is the first attendee display name this project has ever put on the wire, reversing the position
S-02 took cleanly — recorded in the PRD's retention guardrail, Deviation 2, and in
`infrastructure.md`'s Ably-retention row.

**No player id is on a row, and that is a security property rather than a saving.** `players.ts` says
each scoring slice must re-take the "not a secret" claim rather than inherit it; publishing the ids of
the five most impersonation-worthy attendees in the room is not a re-taking anyone could defend. A
device recognises its own line by **exact `displayName` match** — safe because names are unique by fold
(FR-008) and `localStorage` holds the string the server returned. Folding client-side is impossible
anyway: `normalizePolish` lives in `src/quiz/` and `boundary.test.ts` refuses that import.

**The exposure is `GET /api/quiz/state`, not Ably's ~120 s floor.** The planning for this slice reasoned
only about the retention floor and was wrong; implementation review caught it. That route is
deliberately unauthenticated and returns the whole document, so the five names are readable by anyone
with the attendee URL for as long as the host leaves the board up. Accepted — the board is on a
projector while it is readable — and *not* fixed by stripping the field from that route, because a
device on the connection-limit polling fallback would then see a standings phase with no board.

## Row order and rank number are computed by different rules. Merging them is a bug

| | Rule | Why |
| --- | --- | --- |
| **Order** | `points desc, joinedAt asc, id asc` — a total order | A partial order leaves ties to hash iteration order, so two devices could render the same standings differently. Nothing catches that: each screen looks right and only disagrees with the other. |
| **Rank number** | Competition rank: `1 + count(totals strictly greater)`, so ties share a number | It must be derivable from totals alone, because the per-device path (`/api/quiz/result` → `readOwnRank`) holds only the scores hash. A positional rank is not computable there. |

Both paths call **one function**, `rankOf` in `standings.ts`. That shared call is the only reason a
player tied for second cannot read "2" on the projector and "1" on their own phone. `buildStandings`
numbers its rows through `rankOf` rather than through the index it already has, for exactly this reason.

**No client sorts.** `renderStandings` paints the order it is given; its test fixture is deliberately
*not* in points order, because a sorted fixture makes a sorting renderer pass.

**One known gap, accepted:** `readStandings` ranks against players whose record parsed, `readOwnRank`
against the raw scores hash. A corrupt player record whose score is intact and high therefore counts on
phones and not on the projector. Closing it means a per-device players-hash read, doubling the cost of
the densest attendee path to defend against a state only store corruption can reach.

## The `standings` phase keeps `currentQuestionId`. Do not make it questionless

It is **not** in `QUESTIONLESS_PHASES`, and that is load-bearing. A questionless phase carries
`currentQuestionId: null`, and `nextQuestionId(null)` returns question 1 — so `advance` from the board
would reopen the quiz from the start, mid-segment, with the store and the schema both satisfied.
`advance.ts:30` guards `ended` against precisely this. Keeping the id means `advance` needed **no
change at all**: it reads the question the room just finished and opens the one after it.

The id means "the question we have just been through", not "the question that is open".
`state.test.ts`'s "rejects a standings phase with no question" is the tripwire.

Consequence: `reveal` needs an explicit refusal from this phase. Without one, a standings state reaches
the builder with everything needed to produce a valid `question-revealed` document and silently
re-reveals a finished question.

## The field is a transition payload, not decoration

`standings` sits with `revealedOptionIds` / `revealedDistribution` / `revealedAnswerText`, **not** with
`playerCount`. Set by `standings.ts` (the route) alone; nulled by every other constructor; two
`superRefine` clauses — no board outside the phase, and no phase without a board. Injected in
`applyHostAction` beside `playerCount`, where "aggregate fact about the room" pattern-matching would put
it, it would leave one beat's board on 150 phones under the next question.

It carries `.default(null)` like its four siblings, or a document written before the deploy fails to
parse and 409s the host's next action mid-segment.

**Unlike the three reveal fields, this one is required non-null in its own phase.** They decorate a
reveal that means something without them; here the board *is* the phase, so the route refuses the
transition when the store cannot answer rather than publishing a blank projector.

## Two numbers that must agree, and where they come from

The attendee's "position N of M" takes **M from the snapshot's `playerCount`**, not from the board's own
count. The board carries one, taken in the same read as the rows, and using it looks more consistent —
that was the first implementation and it was wrong: the host screen renders the snapshot's field, which
`applyHostAction` refreshes afterwards, so the two differ when a join lands between the reads. Phones
reading "z 149" beside a projector reading "150" is the divergence the guardrail is about.

## Cost, honestly

Per beat: **two** commands for the host action (`readStandings` is two `HGETALL`s through `Promise.all`,
deliberately not an `EVAL` — Upstash bills the script *and* every call inside it), plus **five per
device** that fetches its rank. `result.ts` reads the session document to apply the phase gate before it
can know to compute a rank, and that read is the `READ_ANSWER` EVAL at four billed commands; the rank
adds one. ~750 a beat, ~3,000 a four-beat segment. The plan first recorded ~150 and ~600; the 5× error
was caught in review and accept-and-record was chosen over optimising, because the absolute figure is
negligible — against an unexplained command baseline, which makes "negligible" an assumption.

## Scope boundary

Not here: the final winner reveal and any board in the `ended` phase (**S-10 inherits both** — the
`ended` branch of `result.ts` still serves the running total alone) · animation and rank-change
indicators · a room-scale rehearsal re-run · a host preview before showing · name moderation · any new
store key (rank is derived, not stored, so `end`, `purge` and `check-purge-residue.ts` needed no change).

## Pointers

`spine-contract.md` · `retention-contract.md` · `join-contract.md` (the decision this slice was handed)
· `command-counter-diagnostic.md` (the unexplained baseline) · `reviews/impl-review.md` (ten findings;
F1 is the exposure correction above, F7 the accepted gap)
