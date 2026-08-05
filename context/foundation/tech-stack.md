---
# ⚠️ BROWNFIELD — DO NOT RUN /10x-bootstrapper AGAINST THIS FILE.
# This project already exists (28+ commits, live in production). This file was written by hand to
# give downstream skills (/10x-roadmap, /10x-infra-research) the contract they expect; it is NOT the
# output of /10x-tech-stack-selector, which is greenfield-only. Scaffolding a starter into this
# repository would be destructive. `starter_id` below identifies what the project IS, not what to
# create.
starter_id: astro                 # registry key describing the existing stack; NOT a scaffold instruction
package_manager: bun              # DEVIATION: the `astro` card prescribes `npm`. This repo actually uses
                                  # bun (bun.lock is the only lockfile). The schema's "match the card"
                                  # rule exists so bootstrapper invokes the right CLI — irrelevant here,
                                  # since bootstrapping is forbidden. Recording the truth instead.
project_name: ai-community-szn    # the actual repository/directory name. package.json still says
                                  # "bizarre-bar", a leftover that does not match anything else.
hints:
  language_family: js
  team_size: solo
  deployment_target: vercel       # in the card's deployment_defaults; confirmed by infrastructure.md
  ci_provider: github-actions     # schema default — NO CI exists in this repo today
  ci_default_flow: auto-deploy-on-merge   # matches reality: push to main → Vercel builds and deploys
  bootstrapper_confidence: verified       # copied verbatim from the card, per schema. Describes the
                                          # starter's scaffolding maturity — NOT permission to scaffold.
  path_taken: custom
  quality_override: false         # no agent-friendly gate failed for the stack itself; see stack-assessment.md
  self_check_answers:             # inferred from stack-assessment.md + health-check.md evidence,
                                  # not gathered via the residual interview's self-check questions
    typed: true                   # tsconfig extends astro/tsconfigs/strict; Zod schemas at content boundary
    from_official_starter: false  # hand-rolled Astro project, not scaffolded from a vetted starter
    conventions: true             # on-disk layout matches Astro conventions; now documented in CLAUDE.md
    docs_current: true            # Astro publishes current, versioned docs
    can_judge_agent: true         # INFERRED — not asked; revise if wrong
  has_auth: false                 # PRD: no accounts, no sign-in; host view deliberately unprotected
  has_payments: false
  has_realtime: true              # the core of the LiveQuiz change; carried by Ably per infrastructure.md
  has_ai: false                   # the quiz is about AI; no LLM or embedding feature is in scope
  has_background_jobs: false
---

## Why this stack

This stack was not selected — it was inherited and then audited. The existing site is a plain Astro 6
project with strict TypeScript and Zod-validated content collections on bun, server-rendered on Vercel
with its four content routes prerendered. Stack assessment scored it 7 of 9 applicable agent-friendly
evaluations; both failures concerned the absent test runner, since remediated with Vitest and
`astro check`, and no gate failed for the stack itself, so `quality_override` is false. Infrastructure
research confirmed Vercel as the deployment target and added Ably as a managed realtime layer, because
LiveQuiz needs sub-second fan-out to roughly 150 participants while Vercel's native WebSockets are
public beta and cap connection duration below one 15-minute session — hence `has_realtime: true` while
`has_auth` stays false, matching the PRD's no-accounts decision. Worth recording the registry card's
own gotcha: Astro is content-first and explicitly "not a SPA", which is the standing tension in
bolting a live interactive quiz onto it. Vercel Pro is a prerequisite rather than an upgrade: the Hobby
plan forbids commercial use and this site carries sponsor branding.
