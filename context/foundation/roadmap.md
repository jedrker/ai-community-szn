---
project: "LiveQuiz"
version: 1
status: draft
created: 2026-08-05
updated: 2026-08-05
prd_version: 1
main_goal: quality
top_blocker: decisions
---

# Roadmap: LiveQuiz

> Derived from `context/foundation/prd.md` (v1) + a probed codebase baseline.
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
on infrastructure the community owns, with no account for anybody.

## North star

**S-03: Attendee answers a choice question and learns their result at the host's reveal** — this is
the first moment at which both user stories are simultaneously true: the host is driving the room and
an attendee is scoring on their own device, which is the whole hypothesis.

> "North star" here means the smallest end-to-end slice whose successful delivery would prove that
> the product works at all. It is placed as early as its prerequisites allow, because everything
> after it only matters if this works.

## At a glance

| ID    | Change ID                          | Outcome (user can …)                                                             | Prerequisites | PRD refs                                             | Status   |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------- | -------- |
| F-01  | `session-state-and-realtime-spine` | (foundation) one session's state persists outside the request and pushes to devices | —             | Success Criteria guardrails (1s fan-out, 150 concurrent), Open Question 7 | blocked  |
| F-02  | `session-end-and-data-purge`       | (foundation) a session can be ended and its attendee data is gone afterwards      | F-01          | Success Criteria guardrail (retention), Access Control Changes | proposed |
| F-03  | `room-scale-rehearsal-harness`     | (foundation) the spine can be driven by ~150 simulated devices and measured       | F-01          | Success Criteria guardrails (1s fan-out, 150 concurrent) | proposed |
| S-01  | `quiz-definition-and-validation`   | Organizer can author the whole quiz in a file and have it rejected if malformed   | —             | FR-001, FR-017                                       | ready    |
| S-02  | `join-and-follow-host`             | Attendee can join a started session by name and see the host's current question  | S-01, F-01    | US-01, US-02, FR-002, FR-003, FR-007, FR-008         | proposed |
| S-03  | `answer-choice-question-and-reveal`| Attendee can answer a choice question and see if they were right and what they scored | S-02      | US-01, US-02, FR-004, FR-010, FR-016, FR-019         | proposed |
| S-04  | `host-participation-and-distribution` | Host can show the room how many have answered, then the distribution at reveal | S-03          | US-02, FR-005                                        | proposed |
| S-05  | `free-text-answers`                | Attendee can answer a free-text question without being punished for diacritics   | S-03          | US-01, FR-011                                        | proposed |
| S-06  | `guess-the-number-answers`         | Attendee can guess a number and score by how close they were                     | S-03          | US-01, FR-013                                        | proposed |
| S-07  | `leaderboard-beat`                 | Host can show the leaderboard between questions, and attendees can find themselves on it | S-03  | US-01, US-02, FR-014                                 | proposed |
| S-08  | `word-cloud-question`              | Attendee can submit one word and watch the cloud fill on the large screen        | S-03          | US-01, US-02, FR-012, FR-015                         | proposed |
| S-09  | `resilient-join`                   | Attendee can reload or unlock their phone and resume as the same player          | S-02          | US-01, FR-009, FR-018                                | proposed |
| S-10  | `final-winner-reveal`              | Host can close the session with a winner-reveal sequence                        | S-07          | US-02, FR-006                                        | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the
dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                                                                     | Note                                                                                                  |
| ------ | ------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A      | Quiz content                   | `S-01`                                                                    | Standalone — no foundation prerequisite, plannable today, and the only item currently `ready`.         |
| B      | Session spine & room-scale proof | `F-01` → `F-03`                                                         | `F-01` is the gate for everything realtime; `F-03` proves the 150-device guardrail before feature work rides on it — the `quality` bias. |
| C      | Privacy & session lifecycle    | `F-02`                                                                    | Joins Stream B at `F-01`. Must land before any real session collects real names.                       |
| D      | The live loop                  | `S-02` → `S-03` → `S-04` / `S-07` → `S-10`, with `S-09` parallel after `S-02` | Joins Stream A and Stream B at `S-02`, which needs both `S-01` and `F-01`. Contains the north star `S-03`. |
| E      | Question mechanics             | `S-05` / `S-06` / `S-08` (all parallel after `S-03`)                      | Joins Stream D at `S-03`. Three independent mechanics — three agent runs can fan out here.             |

