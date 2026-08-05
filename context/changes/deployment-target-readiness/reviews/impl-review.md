<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Deployment Target Readiness (Hobby-plan variant)

- **Plan**: `context/changes/deployment-target-readiness/plan.md`
- **Scope**: Full plan — Phases 1–3 of 3
- **Date**: 2026-08-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

> Method note: Step 2 normally fans out to two sub-agents. This diff is three config files plus
> documentation with no code paths, no callers, and no new modules, so drift and safety were verified
> inline instead. Also note this is a self-review of work done in the same session — weaker than an
> independent one; F1 and F3 are both record-keeping slips that an outside reviewer would likely have
> caught sooner.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Evidence

**Automated re-verification — 12/12 pass**

| Check | Result |
| --- | --- |
| `@astrojs/vercel` range | `^10.0.8` (on the `^10` line) |
| `vercel.json` | valid JSON: `{"framework":"astro","regions":["fra1"]}` |
| `docs/runbook-live-session.md` | exists |
| `deferred by user decision` sentinel | 1 hit (`infrastructure.md:40`) |
| `bun run type-check` | 0 errors |
| `bun run test` | 75 tests / 5 files pass |
| `bun run build` | Complete |

**Scope** — this change's four commits (`66f4812`, `fb7de2d`, `536fde4`, `e97d8f3`) touched only planned
files plus change-folder artifacts. `astro.config.ts`, `src/quiz/**` and the
`quiz-definition-and-validation` folder appear in the date-range diff but belong to a parallel change.

**Secret scan** — no `prj_*` / `team_*` IDs, API keys, or SSO nonces in committed files.
`.vercel/project.json` is gitignored.

**Cross-change provenance** — commit `9c9bd47`, labelled for `quiz-definition-and-validation`, contains
this change's `docs/runbook-live-session.md` and roadmap F-01/F-04 edits; that session staged beyond its
own change. History was deliberately left alone.

## Findings

### F1 — Progress rows carry annotations after the SHA, breaking the format contract

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md` Progress rows 3.1, 3.6, 3.8, 3.10, 3.11
- **Detail**: `.claude/skills/10x-plan/references/progress-format.md` mandates
  `- [x] <phase>.<index> <title> — <sha>`, states that when a step's intent changes you "leave the title
  and add a brief inline note in the relevant Phase block above — do not rewrite the Progress entry", and
  bans descriptive prose in the section. Five rows end with `*(...)*` after the SHA, e.g.
  `— 536fde4 *(runbook itself landed in 9c9bd47)*`. Tooling extracting the SHA with an end-of-line anchor
  mis-parses those five rows. The information is worth keeping — its location is wrong.
- **Fix**: Move the five annotations into the Phase 3 block as inline notes; restore rows to bare
  `- [x] N.M <title> — 536fde4`.
  - Strength: Restores the mechanical contract every other 10x skill parses, without losing the notes.
  - Tradeoff: None material — same information, correct home.
  - Confidence: HIGH — contract read directly from the reference file.
  - Blind spot: None significant.
- **Decision**: FIXED — annotations moved into the Phase 3 block; rows restored to `- [x] N.M <title> — 536fde4`

### F2 — Runbook tells the host functions run in fra1; production runs in iad1

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `docs/runbook-live-session.md:78`
- **Detail**: The tripwire step reads "Functions run in `fra1` (Frankfurt) — see `region-probe.md` — so
  this is unlikely" with no qualification. Measured during this review: production returns
  `x-vercel-id: arn1::iad1::…`, and 9 commits are unpushed. Every other statement of this fact was
  qualified ("production only moves once the key reaches `main`"); this one is not — and it sits in the
  step whose purpose is to catch a latency problem, read by a host under time pressure. Effect: the host
  under-weights the latency question on precisely the deployment where it is still transatlantic.
- **Fix A ⭐ Recommended**: Qualify the claim at the source
  - Strength: One-line edit to the operational doc that is wrong today; keeps the runbook
    self-contained, which criterion 3.9 required.
  - Tradeoff: Goes stale the other way after the merge — it will read more cautiously than reality.
  - Confidence: HIGH — production region measured directly.
  - Blind spot: None significant.
- **Fix B**: Add a "verify the region" command to the checklist
  - Strength: Self-correcting — `curl -sI <url> | grep x-vercel-id` reports the truth on the day
    regardless of what has been merged.
  - Tradeoff: Adds a step to a deliberately short checklist and asks the host to read a header mid-prep.
  - Confidence: HIGH — the header is a proven region signal on this project.
  - Blind spot: Whether a host under time pressure runs it at all.
- **Decision**: FIXED via Fix A — runbook:78 now states production runs `iad1` until the key reaches `main`, with a `x-vercel-id` check to confirm on the day

### F3 — plan.md and plan-brief.md never reconciled with the fra1 discovery

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `plan.md:23`, `:449-450`, `:486` (8 occurrences); `plan-brief.md:92-93`
- **Detail**: The foundation docs were corrected but this change's own artifacts were not. `plan.md`
  still asserts "functions pinned to `iad1`", "functions stay in `iad1`, so every host action … spends a
  transatlantic round trip", and "Accepted: functions run in `iad1`"; §What We're NOT Doing still lists
  "Not `fra1` actually taking effect". `plan-brief.md:92-93` still carries the `iad1` latency risk and
  says F-04 measures from `iad1`. The brief is the first artifact a newcomer reads, making it the most
  misleading file in the folder.
- **Fix**: Add a dated outcome note to both (plan §Open Risks and brief §Open Risks) recording that the
  premise inverted, rather than rewriting the historical narrative.
  - Strength: Keeps the plan honest as a record of what was believed *and* what was found.
  - Tradeoff: Leaves the stale sentences visible in body prose.
  - Confidence: HIGH — occurrences enumerated by grep.
  - Blind spot: None significant.
- **Decision**: FIXED — dated outcome notes added to plan.md §Open Risks and plan-brief.md §Open Risks; historical prose left intact

### F4 — Criterion 3.8 ticked though its literal text was never satisfied

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `plan.md` Progress 3.8 (and 3.11)
- **Detail**: 3.8 required `vercel logs --follow` to produce live output. `--follow` is deprecated and
  ignored in CLI 48.10.3, and ~100 confirmed function invocations produced no stream output. Ticked on
  explicit user decision ("the finding is the verification"). 3.11's premise inverted the same way
  (`fra1`, not `iad1`). Recorded so a later reader does not mistake the tick for a demonstrated log line.
- **Fix**: No action beyond F1 relocating the annotations. Noted for the archive record.
- **Decision**: RECORDED — no action; captured in the Phase 3 outcome notes via F1

### F5 — infrastructure.md edits exceeded the planned (a)–(d) contract

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `context/foundation/infrastructure.md` §Operational Story, §Logs
- **Detail**: Phase 3 #2 specified four edits (a)–(d). The implementation also corrected the `--follow`
  command reference and the "preview URLs are publicly reachable" claim. Benign and arguably required —
  leaving known-false statements would defeat the amendment's purpose — but it is unplanned scope in a
  foundation doc a parallel session also writes to.
- **Fix**: None. Noted.
- **Decision**: ACCEPTED — extra scope justified; leaving known-false statements would have defeated the amendment
