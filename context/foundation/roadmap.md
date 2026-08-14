---
project: "LiveQuiz"
version: 3
status: draft
created: 2026-08-05
updated: 2026-08-14
prd_version: 1
main_goal: quality
top_blocker: decisions
---

# Roadmap: LiveQuiz

> Derived from `context/foundation/prd.md` (v1) + `context/foundation/tech-stack.md` +
> `context/foundation/infrastructure.md` + a probed codebase baseline.
> v1 is at `context/foundation/archive/2026-08-05-roadmap.md`; it predates the stack and
> infrastructure decisions, and the diff is where those decisions show up.
> v3 records the session-state store decision (Upstash Redis) and a running-cost ceiling, closing the
> last blocking unknown; no slice sequencing changed.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Running a live quiz segment during a Brave AI Community Szczecin meetup currently means renting
Kahoot or Mentimeter — paid, account-gated, and wrapped in a builder wizard the organizers do not
need, since the quiz is defined once, by developers, in a file. LiveQuiz replaces that: the host
drives a community-branded quiz from the large screen while ~150 attendees play on the phones they
arrived with, and nothing about who played survives the evening.

The product's distinguishing trait — the one thing that, if removed, would make it indistinguishable
from the incumbents — is that the quiz is authored as source alongside the site and the session runs
on infrastructure the community controls, with no account for anybody.

## North star

**S-03: Attendee answers a choice question and learns their result at the host's reveal** — this is
the first moment at which both user stories are simultaneously true: the host is driving the room and
an attendee is scoring on their own device.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove that
> the product works at all. It is placed as early as its prerequisites allow, because everything
> after it only matters if this works.

## At a glance

| ID    | Change ID                             | Outcome (user can …)                                                                  | Prerequisites | PRD refs                                                                  | Status   |
| ----- | ------------------------------------- | ------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------- | -------- |
| F-01  | `deployment-target-readiness`         | (foundation) the deployment target may legally and physically host a live session      | —             | Success Criteria guardrail (1s fan-out), Constraints (released cost constraint) | done     |
| F-02  | `session-state-and-realtime-spine`    | (foundation) one session's state is server-authoritative and reaches devices in under 1s | F-01        | Success Criteria guardrails (1s fan-out, 150 concurrent), Open Question 7  | done     |
| F-03  | `session-end-and-data-purge`          | (foundation) a session can be ended and its attendee data is gone afterwards           | F-02          | Success Criteria guardrail (retention), Access Control Changes            | done     |
| F-04  | `room-scale-rehearsal-harness`        | (foundation) the spine can be driven by ~150 simulated devices and measured            | F-02          | Success Criteria guardrails (1s fan-out, 150 concurrent)                  | done     |
| S-01  | `quiz-definition-and-validation`      | Organizer can author the whole quiz in a file and have it rejected if malformed        | —             | FR-001, FR-017                                                            | done     |
| S-02  | `join-and-follow-host`                | Attendee can join a started session by name and see the host's current question        | S-01, F-02    | US-01, US-02, FR-002, FR-003, FR-007, FR-008                              | done     |
| S-03  | `answer-choice-question-and-reveal`   | Attendee can answer a choice question and see if they were right and what they scored  | S-02          | US-01, US-02, FR-004, FR-010, FR-016, FR-019                              | done     |
| S-04  | `host-participation-and-distribution` | Host can show the room how many have answered, then the distribution at reveal         | S-03          | US-02, FR-005                                                             | done     |
| S-05  | `free-text-answers`                   | Attendee can answer a free-text question without being punished for diacritics         | S-03          | US-01, FR-011                                                             | done     |
| S-06  | `guess-the-number-answers`            | Attendee can guess a number and score by how close they were                           | S-03          | US-01, FR-013                                                             | done     |
| S-07  | `leaderboard-beat`                    | Host can show the leaderboard between questions, and attendees can find themselves on it | S-03        | US-01, US-02, FR-014                                                      | done     |
| S-08  | `word-cloud-question`                 | Attendee can submit one word and watch the cloud fill on the large screen               | S-03          | US-01, US-02, FR-012, FR-015                                              | done     |
| S-09  | `resilient-join`                      | Attendee can reload or unlock their phone and resume as the same player                 | S-02          | US-01, FR-009, FR-018                                                     | done     |
| S-10  | `final-winner-reveal`                 | Host can close the session with a winner-reveal sequence                                | S-07          | US-02, FR-006                                                             | done     |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the
dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                                                                         | Note                                                                                                                                   |
| ------ | ------------------------------ | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Quiz content                   | `S-01`                                                                        | Standalone — no foundation prerequisite and no dependency on the open store decision. One of two items currently `ready`.               |
| B      | Platform & session spine       | `F-01` → `F-02` → `F-04`                                                      | `F-01` is a plan-and-region change with no code risk; `F-02` is the gate for everything realtime; `F-04` proves the 150-device guardrail before feature work rides on it — the `quality` bias. |
| C      | Privacy & session lifecycle    | `F-03`                                                                        | Joins Stream B at `F-02`. Must land before any real session collects real names.                                                        |
| D      | The live loop                  | `S-02` → `S-03` → `S-04` / `S-07` → `S-10`, with `S-09` parallel after `S-02` | Joins Stream A and Stream B at `S-02`, which needs both `S-01` and `F-02`. Contains the north star `S-03`.                              |
| E      | Question mechanics             | `S-05` / `S-06` / `S-08` (all parallel after `S-03`)                           | Joins Stream D at `S-03`. Three independent mechanics — three agent runs can fan out here.                                              |

## Baseline

What's already in place as of `2026-08-05` — probed in the codebase, and short-circuited by
`tech-stack.md` / `infrastructure.md` where those record a decision. Foundations below assume these
and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.4 with Tailwind CSS 4 via `@tailwindcss/vite`, seven components and
  a shared layout (`astro.config.ts`, `src/components/`, `src/layouts/BaseLayout.astro`).
  **Gap:** no UI-framework integration is installed (no React / Svelte / Vue), and `tech-stack.md`
  records the registry card's own gotcha that Astro is content-first and explicitly "not a SPA". How
  the two interactive views get their client behaviour is an open question, not a settled baseline.
- **Backend / API:** partial — `output: "server"` with the Vercel adapter means an on-demand
  serverless surface already exists, and two POST handlers run on it (`src/pages/api/`). No realtime
  transport and no server-held state exist yet.
- **Data:** absent, and per `infrastructure.md` **no relational database is required** — Ably needs
  none. Content collections are the CMS (`src/content.config.ts`); newsletter subscribers live in an
  external audience (`src/lib/newsletter.ts`). Authoritative session state will live in **Upstash
  Redis** with short TTLs, provisioned through the Vercel Marketplace in the EU region matching the
  function region from F-01 (decided 2026-08-05 — see Open Roadmap Question 1). Not yet present in the
  repository.
- **Realtime:** per `infrastructure.md` and `tech-stack.md` (`has_realtime: true`): **Ably**, GA,
  within its free tier at this scale (200 peak connections, 6M messages/month). Vercel's native
  WebSockets were rejected — public beta, and the connection-duration cap is shorter than one
  15-minute session. Not yet present in the repository (`ably` is not a dependency).
- **Auth:** absent by design — `tech-stack.md` records `has_auth: false`, matching the PRD's
  no-accounts decision and its deliberately unprotected host view. **Not** a Foundations gap.
- **Deploy / infra:** per `infrastructure.md`: **stay on Vercel**, push-to-`main` auto-deploy, Node
  floor 22.12, adapter pinned to the `^10` line. ~~Two deltas are outstanding and land in F-01: the Pro
  upgrade and the `fra1` region.~~ **Updated 2026-08-06 (F-01 delivered):** the adapter is at 10.0.8
  within `^10` with the boundary rule recorded in `CLAUDE.md`, and `vercel.json` declares
  `regions: ["fra1"]` — confirmed working **on the Hobby plan**, which `infrastructure.md` had wrongly
  said required Pro. The **Pro upgrade is deferred** by user decision, so ~1-hour log retention and the
  Hobby non-commercial restriction are live accepted risks with a tripwire. Production only moves to
  `fra1` once the region key reaches `main`. No `.github/`, so still no CI and no pre-deploy gate.
- **Testing:** present — `vitest` with a `test` script, `astro check` for types, one existing suite
  (`src/lib/newsletter.test.ts`). No test-infrastructure foundation is needed.
