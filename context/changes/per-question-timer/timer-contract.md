# Timer contract (S-11)

> Read before adding a clock, a deadline, a scheduled transition, or anything that refuses a
> submission. One page, like the nine before it — a contract that grows past one has become a
> second copy of the plan, and a second copy can disagree with it.

## The deadline is derived. Nothing stores it

`deadline = session.updatedAt + question.timeLimitSeconds`. There is **no `SessionState` field,
no key in the session namespace, no Ably message and no new polling loop.** During
`question-open` the document's `updatedAt` already *is* the moment the question opened, and
every device already holds both halves — the timestamp on the snapshot, the limit on
`publicQuiz`. A stored deadline would be a fourth kind of state field, needing its own
`superRefine` clause and its own back-compat default, to hold a number two subtractions
already give you.

**This is why there is no host override, and the reason is not ergonomics.** Extending a
deadline means writing the session document while a question is open, which moves `updatedAt`
— and `updatedAt` is also the upper bound `clampElapsed` measures every award against. One
write would both inflate every award after it and hand the room extra time nobody granted,
with nothing on any screen to say either had happened. The two polled host routes are held
read-only by source scans for the first half of that reason; S-11 gave it a second.

## The cutoff reads server values only

`isSubmissionExpired(now, session.state.updatedAt, question)` — the route's clock and the
store's document. **The attendee's `elapsedMs` must never enter it.** That field is
attacker-controlled by design (`answer-contract.md` records the accepted risk), so a cutoff
consulting it is one any phone opts out of by claiming it answered sooner. Two tests in
`answer.test.ts` come at this from both sides — a submission that omits the field, and one
claiming zero — and both must stay red if the cutoff ever reads the client.

## The visible clock and the enforced clock differ by a grace the client never learns

The countdown empties at `updatedAt + limit`. The refusal fires `SUBMISSION_GRACE_MS` (2 s)
later, so an answer already crossing a venue network is not lost — the PRD calls losing a
submitted answer the most expensive requirement it has.

**The grace must never travel.** A phone that knew about it would show a clock that lies in
the generous direction, and the honest reading of a countdown is "send now or don't".
`public.ts`'s allowlist test is what keeps it off the wire.

## Two clocks, different jobs. Merging them is a bug

| | The cutoff (S-11) | The speed weight (FR-019) |
| --- | --- | --- |
| Measured from | the host's advance, shared by the room | each device's own first paint |
| Owns | when answering closes | what an answer is worth |
| Lives in | `src/lib/session/deadline.ts` | `src/lib/session/scoring.ts` |

The cutoff is shared so one clock is true for everyone and the projector cannot disagree with
a phone. The reward is per-device so a slow connection costs no points — the trap the roadmap
records as retired, and the reason devices on the connection fallback (~6 s behind by design)
are not punished for it. **Coupling `windowMs` to `timeLimitSeconds` would change every award
on every question and retire the documented 2× spread.** `SPEED_WINDOW_MS` stays 20 s and
stays global.

One consequence, accepted: on a question whose limit is close to 20 s the speed floor is only
reachable in the last few seconds. That is why every authored limit sits at or above the
window, and why a shorter limit is legal but documented as a tradeoff rather than an error.

## Unscored questions have no clock

The schema **requires** `timeLimitSeconds` where `points !== null` and **refuses** it where
`points === null`. Keyed on `points`, never on `kind`, so marking a question unscored is
enough to take its clock away. The word cloud therefore still fills until the host reveals it,
exactly as the runbook describes — and both views key the clock's visibility on the limit's
presence rather than on a phase or kind list, because the schema owns that rule and a list in
a view is a copy that falls behind.

## The countdown timer is not the poll loop

`host.test.ts`'s one-loop guard used to assert `occurrences("setTimeout") === 1` — a *shape*.
The property is narrower: **one timer that fetches**, so there is one backoff, one in-flight
flag, and one thing able to spend commands for a panel nobody is watching. A countdown
touches no endpoint and cannot appear in the runbook's command tripwire, which is a polling
detector.

The guard now states that property directly and is verified in both directions. Adding a
second *painting* timer is allowed; a second *fetching* one still fails. **Do not "simplify"
it back to a raw count** — the only way to fit a countdown under the old form was to weaken it
to `=== 2`, which protects nothing.

`index.test.ts` is new and does the same job for the attendee page, which had no structural
guard before this slice.

## Expiry is enforced, never fired

There is no scheduler on this platform — no cron in `vercel.json`, no queue, no worker — and
every transition in this system is an authenticated host request. Nothing happens *at* the
deadline: the next submission is refused, and the question stays open on screen until the host
acts. **`/api/quiz/answer` is the only place that decides**, deliberately not the
`SUBMIT_ANSWER` Lua: the script re-checks *phase* because the host can advance between the
route's read and the script's run, whereas a deadline can only be crossed by time passing and
the grace absorbs that — and the redis client is mocked throughout the suite, so a branch
there would be the least verifiable place for this rule.

## The refusal is its own class

`409` with `refusal: "expired"`, a Polish message distinct from `notOpen`, and its own
`rejection` class in the closed log union. **It is not `rejected` on the client.** That path
calls `markSubmitted`, which decides whether a result panel appears at the reveal and whether
the note reads "Odpowiedź zapisana" — both of which would then describe an answer the store
has never seen. `index.test.ts` asserts the expired branch never marks the question.
