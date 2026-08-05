# Deployment Target Readiness (Hobby-plan variant) — Implementation Plan

## Overview

Roadmap item **F-01**. Before any realtime work rides on this deployment target, make the target a
known quantity: guard the Vercel adapter against silently pulling an Astro major, declare the intended
EU function region in version control and record what the current plan actually does with it, and
exercise the logs-and-rollback loop that F-04 is later supposed to observe latency and answer-loss
through. The Vercel Pro upgrade that `infrastructure.md` names as a prerequisite is **out of scope by
user decision** — the compensating actions and the tripwire for revisiting it are part of this change.

## Current State Analysis

Probed in the repository on `2026-08-05`:

- **Adapter**: `package.json` declares `"@astrojs/vercel": "^10.0.3"`; `node_modules` holds **10.0.3**.
  The range is already correct (`^10` is the Astro 6 line) but is undocumented, and the installed
  version trails the line.
- **Region**: `vercel.json` is `{"framework": "astro"}` — no `regions` key. `astro.config.ts:8` is a
  bare `vercel()` call; the v10 adapter exposes `isr`, `imageService`, `maxDuration`,
  `webAnalytics` and `edgeMiddleware`, but **no region option**, so region cannot live in
  `astro.config.ts` at all.
- **Plan**: Hobby. Per `infrastructure.md`, that means functions pinned to `iad1` (US East), runtime
  log retention of one hour, and a fair-use policy restricting Hobby to non-commercial personal use.
- **Repo**: `origin` is `https://github.com/jedrker/ai-community-szn.git` — a **personal** account.
  This matters: `infrastructure.md` §Unknown Unknowns records that Hobby projects cannot connect to
  Git-organization repositories, so moving the repo into an org would break the deploy pipeline.
- **Tooling**: `vercel` CLI is present at `/opt/homebrew/bin/vercel`. Scripts available are `dev`,
  `build`, `preview`, `astro`, `test`, `test:watch`, `type-check` — there is no `lint` or `format`
  script, and no `.github/`, so nothing runs between a commit and production.
- **Rendering model**: `output: "server"` with per-route `prerender` opt-ins. `infrastructure.md`
  records that Vercel's own Astro documentation is stale (still shows `output: 'hybrid'` and the
  removed `@astrojs/vercel/serverless` import); CLAUDE.md already pins the correct model.

### What has changed since the roadmap was written

The roadmap's F-01 entry, and `infrastructure.md` §Recommendation condition 1, both treat the Pro
upgrade as a hard prerequisite. The user decided on `2026-08-05` to stay on Hobby: the site carries
Brave Courses branding but is a free local community initiative. That decision is upstream of this
plan and is not re-litigated here — but it removes two of F-01's three original outcomes from reach
and therefore reshapes the change. Both foundation documents state the opposite of the current
decision and are amended in Phase 3 for that reason.

## Desired End State

- `@astrojs/vercel` is installed at the latest release on the `^10` line, and the reason the range
  must not cross to `^11` is written where an agent editing dependencies will encounter it.
- `vercel.json` declares `regions: ["fra1"]`, and the repository records — as an observed fact, not an
  assumption — whether the Hobby plan honours, ignores, or rejects that key.
- `docs/runbook-live-session.md` exists and gives the host a pre-session and during-session checklist
  whose core action is tailing logs live, because retrieval after the fact is not available.
- `context/foundation/infrastructure.md` and `context/foundation/roadmap.md` describe the plan the
  project is actually on, including the tripwire that would flip the Hobby decision.
- `vercel logs --follow` has been run once against this project with its real behaviour recorded, and
  the rollback path's **preconditions** are verified — prior immutable deployments exist and the
  command responds. An actual rollback stays unexercised, and the runbook says so plainly rather than
  letting F-04 inherit a false assurance.

**Verification**: `bun run build`, `bun run type-check` and `bun run test` all pass; a preview
deployment built from a `vercel.json` containing the `regions` key succeeds and serves the homepage;
`region-probe.md` and the runbook exist; `infrastructure.md` no longer states that Pro is a
prerequisite.

### Key Discoveries

