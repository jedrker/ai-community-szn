# Attendee answers a choice question and learns their result — Plan Brief

> Full plan: `context/changes/answer-choice-question-and-reveal/plan.md`

## What & Why

Roadmap **S-03**, the north star of the LiveQuiz change. An attendee taps an answer to a single- or
multiple-choice question on their phone, and when the host reveals, sees whether they were right and
how many points they earned — including a speed component measured from when the question appeared on
their own device (FR-010, FR-016, FR-019). This is the slice that turns a room which is merely
connected into a room that is playing, and it carries the project's first domain rule.

## Starting Point

S-02 shipped a room that joins and follows the host: an atomic name claim, a version-ordered snapshot
spine, a `playerCount` on the wire and nothing else per-player, and an attendee view that renders the
current question as **static text** — with `data-optionId` already parked on each option as the hook
for this slice. Nothing in the system reads attendee input yet. Three contracts (spine, retention,
join) bound what can be added and where.

## Desired End State

On each choice question, up to 150 phones show tappable options and a submit control that locks on the
first answer. On reveal, every phone shows the correct answer highlighted, its own verdict, the points
that answer earned, and a running total. The store holds one answer per player per question and one
total per player, both purgeable; nothing about who answered what leaves the store except to the
device that owns it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Answer storage layout | One registered hash, field `<questionId>:<playerId>` | A single literal key keeps `end`, `purge` and `keys.test.ts` working unchanged; per-question names would be assembled at runtime and reached by none of them. |
| When scoring happens | At submit, inside the same write | Spreads the work across the room's own tapping instead of bunching a 150-field read-modify-write on the host's reveal click. |
| How a phone learns its result | Correct ids in the snapshot, award fetched per device | Correctness lands even if the fetch fails, so no phone is blank at the one moment FR-016 exists for, while points stay server-authoritative. |
| Changing an answer | First answer locks (`HSETNX`) | Keeps the speed component honest and costs one write per attendee per question. |
| Speed curve | `0.5 + 0.5 × (1 − min(1, elapsed/20s))` | Knowing beats guessing fast — the ceiling is only 2× the floor — and fractional weights on a 1000-point base make ties effectively impossible. |
| Client-supplied timing | Trusted, clamped, and recorded as an accepted risk | FR-019 requires the device's clock; the 2× ceiling bounds what forging it is worth, and server-side measurement would silently penalise slow phones. |
| Running totals | Maintained now, in a registered scores hash | FR-016's "points earned" only lands with a total beside it, and S-07 then ranks a number that already exists. |
| Player id as a credential | Kept as-is, decision recorded | `join-contract.md:98` required this slice to take the claim rather than inherit it; the first-answer lock caps an impostor to spoiling one answer. |
| Question kinds | Choice only, behind a per-kind scorer seam | S-05 and S-06 add a scorer rather than a second scoring model — the roadmap's stated reason for sequencing S-03 first. |
| Unscored questions | Answerable, stored, no award, own reveal copy — driven by a new `scored` flag on the public projection | The drafted Q2 is the gather-the-room beat; without the flag the payload is identical to a wrong answer and every latecomer would be told they failed. |
| Late answers | Refused inside the script on phase and question id | Same shape as the name claim, so the check cannot race the host's reveal — and a grace window would reopen the leak FR-005 was revised to close. |
| Verification depth | Unit + two-device run + 150-client submission burst | `command-counter-diagnostic.md:129` flags this exact path as the first place script length costs money, and only a settled counter reading answers it. |

## Scope

**In scope:** the scoring rule (`src/lib/session/scoring.ts`); the answer record and two registry keys;
one atomic submission `EVAL` plus a per-player result read; `POST /api/quiz/answer` and
`POST /api/quiz/result`; `revealedOptionIds` on `SessionState`, set by reveal and cleared by advance;
answerable and revealed rendering on the attendee view; a persisted per-question paint timestamp; an
answer stage in the rehearsal harness; the cost report, the answer contract and the runbook correction.

