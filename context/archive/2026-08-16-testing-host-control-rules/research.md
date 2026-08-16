---
date: 2026-08-16T17:01:21+02:00
researcher: Claude Opus 5
git_commit: c0afc1efd140ea652383231d7c125c3ce0c5c08c
branch: main
repository: ai-community-szn
topic: "Ground rollout Phase 1 of the test plan: host control rules (Risks #1 and #2)"
tags: [research, codebase, host-panel, control-rules, test-quality, source-scans]
status: complete
last_updated: 2026-08-16
last_updated_by: Claude Opus 5
---

# Research: Host control rules, executable (test-plan rollout Phase 1)

**Date**: 2026-08-16T17:01:21+02:00
**Researcher**: Claude Opus 5
**Git Commit**: `c0afc1e` (clean tree; `main` in sync with `origin/main`)
**Branch**: main
**Repository**: ai-community-szn

> File references below are `path:line` against `c0afc1e`. Permalink base, if needed:
> `https://github.com/jedrker/ai-community-szn/blob/c0afc1efd140ea652383231d7c125c3ce0c5c08c/<path>#L<line>`
> Individual links are not inlined — there are ~120 references and the paths are more readable
> in an editor than as URLs.

## Research Question

Ground Phase 1 of `context/foundation/test-plan.md`. Verify — not accept — the response guidance for:

- **Risk #1** — the host panel offers a verb the phase refuses, or withholds one it accepts.
- **Risk #2** — a regression reaches a live session behind a green suite, because the covering guard
  asserts source shape and cannot fail.

Specifically: where is the phase-to-verb decision made, is it reachable from a test process, what
determines the last-question variant, which existing tests execute versus scan, and which scans
assert a property versus a current shape.

## Summary

Both risks are confirmed, one of them far more sharply than the plan assumed. The plan's Risk #1
response guidance is **wrong as worded** and must be corrected before planning.

1. **The decision is pure data trapped in an unreachable scope.** `CONTROL_RULES`
   (`src/pages/quiz/host.astro:1905-1983`) lives inside the page's module `<script>` block —
   lines 1008-3337, about 70% of a 3,339-line file. Vitest cannot import an `.astro` file, so none
   of it executes in a test. But the table closes over nothing except eight string constants, and
   `atLastQuestion` / `pollTargetFor` close over only `config.questions`. **The decision is
   separable; it simply has never been separated.**

2. **The panel is a deliberate SUBSET of route legality, not a mirror of it.** The plan's guidance
   — "prove that exactly the verbs the routes accept are offered" — is false in four places on
   correct code. Writing a test to that wording would fail against a healthy panel, which is
   Risk #2 arriving from the opposite direction. The true property is a one-way implication plus an
   enumerated exception list. See "The correction" below.

3. **Risk #2 is worse than stated, and precisely measurable.** Of roughly 150 assertions in
   `src/pages/quiz/host.test.ts`, **zero qualify as property assertions.** All are shape. Six of
   them **pass when the code they guard is deleted entirely**, because they are written as
   `indexOf(a) < indexOf(b)` and `-1` is less than every valid index. `src/pages/quiz/index.test.ts`
   is the same: 0 property, 24 shape.

4. **The repository already contains the correct technique.** `src/lib/client/boundary.test.ts` and
   `src/lib/session/keys.test.ts` build a *detector*, prove it fires against synthetic bad fixtures,
   then run it over real source. Seven of nine assertion groups in `boundary.test.ts` are genuine
   properties. Phase 1 does not need to invent a method — it needs to apply the one already here.

5. **Extraction is the remedy of record, and it has worked twice.** S-11's impl review prescribed
   exactly this for the countdown, calling it "the one change that would have caught both F1 and
   F2"; it shipped as `src/lib/client/countdown.ts` with 24 executing tests.
   `connection-limit-degradation` extracted `shouldPoll` as a pure predicate for the same reason.

6. **One probable defect surfaced that is not in the risk map** — on the last question in
   `standings`, a failed re-broadcast has no retry control. See Open Questions.

Suite baseline at `c0afc1e`: **38 files, 1,444 tests, all passing, 1.79s.**

## Detailed Findings

### 1. Where the decision lives, and why no test can reach it

`CONTROL_RULES` is a top-level `const` in the module `<script>` block, not frontmatter and not an
imported module.

