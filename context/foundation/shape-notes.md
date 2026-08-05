---
project: "LiveQuiz"
context_type: brownfield
created: 2026-08-05
updated: 2026-08-05
product_type: web-app
target_scale:
  users: medium
  qps: bursty — ~150 concurrent devices during a ~15-minute session, otherwise idle
  data_volume: small — one session's answers, not retained after the event
timeline_budget:
  delivery_weeks: null    # TODO: unknown until stack selection — see Open Questions
  hard_deadline: null
  after_hours_only: false    # mixed — partly day-job time, partly evenings
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "change category"
      decision: "new module alongside the existing site; existing pages and content model untouched"
    - topic: "insight / why-not-already-built"
      decision: "three co-existing reasons: owning the brand moment; quiz authors are developers so a file-defined quiz beats a wizard; one evening a month does not justify a subscription"
    - topic: "primary persona"
      decision: "the host running the session; attendees are secondary"
    - topic: "must-preserve (blast radius)"
      decision: "hosting cost stays at zero / hobby tier — named as the only hard preservation constraint"
    - topic: "host-view protection"
      decision: "no protection; the room is trusted. Hijack risk accepted explicitly."
    - topic: "attendee join flow"
      decision: "open the link, type a name, in — no code, no login"
    - topic: "reconnect identity"
      decision: "an attendee returning on the same device resumes as the same player with score intact"
    - topic: "duplicate names"
      decision: "second identical name is rejected at join; names are unique within a session"
    - topic: "deadline"
      decision: "no fixed date; the tool comes first and a session is scheduled once it works"
    - topic: "v1 question mechanics"
      decision: "all four retained — single/multiple choice, free-text, word cloud, guess-the-number"
    - topic: "scope-vs-cost tension"
      decision: "full scope kept with all three engineering targets binding; the zero-cost hosting constraint is RELEASED instead. Supersedes the phase-1 must-preserve answer."
    - topic: "existing-site isolation"
      decision: "unresolved — deferred to the downstream stack step; routed to Open Questions"
    - topic: "per-question attendee feedback"
      decision: "attendees see correctness and points earned on their own device after each reveal"
    - topic: "multi-answer partial credit"
      decision: "all-or-nothing — every correct option selected, no incorrect ones"
    - topic: "guess-the-number scoring"
      decision: "points scale by relative error, so the rule is magnitude-independent"
    - topic: "tie-breaking"
      decision: "no tie-break rule; every scored answer is speed-weighted so identical totals are effectively impossible"
    - topic: "time-based scoring"
      decision: "full speed bonus on every scored question, timed from question arrival on the attendee's own device. Deliberately reverses the idea-notes non-goal on time bonuses; multipliers and streaks remain out."
  frs_drafted: 19
  quality_check_status: warned
---

# Shape notes — LiveQuiz

Seed input: `idea-notes.md` (read verbatim, 2026-08-05). Context type auto-detected as brownfield
(28 commits of git history, `bun.lock`, `astro.config.ts`, `src/`, `vercel.json`) and confirmed by the user.

Body sections below anticipate the 11 brownfield PRD sections defined in
`.claude/skills/10x-shape/references/prd-schema.md`.