- **Quiz definition:** present as of S-01 — the 14-question quiz lives at `src/quiz/definition.ts` as
  a typed literal validated by a Zod schema (`src/quiz/schema.ts`), with domain invariants enforced as
  refinements. **S-02 through S-08 read it through `src/quiz/index.ts`** (`quiz`, `getQuestionById`,
  and the exported types) and must not import `definition.ts` directly or re-parse. Deliberately not a
  content collection — `astro:content` does not resolve in vitest or in a serverless function; see
  CLAUDE.md. `points: null` marks an unscored question (FR-017); scoring rules themselves are S-03's
  and S-06's. A malformed definition fails `astro build` via the `quiz-definition-gate` integration,
  so it cannot deploy.
  **Updated 2026-08-09 (S-05 delivered):** `src/quiz/normalize.ts` now carries **two** folds, and the
  distinction is load-bearing. `normalizeAnswer` (case, spacing, diacritics, trailing punctuation) is
  the FR-011 answer fold, shared by `scoreTextAnswer` and by the build-time accepted-variant collision
  check so the two cannot drift. `normalizePolish` (the same minus punctuation) is the **display-name
  claim key** in `src/lib/session/players.ts` and must keep punctuation — `.` is a legal name
  character and the stored keys were written with it, so merging the two would let two visually
  identical names onto the leaderboard mid-deploy. S-06 extends the answer fold's *scorer*, not the
  name fold. For a text question, `acceptedAnswers[0]` is the variant published to the room.
  **Updated 2026-08-09 (S-06 delivered):** scoring is no longer all-or-nothing. `scoring.ts` carries
  a banded relative-error curve (`CLOSENESS_BANDS`) multiplied by the same `speedWeight`, so a guess
  can earn part of a question's points — and `AnswerRecord.correct` is **exact-hit-only** for a
  number question, therefore `false` on an answer that scored 800 of 1000. No consumer may read that
  flag as "scored nothing"; S-07's leaderboard is the most likely place to get this wrong. The schema
  now also refuses `correctValue: 0` at the build gate, because the rule divides by the true value.

  **Updated 2026-08-11 (S-07 delivered):** the session document now carries a fifth transition field,
  `standings` — at most five `{ rank, displayName, points }` rows — and it is the **first snapshot field
  in the project to carry attendee display names.** S-02's "no display name is ever published" is true
  about S-02 and false from here; the reversal, its bound and its real exposure surface (the open
  `GET /api/quiz/state`, not Ably's ~120 s floor) are recorded in the PRD's Deviation 2 and in
  `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`. **S-08 and S-10 must read that contract
  before adding a snapshot field or a phase.** Two rules from it that are easy to break by accident:
  the `standings` phase deliberately keeps `currentQuestionId` (questionless, `advance` would reopen
  question 1), and row *order* and rank *number* are computed by different rules on purpose — merging
  them makes a tied attendee's phone contradict the projector. **S-10 inherits the board for the `ended`
  phase**, which this slice deliberately did not build; `result.ts`'s `ended` branch still serves the
  running total alone.
- **Observability:** absent — `src/lib/slack.ts` is an outbound notification webhook, not error
  tracking. No alerting; `infrastructure.md` rates "a failure is discovered by attendees" as
  high-likelihood, high-impact.

## Foundations

### F-01: Deployment target readiness

- **Outcome:** (foundation) the deployment target is a known quantity before realtime work rides on it:
  the adapter cannot silently pull an Astro major, functions run in the EU region closest to the room,
  and the logs/rollback loop F-04 depends on has been exercised. **Revised 2026-08-06** — the original
  outcome also promised "may legally host a sponsor-branded live session" and "retains logs long enough
  to diagnose a failed event". Both were framed as consequences of a Vercel Pro upgrade, which the user
  deferred (free local community initiative); they are now accepted risks with a tripwire, not delivered
  outcomes. The EU region *was* delivered — and without Pro, contrary to `infrastructure.md`'s original
  claim. See `context/changes/deployment-target-readiness/`.
- **Change ID:** `deployment-target-readiness`
- **PRD refs:** Success Criteria guardrail (every attendee's screen reflects the host within 1 second),
  Constraints & Compatibility (released cost constraint — metered cost is now permissible), Known
  operational gap
- **Unlocks:** F-02 and F-04 — the fan-out budget cannot be measured honestly from a
  transatlantic region, and a rehearsal whose logs vanish in an hour proves little; also removes the
  licensing risk that could pause the whole site (taking the event archive, speaker directory and
  newsletter endpoint down with it).
  **Updated 2026-08-06:** the transatlantic half is delivered — functions run in `fra1`. The other two
  are *not*: log retention stays ~1 hour and the licensing risk is accepted rather than removed, because
  the Pro upgrade was deferred. F-04 is unblocked on region but must still tail logs live rather than
  retrieve them.
- **Prerequisites:** —
- **Parallel with:** S-01
- **Blockers:** ~~the plan upgrade is a paid, human-only action — an agent cannot complete it.~~
  **Cleared 2026-08-06** — the Pro upgrade was deferred by user decision, so no paid step remains in this
  item. One human-only step did surface in practice: `vercel login` is interactive, so the preview-deploy
  verification needed a human to authenticate the CLI once.
- **Unknowns:** ~~What is the acceptable monthly running-cost ceiling?~~ — **Resolved: $30/month as a
  review threshold** (Open Roadmap Question 4). The known floor is $20/seat/month for the plan, with the
  realtime provider and the state store both inside their free tiers at this scale.
- **Risk:** Sequenced first because `infrastructure.md` says it changes the deployment target's
  constraints, so anything measured before it is measured under the wrong ones — and because the
  licensing exposure is not LiveQuiz's: the sponsor branding already sits on a plan restricted to
  non-commercial use, and a pause would take the event archive, speaker directory and newsletter
  endpoint down with the quiz. Two things here are settings rather than code and are easy to declare
  done without being done: the function region, and pinning the adapter to its current major so a
  routine update cannot drag in a framework major alongside feature work. Verify both against the
  deployed project rather than the repository.
- **Status:** done

### F-02: Session state and realtime fan-out spine

- **Outcome:** (foundation) one live session's state is held server-authoritatively in a short-TTL
  store outside the request lifecycle, and a state change made by the host reaches every connected
  device within a second — with devices receiving a short-lived token from the project's own endpoint
  rather than any provider key.
- **Change ID:** `session-state-and-realtime-spine`
- **PRD refs:** Success Criteria guardrails (1-second reflection; 150 concurrent with no lost answers
  and no divergence between devices), Open Question 7
- **Unlocks:** S-02 and therefore every slice after it; F-03 and F-04; resolves the last part of PRD
  Open Question 7.
- **Prerequisites:** F-01
- **Parallel with:** S-01
- **Blockers:** —
- **Decided (2026-08-05):** authoritative session state lives in **Upstash Redis** with short TTLs,
  provisioned through the Vercel Marketplace in the EU region matching F-01's function region. Chosen
  over Cloudflare Durable Objects because Durable Objects are reachable only through a Worker binding,
  which would mean standing up and maintaining a second platform, deploy pipeline and secret store
  alongside the one `infrastructure.md` just recommended keeping. See Open Roadmap Question 1 for the
  full rationale.
- **Unknowns:** —
- **Risk:** Sequenced first among the code foundations because every user-facing slice except S-01 sits
  on it. Three failure modes are already documented and must not be rediscovered live. First, putting
  authoritative scores in the browser — the transport carries messages, it is not the truth. Second,
  reaching for the *familiar* realtime option, whose free tier caps throughput at a rate a single
  broadcast to 150 clients exceeds by itself. Third, resolving a display-name claim with a
  read-then-write pair: with 150 devices joining in the same few seconds, the claim must be atomic in
  the store or two attendees get the same name and the leaderboard stops being unambiguous — the
  guarantee FR-008 exists to provide. The token endpoint must follow the existing `src/lib/slack.ts`
  pattern: missing configuration fails clearly instead of throwing into a request path.
- **Status:** done

### F-03: Session end and data purge

- **Outcome:** (foundation) a session can be explicitly ended, and afterwards no attendee display name
  or submitted answer remains in operator-accessible storage.
- **Change ID:** `session-end-and-data-purge`
- **PRD refs:** Success Criteria guardrail (post-session retention), Access Control Changes (identity
  within a session), Non-Goals (no result history, no post-session analytics)
- **Unlocks:** the retention guardrail that must hold before any slice from S-02 onward collects real
  names at a real event; gives F-04's rehearsals a clean teardown so repeated runs do not accumulate
  state.
- **Prerequisites:** F-02
- **Parallel with:** F-04, S-02, S-03
- **Blockers:** —
- **Unknowns:**
  - ~~Does an explicit end have to purge, or does the store's own expiry satisfy the guardrail?~~ —
    **Answered by F-02's store choice.** Expiry is a per-key property in the chosen store, so the
    guardrail holds by default even if the host never ends the session — which is a realistic stage
    scenario. This foundation therefore shrinks to setting the right lifetimes plus an explicit
    end-now path for a host who wants the room's data gone immediately.
    **Delivered as both (2026-08-06):** `end` shortens every registered key to ~10 minutes so a
    reload can still show the final standings, and `purge` deletes immediately for a host who does
    not want that window.
  - **The "shrinks to" framing was wrong, and the probe is what showed it.** The reasoning above
    considered only Redis. Ably receives the entire session state on every host action and retains it
    for ~2 minutes regardless of the persistence setting, and the log stream is covered by no TTL at
    all — three surfaces, not one.
- **Risk:** Cheap while the store is young and expensive once four question mechanics write to it, so
  it is sequenced with the spine rather than after the features. Its own failure mode is a purge firing
  on a session the host did not mean to end, wiping a live leaderboard mid-segment. Note that a
  code rollback does not revert anything already held in the realtime provider — purge must not be
  something rollback is expected to undo.
- **Status:** done

### F-04: Room-scale rehearsal harness

- **Outcome:** (foundation) roughly 150 simulated devices can be driven through a session against the
  real spine, with fan-out latency and answer loss observed rather than assumed.
- **Change ID:** `room-scale-rehearsal-harness`
- **PRD refs:** Success Criteria guardrails (1-second reflection; 150 concurrent with no lost answers),
  Known operational gap ("nothing exists today that would alert anyone to such a failure")
- **Unlocks:** the named verification path for the two binding engineering guardrails, required before
  S-02 through S-08 can be trusted in front of a room; measures the actual EU-region propagation that
  `infrastructure.md` says must be measured rather than relied upon; exercises the provider's
  connection ceiling while there is still time to react to it.
- **Prerequisites:** F-02
- **Parallel with:** F-03, S-02
- **Blockers:** —
- **Teardown (added 2026-08-06, F-03):** repeated rehearsal runs now have a sanctioned reset —
  `POST /api/quiz/host/purge` removes every registered key, so runs do not accumulate state.
  `scripts/check-purge-residue.ts` confirms the namespace is empty and **refuses to run while any
  session document exists**, which doubles as a pre-rehearsal check. Note the purge route requires
  the session's current version as confirmation, so a harness driving it must read state first.
- **Unknowns:**
  - Is a rehearsal against production acceptable, or must it run against a preview deployment? ~~Preview
    URLs are publicly reachable~~ and fork builds get no environment variables, both of which constrain
    the answer. — Owner: user. Block: no.
    **Corrected 2026-08-06 (F-01):** preview URLs on this project are **not** publicly reachable — Vercel
    Authentication returns `302` to Vercel SSO for anonymous visitors, so ~150 attendee devices could not
    reach a preview at all without authenticating. That pushes a real rehearsal toward production, or
    toward disabling protection for the rehearsal window.
  - **Which region is the latency measured from?** Functions now run in `fra1` (Frankfurt), not `iad1` —
    but only for builds made after the region key exists. Any figure taken from a production deployment
    predating that merge is measuring the old region and must not be recorded as the baseline. The
    resulting number is the input to F-01's upgrade tripwire, so record it *with* its region. — Owner:
    F-04. Block: no.
  - What attendance should the harness target? The provider's free ceiling is 200 peak connections, so
    150 leaves roughly a quarter in headroom and a fuller room needs a paid plan. — Owner: user, per
    event. Block: no.
  - Is a spend alert wired on the state store before the first rehearsal? A polling design instead of a
    push design would multiply store operations by roughly an order of magnitude per session — cheap in
    money, but the alert is the tripwire that catches the architectural mistake while it is still
    cheap. — Owner: user. Block: no.
- **Risk:** Exists because the chosen main goal is quality and both engineering guardrails are binding
  — a community meetup cannot be the first time 150 devices connect at once. Kept deliberately minimal:
  it drives the spine and reports latency and loss; it does not grow into a performance-testing suite.
  One documented trap belongs here: a naive presence-based design makes joining cost on the order of
  N² messages, so the harness should measure the broadcast path the product actually uses.
- **Status:** done

## Slices

### S-01: Quiz definition authored in the repository

- **Outcome:** Organizer can define the whole quiz — questions, types, accepted answers, true values,
  scoring flags — in a file authored alongside the project's source, and a malformed or incomplete
  definition is rejected loudly rather than discovered on stage.
- **Change ID:** `quiz-definition-and-validation`
- **PRD refs:** FR-001, FR-017
- **Prerequisites:** —
- **Parallel with:** F-01, F-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The only slice with no dependency on the spine or on the open store decision, so it is what
  can move while Open Roadmap Question 1 is still open. Its risk is over-designing the definition
  format for question types later slices will reshape — keep it to the four types the drafted
  14-question quiz actually uses. FR-001's accepted operational risk stands: only a developer can
  correct a question, including minutes before showtime. The project already validates content at its
  boundary with schemas and has a test runner, so this slice has somewhere to land.
- **Status:** done

### S-02: Attendee joins a live session and follows the host

- **Outcome:** Attendee can open the session link, enter an unused display name, and see the host's
  current question appear on their phone as the host starts the session and advances through it.
- **Change ID:** `join-and-follow-host`
- **PRD refs:** US-01, US-02, FR-002, FR-003, FR-007, FR-008
- **Prerequisites:** S-01, F-02
- **Parallel with:** F-03, F-04
- **Blockers:** —
- **Unknowns:** _both answered 2026-08-08._
  - ~~How do the two interactive views get their client behaviour?~~ **Answered: vanilla TypeScript
    modules in `src/lib/client/` plus `define:vars`, no framework.** See Open Roadmap Question 2 for
    the reasoning and the accepted cost to S-07/S-08.
  - ~~Is the 30-second join target met when 150 devices join in a burst?~~ **Answered, with stated
    limits.** Three N=150 runs against production: the burst completes in **1.24–1.65 s**, 4–6% of
    FR-002's budget, with 150/150 claims accepted and zero duplicate folded names across 450
    concurrent claims. See `context/archive/2026-08-07-join-and-follow-host/join-burst-report.md`.

    **It is a lower bound, not a venue simulation** — one process on one network, measuring the claim
    round trip and not a phone painting a screen. Paint time remains unmeasured anywhere and was
    deliberately left out of scope. The target is therefore *informed* by this figure, not proven by
    it; the 20× margin is what makes the gap tolerable rather than closing it.
- **Risk:** The first slice where the spine meets real devices, so it is where a wrong spine decision
  surfaces. The store decision reaches directly into this slice's correctness in one place: the
  display-name claim must be atomic in the store rather than a read-then-write pair, or 150 near-
  simultaneous joins will hand two attendees the same name (F-02 records why). Deliberately excludes answering: a room that is merely connected and following the host is
  already a demonstrable, testable state, and separating it keeps the north star tractable.
  Name-collision rejection sits here rather than later because it is part of the same join flow the
  30-second target covers. The client-interactivity choice made here is the most consequential
  unstated decision in the roadmap — it is where the "not a SPA" tension gets resolved in practice.

  **Retired 2026-08-08.** The atomicity risk was the one worth naming and it held: 450 concurrent
  claims across three N=150 runs produced zero duplicate folded names, and the collision probe
  (case + diacritics + spacing at once) was refused 5/5 every run. The claim is a single Lua `EVAL`,
  as F-02 required.
- **Status:** done

### S-03: Attendee answers a choice question and learns their result

- **Outcome:** Attendee can answer a single- or multiple-choice question on their phone and, when the
  host reveals it, see whether they were right and how many points they earned — including the speed
  component measured from when the question appeared on their own device.
- **Change ID:** `answer-choice-question-and-reveal`
- **PRD refs:** US-01, US-02, FR-004, FR-010, FR-016, FR-019
- **Prerequisites:** S-02
- **Parallel with:** F-03, F-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star, so it is placed as early as its prerequisites allow. It carries the
  project's first domain rule: all-or-nothing multi-answer scoring plus a speed weight measured per
  device rather than from the host's action. The trap is measuring speed from the host's advance, which
  would silently penalise slow connections and contradict the PRD's stated input. Getting the scoring
  rule right here means S-05, S-06 and S-08 add a mechanic rather than a second scoring model.

  **Retired 2026-08-08 — the named trap.** Speed is measured from the device's own first paint, and
  the timestamp is persisted per question in `localStorage`, so a reload mid-question keeps its
  original clock instead of restarting it at full speed weight. `speedWeight` is exported on its own
  and applies to every scored answer regardless of kind, so S-05 and S-06 add a correctness function
  beside `scoreChoiceAnswer` rather than a second scoring model.

  **Restated, and larger than the original risk.** Answering is the first path that scales with
  attendees × questions: a real event moves from ~1,600 store commands to **~27,000**, and ten events
  a month reach ~54% of the documented 500K ceiling, up from ~1%. The runbook's per-run tripwire is
  unchanged and is not approached; its margin fell from ~125× to ~7×. Not a blocker, and no longer
  noise — S-04, S-07 and S-08 each add per-attendee paths on top of this one, so the next slice to
  raise it should say so deliberately. See `answer-cost-report.md` and `answer-contract.md`.
- **Status:** done

### S-04: Host shows participation, then the distribution

- **Outcome:** Host can display on the large screen how many attendees have answered the open question,
  and the distribution of what they chose once the question is revealed.
- **Change ID:** `host-participation-and-distribution`
- **PRD refs:** US-02, FR-005
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The FR was revised during shaping precisely because showing the distribution while a
  question is open turns the large screen into a cheat sheet. The implementation risk is leaking that
  data to the host view early — the count and the distribution must be two different payloads, not one
  payload rendered differently. Legibility from the back of the room is a real constraint here.
- **Status:** done

### S-05: Attendee answers a free-text question

- **Outcome:** Attendee can type a free-text answer and have it judged correct if it matches any
  accepted variant, regardless of letter case, surrounding spaces, or Polish diacritics.
- **Change ID:** `free-text-answers`
- **PRD refs:** US-01, FR-011
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the other mechanics, so it can run as a separate agent pass. The scoping line
  matters: normalisation stops at case, spacing and diacritics and deliberately does not tolerate
  misspellings, because a fuzzy threshold is something the host would have to defend out loud in front
  of the room.
- **Status:** done

### S-06: Attendee guesses a number

- **Outcome:** Attendee can submit a numeric guess and earn points scaled by how close it was, on the
  same relative-error rule whether the true answer is 67 or 10,000.
- **Change ID:** `guess-the-number-answers`
- **PRD refs:** US-01, FR-013
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the other mechanics. The rule is magnitude-independent by design so one rule
  covers both drafted questions; the risk is an award curve that hands almost-full points to a wild
  guess, which would quietly flatten the leaderboard the whole segment builds toward.
- **Status:** done

### S-07: Host shows the leaderboard between questions

- **Outcome:** Host can choose to show the standings between questions, and every attendee can locate
  themselves on a leaderboard that matches what the room sees on the large screen.
- **Change ID:** `leaderboard-beat`
- **PRD refs:** US-01, US-02, FR-014
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The guardrail this slice can violate is the one about no divergence in standings between
  devices — two attendees seeing different rankings at the same moment is more damaging on stage than a
  slow update. `infrastructure.md` names the concrete trap: do not build the leaderboard on the
  transport's presence feature, whose join cost scales quadratically with room size; broadcast the
  standings from the authoritative state instead. Sequenced after the north star because a leaderboard
  needs scored answers to rank, and it is a host-controlled beat rather than an automatic one so the
  segment stays short.
- **Status:** done — delivered 2026-08-11. The transport risk above held: the board is computed once
  server-side and broadcast, so no device sorts and presence is not involved. See
  `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`.

### S-08: Word-cloud question

- **Outcome:** Attendee can submit a single word to an unscored word-cloud question and watch the
  aggregate visibly fill on the large screen as the room answers.
- **Change ID:** `word-cloud-question`
- **PRD refs:** US-01, US-02, FR-012, FR-015
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-06, S-07, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The PRD calls this the most expensive view in the set, built for a single question, and
  accepted that cost because watching your own word appear is what proves the session is live. It is
  the only view that pushes updates continuously rather than on host action, so it is the mechanic most
  likely to strain the spine and the message allowance — worth running after F-04 has measured the
  headroom. Word-cloud submissions reach the projector unmoderated by explicit decision.
- **Status:** done — **delivered 2026-08-14.** The risk above was resolved by keeping the cloud **off
  the snapshot entirely**: it reaches the projector through a host-secret-gated poll of
  `GET /api/quiz/host/words` on one device, so nothing about it touches the Ably message allowance and
  the spine was never the constraint. No `SessionState` field, no phase, no new store key — the counters
  are a third field family in `livequiz:tallies`, and the increment rides the existing submission script
  below its `HSETNX`, so a duplicate tap cannot double-count. **The residual risk is unmeasured rather
  than absent**: following the boundary S-07 drew, no room-scale rehearsal was re-run, so the top-30
  truncation and the `HGETALL` payload at ~150 distinct words are untested at scale. See
  `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md`.

### S-09: Join survives a real room

- **Outcome:** Attendee can reload the page or unlock their phone and resume as the same player with
  their score intact, and a single device cannot register an unreasonable number of players.
- **Change ID:** `resilient-join`
- **PRD refs:** US-01, FR-009, FR-018
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - ~~How many players from one device is "unreasonable", given a venue network can put many attendees
    behind one address and handsets do get shared?~~ — **RESOLVED 2026-08-14: three, cumulative,
    never decremented.** It covers the honest shared-handset cases (a couple, a parent and child, one
    lent phone) while making farming tedious. Two would refuse a lent handset on the first try, which
    lands the refusal on someone who did nothing wrong; five is already enough fake players to
    distort a board in a room of 150. The number buys friction rather than prevention — which is what
    FR-018 asks for. The venue-NAT half of the question is answered by *not* keying on IP at all: the
    device identifies itself with an id it mints and stores, so a shared address is irrelevant and
    the cost lands instead on a genuinely shared handset. Original question kept struck through per
    this file's convention.
- **Risk:** Both halves are device-scoped identity pulling in opposite directions: resume needs the
  device remembered, the flood guard needs the device counted. The PRD accepts that a borrowed handset
  inherits someone else's player, and that the guard is lightweight and defeatable by design. A screen
  lock during a 15-minute segment is near-certain, so this is not optional polish. Resume also has to
  survive the spine's own reconnects, not just a manual reload.
- **Status:** done

  **Delivered 2026-08-14.** Resume turned out to be ~80% built already — S-02 shipped the identity
  handshake and S-03 the persisted paint times and submitted flag — so the slice was mostly the cap
  plus two honest gaps: the running total was invisible after a mid-question reload, and a device
  whose storage is unavailable met a bare "name taken" with nowhere to go.

  **The exemption is the part S-10 must not undo:** the cap governs the claim path and never the
  resume path, or a phone that registered three players and then locked its screen loses a score it
  had already earned. Read
  `context/archive/2026-08-14-resilient-join/resume-contract.md` before adding anything that refuses a request.

  **One limit stated rather than left to be found:** the redis client is mocked in the suite, so the
  Lua cap never executes in any test. Its two orderings are pinned as structural properties of the
  script text — `host.test.ts`'s position — and the behaviour rests on the runbook's live two-device
  check. Following the boundary S-07 and S-08 drew, no room-scale rehearsal was re-run: both halves
  are per-device properties rather than concurrency ones.

### S-10: Final winner reveal

- **Outcome:** Host can trigger a closing winner-reveal sequence that ends the segment on the
  leaderboard.
- **Change ID:** `final-winner-reveal`
- **PRD refs:** US-02, FR-006
- **Prerequisites:** S-07
- **Parallel with:** S-04, S-05, S-06, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The only nice-to-have in the PRD and the last item sequenced, so it is the natural cut if
  effort runs out — a session can end on the plain leaderboard from S-07 without failing any success
  criterion. The drafted quiz ends in a leaderboard reveal, so the plain path is already sufficient.
- **Status:** done — delivered 2026-08-14, `context/archive/2026-08-14-final-winner-reveal/`

## Backlog Handoff

| Roadmap ID | Change ID                             | Suggested issue title                                              | Ready for `/10x-plan` | Notes                                                        |
| ---------- | ------------------------------------- | ------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------ |
| F-01       | `deployment-target-readiness`         | Make the deployment target session-ready: plan, EU region, adapter | yes                   | Run `/10x-plan deployment-target-readiness`. Paid step is human-only |
| S-01       | `quiz-definition-and-validation`      | Author the quiz as a validated in-repo definition                  | yes                   | Run `/10x-plan quiz-definition-and-validation`                |
| F-02       | `session-state-and-realtime-spine`    | Server-authoritative session state with sub-second fan-out         | no                    | Needs F-01 only — no blocking unknown left. Name claim must be atomic |
| F-03       | `session-end-and-data-purge`          | End a session and purge attendee names and answers                 | done                  | **Delivered 2026-08-06.** S-02/S-03/S-07 must read `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` before adding any key or snapshot field |
| F-04       | `room-scale-rehearsal-harness`        | Drive ~150 simulated devices through a session and measure         | no                    | Needs F-02                                                    |
| S-02       | `join-and-follow-host`                | Join a session by display name and follow the host's question      | done                  | **Delivered 2026-08-08.** Settled the client-interactivity approach (Question 2) — S-03/S-07/S-08 must read `context/archive/2026-08-07-join-and-follow-host/join-contract.md` |
| S-03       | `answer-choice-question-and-reveal`   | Answer a choice question and see result and points at reveal       | no                    | North star. Needs S-02                                        |
| S-04       | `host-participation-and-distribution` | Large screen: answer count while open, distribution at reveal      | no                    | Needs S-03                                                    |
| S-05       | `free-text-answers`                   | Free-text answers matched ignoring case, spacing and diacritics    | no                    | Needs S-03                                                    |
| S-06       | `guess-the-number-answers`            | Numeric guesses scored by relative error                           | done                  | **Delivered 2026-08-09.** First partial-credit answer: `AnswerRecord.correct` is exact-hit-only for this kind |
| S-07       | `leaderboard-beat`                    | Host-controlled leaderboard between questions                      | done                  | **Delivered 2026-08-11.** First snapshot field carrying display names — S-08/S-10 must read `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md` before adding a snapshot field or a phase |
| S-08       | `word-cloud-question`                 | Unscored word-cloud question with a live-filling large-screen view | done                  | **Delivered 2026-08-14.** The one aggregate that does NOT ride the snapshot — a host-side poll of `/api/quiz/host/words`, because a continuously-filling display has no host action to attach to and 150-way fan-out would exceed Ably's 100 msg/s ceiling. Added the project's **third fold** (`foldWord`, keeps diacritics because its output is rendered) and a third `livequiz:tallies` field family, which stopped that key being counters-only. **S-09/S-10 must read `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md` before adding any continuously-updating display** |
| S-09       | `resilient-join`                      | Same-device resume plus per-device player cap                      | done                  | **Delivered 2026-08-14.** Cap is 3 per device, cumulative, enforced inside `CLAIM_PLAYER`; the resume path is exempt and that exemption is the slice. Added `livequiz:devices` (a count, the one registered key that is not attendee data) and a third browser-storage key. **S-10 must read `context/archive/2026-08-14-resilient-join/resume-contract.md` before adding anything that refuses a request** |
| S-10       | `final-winner-reveal`                 | Closing winner-reveal sequence                                     | done                  | **Delivered 2026-08-14.** The `ended` phase carries the S-07 board and `end` moved onto the host view behind a two-tap confirmation — the first reversal of an F-03 placement decision. Read `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md` before touching the `ended` phase or the closing screen |

## Open Roadmap Questions

1. **~~Which short-TTL store holds authoritative session state?~~ — RESOLVED 2026-08-05: Upstash
   Redis**, provisioned through the Vercel Marketplace in the EU region matching F-01's function
   region. This closes the last part of PRD Open Question 7. Three reasons decided it: it speaks HTTP,
   so a serverless function needs no persistent connection; per-key expiry makes the post-session
   retention guardrail the default rather than a mechanism to build (see F-03); and it offers atomic
   claim-if-absent and ordered-set operations, which are exactly the two primitives FR-008 (unique
   display names among 150 simultaneous joins) and FR-014 (a leaderboard that cannot diverge between
   devices) need. Cloudflare Durable Objects is the better *model* — single-threaded consistency per
   session, sockets included — but is reachable only through a Worker binding, so adopting it would
   mean running a second platform, deploy pipeline and secret store next to the one
   `infrastructure.md` recommended keeping, and would fold in a transport change that deserves its own
   decision. Revisit only if hosting itself moves. Vercel's first-party Global Config was checked and
   ruled out: it is read-optimised and not writable at answer-submission rate. Retained rather than
   deleted so the reasoning stays visible.
2. **~~How do the host and attendee views get their client behaviour?~~ — RESOLVED 2026-08-08 (S-02):
   vanilla TypeScript modules in `src/lib/client/`, imported by Astro `<script>` tags, with
   `define:vars` as the server→client handoff. No UI framework, and none should be added.** The
   original text is kept below rather than deleted, per this file's convention.

   Three reasons decided it. It was already proven end to end — `spine-check.astro` implemented the
   whole spine-contract client rule in a plain `<script>` before S-02 existed. It keeps the client
   bundle to essentially the Ably SDK (measured at build: 211 KB of SDK against ~7 KB of project
   code), which matters because the venue network is the one link nobody controls and the join target
   had never been measured. And it does not fight the framework: `tech-stack.md` records that the
   stack is content-first and explicitly "not a SPA", so adding an integration for two views would
   have been the larger deviation.

   **The accepted cost, recorded so a later slice can reverse this knowingly rather than discover
   it:** S-07's leaderboard and S-08's continuously-updating word cloud will be hand-written DOM
   updates with no diffing. If either turns out to need a framework, this is the decision to revisit —
   and reversing it is a slice's worth of work, not a line.

   Two gates enforce the boundary rather than leaving it to discipline: `boundary.test.ts` fails the
   suite if a client module or an Astro `<script>` block reads `import.meta.env` or *value*-imports
   `src/quiz/` or `src/lib/session/`, and `keys.test.ts` now scans `src/lib/client/` too.

   > _Original text:_ No UI-framework integration is installed and `tech-stack.md` records that the
   > framework is content-first and explicitly "not a SPA". S-02 is the first slice that needs an
   > answer and the answer shapes every view after it. Owner: `/10x-plan` on S-02. Block: no.
3. **Does the live blast radius justify CI and live-session alerting?** — Forwarded from
   `shape-notes.md` and now sharpened by `infrastructure.md`'s risk register, which rates "no CI gate
   between commit and production" high-likelihood and "a failure is discovered by attendees"
   high-likelihood/high-impact. Test and type-check scripts now exist locally but nothing runs them
   between a commit and production. F-04 covers rehearsal, not production visibility. The register's
   own minimum is operational rather than technical: have the host open the attendee view on a second
   device before starting. Owner: user. Block: roadmap-wide (advisory — no slice is held on it).
   **Partially discharged 2026-08-06 (F-01):** the operational minimum now exists as
   `docs/runbook-live-session.md` — a pre-session checklist covering the live log tail, the second
   device, and a tripwire re-read. CI is still absent and still out of scope; this question now reduces to
   CI alone.
4. **~~What is the acceptable running-cost ceiling?~~ — RESOLVED 2026-08-05: $30/month as a review
   threshold.** **Updated 2026-08-06 (F-01):** actual recurring spend is **$0** — the Pro upgrade was
   deferred and the project stays on Hobby, so the $20/seat line below is not currently owed. The $30
   threshold stands as the review trigger if that changes.
   Below it, no deliberation; above it, either the architecture is wrong or the room grew
   — both are decisions to take deliberately rather than discover on an invoice. This closes PRD Open
   Question 3. The costed picture: the platform plan is the only recurring line at $20/seat/month, and
   it is owed for the sponsor branding regardless of whether LiveQuiz ships, so LiveQuiz's own marginal
   cost is close to zero. Both the realtime provider (200 peak connections, 6M messages/month) and the
   state store (500K commands/month, 256 MB) sit inside their free tiers at this scale: a 150-attendee,
   14-question session is on the order of 10–15K messages and 15–25K store operations, and beyond the
   free tier a session costs single-digit cents. The binding limits are technical, not financial — the
   200-connection ceiling (Question 5) and a polling-instead-of-pushing design (F-04's spend-alert
   unknown). Worth recording: the PRD released cost neutrality expecting its most expensive guardrail —
   150 concurrent devices within one second — to be what cost money, and it turned out to be absorbed
   by free tiers, while the real bill arrived from licensing.
5. **What attendance should be assumed per event?** — The realtime free tier caps at 200 peak
   connections, so the drafted 150 leaves about a quarter in headroom; this needs checking before each
   event rather than once. Owner: user. Block: no.
6. **How many weeks of work is full scope?** — The stack is now settled, which was the stated
   precondition for answering, so `timeline_budget.delivery_weeks` can finally be filled in. Owner:
   user. Block: no (mirrors PRD Open Question 2).
7. **Timeline cost was never acknowledged against a number.** — Full scope was kept with no effort
   expectation recorded, so there is nothing to measure actual effort against. Owner: user. Block: no
   (mirrors PRD Open Question 4).
8. **Preserved behavior is asserted rather than chosen.** — Nothing in the existing site was declared
   untouchable, so there is no tripwire if implementation starts reshaping it. Sharpened by
   `infrastructure.md`'s pre-mortem: a platform-level pause would take the event archive, speaker
   directory and newsletter endpoint down with LiveQuiz, which F-01 is what removes. Owner: user.
   Block: no (mirrors PRD Open Question 5).
9. **What partial-credit behavior applies if a future question has more than two correct options?** —
   All-or-nothing is settled for the drafted quiz. Owner: user. Block: no (mirrors PRD Open
   Question 6).

## Parked

- **Quiz builder, admin panel, question import/export** — Why parked: PRD §Non-Goals, load-bearing —
  avoiding the builder is the reason this is built rather than rented.
- **Accounts, result history, post-session analytics, reports, exports** — Why parked: PRD §Non-Goals;
  consistent with the retention guardrail F-03 enforces.
- **Parallel sessions and multiple quizzes** — Why parked: PRD §Non-Goals. One session, one quiz, one
  room; this removes session management from the change entirely.
- **Multimedia in questions** — Why parked: PRD §Non-Goals. Questions are text only.
- **Moderation of word-cloud submissions** — Why parked: PRD §Non-Goals; the reputational risk of an
  unreviewed word on a projector was surfaced and accepted.
- **Cost-neutrality guarantee** — Why parked: PRD §Non-Goals; released in favour of keeping the
  150-concurrent and one-second guardrails binding. `infrastructure.md` turns that release into a
  concrete prerequisite in F-01.
- **Score multipliers and streak bonuses** — Why parked: PRD §Non-Goals. Only the time-bonus half of
  the original advanced-scoring non-goal was reversed (FR-019).
- **Native mobile applications** — Why parked: PRD §Non-Goals. The attendee plays on the web, on the
  device they arrived with.
- **Changes to how existing content is authored or published** — Why parked: PRD §Non-Goals. The
  Markdown-in-repository workflow is out of scope.
- **Owning the realtime layer on the hosting platform itself** — Why parked: `infrastructure.md`
  rejected it — native WebSocket support is public beta and caps connection duration below the length
  of one quiz.
- **Migrating the platform to reduce vendor count** — Why parked: `infrastructure.md` scored an
  alternative higher on paper but recommended staying, because a managed realtime provider removes the
  need for persistent connections and the current platform already runs this site in production at
  zero migration cost.

## Done

(Empty on first generation. `/10x-archive` appends here — and flips that item's `Status` to `done` —
when a change whose `Change ID` matches a roadmap item is archived.)

- **S-08: Attendee can submit a single word to an unscored word-cloud question and watch the aggregate
  visibly fill on the large screen as the room answers.** — Archived 2026-08-14 →
  `context/archive/2026-08-12-word-cloud-question/`. **The slice's named risk turned out not to be the
  real one.** The roadmap expected the spine and the message allowance to be strained by a
  continuously-updating view; the resolution was to keep the cloud **off the snapshot entirely** — a
  host-secret-gated poll of `GET /api/quiz/host/words` on one device, 2 billed commands per tick, nothing
  on the Ably budget. No `SessionState` field, no phase, no new store key. What *did* bite was the poll
  loop: implementation review found three behavioural defects in it (no request timeout, so a stall
  showed a frozen cloud that looked live; the final-read flag keyed off the arrival phase, so revealing
  mid-flight dropped late words permanently; and a staleness marker cleared on a body that carried no
  cloud) — none visible to 1130 passing tests, a manual two-device run, or the structural scan written
  for that very loop. Also added the project's **third fold** (`foldWord`, which keeps diacritics
  because its output is *rendered* on the projector, unlike the two comparison folds) and a third
  `livequiz:tallies` field family, which ended that key's "NOT attendee data" status — corrected in
  place in the registry rather than reworded. Lessons: (1) **a source-scanning guard can certify the
  defect it was written to prevent** — one assertion pinned the buggy expression's shape and passed for
  four commits, failing only when the bug was fixed (now `lessons.md` entry 8); (2) the
  "assertion right, fixture pointed at the wrong branch" failure recurred **four times in one change**,
  including in guards written specifically to catch regressions. **Accepted and unmeasured:** no
  room-scale rehearsal was re-run, so the top-30 truncation and the `HGETALL` payload at ~150 distinct
  words are untested at scale — and that read is the first in the project whose payload an attendee can
  inflate, via the deliberately open join.

- **S-02: Attendee can open the session link, enter an unused display name, and see the host's current
  question appear on their phone as the host starts the session and advances through it.** — Archived
  2026-08-08 → `context/archive/2026-08-07-join-and-follow-host/`. **The atomic claim holds at room
  scale:** 450 concurrent claims across three N=150 runs against production produced **zero duplicate
  folded names**, and the collision probe (case + diacritics + spacing at once) was refused 5/5 every
  run. The join burst completes in **1.24–1.65 s**, 4–6% of FR-002's 30 s budget. **Open Roadmap
  Question 2 is closed:** vanilla TypeScript modules in `src/lib/client/` plus `define:vars`, no UI
  framework — accepted cost is hand-written DOM updates for S-07 and S-08. **Names are never
  published**, which corrects PRD Deviation 2 and hands S-07 the leaderboard-naming choice
  deliberately rather than by default. Lessons: (1) **A plan can assert two things that cannot both
  hold, and the implementation will quietly satisfy one** — "the count is embedded at host-action
  time" and "refresh is how the host watches the lobby fill" were both in the plan; the count was
  implemented per the data rule and the refresh button silently did nothing, through green tests and a
  clean type-check, until a two-device run on production. Recorded in
  `context/foundation/lessons.md`. (2) **A counter reading taken minutes after a burst is not settled
  and looks exactly like one that is** — the first reading produced a store-cost model 3× too low that
  propagated into the runbook before a later reading caught it. (3) **Upstash bills a Lua `EVAL` *and*
  every `redis.call` inside it**, so a join costs eight commands, not one; script length is now a cost
  decision, which S-03's answer path (150 × 14 invocations) should account for. (4) **Two
  conflated error cases needed opposite treatment** — the impl review's F1 found that "unknown player"
  and "the store threw" shared one return shape, so a transient blip cleared a device's stored id and
  locked the attendee out under their own name.

- **F-04: (foundation) roughly 150 simulated devices can be driven through a session against the real
  spine, with fan-out latency and answer loss observed rather than assumed.** — Archived 2026-08-07 →
  `context/archive/2026-08-06-room-scale-rehearsal-harness/`. **The guardrail holds:** end-to-end p95
  spans **111–592 ms across seven N=150 runs** from `fra1` against a 1000 ms budget, 150/150 connected
  every time, and every connected device received every published version — zero lost snapshots. F-01's
  latency tripwire has not fired, and Ably's 200-connection ceiling was never strained. **Two halves of
  the guardrail remain unmeasured by construction:** "no lost answers" needs answers (S-03 onward), and
  arrival is measured at the client library rather than at a painted phone screen (S-02's cost).
  Lessons: (1) **The impl review's critical find was mine, and it is the one to remember**: one
  observation — an N=150 run whose log stream delivered 1 line of 150 and went silent — was written up in
  mechanism language ("the burst kills the stream"), graded H/H in `infrastructure.md` under the heading
  "measured, not inferred", and propagated into the runbook and this change's report. Three controlled
  tests then failed to reproduce it: 150 requests emitting nothing left the tail working, 150 log lines
  delivered 127 of 150 and left it working, a full rehearsal delivered 135 of 150 and left it working.
  What survives is ~10–15% line loss under a burst plus an unexplained intermittent stall. **A single
  observation described as a mechanism reads exactly like a finding**, and this project's own "probe,
  don't trust" rule is the argument for probing twice before writing a foundation document. The
  superseded text is quoted in the report rather than deleted. (2) **A baseline is a range or it is
  wrong.** 356 ms was recorded as "the worst of three runs" and was superseded twice within hours;
  seven runs span over 5× with the system unchanged. Two unquantified candidates, and one cuts against
  the lower-bound framing: 150 subscribers share one event loop, so the harness may *overstate* the
  tail. (3) **A fix can be dead code in the runtime it ships to.** The chosen answer to an interrupted
  run was a SIGINT handler; measured on bun 1.3.14, `process.on` never fires for SIGINT, SIGTERM, SIGHUP
  or SIGUSR2. Dead code was worse than none — it would make interrupts look safe — so it was replaced
  with `--purge-stale`, an opt-in recovery path, verified by SIGKILLing a live run. (4) Two criteria
  could not be verified by observing a *successful* run at all: counting the join burst needed the token
  endpoint instrumented, and the miss-accounting path needed fault injection, because every run until
  then was 150/150. (5) The spend alert the roadmap required is **not configurable** — Upstash Budget is
  pay-as-you-go only and Vercel Spend Management excludes Marketplace integrations, so arming it would
  mean paying in order to be warned about paying. Replaced by a command-counter tripwire (200K per run
  against a 513 → 4102 baseline), whose delta is **two orders of magnitude above what the code accounts
  for and still unexplained** — worth resolving before S-02 adds the first real attendee writes.

- **F-03: (foundation) a session can be explicitly ended, and afterwards no attendee display name or
  submitted answer remains in operator-accessible storage.** — Archived 2026-08-06 →
  `context/archive/2026-08-06-session-end-and-data-purge/`. **Delivered with two recorded deviations
  from the guardrail's wording, both now in `prd.md`:** ending shortens lifetimes to ~10 minutes
  rather than deleting (deliberate, so a reload still shows the final standings; `purge` is the
  immediate escape hatch), and Ably retains published snapshots for **~120s irreducibly** — measured,
  not assumed. **S-02, S-03 and S-07 must read
  `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` before adding any key
  or snapshot field.**
  Lessons: (1) The roadmap's own framing — that this "shrinks to setting the right lifetimes plus an
  end-now path" — was wrong, and only a probe showed it: that reasoning considered Redis alone, while
  Ably and the log stream are two further surfaces neither TTL nor rollback reaches. (2) The purge
  ordering is counter-intuitive and was caught in plan review: publishing before writing broadcasts at
  the *existing* version, which every client drops as not-newer — the closing screen silently never
  changes and it looks like a dead network. Write first so the version bumps. (3) An `ended` phase
  carries a null `currentQuestionId` exactly like the lobby, so `advance` would have reopened question
  1 on a closed session; a fourth phase must not inherit a rule written for three. (4) **The impl
  review's critical find is the one to remember**: `end` validated its confirmation against its own
  read, then delegated to a helper that re-read and wrote against *that* version — a read-then-write
  across round trips wrapping a store guard that never saw the confirmed value. Every one of 243 tests
  passed, and a full live run passed, because both were sequential. Prose asserted the property in
  three places. Ten lines away, `purge` did it correctly.

- **F-02: (foundation) one live session's state is held server-authoritatively in a short-TTL store
  outside the request lifecycle, and a state change made by the host reaches every connected device
  within a second — with devices receiving a short-lived token from the project's own endpoint rather
  than any provider key.** — Archived 2026-08-06 →
  `context/archive/2026-08-06-session-state-and-realtime-spine/`. **Delivered with one caveat: the
  one-second guardrail is not yet measured.** Everything upstream of the last hop is verified on
  production — the version guard serialises concurrent writes (two racing advances gave one `applied`,
  one `already-applied`, room moved exactly one question), `session.publish.ok` per action, structured
  logs in `vercel logs`. The two-device figure is **F-04's to take** (plan criteria 4.5/4.7/4.8 remain
  open; method and reference points are fixed in the archived `latency-probe.md`).
  Lessons: (1) F-01's probe-don't-trust rule paid twice — the Marketplace injects `KV_REST_API_*`, not
  the documented `UPSTASH_REDIS_REST_*`, and `cjson` needed its own probe before the one-key design
  could rely on it. (2) Read-modify-write over Upstash's HTTP interface is three round trips with no
  isolation, so the compare-and-set must live in a Lua `EVAL`; a JS guard passes every mocked test and
  drops a host action on stage. (3) An open token endpoint is safe against forgery but not against
  connection-ceiling exhaustion — accepted with a tripwire in `infrastructure.md`. (4) `vercel logs`
  dropped the first action's line even though the response proved it succeeded, so the host must fire a
  throwaway action before trusting the stream.
- **F-01: (foundation) the deployment target is a known quantity before realtime work rides on it: the
  adapter cannot silently pull an Astro major, functions run in the EU region closest to the room, and
  the logs/rollback loop F-04 depends on has been exercised.** — Archived 2026-08-06 →
  `context/archive/2026-08-05-deployment-target-readiness/`. Lesson: two `infrastructure.md` claims were
  wrong and only a probe caught them — `fra1` needs no Pro plan, and preview URLs are SSO-protected, not
  public. `vercel logs` streams function-emitted output, not an access log, so the one-hour-retention
  mitigation is worthless unless F-02 onward instruments deliberately.
- **S-01: Organizer can define the whole quiz — questions, types, accepted answers, true values,
  scoring flags — in a file authored alongside the project's source, and a malformed or incomplete
  definition is rejected loudly rather than discovered on stage.** — Archived 2026-08-06 →
  `context/archive/2026-08-05-quiz-definition-and-validation/`. Lesson: the impl-review caught a gate
  whose documented mechanism was not its operating one — the `astro:build:start` hook was dead code
  because the config's static import parses at module scope, and CLAUDE.md, the commit message and a
  docstring all described the hook. It surfaced only by breaking an invariant and reading the real
  failure output, not by re-reading the reasoning. S-02 onward: `src/quiz/index.ts` is the import site
  (`quiz`, `getQuestionById`, `normalizePolish`, the types) — never `definition.ts`.

- **S-03: Attendee can answer a single- or multiple-choice question on their phone and, when the host
  reveals it, see whether they were right and how many points they earned — including the speed
  component measured from when the question appeared on their own device.** — Archived 2026-08-09 →
  `context/archive/2026-08-08-answer-choice-question-and-reveal/`. **The named trap is retired:** speed
  is measured from the device's own first paint, persisted per question, so a reload keeps its clock
  instead of restarting it at full weight. **The submission path holds at room scale:** 150/150
  accepted in 401 ms against production, 150 answers stored with zero duplicates, a repeat submission
  refused 409 — `HSETNX` is what makes the first answer final. End-to-end p95 449 ms against the 1 s
  budget. **Cost is confirmed, and it is the finding that outlives this slice:** 8 commands per
  submission and 4 per result read, measured to **+0.4%** of prediction (observed +2,489 against
  ~2,480), which puts a real event at ~27k and ten events a month at **~54% of the 500K ceiling**, up
  from ~1%. The runbook's per-run tripwire is unchanged at 200K; its margin fell from ~125× to ~7×.
  S-04, S-07 and S-08 each add another per-attendee path on top of this one. Lessons: (1) **Absent
  untrusted input must fail toward the safe end, not the favourable one** — `Number(null)` is `0`, so
  a submission omitting `elapsedMs` scored as an instant answer and took full speed weight; recorded in
  `context/foundation/lessons.md`, and three further instances of the same shape (a 5xx read as a
  refusal, a nonsense clamp window, an unread `answered: false`) were caught by the implementation
  review *after* the lesson was written. (2) **Archived with 9 manual rows unverified** — the
  two-device run this plan names as its end state was never performed, so every browser-side fix from
  the review is deployed and unexercised. S-09 inherits that gap.

- **S-04: Host can display on the large screen how many attendees have answered the open question,
  and the distribution of what they chose once the question is revealed.** — Archived 2026-08-09 →
  `context/archive/2026-08-09-host-participation-and-distribution/`. **The two payloads are separated
  structurally, not by discipline:** the count and the distribution are two functions in `store.ts`,
  so the polled endpoint has no shape in which per-option data could travel, and a `superRefine`
  clause — not a comment — is what keeps `revealedDistribution` inside `question-revealed`. **The
  counters hold at room scale:** 150 concurrent submissions produced a tally of exactly 150 and an
  option sum of exactly 150 against production, which is the one check a mocked client cannot make
  since the increments live in Lua. `check-purge` removed 6 of 6 registered keys, `livequiz:tallies`
  among them. **Cost is confirmed against a pre-registered prediction:** observed 3,184 against
  3,210–3,310 written down before the counter was read — **0.8% under**. That measures the
  per-command model, *not* an event: ~32.4k per event and ~65% of the 500K ceiling at ten events a
  month remain an extrapolation, and the runbook now says so in those words. **This slice introduced
  the project's first polling loop**, and its shape (one device, `question-open` on a choice question
  only, ~2.5 s, 2 commands per tick) is recorded in the runbook so the command tripwire can still
  tell expected cost from a leak. Lessons: (1) **Prove the fixture reaches the branch the test names**
  — two tests here were green while exercising the opposite branch (an `undefined` swallowed by a
  destructuring default, and a distribution fixture built on the word-cloud question so it ran the
  skip path); recorded in `context/foundation/lessons.md`. (2) **The untested component is where the
  findings were** — the implementation review put three of five warnings in the poll loop, the only
  new runtime shape with no automated coverage, while every structurally-enforced invariant held.

