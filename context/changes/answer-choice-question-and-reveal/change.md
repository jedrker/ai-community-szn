---
change_id: answer-choice-question-and-reveal
title: Attendee answers a choice question and learns their result
status: impl_reviewed
created: 2026-08-08
updated: 2026-08-08
---

## Notes

Roadmap item **S-03** — the north star. Prerequisite S-02 is `done`; F-03 and F-04 are `done`.
Nothing blocks implementation.

PRD refs: US-01, US-02, FR-004, FR-010, FR-016, FR-019 (and FR-017 for the unscored questions).

### What this slice inherits, and from where

- `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md` — three
  non-reliances. Rule 2 ("no authoritative state in the browser") and rule 3 ("no read-then-write on
  the store") both bind directly here.
- `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` — required reading
  before adding a `livequiz:` key. This slice adds two.
- `context/archive/2026-08-07-join-and-follow-host/join-contract.md` — the client convention, the
  shuffled option order, and the one claim this slice was told to re-take rather than inherit (the
  player id as a bearer credential).
- `context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md` — Upstash bills the
  `EVAL` *and* every `redis.call` inside it. §"One design consequence for S-03" names this slice's
  submission script as the first place script length actually costs money.

### The decisions taken during planning

All twelve are recorded in `plan-brief.md` §Key Decisions Made. The four that shape everything else:

1. Answers live in **one** registered hash keyed `<questionId>:<playerId>`, not one key per question.
2. Scoring happens **at submit**, inside the same `EVAL` that records the answer.
3. The `question-revealed` snapshot carries the **correct option ids**; the award and running total
   are fetched per device. Correctness therefore lands even if that fetch fails.
4. The **first answer locks** — no changes before the reveal.

### The finding that came out of planning and is not in the roadmap

Pricing the submission path against the S-02 attribution method puts a real 150-attendee event at
roughly **27k store commands**, against the ~500–600 measured for S-02 — a ~40× rise. Two
consequences, and plan review separated them after the first draft conflated them:

- Ten events a month reaches **~54% of the documented 500K/month plan ceiling**, up from ~1%.
- The runbook's tripwire is **per run** ("Above ~200K attributable to a single run",
  `docs/runbook-live-session.md:72`), so nothing is crossed. What shrinks is the margin it cites as
  its justification: from "roughly 125× above a real session" to roughly **7×**.

Phase 5 measures the real figure and records both, **without moving the threshold** — the same
runbook section warns that raising it as usage grows is how it stops working. See `plan.md`
§Critical Implementation Details.
