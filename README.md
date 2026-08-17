# Brave AI Community Szczecin

Community website for a Polish AI meetup group in Szczecin — event archive, speaker directory,
newsletter signup and speaker applications — plus **LiveQuiz**, a quiz the host runs from a laptop
while the room answers on their phones. Sponsored by [Brave Courses](https://www.brave.courses/).

All user-facing copy is Polish. Code, comments, commits and documentation are English.

## Quick start

The package manager is **bun** (`bun.lock` is the only lockfile). Do not use npm or yarn here.

```bash
bun install
cp .env.example .env   # then fill in the values you need — see below
bun run dev            # http://localhost:4321
```

The public site runs with no environment variables at all. The signup forms and LiveQuiz need
credentials; without them those routes answer with a service error rather than crashing the app.

| Command | What it does |
| --- | --- |
| `bun run dev` | Astro dev server |
| `bun run build` | Production build — also runs the quiz registry gate |
| `bun run preview` | Serve the production build locally |
| `bun run test` | Vitest, once (`--dir src`) |
| `bun run test:watch` | Vitest, watch mode |
| `bun run e2e` | Playwright, against `e2e/` |
| `bun run type-check` | `astro check` — must report 0 errors |
| `bun run lint` / `lint:fix` | ESLint |
| `bun run format` / `format:check` | Prettier |

`--dir src` is load-bearing: every Vitest test lives under `src/`, every Playwright spec under
`e2e/`, and without the flag Vitest collects the specs and Playwright throws. Operational scripts
(`quiz:reset`, `quiz:rehearse`, `quiz:check-purge`, `quiz:probe-config`) run against a **real
deployment**, not a local server — see `docs/runbook-live-session.md`.

Node floor is 22.12.0 (`.nvmrc`, `engines.node`).

## Environment

Copy `.env.example` — it carries the reasoning for each entry, including which name pair Upstash
actually injects.

| Variable | Needed for |
| --- | --- |
| `RESEND_API_KEY`, `RESEND_AUDIENCE_ID`, `ADMIN_EMAIL` | Newsletter signup and speaker applications |
| `SLACK_WEBHOOK_URL` | Slack notification on a new speaker application |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis — the authoritative LiveQuiz session state |
| `ABLY_API_KEY` | Ably — the realtime fan-out. Server-side only; browsers fetch a short-lived, subscribe-only token from `/api/quiz/token` |
| `LIVEQUIZ_HOST_SECRET` | Guards every host action endpoint |
| `LIVEQUIZ_HARNESS` | Enables the dev-only spine harness at `/quiz/spine-check`. Local and Preview only — Production must 404 |
| `LIVEQUIZ_BASE_URL` | Target for the operational scripts. Local only; never set it in Vercel |

## Routes

| Route | Mode | What it is |
| --- | --- | --- |
| `/` | on-demand | Homepage; resolves the next upcoming event per request |
| `/wydarzenia`, `/wydarzenia/[...slug]` | prerendered | Event archive |
| `/prelegenci`, `/prelegenci/[...slug]` | prerendered | Speaker directory |
| `/zglos-sie` | on-demand | Speaker application form |
| `/quiz` | on-demand | LiveQuiz — redirects to the quiz being run; the "no session yet" screen when none is |
| `/quiz/<slug>` | on-demand | LiveQuiz — the attendee's phone, one address per quiz |
| `/quiz/host` | on-demand | LiveQuiz — the host's picker: every committed quiz, with its join code |
| `/quiz/host/<slug>` | on-demand | LiveQuiz — the host panel and projector rail for one quiz |
| `/q/<code>` | on-demand | LiveQuiz — four-digit short address; redirects to `/quiz/<slug>` |
| `/api/*` | on-demand | POST handlers; read `formData()`, reply JSON, Polish error strings |

`astro.config.ts` sets `output: "server"` and content routes opt back into static generation with
`export const prerender = true`. Both halves are deliberate — do not flip `output` to `"static"` and
do not add or remove a `prerender` export for consistency's sake.

## Repository map

```
src/content/         events + speakers as Markdown — this is the CMS, there is no admin UI
src/content.config.ts Zod schemas for both collections
src/quiz/            the quiz registry and its schema; validated at build time
src/lib/session/     Redis keys, session state, scoring, standings — the authoritative store
src/lib/client/      browser modules (vanilla TypeScript, no UI framework)
src/pages/           routes, including src/pages/api/ handlers
scripts/             operational scripts run by hand against a deployment
e2e/                 Playwright specs + E2E-RULES.md
context/foundation/  PRD, roadmap, test plan, health check — the written foundation
context/archive/     per-change decision records
docs/                runbook-live-session.md
```

Content is committed, not administered: adding an event or a speaker means adding a Markdown file
under `src/content/`. `events.speakers` holds plain slug strings rather than Astro `reference()`
helpers, so a typo produces a silently missing speaker instead of a build error — check the rendered
page after adding content.

**Read the `CLAUDE.md` in a directory before changing code there.** `src/quiz/`, `src/lib/session/`,
`src/lib/client/`, `src/pages/quiz/` and `src/lib/` each carry one, and they hold the rules that are
local to that directory.

## Checks

ESLint, Prettier and the test suite are wired into three layers: a per-edit agent hook
(`.claude/hooks/per-edit-check.sh`), `lefthook.yml`'s `pre-commit` (lint, format, scoped tests,
`astro check`) and `pre-push` (the full suite). There is no CI — Vercel builds and deploys on push
to `main`.

The one gate that stands between a commit and production is the **quiz registry gate**:
`astro.config.ts` calls `assertQuizValid()` at top level, so a malformed quiz — or a registry with a
duplicate slug, a duplicate join code, or the same question id in two quizzes — fails the build and
therefore fails the deploy, leaving the previous good registry live. A failed deploy is otherwise silent;
`docs/runbook-live-session.md` carries the pre-session check that closes that gap.

## Documentation

The project is built from its written foundation, in `context/foundation/`:

- [`prd.md`](context/foundation/prd.md) — requirements, success criteria, non-goals, open questions
- [`roadmap.md`](context/foundation/roadmap.md) — the slices, in order
- [`test-plan.md`](context/foundation/test-plan.md) — the risk map and the phased test rollout
- [`health-check.md`](context/foundation/health-check.md) — known defects, prioritised
- [`stack-assessment.md`](context/foundation/stack-assessment.md), [`tech-stack.md`](context/foundation/tech-stack.md), [`infrastructure.md`](context/foundation/infrastructure.md), [`lessons.md`](context/foundation/lessons.md)

Per-change records live in `context/changes/<change-id>/` while in flight and move to
`context/archive/<date>-<change-id>/` when done. [`docs/runbook-live-session.md`](docs/runbook-live-session.md)
is what the host follows on the night. `.ai/prd.md` is the older PRD for the website before LiveQuiz.