- **S-05: Attendee can type a free-text answer and have it judged correct if it matches any accepted
  variant, regardless of letter case, surrounding spaces, or Polish diacritics.** — Archived
  2026-08-09 → `context/archive/2026-08-09-free-text-answers/`. Delivered with **trailing sentence
  punctuation folded too**, which the plan added and the roadmap had not: a phone keyboard's
  auto-inserted full stop was turning a correct answer into a zero the host would have had to explain
  from the stage. **The load-bearing decision was to split the fold, not widen it.** Plan review
  caught that `normalizePolish` has a second non-test caller — `players.ts`, where the folded display
  name *is* the FR-008 uniqueness key and `.` is a legal name character — so widening it in place
  would have merged `"Ania."` and `"Ania"` into one claim and, mid-deploy, let two visually identical
  names onto the leaderboard, because the stored keys were written with the old fold. `normalizeAnswer`
  was added beside it instead; `normalize.test.ts` pins the original with
  `normalizePolish("Ania.") !== normalizePolish("Ania")`, and `schema.ts` moved to the new fold so the
  authoring-collision check and the runtime scorer still cannot drift. **`SessionState` now carries one
  decoration field against three transition fields** — `revealedAnswerText` joined `revealedOptionIds`
  and S-04's `revealedDistribution`, each set only by `reveal.ts` and each with its own invariant
  clause. **S-06 reuses this field for numbers rather than adding a fourth.** Suite 657 → 701; no new
  `livequiz:` key; nothing but quiz content on the snapshot. Lessons: (1) **Grep every caller before
  editing a shared pure function** — a fold used as an identity is not the same function as a fold
  used for comparison, even when the code is identical; recorded in `context/foundation/lessons.md`.
  (2) **The promise the data path could not keep was in the view, not the rule** — the plan said a
  locked text field stays visible "so the attendee still sees what they sent", but the value lived in
  memory only and a reload emptied it; caught in implementation review as an instance of the existing
  "check the data path can deliver a promised UI affordance" rule, and fixed by persisting the answer
  beside `submitted` in the already-registered seen map.

