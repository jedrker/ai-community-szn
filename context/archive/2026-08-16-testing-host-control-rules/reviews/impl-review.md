<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Host Control Rules, Executable

- **Plan**: `context/changes/testing-host-control-rules/plan.md`
- **Scope**: Full plan — Phases 1–4 of 4
- **Date**: 2026-08-16
- **Verdict**: REJECTED — all findings triaged; 6 fixed, 1 skipped, 1 accepted
- **Findings**: 1 critical, 4 warnings, 3 observations

Commits reviewed: `c780a12` (p1), `3f2dc25` (interleaved e2e), `06b583c` (p2), `fbdc914` (p3),
`fcc88b5` (p4), `2e7258e` (epilogue).

Verification run fresh at review time: `bun run test` → 39 files / 1491 tests pass;
`bun run type-check` → 0 errors, 0 warnings; `bun run build` → clean; `bunx eslint` on all changed
files → clean.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | FAIL |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Note on the verdict.** The plan's own four phases are clean — every Phase 1–4 contract item
verified MATCH, and Phase 1 was confirmed behaviour-preserving cell by cell across all twelve
phase × position decisions. Both failing dimensions trace to one interleaved commit (`3f2dc25`)
that the plan explicitly excluded.

## Findings

### F1 — e2e teardown purges a live session the spec refused to touch

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (data safety)
- **Location**: `e2e/seed.spec.ts:55-58`, `e2e/host-question-open.spec.ts` (same shape),
  `e2e/support/host-session.ts:63-92`, `e2e/E2E-RULES.md:45`
- **Detail**: `beforeEach` asserts no session exists and fails with *"a session is already running
  — refusing to drive a live room"*. Playwright runs `afterEach` even when `beforeEach` fails, and
  `afterEach` is guarded only on `hostSecret === ""` — not on whether this spec created anything.
  `purgeSession` then reads the live `version` and POSTs it to `/api/quiz/host/purge` with the real
  secret, so the purge **succeeds**: `livequiz:players`, tallies and standings are deleted.
  Reproduced by the review agent against this repo's own Playwright install.
  The guard written to protect a live room is the thing that destroys it.
  `E2E-RULES.md:45` enshrines the wrong premise — *"`purgeSession` is a no-op when there is nothing
  to purge, so calling it unconditionally is correct"* — true only in the case that never happens.
- **Fix**: Set a `createdHere` flag in `beforeEach` *after* the precondition passes; return early
  from `afterEach` when it is unset. Amend `E2E-RULES.md:45`, which currently reads as
  authorization for the bug.
  - Strength: Scopes teardown to what the spec owns, which is the rule the file already claims to
    follow; two-line change plus a doc correction.
  - Tradeoff: A spec that dies mid-body after creating a session still needs the flag set early
    enough — set it immediately after the precondition, not after the first action.
  - Confidence: HIGH — behaviour reproduced, not inferred.
  - Blind spot: Have not audited whether any other project script calls `purgeSession`.
- **Decision**: FIXED — `clearedToCreate` flag added to both specs; the three prose claims that
  documented the wrong premise corrected (`E2E-RULES.md`, both spec docblocks). Verified in both
  directions with a Playwright lifecycle probe: with the new guard and a live session the teardown
  declines; with the old guard it purges anyway (bug reproduced, so the probe is not blind); with
  the new guard and no session the cleanup still runs.

### F2 — e2e/Playwright is explicitly out of scope and landed unplanned

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: `plan.md:67`; commit `3f2dc25`
- **Detail**: `plan.md:67` reads *"Not adding e2e, browser, or visual coverage. Out of scope for the
  whole rollout (test-plan §7)."* `3f2dc25` landed between Phases 1 and 2 with `playwright.config.ts`,
  two specs, `e2e/support/`, `e2e/E2E-RULES.md`, a Playwright dependency, `.gitignore` entries, and
  `--dir src` on the vitest scripts. The plan was never amended to admit it, and test-plan §7 still
  records browser coverage as deliberately absent. The `--dir src` change has ongoing consequences
  for every future run (see F6). F1 lives entirely inside this commit.
