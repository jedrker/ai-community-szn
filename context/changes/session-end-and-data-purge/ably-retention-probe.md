# Ably retention probe — F-03 Phase 1

**Date:** 2026-08-06
**Probe:** `scripts/probe-ably-retention.ts`
**App:** the Ably app behind `ABLY_API_KEY` as configured for this project (key not recorded here)
**Question:** how long does a published session snapshot stay retrievable, and can that be reduced to
zero?

## Why this was measured rather than read

`src/lib/session/realtime.ts:116` publishes the entire `SessionState` on every host action. Today
that is flow only; from S-02 it carries attendee display names and from S-03 their answers and
scores. Ably retention is covered by neither the store's TTL nor `vercel rollback`, so it is a third
storage surface under the PRD's retention guardrail — and until this probe, an unmeasured one.

F-01 and F-02 each found a confidently-documented platform claim that was false (`fra1` needing Pro;
preview URLs being public). This measures behaviour instead of reading the docs.

## Method

The probe publishes a marked message — event name `probe`, payload tagged
`{ probe: "f03-ably-retention" }` — to **`livequiz:probe:retention`**, not to the live
`livequiz:session` channel. An Ably namespace is the segment before the first colon, so both sit in
the `livequiz` namespace and are governed by the same rule; the measurement is equivalent, but a
probe run can never be mistaken for a host action by a device connected to a real session. The live
channel is only ever read.

It then polls `channel.history()` for the message immediately (Ably persists asynchronously, so a
single early miss is not evidence of absence) and again after a configurable wait.

## Observations

| Run | Wait | Result |
| --- | --- | --- |
| 1 | — (publish) | retrievable at age 0s → history is readable on this namespace at all |
| 2 | 60s | **still retrievable** |
| 3 | 135s | **gone** |
| 4 | 135s, `--expect-ephemeral` | gone — 4/4 checks passed |

Live channel `livequiz:session` at probe time: **no retrievable history**. No session had run
recently, so this is the expected idle reading rather than evidence of anything.

## Conclusion

**Message persistence is NOT enabled for the `livequiz` namespace.** The retention window sits
between 60s and 135s, consistent with Ably's documented ~2-minute ephemeral buffer, which exists for
connection recovery and is retained regardless of the persistence setting.

**The floor is therefore ~2 minutes, and it is not reducible to zero.** Disabling persistence — which
is already the state — does not remove the connection-recovery buffer. There is no dashboard setting
that takes this to zero.

### What that means for the guardrail

The PRD guardrail is not fully closed on this surface, and cannot be by configuration alone. From
S-02 onward, the last snapshot published before a session ends will carry attendee display names and
remain retrievable for roughly two minutes by anything holding a subscribe token — and
`GET /api/quiz/token` is deliberately open (accepted risk, `infrastructure.md`, F-02 impl review).

Two properties bound the exposure, and both are worth stating because they are what make it
acceptable rather than merely small:

- It is **~2 minutes, not the session length.** Each publish supersedes the last, so the exposure
  window trails the final host action rather than accumulating across the segment.
- It is **the platform's floor, not a project choice.** Nothing this codebase does can shorten it.

### Decision — an explicit rule, even though it matches the default

Persistence being off by default meant there was nothing to disable, so Phase 1's dashboard step
changed character: from "turn it off" to "decide what to do about a safe default".

**Decided 2026-08-06: add an explicit `livequiz:*` namespace rule with message persistence
disabled**, even though it encodes today's behaviour. The reason is the shape of the risk. Once
persistence is off and cannot be improved further, the only way this surface gets worse is if
something switches it on — so the live risk is regression, and an explicit rule is what makes "off"
a recorded decision rather than an inherited default that nobody chose and nobody would notice
changing.

This is a dashboard action and therefore human-only; an agent cannot complete it. Status is tracked
by plan criterion 1.4.

### Consequences carried forward

1. **Risk register** (`infrastructure.md`) — the residual window is recorded there, with regression
   rather than exposure as the live risk: persistence is off today, is off by default, and would
   have to be deliberately switched on to get worse. Owner: repository owner.
2. **Retention contract** (Phase 5) — this becomes a constraint S-02 must read *before* designing its
   snapshot payload, not a risk-register line discovered afterwards. If the ~2-minute window is judged
   unacceptable once real names are involved, the remedy is the one the plan already considered and
   set aside: keep names off the channel and publish opaque player ids. That decision belongs to S-02,
   informed by this figure.
3. **Desired End State** — the plan's Ably clause is deliberately phrased "beyond the floor measured
   and recorded in `ably-retention-probe.md`". That floor is **~120 seconds**.

## Reproducing

```bash
bun scripts/probe-ably-retention.ts                    # measure, 135s wait
bun scripts/probe-ably-retention.ts --wait 60          # narrow the window
bun scripts/probe-ably-retention.ts --expect-ephemeral # assert persistence is still off
bun scripts/probe-ably-retention.ts --quick            # live-channel read only, no wait
```

`--expect-ephemeral` refuses to run with a wait below 120s: below the ephemeral window a message
survives whether or not persistence is on, so the assertion would pass without proving anything. That
guard exists because the first 60s run of this probe reported "persistence is on" from exactly that
false reading — the interpretation was hardcoded to the default wait. Worth knowing if the numbers
above are ever re-derived by hand.