> **Post-session correction (2026-08-05, added after `/10x-stack-assess` and `/10x-health-check`).**
>
> This document is the dated record of the shaping conversation and its wording is preserved as
> captured. One factual premise in it turned out to be wrong, and it is annotated inline below as
> `[CORRECTED]` wherever it appears.
>
> **What was believed during shaping:** the existing site is a pure static build (SSG), so a change
> needing server-held state would force a serving-model change. This came from `.ai/prd.md` and was
> never checked against `astro.config.ts`.
>
> **What is actually true:** rendering is **hybrid**. `astro.config.ts` sets `output: "server"` with
> the Vercel adapter, and the four content routes opt back into build-time generation with
> `export const prerender = true`:
>
> | Route | Mode |
> | --- | --- |
> | `/wydarzenia`, `/wydarzenia/[...slug]` | prerendered |
> | `/prelegenci`, `/prelegenci/[...slug]` | prerendered |
> | `/` | on demand |
> | `/zglos-sie` | on demand |
> | `/api/newsletter-signup`, `/api/speaker-signup` | on demand |
>
> **Why it matters:** an on-demand serverless surface already exists, so adding stateful routes needs
> no serving-model change and threatens nothing about the prerendered content pages. The real gap is
> **persistence**, not the absence of a server. Open Question 1 below is therefore resolved; the
> residual question is tracked as Open Question 7 in `context/foundation/prd.md`.
>
> An intermediate correction in `stack-assessment.md` overstated this in the opposite direction
> ("there is no static build to preserve"). That was also wrong — the content routes *are*
> prerendered. Both `prd.md` and `stack-assessment.md` now say hybrid.
>
> Separately, `src/lib/slack.ts` is an existing integration that shaping missed; it is recorded in
> `prd.md`. And `/10x-health-check` found that the newsletter signup endpoint appears to be failing in
> production, which undercuts the Phase 3 guardrail asserting that both signup forms keep working.

## Current System Overview

**Purpose.** A Polish-language community website for Brave AI Community Szczecin — the hub for
event discovery, past-event browsing, speaker profiles, and community signup.

**Architecture.** Static site generation with two thin serverless API routes. No persistent
server-held state, no database, no authentication.
> `[CORRECTED]` Rendering is hybrid, not pure SSG — `output: "server"` with four content routes
> prerendered. See the post-session correction above. "No persistent server-held state, no database,
> no authentication" remains accurate.

**Tech stack.** Astro 6 (SSG) + TypeScript + Tailwind CSS 4, Bun runtime, deployed on Vercel via
`@astrojs/vercel`. Resend for transactional email. Luma (external) for event RSVPs. Content is
Markdown in the repo via Astro Content Collections.
> `[CORRECTED]` "Astro 6 (SSG)" should read "Astro 6 (`output: "server"` with per-route
> prerendering)". Two omissions also: a Slack webhook integration (`src/lib/slack.ts`) exists, and
> the content collections are Zod-validated in `src/content.config.ts`.

**Current user base.** Meetup attendees and prospective attendees, prospective speakers, and the
organizers who publish content by committing Markdown files. Rough scale: a Szczecin-local
community; 4 meetups published, 12 speakers in the directory.

**Core functionality today.**
- `/` — homepage with upcoming-event hero, recent events, newsletter signup
- `/wydarzenia`, `/wydarzenia/[slug]` — event archive and per-event pages with photo galleries
- `/prelegenci`, `/prelegenci/[slug]` — speaker directory and profiles
- `/zglos-sie` — speaker application form
- `/api/newsletter-signup`, `/api/speaker-signup` — Resend-backed form handlers

A separate PRD for this existing website already exists at `.ai/prd.md`. LiveQuiz is not covered
there; `.ai/live-quiz/` is an empty directory.

## Problem Statement & Motivation

Running an engaging live quiz segment during a meetup — the moment on stage when the host wants
the whole room on their phones at once — currently means reaching for Kahoot or Mentimeter. Those
tools are paid, require account creation, and route the host through an elaborate quiz-builder
wizard even when the need is exactly one hardcoded quiz for one evening.

Three things make building this non-obvious rather than redundant with the incumbents. First, the
quiz is community-branded content, not generic trivia — the question set is about BRAVE, the
hashtag, the hackathon, the partner lineup — and a third-party tool dilutes that moment. Second,
the people authoring the quiz here are developers, so a quiz defined in a file is genuinely faster
than any WYSIWYG builder; the wizard is the cost, not the convenience. Third, one evening a month
does not justify a recurring subscription priced for institutional use.

**Current workaround and its cost.** A paid third-party SaaS: a subscription bill, account
friction for the host, and a branded experience the community does not own.

**Trigger.** A 14-question quiz already drafted in `idea-notes.md`, written for a Summer Tour stop in
Szczecin and ending in a leaderboard reveal. No session is currently scheduled against it: the user
confirmed there is no fixed deadline and that a session will be booked once the tool works.

## User & Persona