- **S-06: Attendee can submit a numeric guess and earn points scaled by how close it was, on the same
  relative-error rule whether the true answer is 67 or 10,000.** — Archived 2026-08-09 →
  `context/archive/2026-08-09-guess-the-number-answers/`. **The first
  partial-credit answer in the system**, and that is the fact with the longest reach: `correct` is
  exact-hit-only for this kind, so a guess worth 800 of 1000 points returns `{ correct: false,
  awarded: 800 }` and the reveal copy is selected by question **kind before** it is selected by
  `correct` — a kind-blind branch would render "Tym razem nie." beside a positive award. The bands
  (1.00 / 0.80 / 0.60 / 0.30 / 0 at 0%, 5%, 10%, 25% relative error) live in one exported constant
  with an epsilon on the comparisons, because three of the twelve exact-edge cases across the two live
  questions overshoot their band in binary floating point. `speedWeight` is reused unchanged, pinned
  by an assertion that a number and a choice answer at equal closeness and elapsed receive identical
  awards. **Nothing new on the wire and no host-view change**: the true value is formatted server-side
  into S-05's `revealedAnswerText` (pl-PL, grouping with U+00A0), so the large screen renders it
  through the branch that already existed. The parser is server-side and singular
  (`src/lib/session/guess.ts`) — the attendee view gates its submit button on "contains a digit"
  rather than growing a second parser across the boundary — and it refuses an absent, empty or
  unparseable field instead of coercing it, per `lessons.md` rule 2. Suite 766 → 831; no new
  `livequiz:` key; `AnswerRecord.value` carries `.default(null)` for the mid-session deploy.
  Lesson: **a client gate looser than the server's refusal turns a validation 400 into a lock** — the
  view treated every non-5xx refusal as final and marked the question submitted, which was safe only
  while the client gates made a 400 unreachable; the loose "contains a digit" gate made it reachable
  and locked attendees out of a question nothing had been written for. Caught in implementation
  review, fixed by splitting `invalid` from `rejected` so only a 409 is final.

