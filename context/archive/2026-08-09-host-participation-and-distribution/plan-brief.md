# Host participation and distribution (S-04) — Plan Brief

> Full plan: `context/changes/host-participation-and-distribution/plan.md`

## What & Why

Give the large screen the two figures FR-005 asks for: how many attendees have answered the open
question, rising live, and what the room chose, once the host reveals. The FR was **revised during
shaping** because these cannot be one payload — a distribution on the projector while answering is
open is a cheat sheet for anyone who glances up. So they travel by two different routes, gated by two
different mechanisms.

## Starting Point

S-03 delivered answering and reveal, but nothing counts. `livequiz:answers` is one hash keyed
`<questionId>:<playerId>` and reaches ~2,100 fields by the last question, so there is no cheap way to
derive a per-question or per-option count from it. The host view is already the large screen — phase,
join count and version at projector scale — and its join count is refreshed only by a manual button.
Nothing in this project polls; the runbook's command tripwire is explicitly described as a polling
detector.

## Desired End State

While a question is open the projector shows a rising `answered / joined` figure that needs no
interaction and holds its last value through a network blip rather than collapsing to zero. At reveal
the same area becomes one bar per option — count and share — with the correct option marked. Nothing
about the distribution is visible, or fetchable, before the host reveals.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Tally source | Counters written inside the submission `EVAL` | O(1) reads and no large payloads; inherits the `HSETNX` atomicity that makes the first answer final |
| Read split | Two functions: `readAnsweredCount` (poll) and `readQuestionTallies` (reveal) | The poll path is structurally incapable of returning per-option data — the leak rule is enforced, not remembered |
| Count freshness | Host page polls, scoped to `question-open` | One device polling, not 150; the manual button is the opposite of the energy the FR exists to create |
| Distribution transport | A reveal-only field on the snapshot | Reuses the discipline and the schema gate `revealedOptionIds` already has, on a broadcast that already happens |
| Audience | Large screen only | FR-005 is about the projector; the attendee reveal layout is S-03's and stays put |
| Unanswerable kinds | Panel hidden | A stuck `0 / 150` on a free-text question reads as a broken quiz from row three |
| Count presentation | `answered / joined` | A denominator is what makes the number legible at distance and creates the closing-window pressure |
| Poll failure | Hold last value, mark stale, back off | Mirrors `readPlayerCount` returning `null` not `0`; a zero reads to the room as everyone having left |
| Surface | `/quiz/host` as it is | One page to open on stage; a second view is a second thing to keep in step with every later slice |
| Endpoint auth | Host-secret gated | `/api/quiz/state` is open because it returns only what is already broadcast — an answered count is not |
| Verification | Units plus a 150-client harness run | Counter drift under concurrency is invisible to a mocked test |
| Cost | Accept and document | Keeps the O(1) reads; recorded as an explicit accepted risk with the runbook updated |

## Scope

**In scope:** a registered tallies hash; increments inside `SUBMIT_ANSWER`; a host-gated
participation endpoint; `revealedDistribution` on the session schema with its gate; an async
`nextFrom` so `reveal.ts` can read tallies; the host-view panel, poll loop and bars; harness tally
checks, a cost report, runbook and contract updates.

**Out of scope:** distribution on attendee phones; a separate projector view; the live word cloud
(S-08); the leaderboard (S-07); participation for free-text/number/word-cloud kinds; throttling
beyond the secret gate; any change to scoring.

## Architecture / Approach

Three deliberately separate mechanisms. Tallies are **written where the write already happens** —
inside the submission script, after the `HSETNX` — so a rejected duplicate cannot double-count. The
open count is **pulled** by the one host device from a `GET` endpoint that reads two hash fields and
writes nothing. The distribution is **pushed** on the snapshot, set only by `reveal.ts` and refused by
the schema anywhere but `question-revealed`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Tally storage | Registered key, field helpers, increments, two separate read functions | An increment above the `HSETNX` would count rejected duplicates |
| 2. Participation endpoint | Host-gated `GET`, 2 commands a poll | An absent `questionId` falling back to a count instead of a 400 |
| 3. Distribution on the snapshot | Schema field + gate, async `nextFrom`, reveal reads tallies | Setting it in `applyHostAction` publishes the previous question's distribution |
| 4. Host view | Panel, poll loop with backoff, bars with correct marked | Legibility at projector scale; a zeroing count on a blip |
| 5. Verification and cost | Harness tally checks, cost report, runbook, contract | A command-counter reading taken too soon looks settled and is not |

**Prerequisites:** S-03 (done). Upstash and Ably credentials pulled locally, and a production URL for
the harness — preview URLs 302 to Vercel SSO, so simulated devices cannot reach one.
**Estimated effort:** ~2–3 sessions across 5 phases; Phase 5 needs a ≥90-minute wait before the
counter reading is trustworthy.

## Open Risks & Assumptions

- Cost: an event goes from ~26.8k to ~32.4k commands; ten events a month from ~54% to ~65% of the
  500K ceiling. Counted over the 10 answerable questions of the 14, since the answer route refuses
  the other four kinds. A prediction until Phase 5 measures it. Accepted, but S-05 through S-08 each
  add per-attendee paths on top of this one.
- The poll is unmeasured under venue conditions. One device, so the failure is a frozen number, and
  the backoff bounds it.
- A one-answer drift between the tally read and the compare-and-set at reveal — accepted, documented,
  not eliminated.
- The distribution reaches 150 phones with nothing rendering it. Aggregate, post-reveal, so it leaks
  nothing — but it is a field on the wire with no visible consumer.
- Rollback orphans the tallies key — the previous commit's registry does not contain it, so `purge`
  would not reach it. It self-clears on its 4-hour TTL and holds only aggregate counts, so this is a
  verification step: `bun run quiz:check-purge` scans the real store and should follow any rollback.

## Success Criteria (Summary)

- From the back of the room, the count visibly rises while a question is open, with no one touching
  the host page.
- No distribution is visible on any screen, or obtainable from `/api/quiz/state`, before the reveal.
- At reveal the bars match what was actually submitted, with the correct option marked.
