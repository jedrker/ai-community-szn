---
change_id: room-scale-rehearsal-harness
title: Room scale rehearsal harness
status: implementing
created: 2026-08-06
updated: 2026-08-06
archived_at: null
---

## Notes

Roadmap item F-04. Two of its four unknowns were owned by the user and are now decided
(2026-08-06); the other two stay with this change.

**Decided — rehearsal target: production, in a dedicated session.** The harness drives the
production deployment, but against a quiz session of its own, outside any event, with a purge after
every run. Preview was rejected: F-01 established that preview URLs on this project return `302` to
Vercel SSO for anonymous visitors, so simulated attendee devices cannot reach one without either
disabling protection for the window or authenticating — and the second option measures a different
path than the phones in the room will take. Production is the only target that measures the real
`fra1` propagation and the real provider. Accepted costs: the runs load production and consume the
provider's free message allowance.

**Decided — target attendance: 150.** Matches the PRD guardrail (150 concurrent, no lost answers)
and leaves roughly a quarter of headroom under the provider's free ceiling of 200 peak connections.

**Still open, owned by this change:**

- Record the latency figure *with its region*. Functions run in `fra1` only for builds made after
  the region key landed; any number taken from a deployment predating that merge measures `iad1` and
  must not become the baseline. This figure feeds F-01's upgrade tripwire.
- Confirm a spend alert is wired on the state store before the first rehearsal. A polling design
  instead of a push design multiplies store operations by roughly an order of magnitude per session —
  cheap in money, but the alert is the tripwire that catches that architectural mistake while it is
  still cheap to fix.

**Teardown already exists (from F-03):** `POST /api/quiz/host/purge` removes every registered key, so
repeated runs do not accumulate state, and `scripts/check-purge-residue.ts` refuses to run while a
session document exists — which doubles as a pre-rehearsal check. The purge route requires the
session's current version as confirmation, so the harness must read state before calling it.

Before adding any key or any field to a published snapshot, read
`context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`.
