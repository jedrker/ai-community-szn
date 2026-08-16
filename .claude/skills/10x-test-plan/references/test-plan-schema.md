# `context/foundation/test-plan.md` — Schema

This is the canonical structure for the test plan produced by `/10x-test-plan`. The file is **both a phased rollout strategy and a growing cookbook**:

- **Strategy** (sections §1–§5) is written up-front by the orchestrator in its Phase 4, before any handoff. It is mostly frozen after that — changes require `--refresh`.
- **Cookbook** (§6) starts as placeholders and **fills in incrementally** as rollout phases ship. Each plan's final sub-phase (per the `/10x-plan` constraint baked in by the orchestrator) updates the cookbook with patterns the rollout phase just delivered.

The orchestrator parses **§3 (Phased rollout)** on every invocation to determine state. The Status vocabulary and column order in §3 are load-bearing — do not rename columns or invent new status values without updating the orchestrator's parser.

Length budget: **strategy sections 300–600 words; cookbook section grows with the rollout**. The file may exceed 900 words once §6 is populated by shipped phases — that is expected.

Section order is fixed (§1 → §8). Content under each heading adapts to project specifics.

---

## File header

```markdown
# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: <YYYY-MM-DD>
```

The two-line tagline and the refresh pointer are fixed. The "Last updated" date is mandatory and updates on every Status transition in §3.

---

## §1 — Strategy

```markdown
## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "<the
   team is worried about X, and the failure would surface somewhere in
   <area>>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `<scope list from Phase 1>`.
```

Short by design. Tone is imperative — these are the rules every downstream phase obeys. Principle #3 is the load-bearing distinction between this plan (QA spec) and `/10x-research` (knowledge extraction).

---

## §2 — Risk map

```markdown
## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario)                  | Impact | Likelihood | Source (evidence — not anchor)                                          |
|---|------------------------------------------|--------|------------|--------------------------------------------------------------------------|
| 1 | <one-line failure scenario>               | High   | High       | <PRD §... | roadmap §... | archive/<slice>/plan.md | interview Q<n> | hot-spot dir `<path>` (N commits/30d)> |
| ... | ... | ... | ... | ... |
```

5–7 rows. Every row cites at least one source.

**Impact × Likelihood rubric.** Score both axes on a coarse High / Medium /
Low scale so two readers agree on the same row. Do not invent finer
gradations — the goal is ordering, not false precision.

| Rating | Impact | Likelihood |
|--------|--------|------------|
| High   | user loses access, data, or money; failure is publicly visible | area changes weekly, or we have already been burned here |
| Medium | feature degrades, a workaround exists, only some users affected | touched occasionally, has been a source of bugs |
| Low    | cosmetic, easily reverted, no data effect | stable code, rarely touched |

Order rows by impact × likelihood. Protect High × High first; High-impact ×
Low-likelihood scenarios (e.g. a cloud provider outage) usually belong to
observability/alerting, not a test — say so rather than padding the map.

**Abuse / security lens (conditional).** If the product has auth, payments,
or accepts any user input, the risk map must include at least one abuse
scenario — these rarely surface from the interview because the happy path
excludes the attacker. Consider: authorization/access (IDOR — does the
endpoint check ownership, not just authentication?), untrusted input
(injection, server-side validation parity), secret/PII leakage (logs, error
bodies, front-end bundle), resource abuse (rate-limit bypass, costly
operations in a loop). These are still failure scenarios scored on the same
two axes; they are not a separate framework.

**Allowed Source citations** (evidence — what made this risk rise to the
top N):

- PRD line / roadmap line / archived slice plan
- Phase 2 interview question number (`interview Q1`, `interview Q3`)
- Hot-spot **directories** with churn counts (`src/lib/ — 12 commits/30d`)
- Tech-stack constraint (`tech-stack.md: custom HTTP client, no SDK`)

**Forbidden Source citations** (anchors — where the failure lives in
code):

- Specific files or `file:line` references
- Function or symbol names
- Specific schemas, classes, or modules

These belong in `context/changes/<change-id>/research.md` — produced by
`/10x-research` during each rollout phase. If the plan tries to cite them
in §2, it is pretending to know something it did not verify.