| Symbol | Location | Closes over |
|---|---|---|
| `NO_SESSION` (`"none"`) | `host.astro:1821` | nothing |
| 8 message constants | `host.astro:1896-1903` | nothing |
| `PhaseRule` / `ControlRule` types | `host.astro:1871-1894` | nothing |
| `CONTROL_RULES` | `host.astro:1905-1983` | `NO_SESSION` + the 8 constants |
| 7 label constants | `host.astro:2003-2005, 2027, 2050-2054` | nothing |
| `questionFor` | `host.astro:1544-1546` | `config.questions` |
| `atLastQuestion` | `host.astro:1561-1568` | `config.questions` |
| `pollTargetFor` | `host.astro:1592-1642` | `questionFor` → `config.questions`. No DOM |
| `syncControls` | `host.astro:2081-2157` | `client`, DOM handles, `revealArmed`/`revealArmedVersion` |
| `syncEndButton` | `host.astro:2193-2260` | `client`, 5 DOM handles, `endArmed`/`endArmedVersion` |
| `syncRail` | `host.astro:2319-2327` | 4 DOM handles, `setHidden` |

`config` comes from `define:vars` (`host.astro:997-1003`) onto `window.__liveQuizHost`, read back at
`host.astro:1052`. Only `questions` (`publicQuiz.questions`, a `PublicQuestion[]`) is touched by the
decision logic. No secret is passed down; the host secret is typed into `#secret` and held in
`sessionStorage`.

**File regions** — frontmatter `1-140`, template markup `141-996`, `define:vars` bridge `997-1006`,
module script `1008-3337` (~2,330 lines).

`atLastQuestion` derives position by index, with no snapshot field involved:

```
const at = config.questions.findIndex((c) => c.id === state.currentQuestionId);
return at >= 0 && at === config.questions.length - 1;
```

Its only readers are `syncControls:2085` and `syncEndButton:2210`.

