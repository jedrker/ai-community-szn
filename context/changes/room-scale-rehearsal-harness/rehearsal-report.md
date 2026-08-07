# Rehearsal report — room-scale rehearsal harness (F-04)

> Status: load runs complete, guardrail verdict recorded, corrected 2026-08-07 by impl review.
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
  carries it — which now exists: `docs/runbook-live-session.md` §The day before, added 2026-08-07 after
  impl review found this sentence promising a runbook entry that had never been written.
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

## The log stream drops lines under a burst, and can stall silently

> **Corrected 2026-08-07 during impl review (finding F1).** This section previously claimed the join
> burst *kills* the stream, generalised from a single observation and graded H/H on that basis. Three
> controlled tests did not reproduce it. The corrected account is below; the original claim is quoted at
> the end of this section so the mistake stays visible rather than edited out of history.

Criterion 2.4 asked for 150 token requests to be visible in the deployment logs. `token.ts` was
instrumented for exactly that (`session.token.issued`), and the instrumentation works. What the stream
does with 150 lines in one second is the problem.

Measured on production, deployment `dpl_AVtWhKUdppv9NRPyWheChNg8RN5T`:

| Test | Result |
| --- | --- |
| 14 requests at 20-second intervals over 4.5 min | **14 of 14** lines delivered — stable at low rate, and the stream does **not** expire on a timer |
| N=5 rehearsal, quiet stream | **5 of 5** token lines plus every host-action line — each device does fetch its own token |
| 150 concurrent requests to `/api/quiz/state`, which emits nothing on success | **0** lines, stream still delivering afterwards — **request volume alone is not the cause** |
| 150 concurrent requests to `/api/quiz/token` (150 lines) | **127 of 150** delivered, stream still delivering afterwards |
| N=150 rehearsal, fresh stream | **135 of 150** token lines + 13 host-action lines, stream still delivering afterwards |
| N=150 rehearsal, on two earlier occasions | **1 of ~150**, then the feed went silent and stayed silent — **not reproduced in three later attempts** |

### What is established, and what is not

**Established:** a burst costs **roughly 10–15% of log lines** — reproduced twice, at 127/150 and
135/150. So a 150-device join burst cannot be *counted* in the log stream even with the endpoint
instrumented, but it is visible in it.

**Established:** the stream can **stop delivering and stay stopped**, while `vercel logs` keeps printing
`waiting for new logs...`. Observed twice. **Cause unknown** — it is not the timer (14/14 over 4.5 min),
not request volume (150 silent requests left it working), and not line volume alone (150 lines left it
working). Whether the fault is in the CLI or server-side is not known.

**Not established, and previously asserted here as measured:** that the join burst is the cause, that the
stall is permanent, or that the effect is reproducible.

### What still holds regardless of the cause

The operational conclusion does not depend on the mechanism, which is why it survives the correction:

- **A stalled stream and a quiet system are the same observation.** This cost real time in this session —
  three consecutive runs measured zero token lines and the obvious reading was "the clients never call
  the endpoint". They do. The instrument had stalled, in a way that looks exactly like a working one.
- **So prove the stream is alive rather than trusting its silence**: fire a throwaway request and confirm
  its line appears. Re-attach if not; a fresh attach on the same deployment works immediately.
- **The second device stays the reliable half** of the operational minimum. The tail is for diagnosis
  after something is known to be wrong, not for detecting that it is.

Open Roadmap Question 3 was partially discharged on the grounds that this operational minimum existed.
The log half is **less dependable than recorded** — intermittently, by an unidentified fault, rather than
predictably under load. That is a weaker argument for alerting than the original claim made, and still an
argument for it.

> **Superseded text, kept deliberately:** *"So the sequence is: burst → the feed delivers a fraction →
> the feed stops for good… The failure mode now measured is that the tail dies silently under precisely
> the event that opens a real session."* One run, stated as a mechanism, propagated into
> `infrastructure.md` as an H/H row headed "measured, not inferred" and into the runbook. The lesson is
> not about logs: **a single observation described in mechanism language reads exactly like a finding**,
> and this project's own history (F-01's "probe, don't trust") is the argument for probing twice before
> writing a foundation document.

### How 2.4 is settled

