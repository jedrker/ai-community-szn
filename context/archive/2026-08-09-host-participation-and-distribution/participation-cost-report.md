# Participation and distribution — command cost, predicted vs observed (S-04)

Prices the tally, poll and reveal paths against the same attribution method S-02 and S-03 used
(`context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md`): **Upstash bills the
`EVAL` and every `redis.call` inside it.**

**Observed figures are a human-only step.** The Upstash console is not reachable from the environment
this was implemented in, and the counter is the only source for the settled delta. The observed
section below is unfilled on purpose — see it for what to run and when to read.

## The prediction

Counted by hand against the implemented scripts, and stated in `SUBMIT_ANSWER`'s docstring so an edit
that adds a call knows it is being watched.

| Path | Commands | Where |
| --- | --- | --- |
| `readSession` before scoring | 1 | `answer.ts` — a plain `GET` |
| `SUBMIT_ANSWER`, before S-04 | 7 | `EVAL` + `GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE` |
| `SUBMIT_ANSWER`, after S-04 | 7 + (k + 2) | plus `HINCRBY` answered, k× `HINCRBY` option, `EXPIRE` tallies |
| **Per submission, single-choice (k = 1)** | **11** | up from 8 |
| **Per submission, multiple-choice (k ≈ 2)** | **12** | |
| `readAnsweredCount` + `readPlayerCount` | 2 | one `HGET`, one `HLEN` — the poll tick |
| `readQuestionTallies` | 1 | one `HMGET`, once per reveal |

### Per event

**The arithmetic uses the 10 answerable questions, not all 14.** `/api/quiz/answer` refuses text,
number and word-cloud kinds today, and the drafted quiz is 8 single-choice, 2 multiple-choice, 2
number, 1 text, 1 word-cloud — so only 10 questions generate submissions at all, and the panel and
its poll are hidden for the other four.

| Path | Added per event |
| --- | --- |
| 8 single-choice × 150 × 3 | 3,600 |
| 2 multiple-choice × 150 × (2 + k), at k ≈ 2 | ~1,200 |
| Poll (2 commands / 2.5 s, one device, 10 questions) | ~750 |
| Reveal reads (1 per reveal, 14 reveals) | 14 |
| **Added** | **~5,600** |

Against the S-03 baseline of ~26,800 (`answer-cost-report.md`), that is **~32,400 per event, and ten
events a month at ~65% of the 500K ceiling** — up from ~54%.

The poll row is the one with real spread in it, because it is the only row paced by a clock rather
than by a person. ~750 assumes a host who leaves each of the 10 questions open for ~60 s. A host who
lets a hard question run three minutes triples that row and nothing else; a host who advances briskly
halves it. It is bounded either way — one device, and only while a choice question is open.

### For a `--clients=150` harness run specifically

The harness answers **one** question, does not poll (it has no host view), and reads the store
directly rather than fetching results. Predicted delta over the S-03 run's ~2,480:

| Path | Commands |
| --- | --- |
| S-03 rehearsal baseline | ~2,480 |
| Answer burst, 150 × 3 added | 450 |
| The duplicate-submission probe — **adds nothing**, the lock rejects it above the increments | 0 |
| Reveal's tally read | 1 |
| The new audit read (`HGETALL` on the tallies hash) | 1 |
| **Predicted total** | **~2,930** |

## The observed reading

**Read the counter the way `command-counter-diagnostic.md` says to, or the number is wrong.** A
reading taken minutes after a burst looks exactly like a settled one — that is how the runbook's cost
section came to understate the cost by 3×. Measured precedent: a reading 7 minutes after three N=150
runs was 2,526 commands short of the same counter 85 minutes later. **Wait at least ~90 minutes,
re-read, and only quote a figure that has stopped moving.**

### The run

Performed **2026-08-09** against production (`fra1`), `--clients=150`, immediately after deploying
S-04 and resetting the namespace. **31/31 harness checks passed**, including the two this slice
added:

| Finding | Result |
| --- | --- |
| the answered tally agrees with the answers hash | tally 150, hash 150 for `llm-skrot` |
| the option tallies sum to the selections in the answers hash | tallies 150, records carry 150 option ids |

**This is the finding the test suite structurally cannot produce.** The increments live inside
`SUBMIT_ANSWER`'s Lua, so `store.test.ts` can only assert that the right fields are sent and that
they sit below the `HSETNX`; whether 150 simultaneous submissions land 150 increments is invisible
to a mocked client. They did, in both counters, with no drift.

Also observed: 150/150 joins in 1,192 ms, 150/150 submissions accepted in 791 ms, a repeat
submission refused 409, worst end-to-end p95 446 ms against the 1,000 ms budget, and the
`question-open` snapshot carrying no answer key.