## Baseline

What's already in place in the codebase as of `2026-08-05` (probed and user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.4 with Tailwind CSS 4 via `@tailwindcss/vite`, seven components and
  a shared layout (`astro.config.ts`, `src/components/`, `src/layouts/BaseLayout.astro`).
- **Backend / API:** partial — `output: "server"` with the Vercel adapter means an on-demand
  serverless surface already exists, and two POST handlers run on it (`src/pages/api/`). There is no
  realtime transport of any kind and no server-held state.
- **Data:** absent — no database, no ORM, no migrations. Content collections are the CMS
  (`src/content.config.ts`) and newsletter subscribers live in an external audience
  (`src/lib/newsletter.ts`). Nothing durable and application-owned exists.
- **Auth:** absent — no provider, no sessions, no middleware, no role separation. This is by design
  for this change (see PRD Access Control Changes) and is not a Foundations gap.
- **Deploy / infra:** partial — `vercel.json` plus the adapter, push-to-`main` deploys, Node floor
  22.12. No `.github/`, so no CI and no pre-deploy gate.
- **Testing:** present — `vitest` is installed with a `test` script and one existing suite
  (`src/lib/newsletter.test.ts`), so no test-infrastructure foundation is needed.
- **Observability:** absent — `src/lib/slack.ts` is an outbound notification webhook, not error
  tracking. No error reporting, metrics, or alerting.

## Foundations

### F-01: Session state and realtime fan-out spine

- **Outcome:** (foundation) one live session's state persists outside the request lifecycle, and a
  state change made by the host reaches every connected device within a second.
- **Change ID:** `session-state-and-realtime-spine`
- **PRD refs:** Success Criteria guardrails (1-second reflection, 150 concurrent attendees with no
  lost answers and no divergence between devices), Open Question 7
- **Unlocks:** S-02 and therefore every slice after it; reduces the roadmap's blocking unknown
  ("where does session state live and what pushes it"); creates the verification path F-03 measures.
- **Prerequisites:** —
- **Parallel with:** S-01
- **Blockers:** —
- **Unknowns:**
  - Which durable store and which push transport carry a session? The project has no working
    persistence today and no `tech-stack.md` records a choice — Owner: user. Block: yes.
  - Does the chosen combination hold at 150 concurrent devices within the 1-second budget, and at
    what running cost? — Owner: user (cost ceiling), measured by F-03. Block: no.
- **Risk:** Sequenced first among foundations because every user-facing slice except S-01 sits on it,
  and because it is the one place the PRD's most expensive guardrail can be won or lost. The failure
  mode is choosing a transport that looks fine with three test devices and diverges at room scale —
  which is precisely why F-03 follows immediately rather than at the end.
- **Status:** blocked

### F-02: Session end and data purge

- **Outcome:** (foundation) a session can be explicitly ended, and after it ends no attendee display
  name or submitted answer remains in operator-accessible storage.
- **Change ID:** `session-end-and-data-purge`
- **PRD refs:** Success Criteria guardrail (post-session retention), Access Control Changes
  (identity within a session), Non-Goals (no result history, no post-session analytics)
- **Unlocks:** the retention guardrail that must hold before any slice from S-02 onward collects real
  attendee names at a real event; gives F-03's rehearsal runs a clean teardown so repeated rehearsals
  do not accumulate state.
- **Prerequisites:** F-01
- **Parallel with:** F-03, S-02, S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Cheap while the store is young and expensive once four question mechanics write to it,
  so it is sequenced with the spine rather than after the features. Its own failure mode is a purge
  that fires on a session the host did not mean to end — losing a live leaderboard mid-segment.
- **Status:** proposed

### F-03: Room-scale rehearsal harness

- **Outcome:** (foundation) roughly 150 simulated devices can be driven through a session against
  the real spine, with fan-out latency and answer loss observed rather than assumed.
