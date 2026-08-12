# Leaderboard beat (S-07) — Plan Brief

> Full plan: `context/changes/leaderboard-beat/plan.md`

## What & Why

The host needs a beat between questions that puts the standings on the large screen, and every
attendee needs to find themselves on the same standings (PRD FR-014, US-01, US-02). It is the last
must-have mechanic before the closing sequence, and S-10's winner reveal names it as a prerequisite.
It also takes a decision three earlier artifacts deliberately parked here: **how display names reach
150 screens.**

## Starting Point

The store already holds everything the ranking needs, in two hashes and with no new key:
`livequiz:scores` (player id → integer total) and `livequiz:players` (folded name →
`{ id, displayName, joinedAt }`, whose record carries its own id). What does not exist is a phase in
which a board is the thing on screen, a host verb beyond the existing five, or any store read that
returns more than one player's data — every read today is either an aggregate or scoped to the calling
device.

## Desired End State

After revealing a question, the host taps **Pokaż ranking** and the projector switches to a five-row
board — position, name, points. Every phone shows the same five rows in the same order, the attendee's
own row highlighted if they are on it, and a line below reading their own position and total whether
they are on it or not. The host taps **Następne pytanie** and the next question opens.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| How names reach the room | Top 5 published on the snapshot | One publish, zero per-device store commands, and every device reads the same bytes — the no-divergence guardrail holds by construction. Degraded devices polling `/api/quiz/state` get it free | Plan |
| State model | A fifth phase, `standings` | Both views already branch on phase; matches how `ended` was added as a real phase rather than an absence | Plan |
| Does standings keep `currentQuestionId`? | Yes — it is **not** questionless | A questionless phase makes `nextQuestionId(null)` return question 1, so advance would reopen the quiz. Keeping it leaves `advance.ts` untouched | Plan (from `advance.ts:30`) |
| Self-location off the board | Own rank on the existing `/api/quiz/result` | Reuses a route, a gate and a client path that all exist; returns only the caller's own numbers | Plan |
| Board size | 5 | Legible from the back of the room at the type size `MAX_DISPLAY_NAME_LENGTH=24` was chosen for; bounds the published names | Plan |
| Row order vs rank number | Order by `points desc, joinedAt asc, id asc`; rank is a competition rank (ties share a number) | Order must be total so the server's output is reproducible; rank must derive from score alone, because the per-device path has only the scores hash. Merging them shows a tied 2nd-place attendee "1" on their phone and 2nd on the projector | Plan |
| Zero-score players | Ranked at 0 and counted | Makes the board's denominator equal the `playerCount` already on the same screen | Plan |
| Failed board read | Refuse the transition, room stays on the reveal | The board **is** this phase's content, so completing would put a blank screen in front of the room — unlike `reveal.ts`, where a null distribution still leaves the answer visible | Plan |
| Rank storage | Derived, no new key | A `livequiz:standings` map would be cheaper per read but adds an attendee-data key, a purge surface, and a second thing that can disagree with the published board | Plan |
| What rows carry | `displayName`, points, rank — never `playerId` | Publishing the leaders' ids makes impersonating them trivial; `players.ts:120` says each scoring slice must re-take that claim | Plan |
| Recording the reversal | PRD Deviation 2 amendment + risk row + `leaderboard-contract.md` | The prior artifacts hand the decision here and expect it recorded; the expectation and its reversal both stay visible | Plan |

## Scope

**In scope:** the `standings` phase and its snapshot payload · a pure `standings.ts` ranking module ·
`readStandings` / `readOwnRank` · `POST /api/quiz/host/standings` · a third branch in `result.ts` · the
host board and control · the attendee board and personal line · the retention record-keeping.

**Out of scope:** the final winner reveal and any `ended`-phase board (S-10) · animation and
rank-change indicators · a room-scale rehearsal re-run · a host-only preview before showing · name
moderation · any new store key.

## Architecture / Approach

The board is computed **once, server-side, at the host action** and published on the snapshot — that is
what makes "no divergence in standings between devices" structural rather than agreed. No device sorts
anything. The personal rank travels the other way, per device, through the route that already has the
phase gate and the client fetch path.

This is the split S-03 established: content the whole room may see rides the broadcast; per-player data
is fetched by the player. What is new — and why it needs a recorded decision — is that five display
names are now in the first category, inside Ably's measured ~2-minute retention window.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Domain core | The phase, the payload and its invariants, the pure ranking module, the `reveal` guard | Getting the phase into `QUESTIONLESS_PHASES` — which silently makes advance reopen question 1 |
| 2. Store and routes | Two reads, the host verb, the personal-rank branch | The read-failure path; a route that transitions anyway leaves a blank projector |
| 3. Host view | The control and the projector board | Legibility at the back of the room; a wrapping name breaks the five-row layout |
| 4. Attendee view | The board and the personal line on 150 phones | A tied top-five attendee whose line disagrees with their own highlighted row |
| 5. Contracts | PRD amendment, risk row, slice contract, runbook, roadmap | Only that it gets skipped once the feature works |

**Prerequisites:** S-03 (delivered). Nothing else — the store, the client convention and the host
action pipeline are all in place.
**Estimated effort:** ~2–3 sessions across 5 phases; phases 1–2 are the bulk, 5 is short.

## Open Risks & Assumptions

- **Five display names are now readable for ~2 minutes by anyone holding a subscribe token**, and
  `/api/quiz/token` is deliberately open. Accepted, bounded, and recorded in Phase 5 — but it is a real
  reversal of a position S-02 took cleanly.
- Ties are rare (FR-019's speed component makes identical totals nearly impossible) but not
  impossible, and the tie path is the one place the projector and a phone could disagree. It is
  handled by design, and it is the case most worth testing deliberately.
- The store's command counter has an unexplained baseline two orders of magnitude above what the code
  accounts for (`command-counter-diagnostic.md`). This slice adds ~600 commands a segment, which is
  negligible against it — but "negligible against an unexplained number" is an assumption, not a
  measurement.
- No CI: everything between this commit and production is `bun run test` and `bun run type-check` run
  by hand.

## Success Criteria (Summary)

- The host can show the standings after any reveal, and advancing from the board opens the **next**
  question.
- The five rows and their order are identical on the projector and on every phone.
- Every attendee sees their own position — on the board if they are on it, and by name below it if not
  — including a device that never answered.