- **Fix A ⭐ Recommended**: Amend `test-plan.md` §7 and §3 to record that a browser layer now exists,
  is not wired to any gate, and covers Risk #1's rendered half.
  - Strength: Keeps the work; makes the source of truth match reality before the next review or
    rollout phase reads §7 as authoritative.
  - Tradeoff: §7's "negative space" becomes a list with an exception in it.
  - Confidence: HIGH — §7 already carries re-evaluation triggers for exactly this.
  - Blind spot: The e2e install came from another session; its owner may have other plans for it.
- **Fix B**: Revert `3f2dc25` and re-land it under its own change-id.
  - Strength: Restores scope discipline strictly; forces the e2e work through plan and review.
  - Tradeoff: Loses working specs and the vitest/Playwright glob separation, which is load-bearing
    for `bun run test` today.
  - Confidence: MEDIUM — the glob fix would have to be re-landed separately either way.
  - Blind spot: Unclear whether anything already depends on `bun run e2e`.
- **Decision**: FIXED via Fix A — `test-plan.md` §7's browser-automation exclusion amended (its own third re-evaluation trigger had fired), keeping the overturned position above the amendment; §3 gained a note that the browser layer arrived outside the rollout and belongs to no phase. Scope of what exists stated precisely: two DOM-level specs, no gate, and **no** geometry coverage — so §7's accepted cost stands unchanged.

### F3 — the `e2e/` skip in scoped-tests.sh is defeated by a `./` or absolute path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: `scripts/scoped-tests.sh:42`
- **Detail**: The `case` glob `e2e/*` anchors at the start of the string. Measured in this repo:
  `e2e/seed.spec.ts` → exit 0; `./e2e/seed.spec.ts` → exit 1; absolute path → exit 1. The two
  bypassing forms fail with the Playwright collection error the skip exists to prevent — a red gate
  on correct code. Latent rather than live: both current callers pass clean relative paths.
- **Fix**: Normalize before the `case` — `file="${file#./}"; file="${file#"$ROOT"/}"` — and/or add
  `--dir src` to both vitest invocations at lines 62 and 66 so the exclusion has two mechanisms.
- **Decision**: FIXED — path normalized (`${file#./}`, `${file#"$ROOT"/}`) before the `case`, and `--dir src` added to both vitest invocations as a second independent mechanism. Verified: all three path forms now exit 0, and a real source file still runs its tests.

### F4 — PollState.phase is `string`, breaking the exhaustiveness the module was built for

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/client/controls.ts:276`
- **Detail**: `verbsFor` takes the exhaustive `ControlPhase`; `PollState.phase` is `string`. If
  `SessionPhase` gains, renames or drops a member, `CONTROL_RULES` and the test's `ROUTE_OUTCOMES`
  both fail `astro check` — the mechanism `controls.test.ts:634-641` deliberately builds — while
  `pollTargetFor` keeps comparing against a string literal that no longer exists. Both the panels
  and the poll go quiet on a green build, which is the "data path with no affordance" failure the
  function's own docblock says it exists to prevent.
- **Fix**: Type it `readonly phase: ControlPhase`. The host page already passes a value whose
  `phase` is assignable, so this is a no-op at every call site.
- **Decision**: FIXED — `PollState.phase` is now `ControlPhase`, with the reasoning at the type. The stricter type immediately caught four loosely-typed helper call sites in `controls.test.ts`, which were typed explicitly. `bun run type-check` clean, 1491 tests pass.

### F5 — plan.md still states the falsified six-inversion claim

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md:19`, `plan-brief.md:19`
- **Detail**: Phase 3 established that none of the six ordering assertions passes on deleted code —
  each carried a presence guard on the line above, verified against `c0afc1e`. That correction was
  written into `research.md`, `test-plan.md` §2 and §6.6, but `plan.md`'s Current State Analysis
  still reads *"Six across two files pass when the code they guard is deleted."* A reader who opens
  the plan without §6.6 beside it inherits the error.
- **Fix**: Add a one-paragraph correction to `plan.md`'s Current State Analysis and `plan-brief.md`'s
  Starting Point, pointing at test-plan §6.6 — quoting the overturned claim rather than deleting it,
  as the other four amendments do.
- **Decision**: FIXED — correction block added to `plan.md`'s Current State Analysis quoting the overturned claim rather than deleting it, plus an inline note in `plan-brief.md`. Both point at test-plan §6.6.

