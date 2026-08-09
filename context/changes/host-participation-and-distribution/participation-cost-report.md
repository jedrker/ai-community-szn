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
| Counter after (settled, ≥90 min) | _pending_ |
| Observed delta | _pending_ |
| Predicted delta | ~2,930 |
| Disagreement | _pending_ |

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
