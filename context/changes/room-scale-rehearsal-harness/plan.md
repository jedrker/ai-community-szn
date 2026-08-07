# Room-scale rehearsal harness Implementation Plan

## Overview

Roadmap F-04. Drive roughly 150 simulated devices through a real session against the production
deployment, and **measure** fan-out latency rather than assume it. The output is a number: the first
real figure for the PRD's binding guardrail ("every attendee's screen reflects the host's current
question or reveal within 1 second of the host acting"), recorded with the region it was taken from,
because it is the input to F-01's upgrade tripwire.

The harness is a hand-run script, not shipped behaviour.

## Current State Analysis

The spine exists and works. What does not exist is any measurement of it.

- **The F-02 baseline was never taken.** `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md`
  carries the header "Status: method recorded, measurement pending" and a Measurements table whose only
  row is `_pending_`. The *method* is fixed there and is not up for renegotiation: the figure is
  anchored at the host's click, not at the HTTP response, because anchoring at the response excludes
  the endpoint round trip, the store `EVAL` and the Ably publish — most of the server-side budget.
  Two figures are defined: **end to end** (click → snapshot rendered, the headline) and **round trip**
  (click → HTTP response, secondary). Their difference is the fan-out.
- **The existing harness cannot be used for this.** `/quiz/spine-check` is gated by
  `isHarnessEnabled()` (`src/lib/session/harness.ts`), which reads `LIVEQUIZ_HARNESS` — set in Preview
  and local development only. The reason is load-bearing and documented in that module: the page sends
  the host secret from the browser, which "is acceptable *only* because it never runs in production."
  F-02 verified the production 404 as its own check (commit `25b7ca8`). This plan does not touch that
  gate.
- **`latency-probe.md` hands this slice an explicit decision.** Both F-02 figures are taken on one
  device's clock, because two devices have unsynchronised clocks and a phone-side absolute delta would
  measure skew as much as latency. The document says driving ~150 devices "needs a clock strategy this
  slice does not provide … Decide that before F-04 reports a number, not after."
- **Teardown already exists, with an ordering trap.** `POST /api/quiz/host/purge` deletes every
  registered key; `scripts/check-purge-residue.ts` refuses to run while any session document exists,
  which doubles as a pre-flight check. Purge requires `confirmVersion` — the caller must have read
  state to know it (`extractHostFields`, `src/lib/session/host.ts:98`).
- **Two traps recorded in `spine-contract.md`.** Astro rejects a `request.formData()` POST with
  `403 Cross-site POST form submissions are forbidden` *before the handler runs* unless `Origin`
  matches — so `curl`/Node callers must set it, or a 403 reads as a broken endpoint. And the Vercel
  Marketplace injects `KV_REST_API_*`, not the documented `UPSTASH_REDIS_REST_*`.
- **The session document is flow-only.** `SessionState` carries `version`, `phase`,
  `currentQuestionId`, `startedAt`, `updatedAt` and nothing else. There are no players, no answers and
  no scores — those arrive in S-02 and S-03.

## Desired End State

`bun scripts/rehearse-room.ts` drives a production session through a warm-up plus several measured
host actions with N subscribed clients, prints per-action statistics and a pass/fail verdict against
the 1000 ms budget, and purges the namespace afterwards. `latency-probe.md`'s Measurements table
holds real rows naming the function region, and its "Result against the guardrail" section states
explicitly whether the headline figure is under 1000 ms and whether F-01's tripwire has fired.

Verified by: running it, reading the printed verdict, and confirming
`bun scripts/check-purge-residue.ts` finds an empty namespace afterwards.

### Key Discoveries:

- The measurement anchor and the two figures are already specified —
  `latency-probe.md` §"Why the reference point is written down". Do not re-derive them.
- `createTokenRequest` returns a token *request*, not a token (`src/lib/session/realtime.ts:86`);
  the client exchanges it with Ably itself. An Ably client consumes this shape natively via
  `authUrl`, so 150 clients pointed at `/api/quiz/token` produce 150 endpoint hits — which is the
  intended load, since that endpoint is deliberately open and unthrottled.
