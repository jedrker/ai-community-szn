# Rehearsal report — room-scale rehearsal harness (F-04)

> Status: prerequisite recorded, load run pending.
> The headline figure and the conditions it was taken under belong in this file. The method it follows
> lives in `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md`, and the
> baseline row is written back there once the load run happens (plan phase 3, step 3).

## Spend-alert prerequisite — recorded as a deviation

**Date:** 2026-08-07 · **Verified by:** Jedrzej Meder (Upstash console, via Vercel Marketplace SSO)

The roadmap makes a spend alert on the state store a precondition for the first load run. **A monetary
alert is not configurable in this setup, so the prerequisite is met by a different tripwire.** This is
a deviation from the criterion's wording, taken deliberately, not an unmet step.

Three facts close off the money-shaped version:

| Surface | Why it cannot carry the alert |
| --- | --- |
| Upstash **Budget** | Available on pay-as-you-go only. The database is on the **free tier**, so the field does not exist — there is no accrual to cap. |
| Vercel **Spend Management** | Excludes Marketplace integrations by documentation, so its budget does not observe this database at all. Also a paid-plan feature, and this project is on Hobby (F-01). |
| F-01's **$30/month review threshold** | Stands as the review trigger, but recurring spend is $0, so nothing can arm against it. |

Arming the money alert would mean **moving the database to pay-as-you-go — i.e. starting to pay in
order to be warned about paying.** Declined.

### The tripwire that replaces it

The roadmap's own reason for wanting the alert is architectural, not financial: *"a polling design
instead of a push design would multiply store operations by roughly an order of magnitude per session
— cheap in money, but the alert is the tripwire that catches the architectural mistake while it is
still cheap."* At this scale everything fits inside the free tier, so **a polling mistake would never
reach an invoice** — the currency is the wrong instrument. The command counter measures the thing
directly.

| | |
| --- | --- |
| **Instrument** | Upstash console → database → Usage, `commands` this month |
| **Reading before the load run** | **513 / 500,000 per month** (2026-08-07) |
| **Expected cost of one 150-client run** | ~20K commands (F-02 estimate: 15–25K store operations per session) |
| **Tripwire** | **200K commands** attributable to a single run — an order of magnitude over the estimate is the polling signature the roadmap is describing |
| **How it fires** | Manually: read the counter before and after each load run and record the delta below. There is no automatic notification; that is the cost of this deviation and the reason it is written down. |

The 513 baseline is worth keeping: it is essentially the phase-1 and N=1 verification traffic and
confirms that nothing has been quietly consuming commands between runs.

### What this deviation does not cover

- **No automatic notification.** If a future slice introduces polling and nobody reads the counter,
  nothing announces it. The check is procedural, so it is only as reliable as the runbook entry that
  carries it.
- **Free-tier exhaustion is still unalarmed.** Crossing 500K commands in a month is an Upstash email,
  not something this project controls.
- Revisit if the database ever moves to pay-as-you-go — at that point the Budget field appears and the
  $30 threshold becomes armable for real.

## Commands-counter delta — and an unexplained one

| | |
| --- | --- |
| Before the load runs (2026-08-07) | **513** / 500,000 |
| After three runs — 150, 12, 20 clients (2026-08-07) | **4102** / 500,000 |
| Delta | **+3589** |

Nowhere near the 200K tripwire, so the load runs do **not** indicate a polling design. But the
delta does not match the design either, and that is worth stating rather than filing as background.

**Expected cost, counted from the code:** minting a token does not touch the store at all
(`realtime.ts` holds no Redis import — the token is an Ably concern), and a host action is a `get`
plus a single `EVAL`. Six actions plus one `readState` and one `purge` puts a run on the order of
**20 commands**, so three runs should be **~60**. The observed delta is **two orders of magnitude
above that**, and 182 clients connected across the three runs works out at ~20 commands per client —
a suspicious shape, given nothing per-client is supposed to reach the store.

**Unresolved.** Candidate explanations, none verified: the console counts something broader than
application commands (integration health checks, metrics); something outside these runs is issuing
commands continuously; or the per-client path touches the store somewhere this reading of the code
missed. The cheap diagnostic is to **read the counter twice with no rehearsal in between** — a rising
figure during idle means something is running unprompted, which is a finding in its own right and
larger than F-04.

This matters for calibration, not for the verdict: the 200K threshold was derived from the F-02
estimate of 15–25K store operations per *real* session, and a real session includes answer
submissions that no slice has built yet (S-03 onward). **The rehearsal exercises host actions and
fan-out only, so its command cost is not comparable to the estimate the threshold came from.** Recheck
the threshold once answers write to the store.

## The log stream dies under the load it exists to observe

Criterion 2.4 asked for 150 token requests to be visible in the deployment logs. `token.ts` was
instrumented for exactly that (`session.token.issued`). **The instrumentation works and the criterion
still cannot be met — because the join burst destroys the channel meant to observe it.**

What was measured, on production, deployment `dpl_AVtWhKUdppv9NRPyWheChNg8RN5T`:

