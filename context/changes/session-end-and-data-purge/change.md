---
change_id: session-end-and-data-purge
title: "Session end and data purge"
roadmap_id: F-03
status: impl_reviewed
created: 2026-08-06
updated: 2026-08-06
---

# Session end and data purge

Roadmap item **F-03** from `context/foundation/roadmap.md`. PRD refs: Success Criteria guardrail
(post-session retention), Access Control Changes (identity within a session), Non-Goals (no result
history, no post-session analytics).

## Outcome

A session can be explicitly ended, and afterwards no attendee display name or submitted answer
remains in operator-accessible storage.

## Why this slice now

F-02 landed, which was its only gate. The roadmap sequences this with the spine rather than after the
features for a stated reason: it is cheap while the store holds one small document and expensive once
four question mechanics write to it. It must also land before any slice from S-02 onward collects a
real display name at a real event — S-02 is the first slice that does.

The second reason is that the data this guardrail protects does not exist yet. `SessionState` carries
flow only. That makes F-03 less a deletion and more a **retention contract** that S-02, S-03 and S-07
are bound by before they are written — which is only possible while they are unwritten.

## Scope boundary against later slices

- **No attendee view.** The terminal `ended` snapshot and its contract land here; the screen an
  attendee actually sees is S-02's, which owns the attendee view and Open Roadmap Question 2.
- **No client-side storage lifecycle.** S-09 introduces same-device resume and owns whatever it puts
  in the browser. Deliberately excluded — see `plan.md` §What We're NOT Doing.
- **No players, answers or scores.** S-02, S-03 and S-07 add them; this slice defines where they must
  live and how they must die.
