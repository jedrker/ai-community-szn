---
name: 10x-e2e
description: Drive an approved plan's browser-level (E2E) phases against the running app, one risk at a time — plan → generate → review → verify. The E2E sibling of /10x-implement and /10x-tdd, sharing the same plan and Progress. Only drives risks that genuinely need a browser and whose feature is already built; redirects the rest to /10x-tdd or /10x-implement. Use when the user says "e2e", "write/generate a Playwright test", "browser test this risk", or "drive the plan's E2E phases".
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
  - mcp__playwright__browser_navigate
  - mcp__playwright__browser_snapshot
  - mcp__playwright__browser_click
  - mcp__playwright__browser_type
  - mcp__playwright__browser_fill_form
  - mcp__playwright__browser_wait_for
  - mcp__playwright__browser_evaluate
  - mcp__playwright__browser_take_screenshot
argument-hint: "<change-id> [phase N] | @context/changes/<change-id>/plan.md | <risk-id>"
---

# 10x E2E — Risk-Driven E2E Plan Execution

You drive an approved technical plan from `context/changes/<change-id>/plan.md` to **browser-level coverage**, one phase at a time, one risk at a time. An agent can generate a *passing* E2E test in seconds; the hard part is making it **protect a real risk** and **survive tomorrow's refactor**. This skill drives only the phases where that work belongs — a risk that crosses several system boundaries (auth, routing, API, DB) or exists only in the rendered UI — and for each one runs the loop:

```
PLAN     →  pick the risk, explore the running app, map the flow (or fill the prompt template)
GENERATE →  turn the flow into a test from the seed exemplar + E2E rules
REVIEW   →  check it against the five agent E2E anti-patterns; re-prompt by name
VERIFY   →  run it green, then confirm it fails when the risk actually materializes
```

This skill is the **E2E sibling of `/10x-implement` and `/10x-tdd`**. It reads the same plan, mutates the same canonical `## Progress` section, and uses the same phase-end commit ritual and clipboard handoffs. The difference is the inner loop: instead of writing production code (`/10x-implement`) or a failing unit test first (`/10x-tdd`), you generate and harden a browser-level test against the **running app**. Because the three skills share `## Progress`, you can interleave them freely — build a feature with `/10x-implement`, unit-test the next phase with `/10x-tdd`, then come back here to add the E2E layer for a cross-boundary risk, and state is never lost.

Besides this plan-driven path, `/10x-e2e` also runs **standalone** against a single risk: `/10x-e2e <risk-id>` (or no argument) reads `context/foundation/test-plan.md`, picks the top browser-level risk, and produces **one** reviewed, break-verified test, then stops — no change folder, no `## Progress`, no commit ritual. Use it for a quick one-off outside a tracked change. Everything below about **Setup**, **Phase completion**, and **State tracking** applies to the plan-driven path only; a standalone run goes straight to the gate, loops PLAN→GENERATE→REVIEW→VERIFY once, and reports the test.

The core discipline: **don't generate E2E tests from scratch.** Start from the risk the phase names, and govern the agent's output with two quality levers — a **seed test** and **E2E rules**. The prompt supplies only what those two can't encode: the specific risk, flow, and real-vs-mocked boundaries.

```
context/foundation/test-plan.md  (the risks the plan's phases trace back to)
        │
        ▼
   seed.spec.ts  +  E2E rules  →  shape every generated test
        │                          (getByRole, isolation, wait-for-state, real vs mocked)
        ▼
   PLAN → GENERATE → REVIEW → VERIFY  →  one reviewed test per risk  →  CI
```

Agents see the **accessibility tree** (roles, names, states in a YAML snapshot with element refs), not pixels — so they naturally produce `getByRole`-based tests, not CSS selectors.

Plan path: `$ARGUMENTS`

## What this skill assumes — and what it will not do

