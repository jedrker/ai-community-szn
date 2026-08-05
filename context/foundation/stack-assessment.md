---
project: bizarre-bar
assessed_at: 2026-08-05T20:07:37Z
agent_readiness: ready-with-compensation
context_type: brownfield
stack_components:
  language: TypeScript (strict)
  framework: Astro 6.1 (output "server")
  build_tool: Vite (via Astro) + @tailwindcss/vite
  test_runner: null
  package_manager: bun
  ci_provider: null
  deployment_target: Vercel (serverless, @astrojs/vercel)
gates_passed: 7
gates_failed: 2
---

# Stack Assessment — LiveQuiz change on the Brave AI Community Szczecin site

Assessed against `context/foundation/prd.md` (brownfield, LiveQuiz). The PRD's `## Scope of Change`
adds live multi-participant session state with a one-second propagation guardrail and a
150-concurrent-participant integrity guardrail. That target shapes which gaps below matter most.

## Stack Components

**Language — TypeScript, strict.** `tsconfig.json` extends `astro/tsconfigs/strict` and includes
`**/*`, so strict checking applies across the project. Source is 14 `.astro` components and 6 `.ts`
modules. Content schemas are declared with Zod in `src/content.config.ts`, giving typed, validated
shapes at the content boundary rather than untyped frontmatter reads.

**Framework — Astro 6.1, hybrid rendering.** `astro.config.ts` sets `output: "server"` with the
`@astrojs/vercel` adapter, and the four content routes opt back into build-time generation with
`export const prerender = true`. Per-route audit:

| Route | Mode |
| --- | --- |
| `/wydarzenia`, `/wydarzenia/[...slug]` | prerendered |
| `/prelegenci`, `/prelegenci/[...slug]` | prerendered |
| `/` | on demand |
| `/zglos-sie` | on demand |
| `/api/newsletter-signup`, `/api/speaker-signup` | on demand |

So the site is neither wholly static nor wholly server-rendered: content pages are built once, while
the homepage (which resolves the next upcoming event per request), the application form, and both
endpoints run per request. Routing is file-based under `src/pages/`, with `src/pages/api/` holding the
two form endpoints. Layouts live in `src/layouts/`, components in `src/components/`, shared modules in
`src/lib/`.

**Build tool — Vite, via Astro.** Tailwind CSS 4 is wired through `@tailwindcss/vite` in the Astro
config's `vite.plugins`. Note the inconsistency recorded under Gaps: `package.json` also declares
`@astrojs/tailwind@^6.0.2`, the older integration, which the config does not use.

**Test runner — none.** No `vitest.config.*`, `jest.config.*`, or `playwright.config.*`, no test
script in `package.json`, and no `*.test.*` or `*.spec.*` files anywhere under `src/`.

**Package manager — bun.** `bun.lock` is the only lockfile. `package.json` declares
`engines.node >= 22.12.0` and `.nvmrc` pins `22.12.0`.

**Deployment — Vercel.** `vercel.json` declares `{"framework": "astro"}`; deploys happen on push to
`main`. No CI configuration exists in the repository (`.github/` absent, no other provider config).

**Integrations.** Resend for transactional email (`src/lib/resend.ts`), a Slack incoming webhook for
notifications (`src/lib/slack.ts`), and outbound links to Luma for event RSVPs.

## Quality Gate Assessment

| Component   | Typed | Convention | Training Data | Documented | Verdict |
|-------------|-------|------------|---------------|------------|---------|
| Language    | ✓     | —          | —             | —          | pass    |
| Framework   | —     | ✓          | ~             | ✓          | pass    |
| Build tool  | —     | ✓          | ✓             | ✓          | pass    |
| Test runner | —     | —          | ✗             | ✗          | fail    |

Legend: ✓ = pass, ✗ = fail, ~ = partial, — = not applicable

Passed: 7 of 9 applicable gate evaluations.

### Gate Details

**Type safety — pass.** Evidence: `tsconfig.json` line 2, `"extends": "astro/tsconfigs/strict"`,
which enables `strict` plus Astro's stricter defaults; `include: ["**/*"]` leaves no source outside
the check. Reinforced by `src/content.config.ts`, where every content collection declares a Zod
schema (`z.object({ title: z.string(), date: z.coerce.date(), lumaUrl: z.string().url(), … })`), so
content shapes are validated rather than assumed. An agent can reason about event and speaker shapes
from source alone. There is no type-check script in `package.json`, so nothing enforces this outside
an editor or `astro build` — noted under Gaps.

