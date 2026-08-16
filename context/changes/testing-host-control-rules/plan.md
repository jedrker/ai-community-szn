# Host Control Rules, Executable — Implementation Plan

## Overview

Move the host panel's phase-to-verb decision out of `src/pages/quiz/host.astro`'s inline `<script>`
into an importable module, assert it against route legality as a one-way implication, and repair the
assertion class that has been certifying defects in this project. This is rollout Phase 1 of
`context/foundation/test-plan.md`, covering Risk #1 and Risk #2.

## Current State Analysis

`CONTROL_RULES` (`host.astro:1905-1983`) is a top-level `const` inside the page's module `<script>`
block — lines 1008-3337, roughly 70% of a 3,339-line file. Vitest cannot import an `.astro` file, so
none of it executes in a test. `src/pages/quiz/host.test.ts` (1,391 lines) reads the file as text and
asserts on substrings; its own docblock (`host.test.ts:9-20`) states that "nothing below proves the
poll fires at the right moment, stops at the right moment, or paints the right numbers."

Of roughly 150 assertions in that file, **none is a property assertion**. Six across two files pass
when the code they guard is deleted. The panel's phase rules are two mechanisms, not one:
`CONTROL_RULES` governs four flow verbs, and `syncEndButton:2213` governs the closing verb.

Full grounding, including the route legality matrix and the per-assertion audit, is in
`context/changes/testing-host-control-rules/research.md`.

## Desired End State

`src/lib/client/controls.ts` owns the decision and exports it as a function. `controls.test.ts`
executes that function across every phase and both last-question positions, asserting that the panel
offers no verb the route would refuse, and that every verb the route accepts *with effect* but the
panel withholds appears in a named exception list. `host.astro` imports and calls it; the inline
script contains no phase-to-verb table. The six `-1` ordering assertions are repaired and both
`portability.test.ts` files prove their detector fires.

Verified by: `bun run test` green with the new executing tests present, `bun run type-check` clean,
and each new guard demonstrated to fail when the code it covers is broken.

### Key Discoveries:

- `CONTROL_RULES` closes over nothing but eight string constants (`host.astro:1896-1903`); the
  extraction target is pure data (`research.md` §1).
- `atLastQuestion` (`host.astro:1561-1568`) and `pollTargetFor` (`host.astro:1592-1642`) close over
  only `config.questions` — they become pure functions by taking it as a parameter.
- `boundary.test.ts` permits `import type` from `src/lib/session/` (erased at build), which is how
  `SessionState` already reaches client modules. A `Record<SessionPhase, …>` in the test is therefore
  exhaustive at compile time with no boundary exposure.
- The precedent is `src/lib/client/countdown.ts`, extracted from an inline script for this exact
  reason and shipped with 24 executing tests; `toast.ts` followed it.
- `host.test.ts:539-540`'s single-reader guard asserts `CONTROL_RULES[` appears in `host.astro`. The
  extraction makes that assertion fail on correct code.
- The `end` verb has **no** `whenLast` variant — it stays enabled on the last question, where it
  takes the next-step ring. Collapsing it with the four flow verbs would disable the one control the
  host needs there.

## What We're NOT Doing

- **Not making `syncControls` executable.** It stays inline with its DOM writes. This phase proves
  the decision is *correct*; it does not prove the panel *applies* it. A bug that computes the right
  decision and writes it to the wrong button remains invisible to this suite. That is the accepted
  cost of the scope chosen for this phase, and it is the first thing a later phase should close.
- **Not extracting `syncEndButton`'s arming state** (`endArmed`, `endArmedVersion`) or `syncRail`.
  Only the closing verb's *phase rule* moves.
- **Not changing any runtime behaviour.** If the panel behaves differently at any phase after this
  change, that is a defect in the move, not an improvement.
- **Not converting the rest of `host.test.ts`'s ~150 shape assertions.** Only the six `-1` inversions
  and the guards the extraction directly invalidates are touched.
- **Not fixing the standings-on-last withholding.** Confirmed intended; encoded as a named exception.
- **Not adding e2e, browser, or visual coverage.** Out of scope for the whole rollout (test-plan §7).

## Implementation Approach