**Primary persona — the host running the session.** The meetup organizer on stage, driving the
quiz from a large screen in front of a live room. They reach for this in the middle of an event,
with an audience waiting. Their success condition is that the session runs without them fighting
the tool in front of the room. Everything the tool asks of them competes with holding a room's
attention.

### Secondary persona — the attendee on their phone

A person in the audience who opens a link, types a name, and plays for roughly fifteen minutes on
their own device. They never create an account and never return to the tool afterward. The
measurable success criteria drafted in `idea-notes.md` (under 30 seconds from link to first
answer, 90% completion) are attendee-shaped, and serve the host's goal of an engaged room.

## Success Criteria

### Primary
- A full live session runs end to end: the host drives all 14 questions from a large screen while
  attendees play on their own phones, finishing with the final leaderboard reveal — without the host
  having to fight or troubleshoot the tool in front of the room. (Deliberate session control —
  advancing, revealing, showing standings — is the host's job by design; unplanned intervention is
  the failure this criterion rules out.)
- An attendee goes from opening the session link to submitting their first answer in under 30
  seconds. *(Binding.)*

### Secondary
- 90% of attendees who join answer the final question. An engagement outcome observed after a
  session rather than something the implementation guarantees; explicitly not binding for v1.

### Guardrails
- State propagates to every connected device in under 1 second. *(Binding.)*
- A session with 150 concurrent attendees loses no answers and shows no state divergence between
  devices. *(Binding.)* This is the most expensive requirement captured in these notes and it drove
  the release of the cost constraint below.

## User Stories

### US-01: An attendee joins a live session and plays it through

- **Given** a host has started a session and put its link on the large screen
- **When** an attendee opens that link on their phone and enters an unused display name
- **Then** they are in the session within 30 seconds and see the host's current question, answer it
  on their own device, see whether they were right and what they scored, and see the standings
  whenever the host shows them, through to the final reveal
- **Before this change**: no equivalent path existed; a live quiz segment required a paid
  third-party tool with account creation.

#### Acceptance Criteria
- A display name already in use is rejected with a prompt for a different one, not silently accepted
- Reloading or reopening the link on the same device resumes the same player with score intact
- Every question type in the quiz file is answerable from a phone
- The leaderboard shown to an attendee agrees with the one on the host's screen

### US-02: A host drives the session from the stage

- **Given** a quiz defined in a file in the repo and a room of attendees who have joined
- **When** the host advances through the questions and reveals results from the control view
- **Then** each question and each reveal reaches every connected device in under a second, with the
  aggregate of attendee answers displayed on the large screen
- **Before this change**: the host operated a third-party tool's presentation mode.

#### Acceptance Criteria
- Advancing a question does not require the host to wait for or chase stragglers
- The word-cloud question's aggregate visibly updates as answers arrive
- No answer submitted before a reveal is lost from the tally

## Scope of Change

Every item is `new`: none of this capability exists in the current system. No existing capability is
modified or removed by this change.

Each FR carries a `> Socrates:` blockquote from the Phase 4.5 challenge round: the strongest
counter-argument the user selected, and their resolution.

### Quiz definition
- FR-001: Organizer can define the quiz's questions, accepted answers, and scoring in a file in the repo, with no builder UI. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "only a developer can fix a typo minutes before showtime
  > — a wrong-reading question requires an edit, commit and deploy at the worst possible moment."
  > Resolution: kept unchanged. A non-developer edit path is the builder UI the product exists to
  > avoid. Recorded as an accepted operational risk.
- FR-017: Organizer can mark a question as unscored in the quiz definition. Priority: must-have. Change: new
  > Socrates: Added as the resolution to FR-012's challenge. Also closes the gap FR-010 left open:
  > the drafted Q2 ("Czy wszyscy są gotowi?") has every answer marked correct because it exists to
  > gather the room, not to test anyone.

### Session control (host)
- FR-002: Host can start the session. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "an explicit start is one more mode on stage, and one
  > more thing to be in the wrong one of." Resolution: kept. The deliberate start is what lets the
  > host gather the room before the first question.
- FR-003: Host can advance to the next question. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "a per-question timer would be fairer to fast answerers
  > and would free the host from judging when the room is done." Resolution: kept manual advance.
  > The host reading the room beats a fixed clock, and a timer is a whole extra mechanic.