Risk wording reads as a failure scenario, not as a test name. Risk numbers
(#1, #2, …) are referenced by §3 — keep them stable across refreshes
(append new risks at the bottom; never renumber).

Immediately after the risk map, include the response guidance table. This
is the durable handoff from risk analysis to `/10x-research` and
`/10x-plan`.

```markdown
### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1   | <observable behavior or failure mode a useful test must catch> | <obvious assumption not to accept silently> | <entry point / persisted state / external boundary / contract / ordering guarantee / fixture source> | <unit / integration / contract / e2e / hook / visual diff / AI-native review / manual smoke> | <implementation mirror / happy-path-only / copied production calculation / over-mocking / brittle ordering / meaningless snapshot> |
```

Every top risk gets one row. These rows still avoid file anchors and test
code. They state how the risk should be attacked, which assumption the
agent must challenge, and what context must be grounded before planning
tests. If a risk cannot produce a response row, the risk is not actionable
enough for this rollout and must be reframed or dropped.

---

## §3 — Phased rollout

**This section is the orchestrator's state.** The orchestrator reads and writes the Status and Change-folder cells on every invocation; the other cells are frozen after the initial write (unless `--refresh` opens a re-scope).

```markdown
## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name                | Goal (one line)                                  | Risks covered | Test types              | Status        | Change folder                                       |
|---|---------------------------|--------------------------------------------------|----------------|-------------------------|---------------|-----------------------------------------------------|
| 1 | Critical-path coverage    | Defend Risk #1+#2 at the cheapest layer          | #1, #2         | unit + integration      | not started   | —                                                   |
| 2 | Integration around hot-spots | Catch regressions in churn-heavy modules       | #3, #4         | integration             | not started   | —                                                   |
| 3 | AI-native layer           | Post-edit hook on validation + vision review on top screens | cross-cutting | post-edit-hook, vision review | not started | —                                       |
| 4 | Quality-gates wiring      | Lock the floor in CI                              | cross-cutting  | gates                   | not started   | —                                                   |
```

**Status vocabulary** (fixed — parser literals):

| Value          | Meaning                                                                          |
|----------------|----------------------------------------------------------------------------------|
| `not started`  | No change folder for this rollout phase yet.                                     |
| `change opened` | `context/changes/<id>/` exists with `change.md`; research not done.            |
| `researched`   | `research.md` exists in the change folder.                                       |
| `planned`      | `plan.md` exists with a `## Progress` section.                                   |
| `implementing` | Progress section has at least one `[x]` and at least one `[ ]`.                  |
| `complete`     | Progress section is fully `[x]`.                                                 |

3–5 rollout phases is the sweet spot. Fewer makes the rollout too coarse; more makes prioritization useless. AI-native and gates phases are not mandatory — include them only when the brief justified them under cost × signal.

---

## §4 — Stack

```markdown
## 4. Stack

The classic test base for this project. AI-native tools (if any) carry a
`checked:` date so future readers can see which lines need re-verification.
Recommendations in this section must be grounded in local manifests/configs
plus the MCP/tools actually exposed in the current session. If a useful docs
or search MCP such as Context7 or Exa.ai is not available, say that instead
of assuming access.

| Layer                | Tool                       | Version | Notes                                |
|----------------------|----------------------------|---------|--------------------------------------|
| unit + integration   | <Vitest / Jest / pytest>   | <x.y>   | <one-line note>                      |
| API mocking          | <MSW / httpx-mock / ...>   | <x.y>   | <one-line note>                      |
| e2e                  | <Playwright / Cypress>     | <x.y>   | <one-line note>                      |
| accessibility        | <axe-core>                 | <x.y>   | <one-line note>                      |
| (optional) AI-native | <Playwright MCP — checked: YYYY-MM-DD> | n/a | <when NOT to use>           |

If a row reads "none yet — see Phase <N>", that gap is addressed by the
named rollout phase.

Immediately after the table, include a compact grounding note:

**Stack grounding tools (current session):**
- Docs: <Context7 / framework docs MCP / none> — <what was checked or why skipped>; checked: <YYYY-MM-DD>
- Search: <Exa.ai / web search MCP / none> — <what was checked or why skipped>; checked: <YYYY-MM-DD>
- Runtime/browser: <Playwright MCP / browser tool / none> — <possible use, or "not used">; checked: <YYYY-MM-DD>
- Provider/platform: <GitHub/Cloudflare/Supabase/etc. / none> — <quality-gate relevance, or "not used">; checked: <YYYY-MM-DD>

Use docs MCPs for current framework/library APIs and setup details. Use
search MCPs for discovery or current status only, then prefer official docs
as the evidence. Do not use MCP docs/search to infer code failure anchors;
those belong in per-phase `/10x-research`.
```

---

## §5 — Quality gates

```markdown
## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required for §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate                          | Where             | Required?                   | Catches                                       |
|-------------------------------|-------------------|------------------------------|-----------------------------------------------|
| lint + typecheck              | local + CI        | required                     | syntactic / type drift                        |
| unit + integration            | local + CI        | required after §3 Phase 1    | logic regressions                             |
| e2e on critical flows         | CI on PR          | required after §3 Phase 1    | broken critical user paths                    |
| post-edit hook                | local (agent loop) | recommended after §3 Phase 3 | regressions at edit time                     |
| visual diff (deterministic)   | CI on PR          | optional                     | rendering regressions                         |
| multimodal visual review      | CI on PR          | optional                     | visual issues classic diff misses             |
| pre-prod smoke                | between merge + prod | optional                  | environment-specific failures                 |
```

Every row corresponds to a gate that either **is** wired or **will be wired by a named rollout phase**. Do not list gates with no rollout phase pointing at them — that is aspirational.

---

## §6 — Cookbook patterns

**This is the section that fills in over time.** The orchestrator writes placeholders during Phase 4; each rollout phase's plan updates the relevant sub-section in its final sub-phase (per the `/10x-plan` constraint).

```markdown
## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once
the relevant rollout phase ships; before that, the sub-section reads
"TBD — see §3 Phase <N>."

### 6.1 Adding a unit test

- **Location**: <package>/src/__tests__/ next to the unit under test.
- **Naming**: <module>.unit.test.<ext>.
- **Reference test**: <path-to-canonical-existing-test>.
- **Run locally**: <exact command>.

### 6.2 Adding an integration test

- **Location**: <package>/test/integration/.
- **Mocking policy**: only mock at the network edge (MSW for HTTP, in-memory
  adapter for KV/R2). Never mock internal modules.
- **Reference test**: <path>.
- **Run locally**: <exact command>.

### 6.3 Adding an e2e test

- TBD — see §3 Phase 2.

### 6.4 Adding a test for a new API endpoint

- **Test type**: integration (preferred).
- **Pattern**: spin up the Worker via `unstable_dev`; assert request →
  response shape AND side-effects. Mock the external HTTP edge only.
- **Reference test**: `packages/api/test/routes/lessons.test.ts`.
- **When to add e2e instead**: only if the endpoint's failure mode requires
  the full deployed shape (auth + cookie + handler crossing).

### 6.5 Adding a test for a new content-build rule

- TBD — see §3 Phase 1.

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, /10x-implement appends a 2-3 line note
here capturing anything surprising the rollout phase taught — e.g., "Phase
2 found we needed a fixture catalog under `packages/course-content/test/fixtures/`;
new content tests should reuse it.")
```

Three to six entries (6.1–6.6) is the sweet spot. More than six and the cookbook starts to duplicate the test suite itself. If a recipe is rare, link to the existing test rather than writing a new entry.

---

## §7 — Negative space

```markdown
## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout (Phase 2 interview, Q5). Future
contributors should respect these unless the underlying assumption changes.

- **<Area>** — <reason>. Re-evaluate if <triggering change>. (Source:
  Phase 2 interview Q5.)
- ...
```

This section is the negative space — answers to Q5 ("what would you NOT want test budget spent on"). Short on purpose; if it grows past 5–6 bullets, the rollout was over-scoped.

---

## §8 — Freshness ledger

```markdown
## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: <YYYY-MM-DD>
- Stack versions last verified: <YYYY-MM-DD>
- AI-native tool references last verified: <YYYY-MM-DD>

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
```

The freshness ledger is the difference between a guide that ages gracefully and one that quietly rots.

---

## Forbidden content

- **No test code blocks.** Reference the existing test file by path instead.
- **No CI YAML, hook scripts, or MCP install commands.** Those live in source-of-truth configs; the guide names what should exist and why.
- **No motivational phrasing** ("write better tests", "be a 10x engineer").
- **No emojis.**
- **No section ordering different from §1 → §8.**
- **No new Status values in §3.** The orchestrator's parser depends on the fixed vocabulary.

If any of the above appears in a draft, revise before writing.

---

## How `/10x-test-plan` maintains this file

- **Phase 4 (initial write)**: orchestrator writes §1–§5 fully, §6 with placeholders ("TBD — see §3 Phase N"), §7 from interview Q5, §8 with today's date in all three lines.
- **Per handoff transition** (Phase 6, Handoffs A–E): orchestrator updates only §3 Status and Change-folder cells, and bumps the "Last updated" header line.
- **After each rollout phase completes** (via `/10x-implement`'s final sub-phase, baked into the plan by the orchestrator's planning prompt): the relevant §6 sub-section is filled in; §8 dates may bump if tools were verified.
- **`--refresh`**: opens a new change folder; the strategy sections (§1–§5) may be rewritten through that change, but never edited in place outside of it.