- `publishSnapshot` uses `Rest`, not `Realtime` (`src/lib/session/realtime.ts:20`) — a serverless
  function must not hold a socket. The harness is the opposite case: it is a long-lived local process
  and *does* use `Realtime` clients.
- Scripts mirror constants rather than importing them, because `src/` modules read
  `import.meta.env`, which is unpopulated under bare `bun`
  (`scripts/check-purge-residue.ts:31-38`). Config comes from `process.env`.
- Clients drop any snapshot whose version is not strictly greater than the one held
  (`spine-contract.md` §"Client rule"). The harness must apply the same rule, or a republish would
  be counted as a fresh arrival.
- `SESSION_CHANNEL` is `livequiz:session` and the message name is `snapshot`
  (`src/lib/session/keys.ts:83`, `realtime.ts:41`).

## What We're NOT Doing

- **Not measuring answer loss.** The guardrail "150 concurrent with no lost answers" cannot be
  measured against a spine that has no answers. The harness is structured so an answer path can be
  added after S-03 and the run repeated; this slice reports fan-out and subscribe scale only.
- **Not enabling `LIVEQUIZ_HARNESS` in production**, and not extending `/quiz/spine-check`.
- **Not adding any key to `keys.ts`**, and therefore not touching the retention surface F-03 closed.
- **Not adding a rehearsal-only namespace or channel** — the run uses the real ones, which is the
  only way the number describes the real thing.
- **Not simulating 150 concurrent store writes.** That is S-02/S-03 shaped load; inventing a traffic
  shape now would measure fiction.
- **Not automating the run in CI.** There is no CI, and a credential-gated production load test is
  not something to fire on push.
- **Not measuring from real phones at scale.** One process, one clock — see the Approach.

## Implementation Approach

A single hand-run script holding both roles: it *is* the host (holding `LIVEQUIZ_HOST_SECRET` locally,
never in a browser) and it *is* the room (N Ably `Realtime` subscribers). Because both live in one
process, the click instant and every arrival instant are read from the same clock, which removes clock
skew from the measurement entirely rather than correcting for it. The cost is honest and must be
stated in the report: one machine on one network is a **lower bound** on what a room of phones will
see, not a simulation of it.

Isolation comes from the pre-flight refusal already proven in `check-purge-residue.ts`: any existing
session document at all means abort. So a rehearsal cannot collide with a real session, and no new
keys are needed.

## Critical Implementation Details

**Timing & lifecycle.** The first host action pays a function cold start, which is not fan-out cost.
The script therefore fires one warm-up action whose figures are discarded, then measures subsequent
actions. Discarding must be explicit in the output — a silently dropped sample is indistinguishable
from a flattering one.

**State sequencing.** Subscribers must be connected *and* have received the lobby snapshot before the
first measured action, otherwise an arrival is racing connection setup rather than fan-out. Purge runs
last and needs a `confirmVersion` read first; per `retention-contract.md`, purge's own internal order
is write → publish → **then** delete, and that is the route's business, not the harness's.

**Debug & observability.** The function region must be read from the `x-vercel-id` response header
(`<edge>::<function-region>::<id>`) during the run, not assumed from `vercel.json`. The roadmap is
explicit that a figure from a deployment predating `regions: ["fra1"]` measures `iad1` and must not be
recorded as the baseline.

## Phase 1: Drive and teardown

### Overview

A script that can start, advance, reveal and purge a production session, with the safety gate in
place, verified at N=1 before any load exists. Nothing is measured yet.

### Changes Required:

#### 1. Harness script skeleton

**File**: `scripts/rehearse-room.ts` (new)

**Intent**: Establish the script's shape, config resolution and safety gate, following
`scripts/check-purge-residue.ts` — hand-run, credential-gated, nothing under `src/` importing it, with
a module docstring stating what it measures and why a mock cannot do the job. Mirror `SESSION_KEY`,
`SESSION_CHANNEL` and `snapshot` as local constants with an assertion that they still match the
registry, for the `import.meta.env` reason recorded in that script.