- FR-004: Host can reveal the results of the current question. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "the reveal carries no judgement, so it's an extra click
  > on stage that could happen automatically." Resolution: kept manual. Controlling the reveal is
  > what lets the host build tension and talk over it.
- FR-005: Host can display, on the large screen, how many attendees have answered the current question while it is open, and the distribution of answers once it is revealed. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "showing the distribution while answering is open turns
  > the big screen into a cheat sheet — anyone glancing at it can follow the crowd." Resolution:
  > **FR revised.** While a question is open the screen shows only a count of answers received; the
  > distribution appears at reveal. Keeps the visible energy, removes the leak. Scope note: this
  > applies to scored questions with answer options. It does not override FR-015 — an unscored
  > word-cloud question has no correct answer to leak, so its aggregate may display live.
- FR-006: Host can trigger the final winner-reveal sequence. Priority: nice-to-have. Change: new
  > Socrates: No counter-argument; it stands as written. Already scoped as nice-to-have.

### Joining (attendee)
- FR-007: Attendee can join the session by opening a link and entering a display name, with no account. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "with no identity beyond a typed name, one person can
  > join ten times and farm the leaderboard, or flood the room with fake players and wreck the final
  > reveal." Resolution: FR-007 kept as written; a guard added as FR-018.
- FR-018: Attendee is prevented from registering an unreasonable number of players from a single device. Priority: must-have. Change: new
  > Socrates: Added as the resolution to FR-007's challenge. Explicitly a lightweight, defeatable
  > guard — not an identity system. Known cost: a shared phone or a venue hotspot could trip it.
- FR-008: Attendee is asked for a different name when the one they entered is already taken. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "rejection is a retry loop inside the one flow with a
  > binding 30-second target, and common first names will collide in a room of 150." Resolution:
  > kept rejection over auto-suffixing. An unambiguous leaderboard is worth one retry; a name the
  > attendee didn't choose is worse at the reveal moment.
- FR-009: Attendee can resume as the same player with score intact after reloading or reopening on the same device. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "device-scoped identity means a borrowed or shared phone
  > inherits someone else's score." Resolution: kept. A locked screen must not eliminate someone.

### Answering
- FR-010: Attendee can answer a single- or multiple-choice question and earn points for a correct selection. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "the drafted Q2 has every answer marked correct, and Q8
  > has two correct answers with no stated partial-credit rule." Resolution: FR stands as written.
  > The all-answers-correct case is handled by FR-017; the partial-credit rule was resolved in
  > Phase 5 as all-or-nothing (every correct option selected, no incorrect ones).
- FR-011: Attendee can submit a free-text answer, scored correct if it matches any accepted variant after normalization of case, surrounding whitespace, and Polish diacritics. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "typos and diacritics turn a knowledge question into a
  > spelling question, and arguing about it mid-segment costs more than the question was worth."
  > Resolution: **FR revised.** Normalization added on both sides before comparison. Deliberately
  > stops short of fuzzy matching, which would introduce a threshold the host would have to defend
  > out loud.
- FR-012: Attendee can submit one word to a word-cloud question. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "word clouds don't score, so the question sits outside
  > the competitive spine of the segment." Resolution: kept as an unscored question via FR-017,
  > which makes the absence of scoring explicit rather than accidental.
- FR-013: Attendee can submit a number to a guess-the-number question and earn points scaled by closeness. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "one distance rule can't span an answer of 67 and an
  > answer of 10,000 — being 30 off is catastrophic on one and a bullseye on the other."
  > Resolution: FR stands as written. The scaling rule was resolved in Phase 5: points scale by
  > relative error, which is magnitude-independent and so covers both drafted questions with one
  > rule.
- FR-019: Attendee earns a speed component on every scored answer, based on how quickly they answered measured from when the question reached their own device. Priority: must-have. Change: new
  > Origin: added in Phase 5. The user asked for time-based score allocation so that identical final
  > scores become effectively impossible, removing the need for a tie-breaking rule. This
  > deliberately reverses the `idea-notes.md` non-goal "zaawansowana punktacja (bonus za czas,
  > mnożniki, streaki)" — the time-bonus half of it only. Multipliers and streaks remain non-goals.

