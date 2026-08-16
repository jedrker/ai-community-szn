---
name: 10x-test-plan
description: >
  Stateful, phased test-rollout orchestrator for existing products. Writes
  context/foundation/test-plan.md, then drives each rollout phase through
  /10x-new → /10x-research → /10x-plan → /10x-implement; re-running resumes
  from the next pending phase. Trigger phrases: "create test plan", "test
  strategy", "phased test rollout", "QA spec", "stwórz plan testów",
  "strategia jakości". Use AFTER /10x-prd and /10x-roadmap. Brownfield only.
argument-hint: "[path ...] | --status | --refresh"
---

# 10x Test Plan — Stateful Phased Rollout Orchestrator

This skill writes and manages `context/foundation/test-plan.md` as a **phased rollout strategy**, then launches one rollout phase at a time into the 10x change/research/plan/implement chain. The guide starts as the *blueprint* of phases — each phase eventually opens its own `context/changes/<change-id>/` folder and fills in the cookbook sections (§6) as it ships. The skill is **stateful**: every invocation re-derives the current state by checking which artifacts exist, and resumes from the next pending rollout phase. It does **not** force a return to `/10x-test-plan` after every downstream stage. Once a rollout change is opened, the established process is research → plan → implement: after each major phase, suggest the next natural command unless there is a clear blocker, correction, or decision that belongs back in `/10x-test-plan`.

`$ARGUMENTS`:

