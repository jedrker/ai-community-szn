---
name: 10x-tdd
description: Drive an approved plan from context/changes/<change-id>/plan.md phase by phase, test-first, through red→green→refactor — only for TDD'able phases not yet implemented; everything else routes to /10x-implement. Use when the user says "tdd", "test-first", "red green refactor", or wants to execute a plan via TDD.
allowed-tools:
  - Read
  - Glob
  - Grep
  - Write
  - Edit
  - Bash
  - Task
  - AskUserQuestion
  - TaskCreate
  - TaskUpdate
  - TaskList
  - TaskGet
---

# 10x TDD — Test-First Plan Execution

You drive an approved technical plan from `context/changes/<change-id>/plan.md` to completion **one phase at a time, test-first**. This skill only applies when the phase's production implementation is still absent. For each eligible phase you run the classic loop:

```
RED      →  write a failing test that pins the next behavior
GREEN    →  write the minimal production code to make it pass
REFACTOR →  clean up with the test staying green
```

This skill is the **test-first sibling of `/10x-implement`**. It reads the same plan, mutates the same canonical `## Progress` section, and uses the same phase-end commit ritual and clipboard handoffs. The only difference is ordering: here the failing test is written **before** the production code. Because that order is the point, do not use this skill to add tests after the implementation already exists. Because the two skills share `## Progress`, you can interleave them freely — TDD a phase here, hand the next phase to `/10x-implement`, come back, and state is never lost.

Plan path: `$ARGUMENTS`

## What this skill assumes — and what it will not do

- **Test infrastructure already exists.** A runner (Vitest / Playwright / Jest / pytest / …), a way to run a single file, and the project's test conventions are assumed to be in place. This skill **discovers** them; it does **not** install a runner, scaffold configs, create fixtures, or wire up CI. If no runner exists at all, stop and tell the user to set one up first (point them at `/10x-test-plan` for a phased test rollout, or `/10x-bootstrapper` for scaffolding).
- **Production implementation is not there yet.** TDD only works when the failing test can lead the implementation. If the phase's relevant behavior, endpoint, component, migration, wiring, or other production change already exists, stop immediately; do not write retroactive tests and do not continue the phase under a TDD label. Tell the user to use `/10x-implement <change-id> phase N` to proceed with the already-started phase.
- **It drives implementation, not just test scaffolding.** Unlike the old "write all the tests up front" flow, this skill writes a small failing test, then immediately makes it green, phase by phase. There is no separate batch of orphaned failing tests.
- **It gates every phase on whether test-first actually fits and whether implementation is absent.** Some phases (config, scaffolding, visual polish, infra wiring) cannot be meaningfully driven by a failing test. Already-started implementation also cannot be recovered into true TDD. Those cases are redirected or stopped as described below.

## Phase overview

```
SETUP            →  Resolve plan, read fully, confirm test infra exists, create per-phase tasks
For each phase:
  ├─ GATE        →  Is this phase TDD'able, and is implementation absent? If not → redirect or stop
  ├─ RED/GREEN/REFACTOR  →  Loop per behavior in the phase until its success criteria are met
  └─ PHASE END   →  Full suite green → manual gate → commit ritual → next-phase decision (clipboard)
After all phases →  Completion summary + optional /10x-impl-review
```

Each phase ends with a user checkpoint. Never silently skip a phase or merge two phases into one commit.

---

## Setup

When this skill is invoked:

1. **Resolve the plan**:
   - `/10x-tdd <change-id> [phase N]` → `context/changes/<change-id>/plan.md`.
   - `@context/changes/<change-id>/plan.md` or a full path → accept as-is.
   - **Refuse if the resolved path starts with `context/archive/`** — print "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - If nothing was provided, print the message below and **STOP and wait**:

```
I'll drive an approved plan test-first (red → green → refactor), phase by phase. Please provide:

1. A change-id (e.g., `/10x-tdd oauth-login phase 1`), or
2. A full path (e.g., `@context/changes/oauth-login/plan.md`).

You can list active changes with: `ls context/changes/`

Tip: the plan should already be reviewed and approved — this skill implements it, it doesn't write it.
```

2. **Read the plan completely** — every phase, every Changes Required block, every Success Criteria item. Never use limit/offset; you need full context. The `## Progress` section at the bottom is **authoritative for execution state** — checkmarks (`- [x]`) live ONLY there (see `references/progress-format.md`). Phase blocks carry plain `- ` bullets, no checkboxes.