### Standings & feedback
- FR-014: Host can choose when to show the leaderboard between questions. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "a leaderboard beat after each of 14 questions lengthens
  > a segment meant to run short." Resolution: **FR revised.** The leaderboard becomes a
  > host-controlled beat rather than an automatic one after every question, handing pacing to the
  > host — consistent with FR-003 and FR-004 keeping manual control.
- FR-015: Host can display the live word cloud updating as attendees submit words. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "it's the most expensive view in the set, built for a
  > single question." Resolution: kept unchanged and the cost accepted. Watching your own word
  > appear on the big screen is the moment that proves the session is live.
- FR-016: Attendee can see, on their own device after each reveal, whether their answer was correct and how many points they earned. Priority: must-have. Change: new
  > Socrates: Counter-argument considered: "telling 150 people individually they were wrong invites
  > live objections, and the host cannot amend a question mid-session." Resolution: kept. The
  > personal feedback loop is what makes the next question matter.

## Constraints & Compatibility

*(Opened in Phase 1; revised in Phase 3; extended in Phases 5 and 6.)*

**Released constraint — hosting cost.** In Phase 1 the user named "hosting cost stays at zero /
hobby tier" as the single hard preservation constraint. In Phase 3, when the conflict between that
constraint and the 150-concurrent / sub-second-sync guardrails was surfaced, the user chose to keep
full scope and **release the zero-cost constraint** instead. Realtime fan-out and persistent session
state may therefore incur real, metered cost. Cost-neutrality is no longer binding.

**Consequence.** As of Phase 3 this change carries no hard preservation constraint. Nothing about
the existing system has been declared un-touchable.

**Unresolved.** Whether the existing site must remain a pure static build is deferred to the
downstream stack step (Open Question 1). Content and routing isolation is expected — existing pages
render identically and the Markdown-in-repo workflow continues — but the *serving* model may change.
> `[CORRECTED]` Resolved, and the premise was false: there is no pure static build to preserve or
> abandon. Rendering is already hybrid, so the serving model does **not** need to change — the
> homepage, `/zglos-sie`, and both endpoints already render on demand. Content and routing isolation
> holds as expected. What remains genuinely unresolved is where durable session state lives, since the
> project has no working persistence mechanism (`prd.md` Open Question 7).

**Blast radius as identified by the user.** The most consequential failure mode is not a broken
route but the tool failing in front of a full room: the blast radius is the live event and the
community's reputation, not the repository.

**Backward compatibility.** No existing API contract, data format, or URL changes. The two existing
API routes and their Resend integration are untouched by this change.

**Data migration.** None. This change introduces no persistent store for existing content, and
session data is not retained past the event (see Non-Functional Requirements).

**Existing integrations that must keep working.** Resend (newsletter and speaker-application
notifications) and Luma (outbound event links). Neither is touched by this change.

**Constraints imposed by the existing project** (Phase 6):
- Deploys happen automatically on push to `main`. There is no staging step and no deploy window; any
  new surface inherits that workflow.
- No CI pipeline exists in the repository, and this change is not obliged to introduce one.
- No monitoring or alerting exists. Nothing would page anyone if the quiz failed. Named explicitly
  as a known gap, which matters because the blast radius is a live event.
- The project's existing Node / Bun toolchain and its version floor (`node >= 22.12.0`) stay; the
  quiz works within that baseline rather than requiring a different runtime.

## Business Logic Changes

The existing system has no domain rule: it renders content that organizers commit to the repository.
This change **adds** the project's first domain rule.

**The rule.** The application scores each attendee's answer according to its question's type — exact
match for choice questions, normalized match against a list of accepted variants for free text,
points scaled by relative error for numeric guesses, and no score at all for questions marked
unscored — weights every scored answer by how quickly it was given, and maintains a live ranking of
all attendees from their running totals.