Four phases. Phase 1 is a behaviour-preserving move that adds no coverage, so that any red in the
existing suite isolates a move defect rather than mixing with new assertions. Phase 2 adds the
executing coverage that is the point of the exercise. Phase 3 is independent of both and could land
first if preferred. Phase 4 closes the documentation the earlier phases falsify.

The module follows the `src/lib/client/` conventions exactly: named exports, no default export, a
docblock naming the slice and the defect it prevents, and — because the logic is stateless — plain
exported functions rather than a `createX(deps)` factory (matching `classifyConnection` and
`shouldFallbackPoll` in `session.ts` rather than `countdown.ts`'s factory).

## Critical Implementation Details

**The `end` verb is not subject to `whenLast`.** The four flow verbs collapse to an empty `allow` on
the last question; `end` must stay allowed in `question-revealed` and `standings` regardless, because
that is exactly when it becomes the next step. Applying the `whenLast` collapse uniformly across all
five verbs would disable the closing button on the final question — a behaviour change that no
existing test would catch, since `host.test.ts:690-693` only asserts the presence of the substrings
`endButton.dataset.next`, `atLastQuestion(state)` and `!endButton.disabled`, with no relationship
between them.

**Ordering inside `syncControls` is load-bearing.** `disarmReveal()` is called when the reveal
becomes disallowed (`host.astro:2100`) and the arming check runs before the button loop. The move
must not reorder these relative to the `verbsFor` call.

## Phase 1: Extract the decision to `src/lib/client/controls.ts`

### Overview

A behaviour-preserving move. New module, `host.astro` rewired, existing suite adjusted only where the
extraction mechanically invalidates it.

### Changes Required:

#### 1. New client module

**File**: `src/lib/client/controls.ts`

**Intent**: Own the host panel's phase-to-verb decision as pure, importable logic. The table itself
stays private so a second reader is unrepresentable rather than merely forbidden — this is what
retires the single-reader guard instead of re-expressing it.

**Contract**: Named exports only. `CONTROL_RULES` and the eight message constants are module-private.

```ts
export type FlowAction = "start" | "advance" | "reveal" | "standings" | "end";
export type ControlPhase = SessionPhase | "none";

export type Decision = {
  readonly allow: readonly FlowAction[];
  readonly next: FlowAction | null;
  readonly why: Partial<Record<FlowAction, string>>;
};

export function verbsFor(phase: ControlPhase, atLast: boolean): Decision;
export function atLastQuestion(
  questions: readonly PublicQuestion[],
  currentQuestionId: string | null,
): boolean;
export function pollTargetFor(
  questions: readonly PublicQuestion[],
  state: { phase: string; currentQuestionId: string | null } | null,
): PollTarget | null;
```

`SessionState`, `SessionPhase` and `PublicQuestion` arrive as `import type` only — a value import
would fail `boundary.test.ts`. Carry over the existing docblock convention: name the slice, state the
defect the module prevents, and restate the boundary compliance as `countdown.ts:22-23` does.

#### 2. Fold the closing verb's phase rule into the decision

**File**: `src/lib/client/controls.ts`

**Intent**: Give `end` a row in the same decision so all five verbs answer to one mechanism, closing
the gap where a phase condition for a flow verb lived outside the table.

**Contract**: `end` is in `allow` when `phase` is `question-revealed` or `standings`, **independent of
`atLast`**. `next` returns `"end"` when `atLast` is true and `end` is allowed; otherwise the existing
flow-verb `next`. The two-tap arming state stays in `host.astro`.

#### 3. Rewire the page

**File**: `src/pages/quiz/host.astro`

**Intent**: Delete the inlined table, constants and two predicates; import and call the module.
`syncControls` keeps its DOM writes and its arming logic, but reads its decision from `verbsFor`.
`syncEndButton` reads `end`'s allowed state and its next-step ring from the same call.

**Contract**: A new import beside the existing `../../lib/client/*` imports at `host.astro:1009-1028`.
`syncControls`, `syncEndButton` and every `pollTargetFor` call site pass `config.questions` explicitly.
No `CONTROL_RULES` identifier remains in the file.

#### 4. Adjust the guards the move invalidates

**File**: `src/pages/quiz/host.test.ts`

**Intent**: Retire the assertions that can no longer hold, and add the positive assertion that the
page reaches for the extracted module — the pattern the toast extraction established at
`host.test.ts:1088-1099`.

**Contract**: Remove `:539-540` (single-reader), `:525-530` (table row presence), `:600`, `:624`,
`:672-674`, `:678` (table content and `whenLast` presence) — all now covered by executing tests. Add
assertions that the file imports from `../../lib/client/controls` and calls `verbsFor(`. Keep every
assertion about `syncControls`'s DOM behaviour, which still lives on the page. The
`pollTargetFor` block at `:278-322` retargets to the module import.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `bun run type-check`
- Full suite passes: `bun run test`
- Build passes: `bun run build`
- `src/lib/client/controls.ts` exists and `src/pages/quiz/host.astro` contains no `CONTROL_RULES`
- Boundary gate still green: the new module appears in `boundary.test.ts`'s scan and passes

#### Manual Verification:

- Open `/quiz/host` and step a session through `lobby` → `question-open` → `question-revealed` →
  `standings`; the enabled verbs and their tooltips are identical to before the change
- On the last question, `dalej` is disabled and `zakończ sesję i pokaż wyniki` is enabled and ringed

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Executing decision tests

### Overview

The coverage this phase exists for. `controls.test.ts` runs the decision across every phase and both
last-question positions and checks it against route legality.

### Changes Required:

#### 1. Route legality as a literal expectation

**File**: `src/lib/client/controls.test.ts`

**Intent**: State what each route does per phase, so the panel can be checked against something other
than itself. Derived from `research.md` §2, which read the guards directly.

**Contract**: A `Record<ControlPhase, Record<FlowAction, RouteOutcome>>` where
`RouteOutcome = "effect" | "no-op" | "refused"`. Being a `Record` over the phase union, adding a
phase to `SessionPhase` fails `astro check` until this table gains a row. Include a comment pointing
at `src/pages/api/quiz/host/routes.test.ts` as the executing proof of these outcomes.

#### 2. The one-way implication

**File**: `src/lib/client/controls.test.ts`

**Intent**: Assert the property Risk #1 actually needs — the panel never offers a dead button —
without asserting the equality that would fail on correct code.

**Contract**: For every phase × `atLast`: no action in `verbsFor(...).allow` has a route outcome of
`"refused"`. Asserted per phase so a failure names the phase.

#### 3. The named exception list

**File**: `src/lib/client/controls.test.ts`

**Intent**: Pin the places the panel deliberately offers less than the route, so a withholding can be
added or removed only on purpose. Two tiers, because they need different justification.

**Contract**: Every action whose route outcome is `"effect"` but which is absent from `allow` must
appear in `MATERIAL_WITHHOLDINGS` — exactly three entries: `end` in `lobby`, `standings` on the last
`question-revealed`, and `standings` on the last `standings`. Each carries a one-line reason string.
Actions withheld where the route is a `"no-op"` (`start` mid-session, `advance` past the last
question, `reveal` in `question-revealed`) are permitted without an entry, since the panel is simply
not offering a button that would do nothing.

#### 4. Decision-shape invariants

**File**: `src/lib/client/controls.test.ts`

**Intent**: Cover the properties that the table's internal consistency depends on and that no route
comparison would catch.

**Contract**: `next` is always either `null` or a member of `allow`; every action absent from `allow`
has a `why` entry so the tooltip is never blank; `end` is allowed identically for `atLast` true and
false in every phase; `allow` is empty for `ended` in both positions.

#### 5. Predicate tests

**File**: `src/lib/client/controls.test.ts`

**Intent**: Cover the two moved predicates directly, using real quiz data by kind rather than by
index or id.

**Contract**: `atLastQuestion` — true only for the final question, false for `null`, false for an id
absent from the list. `pollTargetFor` — returns a words target in both `question-open` and
`question-revealed` for a word-cloud question, a participation target only in `question-open` for a
choice question, a lobby target in `lobby`, and `null` for text and number kinds. Build fixtures via
`questionOfKind` from `src/quiz/test-support.ts`.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- Guard verified in both directions: remove `end` from the `standings` row in `controls.ts`, confirm
  the `end`-independence test fails, restore
- Guard verified in both directions: add `"reveal"` to `allow` for the `ended` phase, confirm the
  no-refused-verb test fails naming `ended`, restore
- Guard verified in both directions: delete one entry from `MATERIAL_WITHHOLDINGS`, confirm the
  exception test fails, restore
- Exhaustiveness verified: add a synthetic member to the `SessionPhase` union locally, confirm
  `bun run type-check` fails on the route table, revert

#### Manual Verification:

- Read the failure output of one deliberately broken run and confirm it names the phase and action,
  not just "expected true to be false"

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: Repair the `-1` inversion class and the dead gates

### Overview

Independent of Phases 1 and 2. Six ordering assertions across two files pass when the code they guard
is deleted; two portability scans have never been shown to fire.

### Changes Required:

#### 1. An ordering helper that cannot pass on absence

**File**: `src/pages/quiz/host.test.ts`

**Intent**: Replace the `indexOf(a) < indexOf(b)` idiom with one that asserts presence before order,
so a deleted guard fails loudly instead of silently satisfying the comparison.

**Contract**: A local helper asserting both needles are present with a message naming the missing one,
then asserting order. Applied at `:220`, `:653-655`, `:768`, `:835`, `:901`.

#### 2. The same repair on the attendee page

**File**: `src/pages/quiz/index.test.ts`

**Intent**: `:117` has the identical defect and guards the countdown clear whose absence caused S-11's
F1 recursion crash.

**Contract**: Same helper, same shape. Duplicate it rather than sharing across page test files —
these two files share no imports today and coupling them for six lines is the larger cost.

#### 3. Positive fixtures for the portability gates

**File**: `src/quiz/portability.test.ts`, `src/lib/session/portability.test.ts`

**Intent**: Prove each detector fires. Neither has ever been demonstrated to fail, so a regex typo
would make both pass forever while reading as compliance — the failure mode `keys.test.ts:81-85`
documents as its reason for having a fixture.

**Contract**: A synthetic source string containing an `astro:` specifier asserted to produce exactly
one offender at the expected line, and a clean string asserted to produce none. Assemble the forbidden
specifier from parts so the fixture does not become the violation it describes, following the comment
at `boundary.test.ts:197-198`.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- Each of the six repaired assertions verified: delete the guarded statement, confirm that specific
  test fails with the "missing" message, restore
- Each portability fixture verified: break the detector's regex, confirm the fixture test fails,
  restore

#### Manual Verification:

- None. This phase changes no runtime code.

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 4: Documentation

### Overview

Three earlier phases falsify statements in `CLAUDE.md`, and the rollout owes `test-plan.md` a cookbook
entry. Per `lessons.md`, this is part of the slice rather than a discovery at the end of it.

### Changes Required:

#### 1. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Amend the sentences the extraction makes false, quoting the position overturned rather
than deleting it, as the PRD and `state.ts` already do.

**Contract**: Four claims change. (a) "stated once, as `CONTROL_RULES` in `src/pages/quiz/host.astro`,
and read only by `syncControls`" — the table moved and is now private behind `verbsFor`. (b)
"`syncControls` must be called from all three sites" — there are four; the fourth is the reveal's
arming tap, and this was already stale before this change. (c) "`zakończ sesję i pokaż wyniki` is
deliberately outside the table" — its phase rule is now inside; its arming is not. (d) the polling
section's reference to `pollTargetFor` as living in `host.astro`. Add the new module to the client
modules list.

#### 2. Test plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Fill in §6.5, the entry this rollout phase exists to produce, and mark §3 Phase 1
`complete`.

**Contract**: §6.5 records the pattern: a decision that must be tested moves to `src/lib/client/` as
pure named exports with the table private; the page keeps the DOM writes; the page's structural scan
gains a positive assertion that it reaches for the module. Name `controls.ts` / `controls.test.ts` as
the reference. Add a §6.6 note on the `-1` inversion class and the ordering helper.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- No stale reference remains: `CLAUDE.md` contains no claim that `CONTROL_RULES` lives in `host.astro`

#### Manual Verification:

- Read §6.5 and confirm it answers "how do I test a rule trapped in an Astro inline script?" without
  needing the plan
- Confirm the CLAUDE.md amendments quote the overturned positions rather than replacing them silently

---

## Testing Strategy

### Unit Tests:

- `verbsFor` across 6 phases × 2 last-question positions = 12 decisions, each checked against route
  legality and the exception list
- Decision-shape invariants: `next ∈ allow ∪ {null}`, every disallowed action has a `why`, `end` is
  `atLast`-independent
- `atLastQuestion`: final question, non-final, `null`, unknown id
- `pollTargetFor`: all five question kinds × the phases that matter

### Integration Tests:

None. This phase adds no route or store behaviour; `routes.test.ts` already covers the server side of
the matrix this plan reads from.

### Manual Testing Steps:

1. Start a session on `/quiz/host`; confirm only `start` is live before it exists, only `dalej` after.
2. Open a question; confirm `dalej` and `pokaż odpowiedź` are live and `pokaż ranking` is not.
3. Reveal; confirm `dalej` and `pokaż ranking` are live and the closing button is enabled.
4. Advance to the final question and reveal; confirm every flow verb is disabled and the closing
   button is enabled, ringed, and on the utility bar rather than in the menu.
5. Confirm every disabled button still shows a tooltip explaining why.

## Performance Considerations

None. The decision is called on every render and is a table lookup either way; moving it across a
module boundary changes nothing measurable. The client bundle gains a small pure module and loses the
equivalent inline source.

## Migration Notes

None — no stored data, no wire format, no route contract changes. The extraction is source-only and
reversible by a single revert.

## References

- Related research: `context/changes/testing-host-control-rules/research.md`
- Rollout strategy: `context/foundation/test-plan.md` §2 (Risks #1, #2), §3 Phase 1
- Extraction precedent: `src/lib/client/countdown.ts`, `src/lib/client/countdown.test.ts`
- Detector-plus-fixture precedent: `src/lib/client/boundary.test.ts:149-230`,
  `src/lib/session/keys.test.ts:81-139`
- Page-scan positive assertion precedent: `src/pages/quiz/host.test.ts:1088-1099`
- Fixture-by-kind helper: `src/quiz/test-support.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract the decision to `src/lib/client/controls.ts`

#### Automated

- [x] 1.1 Type checking passes: `bun run type-check` — c780a12
- [x] 1.2 Full suite passes: `bun run test` — c780a12
- [x] 1.3 Build passes: `bun run build` — c780a12
- [x] 1.4 `controls.ts` exists and `host.astro` contains no `CONTROL_RULES` — c780a12
- [x] 1.5 Boundary gate green: new module scanned and passing — c780a12

#### Manual

- [x] 1.6 Enabled verbs and tooltips identical across all four phases — c780a12
- [x] 1.7 On the last question, `dalej` disabled and closing button enabled and ringed — c780a12

### Phase 2: Executing decision tests

#### Automated

- [x] 2.1 Full suite passes: `bun run test` — 06b583c
- [x] 2.2 Type checking passes: `bun run type-check` — 06b583c
- [x] 2.3 Verified both ways: removing `end` from `standings` fails the independence test — 06b583c
- [x] 2.4 Verified both ways: adding `reveal` to `ended` fails the no-refused-verb test — 06b583c
- [x] 2.5 Verified both ways: deleting a `MATERIAL_WITHHOLDINGS` entry fails the exception test — 06b583c
- [x] 2.6 Verified: a synthetic phase in the union fails `type-check` on the route table — 06b583c

#### Manual

- [x] 2.7 A deliberately broken run names the phase and action in its failure output — 06b583c

### Phase 3: Repair the `-1` inversion class and the dead gates

#### Automated

- [x] 3.1 Full suite passes: `bun run test` — fbdc914
- [x] 3.2 Type checking passes: `bun run type-check` — fbdc914
- [x] 3.3 All six repaired assertions verified by deleting the guarded statement — fbdc914
- [x] 3.4 Both portability fixtures verified by breaking the detector regex — fbdc914

### Phase 4: Documentation

#### Automated

- [x] 4.1 Full suite passes: `bun run test` — fcc88b5
- [x] 4.2 No stale `CONTROL_RULES`-in-`host.astro` claim remains in `CLAUDE.md` — fcc88b5

#### Manual

- [x] 4.3 §6.5 answers the cookbook question standalone — fcc88b5
- [x] 4.4 CLAUDE.md amendments quote the overturned positions — fcc88b5