**Convention adherence — pass.** Evidence: the on-disk layout matches Astro's documented conventions
exactly — file-based routes in `src/pages/` (including `src/pages/api/` for endpoints), `src/layouts/`
for the single `BaseLayout.astro`, `src/components/` for the seven components, `src/content/` plus
`src/content.config.ts` for collections. A reader can predict where a new route or component belongs
without reading existing files.

**Training-data familiarity — partial.** Astro is a mainstream choice within the JavaScript
ecosystem, so the agent has internalized its idioms. The partial score is version skew, and it is
specific: (a) Astro 6 is recent, while much training data describes Astro 4 and 5, where
`output: "static"` with per-route `export const prerender = false` was the common idiom, the inverse of
this project's arrangement — an agent may try to "fix" the working `output: "server"` config, or
normalize the deliberate prerender/on-demand split into one uniform mode; (b) Tailwind 4
moved from the `@astrojs/tailwind` integration to the `@tailwindcss/vite` plugin, and the stale
`@astrojs/tailwind` dependency in `package.json` actively invites an agent to reintroduce the
superseded wiring. This is the gap most likely to produce plausible-looking wrong edits.

**Documentation quality — pass.** Astro publishes current, versioned, URL-addressable documentation
covering routing, adapters, content collections, and server output.

**Test runner — fail on both applicable gates.** Evidence: absence — no runner config file, no test
script in `package.json`, zero test files under `src/`. There is nothing for the agent to pattern-match
against and no way for it to verify its own work. This is the assessment's most consequential finding
and is treated as such under Gaps.

## Gaps & Compensation

### 1. No test runner and no tests — highest priority

**Why it matters here.** The PRD's guardrails commit to state propagating to every participant within
one second and to a 150-participant session losing no submitted answer and showing no divergence in
standings. Those are precisely the properties that cannot be confirmed by looking at a page. The PRD
also records that the blast radius of failure is a live event in front of a room, with no monitoring
to catch it. An agent working on scoring rules — all-or-nothing multi-answer credit, relative-error
numeric scoring, speed weighting, diacritic-insensitive text matching — has no way to check whether a
change broke a rule it wasn't looking at. Those five scoring rules are pure functions of their inputs
and are the cheapest possible thing to test.

**Compensation.** Introducing a runner is the fix; instruction-file text is the fallback while it
doesn't exist. Both are given below.

### 2. Type checking is configured but never enforced

**Why it matters.** `package.json` has `dev`, `build`, `preview`, and `astro` scripts and no
`type-check`. Strict mode therefore protects only whoever has an editor open. An agent that cannot run
a check will not discover it broke a type.

### 3. No linter and no formatter

**Why it matters.** Nothing encodes or enforces style, so an agent infers conventions from surrounding
files and drifts over time. Combined with the absent test suite, there is no automated signal at all
on a change.

### 4. Stale, superseded Tailwind dependency

**Why it matters.** `@astrojs/tailwind@^6.0.2` sits in `dependencies` while `astro.config.ts` uses
`@tailwindcss/vite`. An agent reading `package.json` may reasonably conclude the integration is the
intended wiring and "restore" it, breaking styling. This is the concrete form the version-skew risk
takes in this repository.

### 5. CLAUDE.md carries no project conventions

**Why it matters.** The file exists, so an agent will read it — and finds documentation of the
`/10x-*` workflow skills, nothing about this codebase. The compensation surface is present but empty.

### 6. No working persistence, and an existing defect that proves it

**Why it matters.** `src/lib/subscribers.ts` reads and writes `data/subscribers.json` via
`node:fs/promises` at `process.cwd()`. On Vercel's serverless runtime that path is not durable between
invocations, so newsletter subscribers written there are effectively lost. This is a pre-existing
defect that the LiveQuiz change did not cause — but it establishes that the project has no persistence
mechanism that works in production, which is exactly what live session state requires. Recorded as
PRD Open Question 7.

### 7. No monitoring or alerting

**Why it matters.** The PRD names the live event as the blast radius. Nothing today would tell anyone
the capability had failed. Deferred to `/10x-health-check`, but named here because the PRD's own risk
statement depends on it.

### Recommended Instruction File Additions

Ready to paste into `CLAUDE.md`. These describe the project, not the toolkit, and belong in a section
separate from the existing workflow documentation.