**Contract**: Reads `process.env` for `KV_REST_API_URL`/`KV_REST_API_TOKEN` (falling back to the
`UPSTASH_REDIS_REST_*` pair), `LIVEQUIZ_HOST_SECRET`, and a base URL. Absent credentials exit non-zero
with the `vercel env pull` hint. Run as `bun scripts/rehearse-room.ts`.

#### 2. Pre-flight refusal

**File**: `scripts/rehearse-room.ts`

**Intent**: Refuse to run when any session document exists, for the reason spelled out in
`check-purge-residue.ts`: `lobby` is exactly the state a host creates minutes before a segment, and an
`ended` session is live data inside its ten-minute window. Report the phase found, then abort.

**Contract**: `GET livequiz:session` non-null → print the phase and exit non-zero without touching
anything.

#### 3. Host action driver

**File**: `scripts/rehearse-room.ts`

**Intent**: Call the host routes as a real host would, and surface the outcome vocabulary rather than
flattening it — `applied: false` with `note: "already-applied"` or `"no-op"` is a distinct result from
success and must not be counted as a measured action.

**Contract**: POSTs to `/api/quiz/host/{start,advance,reveal}` with the `x-livequiz-host-secret`
header **and an `Origin` header matching the base URL** — without it Astro returns
`403 Cross-site POST form submissions are forbidden` before the handler runs. Records the response's
`x-vercel-id` and the returned `state.version`.

#### 4. Teardown

**File**: `scripts/rehearse-room.ts`

**Intent**: Purge the namespace at the end of a run, including when the run fails partway, so repeated
rehearsals do not accumulate state.

**Contract**: Reads current state (`GET /api/quiz/state`), then POSTs `/api/quiz/host/purge` with the
secret and `version` as the confirmation field. A 409 means the session moved — report it rather than
retrying blindly.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `bun run type-check`
- Existing suite still passes: `bun run test`
- Script refuses to run with credentials absent: `bun scripts/rehearse-room.ts` exits non-zero

#### Manual Verification:

- Against production with no session present, a run at N=0 completes start → advance → reveal → purge
- `bun scripts/check-purge-residue.ts` afterwards reports an empty namespace
- Seeding a session document first causes the pre-flight to refuse and name the phase
- Omitting the `Origin` header reproduces the documented 403, confirming the header is what satisfies it

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Measurement at scale

### Overview

N subscribed clients, per-client arrival capture, and the statistics that turn arrivals into a verdict.

### Changes Required:

#### 1. Simulated device pool

**File**: `scripts/rehearse-room.ts`

**Intent**: Stand up N Ably `Realtime` clients, each fetching its own token from the project's
endpoint exactly as a phone would, so the run also exercises the token endpoint under a join burst.
Connection failures are a first-class result, not an error to swallow.

**Contract**: N defaults to 150 and is overridable by argument. Each client authenticates via
`authUrl` pointed at `<base>/api/quiz/token` and subscribes to `livequiz:session` for `snapshot`.
Barrier: all clients connected and holding the lobby snapshot before any measured action.

#### 2. Arrival capture and the version rule

**File**: `scripts/rehearse-room.ts`

**Intent**: Record, per client, the instant the snapshot for a given version arrives, applying the same
rule real clients follow — take a snapshot only if its version is strictly greater than the one held —
so a republish is not miscounted as a fresh arrival.

**Contract**: Per measured action, produce for each client either an arrival delta in ms measured from
the same clock that issued the request, or a miss. Separate "never connected" from "connected but no
snapshot" — they have different causes and different fixes.

#### 3. Warm-up and statistics

**File**: `scripts/rehearse-room.ts`

**Intent**: Discard the first action's figures as cold-start cost, visibly, then report the two figures
`latency-probe.md` defines plus the population metrics that say whether the sample is trustworthy.

