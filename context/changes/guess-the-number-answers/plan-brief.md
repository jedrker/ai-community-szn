# Guess-the-number answers — Plan Brief

> Full plan: `context/changes/guess-the-number-answers/plan.md`
> Sibling slice this extends: `context/changes/free-text-answers/plan.md`

## What & Why

Roadmap S-06. An attendee submits a numeric guess and earns points scaled by how close it was, on one
relative-error rule that behaves identically whether the true answer is 67 or 10,000 (PRD FR-013).
Both number questions are already in the quiz and neither can be answered — the route refuses the
kind by design, waiting for this slice.

## Starting Point

S-03 built the answer path and stated this slice's contract in the scoring module itself: `speedWeight`
is exported separately "because S-06's relative-error curve multiplies this same weight against a
partial-credit base." The PRD already litigated and closed the obvious objection — that one distance
rule cannot span 67 and 10,000 — resolving it as relative error, magnitude-independent, one rule.

**This plan assumes S-05 lands first** and extends its shape: the same record-field pattern, the same
`revealedAnswerText` reveal channel, the same input placement, the same route branch structure.

The genuinely new thing is that this is the **first partial-credit answer in the system**. Everything
so far is binary — the scorer returns zero or full, `AnswerRecord.correct` is a boolean, the reveal
says "Dobrze!" or "Tym razem nie." A guess 4% off that earned 800 points fits none of that.

## Desired End State

The host advances to the Lyro question. A phone guessing 65 is told at reveal that the answer was 67,
that it guessed 65, and that it earned points — without being told it was wrong. A phone guessing 50
earns nothing. `67,5` parses as 67.5 rather than scoring as nothing. The same rule, with no
per-question tuning, behaves identically on the 10,000-answer question: 9,800 scores, 7,000 does not.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Curve shape | Banded: exact/5%/10%/25% → 100/80/60/30% | The host can state the whole rule in one sentence — the same defend-it-out-loud test that rejected fuzzy matching in S-05 |
| Where it hits zero | Beyond 25% relative error | Rewards a real ballpark and gives nothing to a shrug; directly answers the roadmap's leaderboard-flattening risk |
| What `correct` means | Exact hit only | Keeps the stored flag meaning one thing across all kinds; reveal copy is driven by the award and the two numbers instead |
| Coupling to S-05 | Assume S-05 lands first | One coherent multi-kind answer path instead of two mechanics bolted on, and a much smaller slice |
| Where the guess is stored | New `value: number \| null` | Scorer, future distribution and stage disputes all want a number, not a string to re-parse |
| Reveal channel | Reuse S-05's `revealedAnswerText` | One field, one invariant, one host branch — and it removes this slice's collision with S-04 entirely |
| Input control | Text input + `inputmode="decimal"` | `type="number"` picks its decimal separator from browser locale, so two phones in one room parse differently — and reports invalid input as an empty string |
| Decimal separator | Accept `.` and `,` | Polish writes decimals with a comma; `67,5` must not silently score as nothing |
| Who parses | Server only | A shared parser would duplicate or cross the boundary `boundary.test.ts` enforces; the client only needs a "contains a digit" test |
| Value bounds | Finite, magnitude ≤ ~1e12 | Closes the same write-anything class the route closed for `optionIds`; negatives pass and score zero |
| Reveal copy | Answer, own guess, award | The binary verdict is wrong for a guess that earned 800 of 1000 |
| `correctValue: 0` | Rejected at build time | A relative-error rule divides by it; the definition gate already fails a deploy on a malformed quiz |

## Scope

**In scope:** `scoreNumberAnswer` and the band constant; the `correctValue: 0` schema refinement;
`value` on the answer record; pl-PL formatting of the correct number into `revealedAnswerText`; the
route's number branch with its parser and bounds; `value` on the result payload; the numeric input,
submit path and third reveal-copy branch; CLAUDE.md and roadmap updates.

**Out of scope:** per-question tolerance knobs; closest-guess bonuses; exposing the band thresholds in
the UI; any `host.astro` change; S-08's word cloud (still refused at the seam); S-04's distribution;
a rehearsal run; a contract document.

## Architecture / Approach

```
schema.ts (reject correctValue: 0)     scoring.ts (scoreNumberAnswer × speedWeight)
                                                  │
                            answer.ts route ──► answers.ts record (.value)
                              │  (server-only parser: "." "," U+00A0)
                              │
reveal.ts ──► revealedAnswerText (pl-PL formatted) ──► snapshot ──► phones + projector
                                                  │
                                    result.ts (own value) ──► reveal panel
```

Correctness travels on the broadcast, the award and the device's own guess on the per-device fetch —
S-03's split, preserved.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Curve and authoring guard | `scoreNumberAnswer`, band constant, `correctValue: 0` refinement | Floating point deciding a band edge by luck; re-deriving `speedWeight` instead of reusing it |
| 2. Record field and reveal value | `value` on the record; formatted number into `revealedAnswerText` | The pl-PL group separator is U+00A0 — a test asserting a normal space fails with an identical-looking diff |
| 3. Route and result payload | Parsing, bounds, scoring, own guess returned | A bare `Number()` on an absent field scoring a silent device as having guessed zero — the `elapsedMs` bug's exact shape |
| 4. Attendee view | Numeric input, submit, third reveal branch | A kind-blind copy branch telling someone who scored 800 they were wrong |
| 5. Docs and room run | CLAUDE.md, roadmap, build gate, live verification | Magnitude-independence is only observable across both questions, not one |

**Prerequisites:** S-03 done (it is) **and S-05 implemented** — this slice will not type-check against
a tree without it.

**Estimated effort:** ~1.5 sessions across 5 phases. Smaller than S-05 because it inherits that
slice's record pattern, reveal field and input placement.

## Open Risks & Assumptions

- **Hard dependency on S-05.** If S-05 is cut or lands materially differently, re-read this plan
  rather than replaying it — particularly phases 2 and 4.
- **The band edges are a product judgement, not a derived constant.** 25% as the zero point makes
  these two questions separators rather than participation beats; most of the room will score nothing
  on them. That is the intent, but it is worth seeing once in a real room before the next quiz is
  authored.
- **`correct: false` on a well-scoring answer is a trap for later slices.** S-07's leaderboard is the
  most likely place to read that flag as "scored nothing". Called out in the CLAUDE.md note for
  exactly this reason.
- **Assumes full ICU in the deploy runtime.** Verified locally on Node 22.12, which is the project's
  floor; Vercel's Node 22 carries it too, but the formatted value is asserted in a test so a
  regression fails the build rather than the room.

## Success Criteria (Summary)

- A guess within 5% scores well, one 25% off scores nothing, and the same relative behaviour holds at
  both 67 and 10,000 with no per-question tuning.
- A Polish attendee typing `67,5` is scored on 67.5, not refused and not read as 675.
- At reveal, an attendee who was close sees the answer, their guess and their points — and is not told
  they were wrong.