- **Change ID:** `room-scale-rehearsal-harness`
- **PRD refs:** Success Criteria guardrails (1-second reflection, 150 concurrent with no lost
  answers), Known operational gap ("nothing exists today that would alert anyone to such a failure")
- **Unlocks:** the named verification path for the two binding engineering guardrails, required
  before S-02 through S-08 can be trusted in front of a room; reduces F-01's second unknown
  (does the chosen transport hold at room scale, and at what cost).
- **Prerequisites:** F-01
- **Parallel with:** F-02, S-02
- **Blockers:** —
- **Unknowns:**
  - Is a load rehearsal against the production deployment acceptable, or must it run against a
    separate environment? — Owner: user. Block: no.
- **Risk:** Exists only because the chosen main goal is quality and the guardrails are binding; a
  community meetup cannot be the first time 150 devices connect at once. Kept minimal on purpose —
  it drives the spine, it does not become a performance-testing suite.
- **Status:** proposed

## Slices

### S-01: Quiz definition authored in the repository

- **Outcome:** Organizer can define the whole quiz — questions, types, accepted answers, true values,
  scoring flags — in a file authored alongside the project's source, and a malformed or incomplete
  definition is rejected loudly rather than discovered on stage.
- **Change ID:** `quiz-definition-and-validation`
- **PRD refs:** FR-001, FR-017
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Sequenced first because it is the only slice with no dependency on the undecided session
  store, so it is the one item that can be planned and shipped while Open Roadmap Question 1 is still
  open. Its risk is over-designing the definition format for question types that later slices will
  reshape — keep it to the four types the drafted 14-question quiz actually uses. FR-001's accepted
  operational risk stands: only a developer can correct a question, including minutes before showtime.
- **Status:** ready

### S-02: Attendee joins a live session and follows the host

- **Outcome:** Attendee can open the session link, enter an unused display name, and see the host's
  current question appear on their phone as the host starts the session and advances through it.
- **Change ID:** `join-and-follow-host`
- **PRD refs:** US-01, US-02, FR-002, FR-003, FR-007, FR-008
- **Prerequisites:** S-01, F-01
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:**
  - Is the 30-second join target met on a venue network with 150 devices joining in a burst, or does
    joining need to be measured separately from steady-state fan-out? — Owner: user, measured by
    F-03. Block: no.
- **Risk:** The first slice where the spine meets real devices, so it is where a wrong transport
  choice surfaces. Deliberately excludes answering: a room that is merely connected and following the
  host is already a testable, demonstrable state, and separating it keeps the north star tractable.
  Name-collision rejection (FR-008) sits here rather than later because it is part of the same join
  flow the 30-second target covers.
- **Status:** proposed

### S-03: Attendee answers a choice question and learns their result

- **Outcome:** Attendee can answer a single- or multiple-choice question on their phone and, when the
  host reveals it, see whether they were right and how many points they earned — including the speed
  component measured from when the question appeared on their own device.
- **Change ID:** `answer-choice-question-and-reveal`
- **PRD refs:** US-01, US-02, FR-004, FR-010, FR-016, FR-019
- **Prerequisites:** S-02
- **Parallel with:** F-02, F-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** This is the north star, so it is placed as early as its prerequisites allow. It carries
  the project's first domain rule: all-or-nothing multi-answer scoring plus a speed weight measured
  per device rather than from the host's action. The trap is measuring speed from the host's advance,
  which would silently penalise slow connections and contradict the PRD's stated input. Getting the
  scoring rule right here means S-05, S-06 and S-08 only add a mechanic, not a second scoring model.
- **Status:** proposed

### S-04: Host shows participation, then the distribution

- **Outcome:** Host can display on the large screen how many attendees have answered the open
  question, and the distribution of what they chose once the question is revealed.
- **Change ID:** `host-participation-and-distribution`
- **PRD refs:** US-02, FR-005
- **Prerequisites:** S-03
- **Parallel with:** S-05, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** The FR was revised during shaping precisely because showing the distribution while a
  question is open turns the large screen into a cheat sheet. The implementation risk is leaking that
  data to the host view early — the count and the distribution must be two different payloads, not
  one payload rendered differently. Legibility from the back of the room is a real constraint here.