### F6 — `--dir src` is a silent allowlist

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: `package.json:13-14`
- **Detail**: Verified to exclude nothing today — all 38 pre-existing test files live under `src/`.
  Forward risk: a future `scripts/reset-quiz.test.ts` or `astro.config.test.ts` would never be
  collected, and the run would report "39 passed" rather than "1 skipped".
- **Fix**: Prefer `--exclude 'e2e/**'` so the rule states what is banned rather than what is
  allowed; or keep `--dir src` and note the constraint in CLAUDE.md's Commands section (already
  partly done there).
- **Decision**: SKIPPED — the constraint and its forward risk are already recorded in CLAUDE.md's Commands section. Revisit if a test is ever wanted outside `src/`.

### F7 — Playwright trace on CI retry captures the host secret

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (security)
- **Location**: `playwright.config.ts:59`, `:20-26`
- **Detail**: No secrets are committed — `hostSecret` reads `process.env.LIVEQUIZ_HOST_SECRET`,
  `.env` is gitignored, `git ls-files e2e/` shows only source. But `trace: "on-first-retry"` with
  `retries: process.env.CI ? 1 : 0` means a retried failure records request headers, including
  `x-livequiz-host-secret`. `test-results/` is gitignored, so nothing reaches the repo — the
  standard CI pattern of uploading the trace as a build artifact would publish the host write
  credential.
- **Fix**: When CI lands (test-plan §3 Phase 4), scrub the header or restrict artifact visibility,
  and say so at the `trace` line.
- **Decision**: FIXED (documented) — the exposure is now recorded at `playwright.config.ts`'s `trace` line, where whoever sets `retries` for CI will be looking, rather than only in this report. Tracing left on; the decision belongs to the CI phase.

### F8 — ROUTE_OUTCOMES is hand-maintained and nothing links it to the routes

- **Severity**: 📝 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality (reliability)
- **Location**: `src/lib/client/controls.test.ts:55-118`
- **Detail**: Known and documented at the code (`:57-61`), and the review spot-checked every
  load-bearing cell against the handlers — all currently correct. It remains the case that a route
  phase-guard change leaves this table stale, both tests green, and the panel offering a dead
  button. This is the residual risk of the whole approach.
- **Fix**: Have `src/pages/api/quiz/host/routes.test.ts` import `ROUTE_OUTCOMES` and drive one
  request per cell, closing the loop without a second table.
  - Strength: Turns the hand-maintained literal into an executable contract; the panel test and the
    route test would then fail together.
  - Tradeoff: Couples two test files and needs a store fixture per cell; a rollout phase of its own.
  - Confidence: MEDIUM — `routes.test.ts` already exercises the routes, but not cell by cell.
  - Blind spot: Have not checked whether its harness can reach every phase cheaply.
- **Decision**: ACCEPTED — the residual risk of the approach, already documented at the code and in test-plan §6.5. Closing it means driving one request per cell from `routes.test.ts`, which is a rollout phase of its own rather than a review fix.

## What passed

- **Plan Adherence**: every Phase 1–4 contract item verified MATCH.
- **Phase 1 behaviour preservation**: all 12 phase × position cells for `endButton.disabled` and
  `dataset.next` identical under old and new logic. `disarmReveal()` ordering unmoved. The
  `undefined` → `"none"` change to `syncEndButton`'s `phase` has two readers, both verified safe.
- **`end` escapes `whenLast`**: implemented and asserted from both directions
  (`controls.test.ts:421-427`, `:434-443`).
- **`MATERIAL_WITHHOLDINGS`**: exactly three, asserted as an equality over a computed set — stronger
  than the plan asked, since a stale entry fails as loudly as a missing one.
- **Scope guardrails held** on every "not doing" item except e2e: `syncControls` still inline, arming
  state still on the page, `syncRail` untouched, standings-on-last unchanged.
- **Pattern consistency**: no substantive mismatch against `countdown.ts`, `toast.ts`, `session.ts`,
  `render.ts`. Factory-vs-plain-function choice correct for stateless logic.
- **Boundary**: `controls.ts` passes `boundary.test.ts`'s real detector; no answer fields reachable
  from client code.
- **Dead code**: none. All six imports used; `questionFor` correctly retained for its other callers.
- **Portability fixtures**: follow `boundary.test.ts`'s detector-plus-fixture pattern faithfully,
  including the runtime-assembled specifier for the self-scan trap.
