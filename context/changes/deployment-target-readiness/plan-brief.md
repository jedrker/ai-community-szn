# Deployment Target Readiness (Hobby-plan variant) — Plan Brief

> Full plan: `context/changes/deployment-target-readiness/plan.md`
> Change identity: `context/changes/deployment-target-readiness/change.md`
> Upstream: `context/foundation/roadmap.md` §F-01, `context/foundation/infrastructure.md`

## What & Why

Roadmap item **F-01** — make the deployment target a known quantity before the realtime spine (F-02)
and the room-scale rehearsal (F-04) start depending on it. Three things get nailed down: the Vercel
adapter cannot silently pull an Astro major, the intended EU function region is declared in version
control with its real behaviour on the current plan recorded rather than assumed, and the
logs-and-rollback loop F-04 is supposed to measure through has actually been run once.

The Vercel **Pro upgrade** that `infrastructure.md` names as a prerequisite is out of scope by user
decision: the site carries Brave Courses branding but is a free local community initiative. That is
the decision that reshapes this change.

## Starting Point

The site is already live on Vercel Hobby, `output: "server"` with per-route prerendering, deploying on
push to `main`. `package.json` declares `@astrojs/vercel: ^10.0.3` with 10.0.3 installed — the range is
correct but undocumented. `vercel.json` is `{"framework": "astro"}` with no region. There is no CI, no
alerting, and no `.github/`. `astro.config.ts:8` is a bare `vercel()` call, and the v10 adapter has no
region option at all — which is why the region can only live in `vercel.json`.

## Desired End State

The adapter sits at the head of the `^10` line with the Astro-7 boundary written down where an agent
editing dependencies will hit it. `vercel.json` declares `fra1`, and a probe record states as observed
fact whether Hobby honours, ignores, or rejects it. A host preparing for a live session has
`docs/runbook-live-session.md` to follow, whose core step is tailing logs live — the compensating
control for one-hour log retention. `infrastructure.md` and `roadmap.md` describe the plan the project
is actually on, with a tripwire for revisiting it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Hosting plan | Stay on Hobby | A free local community initiative, sponsor branding notwithstanding — licensing exposure accepted with a tripwire. | Plan (user) |
| Scope | Adapter pin + region declaration + verified ops loop | The only F-01 outcomes reachable without Pro; Ably and the session store stay in F-02. | Plan |
| Region location | `vercel.json` `regions` key | The v10 adapter exposes no region option, and a version-controlled key is diffable and agent-readable. | Plan |
| Region on Hobby | Commit `fra1`, probe what Hobby does | Cheaper to observe on a preview deploy than to reason about; the key is then ready the moment Pro happens. | Plan |
| Log retention gap | Live-tail runbook for events | `infrastructure.md`'s own stated mitigation, and it costs nothing. | Infrastructure |
| Monitoring / CI | Out of scope | Open Roadmap Question 3, owner: user, explicitly advisory. | Roadmap |
| Upgrade tripwire | F-04 latency above 1s, or Vercel fair-use contact | Ties the decision to the two things that would actually make Hobby untenable; owned by the account holder, re-read in the runbook's pre-session checklist. | Plan |
| Documentation home | New `docs/runbook-live-session.md` + amend `infrastructure.md` | `infrastructure.md` currently states the opposite of the decision in force and would mislead the next agent. | Plan |

## Scope

**In scope:** in-range `@astrojs/vercel` bump with a documented `^10` boundary rule; `regions: ["fra1"]`
in `vercel.json` plus a probe record of its Hobby behaviour; `docs/runbook-live-session.md`; amendments
to `infrastructure.md` and `roadmap.md` (including an answer to Open Roadmap Question 4); one real
exercise of `vercel logs --follow`, `vercel ls` and `vercel rollback status`.

**Out of scope:** the Pro upgrade; `fra1` actually taking effect; CI; monitoring or error-tracking
vendor selection; Ably, the token endpoint and the session store (all F-02); removing the
`@astrojs/tailwind` leftover; any Astro, TypeScript or Vite upgrade; executing a production rollback.

## Architecture / Approach

Three phases ordered by blast radius. **Phase 1** is local-only and cannot touch production. **Phase 2**
carries the only deploy risk and is gated behind a *preview* deployment (`vercel deploy`, never
`--prod`), so a config key Hobby rejects fails somewhere harmless; the phase's commit is not pushed to
`main` until the preview is observed. **Phase 3** verifies the operational loop, which requires more
than one deployment to exist — supplied by Phase 2, hence the ordering. No application code changes;
the existing `newsletter.test.ts` suite acts as the regression guard and the preview deployment is the
integration test.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Adapter version guard | Adapter at head of `^10`; boundary rule in CLAUDE.md | A bump command that crosses to v11 pulls Astro 7 by accident |
| 2. Region declaration and Hobby probe | `fra1` in `vercel.json`; `region-probe.md` recording observed behaviour **and its cause** | Hobby *rejects* the key and breaks the build — mitigated by preview-first and a conditional revert |
| 3. Operational loop and risk record | Runbook; corrected `infrastructure.md` and `roadmap.md`; logs/rollback exercised | CLI not authenticated against the owning team (human-only fix); temptation to prove rollback on production |

**Prerequisites:** `vercel` CLI authenticated against the team owning this project (present at
`/opt/homebrew/bin/vercel`); push access to `main`; the repo staying under a personal GitHub account
(Hobby cannot connect to org repos).

**Estimated effort:** ~1 session across 3 phases — small diff, but two phases end in a manual
observation gate that cannot be rushed.

## Open Risks & Assumptions

- **Accepted (user):** Hobby's fair-use policy forbids commercial use; enforcement is discretionary and
  the failure mode is a paused project taking the event archive, speaker directory and newsletter
  endpoint down with it.
- **Accepted:** one-hour log retention means post-mortem evidence is gone before anyone looks; the
  runbook mitigation depends on a human remembering to open a log stream.
- **Accepted:** functions run in `iad1`, spending transatlantic latency out of the 1-second guardrail.
  This propagates — F-04 now measures from `iad1`, and that number is the tripwire's input.
- **Tested in Phase 2:** the assumption that Hobby ignores rather than rejects a `regions` key.
- **Out of scope, unmitigated:** nothing runs between a commit and production, and nothing alerts
  anyone to a live failure.

## Success Criteria (Summary)

- A future agent editing dependencies is stopped from turning an adapter bump into an Astro major, and
  a future agent reading `infrastructure.md` learns the real plan rather than the recommended one.
- The intended EU region is recorded in the repo, with its actual effect on the current plan written
  down as an observed fact — so F-04's latency measurement is interpretable.
- A host can prepare for a live session from a checklist, using a logs command that has been proven to
  work on this project rather than copied from research.