- **S-07: Host can choose to show the standings between questions, and every attendee can locate
  themselves on a leaderboard that matches what the room sees on the large screen.** — Archived
  2026-08-12 → `context/archive/2026-08-11-leaderboard-beat/`. **Took the decision S-02 parked here:
  display names are now published**, bounded to five `{ rank, displayName, points }` rows and never a
  player id — the board is computed once server-side and broadcast, so no device sorts and the
  no-divergence guardrail holds by construction rather than by agreement. Row *order* (a total order)
  and rank *number* (competition rank, ties share it) are computed by different rules on purpose: the
  per-device path holds only the scores hash, so a positional rank would make a tied attendee's phone
  contradict the projector. The `standings` phase deliberately keeps `currentQuestionId` — questionless,
  `nextQuestionId(null)` returns question 1 and advancing from the board would reopen the quiz — which
  is why `advance.ts` needed no change at all. Suite 831 → 974; no new `livequiz:` key (rank is derived);
  `standings` carries `.default(null)` for the mid-session deploy. **S-08 and S-10 must read
  `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`** before adding a snapshot field
  or a phase; S-10 also inherits the `ended`-phase board, which this slice did not build.
  Lesson: **check every path that exposes a new snapshot field, not just the one you reasoned about** —
  publishing names was justified entirely on Ably's ~120 s retention floor, but `GET /api/quiz/state` is
  deliberately unauthenticated and returns the whole document, so the five names are readable for as long
  as the host leaves the board up. The exposure was accepted; the reasoning recorded in the plan was
  simply wrong, and implementation review caught it rather than a test. Archived with 11 manual
  verification rows still open, by explicit decision.

