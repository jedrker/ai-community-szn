---
change_id: session-state-and-realtime-spine
title: "Session state and realtime fan-out spine"
roadmap_id: F-02
status: impl_reviewed
created: 2026-08-06
updated: 2026-08-06
---

# Session state and realtime fan-out spine

Roadmap item **F-02** from `context/foundation/roadmap.md`. PRD refs: Success Criteria guardrails
(1-second reflection; 150 concurrent with no lost answers and no divergence between devices), Open
Question 7.

## Outcome

One live session's state is held server-authoritatively in a short-TTL store outside the request
lifecycle, and a state change made by the host reaches every connected device within a second — with
devices receiving a short-lived token from the project's own endpoint rather than any provider key.

## Why this slice now

F-01 landed, which was its only gate. Every user-facing slice except S-01 sits on this spine: S-02
cannot join a session that has no state, and F-03 and F-04 both need something to purge and something
to drive. It is also where the project's first server-held state and first realtime transport enter a
codebase that has had neither.

## Scope boundary against later slices

This change delivers the **spine and a proof that it moves state**. It deliberately does not implement
any user-facing session behaviour:

- **S-02** owns the join flow, the atomic display-name claim, and the real attendee view. The
  interactivity approach chosen for this slice's throwaway harness is a preliminary answer, not the
  settled one — Open Roadmap Question 2 remains S-02's to close.
- **S-03** owns answers and scoring; nothing here scores anything.
- **F-03** owns explicit end-and-purge. This slice sets the TTL that makes the retention guardrail
  hold by default even before F-03 exists.
- **F-04** owns the 150-device measurement. This slice records a single-device latency figure with its
  region, as the input F-04 builds on.

## Artifacts

- `plan.md` — implementation contract
- `plan-brief.md` — compressed handoff
- `reviews/plan-review.md` — plan review, all 7 findings triaged and fixed
- `spine-contract.md` — what S-02 onward may and may not rely on
- `latency-probe.md` — measurement method and reference points; **figures still pending**
- `reviews/impl-review.md` — implementation review (3 warnings, 2 observations)

## Close-out state (2026-08-06)

35 of 38 Progress criteria met. Outstanding, and deliberately not approximated:

- **4.5 / 4.7** — the two-device fan-out and reload checks. The preview is deployed and ready.
- **4.8** — `latency-probe.md`'s measurement table. Method and reference points are fixed; no figure
  has been taken, because F-04's baseline and F-01's latency tripwire both depend on this number
  being measured from the host's click in a confirmed `fra1` deployment.

What *is* verified on production: the atomic version guard (two racing writes → one applied, one
`already-applied`, room moved exactly one question), `session.publish.ok` per action, structured logs
in `vercel logs`, `/quiz/spine-check` returning 404, and every existing page and form unaffected.

**3.12** was skipped by decision — the broken-credential path is covered by unit tests rather than a
live env change.

## Links

- Roadmap: `context/foundation/roadmap.md` (F-02)
- PRD: `context/foundation/prd.md` (Success Criteria guardrails, Open Question 7)
- Infrastructure decision: `context/foundation/infrastructure.md` (Ably, Upstash, Getting Started 3–4)
- Predecessor: `context/archive/2026-08-05-deployment-target-readiness/` (F-01)
- Operational contract: `docs/runbook-live-session.md`
