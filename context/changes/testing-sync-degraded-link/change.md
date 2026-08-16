---
change_id: testing-sync-degraded-link
title: Sync under a degraded link — rollout phase 2 of the test plan
status: implemented
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md`: "Sync under a degraded link".

Risks covered:

- **#3** — a host transition reaches some phones and not others; the room desynchronises and nothing
  on stage indicates which devices are stuck.
- **#4** — an answer submitted before the reveal is lost from the tally, or counted twice, under
  room-scale concurrency.

Test types planned: integration.

Risk response intent (from §2 Risk Response Guidance):

- **#3** — prove a device whose primary transport drops converges on the host's current phase within
  the guardrail, and that a stop actually stops.
- **#4** — prove an answer accepted at the deadline boundary appears in the tally exactly once, and
  that concurrent submissions do not lose each other.