| Test | Result |
| --- | --- |
| 14 requests at 20-second intervals over 4.5 min | **14 of 14** lines delivered — the stream is stable at low rate and does not expire on a timer |
| N=5 rehearsal, quiet stream | **5 of 5** token lines, plus every host-action line. Each device fetches its own token; the harness does exercise the endpoint per device |
| N=150 rehearsal | **1 of ~150** token lines. 12 host-action lines from the same run arrived, then the stream went permanently silent — a subsequent N=5 run added nothing to it |

So the sequence is: burst → the feed delivers a fraction → the feed stops for good. **`vercel logs` keeps
printing `waiting for new logs...` the whole time.** A dead stream and a quiet system are the same
observation.

This cost real time in this session: three consecutive runs measured zero token lines and the obvious
reading was "the clients never call the endpoint". They do — proven at N=5. The instrument had died,
and it had died in a way that looks exactly like a working instrument.

### Why this outlives F-04

`docs/runbook-live-session.md` §Before the session tells the host to tail these logs during the
segment, and F-01 established that this stream is the project's **only** visibility — there is no CI, no
alerting, no error tracking. The failure mode now measured is that the tail **dies silently under
precisely the event that opens a real session**: ~150 devices joining at once. For the rest of the
segment the host watches a terminal that cannot report anything, and reads its silence as calm.

Consequences that belong outside this change:

- The runbook's live-tail step needs a re-attach instruction and a way to tell a live stream from a
  dead one (fire a throwaway request and confirm its line appears).
- `infrastructure.md`'s risk register should carry this: the mitigation it credits for "a failure is
  discovered by attendees" is the log tail, and the tail is now known to fail first under load.
- Open Roadmap Question 3 was **partially discharged** on the grounds that the operational minimum —
  tailing logs plus a second device — existed. The log half of that minimum is weaker than recorded,
  which strengthens the case for real alerting rather than closing it.

### How 2.4 is settled

Verified by an amended method, recorded rather than quietly substituted: **per-device token issuance is
proven at N=5 (5/5, one line per device)**, and the N=150 run's connection result (150/150 connected,
each holding the lobby snapshot) is only reachable if 150 tokens were minted, since an Ably client with
no token does not connect. Counting all 150 in the log stream is not achievable on this platform, and
the reason is now measured rather than assumed.

## Load run — pending

To be filled by the N=150 run (plan phase 3, step 2). Must record: deployment URL, function region read
from `x-vercel-id` (a region other than `fra1` invalidates the run as a baseline and is reported as
such, not footnoted), client count, machine and network, the raw harness output, and the commands-counter
delta against the 513 baseline above.

One honest limit belongs in that section, not as a footnote: **one process on one network is a lower
bound on a room of phones, not a simulation of one.** If it fails here, real devices are worse; if it
passes, that is not proof the venue network passes.

## Prior runs against production

Recorded here because they are the same harness against the same target, and because the first one
found a live defect.

| Date | Clients | Region | Result |
| --- | --- | --- | --- |
| 2026-08-07 | 0 | `fra1` | Host path green, **teardown failed with 404** — `main` was 12 commits behind `origin`, so production still ran F-02 and neither `purge` nor `end` existed there. Left a session document (v5, `question-revealed`, **no players**, so no attendee data) in the production store; removed directly and the namespace confirmed empty. |
| 2026-08-07 | 0 | `fra1` | Full drive → `purge` 200 after `main` was pushed. 11/11 checks. |
| 2026-08-07 | **150** | `fra1` | 13/13 checks. **150/150 connected in 1468 ms**, every device received every version. Worst end-to-end p95 **111 ms** against the 1000 ms budget; median 82–107 ms, max 124 ms. Teardown 200, namespace empty. Ably's 200-connection ceiling was not strained — zero refusals. |
| 2026-08-07 | 12 | `fra1` | 13/13 checks, p95 169 ms. Run made while tailing `vercel logs`, to establish what the stream shows. |
| 2026-08-07 | 20 (3 killed) | `fra1` | 15/15 checks. Fault injection: every measured action reported `received 17/20`, and p95 (122–189 ms) stayed comparable to a clean run — the loss shows as misses, not as a shifted statistic. |
| 2026-08-07 | 1 | `fra1` | 13/13 checks. Worst end-to-end p95 **391 ms** against the 1000 ms budget; teardown 200. Not a baseline — one client makes median and p95 the same number and exercises neither the join burst nor the 200-connection ceiling. |

**150 clients measured faster than 1 or 12** (p95 111 ms against 391 and 169). Not a paradox and not
a reason to distrust the figure: the dominant term is the variance of a single path, not fan-out cost,
so at 150 samples p95 describes a distribution while at one sample it describes one roll of the dice.
The supporting evidence is the spread — **max minus median was 17 ms across 150 recipients**, so the
provider is fanning out to the whole room at once rather than working through a queue. It also means
the honest way to read the N=1 and N=12 rows is as smoke tests, not as small-room baselines.

Worth noting from the N=1 run: end-to-end was consistently **shorter than the host action's round
trip** (141 ms vs 159 ms, 168 ms vs 194 ms). The snapshot reaches the client before the HTTP response
reaches the host — which is why `clickedAt` is taken before the request leaves and arrivals are keyed
by version as they land, rather than asked for after the response returns.