**Inputs.** What each attendee submits for the question currently open: a selection, a typed phrase,
a single word, or a number. Alongside it, how quickly they answered, measured from the moment the
question became visible on their own device rather than from the moment the host opened it, so that a
slower connection does not cost points.

**Outputs and how they're encountered.** Each submission yields a correctness verdict, a point
award, and a new position in the ranking. The attendee meets all three on their own phone right
after the host reveals the question; the room meets the ranking on the large screen when the host
chooses to show it. Specific rules settled during shaping: multi-answer questions are all-or-nothing
— every correct option selected and no incorrect ones; numeric guesses score by proportional
distance from the true value, so being ten percent off is worth the same on an answer of 67 as on an
answer of 10,000; and because every scored answer carries a speed weighting, two attendees finishing
on an identical total is effectively impossible, which is why no tie-breaking rule is specified.

## Non-Functional Requirements

- An attendee plays the whole session on the personal handheld device they arrived with, installing
  nothing; the host's view is legible from the back of a venue room.
- The interface is in Polish, consistent with the existing site and the drafted quiz content.
- No attendee's display name or submitted answer remains in operator-accessible storage after the
  session that collected it has ended.

## Access Control Changes

The existing site has no authentication, no accounts, and no roles: every page is public and
statically served, and the two API routes are unauthenticated form handlers. LiveQuiz introduces
the project's first role separation.
> `[CORRECTED]` "statically served" applies only to the four content routes; the homepage and
> `/zglos-sie` render on demand. The access-control substance is unaffected — every page is public and
> unauthenticated regardless of how it is rendered.

**Roles introduced.**
- **Host** — drives session flow (start, advance, reveal results) from a large screen.
- **Attendee** — joins, answers, sees their standing. Cannot influence session flow.

**Host access.** No protection. The control view is openly reachable; the room is trusted for the
duration of a single live session. The user considered and explicitly accepted the consequence:
anyone who obtains the control URL — including from a photograph of the host screen — can advance
or reset the session. Recorded as an accepted tradeoff, not an unresolved gap.

**Attendee access.** No accounts, no login, no passwords, no join code. An attendee opens the
session link, enters a display name, and is in.

**Identity within a session.** A display name identifies an attendee. Names are unique within a
session: a second attendee submitting a name already taken is rejected at join and asked for a
different one, so the leaderboard is unambiguous and every attendee can locate themselves on it.
An attendee returning on the same device after a reload or a screen lock resumes as the same
player with their accumulated score intact.

**Unchanged.** Existing site routes remain public and unauthenticated. No accounts or user records
are introduced for the existing site's users.

## Non-Goals

**Functional non-goals**
- **No quiz builder, admin panel, or question import/export.** Load-bearing: avoiding the builder is
  the reason this product exists rather than using an incumbent tool. Accepted cost is FR-001's
  recorded risk that only a developer can correct a question.
- **No accounts, no result history, no post-session analytics, reports, or exports.** Consistent with
  the retention requirement that nothing about who played survives the session.
- **No parallel sessions and no multiple quizzes.** One session, one quiz, one room at a time. This
  removes session management from the change entirely.
- **No multimedia in questions.** Questions are text only.

**Non-functional non-goals**
- **No word-cloud moderation.** Submissions reach the large screen unreviewed. The reputational risk
  of an offensive word on a projector at a branded community event was surfaced during the Socratic
  round and accepted.
- **No cost-neutrality guarantee.** Released in Phase 3 in favour of keeping the 150-concurrent and
  sub-second-sync guardrails binding.
- **No score multipliers and no streak bonuses.** The time-bonus half of the original
  advanced-scoring non-goal was deliberately reversed in Phase 5 (see FR-019); multipliers and
  streaks remain out of scope.
- **No native mobile applications.** The attendee experience is the web on the device they arrived
  with.

## Forward: stack assessment

Captured for the downstream stack step; not part of the PRD schema and not to be folded into PRD
sections.

