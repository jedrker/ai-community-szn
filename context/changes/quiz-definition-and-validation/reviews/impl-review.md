<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Quiz Definition and Validation

- **Plan**: `context/changes/quiz-definition-and-validation/plan.md`
- **Scope**: Phases 1–3 of 3 (full plan)
- **Date**: 2026-08-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | WARNING |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Scope detected

Commits `fb9c201` (p1), `ed84482` (p2), `9c9bd47` (p3). Delivered under `src/quiz/`:
`schema.ts`, `normalize.ts`, `definition.ts`, `index.ts` + four test files; plus `package.json`,
`astro.config.ts`, `CLAUDE.md`, `docs/runbook-live-session.md`, `context/foundation/roadmap.md`.

`vercel.json` and `context/changes/deployment-target-readiness/*` appear in the commit range because
F-01's commit `fb7de2d` is interleaved between p1 and p2. Not part of this change.

## Success criteria verification

Re-run at review time, all green:

| Check | Result |
|---|---|
| `find node_modules -type d -name zod \| wc -l` = 1 | PASS |
| `bun run test` | PASS — 75 tests, 5 files |
| `bun run type-check` | PASS — 0 errors, 0 warnings |
| `bun run build` | PASS |

Manual: 3.4 pending by explicit user decision. 3.5 is marked `[x]` but is not actually true — see F2.

## Findings

### F1 — The build gate's documented mechanism is not the operating mechanism

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `astro.config.ts:5,25` / `src/quiz/index.ts:49,52-57`
- **Detail**: The `quiz-definition-gate` integration's `astro:build:start` hook is dead code on the
  failure path. `astro.config.ts:5` statically imports `assertQuizValid` from `src/quiz/index`, and
  that module parses the definition at module scope (`index.ts:49`). The throw therefore happens
  during config load, before any integration hook runs. Verified by breaking an invariant:

  ```
  [astro] Unable to load your Astro config

  Definicja quizu jest nieprawidłowa (src/quiz/definition.ts):
    - Pytanie "llm-skrot": punktowane pytanie jednokrotnego wyboru musi mieć dokładnie 1 …
    Stack trace:
      at parseOrThrow (src/quiz/index.ts:28:11)
  ```

  No `[quiz-definition-gate]` prefix — the hook never fired. Three artifacts now describe a mechanism
  that isn't the one working: CLAUDE.md §Deployment ("registers a `quiz-definition-gate` integration
  whose `astro:build:start` hook calls `assertQuizValid()`. A malformed quiz **therefore** fails
  `astro build`"), the `9c9bd47` commit message, and `index.ts:52-53`'s docstring, which claims the
  function exists so the gate has "an explicit call site rather than relying on import side effects"
  — the exact inverse of what happens.

  The gate genuinely works and is arguably better than planned (it also fails `type-check` and
  `test`). The risk is maintenance: a future agent deleting the "unused" static import would silently
  remove the real gate while the integration still looks present and correct.
- **Fix A ⭐ Recommended**: Make the code honest — drop the integration, call `assertQuizValid()` at
  config top level, and correct CLAUDE.md plus the `index.ts` docstring.
  - Strength: Identical failure behaviour (verified: the throw already comes from config load), less
    code, and the surviving line is unambiguously the gate — nothing looks deletable.
  - Tradeoff: Loses the `astro:build:start` framing the plan specified; the plan's Critical
    Implementation Details section would need an amendment note.
  - Confidence: HIGH — the failure path is already exactly this; removing the hook changes nothing
    observable.
  - Blind spot: Not verified whether Astro ever loads config without executing top-level imports
    (e.g. a future config-introspection mode).
- **Fix B**: Make the hook real — remove the module-scope parse from `index.ts` so the static import
  no longer throws, letting the hook do the work as planned.
  - Strength: Matches the plan's stated design, and the error would carry the `[quiz-definition-gate]`
    attribution the plan wanted.
  - Tradeoff: `quiz` must become lazy (a getter or function), changing the accessor contract S-02
    through S-08 will build on — and losing the bonus `type-check`/`test` coverage.
  - Confidence: MEDIUM — the accessor reshape is straightforward but ripples into unwritten slices.
  - Blind spot: Whether a lazy accessor reintroduces per-request parse cost in F-02's hot path.
- **Decision**: FIXED via Fix A — dropped the `quiz-definition-gate` integration, `assertQuizValid()`
  now called at `astro.config.ts` top level under a "do not remove" comment; `index.ts` docstring and
  CLAUDE.md §Deployment corrected. Re-verified: valid definition builds, broken definition still
  fails with the question-identifying message.

### F2 — Manual criterion 3.5 was confirmed on an inaccurate basis

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/quiz-definition-and-validation/plan.md` — Progress 3.5
- **Detail**: 3.5 reads "CLAUDE.md's new entries are accurate against the delivered code" and is
  marked `[x] — 9c9bd47`. Per F1, the CLAUDE.md §Deployment entry describes the gate mechanism
  incorrectly. The criterion was presented for manual sign-off with that claim already embedded in
  the summary, so the checkbox records a verification that did not hold. This is the rubber-stamp
  failure mode the criterion exists to prevent.
- **Fix**: Revert 3.5 to `- [ ]` until F1's documentation fix lands, then re-confirm.
- **Decision**: FIXED (differently) — left checked, since F1's fix made the claim true. Annotated the
  Progress row to record that it holds as of the F1 correction rather than at first sign-off, so the
  audit trail shows the criterion was repaired under review rather than verified first time.

### F3 — `normalizePolish` re-exported from `index.ts` beyond the planned surface

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/quiz/index.ts:19`
- **Detail**: The plan's accessor contract specifies "the parsed quiz value, a lookup by question id,
  and an assertion entry point", plus "re-export the schema's inferred types". Re-exporting
  `normalizePolish` is beyond that. It is benign and S-05 will want it — but the normalizer shipping
  early was already the one acknowledged scope stretch in this slice, and widening its public surface
  compounds that without being recorded anywhere.
- **Fix**: Keep it and note the re-export in the plan's accessor contract, so S-05's review doesn't
  read it as undocumented drift.
- **Decision**: FIXED — re-export kept; Phase 2's accessor contract in `plan.md` now carries an
  "Amended under impl-review F3" note recording it.

## Notes on what passed

- **Safety & Quality — PASS.** No secrets, no injection surface (nothing builds queries or shells
  out), no unbounded work (`getQuestionById` is a linear scan over 14 items), no filesystem writes.
  `getQuestionById` returns `undefined` on a miss rather than throwing, matching the `src/lib/slack.ts`
  posture CLAUDE.md names. Two things checked and found sound: the portability guard does catch
  multi-line `import { … } from "astro:content"` (the closing line matches on its own), and a choice
  question with `correctOptionIds` omitted is rejected by the arity invariant rather than silently
  defaulting through.
- **Pattern Consistency — PASS.** Named exports with no default, JSDoc that explains *why* rather than
  restating the signature, Polish user-facing strings with English code and comments, and vitest
  suites shaped like `src/lib/newsletter.test.ts`. All match the existing conventions.
- **Scope Discipline — PASS.** Every "What We're NOT Doing" boundary held: no scoring logic, no
  free-text matching, no session/transport/store, no routes, no UI, no presentation rules, no CI, and
  `src/content.config.ts` untouched.