- **empty** → derive state and act on the next pending step.
- **one or more paths** → context sources for Phase 1 (PRDs, scoping notes, briefs). Strip a leading `@` if present.
- **`--status`** → print the rollout status (where we are, what's next) without doing any work.
- **`--refresh`** → open a new `test-plan-refresh-<YYYY-MM-DD>` change to update an existing guide; does not edit the guide in place.

## The state machine

Every invocation runs this decision tree. Each state corresponds to "what file is missing right now":

1. **Phase 0 — Preconditions + state detection (always runs).** Check project marker, branch on `--status`/`--refresh` flags, then check whether `context/foundation/test-plan.md` exists.
2. **If the guide is MISSING**, run the write path end-to-end:
   - Phase 1: Discovery (read sources, hot-spot scan, test-base profile).
   - Phase 2: User interview.
   - Phase 3: Synthesize the seed brief.
   - Phase 4: Write the phased `test-plan.md`.
   - Then fall through into Phase 5.
3. **If the guide EXISTS** (or has just been written), proceed to Phase 5: read the guide and locate the first rollout phase whose status is not `complete` — that is the current rollout phase.
4. **Phase 6 — Determine sub-state for the current rollout phase and present the next handoff**, based on which artifacts exist on disk:
   - change folder missing → `/10x-new`
   - `change.md` only → `/10x-research`
   - `+ research.md` → `/10x-plan`
   - `+ plan.md` with pending Progress items → `/10x-implement`
   - `+ plan.md` fully complete → mark the rollout phase complete in §3 and advance (loop back to Phase 5).
5. **Handoff** — copy the next invocation to the clipboard, tell the user to `/clear` and run it, then STOP.

Each handoff is a **STOP point** for this skill. The user `/clear`s and runs the queued invocation. After each major downstream phase, the completed phase should suggest the next natural command in the research → plan → implement process. Re-run `/10x-test-plan` only when a downstream stage reports test-plan corrections, a rollout phase is complete and the next phase should be selected, or the user wants `--status` / `--refresh`.

## Load-bearing principles

Three rules every invocation obeys; all three land in §1 of the artifact.

1. **Cost × signal.** Every test the rollout adds — classic or AI-native — must answer one question: *what is the cheapest test that gives a real signal for this risk?* Do not promote to e2e because it "feels safer"; do not layer a vision model on top of a deterministic diff that already catches the regression. Pass this through to `/10x-plan` for every rollout phase.

2. **User concerns are evidence.** Risks the team has lived through carry the same weight as PRD lines or hot-spot data.

3. **Signal, not knowledge.** This skill reads the codebase for *signal* — hot-spot churn, test-base profile, project marker, language/framework. It does **not** read for *knowledge* — call graph, schemas, error translation, which line owns a failure. The §2 risk map cites evidence (PRD lines, interview answers, hot-spot directories); it never asserts a file as "where the failure lives." That anchor is `/10x-research`'s output, produced during each rollout phase. The skill is a **QA spec author and challenger**, not a code auditor.

   Operational consequence: when the hot-spot scan surfaces `src/lib/foo/` as a top directory, §2 may cite "hot-spot dir `src/lib/foo/` — 12 commits/30d" as *likelihood evidence*. It may NOT cite "anchor: `src/lib/foo/bar.ts`" — the call graph inside that directory is unverified until research runs.

## When to use, when to skip

**Use when** the project has at least a PRD or a few archived slices and the user is about to invest in tests.

**Skip when**:

- there is no PRD, no roadmap, and no implemented code (run `/10x-shape` → `/10x-prd` first);
- the user wants to add **one** test to a single file — that is `/10x-tdd` territory, not a rollout;
- the user wants to configure hooks, MCPs, or CI YAML in isolation — those can become rollout phases, but a standalone configuration task is a different skill.

## Relationship to other skills

| Skill              | Role                                                                                   |
|--------------------|----------------------------------------------------------------------------------------|
| `/10x-shape`, `/10x-prd`, `/10x-roadmap` | Upstream. Produce the PRD/roadmap that discovery consumes.      |
| `/10x-stack-assess` | Upstream (brownfield). Identifies the existing test base.                             |
| `/10x-new` → `/10x-research` → `/10x-plan` → `/10x-implement` | Downstream chain, invoked once per rollout phase. `/10x-test-plan` launches the chain; after each major phase, the active downstream skill suggests the next natural command in the established research → plan → implement process unless blocked. `/10x-research` is the **knowledge-extraction surface** — it reads the code, traces call graphs, and produces the file:line anchors this plan deliberately omits. |
| `/10x-tdd`         | Sibling. Reads the cookbook (§6) when adding a single test.                            |

---

## Phase 0 — Preconditions + state detection (always runs)

This phase fires on every invocation.

### Step 0.1 — Detect project marker

Confirm this is a real project root by finding its ecosystem manifest in whatever way fits the repo — there is no fixed command. Look near the root for the conventional marker(s) for the stack at hand (e.g. `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `Gemfile`, `composer.json`, `*.csproj`, `pubspec.yaml`, or framework equivalents). A PRD under `context/foundation/` also counts as a valid starting point.

If no project marker is found, print:

```
No project markers found in the current directory. /10x-test-plan needs an
existing project (or at least a PRD). If you're at the idea stage, run
/10x-shape and /10x-prd first.
```

…and STOP.

### Step 0.2 — Branch on `--status` / `--refresh`

- **`--status`**: read the guide if it exists, print the rollout status table (phase name → status → change folder if any), and STOP without doing work. Useful when the user is unsure where they left off.
- **`--refresh`**: jump to the Refresh path (end of this skill). Does not modify the existing guide in place.

### Step 0.3 — Check whether the guide exists

```bash
test -f context/foundation/test-plan.md && echo "EXISTS" || echo "MISSING"
```

- **MISSING** → proceed to Phase 1 (full discovery → write guide).
- **EXISTS** → skip to Phase 5 (read guide, derive current rollout phase, hand off).

This is the load-bearing branch. Everything downstream depends on it being correct, so always make the file-existence check explicit; never infer from prior conversation history.

---

## Phase 1 — Discovery (only when the guide is missing)

Read what exists; do not invent. For every input, record the file path you actually read; if a fact appears in the seed brief or the guide, it must trace back to one of these.

### Sources to discover (skip what is missing)

Explicit paths from `$ARGUMENTS` are **always read**, regardless of where they live. The defaults below are searched only when not already supplied via arguments.

| Source | Default path | What to extract |
|---|---|---|
| PRD-like docs | `context/foundation/prd.md` + argument-provided paths | Users, primary flows, non-goals, business rules, dependencies, success metric |
| Roadmap | `context/foundation/roadmap.md` + argument-provided roadmap | Upcoming slices, what is "next" (raises likelihood) |
| Archived slices | `context/archive/*/plan.md` + argument-provided slice plans | What is already implemented (current risk surface) |
| Tech stack | `context/foundation/tech-stack.md` + argument-provided stack note, OR detect via manifest | Language, framework, runtime, test runner already in use |
| Briefs / scoping notes | argument-provided only — no fixed default | Constraints, non-goals, risk hints that never landed in a PRD |
| Existing AGENTS.md / CLAUDE.md | repo root | Hard rules and conventions that constrain testing choices |
| Existing testing config | `vitest.config.*`, `jest.config.*`, `playwright.config.*`, `pytest.ini`, etc. | What test infra already exists |
| Session MCP tools | current host/session tool list | Docs/search MCPs that can ground stack-sensitive recommendations |

### Read sources

Read explicit `$ARGUMENTS` first, then the relevant defaults not already covered by an argument. Use parallel reads or subagents when the host makes that cheap, but keep the output contract the same for every source:

1. **Source type** — PRD-like, roadmap, tech-stack, archived slice, brief, AGENTS rules, test config, or other.
2. **2–4 risk-relevant facts** — failure scenarios the source implies.
3. **Hard constraints** — "must not" rules, framework lock-ins, compliance lines.
4. **Honest gaps** — if the source is empty/off-topic/thin, say so explicitly.

Return concise notes with `path:line` citations. Do **not** delegate Phase 3 (brief synthesis).

### Test-base profile (always runs)

Before opening the interview, build a one-line intuition of the existing test base so Phase 2 does not ask hollow questions ("what feels under-tested?" is nonsense when nothing is tested). Classify the project into one of three buckets.

Detect the test base in whatever way fits the stack you actually found in Phase 1 — there is no fixed command. Use the project's real test-runner config and test-file conventions (e.g. `vitest`/`jest`/`playwright` configs and `*.test.*`/`__tests__/` for JS-TS; `pytest`/`pyproject.toml` and `test_*.py` for Python; `*_test.go` for Go; framework equivalents otherwise), and exclude vendored/build directories. Aim for two facts: does a test-runner config exist, and roughly how many real test files exist and where they cluster.

Classify:

- **`none`** — no test config found AND fewer than 3 test files. The project has effectively no suite.
- **`sparse`** — config exists but fewer than ~15 test files, or test files cluster in only one area while the rest of the codebase is bare.
- **`meaningful`** — config + a real suite (~15+ test files spread across the codebase). The project has a test culture; it may still have gaps.

Persist the verdict (one line: bucket + a short justification like "vitest configured, 4 test files all in `packages/api/`") for §4 (Stack) of the guide and for the Phase 2 interview to branch on.

### MCP-assisted stack grounding (always runs)

Before recommending test tooling, AI-native tools, hooks, browser automation, CI gates, or framework-specific test layers, inspect the MCP/tools available in the **current session**. This is a grounding step, not a requirement to use every tool.

Look specifically for tools that can reduce stale or generic stack advice:

- **Technical docs MCPs** such as Context7, framework/library docs, vendor docs, or package docs. Use these first for exact APIs, current framework guidance, version-specific test setup, and deprecated/renamed commands.
- **Search/discovery MCPs** such as Exa.ai. Use these when the right official page is not known, when comparing current tool support, or when checking whether a testing/MCP feature is current, preview, deprecated, or region/vendor-limited.
- **Browser/runtime MCPs** such as Playwright/browser automation. Note whether they are available as a possible test or verification layer, but recommend them only when they add signal beyond cheaper deterministic tests.
- **Provider/platform MCPs** such as GitHub, Linear, Cloudflare, Supabase, Vercel, or database tools. Note read-only capabilities that could support future quality gates, log inspection, issue creation, or environment verification.

Host-agnostic detection rule:

1. Inspect the available tool names/descriptions exposed to the agent in this session. If the host has a tool-discovery surface, query it with terms like `docs`, `Context7`, `Exa`, `search`, `browser`, `Playwright`, `github`, `cloudflare`, `database`, and the detected framework/runtime names.
2. Do not invent MCPs from examples. If Context7 or Exa.ai is not exposed in this session, write "not available in current session" rather than assuming access.
3. Use official docs through a docs MCP when available. Use search MCPs to find current official docs or recent status pages, then prefer the primary source over blogs.
4. Apply the same **signal, not knowledge** boundary as the rest of Phase 1: MCP docs/search can validate that a tool is supported, current, or appropriate for the detected stack. They do not locate code anchors for specific failures; that remains `/10x-research`.

Persist a short `Stack grounding tools` note for §4 and the seed brief:

```markdown
**Stack grounding tools (current session):**
- Docs: <Context7 / framework docs MCP / none> — <what was checked or why skipped>; checked: <YYYY-MM-DD>
- Search: <Exa.ai / web search MCP / none> — <what was checked or why skipped>; checked: <YYYY-MM-DD>
- Runtime/browser: <Playwright MCP / browser tool / none> — <possible use, or "not used">; checked: <YYYY-MM-DD>
- Provider/platform: <GitHub/Cloudflare/Supabase/etc. / none> — <quality-gate relevance, or "not used">; checked: <YYYY-MM-DD>
```

If no useful MCPs are available, continue with local manifest/config evidence and say so explicitly in §4. Lack of MCP access must not block the rollout.

### Hot-spot scan (git history)

Run a git-history hot-spot scan over the last 30 days, **scoped to the project's main codebase directories only**. **Change frequency is one of the strongest signals for likelihood**. Scanning the whole repo drowns the signal in churn nobody writes by hand.

#### Step 1 — Identify the main-codebase root(s)

Locate the directories that hold hand-written application code, in whatever way fits the stack found in Phase 0 — there is no fixed command. Look for the conventional source roots for that ecosystem (e.g. `src`/`app`/`lib` for JS-TS, the package directory for Python, `cmd`/`internal`/`pkg` for Go, workspace members for Rust, `src`/`app` for PHP) and respect monorepo workspace layouts. Exclude vendored, generated, and build output (`node_modules`, `dist`, `build`, `.next`, `target`, `coverage`, `vendor`, and the like). The goal is the set of paths where churn reflects real authoring, not tooling noise.

#### Step 2 — Confirm scope with the user

> Detected main-codebase scopes for the hot-spot scan: `<scope 1>`, `<scope 2>`, `<scope 3>`. Excluding docs, fixtures, archive, build output. **Accept**, or paste an **override** list.

If detection returns nothing, fall back to repo root with the default exclusion list and explicitly tell the user. Never silently scan everything.

#### Step 3 — Run the scan

Use the confirmed scopes to collect the top changed hand-written files and directories from the last 30 days. Exclude lockfiles, snapshots, vendored code, generated code, and build output. The exact command is host- and stack-dependent; the output must include:

- scope list used;
- top changed files, if useful;
- top changed directories, preferably grouped around depth 2–3;
- whether the scoped history has enough signal.

**Insufficient-history guard.** If the scoped git log returns fewer than 5 commits in the last 30 days, skip the scan and note in the Phase 1 checkpoint: "Hot-spot scan: insufficient git history — likelihood ratings in the guide will rely on roadmap and user interview only."

Persist the output as a short note that Phases 2, 3, and 4 consume.

### Checkpoint

Summarize the inputs back to the user in ≤12 lines: `path → classified-type → 1-line gist → [argument | default]`, plus a 3-line hot-spot recap. Confirm before moving to Phase 2.

## Phase 2 — User Interview (only when the guide is missing)

Phase 1 surfaces what the documents say. Phase 2 surfaces what the user knows that documents never capture: past incidents, gut fears, areas they change without confidence, and explicit instructions about what *not* to test. Treat its answers with the same weight as PRD lines or hot-spot data — a risk anchored in "user fears Y, failure would surface in `<file>`" is grounded as long as the file holds up under research.

Skip the interview only if the user explicitly asks. Warn once that document-only rollouts mirror whatever the PRD emphasises, which is rarely what the team actually fears breaking.

### Conduct

Ask **one question at a time**, conditioned on the previous answer — not as a form. Always pair the question with **2–3 short, concrete examples** so the user can feel the shape of the answer you want (and recognise when their situation differs). Examples are scaffolding, not options — make it clear the user should answer in their own terms. After each answer, echo it back in one line so the user can correct misreadings cheaply. Then ask the next.

The user may reply "skip" to any question. If three or more are skipped, abort the interview, note that the rollout will lean on documents only, and proceed to Phase 3 with a one-line warning.

### The five questions

Each question below ships with example answers. Read them to the user as part of the prompt; adapt the examples to the project's domain when an obvious adaptation exists (e.g., for a billing product, use billing-flavoured examples).

1. **"What worries you most about this product breaking — independent of what the docs say?"**
   - e.g., "A paying user gets a 403 and can't reach the content they paid for."
   - e.g., "Webhook from Stripe arrives twice and we double-charge."
   - e.g., "A silent data-loss bug in the import pipeline that nobody notices for a week."

2. **"Where have you been burned before in this codebase, or one like it?"**
   - e.g., "Last quarter a migration ran fine in staging and corrupted prod rows."
   - e.g., "A refactor of the auth middleware logged users out for 30 minutes."
   - e.g., "We shipped a build where the catalog was missing half the lessons and nobody noticed for a day."

3. **"Which area do you change most often without feeling confident?"**
   - e.g., "The lesson-gating logic — every tweak feels like roulette."
   - e.g., "The Cloudflare Worker routing — works locally, breaks in prod."
   - e.g., "The R2 upload script — I run it and pray."

4. **"What feels under-tested today that you've been quietly worried about?"** *(see conditional rewrite below if the test-base profile is `none`)*
   - e.g., "The webhook retry path — we have one happy-path test and that's it."
   - e.g., "Error boundaries — they exist but I've never seen them fire in a test."
   - e.g., "Anything that touches money — coverage is light and the impact is severe."

5. **"What would you NOT want test budget spent on, even if a textbook says to test it?"**
   - e.g., "Internal admin tools — five trusted users, low blast radius."
   - e.g., "Generated TypeScript clients — the generator is the test."
   - e.g., "UI snapshot tests for marketing pages — they break constantly and catch nothing."

If a user's answer to one question fully covers the next, acknowledge the overlap and move on. Five turns is a ceiling, not a quota.

### Conditional rewrite for Q4 based on test-base profile

The Phase 1 test-base profile decides how (or whether) to ask Q4:

- **`meaningful`** — ask Q4 as written. The user has tests; "under-tested" is a coherent concept.
- **`sparse`** — rephrase: *"You have some tests in `<area>` but most of the codebase is bare. Where is the gap that scares you most?"* and offer the same examples.
- **`none`** — **skip Q4**. There is nothing to be under-tested *relative to*. Tell the user explicitly: *"Skipping the 'under-tested' question — no meaningful suite exists yet, so the answer would be 'everything'. Phase 1 of the rollout will bootstrap the test runner."* Do not count this as a user-initiated skip toward the abort threshold.

**Optional priming on Q3.** If the hot-spot scan produced a usable list and the user's answer to Q3 is vague, show the top 3 hot-spot directories and ask whether any of them match. Never lead with the list; never let it overwrite a clear verbal answer.

### Record

Persist the answers as a structured note (in-memory; passed into the brief and the guide):

```markdown
**User-stated concerns (Phase 2 interview):**

| # | Question | User answer (paraphrase OK) | Implied risk(s)                            |
|---|----------|------------------------------|---------------------------------------------|
| 1 | Worries most         | "Paid user gets a 403 instead of their content." | API gating regression on lesson endpoint |
| 2 | Burned before        | "Catalog build silently dropped lessons last month." | Strict ref resolution at build time |
| 3 | Change without confidence | (skipped) | — |
| 4 | Under-tested today   | "The webhook retry path." | Billing webhook idempotency |
| 5 | Do NOT spend on      | "Internal admin tools — we trust the small set of users." | Negative space note |
```

## Phase 3 — Synthesize the seed brief (only when the guide is missing)

In-memory only. The brief drives Phase 4 and is the source of truth for the rollout structure.

```markdown
# Seed Brief (in-memory)

## 1. Top risks (5–7): | # | Risk (failure scenario) | Impact | Likelihood | Source(s) — evidence, not anchors |
## 2. Hot-spots (top 5 files + top 5 directories, scope list) — used as likelihood evidence, not as failure-location anchors
## 3. User-stated concerns (verbatim from Phase 2)
## 4. Stack notes (detected test infra, or "none yet"; include Stack grounding tools checked in current session)
## 5. Risk response guidance: | Risk # | What would prove protection | Must challenge | Context needed | Likely cheapest layer | Anti-pattern to avoid |
## 6. Proposed rollout phases (3–5): | # | Phase name | Goal | Risks covered | Test types | Order rationale |
```

Illustrative phase rows: "Critical-path coverage" (cheapest layer for top risks), "Integration around hot-spots" (churn-heavy modules), "AI-native layer" (only if it adds signal classic tests miss cheaply), "Quality-gates wiring" (lock the floor).

### Risk response guidance (mandatory)

For each top risk, add a response row before proposing rollout phases. This is the bridge between "we identified a risk" and "a downstream skill knows how to attack it." Keep it evidence-based: use PRD/interview/archive/hot-spot signal and stack constraints, but do not invent file anchors.

Each row answers:

- **What would prove protection** — the observable behavior or failure mode a useful test must catch. Phrase it as user/business behavior, not "cover function X."
- **Must challenge** — the obvious but dangerous assumption the agent should not accept silently. Examples: "happy-path login implies paid-content access works," "empty response means no content," "retry succeeded because the final status is 200," "generated schema equals product contract."
- **Context needed** — what `/10x-research` must ground before planning: entry point, persisted state, external boundary, error translation, auth/session shape, ordering guarantee, idempotency rule, fixture/source-of-truth data, etc.
- **Likely cheapest layer** — unit, integration, contract, e2e, deterministic visual diff, AI-native review, hook, or manual smoke. This is a hypothesis for `/10x-research` to verify, not a command.
- **Anti-pattern to avoid** — one concrete failure mode in the future test: implementation mirror, happy-path-only, assertion copied from production logic, over-mocking internals, brittle order assumption, snapshot-without-meaning, e2e where integration would catch it, or AI-native layer over deterministic signal.

If a risk cannot produce this row, it is not actionable enough for the rollout. Reframe it or drop it before Phase 4.

### Abuse / security lens (mandatory when applicable)

If the product has authentication, payments, or accepts any user input, the top-N risks must include at least one **abuse scenario** — the happy path excludes the attacker, so these almost never surface from the Phase 2 interview on their own. Before finalizing the brief, run the risk set against these classes and add a row where the product genuinely exposes the surface:

- **Authorization/access** — IDOR and ownership checks: does the endpoint verify *this resource belongs to you*, not just *you are logged in*?
- **Untrusted input** — injection and server-side validation parity (the server must not trust the client).
- **Secret/PII leakage** — keys, tokens, or personal data escaping into logs, error bodies, or the front-end bundle.
- **Resource abuse** — rate-limit bypass, costly operations in a loop, mass-triggering of side effects (e.g. magic-link floods).

These are ordinary failure scenarios scored on the same impact × likelihood axes, cited with the same evidence rules — not a separate framework, and never a file anchor. If the product has these surfaces and the map has zero abuse rows, that is a gap to close, not a sign the product is safe.

### Impact × likelihood calibration

Score both axes on a coarse High / Medium / Low scale (see `references/test-plan-schema.md` §2 for the rubric) so the ordering is reproducible. Protect High × High first. High-impact × Low-likelihood scenarios (e.g. cloud-provider outage) usually belong to observability/alerting, not a test — note that instead of padding the map. Do not invent finer gradations; the goal is a defensible order, not false precision.

### Challenger pass (mandatory)

Before showing the brief to the user, walk every top-N risk and apply the QA-consultant lens. Three checks per risk:

1. **"Is this a defect, or am I describing the implementation?"** If breaking the risk would require *adding* a safeguard first (e.g., "no fallback path" when no fallback exists), the risk is speculative — drop it or reframe it to test what *does* exist (e.g., "outage path surfaces a clean 5xx, doesn't pretend to succeed, doesn't write to the database"). Speculative risks that survive into §2 force `/10x-research` to either invent code under test or flag the risk back for revision; both waste a cycle.

2. **"Does this row cite a file as anchor?"** Strip anything in the Source column that looks like `src/foo/bar.ts:42` or `<module>` (specific symbol). Replace with the evidence that *raised* the risk — interview Q#, PRD line, hot-spot **directory**. If after stripping there is no evidence left, the risk is unsourced and must be dropped or supported by a real interview/PRD citation.

3. **"Would the recommended response catch a real regression, or only make coverage go up?"** Reject response guidance that says only "add unit tests," "cover the module," "test the happy path," or "assert current output." A valid response names the behavior/failure mode, the context `/10x-research` must verify, and at least one anti-pattern to avoid. The single most dangerous anti-pattern for AI-written tests is the **oracle problem**: an assertion whose expected value was lifted from the implementation under test rather than from an independent source (requirements, contract, interview). Such a test is tautological — it green-lights current behavior, including current bugs, and can never fail for the right reason. Frame the "What would prove protection" cell as user/business behavior precisely so the downstream test gets its oracle from the risk, not from the code it reads.

Both checks fire silently — they're how the brief gets cleaned, not a user-facing step. If a risk is dropped or reframed, note it in a one-line "Challenger findings" subsection at the end of the brief so the user can see what was removed and why.

Show the (cleaned) brief; ask for **Accept** / **Edit** / **Cancel**.

## Phase 4 — Write the phased `test-plan.md` (only when the guide is missing)

Write **one file**: `context/foundation/test-plan.md`, following `references/test-plan-schema.md`. The schema is fixed; content adapts to the brief.

Two enforcement points the schema makes explicit — do not relax them:

- **§1 Strategy must contain principle #3** ("Risks are scenarios, not code locations"). Boilerplate-copy from the schema; do not paraphrase down.
- **§2 Source column is evidence, not anchors.** Allowed: PRD/roadmap/archive lines, interview Q#, hot-spot directories with churn counts, tech-stack constraints. Forbidden: `file:line`, function names, schema names, module names. If a draft risk row has nothing in Source after stripping forbidden anchors, the row is unsourced — drop it or attach a real interview/PRD citation before writing.

The load-bearing section is **§3 Phased rollout** — the orchestrator reads this status table on every subsequent invocation. Status vocabulary (parser literals): `not started` → `change opened` → `researched` → `planned` → `implementing` → `complete`. The orchestrator overwrites Status and Change-folder cells as the rollout advances; the rest of the row is frozen until `--refresh`.

Preserve the brief's risk response guidance in the written plan:

- §2 risk rows stay concise and evidence-only.
- §2 must also include the `Risk Response Guidance` table from the schema for every top risk. It carries response intent, not anchors.
- §3 phase goals should say what protection the phase is trying to prove, not only which test type it will add.
- §4 Stack must include the current-session MCP/docs/search grounding note from Phase 1, including `checked:` dates and "not available in current session" where appropriate.
- §6 placeholders should name the future cookbook pattern by behavior/failure mode when possible, e.g. "TBD — see §3 Phase 1 for paid-content access denial/regression pattern," not just "unit tests TBD."

Do not add file anchors or test code to preserve this guidance. The plan should carry the response intent; `/10x-research` supplies the anchors, and `/10x-plan` turns the response into sub-phases.

After writing, proceed directly to Phase 5 (the user already approved the brief).

---

## Phase 5 — Read the guide, locate the current rollout phase

Read §3 and find the first row whose Status is not `complete` — that is the **current rollout phase**. If every row is `complete`, jump to "All phases complete". Extract: phase number (N), phase name, risks covered, test types, and change folder (if any) — these feed the direct argument blocks below.

## Phase 6 — Determine sub-state and present the next handoff

Derive sub-state from on-disk artifacts for the current §3 row: change folder, `research.md`, `plan.md`, and unchecked `## Progress` items in `plan.md`.

Before choosing a handoff, reconcile stale §3 status from disk if needed:

- `research.md` exists and §3 still says `change opened` → update to `researched`.
- `plan.md` exists and §3 still says `change opened` or `researched` → update to `planned`.
- `plan.md` exists with pending Progress and §3 is not `implementing` → update to `implementing` before handing to `/10x-implement`.
- `plan.md` Progress is fully `[x]` → update to `complete` and continue to Handoff E.

This lazy reconciliation supports the established research → plan → implement process: downstream skills do not need to bounce back here just to flip status labels.

Map the state to one of five handoffs. Each one prints the next invocation, copies it to clipboard, then STOPs. For states already inside the downstream process, the handoff payload reminds the active skill to suggest the next natural command after it finishes, rather than returning here for routing.

### Downstream continuation rule

After any major downstream phase completes, suggest the next natural command in the established `/10x-research` → `/10x-plan` → `/10x-implement` process unless there is a clear blocker, correction, or missing decision. The next command should include only the direct parameter the next skill needs now. Do not ask the user to re-run `/10x-test-plan` just to discover an already-known next step.

Return to `/10x-test-plan` when the test plan itself needs attention: backporting research corrections, reconciling a completed rollout phase, selecting the next rollout phase, `--status`, or `--refresh`.

### Handoff A — Change folder missing (Status `not started`)

Propose a change-id from the rollout phase name (kebab-case, prefixed `testing-`). E.g., "Critical-path coverage" → `testing-critical-path-coverage`. Confirm with the user, then update §3 (Status → `change opened`, Change folder → chosen id) **before** the handoff so resume works if the session dies.

Then run the **Handoff Ritual** with:

```
/10x-new <change-id>
```

…followed directly by this intent block as its argument:

```
Open a change folder for rollout Phase <N> of context/foundation/test-plan.md: "<phase name>".
Risks covered: <list from §2>. Test types planned: <list from §3>.
Risk response intent: <for each covered risk, one line from §2 Risk Response Guidance describing the behavior or failure mode this phase must prove protected>.
After creating the folder, follow the downstream continuation rule.
```

### Handoff B — `change.md` exists, no `research.md` (Status `change opened`)

Run the Handoff Ritual with:

```
/10x-research
```

…followed directly by a research query with this shape:

```
Ground rollout Phase <N> of context/foundation/test-plan.md.

Risks to verify: <Risk #X, #Y from §2>.
Risk response guidance to verify, not blindly accept:
- <Risk #X>: prove <observable behavior/failure mode>; challenge <obvious assumption>; avoid <anti-pattern>.
- <Risk #Y>: prove <observable behavior/failure mode>; challenge <obvious assumption>; avoid <anti-pattern>.
Hot-spot directories that raised these risks (likelihood evidence — NOT anchors): <dir 1, dir 2 from §1 scope>.
Stack: <from §4>.

The test plan carries evidence and response intent, not code anchors. For each risk, ground the real failure path in code, quote relevant lines, verify or correct the response guidance, locate existing tests, identify the cheapest useful test layer, and flag speculative risks or misleading hot-spot evidence.

Write findings to context/changes/<change-id>/research.md.
Then follow the downstream continuation rule.
```

If the user returns here after research, update guide §3 row Status to `researched` before continuing. Also run the **post-research backport check** (see below). This return is mainly for corrections; the happy path should continue by the downstream continuation rule.

### Post-research backport check

After `research.md` lands and before presenting Handoff C, read the new research file and look for two kinds of finding:

1. **Anchor corrections** — research discovered the failure surfaces in a directory/area different from what §2's Source column cited as hot-spot evidence (e.g., §2 cited `src/lib/schemas/` as hot-spot evidence for a response-drift risk, but research shows the response schema actually lives in `src/lib/openrouter.ts`). The hot-spot citation is misleading.
2. **Speculative-risk confirmations** — research flagged a risk as "describing the implementation, nothing to break" and proposed to drop/reframe.
3. **Response-guidance corrections** — research verified that the planned response would not catch the failure, picked a cheaper layer, or found the listed "must challenge" assumption was wrong.

If either is present, ask the user:

> Research surfaced corrections to the test plan §2:
> - [list each finding in one line]
>
> Backport into `context/foundation/test-plan.md` §2 now (Source column, risk wording, or Risk Response Guidance only — never adds file anchors), or defer to `--refresh`?

This is the ONLY in-place edit allowed to §1/§2 outside of `--refresh`. The edit changes the Source citation, risk wording, or response-guidance cells, never adds a file:line anchor (principle #3 still holds).

### Handoff C — `research.md` exists, no `plan.md` (Status `researched`)

Run the Handoff Ritual with:

```
/10x-plan
```

…followed directly by a planning prompt with this shape:

```
Plan rollout Phase <N> of context/foundation/test-plan.md. Read research.md
and change.md fully. Risks covered: <list>. Test types: <list>. Hot-spot scope:
<from §1>.

Risk response guidance from the test plan and research:
- <Risk #X>: prove <behavior/failure mode>; required context <grounded fact from research>; anti-pattern to avoid <specific anti-pattern>.
- <Risk #Y>: prove <behavior/failure mode>; required context <grounded fact from research>; anti-pattern to avoid <specific anti-pattern>.

Plan sub-phases by cost × signal and risk priority. Each test sub-phase must state behavior asserted, regression caught, research source, edge/error/boundary case, and anti-pattern avoided. Challenge happy paths, avoid implementation mirrors, keep grounding explicit, date any AI-native guidance, and make the final sub-phase update §6 with the cookbook patterns shipped.

Then follow the downstream continuation rule.
```

If the user returns here after `plan.md` is written, update §3 Status to `planned`. This return is not required on the happy path; `/10x-plan` should follow the downstream continuation rule.

### Handoff D — `plan.md` exists with pending Progress (Status `planned` or `implementing`)

Find the first unchecked row in `## Progress` and extract its sub-phase number, e.g. `N.M` from `- [ ] N.M <title>`.

Run the Handoff Ritual with:

```
/10x-implement <change-id> phase <N>
```

(No direct argument needed; `/10x-implement` reads the plan directly.)

Update guide §3 Status to `implementing` on first transition; leave it at `implementing` for subsequent sub-phases.

### Handoff E — `plan.md` Progress fully `[x]` (Status `complete`)

The rollout phase is done. Update §3 Status to `complete`. Then **loop back to Phase 5** — find the next pending rollout phase, present its Handoff A. Do not exit until either:

- All §3 rows are `complete` → print the completion summary (see "All phases complete" at the bottom of this skill).
- The user wants to stop here → after updating Status, print a short summary and STOP.

Use `AskUserQuestion` after marking complete:

> Rollout Phase <N> is complete. Proceed to Phase <N+1>, or stop here?
>
> - **Continue to Phase <N+1>** — I'll present the `/10x-new` handoff for the next phase.
> - **Stop here** — I'll print a status snapshot and exit. Re-run `/10x-test-plan` to resume.

---

## The Handoff Ritual

Every handoff (A–D) prints the next invocation, copies it to the clipboard when the host supports clipboard access, then stops. For Handoffs A–C, the next invocation is the slash command followed immediately by the intent/query/prompt as the command argument; do not assume the downstream `/10x-*` command will ask for parameters after launch. For Handoff D, the invocation is command-only because `/10x-implement` reads the plan directly. A later `/10x-test-plan` invocation re-derives state from disk and reconciles any stale §3 statuses.

### Step 1 — Print

```
─────────────────────────────────────────────────────────────────────
Next step: <human-readable description>

Copied invocation (✓ copied to clipboard):

<exact command> <intent/query/prompt block, if any>

Then /clear and paste the copied invocation. After that phase completes, continue with the next natural command suggested by the active skill unless it reports a blocker.
─────────────────────────────────────────────────────────────────────
```

### Step 2 — Copy to clipboard

Use the host clipboard tool if available. If not, leave the printed invocation as the source of truth.

### Step 3 — STOP

Do not wait for confirmation. The skill's job is done for this invocation.

---

## `--status` mode

Skip all phase logic; read the guide if present and print a compact rollout status. Example output:

```
Test rollout status — context/foundation/test-plan.md

| # | Phase                       | Status        | Change folder                                  | Next action                                  |
|---|-----------------------------|---------------|------------------------------------------------|-----------------------------------------------|
| 1 | Critical-path coverage      | complete      | context/changes/testing-critical-path-coverage/ | —                                             |
| 2 | Integration around hot-spots | implementing  | context/changes/testing-integration-hotspots/  | /10x-implement testing-integration-hotspots phase 3 |
| 3 | AI-native layer             | not started   | —                                              | /10x-new testing-ai-native-layer              |
| 4 | Quality-gates wiring        | not started   | —                                              | (waits for Phase 3 to land)                   |

Currently at: Phase 2, sub-phase 3 of 5.
```

If the guide is missing, print:

```
No test-plan.md found at context/foundation/. Run /10x-test-plan
without --status to start the rollout.
```

…and STOP.

## `--refresh` mode

Triggered when the user invokes `/10x-test-plan --refresh`, or when the guide is stale (e.g., a recommended tool's `checked:` date > 3 months old). Refresh **does not edit the guide in place** — it opens a new change folder `test-plan-refresh-<YYYY-MM-DD>`:

1. Run Phases 1+2 fresh — hot-spots and concerns are the only honest triggers for a refresh.
2. Synthesize a refresh-scoped brief: what is in the guide today, what is stale, what is missing.
3. Hand off to `/10x-new` with that brief (standard Handoff Ritual).
4. The chain runs normally; the plan's final sub-phase updates §3 status and §6 cookbook patterns, but never rewrites §1/§2 without explicit user direction.

---

## Interactive prompts — host-agnostic

Whenever this skill says *"ask the user"*, use whichever interactive-question tool the host exposes (e.g., `AskUserQuestion`, `ask_question`, `request_user_input`). Before the first interactive step, scan available tools for one with a `question` parameter and an `options`/`choices` field; use the first match. If none exists, fall back to a plain conversational message with labelled options.

## All phases complete

When the loop exits with every §3 row at `complete`:

```
Rollout complete — every phase in context/foundation/test-plan.md is now `complete`.

What landed:
- <N> rollout phases shipped
- <N> change folders archived (see context/archive/ for history)
- context/foundation/test-plan.md now reflects what is actually tested,
  how to add new tests by area, and the gates that are wired

Refresh cadence: re-run /10x-test-plan --refresh when a new top-3 risk
surfaces, a tool's `checked:` date is > 3 months old, the tech stack changes,
or §7 negative-space no longer matches what the team believes.
```

Then suggest a smoke test: open a fresh agent session and ask "Read the project rules and `context/foundation/test-plan.md`. What should I test first for a new `<area>` endpoint, and why?" The agent should name the cookbook pattern, location, and cheapest test type. If it picks a random file, the rules-file is not pointing at `context/foundation/` yet.

## What this skill does NOT do

- Does not write test code, configure hooks/MCPs/CI YAML, or edit AGENTS.md. Those land via downstream rollout phases.
- Does not invent risks — every risk traces back to PRD, roadmap, archive, hot-spots, or the Phase 2 interview.
- Does not auto-invoke downstream skills. Every handoff stops at the clipboard and waits, but each completed downstream phase should suggest the next natural command in the established research → plan → implement process unless there is a clear blocker.
- **Does not read the codebase for knowledge.** Hot-spot churn, test-base count, project marker, framework detection — yes. Call graphs, schema bodies, error-translation logic, "which file owns this failure" — no. That extraction is `/10x-research`'s job, run per rollout phase against the up-to-date code. If you ever feel tempted to cite `src/foo/bar.ts:42` in §2, you've crossed the line — stop and let research do it. (See "Load-bearing principles" §3.)

## Tone

Professional, instructional, terse. Imperative voice. No marketing language. No emojis (the single ✓ in clipboard confirmation is functional).

## Edge cases

- **No PRD, archive, or roadmap.** Asks user for canonical context sources; if none are provided, the guide leans heavily on the Phase 2 interview and hot-spot scan.
- **Polyglot stack.** Pick the dominant test surface by file count for hot-spot scoping; mention secondary stacks in §2 if they own a top risk.
- **No existing test infrastructure.** §4 says "none yet"; the first rollout phase bootstraps the runner + first integration test on Risk #1.
- **Brownfield with rich existing tests.** Research highlights what is NOT covered; §6 captures both what exists and what the rollout adds.
- **Non-English guide.** Write the body in the requested language; keep §3 status vocabulary in English so the parser still works.
- **Abandoned plan (Status `planned`/`implementing`, user wants to skip).** Ask explicitly; if confirmed, mark `complete` with a one-line skip note and advance. Never silently advance.