- `@astrojs/vercel` v11 requires **Astro 7** (`infrastructure.md` §Per-platform notes) — so a blind
  `bun update` that crosses the major is a framework upgrade in disguise. The existing `^10.0.3` range
  prevents this; the risk is a future edit widening it.
- The v10 adapter has **no region option** — this is why the region belongs in `vercel.json` and
  nowhere else. Any plan that tries to configure it in `astro.config.ts` is wrong.
- `infrastructure.md` §Risk Register already names the mitigation for one-hour log retention: *"For an
  event, tail logs live during the session rather than relying on retrieval afterwards."* The runbook
  is that mitigation made operational.
- `src/lib/slack.ts` is the project's documented error-handling pattern (missing config warns and
  no-ops, failures are caught and logged, nothing throws into a request path). No code in this change
  touches a request path, so the pattern is not exercised here — it becomes load-bearing in F-02.
- Preview URLs are **publicly reachable** and fork PRs receive no environment variables
  (`infrastructure.md` §Operational Story). The Phase 2 preview deploy is therefore safe for this
  content-only site but would not be for the future host view.

## What We're NOT Doing

- **Not upgrading to Vercel Pro.** User decision. The licensing exposure and the one-hour log window
  are accepted risks, recorded below with a tripwire.
- **Not adding CI.** Wiring `bun run test` / `bun run type-check` into GitHub Actions is Open Roadmap
  Question 3, owner: user, explicitly advisory. Out of scope.
- **Not selecting monitoring or an error-tracking vendor.** `infrastructure.md` §Out of Scope names
  monitoring as a named risk, not researched. The runbook is an operational mitigation, not a tool
  choice.
- **Not adding Ably, a token endpoint, or a session store.** Those are `infrastructure.md` §Getting
  Started steps 3-4 and belong to F-02.
- **Not removing `@astrojs/tailwind`.** CLAUDE.md flags it as a leftover that should go, but it is
  unrelated to the deployment target and would muddy this diff.
- **Not upgrading Astro, TypeScript, or Vite.** TypeScript must stay on `^6` (`astro check` needs it)
  and Astro 7 is a separate deliberate change.
- **Not performing a production rollback** as a verification step unless explicitly confirmed — see
  Phase 3.

## Implementation Approach

Three phases ordered by blast radius. Phase 1 is local-only and cannot affect production. Phase 2
carries the change's only deploy risk and is gated behind a **preview** deployment so a rejected
config key fails somewhere harmless. Phase 3 needs at least two deployments to exist for the rollback
path to mean anything, which Phase 2 supplies — hence the ordering.

The empirical step is deliberate. `infrastructure.md` says the EU region requires Pro; whether Vercel
*ignores* a `regions` key on Hobby or *fails the build* is not documented in the research and is
cheaper to observe than to reason about. The outcome changes nothing about the decision to stay on
Hobby — it changes whether the key can safely sit in the repo waiting for an upgrade.

## Critical Implementation Details

**Ordering.** Phase 2's preview deploy must happen before Phase 3's rollback verification, because
`vercel rollback` is only meaningful when more than one deployment exists for the project. Do not
reorder.

**A lockfile rewrite can trip a known, already-solved failure.** CLAUDE.md:37-39 records that if a
second `vite` copy ends up nested under `node_modules/astro/`, `astro check` fails with a
`PluginOption` type mismatch on `@tailwindcss/vite`, and that the fix is
`rm -rf node_modules && bun install`. Phase 1's `bun update` is exactly the operation that can produce
this, so treat a `PluginOption` error in Phase 1 as this known issue rather than as a bad adapter
release.

**Phase 3's dependency is one-directional.** Only two things in Phase 3 need the `vercel` CLI: the
runbook's observed log-retention figure and the live log-stream observation. The
`infrastructure.md` and `roadmap.md` amendments have no CLI dependency at all, so if the CLI turns out
to be unauthenticated against the owning team, complete the amendments and stall only the verification
— do not let an auth problem hold the document corrections hostage.

**Deploy target.** Phase 2 deploys with `vercel deploy` (preview), **not** `vercel deploy --prod`.
Production deploys on this project are triggered by pushing to `main`, so the phase's commit must not
be pushed until the preview has been observed. If the `regions` key fails the build, it fails on a
preview URL nobody depends on rather than taking the event archive and newsletter endpoint down.

