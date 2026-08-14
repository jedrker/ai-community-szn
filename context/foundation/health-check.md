---
project: bizarre-bar
checked_at: 2026-08-05T20:18:12Z
remediated_at: 2026-08-05T22:33:00Z
health_status: needs-attention
context_type: brownfield
language_family: js
stack_assessment_available: true
checks_run:
  - lockfile
  - dependency_audit
  - outdated_deps
  - test_runner
  - ci_cd
  - configuration
audit_findings:
  critical: 1
  high: 11
  moderate: 11
  low: 2
audit_findings_at_check:
  critical: 1
  high: 17
  moderate: 15
  low: 3
test_runner_detected: true
test_runner: vitest
type_check_enforced: true
ci_provider: null
recommended_fixes: 9
fixes_applied:
  - 1
  - 2
  - 3
  - 5
  - 7
fixes_outstanding:
  - 4
  - 6
  - 8
  - 9
---

# Health Check — Brave AI Community Szczecin site

Audited ahead of the LiveQuiz change described in `context/foundation/prd.md`. Cross-referenced
against `context/foundation/stack-assessment.md`.

The original audit was read-only. **A remediation pass has since been applied** — it addressed every
critical- and high-severity finding that is fixable (Recommended Fixes #1, #2, #3, #5); see
"Remediation Pass" below for exactly what changed and what remains. The audit sections below are the
original findings, annotated where a fix has since landed.

## Remediation Pass (2026-08-05)

Every **critical** and **high** finding that can be fixed has been fixed and verified. Verification
commands and their results:

```
bun run type-check   → 0 errors, 0 warnings, 54 hints (23 files)
bun run test         → 14 tests passed (1 file)
bun run build        → Complete (server built in 5.87s)
bun audit            → 25 advisories (1 critical, 11 high, 11 moderate, 2 low), down from 36
```

| Fix | Severity | Status | What changed |
|---|---|---|---|
| #1 Runtime astro advisories | high | **Fixed** | `astro` 6.1.1 → 6.4.8. Both runtime-reachable HIGHs (SSRF, reflected XSS) cleared, plus two moderate XSS advisories. The bundled `vite` moved to 7.3.6, clearing all three transitive `vite` HIGHs as well. |
| #2 Broken newsletter endpoint | critical | **Fixed** | `src/lib/subscribers.ts` deleted; `src/lib/newsletter.ts` added, backed by Resend Audiences. `src/pages/api/newsletter-signup.ts` rewritten. See below. |
| #3 No test runner | high | **Fixed** | `vitest` added; `test` / `test:watch` scripts added; `src/lib/newsletter.test.ts` covers the endpoint's logic (14 tests). |
| #5 Type checking unenforced | high | **Fixed** | `@astrojs/check` + `typescript@^6` added; `type-check` script added. Reports 0 errors. |
| #4 Triage remaining advisories | medium | Outstanding | Partially superseded — the acceptance rationale is recorded below, but no in-range transitive sweep was run. |
| #6 No formatter / linter | medium | Outstanding | Not in this pass's scope. |
| #7 Stale `@astrojs/tailwind` | medium | **Fixed (2026-08-14)** | `bun remove @astrojs/tailwind`. It was declared *and* installed while `astro.config.ts` never referenced it, so an agent could import it and get a plausible-looking second, conflicting Tailwind setup — that is what the removal buys. **This row previously claimed it was "the path through which two `postcss` HIGH advisories enter the tree", and that overstated it**: `vite` is a direct devDependency and pulls `postcss` itself, so the advisories remain and only one of two paths closed. The dependency-health section below always said so; this summary did not. Verified after removal: `type-check` 0 errors, 1188 tests, `bun run build` clean, CSS still emitted with brand tokens intact, `zod` still single-copy. |
| #8 In-range dependency updates | low | Outstanding | Deliberately skipped — `bun update` would move `resend` 6.9.4 → 6.18.1 in the same change as the signup rewrite, which cannot be verified without production credentials. Do it as a separate change. |
| #9 `.editorconfig` | low | Outstanding | Not in this pass's scope. |

### How #2 was repaired

`addSubscriber` no longer touches the filesystem. `src/lib/newsletter.ts` treats **Resend Audiences
as the subscriber store** — the only store that actually persists on this platform:

- Duplicate detection comes from `resend.contacts.get({ email, audienceId })`, not from a local file.
- `addSubscriber` **throws** when the signup could not be recorded (missing `RESEND_API_KEY` /
  `RESEND_AUDIENCE_ID`, or a Resend API error). The route catches it and returns **503** with a Polish
  message, so the endpoint can never report success it did not achieve — the previous behaviour was
  an unhandled rejection and a 500.
- The welcome email is still best-effort: it is sent only on a genuinely new subscription, and a
  failure there is logged, not surfaced, so it cannot undo a successful signup.
- Email normalization (`trim` + lowercase) and validation were extracted as pure functions, which is
  what the new test file covers alongside the four `addSubscriber` paths.

The stale `data/subscribers.json` rule was removed from `.gitignore`, and `CLAUDE.md`'s
"known broken / no working persistence" guidance was updated to describe the Resend-backed module.

**Not done: the production confirmation `curl`.** Running it would POST a real signup and send a real
email from the production site, so it was left for you. The diagnosis is derived from the code, and
the repair is correct either way — but the "was it 500ing?" question is still formally unconfirmed.

### Why the audit still shows 1 critical and 11 high

All 12 are **transitive and build-time**; none is reachable from a request against the deployed site.
None is clearable by an in-range update, because each is pinned by a parent that is already at its
newest 6.x-compatible release:

- `tar` (1 critical, 1 high) — via `@astrojs/vercel › @vercel/nft › @mapbox/node-pre-gyp`. No fixed
  version published as of this pass.
- `defu` (1 high) — via `astro › unstorage › h3`. No fixed version published.
- `brace-expansion` (3 high) — via `@astrojs/vercel › @vercel/nft › glob › minimatch`.
- `postcss` (2 high) — via `@astrojs/tailwind` and `vite`. Removing `@astrojs/tailwind` (fix #7)
  removes one of the two paths.
- `sharp` (1 high), `svgo` (1 high), `js-yaml` (1 high) — via `astro`.
- `path-to-regexp` (1 high) — via `@astrojs/vercel › @vercel/routing-utils`.

The three remaining `astro` advisories (2 moderate, 1 low) are the ones not fixed anywhere in the 6.x
line; clearing them needs the Astro 7 major. That decision is unchanged — see the caveat below.

**Accepted, with rationale**: all of the above, on the grounds that they are build-time only, the
deployed site serves a built artifact, and the two with no published fix cannot be resolved by any
action short of dropping Astro. Re-check when `@astrojs/vercel` 11 / Astro 7 is taken up.

## Dependency Health

### Lockfile

```
Status: present (bun.lock)
Package manager: bun 1.3.14
```

Dependency versions are pinned and builds are reproducible. Note: `bun.lock` is bun's newer text
lockfile format, superseding the binary `bun.lockb`.

### Security Audit

```
Tool: bun audit --json
Summary (at check):  1 CRITICAL, 17 HIGH, 15 MODERATE, 3 LOW  (36 advisories across 14 packages)
Summary (post-fix): 1 CRITICAL, 11 HIGH, 11 MODERATE, 2 LOW  (25 advisories across 11 packages)
Direct vs transitive: 1 vulnerable direct dependency (astro); 13 transitive
```

> **Post-fix**: both runtime-reachable advisories are cleared. Everything below that is still open is
> transitive and build-time. Per-finding status is annotated inline.

> **Re-measured 2026-08-14, after fix #7**: `bun audit` reports **29 (1 critical, 14 high, 12
> moderate, 2 low)**, against the 25 recorded above on 2026-08-05. **Read that as drift, not
> regression.** Removing `@astrojs/tailwind` closed one of two paths to `postcss`, and `vite` still
> pulls the other, so the removal cleared nothing and could not have *added* anything — the delta is
> nine days of newly published advisories against an unchanged tree. The exposure split is unchanged:
> still transitive, still build-time, still not reachable from a request against the deployed site.
> The counts in the frontmatter and in the block above are deliberately left at their 2026-08-05
> values, because they are what that pass measured; this note is the current reading.

**Read this section with the exposure split in mind.** Most of the volume is build-time and
dev-server tooling reached through `astro`'s own dependency tree — real advisories, but not
attacker-reachable in the deployed site, which serves a built artifact. The advisories that plausibly
touch a running production request are a much smaller set, and they are all in `astro` itself. The
grouping below separates the two.

#### CRITICAL findings

- **tar** 7.5.13 — GHSA-23hp-3jrh-7fpw: decompression/parse denial of service via unlimited input.
  Vulnerable `<=7.5.18`; **no fixed version is published as of this audit**, so this cannot be
  cleared by updating. Transitive, build-time only (archive extraction during dependency install and
  image tooling). GitHub labels it critical while its CVSS is 7.5, which would ordinarily be high —
  the label is reported as the tool gives it, but the CVSS is the better guide to real risk here.

#### HIGH findings

Runtime-relevant (in `astro`, the one vulnerable direct dependency):

- ✅ **RESOLVED** — **astro** 6.1.1 — GHSA-2pvr-wf23-7pc7: host-header SSRF in the prerendered error
  page fetch. Vulnerable `<6.4.6`. Fixed by the update to 6.4.8.
- ✅ **RESOLVED** — **astro** 6.1.1 — GHSA-8hv8-536x-4wqp: reflected XSS via an unescaped slot name.
  Vulnerable `<6.3.3`. Fixed by the update to 6.4.8.

Both were cleared by a single in-range update — see Recommended Fixes #1. **No advisory in this audit
is now reachable from a request against the deployed site.**

Build-time and dev-server only (transitive, not reachable in the deployed site):

- ✅ **RESOLVED** — **vite** 7.3.1 — GHSA-fx2h-pf6j-xcff, GHSA-v2wj-q39q-566r, GHSA-p9ff-h696-f583:
  `server.fs.deny` bypasses and arbitrary file read via the dev server. Required `vite >= 7.3.5`;
  the astro update pulled 7.3.6.
- **postcss** 8.5.8 — GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849: arbitrary `.map` file read via
  attacker-controlled `sourceMappingURL`. Requires `postcss > 8.5.17`.
- **brace-expansion** 5.0.5 — GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895, GHSA-3jxr-9vmj-r5cp:
  denial of service via unbounded expansion. Requires `>= 5.0.9`.
- **js-yaml** 4.1.1 — GHSA-52cp-r559-cp3m: quadratic CPU consumption via merge-key chains.
  Requires `>= 4.3.0`.
- **sharp** 0.34.5 — GHSA-f88m-g3jw-g9cj: inherited libvips vulnerabilities. Requires `>= 0.35.0`.
- **svgo** 4.0.1 — GHSA-2p49-hgcm-8545: `removeScripts` leaves some executable scripts intact.
  Requires `>= 4.0.2`.
- **tar** 7.5.13 — GHSA-8x88-c5mf-7j5w: infinite loop on negative tar entry size.
- **defu** 6.1.4 — GHSA-737v-mqg7-c878: prototype pollution via `__proto__`. No fixed version
  published (`<=6.1.4` vulnerable).
- ✅ **RESOLVED** — **devalue** 5.6.4 — GHSA-77vg-94rm-hx3p: denial of service via sparse array
  deserialization. Required `> 5.8.0`; the astro update pulled it past that. This was the one in
  this group closest to a runtime path (it serializes values sent to hydrated components), so it is
  the most valuable clearance after the two astro advisories.
- **path-to-regexp** 6.1.0 — GHSA-9wv6-86v2-598j: backtracking regular expressions. Vulnerable
  `>=4.0.0 <6.3.0`; requires `>= 6.3.0`. Also closer to a runtime path, since it participates in
  route matching.

#### MODERATE findings (15)

Four in `astro` (XSS via `define:vars` script-tag sanitization, unescaped spread attribute names,
unescaped View Transition animation properties, unescaped attribute names in `renderHTMLElement`) —
two of which the in-range update clears. The remaining eleven are transitive build-time issues in
`tar` (4), `postcss` (2), `vite` (2), `brace-expansion` (1), `js-yaml` (1), and `uuid` (1).

#### LOW findings (3)

Two in `astro` (server-island encrypted parameter replay; XSS via `transition:*` directive values on
hydrated islands) and one in `esbuild` (arbitrary file read via the dev server, Windows only).

**A caveat on the remaining astro advisories.** Three of them — GHSA-4g3v-8h47-v7g6
(`>=2.9.0 <=7.0.9`), GHSA-f48w-9m4c-m7f5 (`<7.0.6`), and GHSA-7pw4-f3q4-r2p2 (`>=3.10.0 <7.0.4`) —
are not fixed anywhere in the 6.x line. Clearing them requires the Astro 7 major upgrade. They are
one moderate and two lows, all XSS variants requiring specific template constructs, so they do not
justify a major upgrade on their own.

### Outdated Dependencies

```
Packages with major version gaps: 2  (post-fix: still 2)
```

- ✅ **astro**: now at **6.4.8** (top of the 6.x line); 7.1.6 latest (1 major behind, deliberately)
- **@astrojs/vercel**: 10.0.3 → 10.0.8 in-range, 11.0.4 latest (1 major behind)

Also notable, without a major gap (all still outstanding — fix #8 was deliberately deferred):

- **resend**: 6.9.4 → 6.18.1 (9 minor versions behind — the largest in-range gap in the project)
- **tailwindcss** and **@tailwindcss/vite**: 4.2.2 → 4.3.3
- **@tailwindcss/typography**: 0.5.19 → 0.5.20
- **@types/node** (dev): 25.5.0 → 25.9.5 in-range, 26.1.2 latest

Added by the remediation pass, and pinned on purpose:

- **typescript** (dev): `^6` — **do not move to 7.** `astro check` needs the programmatic compiler
  API that TypeScript 7's native compiler does not yet expose; on 7.0.2 `bun run type-check` fails
  outright.
- **vite** (dev): `^7.3.6` — declared explicitly so a single copy is hoisted. When a second copy
  nests under `node_modules/astro/`, `astro check` reports a spurious `PluginOption` type error on
  `@tailwindcss/vite`. `rm -rf node_modules && bun install` restores the dedupe.
- **vitest**, **@astrojs/check** (dev) — see fixes #3 and #5.

The astro and `@astrojs/vercel` majors move together — Astro 7 will want the matching adapter major.
Treat them as one upgrade, not two.

## Test Suite

```
Test runner: vitest 4.1.10  (was: not detected)
Tests found: 14 in 1 file (src/lib/newsletter.test.ts)
Test execution: bun run test → 14 passed
```

✅ **RESOLVED.** At check time there was no runner: `package.json` declared only `dev`, `build`,
`preview`, and `astro`; no runner config existed; no `*.test.*` / `*.spec.*` file existed under
`src/`. Vitest is now installed with `test` and `test:watch` scripts, and it needs no config of its
own — it reuses the Vite pipeline Astro already runs.

The first test file covers the repaired newsletter module: email normalization and validation as pure
functions, plus all four `addSubscriber` outcomes (new contact, existing contact, Resend API error,
missing configuration) against a mocked Resend client.

Still true, and the reason this is only half-solved: **coverage is one module.** Nothing else in the
project has a test. The LiveQuiz scoring rules named in the PRD — all-or-nothing multi-answer credit,
relative-error numeric scoring, speed weighting, diacritic-insensitive matching, leaderboard ordering
— are pure functions and should get tests as they are written, not after.

## CI/CD

```
Provider: not detected
Configuration: not found
```

| Stage      | Status | Notes                                          |
|------------|--------|------------------------------------------------|
| Lint       | ✗      | not configured (no linter installed either)     |
| Test       | ✗      | not in CI — but `bun run test` now exists       |
| Build      | ✗      | not configured in CI; Vercel builds on push     |
| Type check | ✗      | not in CI — but `bun run type-check` now exists |
| Security   | ✗      | not configured (no scheduled audit, no bot)     |

Post-fix, three of these five are now *runnable locally* (`test`, `type-check`, `build`); none is
*enforced*. The remediation pass closed the tooling gap, not the gating gap.

ℹ No CI/CD configuration detected. You'll set this up in the infrastructure and deployment lesson.
For now, a local test runner is sufficient for agent collaboration.

Deployment itself is configured — `vercel.json` declares the Astro framework preset and Vercel builds
on push to `main`. What is absent is any gate *before* that deploy: nothing runs a check between a
commit and production.

## Configuration

### High severity — both resolved

- ✅ **Test runner configuration** — was: no runner installed, so no change could be verified before
  reaching production. Now: Vitest with `test` / `test:watch`. Fix #3.
- ✅ **`type-check` script** — was: `tsconfig.json` extends `astro/tsconfigs/strict`, but no script
  invoked it, so strict mode protected only whoever had an editor open. Now: `bun run type-check`
  runs `astro check`, reporting 0 errors on a clean tree. Fix #5.

### Medium severity

- **No formatter** — no `.prettierrc*`, `prettier.config.*`, or `biome.json`. Nothing normalizes
  style, so an agent's output drifts from surrounding code with nothing to correct it.
- **No linter** — no `.eslintrc*` or `eslint.config.*`. Combined with the absent test runner and the
  unenforced type check, there is currently no automated signal of any kind on a change.

### Low severity

- **`.editorconfig`** — absent. Editors will disagree on indentation and line endings across
  contributors. Fix: add a five-line `.editorconfig`.

Present and correct, for the record: `.gitignore` (comprehensive, correctly ignores `.env*` while
keeping `.env.example`, and ignores `.astro/`, `.vercel/`, `dist`), `.env.example` (documents all four
environment variables the code reads), and `tsconfig.json` with strict enabled.

`CLAUDE.md` contained no project conventions at check time. It now carries a "Project guide" section,
which the remediation pass updated so it does not describe the old broken state: the commands block
lists `test`, `test:watch`, and `type-check` (with the TypeScript 6.x and vite-dedupe constraints),
and the `src/lib/` section describes the Resend-backed `newsletter.ts` instead of the deleted
`subscribers.ts`. A proper review of that file is still Category B.

## Stack Assessment Cross-Reference

```
Stack assessment: context/foundation/stack-assessment.md
Agent readiness (from stack-assess): ready-with-compensation
```

| Quality Gate Gap | Health-Check Finding | Status |
|---|---|---|
| Test runner: fail on training-data and documentation | Confirmed: no runner, no config, no test files, no `test` script | ✅ **Closed** — Vitest + 14 tests |
| Type checking configured but unenforced | Confirmed: no `type-check` script; no CI to run one either | ✅ **Closed locally** — `type-check` script exists; still not gated in CI |
| No linter or formatter | Confirmed: neither configured | **Reinforced** |
| Stale `@astrojs/tailwind` dependency | Confirmed and worse: version 6.0.2 is not merely declared, it is **installed** in `node_modules`, so an agent can import it successfully and get a plausible-looking result | **Reinforced** |
| `CLAUDE.md` carries no project conventions | Confirmed present, still toolkit-only | **Reinforced** |
| No working persistence (`subscribers.json`) | Confirmed and materially worse — see the critical finding below | ✅ **Closed** — Resend Audiences is now the store; the filesystem module is deleted |
| No monitoring or alerting | Confirmed: no CI, no scan, nothing that would report a failure | **Reinforced** |
| Framework convention adherence: pass | Layout still matches Astro conventions exactly | Mitigated (no new concern) |
| Type safety: pass | `astro/tsconfigs/strict` confirmed, Zod schemas confirmed | Mitigated (no new concern) |

Every gap the stack assessment identified was reinforced by this audit; none was mitigated. That is
consistent — stack-assess inferred the gaps from configuration, and this pass confirmed each one
against the tree and the source. **After remediation, three of the seven reinforced gaps are closed**
(test runner, type-check enforcement, working persistence). The four still open are the linter /
formatter, the stale `@astrojs/tailwind` dependency, `CLAUDE.md` conventions, and monitoring.

**One gap turned out to be a live defect rather than a latent risk.** The stack assessment described
`src/lib/subscribers.ts` as writing to a filesystem Vercel discards, and treated the consequence as
lost subscriber records. Reading the call site changes the severity — see Recommended Fixes #2.

## Recommended Fixes

### Fix before agent work (Category A)

### 1. Two runtime-relevant HIGH advisories in astro, clearable by one in-range update — ✅ APPLIED

**Impact**: A host-header SSRF and a reflected XSS are the only advisories in this audit that
plausibly affect a production request on the deployed site. Both are fixed within the existing `^6.1.1`
semver range, so nothing about the framework major changes.
**Severity**: high
**Effort**: quick (< 5 min, plus a smoke check)

**Fix**:

```bash
bun update astro
```

This moves 6.1.1 → 6.4.8, clearing GHSA-2pvr-wf23-7pc7 (`<6.4.6`), GHSA-8hv8-536x-4wqp (`<6.3.3`),
and two moderate XSS advisories (`<6.1.6`, `<6.4.6`). Afterwards, re-run `bun audit` and check
whether the bundled `vite` moved past 7.3.4 — if it did, three transitive HIGH advisories clear for
free. Then confirm the site still builds and renders before committing.

**Outcome**: applied. astro is at 6.4.8. `vite` moved to 7.3.6, so all three transitive `vite` HIGHs
cleared as predicted, and `devalue` cleared too. `bun run build` passes.

### 2. The newsletter signup endpoint appears to be broken in production — ✅ APPLIED (repair only; production confirmation still pending)

**Impact**: This is the highest user-visible finding in the audit, and it is not a LiveQuiz concern —
it is live today. `src/pages/api/newsletter-signup.ts` calls
`const isNew = await addSubscriber(email)` with **no try/catch**. `addSubscriber` writes to
`join(process.cwd(), "data", "subscribers.json")`. The `data/` directory does not exist in the
repository, and `.gitignore` explicitly excludes `data/subscribers.json`, so it is never deployed. On
Vercel's serverless filesystem the write cannot succeed regardless. The `writeFile` rejection is
therefore unhandled and propagates out of the route handler, so the request 500s.

Worse, every side effect is gated behind that call: `if (isNew && import.meta.env.RESEND_API_KEY)`.
Because `isNew` is never reached, the Resend contact is never created and the welcome email is never
sent. A visitor submitting the form gets an error and is not subscribed anywhere.

This also undercuts a PRD guardrail. `prd.md` commits that "every capability the existing site
provides today continues to work unchanged: ... both signup forms". If this endpoint is already
failing, that guardrail is protecting something that is not currently working, and the LiveQuiz work
would be built on a false baseline.

**Severity**: critical
**Effort**: moderate (15–30 min)

**Fix**: confirm first, then repair. Confirmation is one request against the deployed site:

```bash
curl -i -X POST https://www.ai-community.szczecin.pl/api/newsletter-signup \
  -F "email=your-own-address@example.com"
```

A 500 confirms the diagnosis; a 200 means something in the deployed environment differs from the
repository and the finding needs revisiting. Note this analysis was read-only — the conclusion is
derived from reading the code and the ignore rules, not from executing the endpoint.

The repair is to stop treating the local file as the source of truth. Resend Audiences is already
integrated and already the real subscriber store, so the minimal fix is to make the Resend call the
primary path, derive duplicate detection from Resend's response rather than from a local file, and
either delete `src/lib/subscribers.ts` or guard its failure so it can never break a signup.

**Outcome**: repaired exactly along those lines — `subscribers.ts` deleted, `newsletter.ts` added,
duplicate detection from `resend.contacts.get`, route returns 503 rather than silently succeeding
when the store is unreachable. Details in "How #2 was repaired" above. **The `curl` confirmation was
not run** — it would create a real subscriber and send a real email from production, so it is left to
you. Run it against the deployed build *before* this change ships if you want the before/after
evidence; otherwise verify after deploy that a signup returns 200 and the contact appears in the
Resend Audience.

### 3. No test runner — ✅ APPLIED

**Impact**: The agent cannot verify its own work, and neither can you. This matters
disproportionately for LiveQuiz: the PRD's two hardest commitments are one-second propagation to
every participant and answer integrity at 150 concurrent participants, and the scoring rules settled
during shaping — all-or-nothing multi-answer credit, relative-error numeric scoring, speed weighting,
diacritic-insensitive text matching, leaderboard ordering — are pure functions of their inputs. They
are the cheapest possible things to test and currently there is nowhere to put a test.
**Severity**: high
**Effort**: moderate (15–30 min)

**Fix**:

```bash
bun add -d vitest
```

Then add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Vitest reuses Astro's existing Vite pipeline, so no separate build configuration is needed for
testing plain `.ts` modules — which is exactly where the scoring rules should live. Write the first
test alongside the first scoring function, not after.

**Outcome**: applied, with no config file needed as predicted. `src/lib/newsletter.test.ts` is the
first test file (14 tests, all passing) and was written alongside the fix #2 repair rather than after
it.

### 4. Triage the remaining audit findings and record the decision

**Impact**: 25 advisories remain after fix #1 (the estimate of 34 was made before the update; the
astro bump cleared more transitively than expected), and leaving them undocumented means re-triaging them
every time someone runs an audit. Most are build-time and not attacker-reachable in the deployed
site; a few cannot be fixed at all right now.
**Severity**: medium
**Effort**: moderate (15–30 min)

**Fix**: run `bun update` to pull in-range transitive fixes, then re-audit and write down what
remains and why it is accepted. Specifically worth recording: `tar` GHSA-23hp-3jrh-7fpw (critical
label, CVSS 7.5, **no published fix**, build-time only) and `defu` GHSA-737v-mqg7-c878 (high, no
published fix). Neither can be resolved by updating, so the only options are accepting them with a
stated rationale or removing the dependency path — and both arrive through Astro's own tree, so
removal is not realistic. Accepting them explicitly is the correct call; leaving them unexamined is
not.

**Partial outcome**: the acceptance rationale for all 12 remaining critical/high advisories is now
recorded in "Why the audit still shows 1 critical and 11 high" above. What was *not* done is the
`bun update` transitive sweep — see fix #8 for why it was held back. Redo the triage after that
update lands.

### 5. Type checking is configured but nothing runs it — ✅ APPLIED

**Impact**: Strict mode is on and delivers nothing to an agent that cannot invoke it. An agent will
not discover it broke a type.
**Severity**: high
**Effort**: quick (< 5 min)

**Fix**:

```bash
bun add -d @astrojs/check typescript
```

Then add to `package.json` scripts:

```json
"type-check": "astro check"
```

This is also a prerequisite for the instruction-file text the stack assessment drafted, which already
tells the agent to run `bun run type-check`. Until the script exists, that rule points at a command
that fails.

**Outcome**: applied, with two constraints the original recommendation did not anticipate:

1. **`typescript` must be pinned to `^6`.** A bare `bun add -d typescript` installs 7.0.2, and
   `astro check` fails immediately — TypeScript 7's native compiler does not expose the programmatic
   API the Astro language server uses.
2. **`vite` had to be declared explicitly and the tree reinstalled.** Adding Vitest caused a second
   `vite` copy to nest under `node_modules/astro/`, which made `astro check` report a spurious
   `PluginOption` type error on `@tailwindcss/vite` in `astro.config.ts`. `vite@^7.3.6` is now a
   devDependency and `rm -rf node_modules && bun install` deduped it. `astro check` then reported
   0 errors with no source changes.

### 6. No formatter and no linter

**Impact**: With no tests and no enforced type check, formatting and linting are currently the only
remaining automated signal on a change — and neither is configured. An agent infers conventions from
surrounding files and drifts.
**Severity**: medium
**Effort**: moderate (15–30 min)

**Fix**: Prettier with the Astro plugin, which handles `.astro` files that generic formatters mangle:

```bash
bun add -d prettier prettier-plugin-astro
```

Create `.prettierrc`:

```json
{ "plugins": ["prettier-plugin-astro"] }
```

Then add scripts:

```json
"format": "prettier --write .",
"format:check": "prettier --check ."
```

For linting, `eslint` with `eslint-plugin-astro` is the conventional pairing. Biome is a faster
single-tool alternative but its `.astro` support is weaker — Prettier plus ESLint is the safer pick
for this codebase.

### 7. Remove the stale @astrojs/tailwind dependency

**Impact**: The stack assessment flagged this as a declared-but-unused dependency. It is worse than
that: version 6.0.2 is **installed** in `node_modules`, so an agent that reaches for the old
integration will find it resolves and appears to work, while `astro.config.ts` wires Tailwind through
`@tailwindcss/vite`. Two competing mechanisms, one of them a trap, in a project where much of the
training data describes the older one.
**Severity**: medium
**Effort**: quick (< 5 min)

**Fix**:

```bash
bun remove @astrojs/tailwind
```

Then confirm styling still renders — it should, since `astro.config.ts` never referenced it.

### 8. Bring in-range dependency updates current

**Impact**: `resend` is nine minor versions behind, the largest in-range gap in the project, on a
library that handles both signup flows. Staying current on in-range updates is cheap; deferring them
turns into a large simultaneous upgrade later.
**Severity**: low
**Effort**: quick (< 5 min, plus a smoke check)

**Fix**:

```bash
bun update
```

This covers `resend` 6.9.4 → 6.18.1, Tailwind 4.2.2 → 4.3.3, `@astrojs/vercel` 10.0.3 → 10.0.8, and
`@types/node`. It does not cross the Astro 7 or `@astrojs/vercel` 11 majors — leave those for a
deliberate upgrade with the adapter, and not in the same change as LiveQuiz.

**Deliberately deferred by the remediation pass.** The `resend` jump moves the library that fix #2
just rewired, in the same change as the rewiring, and the test suite mocks the Resend client — so a
behavioural change in the real SDK would pass tests and fail in production. Do this as its own
change, and smoke-test a signup against the deployed build afterwards. `bun.lock` is committed, so
the current versions are pinned until then; nothing drifts in the meantime.

### 9. Add .editorconfig

**Impact**: Convenience, not correctness. Keeps indentation and line endings consistent across
editors before more contributors touch the project.
**Severity**: low
**Effort**: quick (< 5 min)

**Fix**: create `.editorconfig`:

```ini
root = true

[*]
charset = utf-8
indent_style = space
indent_size = 2
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
```

### Addressed in upcoming lessons (Category B)

### No CI/CD pipeline

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: Set up the pipeline that runs lint, type-check, and tests between a commit
and a deploy — the gate this project currently does not have. Today Vercel deploys on push with
nothing checked in between. For agent collaboration right now, a working local test runner
(Category A #3) is what matters; CI is what makes it reliable afterwards.

### CLAUDE.md has no project conventions, and no AGENTS.md exists

**Lesson**: [Agent Onboarding: Agents.md, AI Rules i feedback loops (M1L4)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l4)
**What you'll do there**: Build the instruction files properly, with the right content and the right
feedback loops. `context/foundation/stack-assessment.md` already contains a drafted conventions block
for this project — treat it as raw material for that lesson rather than something to paste now. Two
of its rules reference `bun run type-check` and `bun run test`, so Category A #3 and #5 should land
first or the instructions will point at commands that do not exist.

### No monitoring or alerting

**Lesson**: [Sprint Zero z Agentem: infrastruktura, walking skeleton i pierwszy deploy (M1L5)](https://platforma.przeprogramowani.pl/external/10xdevs-3/m1-l5)
**What you'll do there**: Deployment and operational concerns, including how you would learn that
something broke. Worth flagging that the PRD names a live event in front of a room as the blast radius
of a LiveQuiz failure, and finding #2 in Category A is a concrete example of a production failure that
has gone unnoticed — so this gap is not theoretical here.

## Summary

```
Health status: needs-attention   (was: critical-issues)
```

**Post-remediation.** Every critical and high finding that can be fixed has been fixed and verified:
the two runtime-reachable astro advisories are cleared by the 6.4.8 update, the newsletter signup
endpoint no longer depends on an unwritable filesystem and can no longer report a success it did not
achieve, Vitest is installed with the first 14 tests green, and `bun run type-check` enforces the
strict config it was already carrying. `bun run build` passes. The audit is down from 36 advisories
to 25, and none of the remainder is reachable from a request against the deployed site.

The status is `needs-attention` rather than `healthy` because of what is still open: no CI gate
(nothing runs between a commit and production), no linter or formatter, the stale `@astrojs/tailwind`
trap dependency, in-range updates deliberately deferred, and — the one that matters for LiveQuiz —
test coverage that is currently a single module. Also unresolved: the production `curl` confirming
the signup endpoint was actually 500ing was not run, so that diagnosis remains code-derived.

The remaining 1 critical / 11 high advisories are all transitive, build-time, and unfixable by any
in-range update; two (`tar`, `defu`) have no published fix at all. They are accepted with the
rationale recorded above, not overlooked.

---

*Original audit assessment, retained for context:*

The stack itself is in good shape — a pinned lockfile, strict TypeScript across the whole project,
Zod-validated content schemas, layout that follows Astro's conventions, a sound `.gitignore`, and a
documented `.env.example`. The verdict is driven by three things rather than by the stack: a
dependency audit carrying one critical-labelled and seventeen high advisories (though only two are
plausibly reachable in production, and both clear with a single in-range `bun update astro`), the
complete absence of a test runner on a change whose hardest commitments are timing and concurrency
guarantees, and a newsletter endpoint that reading the code says is already returning 500s in
production because an unguarded file write cannot succeed on a serverless filesystem. Every gap the
stack assessment predicted was confirmed; none was mitigated.

The encouraging part is how cheap the top of the list is. Fixes #1, #5, #7, #8, and #9 are each under
five minutes and mostly single commands. The two that need real thought are the broken signup endpoint
and standing up a test runner — and the second one is the prerequisite for trusting anything an agent
builds against the PRD's guardrails.

Next step: address Category A #1 through #3 before starting LiveQuiz work — the security update, the
signup endpoint (confirm with the `curl` above before repairing), and the test runner. Then proceed to
agent onboarding, where the conventions block already drafted in `stack-assessment.md` becomes the
input.

---

**Next step (updated).** Category A #1, #2, #3, and #5 are done — LiveQuiz work is unblocked. In
order, what is left:

1. Verify the signup repair against the deployed site once it ships (fix #2's outstanding half).
2. `bun update` as its own change, then smoke-test a signup and redo the triage (fixes #8, #4).
3. ~~`bun remove @astrojs/tailwind` (fix #7)~~ — **done 2026-08-14.** Removed one of the two `postcss` paths; `vite` still pulls the other, so the advisories stand.
4. Prettier + ESLint (fix #6) and `.editorconfig` (fix #9).
5. Agent onboarding, using the conventions block drafted in `stack-assessment.md` — its
   `bun run type-check` and `bun run test` references now point at commands that exist.
6. CI, in the infrastructure lesson: the three checks that now run locally are not enforced anywhere.