3. **Read `context/foundation/lessons.md`** if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every implementation choice in this run.

4. **Confirm test infrastructure exists (light check — do not research the world):**
   - If `context/foundation/test-stack.md` exists, read it — it records the runner, environment, conventions, and run commands. Use it and skip the scan. If it looks stale (references tools/configs that no longer exist), note that to the user and fall back to a quick scan.
   - Otherwise do a **quick** conventions scan (this is not the heavy infra-research phase): find the test config and 1–2 representative existing test files to learn the import style, describe/it nesting, mock patterns, and the command to run a **single** test file. A single `Glob` for `*.test.*` / `*.spec.*` plus reading one example is enough.
   - **If there is no runner and no test config at all**, STOP:

```
This plan needs a test runner in place before I can drive it test-first — I found none
(no vitest/jest/playwright/pytest config, no test scripts, no existing *.test.* files).

This skill assumes test infrastructure already exists; it won't set it up. Options:
  • Set up a runner first, then re-run /10x-tdd.
  • Use /10x-implement to build the plan without test-first.
  • Use /10x-test-plan for a phased test-rollout strategy.
```

5. **Update `change.md`**: set `status: implementing` (only if currently in `{planned, plan_reviewed}`) and `updated: <today>`.

6. **Create one task per phase** (these surface in the user's status bar): for each `## Phase N:` header, `TaskCreate` with `subject: "Phase N: [Phase Name]"` and `activeForm: "TDD Phase N"`. Mark the current phase `in_progress` before starting; mark it `completed` when its success criteria pass.

7. **Find the starting point**: scan `## Progress` — the first `- [ ]` in document order is where you start. If a `phase N` argument was passed, jump to the first `- [ ]` under `### Phase N:`.

> **Clipboard convention.** Wherever this skill says *copy `X` to the clipboard*, pipe the exact string `X` to the platform clipboard — try `pbcopy` (macOS), then `clip.exe` (Windows/WSL), then `xclip -selection clipboard` (Linux), and fall back silently if none exist. Then display the copied command on its own line suffixed with `(✓ copied)`.

---

## The TDD eligibility gate — run before every phase

Before you write a single test for a phase, decide two things in this order:

1. **Implementation absence** — the phase's production implementation is not already present.
2. **TDD-ability** — the phase can be meaningfully driven by a failing test.

A phase is eligible for this skill only when both are true.

### Existing-implementation stop

First, inspect the phase's `Changes Required`, `Success Criteria`, and pending `## Progress` rows, then do a focused code search for the files, symbols, endpoints, migrations, commands, UI surfaces, or config entries the phase is supposed to add or change. This is a quick reality check, not a broad research pass.

If the core implementation for the phase is already present or partially present, STOP immediately. Do not add tests after the fact, do not refactor the existing code, do not mark Progress rows, and do not offer to continue inline. TDD does not work for already existing code because the failing test no longer leads the implementation.

Print this block, filling in the concrete evidence:

```
Phase [N] already has implementation in place, so I can't drive it with TDD.

TDD does not work for already existing code; the failing test has to come before the production code. Here I found existing implementation:
- [file/symbol/endpoint/etc. evidence]

Use /10x-implement to proceed with this phase:
→ /10x-implement <change-id> phase [N]
```

Copy `/10x-implement <change-id> phase [N]` to the clipboard per the clipboard convention, display it with `(✓ copied)` when successful, and STOP. `/10x-implement` can continue the phase from the existing code and plan state.

If the implementation is absent, continue to the TDD-ability check.

### TDD-ability check

After confirming the implementation is absent, decide whether the phase can be **meaningfully driven by a failing test**. A phase is TDD'able when there is an **observable outcome you can assert before the code exists**.

| TDD'able — drive it here | Not TDD'able — redirect to `/10x-implement` |
|---|---|
| Pure functions, data transforms, parsers, validators | Pure scaffolding: creating dirs, config files, `package.json`/manifest edits |
| State machines / reducers / flag computation | Wiring & infra: CI files, Dockerfiles, env setup, deploy config |
| API request → response contracts (status, shape, auth, gating) | Visual / styling polish with no automated assertion path in the stack |
| Business logic with clear inputs/outputs | Exploratory spikes where the contract isn't known yet |
| Integration flows across mockable boundaries (DB/KV/HTTP) | Documentation, comments, content-only edits |
| Bug fixes (write the failing repro first) | Thin glue where a test would only restate the implementation (tautological) |

**How to apply the TDD-ability check:**

- If the implementation is absent and the phase is **clearly TDD'able**, state that in one line and proceed to the red-green-refactor loop.
- If the phase is **clearly not TDD'able**, run the **redirect** (below).
- If it's **mixed or ambiguous** (e.g., a phase that scaffolds a config *and* adds a validator with real logic), use `AskUserQuestion`:

  - question: "Phase [N] is partly scaffolding, partly logic. How should I drive it?"
    header: "TDD gate"
    options:
    - label: "TDD the testable part (Recommended)"
      description: "I'll red-green-refactor the [logic] and implement the scaffolding inline as plain steps."
    - label: "Redirect whole phase to /10x-implement"
      description: "Hand the entire phase off — copy the resume command to the clipboard."
    - label: "TDD the whole phase anyway"
      description: "Force test-first even for the thin parts. May produce low-value tests."
    multiSelect: false

### Redirect a non-TDD'able phase to `/10x-implement`

State *why* the phase isn't a fit (one or two sentences, grounded in the table above), then use `AskUserQuestion`:

- question: "Phase [N] isn't a good test-first fit. How do you want to handle it?"
  header: "Not TDD'able"
  options:
  - label: "Hand off to /10x-implement (Recommended)"
    description: "Copy `/10x-implement <change-id> phase N` to the clipboard. Clear context, run it, then resume TDD on the next phase."
  - label: "Implement inline here (no test-first)"
    description: "I'll build this phase directly from the plan and run its success criteria — then continue to the next phase's gate."
  - label: "Skip — already done"
    description: "Mark the phase's Progress rows and move to the next phase."
  multiSelect: false

**On "Hand off":** copy `/10x-implement <change-id> phase [N]` to the clipboard (per the clipboard convention), print the block below, and STOP — `/10x-implement` will flip this phase's Progress rows and run its own commit ritual. Tell the user to resume TDD afterward.

```
Phase [N] isn't test-first material — [one-line reason].

→ /10x-implement <change-id> phase [N] (✓ copied)

Clear context (`/clear`), run that, then come back with:
→ /10x-tdd <change-id> phase [N+1]
```

**On "Implement inline":** build the phase directly from the plan (following `lessons.md` and existing conventions), run its automated success criteria, then fall through to the phase-end ritual — but skip the RED/GREEN framing in the commit message (use a plain `feat`/`chore`/`refactor` subject). Then proceed to the next phase's gate.

**On "Skip":** flip the phase's Progress rows `[ ]` → `[x]` (no SHA, since nothing was committed) and move to the next phase.

---

## The Red-Green-Refactor cycle

Inside a TDD'able phase, work behavior by behavior. Each `#### Automated` step in the phase's Progress (or each distinct behavior in its Changes Required) is one trip around the loop. Keep the loop tight — small test, small code, run often.

### Test budget per phase

Write a **focused** set, not exhaustive coverage — typically **2–5 tests per phase**. Pick the behaviors that prove the phase works and would catch real regressions. You're establishing the pattern; the developer extends it later. Don't write a test per getter or constant.

### RED — write a failing test first

1. Write **one** test (or a tight cluster) for the next behavior, following the conventions discovered in Setup — import style, describe/it nesting, existing mock helpers. Don't invent new patterns.
2. Name it for the **outcome**, not the mechanism. Good: `"returns 429 when token exceeds 20 submissions per hour"`. Bad: `"calls rateLimiter.check()"`.
3. Test **outcomes, not internals** — assert on return values, rendered output, HTTP responses, or state shape, never on private method calls or execution order.
4. **Run just that test file** with the project's single-file invocation discovered in Setup (e.g. the runner's `run <path>` form, output trimmed to the tail), and confirm it **fails for the right reason** — an assertion failure or a "module not found / not implemented" for code you're about to write, **not** a syntax error or a broken import in the test itself. Show the user the red result briefly.