Verified by an amended method, recorded rather than quietly substituted: **per-device token issuance is
proven at N=5 (5/5, one line per device)** and corroborated at scale — an N=150 run delivered **135 of
150** token lines, which is only possible if ~150 requests were made. The connection result (150/150
connected, each holding the lobby snapshot) is independently unreachable without 150 minted tokens, since
an Ably client with no token does not connect. **Counting exactly 150 is not achievable**, because the
stream drops 10–15% of lines under a burst.

## Load run

### Conditions

| | |
| --- | --- |
| Date | 2026-08-07 |
| Target | `https://ai-community-szn.vercel.app` (production) |
| Deployments | `dpl_3hqnxVbBZYiDKYRb9fJmHUGcNv9K`, then `dpl_AVtWhKUdppv9NRPyWheChNg8RN5T` (the token-log deploy) |
| **Function region** | **`fra1`** — read from `x-vercel-id: arn1::fra1::…`, and reported by the harness on every one of the ~30 host actions taken across all runs. The first segment (`arn1`, Stockholm) is the *edge* that accepted the request; the second is where the function ran. F-01's region key is therefore live in production and this run is valid as a baseline. |
| Clients | 150 Ably subscribers, each authenticating through `/api/quiz/token` |
| Driver | one `bun` process, Apple M2 Pro (Darwin arm64), residential Wi-Fi, Szczecin |
| Clock | one process, one clock — click instant and every arrival instant read from the same `performance.now()`, so skew is structurally absent rather than corrected |

### Figures

> **Corrected 2026-08-07 during impl review (finding F6).** This section first recorded a single figure
> — 356 ms, "the worst of three runs". Four further N=150 runs the same day produced 480, 536, 551 and
> **592 ms**, so the single figure was wrong twice within hours of being written. A baseline is now
> recorded as a **range with its run count**.

Seven N=150 runs were taken. Every one connected 150/150 and **every connected device received every
published version — zero lost snapshots across all seven.** Warm-up (`start`) is discarded in each run
as cold-start cost, and printed anyway.

| Run | Connect | Worst measured p95 | Note |
| --- | --- | --- | --- |
| 1 | 150/150 in 1468 ms | **111 ms** | quiet stream |
| 2 | 150/150 in 1753 ms | **188 ms** | while tailing logs |
| 3 | 150/150 in 973 ms | **356 ms** | while tailing logs |
| 4 | 150/150 in 2791 ms | **536 ms** | while tailing logs |
| 5 | 150/150 | **551 ms** | during impl-review triage |
| 6 | 150/150 | **592 ms** | during impl-review triage |
| 7 | 150/150 | **480 ms** | after the F2–F5 fixes |

**Recorded baseline: end-to-end p95 spans 111–592 ms across seven N=150 runs from `fra1`, worst
observed 592 ms against a 1000 ms budget.** The guardrail holds on the worst run, with ~1.7× headroom.

**The spread is the finding, not the mean.** Over 5× between best and worst, with no change to the
system between runs — the deployment, region and client count were identical for runs 4–7. Two
candidates, neither investigated: local network conditions (one residential Wi-Fi uplink carrying 150
sockets), and harness self-contention (150 subscribers on one event loop, so the last handler runs after
149 deserialisations). The second would mean the harness *overstates* the tail, which cuts against the
lower-bound framing for p95 specifically. Worth resolving before anyone treats a single figure from this
harness as a regression signal.

Practical consequence for F-01's tripwire: **compare against the range and the worst, not against a
point.** A future run reading 500 ms is inside normal variance here, not a regression.

### What this does not measure

**One process on one network is a lower bound on a room of phones, not a simulation of one.** If it
failed here, real devices would be worse; that it passes is not proof the venue network passes. Three
specific gaps:

- **150 sockets from one NIC on one Wi-Fi link** share a path a real room does not share. The number
  understates per-device variance and cannot show head-of-line blocking on a saturated venue AP.
- **No attendee writes.** Nothing submits an answer, because no slice builds that yet (S-03 onward), so
  the store's write path at room scale is untested and the commands-per-session estimate remains
  unvalidated.
- **Nothing renders.** Arrival is measured at the moment the snapshot reaches the client library, not
  when a phone paints it. Device rendering is S-02's cost and is not in these figures.

### Commands counter

Read after the load runs: **4102 / 500,000** for the month, against 513 before them. See the section
above — the delta is far below the 200K tripwire but two orders of magnitude above what the code
accounts for, and still unexplained.

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