**Contract**: Per measured action report end-to-end p95 (the verdict statistic), median and max;
round-trip time; clients connected out of N; clients that received the version. Verdict is
**p95 < 1000 ms**, with median and max always printed so the tail stays visible. Exit code reflects
the verdict.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `bun run type-check`
- Existing suite still passes: `bun run test`
- A run at N=1 against production prints a verdict and non-zero connected count

#### Manual Verification:

- N=150 run reports connected count and per-version receipt counts, and 150 token requests are visible
  in the deployment logs
- The warm-up action is labelled as discarded in the output
- Killing a subset of clients mid-run surfaces them as misses rather than skewing the p95 silently
- Store operations during the run are consistent with a push design — no per-client polling of
  `/api/quiz/state`

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Production run and recorded baseline

### Overview

Take the number under the conditions the report will claim, and write it down where the method already
lives.

### Changes Required:

#### 1. Spend alert prerequisite

**File**: `context/changes/room-scale-rehearsal-harness/rehearsal-report.md` (new)

**Intent**: Record that a spend alert is configured on the Upstash database before the first load run,
with what threshold and when it was verified. Per the roadmap this alert is the tripwire that catches a
polling-shaped design while it is still cheap to fix; it is a manual console step outside the repo, so
the evidence is the record.

**Contract**: A dated line naming the threshold and who verified it. The run does not proceed without
it.

#### 2. Region confirmation and the run

**File**: `context/changes/room-scale-rehearsal-harness/rehearsal-report.md`

**Intent**: Capture the run's conditions — deployment URL, function region read from `x-vercel-id`,
client count, machine and network — alongside the raw output, so the headline figure can be audited
rather than trusted. State plainly that one process on one network is a lower bound on a room of
phones.

**Contract**: Includes the observed `x-vercel-id` region segment. A region other than `fra1` invalidates
the run as a baseline and must be reported as such, not footnoted.

#### 3. Fill in the F-02 latency probe

**File**: `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md`

**Intent**: Replace the `_pending_` Measurements row with real rows and complete the "Result against
the guardrail" section, stating explicitly whether the headline is under 1000 ms and whether F-01's
tripwire has fired. This is where the method is written down, so this is where the numbers belong.

**Contract**: Existing table columns are kept as-is (Date, Deployment, Function region, Action, End to
end, Round trip, Client device / network). A "Client device / network" value of one process on one
machine is stated as such. Also resolve the file's own "This is a real limitation for F-04" paragraph
by naming the clock strategy chosen: one process, one clock.

> **Authorized exception.** `CLAUDE.md` forbids skills from writing to `context/archive/`, and this
> step deliberately breaks that rule — the user chose it over a standalone report so the baseline
> cannot drift from the method that defines it. Confine the edit to the Measurements table, the Result
> section, and the F-04 limitation paragraph. `rehearsal-report.md` in this change folder carries the
> full raw output, so the change stays self-contained if the archive edit is later reverted.

#### 4. Rehearsal entry in the runbook

**File**: `docs/runbook-live-session.md`

**Intent**: Add the pre-session rehearsal to the existing runbook: how to run the harness, that it
refuses when a session exists, and that it purges afterwards.

**Contract**: A short section following the file's existing structure, naming
`bun scripts/rehearse-room.ts` and `bun scripts/check-purge-residue.ts`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `bun run type-check`
- Full suite passes: `bun run test`
- `bun scripts/check-purge-residue.ts` reports an empty namespace after the final run

#### Manual Verification:

- Spend alert confirmed configured, and recorded with its threshold, before the load run
- Function region observed as `fra1` from `x-vercel-id` during the run
- `latency-probe.md` Measurements table holds real rows; no `_pending_` remains
- Guardrail verdict stated explicitly, including whether F-01's tripwire fired
- Runbook section is followable by someone who did not write the harness

---

## Testing Strategy

### Unit Tests:

The harness is a probe, not shipped behaviour, and `check-purge-residue.ts` sets the precedent that
probes are not unit-tested — a mock cannot answer the question they exist to ask. The claims worth
asserting in code are already asserted: `store.test.ts` covers the version guard,
`routes.test.ts` the host routes, `keys.test.ts` the registry.