Never use `it.skip()` / `xit()` to "pass" a phase — a skipped test is invisible. Red is the point.

### GREEN — minimal code to pass

5. Write the **smallest** production code that makes the failing test pass. Resist building ahead of the test — future behaviors get their own RED step.
6. Re-run the test. Confirm **green**. If other tests broke, you've changed behavior — fix the code (not the tests) until the suite is green again.

### REFACTOR — clean up, stay green

7. With the test green, improve names, remove duplication, tighten types — **without changing behavior**. Re-run after each meaningful change; the test must stay green. Skip this step when there's nothing to clean up.

8. **Mark the step done.** Flip exactly that step's row in `## Progress`: `- [ ] N.M <title>` → `- [x] N.M <title>` (no SHA yet — the SHA lands at phase end). Then loop back to RED for the next behavior.

Repeat RED→GREEN→REFACTOR until every `#### Automated` step in the phase is `[x]` and the phase's success criteria hold.

---

## Phase completion

When all `#### Automated` rows in `### Phase N:` are `[x]`, run the phase-end ritual (this mirrors `/10x-implement` — one Conventional-Commits commit per phase, then write its short SHA back into the rows that flipped).

> **Hard invariant — commit only on green.** Never propose, stage, or author a commit while any test in scope is RED, skipped to fake a pass, or otherwise broken. A commit is offered **only after the GREEN (or REFACTOR) state holds and the full suite passes**. The RED step is a transient checkpoint you show the user, never a commit boundary. If the suite is red at phase end, fix the code until it's green — do not reach step 1 of the ritual with failing tests.

