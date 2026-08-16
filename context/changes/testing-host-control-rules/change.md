---
change_id: testing-host-control-rules
title: Make the host panel's phase-to-verb rules executable
status: preparing
created: 2026-08-16
updated: 2026-08-16
archived_at: null
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md`: "Host control rules, executable".

**Goal.** Prove the panel offers exactly the verbs the phase accepts by running the decision, not by
reading its source. Test types planned: unit.

**Risks covered (from §2 of the test plan):**

- **Risk #1** — The host panel offers a flow verb the current phase refuses, or withholds the one it
  accepts, so the host presses a dead button in front of a live room. Impact High, Likelihood High.
  Evidence: interview Q3 (the host panel is the area the team changes most without confidence),
  hot-spot dir `src/pages/quiz/` at 73 commits/30d, PRD FR-002/003/004/006/014, PRD Success Criteria
  (the host does not fight the tool).
- **Risk #2** — A regression reaches a live session because the suite was green: the guard covering
  that area asserts source shape rather than behaviour and cannot fail when the behaviour breaks.
  Impact High, Likelihood High. Evidence: interview Q2, three entries in
  `context/foundation/lessons.md`, `context/archive/2026-08-14-per-question-timer/`.

**Risk response intent (to verify, not accept):**

- Risk #1: prove that, given a phase and a question position, exactly the verbs the routes accept are
  offered, and that the last-question case differs from the mid-quiz case. Challenge "the routes
  refuse illegal transitions anyway, so the panel is cosmetic" — the panel is the interaction and the
  route refusal is only the backstop.
- Risk #2: prove that each guard fails when the code it covers is broken and passes when restored,
  demonstrated rather than assumed. Challenge "the test is green, therefore the behaviour holds" — a
  scan for an expression that exists today certifies whatever is there, defects included.

**Scope note.** This phase covers Risk #1 in its *decision* half only. The visual half — whether the
enabled verb is legible and correctly placed on a projector — is deliberately out of scope for the
whole rollout; see §7 of the test plan for that decision and its re-evaluation triggers.