The one thing to assert in the script itself is the mirrored-constant check — if `keys.ts` renames the
session key or channel, the script must fail loudly rather than measure the wrong channel and report a
comfortable zero arrivals.

### Integration Tests:

None added. The integration is the run.

### Manual Testing Steps:

1. Confirm no session exists, then run at N=0 and verify start → advance → reveal → purge.
2. Seed a session document and confirm the pre-flight refuses and names the phase.
3. Run at N=1, confirm one arrival and a printed verdict.
4. Confirm the spend alert, record it, then run at N=150.
5. Read the region from `x-vercel-id`; if it is not `fra1`, stop and report rather than record.
6. Run `check-purge-residue.ts` and confirm the namespace is empty.

## Performance Considerations

150 Ably `Realtime` connections from one process is the load being measured, and the free tier's
ceiling is 200 peak connections — so 150 leaves roughly a quarter of headroom and a run must not
overlap anything else holding connections. The local machine is a plausible bottleneck (file
descriptors, one network path); if connected counts fall short of N without provider-side errors,
suspect the harness before the platform.

150 token requests arrive as a burst against a deliberately unthrottled endpoint. That is intentional
load, and its cost belongs in the round-trip figure's neighbourhood, not folded into fan-out.

## Migration Notes

Nothing to migrate. No schema change, no new key, no change to shipped behaviour. Reverting this
change removes a script, a report and a runbook section.

## References

- Roadmap item: `context/foundation/roadmap.md` §F-04
- Change notes and decisions: `context/changes/room-scale-rehearsal-harness/change.md`
- Measurement method and the clock limitation it hands to F-04:
  `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md`
- Non-reliances (no presence, no browser truth, no read-then-write), and the `Origin` and
  `KV_REST_API_*` traps: `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md`
- Retention rules and `end`/`purge` semantics:
  `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Script precedent: `scripts/check-purge-residue.ts`
- Harness gate and why it never runs in production: `src/lib/session/harness.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Drive and teardown

#### Automated

- [x] 1.1 Type checking passes: `bun run type-check` — c82cb4d
- [x] 1.2 Existing suite still passes: `bun run test` — c82cb4d
- [x] 1.3 Script refuses to run with credentials absent — c82cb4d

#### Manual

- [ ] 1.4 N=0 run completes start → advance → reveal → purge against production
- [ ] 1.5 `check-purge-residue.ts` reports an empty namespace afterwards
- [ ] 1.6 Pre-flight refuses on a seeded session document and names the phase
- [ ] 1.7 Omitting `Origin` reproduces the documented 403

### Phase 2: Measurement at scale

#### Automated

- [x] 2.1 Type checking passes: `bun run type-check` — 629fe2f
- [x] 2.2 Existing suite still passes: `bun run test` — 629fe2f
- [ ] 2.3 N=1 run prints a verdict and non-zero connected count

#### Manual

- [ ] 2.4 N=150 run reports connected and per-version receipt counts; 150 token requests visible in logs
- [ ] 2.5 Warm-up action is labelled as discarded
- [ ] 2.6 Killed clients surface as misses rather than skewing p95
- [ ] 2.7 No per-client polling of `/api/quiz/state`

### Phase 3: Production run and recorded baseline

#### Automated

- [ ] 3.1 Type checking passes: `bun run type-check`
- [ ] 3.2 Full suite passes: `bun run test`
- [ ] 3.3 `check-purge-residue.ts` reports an empty namespace after the final run

#### Manual

- [ ] 3.4 Spend alert confirmed and recorded with its threshold before the load run
- [ ] 3.5 Function region observed as `fra1` from `x-vercel-id`
- [ ] 3.6 `latency-probe.md` Measurements table holds real rows; no `_pending_` remains
- [ ] 3.7 Guardrail verdict stated, including whether F-01's tripwire fired
- [ ] 3.8 Runbook section is followable by someone who did not write the harness