- **S-09: Attendee can reload the page or unlock their phone and resume as the same player with their
  score intact, and a single device cannot register an unreasonable number of players.** — Archived
  2026-08-14 → `context/archive/2026-08-14-resilient-join/`. **Most of the slice was already built.**
  S-02 shipped the identity handshake and S-03 the persisted paint times and submitted flag, so resume
  arrived ~80% done; what remained was the cap, which did not exist at all, plus two honest gaps — the
  running total was invisible after a mid-question reload, and a device whose storage is unavailable
  met a bare "name taken" with nowhere to go. The cap is **3 per device, cumulative, never
  decremented**, enforced inside `CLAIM_PLAYER` where two orderings carry the behaviour silently (cap
  check before the collision check; increment after it). **The exemption is the slice**: the cap
  governs the claim path and never the resume path, because applying it to a resume turns
  anti-farming into elimination. Added `livequiz:devices` — a count per device, the one registered key
  that is not attendee data — and a third browser-storage key. **A limit worth carrying forward: the
  redis client is mocked in the suite, so the Lua cap is executed by nothing in any test.** Its
  orderings are pinned as structural properties of the script text, and the behaviour rests entirely
  on runbook step 6. Lessons: (1) **a guard installed by plain assignment on a Proxy-backed object
  installs nothing** — `answer.test.ts`'s `withBrokenWrite` had certified three storage branches for
  four months while passing against code with its `try`/`catch` deleted, and CLAUDE.md documented the
  broken half as the pattern to copy; (2) **an absent value with two causes needs the cause, not the
  absence** — the storage-stranded copy was gated on "no stored player", which is equally true of
  every first-time joiner, so the ordinary two-people-picked-Anna case was told its points could not
  be recovered; implementation review caught it, no test could. (3) Two phases grew past their planned
  boundaries because a signature change could not be contained — the plan's phase split, not the
  implementation, was what turned out to be wrong.