Maintain a **touched-file set** throughout the phase: every file you `Edit`/`Write` (tests *and* production code) goes in it, plus `context/changes/<change-id>/plan.md` (always — you edit its Progress). On the **first phase** of a change, also seed it with any untracked/modified files inside `context/changes/<change-id>/` (`change.md`, `research.md`, etc.). The set **resets at each phase boundary**.

1. **Run the full suite** (not just the single files) and confirm green. Fix any cross-phase breakage before committing.

2. **Manual confirmation gate.** Tell the human automated verification passed, list the plan's manual verification items for this phase, and pause. Do not proceed until they confirm.

```
Phase [N] Complete (test-first) — Ready for Manual Verification

Automated verification passed:
- [tests now green: list the key ones]
- [other automated checks: lint, types, full suite]

Please perform the manual verification steps from the plan:
- [manual items for this phase]

Let me know when manual testing is complete so I can commit.
```

   On the **final phase**, also roll up any still-pending `#### Manual` rows from earlier phases (informational; the gate still only pauses, it doesn't hard-block).

3. **Detect unrelated dirty paths.** Run `git status --porcelain`; intersect with paths **outside** the touched set. If any exist, present them and ask via `AskUserQuestion` whether to commit only the planned set (Recommended), stage all, or abort. If none, skip.

4. **Stage explicitly by path** — `git add` each file in the touched set by name. Never `git add -A` / `git add .`.

5. **Empty diff check.** `git diff --cached --quiet`; if exit 0, print that the phase had no diff (rows stay SHA-less), set `SHA=""`, and skip to step 8.

6. **Propose a Conventional-Commits message** and approve it via `AskUserQuestion` (approve as proposed / edit subject / override). Subject: `<type>(<change-id>): <phase title> (p<N>)`. For TDD'd phases, prefer `test`/`feat` and mention the test-first nature in the body. Include a `Refs:` line if the conversation contains real Jira/Linear/GitHub references (never invent them from the change-id or branch).

7. **Commit** via a single `git commit` with a heredoc body, per the global commit-message protocol: the approved subject line, then a short body listing the tests added + production code touched (and the `Refs:` line when applicable). Never pass `--no-verify` / `--amend` / signing-bypass flags. If a pre-commit hook fails, fix the cause and make a NEW commit.

8. **Capture and write back the SHA.** `git rev-parse --short HEAD` → `SHA`. For every Progress row flipped this phase, Edit `- [x] N.M <title>` → `- [x] N.M <title> — <SHA>` (skip rows that already carry a SHA; if `SHA=""`, skip — `/10x-archive` surfaces SHA-less rows as informational warnings).

9. **Update `change.md`**: `updated: <today>`; keep `status: implementing` until the final phase.

10. **Reset the touched-file set** before the next phase.

### Next-phase decision

Use `AskUserQuestion`:

- question: "Phase [N] complete (test-first). How to proceed?"
  header: "Next phase"
  options:
  - label: "Continue to Phase [N+1]"
    description: "Stay in this context; run the TDD-ability gate for the next phase and proceed."
  - label: "Clear context first"
    description: "Copy the resume command to the clipboard. Start fresh for Phase [N+1]."
  - label: "Review this phase first"
    description: "Run /10x-impl-review to verify the implementation against the plan before continuing."
  multiSelect: false

**Continue:** read the next phase, set its task `in_progress`, run the TDD gate, proceed. No need to re-read the whole plan.

**Review:** run `/10x-impl-review @<path-to-plan> phase [N]`, then re-present the continue/clear decision (without the review option).

**Clear:** copy `/10x-tdd <change-id> phase [N+1]` to the clipboard (per the clipboard convention) and display it as `→ /10x-tdd <change-id> phase [N+1] (✓ copied)`.

If told to run multiple phases consecutively, skip this question between phases. Do not check off **manual** rows until the user confirms.

---

## State tracking

**The `## Progress` section in `plan.md` is the single source of truth** — no state file, no comment markers (see `references/progress-format.md`). This skill mutates Progress exactly like `/10x-implement`: flip `[ ]` → `[x]` per step as it lands; append the closing commit's SHA to every row that flipped, in one shot at phase end. Mid-phase, completed rows sit `[x]` without a SHA — a valid intermediate state. Because both skills write the same section identically, a change can be driven by either or both, in any order.

**"Where am I?" is derived, not stored:** the first `- [ ]` line is the next step; its enclosing `### Phase N:` is the current phase; completion is `count([x]) / count([ ] + [x])`.

---

## After all phases

When every `- [ ]` in the entire `## Progress` section is `[x]`:

1. **Defensive straggler scan.** Re-scan for any remaining `- [ ]`. Under normal flow there are none. If any exist (a manual edit or a bypassed trigger left them), list them grouped by Automated/Manual and ask via `AskUserQuestion` whether to **Pause** (STOP, don't touch `change.md`) or **Proceed to epilogue**.

2. **Update `change.md`**: `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — that's `/10x-archive`.)

3. **Epilogue commit.** The final phase's SHA write-back and the `change.md` status flip sit dirty after the final ritual. Stage exactly `plan.md` + `change.md` (explicit paths), check `git diff --cached --quiet` (skip if empty), propose `chore(<change-id>): close out plan (epilogue)`, approve, and commit via heredoc. Do NOT write the epilogue's own SHA back.

4. **Completion summary + optional review:**

```
All phases implemented test-first! 🎉

Summary:
- Phases completed: [N]  ([k] TDD'd, [j] redirected to /10x-implement)
- Tests added: [count] across [files]
- Files changed: [key files]
```

   Then `AskUserQuestion`: run `/10x-impl-review <change-id>` (full-plan review) or skip.

---

## TDD guidelines

### What makes a good test here

- Describes **what** the system does, not **how** it does it internally.
- Fails for the **right reason** — the behavior doesn't exist yet, not a broken test.
- Is **stable** — survives refactoring, breaks only when behavior changes.
- Is **minimal** — smallest behavior that matters, simplest setup.

### What to avoid

- Testing implementation details (private state, internal call order, side-effect sequencing).
- Over-mocking — if everything is mocked you're testing your mocks. Don't mock the thing under test; mock its collaborators (KV, DB, HTTP).
- Snapshot tests for business logic (snapshots are for UI rendering stability).
- Near-duplicate tests with slightly different names; tests for trivial code.
- Building production code ahead of a failing test — every behavior earns its RED step first.

### Handling plan ambiguity

If a phase's acceptance criteria are vague ("works as expected"), don't guess. Check the Desired End State and the phase's Changes Required for concrete inputs/outputs. If still unclear, ask the user one focused question about what "success" looks like before writing the RED test.

### Handling plan ↔ reality mismatch

If a phase can't be implemented as written, STOP and present it plainly:

```
Issue in Phase [N]:
Expected: [what the plan says]
Found: [actual situation]
Why this matters: [explanation]
```

Then `AskUserQuestion` — Adapt and continue / Skip this part / Stop and re-plan.

### File placement

Follow the convention discovered in Setup. Defaults if none exists:

- **Unit tests** — next to the source file (`src/[module]/thing.test.ts`).
- **Integration / API tests** — in `tests/` (`tests/[feature]/thing.test.ts`).
- **E2E tests** — project-level e2e dir (`tests/e2e/[feature].spec.ts`).

### If you get stuck

Use sub-tasks sparingly — `Explore` for fast file/pattern search, `general-purpose` for multi-step analysis of unfamiliar territory. First make sure you've read the relevant code; consider that the codebase may have evolved since the plan was written.
