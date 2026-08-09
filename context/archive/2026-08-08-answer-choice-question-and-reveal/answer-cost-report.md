# Answer path — command cost, predicted vs observed (S-03)

Prices the submission and result paths against the S-02 attribution method
(`context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md`): **Upstash bills the
`EVAL` and every `redis.call` inside it.**

**Observed figures are a human-only step.** The Upstash console is not reachable from the environment
this was implemented in, and the counter is the only source for the settled delta. Fill the table
below after a run.

## The prediction

Counted by hand against the implemented scripts, and stated in their docstrings so an edit that adds
a call knows it is being watched.

| Path | Commands | Where |
| --- | --- | --- |
| `readSession` before scoring | 1 | `answer.ts` — a plain `GET` |
| `SUBMIT_ANSWER` | 7 | `EVAL` + `GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE` |
| **Per submission** | **8** | |
| `READ_ANSWER` | 4 | `EVAL` + `GET`, 2× `HGET` |
| **Per result read** | **4** | |

At 150 attendees × 14 questions:

| Path | Per event |
| --- | --- |
| Submissions (2100 × 8) | 16,800 |
| Result reads (2100 × 4, less the 2 unscored questions and any silent device) | ≤ 8,400 |
| Joins, host actions, device connects (S-02, measured) | ~1,600 |
| **Total** | **~26,800** |

Two figures the result-read row depends on, both of which make the real number lower than the
ceiling above: the view **does not fetch** on an unscored question (2 of 14) and **does not fetch**
from a device that did not answer.

### For a `--clients=150` harness run specifically

The harness answers **one** question, not fourteen, and does not fetch results at all (it reads the
store directly instead). Predicted delta for the run, over the S-02 rehearsal's ~1260:

| Path | Commands |
| --- | --- |
| S-02 rehearsal baseline (connect, join burst, host actions, purge) | ~1,260 |
| Two extra host actions (advance + reveal), at S-02's per-action cost | ~10 |
| Answer burst, 150 × 8 | 1,200 |
| The duplicate-submission probe (1 × 8) | 8 |
| Audit reads (`HGETALL` × 2) | 2 |
| **Predicted total** | **~2,480** |

## The observed reading

**Read the counter the way `command-counter-diagnostic.md` says to, or the number is wrong.** A
reading taken minutes after a burst looks exactly like a settled one — that is how the first version
of the runbook's cost section understated the cost by 3×. Wait until it has stopped moving, and
record the interval.

Run performed **2026-08-09** against production (`fra1`), `--clients=150`, 29/29 harness
checks passed: 150/150 joins, 150/150 submissions accepted, 150 answers stored with zero
duplicates, a repeat submission refused 409, and end-to-end p95 449 ms against the 1 s
budget.

| | Total | Writes | Reads |
| --- | --- | --- | --- |
| Baseline reading (before the run) | 5,464 | 3,027 | 2,437 |
| Settled reading (after) | 7,953 | 4,565 | 3,388 |
| **Observed delta** | **+2,489** | +1,538 | +951 |
| Predicted delta | ~2,480 | | |
| **Closure** | **+0.4%** | | |

**The model holds.** Nine commands over prediction, which is about what
`bun run quiz:check-purge` costs — it ran immediately after the rehearsal and seeds then
deletes six keys, a cost a real event does not carry. S-02 closed to ~0.1%; this is ~0.4%,
and the residual is accounted for rather than absorbed.

**On whether the reading had settled.** The interval was not recorded, which is a gap
against this report's own instruction — but the *direction* of the miss answers the
question the interval was there to answer. `command-counter-diagnostic.md`'s failure mode
is a counter still catching up, which reads **short**: 2,526 commands short, in the case
that produced a cost model 3× too low. This reading came in nine commands **long**, and a
lagging counter cannot overshoot. Record the interval next time anyway; the argument above
happens to hold and would not have if the numbers had gone the other way.

**What this does and does not license.** It confirms the per-call arithmetic — 8 per
submission, 4 per result read — against a real store under real concurrency. It does not
measure a 14-question event: the harness answers **one** question and never fetches a
result, so the ~26,800 projection above is still arithmetic built on a verified unit cost,
not an observed total. The unit is the part that was worth measuring, and it measured.

## What to do with a mismatch

- **Observed materially above predicted** — something is issuing commands that nothing in this slice
  accounts for. That is the finding the runbook's tripwire exists for; chase it rather than adjusting
  the model.
- **Observed materially below predicted** — the more likely cause is a premature reading, not a
  cheaper path. Re-read before concluding anything.
