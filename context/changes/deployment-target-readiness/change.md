---
change_id: deployment-target-readiness
title: "Deployment target readiness (Hobby-plan variant)"
roadmap_id: F-01
status: implementing
created: 2026-08-05
updated: 2026-08-06
---

# Deployment target readiness

Roadmap item **F-01** from `context/foundation/roadmap.md`.

## Outcome

The deployment target is a known, documented quantity before any realtime work rides on it: the
adapter cannot silently pull an Astro major, the intended function region is declared in version
control with its real behaviour on the current plan recorded rather than assumed, and the
logs/rollback loop that F-04 depends on has been exercised at least once.

## Scope decision (differs from the roadmap entry)

The roadmap and `context/foundation/infrastructure.md` both name a **Vercel Pro upgrade** as a
prerequisite. The user decided on `2026-08-05` to **stay on the Hobby plan**, on the grounds that
although the site carries Brave Courses branding, it is a free local community initiative rather than
a commercial project. That decision removes two of F-01's three original outcomes from reach:

- **EU function region** — Hobby pins functions to `iad1` (US East); region selection is Pro+.
- **Extended log retention** — Hobby retains runtime logs for one hour.

Both are handled as accepted risks with explicit compensating actions, not silently dropped. See
`plan.md` §Open Risks and the recorded tripwire.

## Artifacts

- `plan.md` — implementation contract
- `plan-brief.md` — compressed handoff
- `reviews/plan-review.md` — pre-code readiness review (verdict SOUND after triage; 7/7 findings fixed)

## Links

- Roadmap: `context/foundation/roadmap.md` (F-01)
- Infrastructure decision: `context/foundation/infrastructure.md`
- Stack contract: `context/foundation/tech-stack.md`
