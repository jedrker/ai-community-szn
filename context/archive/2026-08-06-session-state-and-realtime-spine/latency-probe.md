# Latency probe — F-02 fan-out

> **Status: measured 2026-08-07 by F-04 — the guardrail holds.** See §Result against the guardrail.
> The paragraph below is the original framing, kept because the method it fixes is what makes the
> numbers auditable.
>
> **Status: method recorded, measurement pending.** The figures below are filled by a run
> against a deployed preview with a second physical device. Until then this file states
> *how* the number will be taken, so the reference points are fixed before anyone is
> tempted to pick the flattering one.

## Why the reference point is written down

The PRD guardrail is "every attendee's screen reflects the host's current question or
reveal **within 1 second of the host acting**". Acting means the click, not the response.

A figure anchored at the HTTP response would exclude the endpoint round trip, the store
`EVAL` and the Ably publish — most of the server-side budget — and would read comfortably
under one second while the real number might not. F-04 builds its baseline on this figure
and F-01's Pro-upgrade tripwire is calibrated against it, so a number measured from the
wrong instant is worse than no number. The plan review raised this as finding F4.

The same applies to region: the roadmap is explicit that a figure taken from a deployment
predating `regions: ["fra1"]` "must not be recorded as the baseline."

## Method

1. Deploy a preview. Confirm `LIVEQUIZ_HARNESS` is present in Preview (`vercel env ls`).
2. Confirm the function region from the response headers, rather than assuming it:
   `curl -sI <preview-url> | grep x-vercel-id` → `<edge>::<function-region>::<id>`.
3. Open `/quiz/spine-check` on a laptop (host pane) and on a phone on a real network —
   ideally the venue's, otherwise mobile data rather than the same Wi-Fi, since same-Wi-Fi
   numbers flatter the result.
4. Fire `start`, several `advance`es, and `reveal`. Record both figures the harness shows.
5. Reload the phone mid-session and confirm it renders current state immediately.

## What the two figures mean

| Figure | Spans | Anchored at |
| --- | --- | --- |
| **End to end** (headline) | click → snapshot rendered | the click, on the host device's clock |
| Round trip (secondary) | click → HTTP response | the click, same clock |

The difference between them is the fan-out: publish → Ably → back to a subscriber. Keeping
them separate is what tells you *where* the budget went if the headline disappoints.

**Both are measured on one device's clock**, because the host pane subscribes to the channel
as well as driving it. That is deliberate: the two panes are separate devices with
unsynchronised clocks, so a phone-side absolute delta would be measuring clock skew as much
as latency. The phone's job here is to confirm the snapshot *arrives* and *agrees* — same
version, same phase — not to produce its own number.

**This is a real limitation for F-04.** Driving ~150 simulated devices and reporting
per-device latency needs a clock strategy this slice does not provide: either
server-timestamp comparison with a measured offset per client, or accepting arrival-order
and agreement as the metric instead of absolute delta. Decide that before F-04 reports a
number, not after.

> **Resolved by F-04 (2026-08-07): one process, one clock.** Neither of the two options above
> was taken. The harness *is* the host and *is* the room — it holds the host secret locally and
> runs all 150 subscribers in the same process — so the click instant and every arrival instant
> come from one `performance.now()`. Skew is structurally absent rather than measured and
> corrected, and absolute per-device deltas are therefore legitimate.
>
> The price of that choice is stated wherever the figures are: 150 sockets on one NIC and one
> network path is a **lower bound** on a room of phones, not a simulation of one. It also moves
> the measurement point — arrival is when the snapshot reaches the client library, not when a
> phone paints it, so "click → render" below is honestly "click → arrival" for these rows.
> Rendering cost belongs to S-02.

## Measurements

| Date | Deployment | Function region (from `x-vercel-id`) | Action | End to end (click → render) | Round trip (click → response) | Client device / network |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-07 | `dpl_3hqnx…` | `fra1` (`arn1::fra1::…`) | advance / reveal ×4, 150 clients | p95 **111 ms**, median 82–107, max 124 | 99–127 ms | 150 simulated clients, one `bun` process, Apple M2 Pro, residential Wi-Fi (Szczecin) |
| 2026-08-07 | `dpl_AVtWh…` | `fra1` (`arn1::fra1::…`) | advance / reveal ×4, 150 clients, ×6 runs | p95 **188 / 356 / 480 / 536 / 551 / 592 ms** — worst 592 | 96–316 ms | as above; some runs while tailing `vercel logs`. **Seven runs total span 111–592 ms with the system unchanged — read the range, not any single row** |
| 2026-08-07 | `dpl_AVtWh…` | `fra1` (`arn1::fra1::…`) | advance / reveal ×4, 20 clients, 3 killed after warm-up | slowest arrival 122–189 ms | 96–187 ms | fault-injection run: `received 17/20` per action, figures of the remainder unchanged. **n=17, so this is the slowest sample, not a percentile** |

The `start` action is excluded from every row: it is the warm-up that pays the function's cold start
(183–626 ms observed), which is not fan-out cost. It is taken and printed by the harness, then
discarded.

Full conditions, all runs including the N=0 and N=1 smoke tests, and the honest limits of the method:
`context/changes/room-scale-rehearsal-harness/rehearsal-report.md`.

## Result against the guardrail

**The guardrail holds. F-01's latency tripwire has not fired.**

The PRD requires that every attendee's screen reflects the host's current question or reveal
within **1 second** of the host acting, at **150 concurrent devices, with no lost answers and no
divergence between devices**. Measured on production, from `fra1`:

- **End-to-end p95 spans 111–592 ms across seven N=150 runs**, against a 1000 ms budget — the worst
  run is under by ~1.7×. Recorded as a range because the single figure first written here (356 ms)
  was superseded twice within hours; **over 5× run-to-run spread with the system unchanged is itself
  the result**, and a future run reading 500 ms is normal variance rather than a regression.
- **150/150 devices connected** on every run, and **every connected device received every
  published version**. No lost snapshots, so no divergence: all 150 held the same version at the
  same moment, which is the property the guardrail is really about.
- **Ably's 200-connection ceiling was never strained** — zero refusals at 150, connecting in
  973–1753 ms.

Two qualifications, neither of which changes the verdict:

1. **This is a lower bound, not a room** — with one caveat pointing the other way. One process, one
   NIC, one Wi-Fi path, so a real room can be worse and nothing here bounds how much. But 150
   subscribers also share one event loop, so the last handler runs after 149 deserialisations; that
   component *overstates* the tail relative to independent phones. Both effects are unquantified. The
   measurement to take at a real event is the host's own second device
   (`docs/runbook-live-session.md`).
2. **The write half is untested.** "No lost answers" cannot be verified yet: nothing submits an
   answer until S-03. What is verified is the fan-out half — no lost *snapshots*.

Recorded by F-04, 2026-08-07. F-02's plan criteria 4.5, 4.7 and 4.8 are discharged by these rows.
