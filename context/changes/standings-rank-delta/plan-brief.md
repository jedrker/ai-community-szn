# Standings rank delta — Plan Brief

> Full plan: `context/changes/standings-rank-delta/plan.md`

## What & Why

The leaderboard tells the room who is winning but not what just happened. Each row gains **how many
places that player moved since before the last question** — `▲3` in mint, `▼1` in signal red — so the
board reads as a contest in motion rather than a snapshot. Nothing is shown where nothing moved.

## Starting Point

`buildStandings` computes positions from current totals alone, through `rankOf`, which is also what
numbers a single device's own position — one shared function, deliberately, so a tied attendee's
phone cannot contradict the projector. No previous board survives anywhere: `SessionState.standings`
is nulled by every transition that is not the standings beat or the close.

## Desired End State

When the host shows the leaderboard, every row that moved carries an arrow to the right of its
points, identical on the projector and on every phone. A row that did not move, a player who had no
points before the question, and a board whose baseline read failed all render the same empty cell.
The closing screen is untouched.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Baseline | State before the last question, **derived** as `total − awarded` | `SUBMIT_ANSWER` increments the scores hash by exactly `awarded`, so the subtraction is exact — and no new Redis key means no new retention surface. |
| Where it shows | Projector top 5 + phone top 5 | The phone rows ride the same snapshot through the same renderer, so it is free; the own-position line would need a second computation path. |
| What is published | `delta: number \| null` on the row | The client must have nothing left to compute — the same rule that forbids `renderStandings` from sorting. |
| Zero baseline | A player whose previous total is 0 gets no arrow | Everyone ties at position 1 before question 1, so the naive rule would show the first board's top five all *falling*. |
| No movement | Empty cell, no marker | Silence where there is nothing to say; a dash on three of five rows is noise on a projector. |
| Baseline read fails | Publish the board without arrows | The arrows decorate the beat, the board *is* it — refusing the transition over an ornament leaves a blank projector. |
| Form & placement | `▲N` / `▼N`, right of the points | Direction and magnitude both readable from the back of the room; the right edge leaves the measured left columns alone. |
| Colour | Existing `quiz-mint` / `quiz-signal` | The palette's correct/incorrect pair already exists; the triangle carries direction so colour is never the only channel. |
| Closing screen | No delta | The winner's row is a 224px name with the rank hidden — a delta has nowhere to sit, and `end.ts` already reads its board with no arguments. |
| Testing | Unit + host-path guards, no E2E | E2E here runs against real Upstash and would need a seeded two-question session; the visual half is manual anyway. |

## Scope

**In scope:** the row schema and `buildStandings`; an optional `questionId` on `readStandings` and
the `HMGET` behind it; a new degraded-log event; the standings route; `renderStandings`; both views'
grid and colours; the runbook line; the two `CLAUDE.md` edits.

**Out of scope:** any new Redis key; the closing screen; the attendee's own-position line; row-reorder
animation; an "unchanged" marker; E2E.

## Architecture / Approach

```
answers hash ──HMGET(qid:playerId)──┐
scores hash  ──HGETALL──────────────┼─→ previousTotals ─┐
players hash ──HGETALL──────────────┘                   ├─→ buildStandings ─→ rows[].delta
                                     scores ────────────┘        (rankOf ×2)
                                                                      │
                                          SessionState.standings ─────┴─→ Ably ─→ projector + phones
                                                                                    renderStandings
```

Every decision lands in the pure layer. The store reconstructs previous totals, `buildStandings`
turns them into a delta through the same `rankOf` that produced the current rank, and the views paint
what arrives. The awards read sits in **its own** `try`/`catch` — that separation is the degradation
rule: an awards failure costs arrows, a players-or-scores failure still refuses the transition.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Pure layer | `StandingsRow.delta`, the zero-baseline rule | The sign is inverted (rank numbers shrink as you climb) and looks plausible on screen |
| 2. Store + route | Baseline reconstructed from one `HMGET` | Degrading where it should refuse, or refusing where it should degrade |
| 3. Renderer | Fourth span, glyphs, motion signature | An absent span collapses the grid column and shifts names between boards |
| 4. Views | Grid column, colours, runbook | Mint on the leader's yellow bar — the invisible-figure defect impl review F1 already caught once |

**Prerequisites:** none — no schema migration, no new key, no new dependency.
**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- Assumes `awarded` on the answer record always matches what the scores hash was incremented by.
  True by construction today (one writer, one Lua script), and a divergence could only come from
  store corruption — where the plan clamps at 0 rather than producing negative ranks.
- The first board of every session will carry no arrows. Intended, but it is the moment a host is
  most likely to report the feature as broken; hence the runbook line.
- A question that awards nothing (a word cloud) produces an entirely arrow-free board. Honest, and
  covered by the same runbook line.

## Success Criteria (Summary)

- The room can see, at a glance, who climbed and who slipped after each question.
- The projector and every phone show the same arrows, always.
- No board is ever refused, blank, or wrong because the movement could not be computed.