### The counter

| | Value |
| --- | --- |
| Counter before | **8,073** (writes 4,617 + reads 3,456; console rounded it to 8.1k) |
| Counter after (settled) | **11,257** (writes 6,693 + reads 4,564; console rounded it to 11k) |
| **Observed delta** | **3,184** (writes +2,076, reads +1,108) |
| Predicted window | 3,210 – 3,310 |
| **Disagreement** | **0.8% below the bottom of the range**, ~2.3% under the midpoint |

**The model holds.** The prediction was written down before the counter was read, and the aggregate
lands just under the low end of the range. Nothing is issuing commands nobody counted.

Three honest qualifications on that agreement:

- **The individual terms are not separable.** One aggregate delta cannot confirm that a submission
  costs exactly 11 rather than, say, 10 with the poll costing more than modelled. What it confirms is
  that the *sum* of the model's terms matches reality — which is the claim that matters for capacity,
  and the one an unnoticed extra call would break.
- **A shortfall is the direction lag produces.** The console understates until it settles, so if this
  reading is still creeping the true delta is slightly higher and moves further *into* the predicted
  range rather than away from it. The reading was taken once rather than confirmed by a second read a
  few minutes later; a small upward correction would not change the conclusion.
- **The poll was the loose term and it did not blow up.** ~100–200 was the widest band in the
  estimate, and the total leaves no room for it to have been far above that.

### What this does and does not measure

**It measures the model, not an event.** The window covers a 150-client harness run plus a
single-attendee 14-question stage pass — not 150 people answering 14 questions. The **~32.4k
per-event** figure is still an extrapolation.

What changed is its standing: it is built from the same per-command counts this delta just confirmed
to within ~1%, so it is now an *evidence-backed extrapolation* rather than an unverified prediction.
The distinction is worth keeping — a future reader deciding whether to trust 65% of the ceiling
should know that the multiplier was measured and the multiplicand was not.

### The stage rehearsal is inside the measured window

The 5.9 stage rehearsal ran between the baseline reading and the post-run reading, so the window
covers **both** the harness run and a manual pass: 14 questions driven from the host view, one phone
joined, one answer submitted.

**Estimated and written down before the counter was read**, so the model cannot be quietly fitted to
the result afterwards:

| Path | Commands | Basis |
| --- | --- | --- |
| `start` | ~3 | `CREATE_IF_ABSENT` — `EVAL` + `GET` + `SET` |
| 14 × `advance` | ~70 | 5 each: `readSession` + `readPlayerCount` + `COMPARE_AND_SET` (`EVAL`+`GET`+`SET`) |
| 14 × `reveal` | ~80 | 5 each, plus one `HMGET` on each of the 10 choice questions |
| 1 join | ~8 | S-02's measured per-join figure |
| Device connects (`GET` + `HLEN` each) | ~6 | host page and phone, allowing a reload |
| 1 submission | 11 | `readSession` + `SUBMIT_ANSWER` at k = 1 — the S-04 figure |
| 1 result read | 4 | `READ_ANSWER` |
| **Subtotal** | **~182** | |
| The poll | **~100–200** | 2 per tick, 10 choice questions, at ~10–25 s open each |
| **Stage run total** | **~280–380** | |

**The poll is the loose term, and deliberately so.** It is the only path here paced by a clock rather
than by a person, so its cost depends entirely on how long each question stayed open — which is why
the runbook records the loop's *shape* rather than a single number.

**Combined predicted window: ~3,210–3,310 commands** (harness ~2,930 + stage ~280–380).

Two things that bias the "before" figure, both small and both stated rather than discovered later:

- A `quiz:reset` and a `quiz:check-purge` ran shortly before the reading, ~25 commands between them.
  If they had not yet surfaced in the console, they will land inside the measured window and inflate
  the delta by well under 1%.
- The console figure was read as writes + reads rather than from the rounded `8.1k` headline, so the
  baseline is exact to the command.

Re-read the counter at least ~90 minutes after the run, then again a few minutes later, and only
record a figure that has stopped moving.

**If the observed delta disagrees with the prediction by more than a few percent, that disagreement
is the finding.** Do not reconcile it by adjusting the model after the fact — the model is stated in
the script's own docstring precisely so that a mismatch means either the docstring is wrong or
something is issuing commands nobody counted, and both are worth knowing. S-02's settled delta
matched its model to within 0.1%, so a few percent is a realistic bar rather than a generous one.

Once observed, **the runbook's per-event figure and ten-event percentage must be updated from the
measured delta, not from the prediction above.** `docs/runbook-live-session.md` carries a marker
saying so.
