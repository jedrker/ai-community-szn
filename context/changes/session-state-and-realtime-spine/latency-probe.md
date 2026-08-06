# Latency probe — F-02 fan-out

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

## Measurements

| Date | Deployment | Function region (from `x-vercel-id`) | Action | End to end (click → render) | Round trip (click → response) | Client device / network |
| --- | --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | | |

## Result against the guardrail

_Pending._ Record explicitly whether the headline figure is under 1000 ms, and whether
F-01's latency tripwire ("state reaching attendee devices in more than one second") has
fired.