- The existing project is Astro 6 SSG + Tailwind 4 on Bun, deployed to Vercel via `@astrojs/vercel`.
  This change needs persistent per-session state and sub-second fan-out to ~150 devices, which the
  current architecture provides no mechanism for. Whether the site can remain a pure static build is
  Open Question 1.
  > `[CORRECTED]` Not SSG but hybrid (`output: "server"` plus four prerendered content routes), so
  > there is no pure-static constraint to negotiate. The rest of this item stands and was the correct
  > call to forward: the architecture genuinely provides no mechanism for durable session state or
  > sub-second fan-out. `/10x-stack-assess` confirmed it and found the proof — the newsletter handler
  > writes to a serverless filesystem that discards it.
- The cost constraint has been released, so metered realtime services are permissible. No cost
  ceiling has been set (Open Question 3).
- `timeline_budget.delivery_weeks` is deliberately unset pending stack selection (Open Question 2).
- No CI and no monitoring exist today; the stack step should decide whether the live-event blast
  radius justifies introducing either.

## Quality cross-check

Run at the close of Phase 7. Status: **warned** — the user reviewed both gaps below and chose to
proceed. `/10x-prd` mirrors these into `## Open Questions`.

| Element | Result |
| --- | --- |
| Access Control | present |
| Business Logic (one-sentence rule) | present |
| Project artifacts | present |
| Timeline-cost acknowledged | **missing** |
| Non-Goals | present |
| Preserved behavior (brownfield) | **weak** |

**Gap — timeline-cost not acknowledged.** Full scope was kept (four question mechanics, all three
engineering targets binding) while `timeline_budget.delivery_weeks` is unset and no effort
acknowledgment was recorded. Consequence: the failure mode for a change of this shape is the gap
between expected and actual effort, and there is no written expectation to measure against. A
realtime state layer for 150 concurrent devices plus four question mechanics plus a host view is not
a small piece of work.

**Gap — preserved behavior is weak.** Constraints & Compatibility names real preservation
(no API contract changes, Resend and Luma untouched, no data migration), but all of it is
preservation *by construction* — true because the change sits elsewhere, not because it was chosen.
The one constraint actively chosen, zero hosting cost, was released in Phase 3. Consequence: this
brownfield change has nothing declared un-touchable, so there is no tripwire if the implementation
starts reshaping the existing site — and whether the site must stay a pure static build is deferred
rather than decided (Open Question 1).
> `[CORRECTED]` The static-build clause is void — there is no pure static build. The substance of this
> gap stands unchanged and was not resolved by the correction: preservation here is still incidental
> rather than chosen, and there is still no tripwire. `/10x-health-check` sharpened it further by
> finding that one preserved capability (the newsletter signup) appears to be broken already, so the
> Phase 3 guardrail asserting both signup forms keep working is protecting something that is not
> currently working.

## Open Questions

1. ~~**Is the existing site's static build genuinely allowed to change?**~~ — **RESOLVED, premise was
   false.** When asked what must not break, the user named only hosting cost, and did not select "the
   existing site keeps building and deploying as-is", "the two existing API routes keep working", or
   "the Markdown-in-repo content workflow". A live quiz needs persistent session state and sub-second
   fan-out to ~150 devices, which is a different runtime shape from the current SSG-plus-two-endpoints
   site. If those three are in fact preservation constraints, they belong in Constraints &
   Compatibility. In Phase 3 the user deferred this explicitly to the downstream stack step.
   > `[CORRECTED]` The site is not "SSG-plus-two-endpoints". Rendering is hybrid, so an on-demand
   > serverless surface already exists and nothing about the static build needs to change. Resolved in
   > `prd.md` Open Question 1. The genuine residual — where durable session state lives, given the
   > project has no working persistence — is `prd.md` Open Question 7.
   >
   > Worth noting this question did its job: routing the uncertainty to the stack step is exactly what
   > caused the premise to be checked and found false.
2. **How many weeks of work is full scope?** — The user's answer was "genuinely unknown until the
   stack is picked", so `timeline_budget.delivery_weeks` is unset. Working time is mixed (partly
   day-job, partly evenings). Owner: user, after stack selection. Blocks nothing, but the timeline
   gate could not pass on a number.
3. **What is the acceptable cost ceiling now that zero-cost is released?** — The constraint was
   released without a replacement figure. "Some cost is acceptable" is not a budget. Owner: user.