**`syncControls` has four call sites, not three** — `host.astro:2401` (render's sessionless early
return), `:2622` (render's ordinary path), `:3143` (`fire`'s `finally`), `:3207` (the reveal
button's arming tap, added today by `ac76c02`). `host.test.ts:565` already asserts `toBe(4)`.
**CLAUDE.md:504-508 still says three**, and is therefore stale — a live instance of `lessons.md`'s
"The CLAUDE.md edit is part of the slice" entry.

### 2. Route legality — ground truth

Every phase in `src/lib/session/state.ts:28-65`: `lobby`, `question-open`, `question-revealed`,
`standings`, `ended`. Constants: `QUESTIONLESS_PHASES:70`, `BOARD_PHASES:85`.

Rows = phase, cells = behaviour for an authorized, well-formed request. `no-op` = HTTP 200 with
`applied: false`.

| Phase | start | advance | reveal | standings | end | purge |
|---|---|---|---|---|---|---|
| *(no session)* | accepted | 409 | 409 | 409 | 409 | accepted |
| `lobby` | no-op | **accepted** | 409 | 409 | **accepted** | accepted |
| `question-open` | no-op | accepted † | **accepted** | 409 | 409 | accepted |
| `question-revealed` | no-op | accepted † | **no-op** | **accepted** | **accepted** | accepted |
| `standings` | no-op | accepted † | 409 | no-op (`republished`) | **accepted** | accepted |
| `ended` | no-op | no-op | 409 | 409 | no-op | accepted |

† On the last question, `advance` becomes a 200 no-op — `nextQuestionId` returns `null`
(`state.ts:425-434`, `advance.ts:30-33`). No other route has a last-question variant.

Three route facts that matter for the panel:

- **`reveal` refuses inconsistently.** 409 in `lobby`, `standings`, `ended` (`reveal.ts:172-193`),
  but `question-revealed` has **no 409 branch** and falls through to the generic no-op
  (`host.ts:253-263`). Same user-visible situation, two contracts.
- **`end` has no `lobby` guard** (`end.ts:85-130`). The route accepts it; only the panel withholds it.
- **`standings` re-tap in `standings` re-publishes** (`standings.ts:137-171`), returning
  `note: "republished"` — added by `ac76c02` so the panel stops reporting "nic do zrobienia" at the
  moment a 502's retry succeeds.

### 3. The correction — panel ⊆ routes, with four deliberate withholdings

Comparing `CONTROL_RULES` against the matrix above:

| Where | Route | Panel | Recorded? |
|---|---|---|---|
| `start` mid-session | accepted (no-op `already-started`) | withheld, `ALREADY_RUNNING` | Yes — CLAUDE.md |
| `end` in `lobby` | **accepted** | disabled by `syncEndButton:2213` | Yes — CLAUDE.md |
| `advance` past last | accepted (200 no-op) | withheld via `whenLast`, `NO_MORE_QUESTIONS` | Yes — CLAUDE.md |
| `standings` on last `question-revealed` | accepted | withheld, `FINAL_BOARD_ON_END` | Yes — CLAUDE.md |
| `standings` re-send on last `standings` | accepted (`republished`) | withheld, `whenLast.allow: []` | **No** — see Open Questions |

The panel never offers a verb the route refuses. It withholds five. Four of the five have recorded
reasoning. **The testable property is therefore:**

> For every phase and last-question position, `CONTROL_RULES[phase].allow` contains no action the
> route would refuse; and every action the route accepts but the panel withholds appears in an
> explicit, named exception list.

That is a one-way implication plus a closed exception set — materially different from the equality
the test plan currently asks for, and it is the difference between a test that passes on correct
code and one that does not.

Note also that **`end` is not in `CONTROL_RULES` at all.** It is governed by `syncEndButton`'s own
inline rule (`host.astro:2213`), which is a second phase condition for a flow verb living outside
the table the single-reader guard protects. CLAUDE.md acknowledges this deliberately
("`zakończ sesję i pokaż wyniki` is deliberately outside the table"), but it means "the panel's
phase rules" is two mechanisms, not one, and a complete Phase 1 must cover both.

### 4. The test base: 30 execute, 5 scan, 3 mixed

Of 38 files: **30 EXECUTES, 5 SOURCE-SCAN, 3 MIXED.** About 2,400 of ~15,700 test lines are source
scanning — concentrated almost entirely in the two Astro pages, which have **no executing coverage
at all**.

| Class | Files |
|---|---|
| SOURCE-SCAN | `pages/quiz/host.test.ts` (1391), `pages/quiz/index.test.ts` (195), `lib/client/boundary.test.ts` (324), `quiz/portability.test.ts` (46), `lib/session/portability.test.ts` (47) |
| MIXED | `lib/session/keys.test.ts` (159), `api/quiz/host/participation.test.ts` (232), `api/quiz/host/words.test.ts` (306) |

### 5. `host.test.ts` — zero property assertions, and six that pass on deleted code

Mechanism: `host.astro` read at `:27`, comments stripped `:34-36`, `occurrences()` at `:38-40`.
Nothing executes. The file's own docblock (`:9-20`) is candid: *"nothing below proves the poll fires
at the right moment, stops at the right moment, or paints the right numbers."*

**Of ~150 assertions, 0 are property assertions.** The failure modes cluster into five kinds:

**(a) The `-1` inversion — six assertions pass when the guarded code is deleted.** Written as
`indexOf(guard) < indexOf(action)`; if `guard` is absent, `indexOf` returns `-1`, and `-1 < n` holds.

| Line | Assertion | Deleting what still passes |
|---|---|---|
| `host.test.ts:768` | `indexOf("revealArmed = true") < indexOf("void fire(action)")` | the arming — the reveal fires on first tap |
| `host.test.ts:835` | `indexOf("disarmReveal();") < indexOf("void fire(action)")` | the disarm |
| `host.test.ts:901` | `indexOf("if (!endArmed)") < indexOf('fire("end"')` | **the two-tap guard on the irreversible close** |
| `host.test.ts:653-655` | `indexOf("republished") < indexOf("no-op")` | the whole republished branch |
| `index.test.ts:117` | `clearAt < firstBranchAt` | `stopCountdown();` entirely |
| `host.test.ts:220` | `clearAt < firstBranch` | same family |

`:901` is the sharpest: the guard that stops a host ending the session on one accidental tap is
asserted by a comparison that holds when the guard is gone.

**(b) Verbatim source lines.** e.g. `:595`, `:617`, `:637`, `:994`, `:1015` quote entire lines
including spacing. Any reformat fails on healthy code.

**(c) Formatter and indentation coupling.** The block-extracting regexes depend on six-space closing
indentation (`:106`, `:158`, `:510`); `:444` requires twelve. `:1387` asserts a newline plus exactly
ten spaces — running Prettier at a different print width fails the suite with no behaviour change.
`:1020` uses a 40-character window; `:243` a 300-character one; `index.test.ts:106` a 200-character
one, disagreeing with its sibling on the constant.

**(d) Blacklists standing in for properties.** `:486` — `occurrences("/api/quiz/host/${action}")`
is the *only* defence of "nothing polled may write", and a POST built as `"/api/quiz/host/" + action`
passes. `words.test.ts:303` — `not.toContain("publishSnapshot")` is the single guard on the decision
CLAUDE.md calls "the single most plausible way to break the room"; any alias or direct Ably call
evades it.

**(e) Count assertions that break on correct code.** `:565` `occurrences("syncControls();") === 4`
uses the trailing semicolon as discriminator — `void syncControls()` is uncounted, a call in dead
code is counted, and a legitimate fifth site fails. Same shape at `:730`, `:1115`, `:1206`
(a hard-coded count of buttons in a dialog), `:1207` (keyed on the Tailwind class `text-[22px]`).

`index.test.ts` mirrors this: 0 property, 24 shape. Its `:178` relies on `onPaint` appearing before
`onExpire` in an object literal — swapping two properties makes the slice empty and the assertion
vacuously true, letting through *exactly* the recursion defect (F1) the block was written for.

### 6. The correct technique is already in this repository

`boundary.test.ts` and `keys.test.ts` are built the opposite way: they construct a detector, **prove
it fires against synthetic bad fixtures**, prove it stays quiet on a clean fixture, then run it over
real source.

- `boundary.test.ts:149` `findBoundaryViolations`; fixtures at `:203-205`, `:219-220`, `:230`,
  `:249-251`, `:268`. Seven of nine assertion groups are genuine properties.
- `keys.test.ts:114-139` — same shape; the pattern is *built from* `SESSION_NAMESPACE`
  (`:56-59`) so it cannot drift from the constant.
- `participation.test.ts:230` — `expect(readQuestionTalliesMock).not.toHaveBeenCalled()` is the one
  executed assertion in that file's scan block, and the only one that would catch an indirect call.

**Two known holes in the good pattern**, worth closing while Phase 1 is in the area:

- **Both `portability.test.ts` files have no positive fixture** (`quiz/portability.test.ts:36-44`,
  `lib/session/portability.test.ts:37-45`). A regex typo makes them pass forever and read as
  compliance — the exact dead-gate failure `keys.test.ts:63-70` says it added its fixture to prevent.
- `boundary.test.ts`'s detector is line-based, so a value import formatted across multiple lines is
  not caught. Documented for trailing comments (`:41-45`), not for this.

### 7. What extraction costs, and what it breaks

The pure symbols move with nothing attached. `syncControls`/`syncEndButton`/`syncRail` do not — their
*decision* is separable from their DOM effects, but is not separated today.

**The mechanical trap.** The single-reader guard is `host.test.ts:539-540`:

```
expect(sync).toContain("CONTROL_RULES[")
expect(CODE.replace(sync, "")).not.toContain("CONTROL_RULES[")
```

`CODE` is `host.astro`'s text. **Once the table lives in a module, `host.astro` contains no
`CONTROL_RULES[` and the first assertion fails on correct code.** The guard must move with the table
and its property ("exactly one reader") re-expressed against a module. Getting this wrong silently
loses the protection the extraction was meant to strengthen.

**The boundary constraint.** A new module under `src/lib/client/` is governed by `boundary.test.ts`:
no `import.meta.env`, no *value* import from `src/quiz/` or `src/lib/session/`. `CONTROL_RULES` is
pure strings, and `PublicQuestion` reaches it as `import type` (erased). Both fine.

**The recorded cost.** `rail-empty-at-reveal/reviews/impl-review.md` F3, on the sibling rail rule:
extraction "costs the single-writer locality this change was built around" — accepted there as a
known limitation. That tension is real and should be answered explicitly, not stepped around.

## Code References

- `src/pages/quiz/host.astro:1905-1983` — `CONTROL_RULES`, the decision table
- `src/pages/quiz/host.astro:1871-1894` — `PhaseRule` / `ControlRule` (the `whenLast` dimension)
- `src/pages/quiz/host.astro:1896-1903`, `:2003-2005`, `:2027`, `:2050-2054` — message and label constants
- `src/pages/quiz/host.astro:1561-1568` — `atLastQuestion`
- `src/pages/quiz/host.astro:1592-1642` — `pollTargetFor`
- `src/pages/quiz/host.astro:2081-2157` — `syncControls` (4 call sites: `:2401, :2622, :3143, :3207`)
- `src/pages/quiz/host.astro:2193-2260` — `syncEndButton`, incl. the `end` phase rule at `:2213`
- `src/pages/quiz/host.astro:997-1003` — `define:vars` payload
- `src/lib/session/state.ts:28-65` — `SESSION_PHASES`; `:70` `QUESTIONLESS_PHASES`; `:85` `BOARD_PHASES`
- `src/lib/session/state.ts:425-434` — `nextQuestionId`, the last-question `null`
- `src/lib/session/host.ts:152-304` — `applyHostAction`; `:253-263` the generic no-op
- `src/pages/api/quiz/host/advance.ts:30-33` — the two `return null` short-circuits
- `src/pages/api/quiz/host/reveal.ts:56-81`, `:172-193` — phase guards and their 409s
- `src/pages/api/quiz/host/standings.ts:62`, `:137-171` — the guard and the republish branch
- `src/pages/api/quiz/host/end.ts:85-130` — guard order; note the absent `lobby` branch
- `src/pages/quiz/host.test.ts:9-20` — the file's own statement that it proves nothing behavioural
- `src/pages/quiz/host.test.ts:539-540` — the single-reader guard that extraction breaks
- `src/pages/quiz/host.test.ts:768, 835, 901, 653-655` — the `-1` inversions
- `src/lib/client/boundary.test.ts:149, 203-205, 230` — the detector-plus-fixtures pattern
- `src/lib/session/keys.test.ts:56-59, 114-139` — same pattern, built from the constant
- `src/lib/client/countdown.ts` + `countdown.test.ts` — the precedent extraction, 24 executing tests
- `src/quiz/test-support.ts:57-72` — `questionOfKind`, the fixture-by-kind helper landed in `a004df7`

## Architecture Insights

- **The project's working remedy for an untestable rule is extraction, not a cleverer scan.** Three
  precedents: `countdown.ts` (S-11 F4), `toast.ts`, and `shouldPoll` from
  `connection-limit-degradation`. In each case a source scan preceded it and failed to catch a real
  defect.
- **Scans in this repo split into two populations with opposite reliability.** Detector-plus-fixture
  scans (`boundary`, `keys`) are near-property. Substring scans (`host`, `index`, `portability`, and
  the write-blacklists) are shape, and their failure is silent in both directions — they pass on
  broken code and fail on healthy refactors.
- **A "locality" rule and a "testability" rule are in direct tension here**, and the repo has
  resolved it both ways in the same fortnight: accepted locality for the rail, chose testability for
  the countdown. Phase 1 should state which it is choosing and why, rather than inheriting either.
- **The panel encodes product judgement the routes do not**, which is why subset-not-equality is
  right: `advance` past the last question is a legal no-op the host should never be offered, and
  `end` in `lobby` is legal but is the one irreversible verb.

## Historical Context (from prior changes)

- `context/archive/2026-08-14-per-question-timer/reviews/impl-review.md:79-102` — **F3**, "Both
  countdown guards certified the defects they were written to prevent." `index.test.ts` asserted
  `toContain("timeUp = false")`, the exact statement causing F1. `host.test.ts` scoped its assertion
  to a function body never reached on the broken path. Both "verified in both directions" against
  breakages that did not include the real one. Invisible to 1,276 passing tests; caught by review.
- Same file `:104-134` — **F4**, the prescribed remedy: extract to `src/lib/client/countdown.ts`,
  "the one change that would have caught both F1 and F2."
- `context/archive/2026-08-15-livequiz-signage-redesign/verification.md:43-46` — F1 re-confirmed
  live; found "only because a screen was actually looked at".
- `context/archive/2026-08-15-livequiz-signage-redesign/verification.md:13-30` — a two-device CDP
  pass **did** confirm "the enabled set matched `CONTROL_RULES` at every phase". So Risk #1 is not
  unverified; it is **unverifiable repeatably**. `:51-60` records what that pass still did not cover.
- `context/archive/2026-08-12-word-cloud-question/plan.md:792-796` — Phase 4's prescribed timer tests
  were never written because the inline script has no harness; the substitute scan "could see none
  of" the three behavioural defects review then found.
- `context/archive/2026-08-15-rail-empty-at-reveal/reviews/impl-review.md` F3 — extraction "costs the
  single-writer locality this change was built around"; ACCEPTED as a known limitation.
- `context/archive/2026-08-14-per-question-timer/plan.md:644-648, :670-674` — ten manual rows still
  unchecked, reset by review finding F5. **Rows 4.7 and 4.11 are host-panel rows.**
- **`CONTROL_RULES` has no change folder.** Introduced by `4b3836b`, extended with `whenLast` by
  `6a40a89`, amended by `ac76c02` — none archived. The only record is CLAUDE.md and test docstrings,
  so extraction overturns no documented decision.

## Related Research

None — this is the first `research.md` under `context/changes/`. The nearest equivalents are the
`reviews/impl-review.md` files in the archived slices cited above.

## Corrections to backport into `context/foundation/test-plan.md` §2

Four, all of them changes to Source citations, risk wording, or Risk Response Guidance — none adds a
file anchor to §2.

1. **Risk #1 response guidance is wrong as worded.** "Exactly the verbs the routes accept" must
   become the one-way implication plus the named exception list (§3 above). As written it would
   produce a test that fails on correct code.
2. **Risk #1's "must challenge" needs a second entry.** "The panel's phase rules are one mechanism" —
   they are two: `CONTROL_RULES` and `syncEndButton`'s inline `end` rule.
3. **Risk #2's likelihood evidence strengthens from "documented three times, lived once" to
   measured**: 0 of ~150 assertions in the highest-churn file are property assertions, and six pass
   against deleted code.
4. **Risk #2's cheapest layer changes.** The plan says "unit, plus a verification discipline". The
   discipline alone cannot fix the `-1` inversion class — those six assertions pass *because* of how
   they are written, and break-and-restore on the guard would not reveal it unless the reviewer
   deletes the guard rather than altering it. Add: convert necessary scans to the
   detector-plus-fixture pattern already in `boundary.test.ts`.

## Open Questions

1. **Probable defect, not in the risk map: the last-question `standings` re-send has no retry.**
   In `standings` with `whenLast` true, `allow: []` withholds `wyślij ranking ponownie` — the button
   that exists precisely to be the retry a 502 asks for — at the moment the board is final. The route
   would still republish (`standings.ts:137-171`). The only live control is `zakończ sesję`. Is this
   intended (the close publishes its own board, so the retry is redundant) or an oversight in
   `6a40a89`? No change folder records the decision. **Owner: user.** This is a product question, not
   a test question, and Phase 1 should not silently encode either answer as correct.
2. **Locality versus testability — which does this change choose?** The repo has recorded both
   answers within one fortnight. Extraction makes the decision executable and breaks the
   single-reader guard's current mechanism; keeping it inline preserves locality and leaves Risk #1
   permanently unverifiable. Phase 1's plan should state the choice and its cost explicitly.
3. **How far does the extraction go?** `CONTROL_RULES` + constants + `atLastQuestion` +
   `pollTargetFor` are pure and move cleanly. `syncControls` would need its decision split from its
   DOM writes to be executable. Minimum viable for Risk #1 is the table plus the two predicates;
   whether to go further is a cost × signal call for planning.
4. **Should the two `portability.test.ts` files get positive fixtures in this phase?** They are
   dead-gate risks of the same family, and cheap. Arguably in scope for Risk #2; arguably scope
   creep. **Owner: planning.**
5. **CLAUDE.md's "three call sites" is stale (four).** Fix in this change, per `lessons.md`'s entry
   on CLAUDE.md edits being part of the slice.

## Correction (2026-08-16, from implementation)

This document records what was found at `c0afc1e`. One finding did not survive being executed, and
it is left in place above rather than edited, so the reasoning that produced it stays legible.

**§5(a) "The `-1` inversion — six assertions pass when the guarded code is deleted" is wrong. None
of them does.** Rollout phase 3 deleted each guarded statement from the page and re-ran its named
test; all six failed correctly. Every one already carried a presence assertion on the line directly
above — `expect(handler).toContain("revealArmed = true")`, `expect(clearAt).toBeGreaterThan(renderAt)`
— including `:901`, which this document called "the sharpest". Verified against `c0afc1e` itself, so
it was not a later repair.

The audit read the `indexOf` line in isolation. **An audit of a guard has to execute it, which is
the rule the audit existed to enforce.** What was real, and what phase 3 shipped instead: the
presence check and the ordering check are two separable statements, and the second reads redundant
beside the third — reverting one site to the bare idiom and deleting the guarded statement leaves
the suite green. See `context/foundation/test-plan.md` §6.6.

§5's other findings stand, and §4's census stands. The two portability gates named in the plan were
confirmed dead by measurement.