- **S-10: Host can close the session with a winner reveal, and every attendee learns where they
  finished.** — Delivered 2026-08-14 → `context/archive/2026-08-14-final-winner-reveal/`. **No new phase, no new
  snapshot field and no new store key**: the `ended` phase simply stopped clearing S-07's `standings`,
  which is the shape the leaderboard contract had already handed over. What made it more than a
  one-line change was the asymmetry it forced — `standings` *requires* a board because the board is the
  phase, while `ended` merely permits one, because `end` is what moves every key onto the ~10-minute
  lifetime and may never be refused over an `HGETALL` that blipped. A failed board read closes the
  session on the plain screen and says so with `rowCount: 0`. `result.ts`'s `ended` branch gained the
  rank the contract named as an open gap, degrading to `null` rather than 503 for the same reason: at
  the close there is no beat to retry into. **The slice's real decision was a placement one** — `end`
  moved onto the host view, reversing F-03, because FR-006 asks the *host* to trigger the closing beat
  and a terminal window in front of a room is not a trigger. The mis-click risk is answered by guards
  rather than by distance: no `data-action` so the blanket handler cannot reach it, disabled in markup
  and by phase, two taps, disarmed by anything that moves the session, and a confirmed version the
  route refuses if stale. `purge` did not come along. Suite 1177 → 1188; retention window restated in
  the PRD as bounded by a TTL rather than by the host's attention — the same five names, a differently
  shaped exposure. Lesson: **a docstring naming a future slice is a decision waiting to be taken, not a
  TODO** — `state.ts` and `result.ts` both carried "S-10 owns this", and both were right about the
  shape, which is why this landed in a day. Contract:
  `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md`.