**Out of scope:** text, number and word-cloud answers (S-05, S-06, S-08); the leaderboard (S-07); the
host's participation count and distribution (S-04); per-device join cap and full resume (S-09);
throttling the answer route; correcting a question mid-session.

## Architecture / Approach

```
phone ──POST /api/quiz/answer──▶ route: look up correct ids (server-only),
   │                                    clamp elapsed, score
   │                                        │
   │                                        ▼
   │                              one EVAL: phase + question check,
   │                              HSETNX answer, HINCRBY total, 2× EXPIRE
   │                                        │
   │       ◀── { accepted: true } ──────────┘   (no verdict on this path)
   │
host ──reveal──▶ snapshot gains revealedOptionIds ──Ably──▶ every phone
   │                                                            │
   └────────────────── POST /api/quiz/result ◀───────────────────┘
                       (phase-gated) → { correct, awarded, total }
```

Correctness is quiz content and rides the broadcast the room already receives; the award and the total
are per-player and never do. That split is also the resilience story: a failed result fetch degrades to
"here is the right answer" rather than to a blank screen.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Scoring rule and answer model | Pure scorer, answer record, two registry keys | A seam built for S-05/S-06 before they exist can be the wrong seam |
| 2. Submission script and result read | One atomic `EVAL` + the per-player read, with a stated cost prediction | A future edit adds a `redis.call` without noticing it is being priced |
| 3. Routes and reveal payload | `/api/quiz/answer`, `/api/quiz/result`, `revealedOptionIds` | The result endpoint becomes a cheat sheet if the phase gate is wrong |
| 4. Attendee view | Tappable options, lock, reveal panel, persisted paint clock | A reload resetting the clock hands out full speed weight silently |
| 5. Burst, cost report, contract | Harness answer stage, settled counter reading, runbook fix | A counter read too early produces a model 3× too low (S-02's own lesson) |

**Prerequisites:** S-02 `done` (it is), plus a deployed environment with `KV_REST_API_*`,
`ABLY_API_KEY` and `LIVEQUIZ_HOST_SECRET` for the Phase 4 and Phase 5 live runs. The Phase 5 counter
reading is a human-only step — the Upstash console is not reachable from this environment.

**Estimated effort:** ~4–5 sessions across five phases, with a waiting period in Phase 5 for the
command counter to settle before it is quoted.

## Open Risks & Assumptions

- **Store cost rises ~40× per event** (~500–600 commands → ~27k). Two separate consequences: ten
  events a month reaches ~54% of the documented 500K/month plan ceiling, up from ~1%; and the
  runbook's per-run tripwire, which it justifies as sitting "roughly 125× above a real session", now
  sits roughly 7× above one. **Nothing is crossed** — the threshold is per run — and Phase 5 records
  both figures without moving it, because the runbook warns that raising it is how it stops working.
- **Reveal fan-in is a new shape** — 150 result fetches within a second of each reveal, 14 times a
  session. The Phase 5 harness exercises submission, not this. If it strains, the fallback is already
  designed in: jitter the fetch, because the correct answer is already on screen.
- **Forged timing is undetectable.** Accepted, bounded by the 2× ceiling, consistent with the PRD's
  no-accounts model. Recorded, not defended.
- **The player id remains a bearer credential.** Decision taken rather than inherited; damage capped by
  the first-answer lock.
- **Residual clock reset** for a device that clears storage or joins after a question opened. FR-019
  says the clock is the device's, so a latecomer genuinely did just see the question.

## Success Criteria (Summary)

- An attendee answers a choice question on their phone, and on reveal sees the correct answer, their
  own verdict, their award and their running total — with the faster of two correct answers scoring
  higher.
- Nothing tells any device a verdict before the host reveals, and nothing puts an answer or a name on
  the channel or in a log line.
- 150 simulated attendees submit to one question with 150/150 accepted, zero duplicates, and a settled
  command cost that matches the prediction written down in Phase 2.