- **Status:** proposed

### S-05: Attendee answers a free-text question

- **Outcome:** Attendee can type a free-text answer and have it judged correct if it matches any
  accepted variant, regardless of letter case, surrounding spaces, or Polish diacritics.
- **Change ID:** `free-text-answers`
- **PRD refs:** US-01, FR-011
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-06, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the other mechanics, so it can run in a separate agent pass. The scoping
  line matters: normalisation stops at case, spacing and diacritics and deliberately does not tolerate
  misspellings, because a fuzzy threshold is something the host would have to defend out loud in front
  of the room.
- **Status:** proposed

### S-06: Attendee guesses a number

- **Outcome:** Attendee can submit a numeric guess and earn points scaled by how close it was, on the
  same relative-error rule whether the true answer is 67 or 10,000.
- **Change ID:** `guess-the-number-answers`
- **PRD refs:** US-01, FR-013
- **Prerequisites:** S-03
- **Parallel with:** S-04, S-05, S-07, S-08, S-09
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Independent of the other mechanics. The rule is magnitude-independent by design so one
  rule covers both drafted questions; the risk is an award curve that hands almost-full points to a
  wild guess, which would quietly flatten the leaderboard the whole segment builds toward.
- **Status:** proposed

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
  devices — two attendees seeing different rankings at the same moment is more damaging on stage than
  a slow update. Sequenced after the north star because a leaderboard needs scored answers to rank,
  and it is a host-controlled beat rather than an automatic one so the segment stays short.
- **Status:** proposed

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
  the only view that pushes updates continuously rather than on host action, so it is the mechanic
  most likely to strain the spine — worth running after F-03 has measured the headroom. Word-cloud
  submissions reach the projector unmoderated by explicit decision.
- **Status:** proposed

### S-09: Join survives a real room

- **Outcome:** Attendee can reload the page or unlock their phone and resume as the same player with
  their score intact, and a single device cannot register an unreasonable number of players.
- **Change ID:** `resilient-join`
- **PRD refs:** US-01, FR-009, FR-018
- **Prerequisites:** S-02
- **Parallel with:** S-03, S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:**
  - How many players from one device is "unreasonable", given a venue network can put many attendees
    behind one address and handsets do get shared? — Owner: user. Block: no.
- **Risk:** Both halves are device-scoped identity pulling in opposite directions: resume needs the
  device remembered, the flood guard needs the device counted. The PRD accepts that a borrowed handset
  inherits someone else's player, and that the guard is lightweight and defeatable by design. Screen
  lock during a 15-minute segment is near-certain, so this is not optional polish.
- **Status:** proposed

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
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                             | Suggested issue title                                              | Ready for `/10x-plan` | Notes                                                      |
| ---------- | ------------------------------------- | ------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------- |
| S-01       | `quiz-definition-and-validation`      | Author the quiz as a validated in-repo definition                  | yes                   | Run `/10x-plan quiz-definition-and-validation`              |
| F-01       | `session-state-and-realtime-spine`    | Session state store and sub-second fan-out to attendee devices     | no                    | Blocked — store and transport not chosen (Open Q 1)         |
| F-02       | `session-end-and-data-purge`          | End a session and purge attendee names and answers                 | no                    | Needs F-01                                                  |
| F-03       | `room-scale-rehearsal-harness`        | Drive ~150 simulated devices through a session and measure         | no                    | Needs F-01                                                  |
| S-02       | `join-and-follow-host`                | Join a session by display name and follow the host's question      | no                    | Needs S-01 + F-01                                           |
| S-03       | `answer-choice-question-and-reveal`   | Answer a choice question and see result and points at reveal       | no                    | North star. Needs S-02                                      |
| S-04       | `host-participation-and-distribution` | Large screen: answer count while open, distribution at reveal      | no                    | Needs S-03                                                  |
| S-05       | `free-text-answers`                   | Free-text answers matched ignoring case, spacing and diacritics    | no                    | Needs S-03                                                  |
| S-06       | `guess-the-number-answers`            | Numeric guesses scored by relative error                           | no                    | Needs S-03                                                  |
| S-07       | `leaderboard-beat`                    | Host-controlled leaderboard between questions                      | no                    | Needs S-03                                                  |
| S-08       | `word-cloud-question`                 | Unscored word-cloud question with a live-filling large-screen view | no                    | Needs S-03; run after F-03 measures headroom                |
| S-09       | `resilient-join`                      | Same-device resume plus per-device player cap                      | no                    | Needs S-02                                                  |
| S-10       | `final-winner-reveal`                 | Closing winner-reveal sequence                                     | no                    | Needs S-07; nice-to-have, first candidate to cut            |

