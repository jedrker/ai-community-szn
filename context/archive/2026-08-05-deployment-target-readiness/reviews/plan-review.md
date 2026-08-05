<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Deployment Target Readiness (Hobby-plan variant)

- **Plan**: `context/changes/deployment-target-readiness/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-06
- **Verdict**: REVISE → **SOUND** after triage (all 7 findings fixed)
- **Findings**: 1 critical, 4 warnings, 2 observations

> Caveat on independence: this review was run on a plan authored in the same session by the same
> agent. F1 is precisely the class of error an independent reviewer catches more reliably — treat the
> dimension verdicts as weaker evidence than an outside review would provide.

## Verdicts

| Dimension | Verdict (at review) | After triage |
|-----------|--------------------|--------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | FAIL | PASS |

## Grounding

5/5 paths ✓ (`package.json`, `CLAUDE.md`, `vercel.json`, `context/foundation/infrastructure.md`,
`context/foundation/roadmap.md`), 6/6 symbols ✓ (`@astrojs/vercel` at `package.json:19`, `framework` at
`vercel.json:2`, `prerequisite` at `infrastructure.md:37` and `:218`, `### F-01` at `roadmap.md:114`,
`Deploy / infra` at `roadmap.md:103`, `### F-04` at `roadmap.md:203`), brief↔plan ✓,
**1 structural claim ✗** — CLAUDE.md layout (F1).

Note: `docs/` exists but contains only `superpowers/`, so `docs/runbook-live-session.md` is the first
top-level doc there. Valid path, no convention to follow.

Deep-mode codebase verification was performed inline rather than by sub-agent: the blast radius is
three config files with zero callers, and this session's standing instruction is not to spawn agents
unrequested.

Opt-in convention files absent (checks skipped): `context/foundation/lessons.md`,
`docs/reference/contract-surfaces.md`.

## Findings

### F1 — CLAUDE.md edit location is wrong and self-contradictory

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 → Changes Required #2 "Version-boundary rule"
- **Detail**: The Contract said to add the rule "to the Project guide section (after the generated
  `10x-cli` END marker — the `## Deployment` subsection is the right home)". In this file those are two
  different places: the Project guide is CLAUDE.md:9–133 and the generated block is :134–177, so "after
  the END marker" lands at line 178+, outside the Project guide, while `## Deployment` is at :120 —
  before the block. The two halves contradict each other. Compounding it, the sibling version-pin rules
  the plan wants it beside (TypeScript `^6`, vite dedup) are in `## Commands` at :34–37, not
  `## Deployment`, making Progress item 1.5 unsatisfiable as written. Root cause: the plan inherited the
  claim from CLAUDE.md:6–7, which is stale — in this file the generated zone comes last.
- **Fix**: Point the Contract at CLAUDE.md:34–37 (the `## Commands` version-constraint cluster), drop
  the END-marker reference, align criterion 1.5.
- **Decision**: FIXED

### F2 — Region probe can't distinguish "Hobby ignored it" from "adapter overrode it"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 2 → Changes Required #2 "Probe record"
- **Detail**: The probe recorded one of honoured/ignored/rejected, and both F-04's latency
  interpretation and the Pro-upgrade tripwire consume that conclusion. But `@astrojs/vercel` emits its
  own Build Output API function config; if the adapter writes per-function config without a region, a
  top-level `vercel.json` `regions` key can be ignored for reasons unrelated to the plan tier. An
  "ignored" result read as a Hobby restriction could send someone to buy Pro to fix something Pro won't
  fix.
- **Fix A ⭐ Recommended**: Inspect the build artifact before deploying
  - Strength: `bun run build` then read `.vercel/output/functions/**/.vc-config.json` for a region
    field — separates cause from effect locally, one command, no deployment needed.
  - Tradeoff: Adds a step; artifact layout is adapter-version specific.
  - Confidence: MEDIUM — Build Output API supports per-function regions; not confirmed what v10.0.8
    emits.
  - Blind spot: Whether the platform overrides the artifact value on Hobby regardless.
