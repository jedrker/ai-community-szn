<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Join and Follow Host (S-02)

- **Plan**: `context/changes/join-and-follow-host/plan.md`
- **Scope**: Full plan — Phases 1–6 of 7 (Phase 0 still open on human counter readings)
- **Date**: 2026-08-08
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (4 fixed, 1 skipped, 1 accepted as scope)
- **Findings**: 0 critical, 3 warnings, 3 observations

> The earlier phases-1–2 review is preserved at `impl-review-phases-1-2.md` rather than
> overwritten. Its F1–F7 triage all verified as still holding in this pass.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING → PASS after F2 documented |
| Safety & Quality | WARNING → PASS after F1 fixed |
| Architecture | WARNING → accepted (F4 skipped knowingly) |
| Pattern Consistency | WARNING → PASS after F3, F5 fixed |
| Success Criteria | WARNING → PASS after F6 annotated |

Automated criteria re-run at review time: `bun run test` 366/366 across 19 files (368 after
triage — two new tests pin F1, one strengthened for F3), `bun run type-check` 0 errors across 73 files, `bun run build` complete, and neither new page names
`LIVEQUIZ_HOST_SECRET`. Scope guardrails from "What We're NOT Doing" all hold — no answer
path, no scoring, no leaderboard, no per-device cap, no throttling, no CI, no UI framework.

## Findings

### F1 — A transient store failure during resume locks the attendee out under their own name

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/index.astro:286 (with src/lib/session/store.ts:672, src/pages/api/quiz/join.ts:84)
- **Detail**: `readPlayerById` returns `{ player: null, state: null }` for *both* "unknown id"
  and "the store call threw" (store.ts:661 unconfigured, :672 catch). The route maps that
  single shape to 404 (join.ts:84), and the client treats any non-OK response as proof the id
  is dead: it calls `clearPlayer()` and shows the name form (index.astro:286). So one blip on
  an Upstash call during a reload destroys the device's identity — and the attendee then
  re-types the name they still hold, gets `taken`, and is locked out for the rest of the
  segment. That is precisely the failure the resume path exists to prevent, restated in the
  plan as "without it a reloading attendee re-enters their name, is rejected because they hold
  it themselves, and is locked out".
  The inconsistency is visible in the same function: a *network* failure (index.astro:269–274)
  correctly shows the form **without** clearing storage. Only the store-failure path clears.
  The conflation is documented in store.ts as deliberate, and it is right for the *route's*
  fallback behaviour — but the client draws a stronger conclusion from it than it can support.
- **Fix A ⭐ Recommended**: Make the failure distinguishable and stop clearing on it. Widen
  `readPlayerById` to a tri-state (`found` / `not-found` / `failed`), have the route answer 503
  with a distinct Polish message on `failed`, and have `resume()` keep the stored id on 503 —
  same treatment the network-failure branch already gets.
  - Strength: Removes the lockout entirely rather than narrowing its window, and matches the
    posture already applied two branches up.
  - Tradeoff: Touches three files and widens a return type other callers may later read.
  - Confidence: HIGH — the discriminated-union return shape is this module's existing idiom
    (`ClaimResult`, `ReadResult`, `WriteResult` all do it).
  - Blind spot: Not verified whether an Upstash blip during a 150-device reload burst is
    frequent enough to have ever fired. The cost when it does is total for that attendee.
- **Fix B**: Client-only — on any non-OK resume, show the form but keep the stored id, and clear
  it only after a *successful* fresh claim.
  - Strength: One file, no API change.
  - Tradeoff: A device holding a genuinely dead id keeps it across sessions until it next
    joins successfully; leaves the route still unable to say which failure happened.
  - Confidence: MEDIUM — fixes the lockout but leaves the ambiguity in place for S-09, which
    owns resume properly and will hit this again.
  - Blind spot: Interaction with the ghost-player case the plan calls out.
- **Decision**: FIXED via Fix A — `readPlayerById` now returns a `LookupResult` with an explicit `found` / `not-found` / `failed` outcome; `join.ts` answers 503 on `failed` and 404 only on `not-found`; `index.astro` keeps the stored id on any 5xx and clears only on a 404. Pinned by `store.test.ts` → "reports a transport failure as failed, not as not-found" and "reports an unconfigured store as failed…", and `join.test.ts` → "reports a store failure as 503 so the client keeps its stored id". Asserting only `player: null` would have passed against the bug, so all three assert the outcome/status directly.

### F2 — The option shuffle is unplanned scope, and its cross-slice consequence lives only in a code comment

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/quiz/public.ts:100 (`shuffleOptions`, `SHUFFLE_SALT`)
- **Detail**: Phase 2's contract specified the projection as "an explicit allowlist of fields
  per question kind (`id`, `kind`, `prompt`, and `options` as `{ id, text }`)". The
  implementation additionally added a seeded Fisher-Yates shuffle of option order, because the
  drafted quiz puts the correct answer first in six of eight single-choice questions. The fix
  is real and well-argued — but it is not in the plan, and it changes an invariant later
  slices rely on: **`publicQuiz` option order no longer matches `definition.ts` order.**
  S-04 drawing an answer distribution in definition order would mislabel every bar. That
  warning currently exists in exactly one place — a comment inside `public.ts` — and is absent
  from `join-contract.md`, which is the file the plan designates as what S-03/S-04/S-07 read
  before building on this slice.
  The same Phase 2 commit also renamed question id `halucynacje` → `zmyslanie-faktow`, which is
  a genuine leak fix (question ids reach the browser in the snapshot) and equally unplanned.