## Open Roadmap Questions

1. **Where does session state live, and what pushes it to devices?** — The project has no working
   persistence today and no stack decision is recorded. Owner: user. Block: F-01, and transitively
   S-02 through S-10 and F-02, F-03 — that is, everything except S-01. Mirrors PRD Open Question 7,
   promoted to blocking here because no realtime slice can be planned without it.
2. **Does the live-event blast radius justify introducing CI or error alerting?** — Forwarded from
   `shape-notes.md` (`## Forward: stack assessment`) and unresolved: no FR covers it, the baseline has
   neither, and the PRD's "known operational gap" says nothing would alert anyone to a live failure.
   F-03 covers rehearsal, not production visibility. Owner: user. Block: roadmap-wide (advisory — no
   slice is currently held on it).
3. **What is the acceptable running-cost ceiling now that cost neutrality is released?** — Released
   without a replacement figure; the 150-concurrent guardrail is the requirement most likely to
   consume it, and it is an input to Open Question 1. Owner: user. Block: no (mirrors PRD Open
   Question 3).
4. **How many weeks of work is full scope?** — Unknown until the stack is picked, so
   `timeline_budget.delivery_weeks` is unset. Owner: user, after Open Question 1 resolves. Block: no
   (mirrors PRD Open Question 2).
5. **Timeline cost was never acknowledged against a number.** — Full scope was kept with no effort
   expectation recorded, so there is nothing to measure actual effort against. Owner: user. Block: no
   (mirrors PRD Open Question 4).
6. **Preserved behavior is asserted rather than chosen.** — Nothing in the existing site was declared
   untouchable, so there is no tripwire if implementation starts reshaping it. Owner: user. Block: no
   (mirrors PRD Open Question 5).
7. **What partial-credit behavior applies if a future question has more than two correct options?** —
   All-or-nothing is settled for the drafted quiz. Owner: user. Block: no (mirrors PRD Open
   Question 6).

## Parked

- **Quiz builder, admin panel, question import/export** — Why parked: PRD §Non-Goals, load-bearing —
  avoiding the builder is the reason this is built rather than rented.
- **Accounts, result history, post-session analytics, reports, exports** — Why parked: PRD
  §Non-Goals; consistent with the retention guardrail F-02 enforces.
- **Parallel sessions and multiple quizzes** — Why parked: PRD §Non-Goals. One session, one quiz, one
  room; this removes session management from the change entirely.
- **Multimedia in questions** — Why parked: PRD §Non-Goals. Questions are text only.
- **Moderation of word-cloud submissions** — Why parked: PRD §Non-Goals; the reputational risk of an
  unreviewed word on a projector was surfaced and accepted.
- **Cost-neutrality guarantee** — Why parked: PRD §Non-Goals; released in favour of keeping the
  150-concurrent and one-second guardrails binding.
- **Score multipliers and streak bonuses** — Why parked: PRD §Non-Goals. Only the time-bonus half of
  the original advanced-scoring non-goal was reversed (FR-019).
- **Native mobile applications** — Why parked: PRD §Non-Goals. The attendee plays on the web, on the
  device they arrived with.
- **Changes to how existing content is authored or published** — Why parked: PRD §Non-Goals. The
  Markdown-in-repository workflow is out of scope.

## Done

(Empty on first generation. `/10x-archive` appends here — and flips that item's `Status` to `done` —
when a change whose `Change ID` matches a roadmap item is archived.)