- **Fix B**: Keep the probe as-is, require "cause: undetermined"
  - Strength: Zero added work; honest labelling stops a false conclusion reaching the tripwire.
  - Tradeoff: Leaves the tripwire input ambiguous; question resurfaces at F-04 time when it costs more.
  - Confidence: HIGH — documentation constraint only.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A (with a fallback instruction to record what was actually found if the
  artifact layout differs)

### F3 — Adapter bump can trip the documented vite-dedup failure; plan carried no remedy

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 → Changes Required #1
- **Detail**: CLAUDE.md:37–39 records that a second `vite` copy nested under `node_modules/astro/` makes
  `astro check` fail with a `PluginOption` type mismatch on `@tailwindcss/vite`, remedied by
  `rm -rf node_modules && bun install`. Phase 1's `bun update @astrojs/vercel` rewrites the lockfile —
  exactly the operation that can produce this. Criterion 1.2 catches it, but with no remedy in the plan
  a known, already-solved failure presents as a blocker.
- **Fix**: Add the remedy to Phase 1's Contract and to Critical Implementation Details, citing
  CLAUDE.md:37–39.
- **Decision**: FIXED

### F4 — Three "Automated Verification" items required human judgment

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Progress 2.4, 3.1, 3.4 (pre-fix numbering)
- **Detail**: "names one of the three outcomes", "covers before / during / after", and "grep shows the
  qualified wording" are not decidable by a command. Listed as Automated, they get ticked on a judgment
  call — the failure mode the automated/manual split exists to prevent.
- **Fix**: Split each; keep the file-exists / exit-code half Automated, move content judgment to Manual.
- **Decision**: FIXED — additionally, the `infrastructure.md` amendment now writes a greppable sentinel
  ("deferred by user decision") so criterion 3.4 became genuinely automatable. Renumbering: Phase 2 now
  2.1–2.9, Phase 3 now 3.1–3.11; 25 criteria bullets ↔ 25 Progress items verified.

### F5 — End State claimed the rollback path was "run once"; no phase ran it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Desired End State vs. Phase 3 #4
- **Detail**: End State claimed logs and "the rollback path have each been run once and their real
  behaviour recorded", but Phase 3 stops at `vercel rollback status` and a real rollback is explicitly
  out of scope. F-04 and the runbook would have inherited a path described as verified that never was.
- **Fix**: Reword to "preconditions verified (prior immutable deployments exist; the command
  responds)"; require the runbook to state that rollback itself is untested here.
- **Decision**: FIXED

### F6 — Tripwire had no owner, no monitor, and no review cadence

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Open Risks & Assumptions; Phase 3 #2(d)
- **Detail**: The whole Hobby decision rests on a two-part tripwire. The F-04 half has a natural
  trigger; the "Vercel makes contact about fair use" half depends on someone reading the account email,
  with no owner and no cadence — which is the pre-mortem's exact failure mode.
- **Fix**: Name an owner (repository owner / account holder) and attach the re-read to the runbook's
  pre-session checklist, the only ritual guaranteed to recur before an event.
- **Decision**: FIXED

### F7 — Phase 3 coupled CLI verification with three independent doc edits

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 3
- **Detail**: An unauthenticated `vercel` CLI — a risk the plan itself lists — would stall the runbook
  and both foundation-doc amendments, none of which depend on the CLI.
- **Fix**: Make the one-directional dependency explicit so an auth stall doesn't block the doc work.
- **Decision**: FIXED — note that the Changes Required order was already docs-first (#1–#3 docs, #4
  verification); the real coupling was implicit, so the fix is an explicit note in Critical
  Implementation Details naming exactly what needs the CLI (the runbook's retention figure and the
  log-stream observation) and instructing the implementer to complete the amendments regardless.
