# Answer contract (S-03)

The fourth contract, after spine, retention and join — and it inherits their warning: a contract that
grows past a page has become a second copy of the plan, and a second copy can disagree with it. This
is a pointer. `plan.md` is the source.

## The scoring rule, and where it lives

`src/lib/session/scoring.ts`. Not in `src/quiz/` — that stays a data contract, and `points` is the
only scoring field it carries.

- Choice correctness is **all-or-nothing** (FR-010): every id in `correctOptionIds`, nothing outside
  it. A superset fails exactly as a subset does.
- `speedWeight(elapsedMs)` is **global, not per kind**, and lands in `[0.5, 1]` over a 20 s window.
  S-05 and S-06 add a *correctness* function beside `scoreChoiceAnswer` and reuse this unchanged.
- An unscored question yields `{ correct: false, awarded: 0 }`. The view distinguishes a warm-up from
  a wrong answer with `PublicQuestion.scored`, **never from `awarded === 0`** — the two payloads are
  byte-identical.

## The two new keys

Both in `keys.ts`, both marked ATTENDEE DATA, both reached by `end` and `purge`.

- `livequiz:answers` — hash, field `<questionId>:<playerId>` (built by `answerField`, one function so
  the read and write paths cannot disagree) → answer record JSON. No display name: the players hash
  owns that mapping.
- `livequiz:scores` — hash, player id → running total.

One hash rather than one key per question, because a per-question name would be assembled at runtime
and a runtime-assembled name is reached by neither `end` nor `purge` and is invisible to
`keys.test.ts`.

`livequiz:seen` is a **`localStorage`** key, declared in the same module for the same
"one module owns every namespaced name" reason `PLAYER_STORAGE_KEY` is. No purge reaches a browser;
that is compliant, not a gap.

## The two fields that look alike and behave oppositely

In `SessionState`, `playerCount` and `revealedOptionIds` sit next to each other:

| | `playerCount` | `revealedOptionIds` |
| --- | --- | --- |
| What it is | decoration on a transition | *part of* the transition |
| Set where | injected in `applyHostAction`, every action | set in `reveal.ts`, cleared everywhere else |
| Stale value costs | nothing (host sees 148 of 149 for a beat) | the previous question's answer key, published to the room while the next question is open |

**Never inject `revealedOptionIds` in `applyHostAction`.** The schema refuses a non-null value outside
`question-revealed`, which is the backstop, not the design.

## The result endpoint's gate — S-07 inherits this

`/api/quiz/result` returns a correctness verdict, so it serves one only when **that question** is in
`question-revealed`, checked against the session document rather than a parameter. Served during
`question-open` it is a cheat sheet reachable with one `curl`.

**The `ended` phase is a deliberate exception: the running total alone, no verdict.**
`ENDED_TTL_SECONDS` exists so a device reloading just after the host closes still finds the final
standings, and a gate refusing everything in `ended` would hold those totals for ten minutes with no
way to read them. **S-07's leaderboard inherits both the gate and the exception** rather than
rediscovering them.

`answered: false` is a 200 and a normal outcome. A store failure is a 503. Conflating them is how a
phone tells an attendee they missed a question they watched themselves answer (`LookupResult`'s
lesson, applied here).

## Cost

Priced with the S-02 attribution method: Upstash bills the `EVAL` **and** every `redis.call` in it.

| Path | Per call |
| --- | --- |
| Submission (`readSession` + `EVAL` with `GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE`) | 8 |
| Result read (`EVAL` with `GET`, 2× `HGET`) | 4 |

~27k per 150-attendee, 14-question event against ~1600 before. Ten events a month is ~54% of the
500K ceiling. The runbook's per-run tripwire is unchanged at 200K; its **margin** fell from ~125× to
~7×. Observed figures: `answer-cost-report.md`.

## Accepted risks — listed, not implied

- **Forged timing.** A device claiming `elapsedMs: 0` is undetectable; there is no client this project
  controls and no signature to check. Bounded by the 2× ceiling in `speedWeight` — the forger still
  has to answer correctly. An *absent* field is treated as the slowest answer, not the fastest.
- **The player id as a bearer credential.** S-02 scoped its "not a secret" claim to itself and told
  S-03 to re-take it. Re-taken: holding someone's id now lets you answer and score as them. Accepted
  under the PRD's no-accounts, trust-the-room model — v4 UUIDs, HTTPS, one room, fifteen minutes.
- **The reload residual on the paint clock.** Persisted per question, so a reload keeps its clock. A
  device that clears storage, or an attendee who joins after the question opened, starts at now —
  and a latecomer genuinely did just see the question.
- **`/api/quiz/answer` is unthrottled**, inheriting `/api/quiz/join`'s reasoning (a venue network is
  one address). That reasoning was formed when the whole room cost ~8 commands; this route bills 8
  per call against a budget this slice pushes to ~54%. Unguessable player ids and the one-answer-per
  -question lock make a loop a nuisance rather than an exploit — but it is a nuisance with a bill.

## Scope boundary

Still owned by later slices: **S-04** the host's participation count and answer distribution;
**S-05/S-06/S-08** text, number and word-cloud answers (the route refuses the kinds it does not
handle, with a message, and that refusal is the seam); **S-07** the leaderboard and the question of
names on 150 screens; **S-09** the per-device join cap and score-intact resume across reconnects.