- **Playwright is installed and the app is runnable.** A Playwright config, a way to run a **single** spec, an auth pattern (`storageState`), and a way to start the app (dev server or `webServer` config) are assumed to be in place. This skill **discovers** them; it does **not** install Playwright, scaffold configs, or wire up CI. If Playwright is absent entirely, stop and tell the user to set it up first.
- **The feature under test already exists.** E2E runs against a real, running app — so unlike `/10x-tdd`, the implementation must be **present**, not absent. If the phase's feature isn't built yet, there is nothing for the browser to drive; stop and redirect to `/10x-implement` (or `/10x-tdd`) to build it first, then come back.
- **It creates the two quality levers, but nothing more.** On first use it creates `seed.spec.ts` and the E2E rules file from `references/` if they're missing — this is the one-time per-project setup the levers need. It does **not** set up the rest of the test infrastructure.
- **It drives one reviewed test per risk, not a sweep.** Unlike "generate tests for every page," this skill writes a small, risk-tied set and hardens each one through review and a deliberate-break check. E2E is the most expensive, most flake-prone layer — coverage count is never the goal; protected risk is.
- **It gates every phase on whether E2E actually fits and whether the app is ready.** Some phases (pure logic, config, scaffolding) should never get an E2E test. Features that aren't built can't be driven in a browser. Those cases are redirected or stopped as described below.

## Phase overview

```
SETUP            →  Resolve plan, read fully, confirm Playwright + app runnable, ensure seed + rules exist, create per-phase tasks
For each phase:
  ├─ GATE        →  Is this risk browser-level, AND is the feature built, AND is the E2E test absent? If not → redirect or stop
  ├─ PLAN/GENERATE/REVIEW/VERIFY  →  Loop per risk in the phase until its success criteria are met
  └─ PHASE END   →  Relevant E2E green → manual gate → commit ritual → next-phase decision (clipboard)
After all phases →  Completion summary + optional /10x-impl-review
```

Each phase ends with a user checkpoint. Never silently skip a phase or merge two phases into one commit.

---

## Setup

> Standalone (risk-driven) runs skip this whole section — go straight to the gate.

When this skill is invoked:

1. **Resolve the plan**:
   - `/10x-e2e <change-id> [phase N]` → `context/changes/<change-id>/plan.md`.
   - `@context/changes/<change-id>/plan.md` or a full path → accept as-is.
   - **Refuse if the resolved path starts with `context/archive/`** — print "This change is archived. Open a new change with `/10x-new` instead." and STOP.
   - If nothing was provided, print the message below and **STOP and wait**:

```
I'll drive an approved plan's browser-level (E2E) phases — plan → generate → review → verify, one risk at a time. Please provide:

1. A change-id (e.g., `/10x-e2e save-session phase 6`), or
2. A full path (e.g., `@context/changes/save-session/plan.md`).

You can list active changes with: `ls context/changes/`

Tip: the plan should already be reviewed and approved — this skill executes its E2E phases, it doesn't write the plan.
```

2. **Read the plan completely** — every phase, every Changes Required block, every Success Criteria item. Never use limit/offset; you need full context. The `## Progress` section at the bottom is **authoritative for execution state** — checkmarks (`- [x]`) live ONLY there. Phase blocks carry plain `- ` bullets, no checkboxes. Note which phases trace back to a `context/foundation/test-plan.md` risk that needs browser-level coverage; those are the ones this skill drives.

3. **Read `context/foundation/test-plan.md`** if present — it carries the risk map each E2E phase protects (impact, likelihood, the behavior that would prove protection). The risk, not a file, is the unit of work here.

4. **Read `context/foundation/lessons.md`** if present and internalize each entry before starting any phase — these are the team's accepted recurring rules and must shape every test choice in this run.

5. **Confirm Playwright infrastructure exists and the app is runnable (light check — do not research the world):**
   - Find the Playwright config (`playwright.config.*`), learn the command to run a **single** spec, the auth setup (`storageState` / a `setup` project), and how the app starts (a `webServer` block, or a dev-server command). A single `Glob` for `*.spec.ts` / `playwright.config.*` plus reading one example and the config is enough.
   - **If there is no Playwright config and no `*.spec.ts` files at all**, STOP:

```
This plan's E2E phases need Playwright in place before I can drive them — I found none
(no playwright.config.*, no *.spec.ts files).

This skill assumes Playwright is already installed; it won't set it up. Options:
  • Install and configure Playwright first (npm init playwright@latest), then re-run /10x-e2e.
  • Use /10x-tdd or /10x-implement for non-browser coverage.
```

