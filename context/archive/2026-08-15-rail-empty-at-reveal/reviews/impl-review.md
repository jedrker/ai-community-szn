<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Empty host rail

- **Plan**: `context/changes/rail-empty-at-reveal/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan)
- **Date**: 2026-08-15
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Automated criteria re-run at review time: `bun run test` 1316 passed / 37 files;
`bun run type-check` 0 errors; `bun run build` complete. Changed files are exactly the planned
set — `src/pages/quiz/host.astro`, `src/pages/quiz/host.test.ts`, `CLAUDE.md`, plus the change
folder. `docs/runbook-live-session.md` was a planned no-op and correctly stayed untouched.

Seven manual rows in Phase 1 and two in Phase 2 remain `- [ ]`; they were not marked complete,
which is the correct state — no rubber-stamping found.

## Findings

### F1 — Two exit paths clear the countdown without re-running the rule

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/pages/quiz/host.astro:2334`, `:2339`
- **Detail**: `syncRail` reads the three blocks' `hidden` state, so anything that changes one of
  them outside `render` leaves the rail out of step until the next render. Every ordinary path is
  covered — `renderParticipation` and `renderWordCloudPanel` are called only from `render`, and the
  poll always finishes through `render()` including `pollFailed`. Two exceptions exist:
  `visibilitychange → hidden` and `pagehide` both call `stopCountdown()` directly. If the clock was
  the only visible block, the rail is left on screen and empty from that moment.

  Not user-visible today, and that is why this is an observation rather than a warning: both fire
  precisely when nobody is looking at the page, and both return through a `render()` — the
  `visibilitychange` else-branch and the `pageshow` listener — which re-establishes the rule before
  anything is seen. The risk is the next block added to the rail: if its teardown is called from a
  path a viewer *can* see, the same shape becomes a visible defect with no test to catch it.
- **Fix**: Call `syncRail()` after `stopCountdown()` in both listeners, or fold it into
  `stopCountdown` itself so the rule cannot be skipped by a caller.
- **Decision**: FIXED — `syncRail()` folded into `stopCountdown`; guard raised to three sites and verified in both directions

### F2 — `#rail` is the only rail region that does not start hidden in markup

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/host.astro:369`
- **Detail**: `#participation` (`:381`), `#word-cloud` (`:422`) and `#host-countdown` (`:464`) all
  carry `hidden` in the markup and are switched on by the script; the page's convention is that a
  region which starts off screen says so in HTML. `#rail` carries no `hidden`, which was right when
  it was visible in every phase but `ended` and is no longer: the server-rendered page now paints a
  440px empty column that the first `render()` collapses. The window is one frame in practice — the
  inline script runs straight after parse — but on a projector a column that appears and folds is
  the kind of motion the redesign spent effort removing.

  The counter-argument is real and is why this is not a warning: if the script never runs at all,
  `hidden` in markup means the rail never appears, whereas today it appears empty. Both are broken
  states; neither is clearly better.
- **Fix**: Add `hidden` to the `<aside id="rail">` markup and let the script own visibility from
  first paint, matching the three sections inside it.
- **Decision**: FIXED — `hidden` added to the `<aside id="rail">` markup

### F3 — Guards cover the invariant, not the rule

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `src/pages/quiz/host.test.ts:504`
- **Detail**: The two new guards assert one writer for `railBox` and two `syncRail();` call sites,
  and both were verified in each direction during implementation (a second `setHidden(railBox` fails
  the first; deleting a call site fails the second). Neither asserts the rule itself — that the rail
  hides when all three blocks are hidden and appears when any one is not. A `syncRail` whose body was
  inverted, or which read the wrong element, passes both guards.

  This is a stated limitation rather than an oversight: the file's own header explains that an Astro
  inline script has no harness, and the plan routes the behaviour to eight manual rows. Recorded so
  the gap is explicit rather than implied by two green tests.
- **Fix**: None in this change — the manual rows are the coverage. If the rule ever needs real test
  coverage, it would mean extracting it to a module under `src/lib/client/`, which costs the
  single-writer locality this change was built around.
- **Decision**: ACCEPTED — recorded as a known limitation; manual rows are the coverage, and lessons.md already carries the general rule