## Phase 1: Adapter version guard

### Overview

Bring `@astrojs/vercel` to the head of the `^10` line and record, where a future agent will read it,
why the range must not cross into `^11`.

### Changes Required:

#### 1. Dependency bump

**File**: `package.json` (plus the regenerated `bun.lock`)

**Intent**: Move the installed adapter from 10.0.3 to the latest release on the `^10` line, which
`infrastructure.md` §Getting Started step 2 records as a safe in-range update. Do not widen the range.

**Contract**: `dependencies["@astrojs/vercel"]` must remain a caret range on major `10`. Run
`bun update @astrojs/vercel` — never `bun add @astrojs/vercel@latest`, which would resolve v11 and
pull Astro 7.

If `bun run type-check` then fails with a `PluginOption` type mismatch on `@tailwindcss/vite`, that is
the documented vite-duplication issue (CLAUDE.md:37-39), not a bad adapter release — the remedy is
`rm -rf node_modules && bun install`.

#### 2. Version-boundary rule

**File**: `CLAUDE.md`

**Intent**: Record the `^10`/Astro 7 boundary as a project rule, alongside the existing TypeScript-6
and Vite-deduplication constraints that follow the same "do not bump past this" shape. Without it the
range is correct by accident and the next dependency sweep can widen it.

**Contract**: Add it to the version-constraint cluster in **`## Commands`** at **CLAUDE.md:34-37** —
immediately after the existing TypeScript-`^6` and vite-deduplication rules, which are the two
constraints of exactly this shape. Do **not** use the `## Deployment` section and do **not** place it
after the generated `10x-cli` END marker: in this file the Project guide is lines 9-133 and the
generated block is lines 134-177 (i.e. the generated zone comes *last*), so "after the END marker"
would put the rule outside the Project guide and away from its siblings. CLAUDE.md:6-7 claims otherwise
and is stale on this point.

State that `@astrojs/vercel` stays on `^10` because v11 requires Astro 7, and that an Astro major is a
separate deliberate change never bundled with feature work. Also note that the function region lives in
`vercel.json` because the v10 adapter exposes no region option.

### Success Criteria:

#### Automated Verification:

- Adapter resolves within the `^10` line: `grep '"@astrojs/vercel"' package.json` shows a `^10.x`
  range, and `bun pm ls | grep @astrojs/vercel` reports a `10.x` version
- Type checking passes with 0 errors: `bun run type-check`
- Production build succeeds: `bun run build`
- Test suite passes: `bun run test`

#### Manual Verification:

- The new CLAUDE.md rule is unambiguous about what is forbidden (widening to `^11`) and why (it is an
  Astro major), and sits in the `## Commands` version-constraint cluster beside the TypeScript-`^6` and
  vite-deduplication rules rather than in a new section

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Region declaration and Hobby probe

### Overview

Declare `fra1` in version control and find out what the Hobby plan actually does with it, on a preview
deployment where a rejected key is harmless.

### Changes Required:

#### 1. Region declaration

**File**: `vercel.json`

**Intent**: Put the intended function region under version control so it is diffable, agent-readable,
and already in place the moment a Pro upgrade happens. `fra1` (Frankfurt) is the closest option to
Szczecin per `infrastructure.md` §Risk Register.

**Contract**: Add a `regions` array alongside the existing `framework` key:

```json
{
  "framework": "astro",
  "regions": ["fra1"]
}
```

#### 2. Probe record

**File**: `context/changes/deployment-target-readiness/region-probe.md` (new)

**Intent**: Record the observed behaviour of the `regions` key on Hobby as a fact with a date and the
command that produced it, so neither F-02 nor F-04 has to re-derive it. This is the artifact the phase
exists to produce.

**Contract**: Must state, at minimum: the date; the exact commands run; which of the three outcomes
occurred — **honoured** (functions report `fra1`), **ignored** (build succeeds, functions still report
`iad1`), or **rejected** (build fails with a plan-restriction error); the verbatim error text if
rejected; and the resulting decision about whether the key stays in `vercel.json`.