```markdown
## Project conventions — Brave AI Community Szczecin site

### Stack facts an agent must not "fix"
- Astro 6 with `output: "server"` and the `@astrojs/vercel` adapter, plus per-route prerendering.
  `/wydarzenia*` and `/prelegenci*` set `export const prerender = true` and are built once; `/`,
  `/zglos-sie`, and `/api/*` render on demand. Both halves are deliberate. Do NOT change `output` to
  `"static"`, and do NOT add or remove a `prerender` export to make the routes consistent. New pages
  that need request-time data omit `prerender`; pages rendered purely from content collections set it
  to `true`.
- Tailwind CSS 4 is wired via `@tailwindcss/vite` in `astro.config.ts`. Do NOT use or reintroduce
  `@astrojs/tailwind` — it is a stale dependency and its integration is superseded in Tailwind 4.
- Package manager is bun (`bun.lock`). Use `bun install` / `bun run <script>`, never npm or yarn.
- Node floor is 22.12.0 (`.nvmrc`, `engines.node`).

### Layout
- Routes: `src/pages/` (file-based). API endpoints: `src/pages/api/`, one exported handler per file.
- Layouts: `src/layouts/`. Components: `src/components/`, PascalCase `.astro` files.
- Shared modules: `src/lib/`, camelCase named exports, no default exports.
- Content: Markdown in `src/content/<collection>/`, schema in `src/content.config.ts`.

### Types
- TypeScript strict is on via `astro/tsconfigs/strict`. Annotate function boundaries explicitly;
  never add `any` or `@ts-expect-error` to silence an error — fix the shape.
- Validate all external input with Zod at the boundary it enters: content frontmatter in
  `src/content.config.ts`, request bodies in `src/pages/api/*`. Do not trust unparsed JSON.
- Run `bun run type-check` before declaring work complete.

### Testing
- Run `bun run test` before declaring work complete. If a change has no test, say so explicitly
  rather than implying it was verified.
- Pure domain rules — answer scoring, text-answer matching, numeric closeness, speed weighting,
  leaderboard ordering — must have unit tests. These are pure functions of their inputs; there is no
  excuse for testing them by hand.
- Never confirm a timing or concurrency guardrail by reading code. State that it needs a live check.

### Persistence
- `src/lib/subscribers.ts` writes to the serverless filesystem and does NOT persist between
  invocations. Treat it as a known defect. Do not copy this pattern for new state, and do not use
  `node:fs` writes for anything that must outlive a request.

### Error handling
- Follow `src/lib/slack.ts`: catch, log with context, degrade gracefully, never throw into a request
  path. Missing configuration warns and no-ops rather than failing the request.
- Secrets come from `import.meta.env`, are declared in `.env.example`, and are never inlined.

### Language
- All user-facing copy is Polish. Code, comments, and commits are English.
```

Two `package.json` scripts the instruction file above assumes, neither of which exists yet:

```json
"type-check": "astro check",
"test": "vitest run"
```

`astro check` needs `@astrojs/check` and `typescript` as dev dependencies. `vitest` needs adding, and
the test script is a promise the instruction file makes — add the runner before the rule, or the agent
will run a script that does not exist.

## Summary

**Overall: ready with compensation.** Seven of nine applicable evaluations pass, and the two failures
are both about the test runner rather than about the stack itself.

**Strengths.** TypeScript in strict mode across the whole project, Zod-validated content schemas, and
a framework whose conventions the code actually follows — an agent navigating this repository can
predict where things live and reason about shapes without running anything. Astro is well documented
and mainstream within its ecosystem. The stack is a good foundation; nothing here suggests changing it.

**Gaps, in the order they will bite.** No test runner, on a change whose two hardest commitments are a
one-second propagation bound and answer integrity at 150 concurrent participants — with no monitoring
to catch a failure and a live audience as the blast radius. No enforced type check, so strict mode
protects only an open editor. No linter or formatter. A stale `@astrojs/tailwind` dependency that
invites an agent to break styling. A `CLAUDE.md` that an agent will read and learn nothing about this
codebase from. And no persistence that works in production — evidenced by an existing newsletter
handler that writes to a filesystem Vercel discards.

**Correction recorded during this assessment, and then corrected again.** Both `.ai/prd.md` and the
shape notes described this site as statically generated. This assessment first replaced that with the
opposite overstatement — that the site renders per request and "there is no static build to protect".
Auditing every route's `prerender` export showed the truth is hybrid: `output: "server"` with the four
content routes prerendered at build time. The original SSG description was therefore *incomplete*
rather than false.

The load-bearing conclusion survives the correction: an on-demand serverless surface already exists,
so LiveQuiz needs no serving-model change, and the real gap is persistence rather than the absence of
a server. PRD Open Question 1 is resolved on that basis and PRD Open Question 7 carries the residual
question — where durable session state lives.

**Recommended next step.** `/10x-health-check`, to audit dependency health, the absent test suite, and
CI/CD coverage. The `subscribers.json` persistence defect and the missing monitoring are both squarely
in its scope.