6. **Ensure the two quality levers exist (the one-time per-project setup).** These do the heavy lifting — the prompt stays thin.
   - **Seed test** (`seed.spec.ts`): the exemplar every generated test is modeled on. *What you show is what you get* — if the seed uses `getByRole`, generated tests do too; if it has `waitForTimeout`, every generated test inherits it. If absent, create it from `references/seed-test-pattern.md`, adapted to this app's real routes and roles. See also `references/browser-driven-generation.md`.
   - **E2E rules**: the rules file the agent reads automatically before generating code (`CLAUDE.md`, `.cursor/rules/`, or a dedicated file in the test dir). If absent, create it from `references/e2e-quality-rules.md`.
   - Treat both as part of the **first phase's** touched-file set so they land in that phase's commit. Once they exist, leave them — don't recreate them each phase.

7. **Update `change.md`**: set `status: implementing` (only if currently in `{planned, plan_reviewed}`) and `updated: <today>`.

8. **Create one task per phase** (these surface in the user's status bar): for each `## Phase N:` header you intend to drive, `TaskCreate` with `subject: "Phase N: [Phase Name]"` and `activeForm: "E2E Phase N"`. Mark the current phase `in_progress` before starting; mark it `completed` when its success criteria pass.

9. **Find the starting point**: scan `## Progress` — the first `- [ ]` in document order is where you start. If a `phase N` argument was passed, jump to the first `- [ ]` under `### Phase N:`.

> **Clipboard convention.** Wherever this skill says *copy `X` to the clipboard*, pipe the exact string `X` to the platform clipboard — try `pbcopy` (macOS), then `clip.exe` (Windows/WSL), then `xclip -selection clipboard` (Linux), and fall back silently if none exist. Then display the copied command on its own line suffixed with `(✓ copied)`.

---

## The E2E eligibility gate — run before every phase (plan-driven) / once (standalone)

Before you plan a single test for a phase, decide three things in this order:

1. **Browser-level fit** — the phase's risk genuinely needs end-to-end coverage.
2. **Feature presence** — the feature under test is already built and the app is runnable.
3. **Test absence** — a passing E2E test for this risk doesn't already exist.

A phase is eligible for this skill only when all three hold.

### Browser-level fit check

A risk needs E2E when it **crosses several system boundaries** (auth, routing, API, DB) or **exists only in the rendered UI**. If an isolated function, endpoint contract, or integration test could prove the risk, E2E is the wrong (slow, brittle) tool — drive it with `/10x-tdd` or `/10x-implement` instead.

| E2E-worthy — drive it here | Not E2E-worthy — redirect to /10x-tdd or /10x-implement |
|---|---|
| Full user flows across auth → routing → API → DB | Pure functions, parsers, validators, flag computation |
| Data survives a real SSR page reload / navigation | A single endpoint's status/shape/auth/gating contract |
| State that only exists in the rendered, interactive UI | Business logic with clear inputs/outputs |
| Multi-step journeys a unit test can't reproduce | Anything an isolated function or integration test can prove |
| Risks that only appear when real boundaries integrate | Config, scaffolding, infra wiring, docs |

### Feature-presence check (the inverse of /10x-tdd)

E2E drives a **running app**, so the feature must already exist. Inspect the phase's `Changes Required` and do a focused search for the routes, pages, components, and endpoints the flow touches, and confirm the app actually starts.

If the feature under test is **not built yet**, STOP — there is nothing for the browser to drive. Print this block, filling in the concrete evidence:

```
Phase [N]'s E2E risk needs a running feature, but the feature isn't built yet.

E2E runs against the real app; the implementation has to exist before the browser can drive it. Here I found it missing:
- [route/page/component/endpoint evidence]

Build it first, then come back for the E2E layer:
→ /10x-implement <change-id> phase [N]
```

Copy `/10x-implement <change-id> phase [N]` to the clipboard, display it with `(✓ copied)`, and STOP.

### Test-absence check

Do a quick search for an existing spec covering this risk. If a **passing** E2E test for the risk already exists, don't regenerate it — mark the Progress row and move on (or, if mixed, ask). If a test exists but is **failing**, that's a debugging job, not a generation job — point the user at the failing-test-to-root-cause debugging workflow rather than letting an auto-fix tool silently rewrite the assertion. (See the auto-heal boundary under E2E guidelines.)

### How to apply the gate

- If all three hold, state that in one line and proceed to the plan → generate → review → verify loop.
- If the risk is **clearly not browser-level**, run the **redirect** (below).
- If it's **mixed or ambiguous** (e.g., a phase that's partly an endpoint contract, partly a rendered-UI flow), use `AskUserQuestion`:

  - question: "Phase [N] mixes an isolated-function risk and a browser-level flow. How should I drive it?"
    header: "E2E gate"
    options:
    - label: "E2E the browser-level part (Recommended)"
      description: "I'll plan→generate→review→verify the cross-boundary flow and redirect the isolated-function part to /10x-tdd."
    - label: "Redirect whole phase to /10x-tdd"
      description: "Hand the entire phase off — copy the resume command to the clipboard."
    - label: "E2E the whole phase anyway"
      description: "Force browser-level coverage even for the parts a unit test would prove. Slower, more brittle."
    multiSelect: false

