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
| 2026-08-07 | 1 | `fra1` | 13/13 checks. Worst end-to-end p95 **391 ms** against the 1000 ms budget; teardown 200. Not a baseline — one client makes median and p95 the same number and exercises neither the join burst nor the 200-connection ceiling. |

Worth noting from the N=1 run: end-to-end was consistently **shorter than the host action's round
trip** (141 ms vs 159 ms, 168 ms vs 194 ms). The snapshot reaches the client before the HTTP response
reaches the host — which is why `clickedAt` is taken before the request leaves and arrivals are keyed
by version as they land, rather than asked for after the response returns.
