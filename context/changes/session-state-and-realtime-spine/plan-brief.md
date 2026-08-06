# Session State and Realtime Fan-out Spine — Plan Brief

> Full plan: `context/changes/session-state-and-realtime-spine/plan.md`
> Roadmap item: `context/foundation/roadmap.md` (F-02)

## What & Why

Build the spine every remaining LiveQuiz slice rides on: one live session's state held
server-authoritatively in Upstash Redis under a short TTL, and a host state change fanned out over
Ably to every connected device inside one second — with the browser receiving a short-lived,
subscribe-only token from this project's own endpoint and never a provider key. Without it there is
nothing for an attendee to join, nothing for F-03 to purge, and nothing for F-04 to drive.

## Starting Point

The project has no server-held state and no realtime transport at all. Neither `ably` nor
`@upstash/redis` is a dependency. What *does* exist and gets reused: an on-demand serverless surface
(`output: "server"` plus the Vercel adapter, two POST handlers already running on it), the S-01 quiz
data contract at `src/quiz/index.ts` — deliberately importable from a serverless function — and a
fixed error posture in `src/lib/slack.ts`. Functions run in `fra1` as of F-01, so the latency budget is
measurable honestly.

## Desired End State

A host action fired on a laptop moves authoritative state in Redis and appears in a real browser on a
phone in under a second, repeatedly, with one structured log line per mutation visible in
`vercel logs`. A gated dev-only harness is what proves it; no attendee-facing feature exists yet.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| State store | Upstash Redis, EU region | Speaks HTTP so no persistent connection; per-key expiry makes the retention guardrail a default | Roadmap |
| Transport | Ably, REST publish from the server | GA and inside its free tier; Vercel-native WebSockets die before a 15-minute session ends | Roadmap |
| Proof of fan-out | Throwaway dev-only harness route | The spine is provably alive from a real browser before S-02 depends on it; F-04 gets a driveable surface | Plan |
| Broadcast payload | Full state snapshot plus monotonic version | Structurally removes the divergence failure — a device that missed a message self-corrects on the next one | Plan |
| Store layout | One JSON document under one key | A snapshot broadcast is one read, and TTL plus F-03's purge are one key | Plan |
| Version guard | Compare-and-set inside a Lua `EVAL` | Read-modify-write over HTTP is three round trips with no isolation and silently drops a concurrent host action | Plan |
| TTL | 4 hours, re-armed on every write | A stalled host cannot expire the room; an abandoned session self-purges the same evening | Plan |
| Failure behaviour | Fail loud to the host, log, never throw | A quietly dropped host action leaves the room a question behind while the host believes they advanced | Plan |
| Rejected (stale) write | Re-read and report "already applied" | A stage double-tap is a no-op, not a failure — but reporting plain success would make the host lose count | Review |
| State on connect | `GET /api/quiz/state`, reconciled by version | Snapshot-per-publish fixes devices that *missed* a message, not devices that were not yet listening | Review |
| Start semantics | `start` opens a `lobby`, first `advance` opens Q1 | FR-002 keeps the explicit start precisely to give the host a gathering beat | Review |
| Host authority | Shared secret on host routes | An attendee reading the network tab still cannot advance the quiz, without reopening the PRD's no-login decision | Plan |
| Client interactivity | Plain `<script>` in the `.astro` harness | Avoids installing a UI framework for a throwaway surface; Open Roadmap Question 2 stays S-02's to close | Plan |

## Scope

**In scope:** the two vendor dependencies and their configuration; a probe that confirms what the
platform actually injected *and* that `EVAL` executes; `src/lib/session/` (state schema, store with the
atomic version guard, realtime module, structured logger); a subscribe-only token endpoint; a state
read endpoint; three host-action endpoints behind the secret; a gated harness page; a recorded latency
figure with its region; a spine contract for downstream slices; a runbook update.

**Out of scope:** the join flow and the atomic display-name claim (S-02); answering and scoring (S-03);
explicit end-and-purge (F-03); the 150-device measurement (F-04); any real host or attendee UI; any
UI-framework integration; Ably presence; CI; the Vercel Pro upgrade.