### Redirect a non-E2E phase

State *why* the phase isn't a browser-level fit (one or two sentences, grounded in the table above), then use `AskUserQuestion`:

- question: "Phase [N] isn't a good E2E fit. How do you want to handle it?"
  header: "Not E2E-worthy"
  options:
  - label: "Hand off to /10x-tdd (Recommended)"
    description: "Copy `/10x-tdd <change-id> phase N` to the clipboard. Clear context, run it, then resume E2E on the next phase."
  - label: "Hand off to /10x-implement"
    description: "Copy `/10x-implement <change-id> phase N` to the clipboard if test-first doesn't fit either."
  - label: "E2E inline here anyway"
    description: "I'll generate a browser-level test despite the cost — then continue to the next phase's gate."
  - label: "Skip — already done"
    description: "Mark the phase's Progress rows and move to the next phase."
  multiSelect: false

**On "Hand off":** copy the chosen resume command to the clipboard, print the block below, and STOP — the other skill will flip this phase's Progress rows and run its own commit ritual. Tell the user to resume E2E afterward.

```
Phase [N] isn't browser-level material — [one-line reason].

→ /10x-tdd <change-id> phase [N] (✓ copied)

Clear context (`/clear`), run that, then come back with:
→ /10x-e2e <change-id> phase [N+1]
```

**On "Skip":** flip the phase's Progress rows `[ ]` → `[x]` (no SHA, since nothing was committed) and move to the next phase.

---

## The Plan → Generate → Review → Verify cycle

Inside an eligible phase, work risk by risk. Each `#### Automated` step in the phase's Progress (or each distinct browser-level risk in its Changes Required) is one trip around the loop. Keep the loop tight — one risk, one reviewed test, verified before you move on.

### Test budget per phase

E2E is expensive and flake-prone, so the budget is **tight** — typically **one test per risk**, and rarely more than **1–3 per phase**. Pick the flow that proves the risk and would catch a real regression. You're protecting a named risk, not chasing coverage. Don't generate a test per page or per button.

### PLAN — pick the risk and map the flow

1. State the contract in one sentence: **input** = one browser-level risk; **output** = a reviewed E2E test that *fails when that risk materializes*. If the phase's risk isn't concrete, pull the observable business outcome from `test-plan.md` or the phase's Success Criteria before planning. In a standalone run with no `test-plan.md`, ask the user for the risk and its observable business outcome first.
2. Choose a path — same contract either way:
   - **Browser-driven** (default when you can drive a real browser — prefer the Playwright **CLI** for its lower token cost, else a Playwright **MCP** server): you act as both planner and generator. Navigate the running app, explore its **accessibility snapshot** (not screenshots), and map the flow for this risk — happy path plus the edge/error case the risk implies. Model the plan on `seed.spec.ts` — **seed quality is test quality.** See `references/browser-driven-generation.md` for the transport trade-off (CLI vs MCP) and the full discipline (set up the page first, snapshot over screenshots, scenarios independent and any-order).
   - **Prompt-template** (no live browser, simplest): fill `references/e2e-prompt-template.md` with the risk, research anchor, business scenario, and real-vs-mocked boundaries, and write the spec from your reading of the app. Leave the template file untouched; write a *new* prompt file for this specific risk. Use this when no Playwright MCP is available or the flow is simple and well-understood.
