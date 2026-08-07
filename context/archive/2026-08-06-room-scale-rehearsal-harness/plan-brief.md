# Room-scale rehearsal harness — Plan Brief

> Full plan: `context/changes/room-scale-rehearsal-harness/plan.md`

## What & Why

Roadmap F-04. Drive ~150 simulated devices through a real session and **measure** fan-out latency
instead of assuming it. The PRD's binding guardrail — every attendee's screen reflects the host within
1 second — has never been measured, and F-01's upgrade tripwire is calibrated against a number that
does not yet exist.

## Starting Point

The spine works: `start`/`advance`/`reveal`/`end`/`purge` run in `fra1`, state is server-authoritative
in Upstash, snapshots fan out over Ably. What is missing is any measurement. F-02's
`latency-probe.md` fixed the *method* — anchored at the host's click, not the HTTP response — and left
the Measurements table as `_pending_`. It also handed this slice an unresolved clock strategy for
150 devices. Teardown arrived with F-03: `purge` plus `check-purge-residue.ts`, which refuses to run
while a session exists.

## Desired End State

`bun scripts/rehearse-room.ts` drives a production session with 150 subscribed clients, prints p95 /
median / max plus how many clients actually connected and received each version, and purges afterwards.
`latency-probe.md` holds real rows naming the function region, and states whether the guardrail holds.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Rehearsal target | Production, dedicated session | Preview returns 302 to Vercel SSO for anonymous clients, so simulated devices cannot reach it | Change notes |
| Target attendance | 150 | Matches the PRD guardrail; leaves ~25% headroom under the 200-connection free ceiling | Change notes |
| Clock strategy | One process, one clock | Removes skew entirely rather than correcting for it; cost is that the figure is a lower bound | Plan |
| Answer loss | Out of scope this slice | The spine has no answers until S-03 — measuring it now would measure fiction | Plan |
| Harness form | `bun` script in `scripts/` | Keeps the host secret local, so the "harness never runs in production" invariant survives | Plan |
| Isolation | Pre-flight refusal + purge | Reuses the proven gate; no new keys, so F-03's retention surface is untouched | Plan |
| Verdict statistic | p95 < 1000 ms | One stalled client cannot fail a run, and median/max keep the tail visible | Plan |
| Token acquisition | 150 separate requests | Also exercises the deliberately unthrottled token endpoint under a join burst | Plan |
| Connection failures | Reported as their own metric | "Only 120/150 connected" is the most important result this harness can return | Plan |
| Where results land | Fill F-02's `latency-probe.md` | The method lives there, so the numbers cannot drift from it | Plan |
| Cold start | Warm-up action, discarded visibly | Separates cold-start cost from fan-out cost | Plan |
| Gating | Does not block S-02; baseline before S-03 | Keeps the critical path moving while the guardrail keeps a deadline | Plan |

## Scope

**In scope:** hand-run harness script; N configurable client pool with per-client arrival capture;
p95/median/max plus connected and received counts; warm-up discard; pre-flight refusal and purge
teardown; production run; results recorded with region; runbook entry.

**Out of scope:** answer loss (needs S-03); enabling `LIVEQUIZ_HARNESS` in production; extending
`/quiz/spine-check`; new keys in `keys.ts`; rehearsal-only namespace or channel; simulated concurrent
store writes; CI automation; real phones at scale.

## Architecture / Approach

One local process holds both roles — it is the host (secret in `process.env`, never in a browser) and
the room (N Ably `Realtime` subscribers). Because the click instant and every arrival instant come off
the same clock, skew is structurally absent. The honest cost, stated in the report: one machine on one
network is a **lower bound** on what a room of phones sees. Isolation is the pre-flight refusal already
proven in `check-purge-residue.ts` — any existing session document means abort — so no new keys and no
collision with a real session.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Drive and teardown | Script drives start/advance/reveal/purge at N=0–1, with the safety gate | Astro's `Origin` check 403s before the handler; a missing header reads as a broken endpoint |
| 2. Measurement at scale | 150 clients, arrival capture, p95 verdict, warm-up discard | Local machine, not the platform, becomes the bottleneck and the shortfall is misattributed |
| 3. Production run and baseline | Spend alert recorded, run taken, `latency-probe.md` filled, runbook entry | A figure taken from a pre-`fra1` build measures `iad1` and must not be recorded |

**Prerequisites:** F-02 and F-03 (both done); Upstash and Ably credentials pulled locally
(`vercel env pull`); `LIVEQUIZ_HOST_SECRET`; a spend alert configured on the Upstash database; no live
session and no event in progress.

**Estimated effort:** ~2 sessions — one to build and verify phases 1–2, one for the production run and
write-up.

## Open Risks & Assumptions

- The headline figure is a **lower bound**, not a room simulation. If it fails the 1 s budget, real
  devices are worse; if it passes, that is not proof the venue network passes.
- Phase 3 edits a file under `context/archive/`, which `CLAUDE.md` forbids skills from doing. This is
  a deliberate, user-chosen exception, scoped to three sections; the full raw output also lives in this
  change folder so the change survives reverting that edit.
- The spend alert is a manual console step outside the repo, so the record of it is the only evidence.
- 150 connections sit against a 200 free ceiling — a run overlapping anything else holding connections
  will report a shortfall that is a scheduling artifact, not a platform limit.
- `check-purge-residue.ts`'s decoy key survives a purge by design. Do not read that as residue.

## Success Criteria (Summary)

- A real p95 fan-out figure exists, taken from `fra1`, with an explicit verdict against the 1 s budget
  and whether F-01's tripwire fired.
- The run reports how many of 150 clients connected and received each version — no silent averaging
  over missing devices.
- The namespace is empty afterwards, so rehearsals leave nothing behind and can be repeated.
