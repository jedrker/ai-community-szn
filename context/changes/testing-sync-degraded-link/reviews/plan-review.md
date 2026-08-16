<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Sync Under a Degraded Link

- **Plan**: `context/changes/testing-sync-degraded-link/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-16
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING → PASS (F1 fixed) |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (F2, F3 fixed) |
| Plan Completeness | WARNING (F4 skipped) |

## Grounding

7/7 paths ✓, 3/3 symbols ✓ (`advanceLifecycle:325`, `INITIAL_LIFECYCLE:304`,
`createSessionClient:495`), brief↔plan ✓, Progress↔Phase ✓ (5 phases, all Success Criteria
matched, no stray checkboxes in phase blocks).

Code checks run for this review: `client/answer.ts` touches `window.localStorage` only inside
`readSeen`/`markSubmitted`/`clearSeen` (`:164`, `:221`, `:351`), so `submitAnswer` needs no DOM;
`routes.test.ts:165` authorizes with `vi.stubEnv("LIVEQUIZ_HOST_SECRET", …)`; `answer.test.ts`
pins the clock with `vi.spyOn(Date, "now")` in `beforeEach`; `host.astro:1021` and
`index.astro:471` both import `createSessionClient`.

## Findings

### F1 — Phase 5 flips §3 to "complete" while a third of Risk #3's stated proof condition is knowingly unmet

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 + Phase 5 (§3 status flip)
- **Detail**: `test-plan.md:89` proves Risk #3 with three clauses; the third is "a cancel is not
  undone by a request already in flight". Phase 1 delivers the first two. Phase 2 delivers the
  third for `dispose` only and pins the opposite for `stop` and `pause` — then Phase 5 writes
  "complete" beside the row, with nothing reconciling the two. That is the shape §1's fourth rule
  exists against: a row reading covered while the property is known not to hold.
- **Fix A ⭐ Recommended**: Split the row's status from its proof — §3 reads complete on
  deliverables, while §2's Risk #3 row and §6.6 carry an explicit "clause 3 holds for `dispose`
  only" amendment naming the two pinned tests.
  - Strength: Uses §2's existing amend-in-place convention.
  - Tradeoff: The map now carries a partially-met risk.
  - Confidence: HIGH.
  - Blind spot: Whether §3's Status vocabulary admits a value between "researched" and "complete".
- **Fix B**: Amend Risk #3's proof condition to what this phase can prove.
- **Decision**: FIXED via Fix A — added to Desired End State, Phase 2's overview, Phase 5's §6.2/§6.6
  contract, and a new manual criterion 5.6.

### F2 — Three pinned tests with no instruction for the day they go red

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phases 2, 3, 4
- **Detail**: Every test this phase adds asserts behaviour the project would rather not have, so
  each must fail when the defect is fixed. `test-plan.md:88` names "repairing a newly-failing guard
  back toward the bug it just caught" as the anti-pattern, and a pin is its most inviting instance —
  the test looks like a contract, so red invites restoring the old behaviour. The plan said how to
  word each pin, never what the next reader does when it fails.
- **Fix**: An inversion note at each pinned assertion — *if this fails, the defect was fixed:
  invert the expectation, do not restore the behaviour* — plus the same rule once in §6.6.
- **Decision**: FIXED — stated in Phase 2's overview as the rule for all three phases, referenced at
  the `pause` pin, the `rejected` mapping and the drift assertion, and added to §6.6's contract.

### F3 — The extraction's only automated safety net is listed in the wrong phase, and without its precondition

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 (verification) / Phase 5 (old criterion 5.4)
- **Detail**: Phase 1 changes production code both views import while `createSessionClient` stays
  untested by design, so the reconciler's new tests pass against a client that no longer calls it.
  `bun run e2e` would notice — it drives the host panel in Chromium and `host.astro:1021` imports
  the module — but it sat four phases later with no mention that those specs drive the real Upstash
  namespace from `.env`, the hazard the previous rollout phase's impl-review F1 was about.
- **Fix A ⭐ Recommended**: Move it to Phase 1 with the refuse-if-live precondition named.
  - Strength: Puts the only automated evidence beside the only product change.
  - Tradeoff: Phase 1 depends on a runner wired to no gate.
  - Confidence: HIGH.
  - Blind spot: Whether the two specs exercise a snapshot transition or only the initial render.
- **Fix B**: Drop the criterion; rely on the two-device manual pass.
- **Decision**: FIXED via Fix A — new Phase 1 automated criterion 1.5 with the precondition; Phase 5's
  e2e criterion removed and its Progress items renumbered.

### F4 — Fixture preconditions the two new tests need are unstated

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3, Phase 4
- **Detail**: Phase 4 never mentions host authorization, though `reveal.ts:53` calls `authorizeHost`
  and `routes.test.ts:165` gets past it with `vi.stubEnv("LIVEQUIZ_HOST_SECRET", …)` plus the
  header. Phase 3 never pins the clock, though `answer.test.ts` stubs `Date.now` in `beforeEach`
  and an unpinned one drifts into the expired branch. Neither names a test environment — `node` is
  correct since `submitAnswer` touches no DOM, but an implementer copying
  `client/answer.test.ts`'s happy-dom docblock inherits the localStorage Proxy trap for nothing.
- **Fix**: Name all three in the Contract blocks.
- **Decision**: SKIPPED — to be handled during implementation.

### F5 — Two new filename conventions where one would serve

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architectural Fitness
- **Location**: Phase 3, Phase 4, Phase 5 (§6.2)
- **Detail**: The project has one convention, `<module>.test.ts`. The plan adds `.seam.test.ts` and
  `.drift.test.ts` in one change for two files that are the same kind of thing, so §6.2 would
  document two names for one pattern.
- **Fix**: Use `.seam.test.ts` for both and let the docstring say which seam.
- **Decision**: SKIPPED.

### F6 — Phase 3's expired-path assertion is near-duplicate coverage

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3, contract item (c)
- **Detail**: The route already asserts the expired refusal carries its class
  (`answer.test.ts:819-827`) and the client already maps it to `expired`
  (`client/answer.test.ts:688`). Item (c) earns its place only as the composition.
- **Fix**: Keep it, with the docstring stating it exists to make the asymmetry visible in one place.
- **Decision**: SKIPPED.