3. Separate **real** from **mocked** boundaries up front. **E2E ≠ zero mocking.** Internal boundaries (auth, routing, DB) stay real — that's where integration risk hides. Mock expensive or non-deterministic external APIs at the network layer. (Caveat: for an API the app calls **server-side**, browser-level `page.route()` won't intercept it — mock it where the server actually calls out.)

### GENERATE — produce the test from the levers

4. Generate the test following the conventions the seed and rules already encode — don't restate them in the prompt. On the browser-driven path, **execute each step live** and write the spec from what the run actually exposed (resilient locators, real waits), not from guesses. In principle the output must use **role-based locators**, be **independently runnable** (own setup/action/assertion/cleanup), **wait for state** not time, **authenticate without the UI**, use **unique test data**, and carry a name that **binds it to the risk** (not `test('test 1', ...)`). The rules file (`references/e2e-quality-rules.md`) holds the per-tool syntax.
5. **One test per file**, placed per the project convention (default: the project-level e2e dir, e.g. `tests/e2e/<feature>.spec.ts`). The file name is the fs-friendly scenario name; the `describe` matches the top-level plan/risk item; put each plan step's text as a comment before the actions that implement it, and keep a provenance header linking the spec to its risk and seed.

### REVIEW — five anti-patterns, re-prompt by name

6. Never trust a generated E2E test on sight. Review it against the five agent E2E anti-patterns in `references/e2e-anti-patterns.md`: hallucinated assertion, brittle selector, shared state, wait-for-time, no cleanup.
7. For any anti-pattern found, **re-prompt by name** — never "fix this test." Name the specific anti-pattern, explain *why* it doesn't protect the risk (or why it produces false failures), and give the **target pattern**. Three elements per re-prompt: what's wrong, why it doesn't protect the risk, what replaces it. See the re-prompt discipline in `references/e2e-anti-patterns.md`.

### VERIFY — green, then risk-tied

8. **Run just this spec** with the project's single-spec invocation (against the running app), and confirm it passes. Show the user the green result briefly.
9. **Control question:** *would this test fail if the `test-plan.md` risk came true?* If not, the assertion is decorative — go back to GENERATE/REVIEW. To make this concrete, do a **deliberate break**: temporarily invert or weaken the production behavior the risk targets (or the test's key assertion's target), re-run, and confirm the test goes red. If it stays green after you break the thing it's supposed to protect, the assertion protects nothing — fix it before moving on. **Revert the deliberate break immediately**; never commit it.
10. **Mark the step done.** Flip exactly that step's row in `## Progress`: `- [ ] N.M <title>` → `- [x] N.M <title>` (no SHA yet — the SHA lands at phase end). Then loop back to PLAN for the next risk.

Never use `test.skip()` / `test.fixme()` to "pass" a phase — a skipped test is invisible. A test that can't be made to pass against the real app is a signal to investigate (the feature, the flow, or the flake), not to silence.

Repeat PLAN→GENERATE→REVIEW→VERIFY until every `#### Automated` step in the phase is `[x]` and the phase's success criteria hold.

In a **standalone** run there's no phase and no `## Progress`: after VERIFY confirms green plus the deliberate break, **stop** — report the spec file and the risk it protects, and skip the phase-completion ritual below.

---

## Phase completion (plan-driven only)

When all `#### Automated` rows in `### Phase N:` are `[x]`, run the phase-end ritual (this mirrors `/10x-implement` and `/10x-tdd` — one Conventional-Commits commit per phase, then write its short SHA back into the rows that flipped).

> **Hard invariant — commit only on green.** Never propose, stage, or author a commit while any test in scope is red, skipped to fake a pass, or while a deliberate break is still in the tree. A commit is offered **only after the new E2E test(s) pass against the running app** and any deliberate-break edits are reverted. The red of a deliberate break is a transient checkpoint you show the user, never a commit boundary.

Maintain a **touched-file set** throughout the phase: every file you `Edit`/`Write` (specs, the prompt file, and on the first phase the seed + rules levers) goes in it, plus `context/changes/<change-id>/plan.md` (always — you edit its Progress). On the **first phase** of a change, also seed it with any untracked/modified files inside `context/changes/<change-id>/` (`change.md`, `research.md`, etc.). The set **resets at each phase boundary**.