- **Fix ⭐**: Add the shuffle to `join-contract.md` — one line under the projection section
  stating that option order is deterministic-but-shuffled and that S-04 must render from
  `publicQuiz`, never from `quiz`.
  - Strength: Puts the constraint in the file the next slice is told to read, which is where
    the plan intended cross-slice contracts to live.
  - Tradeoff: Grows the contract file, which already sits at 823 words against a one-page bar.
  - Confidence: HIGH — the contract file exists for exactly this class of hand-off.
  - Blind spot: None significant; the code itself is not in question.
- **Decision**: FIXED — `join-contract.md` gains an "Option order is shuffled" section stating that order is deterministic-but-shuffled, why it exists, and that S-04 must render distributions from `publicQuiz` and never from `quiz`. The unplanned scope itself is accepted: both the shuffle and the `halucynacje` → `zmyslanie-faktow` id rename fix real defects the plan did not anticipate.

### F3 — The join-rejection reason is free-text where the project's doctrine is that the type closes the hole

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/session/log.ts:119
- **Detail**: The plan is explicit that a join rejection must log "the *class* of rejection", never
  the submitted name, and `log.ts` says so in prose at :80. But the field carrying it is the
  pre-existing `reason?: string`, so nothing prevents a future caller writing
  `{ reason: submittedName }`. CLAUDE.md states the project's position on precisely this:
  "`LogFields` is a closed type, so `{ displayName }` is a compile error — and that closure
  *is* the enforcement, not a comment alongside one." Here the enforcement is a comment.
  No live defect: all five `session.join.rejected` call sites in `join.ts` pass fixed class
  strings ("taken", "invalid", "closed", "no-session", "unknown-player").
- **Fix**: Add a dedicated `rejection?: "taken" | "invalid" | "closed" | "no-session" | "unknown-player"`
  to `LogFields` and switch the five call sites to it, leaving `reason` for free-text failure
  detail where it is genuinely needed.
- **Decision**: FIXED — `LogFields.rejection` added as a closed union; all six `session.join.rejected` call sites in `join.ts` switched to it; `reason` left free-text for genuine failure detail, with a docstring saying why a rejection class must not share it. Pinned in `join.test.ts` → "never writes a display name to the log", which now also asserts `"rejection":"taken"` is present and `"reason"` is absent.

### F4 — `/api/quiz/state` now costs an extra HLEN per attendee connect to serve a host-only figure

- **Severity**: 📌 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/api/quiz/state.ts:53
- **Detail**: The live `playerCount` was added to fix the host's refresh button (correctly — it
  could not otherwise work). But every attendee device also calls `/api/quiz/state` once on
  connect, fetches the count, and discards it: only `host.astro` supplies an `onCount`
  handler. That is ~150 extra store commands per session bought for a figure ~149 of the
  callers never read. It is comfortably inside the plan ceiling, but it is added
  *unattributed* store traffic at the exact moment the command-counter anomaly is unresolved
  — Phase 5 measured reads at ~12× the code's own accounting and could not fully explain it.
- **Fix ⭐**: Read the count only when asked for it — e.g. `/api/quiz/state?count=1`, sent by
  the host view and by nobody else.
  - Strength: Removes ~150 commands/session and keeps the host path unchanged; makes the cost
    legible at the call site rather than hidden in a shared endpoint.
  - Tradeoff: A query-param branch in an endpoint that is currently pleasingly dumb.
  - Confidence: MEDIUM — trivial to implement, but the saving is small in absolute terms and
    the argument rests on keeping cost attributable rather than on hitting a limit.
  - Blind spot: A later slice may want the count on attendee devices anyway (S-07).
- **Decision**: SKIPPED — ~150 commands per session against a 500K/month ceiling is not worth a query-param branch in an endpoint that is currently pleasingly dumb, and S-07 may want the count on attendee devices anyway. The cost is recorded in `join-burst-report.md` and in the runbook's tripwire section, so it is attributed rather than invisible.

### F5 — New runtime dependency `qrcode` is not recorded in CLAUDE.md's dependency constraints

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: package.json
- **Detail**: CLAUDE.md carefully records constraints for every other dependency that has one —
  `zod` and `vite` must stay deduplicated, `@astrojs/vercel` must stay on `^10`, `typescript`
  must not pass `^6`. `qrcode` (plus `@types/qrcode`) was added mid-Phase-4 with none. It has
  no known constraint and added no advisories (`bun audit` checked), and it is server-side
  only — but the *absence* of a note is indistinguishable from nobody having thought about it.
- **Fix**: One line in CLAUDE.md's Commands section: `qrcode` is server-side only, used by
  `/quiz/host` to render the join QR as inline SVG, and must never be imported from a client
  module.
- **Decision**: FIXED — added to CLAUDE.md beside the other dependency constraints, stating that it carries no version constraint (and why that is recorded rather than omitted), that it is server-side only, and that `boundary.test.ts` will *not* catch a client import of it because that gate is about `src/quiz/` and `src/lib/session/`, not bundle weight generally.

### F6 — Plan step 5.2 is ticked by judgement, and the tick does not say so

- **Severity**: 📌 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/join-and-follow-host/plan.md (Progress, row 5.2)
- **Detail**: Row 5.2 reads "Harness unit-testable parts (name generation, distribution maths)
  covered **if they are non-trivial**" and is marked `[x] — 43648d9`. No test was written; the
  escape hatch was exercised on the judgement that `rehearsalName` is a template string and the
  distribution maths reuses `percentile`, which F-04 already depends on. That reasoning was
  stated in conversation but is not on the row, so the plan now reads as though coverage was
  added. Same shape as the rubber-stamping this review is meant to catch, even though the
  judgement itself looks right.
- **Fix**: Annotate the row — `— judged trivial: name generation is a template string, the
  distribution maths reuses the existing `percentile`; no test added.`
- **Decision**: FIXED — Progress row 5.2 now states that no test was added, that the "if non-trivial" escape was exercised deliberately, and the reasoning for it.