**It must also record the *cause*, not just the outcome.** An "ignored" result has two very different
explanations and they lead to opposite actions: the Hobby plan restricting region selection (which a
Pro upgrade would fix) or the adapter emitting its own per-function config without a region (which a
Pro upgrade would *not* fix). Since both F-04's latency interpretation and the upgrade tripwire consume
this conclusion, distinguish them locally before deploying: run `bun run build` and inspect the
generated function config under `.vercel/output/functions/` — the per-function `.vc-config.json` files
— for a `regions`/`region` field. If the adapter emits no region field at all, `vercel.json`'s
top-level key is what the platform sees; if the adapter writes one, the platform never consults the
top-level key and the plan tier is irrelevant. Record which of these applies. If the artifact layout
differs from this description (it is adapter-version specific), record what was actually found rather
than forcing it into the expected shape.

#### 3. Conditional revert

**File**: `vercel.json`

**Intent**: If and only if the probe shows **rejected**, remove the `regions` key again — a config that
fails the build cannot sit in `main`, since `main` deploys to production. Record the removal in
`region-probe.md` as the reason the repo carries no region declaration.

**Contract**: `vercel.json` returns to `{"framework": "astro"}`. The probe record, not the config, then
carries the intent.

### Success Criteria:

#### Automated Verification:

- `vercel.json` is valid JSON: `bun -e 'JSON.parse(require("fs").readFileSync("vercel.json","utf8"))'`
- Local build still succeeds with the new key present: `bun run build`
- Generated function config inspected for a region field:
  `find .vercel/output/functions -name '.vc-config.json' -exec grep -l -i region {} +` (an empty result
  is a valid finding — it means the adapter writes none)
- A preview deployment is created and reports a ready state: `vercel deploy` then
  `vercel inspect <deployment-url>`
- `region-probe.md` exists: `ls context/changes/deployment-target-readiness/region-probe.md`

#### Manual Verification:

- `region-probe.md` names one of the three outcomes **and** its cause (plan restriction vs. adapter
  config), so the record cannot be misread as pointing at a Pro upgrade that would not help
- The preview URL serves the homepage, `/wydarzenia`, an event detail page and `/prelegenci` without
  regression
- The deployment's function region has been read from `vercel inspect` output (or the Vercel
  dashboard) and matches what `region-probe.md` claims — the probe's conclusion is observed, not
  inferred from the build merely succeeding
- If the outcome was **rejected**, `vercel.json` has been reverted and the phase's commit does not
  leave a build-breaking config on `main`

**Implementation Note**: Deploy with `vercel deploy` (preview), never `--prod`. Do not push this
phase's commit to `main` until the preview has been observed. Pause for manual confirmation before
proceeding.

---

## Phase 3: Operational loop and risk record

### Overview

Exercise the logs and rollback paths that F-04 will depend on, write the event-day runbook that
compensates for one-hour log retention, and correct the two foundation documents that currently state
Pro is a prerequisite.

### Changes Required:

#### 1. Event-day runbook

**File**: `docs/runbook-live-session.md` (new)

**Intent**: Turn `infrastructure.md`'s own mitigation — tail logs live rather than retrieving them
afterwards — into a checklist the host can follow under time pressure, plus the minimum
failure-detection step the risk register asks for. This is the compensating control for staying on
Hobby.