## Architecture / Approach

```
host browser ──POST /api/quiz/host/{start,advance,reveal}  (host secret)
                        │
                        ├─► src/lib/session/store.ts ── EVAL: CAS + version++ + TTL re-arm ─► Upstash
                        │                                     (one key, one JSON document)
                        └─► src/lib/session/realtime.ts ── publish full snapshot ──► Ably channel
                                                                                        │
attendee browser ──GET /api/quiz/state   (once, on connect) ─────────────────────┐      │
               └───GET /api/quiz/token (subscribe-only) ── Ably SDK subscribe ◄──┼──────┘
                        └─► applies whichever source carries the higher version ─┘
```

The browser never holds authoritative state and never receives a key that can publish. The version is
the single mechanism doing four jobs: rejecting lost concurrent writes at the store, ordering snapshots
at the client, reconciling the fetch against the subscription, and making a failed publish safely
retryable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Provision & probe | Both dependencies, documented config, and empirical confirmation of the injected variable names and an EU round trip | Provisioning is human-gated (dashboard + authenticated CLI), as `vercel login` was in F-01 |
| 2. Session state module | Zod-validated state, the one-key layout, the atomic version guard, the structured logger, unit tests | The guard is the whole design — implemented in JS instead of Lua it passes every test and drops host actions live |
| 3. Ably spine & host actions | Subscribe-only token endpoint, snapshot publish, three host verbs behind the secret, fail-loud posture | Leaking publish capability into the client token, or copying slack.ts's quiet no-op into a host action |
| 4. Harness & fan-out proof | Gated `/quiz/spine-check`, a latency figure recorded with its region, the spine contract, runbook update | A harness reachable in production; or a latency figure recorded without its region, which F-04 says is worthless |

**Prerequisites:** F-01 (done — `fra1` is on `main`). A Vercel account holder to provision Upstash via
the Marketplace and run `vercel env add`. A second physical device on a real network for Phase 4.

**Estimated effort:** ~3–4 sessions across four phases, with Phase 1 gated on a human provisioning step
and Phase 4 on access to a second device.

## Open Risks & Assumptions

- **Lua scripting over Upstash's REST interface is assumed until Phase 1 probes it.** The whole
  atomicity design rests on `EVAL`; the probe now tests it explicitly, and a failure reopens Phase 2's
  approach before any of it is written rather than mid-build.
- **The injected Upstash variable names are assumed, not known.** `infrastructure.md` records that
  first-party Vercel KV no longer exists and that guidance naming it is stale, so Phase 1 probes rather
  than trusts. If the names differ, `.env.example` and `store.ts` follow the probe.
- **Nothing is verified at scale here.** One device, one figure. The 150-concurrent guardrail stays
  unproven until F-04, and this plan does not claim otherwise.
- **No automated integration coverage exists**, because both dependencies are external and there is no
  CI (Open Roadmap Question 3). The integration path is the Phase 1 probe plus the Phase 4 manual run —
  recorded as a decision, not an omission.
- **A code rollback does not revert session state.** `vercel rollback` reverts code only; a live session
  document survives it and the TTL is what removes it. Short TTL is the mitigation.
- **Ably's free ceiling is 200 peak connections** against a 150-person room (Open Roadmap Question 5) —
  headroom to check per event, not once.
- **The harness's plain-`<script>` approach is a preliminary answer only.** S-02 still owns the real
  client-interactivity decision, and this file is expected to be superseded there.

## Success Criteria (Summary)

- A host action fired on one screen appears on a phone on a real network in under one second **measured
  from the click**, repeatedly, with the figure written down alongside the function region and the
  instant it starts from.
- A device that connects or reloads mid-session renders current state immediately, without waiting for
  the host's next action.
- Two host actions racing at the same version produce exactly one applied write and one rejected one —
  no host action is silently lost.
- The browser can subscribe but cannot publish and never receives a provider key; with the store
  broken, the host reads a Polish error rather than believing the room advanced.
