# Host Control Rules, Executable — Plan Brief

> Full plan: `context/changes/testing-host-control-rules/plan.md`
> Research: `context/changes/testing-host-control-rules/research.md`

## What & Why

The host panel's phase-to-verb decision — which of `start`, `dalej`, `pokaż odpowiedź`,
`pokaż ranking` and `zakończ sesję` is live in which phase — lives inside an Astro inline `<script>`
that no test can import. The only guard over it is a source-text scan, and this project has already
shipped guards of that kind which passed for four commits while the defect they were written to catch
was live. This phase makes the decision executable and asserts it against what the routes actually
accept.

## Starting Point

`CONTROL_RULES` sits at `host.astro:1905-1983`, inside a 2,330-line inline script in the repo's
largest and highest-churn file. `host.test.ts` is 1,391 lines of substring assertions over that file's
text; of its ~150 assertions, none is a property assertion, and six pass when the code they guard is
deleted. *(Corrected after Phase 3: the six do not — each carried a presence guard on the line
above. See `plan.md`'s Current State Analysis and test-plan §6.6.)* The panel's phase rules are two mechanisms — the table for four verbs, and a separate inline
condition for the closing verb.

## Desired End State

`src/lib/client/controls.ts` exports `verbsFor(phase, atLast)` with the table private. A new
executing test runs the decision across every phase and both last-question positions, proving the
panel never offers a verb the route would refuse, and that each place it deliberately offers *less*
is a named, justified exception. `host.astro` calls the module and contains no decision table.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Property to assert | Panel ⊆ routes, not equality | The panel withholds verbs the routes accept, so an equality assertion fails on correct code. | Research |
| Extraction scope | Table + `atLastQuestion` + `pollTargetFor` | The minimum that makes the decision executable; the `sync*` functions stay inline. | User |
| Single-reader guard | Retired, not re-expressed | Exporting a function instead of the table makes a second reader unrepresentable. | Plan |
| Closing verb | Its phase rule joins the decision; arming stays inline | One mechanism for all five verbs, without touching what CLAUDE.md actually justifies keeping separate. | User |
| Phase exhaustiveness | `import type` + `Record` over the union | Adding a phase breaks `astro check`, with no boundary exposure now or after the scan widens. | User |
| Standings-on-last withholding | Intended — named exception | The closing beat publishes its own board and `zakończ sesję` stays enabled there. | User |
| `-1` inversion repair | All six, across both test files | It is one bug class, and two instances guard the irreversible close and the reveal cutoff. | User |
| Dead portability gates | In scope — add positive fixtures | Same class, ~10 lines each, and `keys.test.ts` already documents the reasoning. | User |

## Scope

**In scope:** the decision table and two pure predicates move to `src/lib/client/controls.ts`; an
executing test asserting panel ⊆ route legality with a named exception list; repair of six `-1`
ordering assertions; positive fixtures for two portability gates; CLAUDE.md and test-plan §6.5.

**Out of scope:** making `syncControls` executable; extracting the arming state or `syncRail`; any
runtime behaviour change; converting the rest of `host.test.ts`'s shape assertions; changing the
standings-on-last behaviour; e2e, browser or visual coverage.

## Architecture / Approach

```
host.astro (inline script)                  src/lib/client/controls.ts
  syncControls    ──── calls ────────────►    verbsFor(phase, atLast) → Decision
  syncEndButton   ──── calls ────────────►    (CONTROL_RULES private)
  poll loop       ──── calls ────────────►    pollTargetFor(questions, state)
                                              atLastQuestion(questions, id)
                                                        ▲
                                                        │ executes
                              src/lib/client/controls.test.ts
                                Record<SessionPhase, Record<FlowAction, RouteOutcome>>
                                + MATERIAL_WITHHOLDINGS (3 named exceptions)
```

The page keeps every DOM write; the module owns only the decision. The test states route legality as
a literal derived from `research.md` §2 and cross-referenced to `routes.test.ts`, which is what
executes the routes themselves.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract | `controls.ts` + rewired page, no behaviour change | A silent behaviour change in the repo's hottest file; the `end` verb must escape the `whenLast` collapse |
| 2. Decision tests | Executing coverage of all 12 phase × position decisions | The route matrix is hand-written, so it can drift from the routes it describes |
| 3. Guard repair | Six `-1` assertions fixed, two dead gates given fixtures | Touching test files outside this phase's nominal area |
| 4. Docs | CLAUDE.md amended, test-plan §6.5 filled | Missing one of the four falsified claims |

**Prerequisites:** none — the suite is green at `c0afc1e` (38 files, 1,444 tests, 1.79s).
**Estimated effort:** ~2 sessions. Phase 1 is the bulk; Phase 3 is independently landable and could go
first.

## Open Risks & Assumptions

- **Phase 1 proves the table is right, not that the panel applies it.** `syncControls` stays
  unreachable, so a decision computed correctly and written to the wrong button is still invisible.
  This is the accepted cost of the chosen scope and the first thing a later phase should close.
- **The route matrix in the test is hand-maintained.** Route guards are branches inside handlers and
  are not machine-readable; if a route's phase rule changes without this table being updated, the
  panel test keeps passing against a stale picture. Mitigated only by the comment pointing at
  `routes.test.ts`.
- **`pollTargetFor` moving is wider than it looks** — it also drives the poll loop, so
  `host.test.ts:278-322` is rewritten as a consequence rather than as a goal.

## Success Criteria (Summary)

- The phase-to-verb decision is asserted by running it, across every phase and both last-question
  positions, and each new guard has been observed failing when its code is broken.
- No guard anywhere in the suite still passes when the statement it protects is deleted.
- A future contributor can read test-plan §6.5 and know how to test a rule trapped in an inline script.