1. **Run the phase's E2E spec(s)** against the running app and confirm green. (A *full* E2E pass runs in CI, not per-edit — locally you confirm the spec(s) this phase added. Fix any breakage before committing.)

2. **Manual confirmation gate.** Tell the human automated verification passed, list the plan's manual verification items for this phase (including the deliberate-break check you ran), and pause. Do not proceed until they confirm.

```
Phase [N] Complete (E2E) — Ready for Manual Verification

Automated verification passed:
- [E2E specs now green: list them]
- [deliberate-break check: which behavior you inverted and confirmed the test caught]

Please perform the manual verification steps from the plan:
- [manual items for this phase]

Let me know when manual testing is complete so I can commit.
```

   On the **final phase**, also roll up any still-pending `#### Manual` rows from earlier phases (informational; the gate still only pauses, it doesn't hard-block).

3. **Detect unrelated dirty paths.** Run `git status --porcelain`; intersect with paths **outside** the touched set. If any exist, present them and ask via `AskUserQuestion` whether to commit only the planned set (Recommended), stage all, or abort. If none, skip.

4. **Stage explicitly by path** — `git add` each file in the touched set by name. Never `git add -A` / `git add .`.

5. **Empty diff check.** `git diff --cached --quiet`; if exit 0, print that the phase had no diff (rows stay SHA-less), set `SHA=""`, and skip to step 8.

6. **Propose a Conventional-Commits message** and approve it via `AskUserQuestion` (approve as proposed / edit subject / override). Subject: `test(<change-id>): <phase title> (p<N>)`. Mention the E2E/browser-level nature and the risk protected in the body. Include a `Refs:` line if the conversation contains real Jira/Linear/GitHub references (never invent them from the change-id or branch).

7. **Commit** via a single `git commit` with a heredoc body, per the global commit-message protocol: the approved subject line, then a short body listing the specs added + the risk each protects (and the `Refs:` line when applicable). Never pass `--no-verify` / `--amend` / signing-bypass flags. If a pre-commit hook fails, fix the cause and make a NEW commit.

8. **Capture and write back the SHA.** `git rev-parse --short HEAD` → `SHA`. For every Progress row flipped this phase, Edit `- [x] N.M <title>` → `- [x] N.M <title> — <SHA>` (skip rows that already carry a SHA; if `SHA=""`, skip — `/10x-archive` surfaces SHA-less rows as informational warnings).

9. **Update `change.md`**: `updated: <today>`; keep `status: implementing` until the final phase.

10. **Reset the touched-file set** before the next phase.

### Next-phase decision

Use `AskUserQuestion`:

- question: "Phase [N] complete (E2E). How to proceed?"
  header: "Next phase"
  options:
  - label: "Continue to Phase [N+1]"
    description: "Stay in this context; run the E2E gate for the next phase and proceed."
  - label: "Clear context first"
    description: "Copy the resume command to the clipboard. Start fresh for Phase [N+1]."
  - label: "Review this phase first"
    description: "Run /10x-impl-review to verify the implementation against the plan before continuing."
  multiSelect: false

**Continue:** read the next phase, set its task `in_progress`, run the E2E gate, proceed. No need to re-read the whole plan.

**Review:** run `/10x-impl-review @<path-to-plan> phase [N]`, then re-present the continue/clear decision (without the review option).

**Clear:** copy `/10x-e2e <change-id> phase [N+1]` to the clipboard (per the clipboard convention) and display it as `→ /10x-e2e <change-id> phase [N+1] (✓ copied)`.

If told to run multiple phases consecutively, skip this question between phases. Do not check off **manual** rows until the user confirms.

---

## State tracking (plan-driven only)

**The `## Progress` section in `plan.md` is the single source of truth** — no state file, no comment markers. This skill mutates Progress exactly like `/10x-implement` and `/10x-tdd`: flip `[ ]` → `[x]` per step as it lands; append the closing commit's SHA to every row that flipped, in one shot at phase end. Mid-phase, completed rows sit `[x]` without a SHA — a valid intermediate state. Because all three skills write the same section identically, a change can be driven by any of them, in any order.

**"Where am I?" is derived, not stored:** the first `- [ ]` line is the next step; its enclosing `### Phase N:` is the current phase; completion is `count([x]) / count([ ] + [x])`.

---

## After all phases (plan-driven only)

When every `- [ ]` in the entire `## Progress` section is `[x]`:

1. **Defensive straggler scan.** Re-scan for any remaining `- [ ]`. Under normal flow there are none. If any exist (a manual edit or a bypassed trigger left them), list them grouped by Automated/Manual and ask via `AskUserQuestion` whether to **Pause** (STOP, don't touch `change.md`) or **Proceed to epilogue**.

2. **Update `change.md`**: `status: implemented`, `updated: <today>`. (Do NOT set `archived_at` — that's `/10x-archive`.)

3. **Epilogue commit.** The final phase's SHA write-back and the `change.md` status flip sit dirty after the final ritual. Stage exactly `plan.md` + `change.md` (explicit paths), check `git diff --cached --quiet` (skip if empty), propose `chore(<change-id>): close out plan (epilogue)`, approve, and commit via heredoc. Do NOT write the epilogue's own SHA back.

4. **Completion summary + optional review:**

```
All E2E phases done! 🎉

Summary:
- Phases completed: [N]  ([k] E2E'd, [j] redirected to /10x-tdd or /10x-implement)
- E2E tests added: [count] across [files], each tied to a test-plan.md risk
- Levers in place: seed.spec.ts + E2E rules
```

   Then `AskUserQuestion`: run `/10x-impl-review <change-id>` (full-plan review) or skip.

---

## E2E guidelines

Principles that govern every test here — the references carry the syntax and the full reasoning:

- **Observable user outcome** across real boundaries, not an internal call — and it **fails when its risk materializes**, confirmed by the deliberate-break check, not assumed.
- **Role-based locators**, **self-contained and isolated** (own setup/action/assertion/cleanup, unique data, auth without the UI, safe under parallel random-order runs), and **waits for state, never time**. The five ways agents violate this are in `references/e2e-anti-patterns.md`.
- **Protect the named risk, not the surface area** — no test-per-page/button, no over-mocking the internal boundaries (mock auth + DB and the test checks nothing that can break in integration), no pixel assertions for functional risks (use deterministic visual tools for those).

**Real vs mocked** is the test's core value: internal boundaries (auth, routing, DB) stay real — that's where integration risk hides; mock only expensive or non-deterministic external APIs at the network layer.

**Vision** (`--caps=vision`) is a supplement for visual-only risks (layout, z-index, animation, canvas), not the default — DOM snapshots verify function. **Auto-healing tools** help on selector/timing drift (route their output through PR review, never auto-commit) but must never "fix" a *changed business behavior* — that masks the regression the test exists to catch. Both are detailed in `references/browser-driven-generation.md`; a failing E2E test is a debugging job, not a generation or healing job.

### File placement

Follow the convention discovered in Setup. Default if none exists: project-level e2e dir, `tests/e2e/<feature>.spec.ts`, one test per file.

### If you get stuck

Use sub-tasks sparingly — `Explore` for fast file/pattern search, `general-purpose` for multi-step analysis of unfamiliar territory. First make sure you've read the relevant code and the running app's actual accessibility tree; the codebase may have evolved since the plan was written.

## Other stacks

The seed, rules, and prompt-template ship tuned for Playwright, and the browser-driven path assumes a Playwright CLI or MCP server. On Cypress, WebdriverIO, or Selenium, encode your tool's idioms (its `getByRole` equivalent, its wait-for-state mechanism, its data isolation) into your own variant of these levers and drive its own runner. The principles transfer; the syntax doesn't. `references/e2e-quality-rules.md` notes the non-Playwright mapping for each rule.

## References

- `references/e2e-quality-rules.md` — the E2E rules block + the governing rules.
- `references/e2e-anti-patterns.md` — the five anti-patterns + re-prompt discipline.
- `references/seed-test-pattern.md` — the `seed.spec.ts` exemplar + the four patterns.
- `references/e2e-prompt-template.md` — the paste-ready generation prompt + worked example.
- `references/browser-driven-generation.md` — driving the browser yourself to plan and generate one spec per risk (accessibility-tree workflow, snapshot over screenshots, one test per file, write-from-real-execution, the auto-heal boundary).