**Contract**: A short operational document, not a research doc. Must cover: **before the session** —
open `vercel logs <deployment-url> --follow` and keep it running for the whole segment; load the
attendee view on a second device (the risk register's stated minimum for detecting a failure); confirm
the current production deployment is the intended one via `vercel ls`. **During** — where to look when
attendees report a problem. **After** — capture anything from the log stream immediately, because the
one-hour window starts at emission. **Constraints to restate** — the repo must stay under a personal
GitHub account while on Hobby (org repos break the Hobby deploy pipeline), and rollback reverts code
only, never environment variables or state held at an external provider.

Two further items the runbook must carry, because it is the only recurring ritual this project has:

- **Rollback is unexercised on this project.** State it plainly. Phase 3 verifies the path's
  preconditions (prior deployments exist, the command responds); nobody has performed a real rollback
  here. The first one will happen under pressure, so say so rather than implying it is proven.
- **A tripwire re-read, in the pre-session checklist.** One line asking whether either upgrade trigger
  has fired: has a rehearsal or live session shown fan-out above one second, and has Vercel made any
  contact about fair use. Owner: the repository owner (account holder), since only they see the billing
  address the notice would arrive at. Attaching it here is deliberate — a tripwire nobody is scheduled
  to look at is not a tripwire, and this checklist is the one thing guaranteed to be read before every
  event.

#### 2. Infrastructure decision amendment

**File**: `context/foundation/infrastructure.md`

**Intent**: The document currently states Pro is a prerequisite and that `fra1` should be set — the
opposite of the decision now in force. Left as-is it will actively mislead the next agent that reads
it, which is the highest-value edit in this phase.

**Contract**: Amend without rewriting the research. Required edits: (a) §Recommendation condition 1 —
mark the Pro upgrade as **deferred by user decision on 2026-08-05**, with the stated rationale (free
local community initiative) and a pointer to this change; (b) §Risk Register — change the Mitigation
cells for the Hobby-licensing row, the US-East-region row and the log-retention row to the accepted
risk plus its compensating action, rather than "upgrade to Pro"; (c) §Getting Started step 1 — replace
with the actual state, referencing `region-probe.md` for what the `regions` key does on Hobby;
(d) add the **tripwire**: revisit Pro if F-04 measures fan-out from `iad1` exceeding the 1-second
guardrail, or if Vercel makes contact about fair use — naming the repository owner as its owner and the
runbook's pre-session checklist as where it gets re-read. Do not delete the original reasoning — the
research is still why Pro *would* be the right call.

#### 3. Roadmap reconciliation

**File**: `context/foundation/roadmap.md`

**Intent**: F-01's entry promises an EU region and longer log retention, and its Blockers line names
the paid human-only action as the gate. None of that survives the Hobby decision, and F-02/F-04 read
this file for their prerequisites.

**Contract**: Update the F-01 §Foundations entry — Outcome narrowed to what this change delivers,
Blockers cleared (no human-only paid step remains), Unknowns updated. In §Baseline, correct the
"Deploy / infra" bullet: the two outstanding deltas were the Pro upgrade and `fra1`, and both now have
a different disposition. Answer **Open Roadmap Question 4** (running-cost ceiling): the platform stays
at $0 on Hobby with the realtime provider free at this scale, and the tripwire is what would change
that. Add to **F-04**'s Unknowns that its latency measurement is now taken from `iad1`, not `fra1`,
which raises the stakes on its measurement — it is the input to the tripwire. Do not touch F-02's
blocked status or Open Question 1.

#### 4. Operational loop verification

**File**: none — this is a verification step whose output lands in `docs/runbook-live-session.md` and
`region-probe.md`.

**Intent**: Confirm the commands F-04 and the runbook depend on actually work on this project, rather
than being copied from research. `infrastructure.md` says the current log-retention figure "should be
confirmed against Vercel's limits page rather than assumed" — confirm it here.

**Contract**: Run `vercel ls` (prior deployments exist and are immutable),
`vercel logs <deployment-url> --follow` against the Phase 2 preview (a stream opens and emits on
request), and `vercel rollback status` (the command responds). Record the actual observed retention
figure for the current plan in the runbook. **Do not execute an actual production rollback** as part of
verification — that is an outward-facing change to a live site. If a real rollback test is wanted, it
needs explicit confirmation first and belongs in a separate, announced window.

### Success Criteria:

#### Automated Verification:

- `docs/runbook-live-session.md` exists: `ls docs/runbook-live-session.md`
- `vercel ls` lists more than one deployment for the project
- `vercel rollback status` exits without error
- The deferral is recorded where the old claim was:
  `grep -n "deferred by user decision" context/foundation/infrastructure.md` returns a hit, and both
  original `prerequisite` occurrences (`infrastructure.md:37` and `:218`) have been revisited
- Repository checks still pass: `bun run type-check`, `bun run test`, `bun run build`

#### Manual Verification:

- The runbook covers before / during / after, and includes both the unexercised-rollback statement and
  the tripwire re-read line
- `infrastructure.md`'s amended wording reads as a deliberate deferral with its rationale, not as a
  contradiction of the surrounding research
- `vercel logs --follow` produced live output when the preview URL was requested — the stream was
  observed, not assumed
- The runbook can be followed start to finish by the host without needing `infrastructure.md` open
  alongside it
- `infrastructure.md` and `roadmap.md` now agree with each other and with reality about which plan the
  project is on, and the tripwire appears in `infrastructure.md`
- A reader of F-04's entry can tell that its latency measurement is taken from `iad1`

**Implementation Note**: Pause for manual confirmation that the log stream and the runbook are usable
before considering the change complete.

---

## Testing Strategy

There is no application code in this change, so the testing surface is the existing suite acting as a
regression guard plus the deployment itself.

### Unit Tests:

- No new tests. `src/lib/newsletter.test.ts` is the only existing suite and must continue to pass —
  it is the signal that an adapter bump did not disturb the runtime.

### Integration Tests:

- The preview deployment in Phase 2 **is** the integration test: it exercises the adapter version, the
  `vercel.json` schema, and the prerendered/on-demand route split together.

### Manual Testing Steps:

1. After Phase 1: `bun run build` locally, then `bun run preview` and load the homepage — the homepage
   is on-demand and resolves the next upcoming event per request, so it exercises the adapter's
   server output rather than a static file.
2. After Phase 2: open the preview URL and check `/`, `/wydarzenia`, one event detail page, and
   `/prelegenci` — the mix of on-demand and prerendered routes is where an adapter or config problem
   would surface asymmetrically.
3. After Phase 2: read the function region from `vercel inspect` and compare with what
   `region-probe.md` concludes.
4. After Phase 3: request the preview URL while `vercel logs --follow` is open and confirm the line
   appears.
5. Do **not** submit the newsletter form on a preview deployment as a smoke test — preview
   environments have their own variable set and a signup would write a real contact to the Resend
   audience.

## Performance Considerations

The one performance fact this change establishes is negative and important: functions stay in `iad1`,
so every host action reaching a Szczecin attendee spends a transatlantic round trip out of the
1-second guardrail. This change does not measure that — F-04 does. What this change does is make sure
F-04 knows which region it is measuring from, so the number it produces is interpretable and can feed
the tripwire.

The adapter bump is a patch-level move within `^10` and carries no expected performance delta.

## Migration Notes

- **Rollback for this change** is `git revert` plus a redeploy; there is no state to migrate and no
  data to backfill. `vercel rollback` is the faster path if a bad config reaches production.
- **The revert has a caveat that applies generally**: rollback reverts code only — not environment
  variables, not Resend Audience contacts, not anything held at an external provider. This is restated
  in the runbook because it becomes materially important once F-02 puts session state behind a
  provider.
- **No plan change occurs**, so nothing about billing, seats, or team membership moves.

## References

- Roadmap item: `context/foundation/roadmap.md` §Foundations F-01
- Infrastructure decision: `context/foundation/infrastructure.md` (§Recommendation, §Risk Register,
  §Operational Story, §Getting Started)
- Change identity and scope decision: `context/changes/deployment-target-readiness/change.md`
- Error-handling pattern for later phases: `src/lib/slack.ts`
- Current config under change: `vercel.json`, `package.json`, `astro.config.ts:8`

## Open Risks & Assumptions

- **Accepted, user decision**: Hobby's fair-use policy restricts the plan to non-commercial personal
  use and this site carries sponsor branding with an outbound link. Enforcement is discretionary and
  the failure mode is a paused project — which would take the event archive, speaker directory and
  newsletter endpoint down with it. The user's position is that a free local community initiative is
  not commercial use. Tripwire: any contact from Vercel about fair use.
- **Accepted**: runtime logs are retained for one hour, so evidence of a failed event is gone before a
  post-mortem starts. Compensating control is the live-tail runbook, which depends on a human
  remembering to open it and captures nothing outside a tailed window.
- **Accepted**: functions run in `iad1`, spending part of the 1-second budget on transatlantic
  latency. Tripwire: F-04 measuring fan-out above the guardrail.
- **Tripwire ownership**: both triggers are owned by the repository owner (account holder) and are
  re-read as a line item in the runbook's pre-session checklist. The fair-use half is reactive by
  nature — it depends on a notice arriving at the account's billing address — so the checklist is what
  keeps it from being a note nobody ever revisits.
- **Assumption, tested in Phase 2**: the Hobby plan ignores rather than rejects a `regions` key. If it
  rejects, the key cannot live in the repo and Phase 2's conditional revert applies.
- **Assumption**: `vercel` CLI at `/opt/homebrew/bin/vercel` is authenticated against the team that
  owns this project. If not, Phases 2 and 3 stall on `vercel login` — a human-only step.
- **Unmitigated and out of scope**: nothing runs between a commit and production (no CI), and nothing
  alerts anyone to a live failure. Open Roadmap Question 3, owner: user.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Adapter version guard

#### Automated

- [x] 1.1 Adapter resolves within the `^10` line (`package.json` range and installed version) — 66f4812
- [x] 1.2 Type checking passes with 0 errors: `bun run type-check` — 66f4812
- [x] 1.3 Production build succeeds: `bun run build` — 66f4812
- [x] 1.4 Test suite passes: `bun run test` — 66f4812

#### Manual

- [x] 1.5 CLAUDE.md rule is unambiguous about the `^11`/Astro 7 boundary and sits in the `## Commands`
      version-constraint cluster beside the TypeScript-`^6` and vite-dedup rules — 66f4812

### Phase 2: Region declaration and Hobby probe

#### Automated

- [x] 2.1 `vercel.json` is valid JSON — fb7de2d
- [x] 2.2 Local build succeeds with the `regions` key present: `bun run build` — fb7de2d
- [x] 2.3 Generated function config inspected for a region field under `.vercel/output/functions` — fb7de2d
- [x] 2.4 Preview deployment created and reports ready: `vercel deploy`, `vercel inspect` — fb7de2d
- [x] 2.5 `region-probe.md` exists — fb7de2d

#### Manual

- [x] 2.6 `region-probe.md` names one of honoured / ignored / rejected **and** its cause (plan
      restriction vs. adapter config) — fb7de2d
- [x] 2.7 Preview URL serves `/`, `/wydarzenia`, an event detail page and `/prelegenci` without
      regression — fb7de2d
- [x] 2.8 Function region read from `vercel inspect` (or dashboard) matches `region-probe.md`'s claim — fb7de2d
- [x] 2.9 If rejected: `vercel.json` reverted, no build-breaking config left for `main` — fb7de2d

### Phase 3: Operational loop and risk record

#### Automated

- [x] 3.1 `docs/runbook-live-session.md` exists — 536fde4 *(file itself landed in 9c9bd47)*
- [x] 3.2 `vercel ls` lists more than one deployment — 536fde4
- [x] 3.3 `vercel rollback status` exits without error — 536fde4
- [x] 3.4 `grep "deferred by user decision" infrastructure.md` returns a hit; both original
      `prerequisite` occurrences (`:37`, `:218`) revisited — 536fde4
- [x] 3.5 Repository checks still pass: `bun run type-check`, `bun run test`, `bun run build` — 536fde4

#### Manual

- [x] 3.6 Runbook covers before / during / after, and carries the unexercised-rollback statement and the
      tripwire re-read line — 536fde4 *(runbook itself landed in 9c9bd47)*
- [x] 3.7 `infrastructure.md`'s amended wording reads as a deliberate deferral with rationale, not a
      contradiction of surrounding research — 536fde4
- [x] 3.8 `vercel logs --follow` produced live output on a request to the preview URL — 536fde4
      *(adapted: `--follow` is deprecated/ignored in CLI 48.10.3, and the stream carries function-emitted
      output rather than an access log — ~100 confirmed invocations produced no line. Stream attachment
      verified; the behaviour is recorded in the runbook and `infrastructure.md` instead.)*
- [x] 3.9 Runbook is followable by the host without `infrastructure.md` open alongside — 536fde4
- [x] 3.10 `infrastructure.md` and `roadmap.md` agree with each other and with reality; tripwire present
      with a named owner — 536fde4 *(roadmap edits landed in 9c9bd47)*
- [x] 3.11 F-04's entry makes clear its latency measurement is taken from `iad1` — 536fde4
      *(adapted: it is taken from `fra1` — the region key works on Hobby, so the premise inverted.
      Roadmap edit landed in 9c9bd47.)*
