---
project: "LiveQuiz"
version: 1
status: draft
created: 2026-08-05
context_type: brownfield
product_type: web-app
target_scale:
  users: medium
  qps: bursty — ~150 concurrent participants during a ~15-minute session, otherwise idle
  data_volume: small — a single session's answers, not retained after the event
timeline_budget:
  delivery_weeks: # TODO: delivery_weeks — see Open Questions
  hard_deadline: null
  after_hours_only: false
---

# PRD: LiveQuiz

## Current System Overview

**System purpose.** A Polish-language community website for Brave AI Community Szczecin — the hub
for event discovery, past-event browsing, speaker profiles, and community signup.

**Key architecture.** Hybrid rendering. `astro.config.ts` sets `output: "server"` with the Vercel
adapter, and content routes opt back into static generation per route via `export const prerender =
true`. The event archive and speaker directory (`/wydarzenia`, `/wydarzenia/[...slug]`,
`/prelegenci`, `/prelegenci/[...slug]`) are prerendered at build time; the homepage, the speaker
application page, and both form-handling endpoints render on demand on serverless functions. There is
no database and no authentication, and no working persistence mechanism — the newsletter handler
writes to a JSON file on the serverless filesystem, which cannot succeed there.

**Tech stack.** Astro 6.1 (`output: "server"` with per-route prerendering) with TypeScript in strict mode
(`extends: astro/tsconfigs/strict`) and Tailwind CSS 4 via the Vite plugin, on the Bun toolchain
(`node >= 22.12.0`), deployed to Vercel via `@astrojs/vercel`. Resend handles transactional email for
both signup forms; a Slack webhook posts notifications. Luma handles event RSVPs externally; the site
links out to it. Content is Markdown committed to the repository and read through Astro Content
Collections with Zod schemas. No test runner, linter, formatter, CI pipeline, monitoring, or alerting
exists.

**Current user base.** Meetup attendees and prospective attendees, prospective speakers, and the
organizers who publish content by committing Markdown files. Scale is a Szczecin-local community;
4 meetups and 12 speakers are published today.

**Core functionality today.**
- `/` — homepage with upcoming-event hero, recent events, newsletter signup
- `/wydarzenia`, `/wydarzenia/[slug]` — event archive and per-event pages with photo galleries
- `/prelegenci`, `/prelegenci/[slug]` — speaker directory and profiles
- `/zglos-sie` — speaker application form
- `/api/newsletter-signup`, `/api/speaker-signup` — email-backed form handlers

A PRD for this existing website exists separately at `.ai/prd.md`. It does not cover LiveQuiz.

## Problem Statement & Motivation

Running an engaging live quiz segment during a meetup — the moment on stage when the host wants the
whole room on their phones at once — currently means reaching for Kahoot or Mentimeter. Those tools
are paid, require account creation, and route the host through an elaborate quiz-builder wizard even
when the need is exactly one hardcoded quiz for one evening.

Three things make building this non-obvious rather than redundant with the incumbents. First, the
quiz is community-branded content, not generic trivia — the question set is about BRAVE, the
hashtag, the hackathon, the partner lineup — and a third-party tool dilutes that moment. Second, the
people authoring the quiz here are developers, so a quiz defined in a file is genuinely faster than
any builder interface; the wizard is the cost, not the convenience. Third, one evening a month does
not justify a recurring subscription priced for institutional use.

**Current workaround and its cost.** A paid third-party subscription service: a recurring bill,
account friction for the host, and a branded experience the community does not own.

**Why now.** A 14-question quiz is already drafted, written for a Summer Tour stop in Szczecin and
ending in a leaderboard reveal. No session is currently scheduled against it — there is no fixed
deadline, and a session will be booked once the capability works.

## User & Persona

**Primary persona — the host running the session.** The meetup organizer on stage, driving the quiz
from a large screen in front of a live room. They reach for this in the middle of an event, with an
audience waiting. Their success condition is that the session runs without them fighting the tool in
front of the room. Everything the tool asks of them competes with holding a room's attention. This
is a new capability for an existing user: today the same organizer publishes content by committing
Markdown, a calm asynchronous act with no audience watching.

### Secondary persona — the attendee on their phone

A person in the audience who opens a link, enters a name, and plays for roughly fifteen minutes on
their own device. They never create an account and never return to the tool afterward. Today this
person is a passive reader of the site's event pages; this change makes them an active participant
during an event.

## Success Criteria

### Primary
- A full live session runs end to end: the host drives all 14 questions from a large screen while
  attendees play on their own phones, finishing with the final leaderboard reveal — without the host
  having to fight or troubleshoot the tool in front of the room. Deliberate session control
  (advancing, revealing, showing standings) is the host's job by design; unplanned intervention is
  the failure this criterion rules out.
- An attendee goes from opening the session link to submitting their first answer in under 30
  seconds.

### Secondary
- 90% of attendees who join answer the final question. An engagement outcome observed after a
  session rather than something the implementation guarantees; explicitly not binding for this
  change.

### Guardrails
- Every attendee's screen reflects the host's current question or reveal within 1 second of the host
  acting.
- A session with 150 concurrent attendees loses no submitted answer and shows no divergence in
  standings between devices. This is the most expensive requirement in this PRD and it drove the
  release of the cost constraint recorded under Constraints & Compatibility.
- An attendee plays the whole session on the personal handheld device they arrived with, installing
  nothing; the host's view is legible from the back of a venue room.
- The interface is in Polish, consistent with the existing site and the drafted quiz content.
- No attendee's display name or submitted answer remains in operator-accessible storage after the
  session that collected it has ended.
  > **Delivered with two recorded deviations (F-03, 2026-08-06).** Both are stated here rather than
  > by rewording the guardrail, because the value of the entry is that the gap stays visible.
  >
  > *Deviation 1 — a deliberate ten-minute window.* Ending a session shortens every key's lifetime
  > to ~10 minutes rather than deleting immediately, so a device that reloads right after the
  > closing beat still finds the final standings. On a strict reading of the sentence above that is
  > a deviation, not a satisfaction. Counter-argument considered: "the guardrail says *after it has
  > ended*, and ten minutes is after." Resolution: kept, because the alternative — a leaderboard
  > that vanishes the instant the host clicks — damages the moment the segment is built toward,
  > and the window is bounded, self-expiring and escapable. A host who wants the room's data gone
  > immediately has an explicit purge that deletes on the spot. Accepted cost: for those minutes
  > the guardrail is satisfied by an expiry rather than by a deletion.
  >
  > *Deviation 2 — an involuntary ~2-minute floor at the realtime provider.* Session state is
  > published to Ably on every host action, and Ably retains messages for roughly two minutes for
  > connection recovery regardless of the persistence setting (measured, not assumed —
  > `context/archive/2026-08-06-session-end-and-data-purge/ably-retention-probe.md`). Message persistence *is*
  > disabled for the namespace; this floor cannot be reduced further by configuration. Unlike
  > deviation 1 this was not chosen, and the only way to remove it is to keep names out of published
  > snapshots entirely — a decision handed to S-02 in
  > `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`.
  >
  > **Corrected 2026-08-08 (S-02).** This entry previously read "From S-02, when snapshots begin
  > carrying display names, that window applies to them." That is now counterfactual and would have
  > overstated the deviation: **S-02 took the remedy.** No display name is ever published. The
  > session document gained exactly one field, `playerCount` — a count, not attendee data — so the
  > ~2-minute Ably window applies to no name. Names live in `livequiz:players`, which `end` re-arms
  > and `purge` deletes, and a device knows only its own. The original sentence is quoted here rather
  > than silently rewritten, so the expectation and its reversal both stay visible.
  >
  > **S-07 inherits the open half.** A leaderboard needs names on 150 screens, and how they get there
  > is that slice's decision — publish them and accept the window, or publish opaque ids and have each
  > device resolve only itself. S-02 deliberately did not decide it by accident on S-07's behalf. See
  > `context/archive/2026-08-07-join-and-follow-host/join-contract.md`.
  >
  > **Amended 2026-08-11 (S-07).** The open half is now decided: **display names are published.** The
  > sentence above — "No display name is ever published" — remains true about S-02 and is false from
  > S-07; it is quoted rather than rewritten for the same reason S-02 quoted its own predecessor.
  >
  > The session document gained a `standings` field carrying the leaderboard the host shows between
  > questions: **at most five rows of `{ rank, displayName, points }`, and no player id.** The bound is
  > what makes it defensible — five names, not 150 — and the id is excluded because publishing the
  > credential of the five most impersonation-worthy attendees in the room is not a trade anyone can
  > defend. Nothing else about who played reaches the wire: what an attendee typed, their own total and
  > their own position are per-device and travel on `/api/quiz/result`.
  >
  > *What was rejected, and why.* The alternative was keeping names off the wire and having each device
  > fetch the board — ~150 requests per beat against a store whose monthly command counter already has
  > an unexplained baseline two orders of magnitude above what the code accounts for
  > (`context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md`), on the one
  > network nobody controls. It also could not hold the guardrail it was meant to serve: 150 independent
  > fetches can disagree, while one published board cannot.
  >
  > *The exposure is NOT the ~2-minute Ably window, and the planning for this slice got that wrong
  > before implementation review caught it.* The binding surface is **`GET /api/quiz/state`**, which is
  > deliberately unauthenticated and returns the whole session document. So the five names are readable
  > by anyone holding the attendee URL for **as long as the host leaves the board up** — the field
  > survives on the document until the next host action — which is longer than two minutes and is a
  > different mechanism from the retention floor this deviation was originally about.
  >
  > That is accepted rather than mitigated. The board is on a projector in front of the room at the
  > moment it is readable, this PRD already accepts both an open token endpoint and an unprotected host
  > view on the same "the room is trusted for one session" reasoning, and the alternative — stripping
  > the field from that route — would leave any device on the connection-limit polling fallback looking
  > at a standings phase with no board in it. Names still reach no log line (`LogFields` has no field
  > one would fit in) and still live in `livequiz:players`, which `end` re-arms and `purge` deletes.
  > See `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`.
  >
  > **Amended 2026-08-14 (S-10). The same five names now also ride the *terminal* document, and the
  > window changed shape.** FR-006's closing beat lands the segment on the leaderboard, so
  > `endedSessionState` carries a `standings` field instead of clearing it. The bound is unchanged — at
  > most five rows of `{ rank, displayName, points }`, still no player id — and the binding surface is
  > again `GET /api/quiz/state`, not the Ably floor.
  >
  > What is *new* is the window's bound. In the `standings` phase the names are readable for as long as
  > the host leaves the board up — an interval a person controls and can shorten by acting. On the
  > terminal document they are readable for `ENDED_TTL_SECONDS` (~10 minutes) whatever anyone does,
  > because that is how long the closing screen has to survive for a reloading attendee to find their
  > result. **Bounded by a TTL rather than by attention** is the honest way to state the difference, and
  > it is stated here rather than folded into the S-07 paragraph because that entry's reasoning does not
  > cover it.
  >
  > Accepted rather than mitigated, for two reasons. The same five names reached the same devices minutes
  > earlier during the leaderboard beat, so the set is not new — only its residency is. And both fixes
  > break something built on purpose: shortening the TTL removes the ten-minute window Deviation 1 above
  > accepted *deliberately*, and stripping the field from the state route recreates the failure S-07
  > already rejected it for. What an attendee typed, their own total and their own position remain
  > per-device on `/api/quiz/result`; names still reach no log line and still live in `livequiz:players`,
  > which `end` re-arms and `purge` deletes. See
  > `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md`.
  >
  > **Checked and unchanged 2026-08-14 (S-08).** The word cloud publishes **nothing**: it added no
  > snapshot field and no phase, and its aggregate reaches the projector through a host-secret-gated
  > poll of `GET /api/quiz/host/words` rather than over Ably. So neither deviation above widens, and the
  > sentence "display names are published" still describes exactly five leaderboard rows and nothing
  > else. A word carries no name and is not joinable to one.
  >
  > *One thing did change, and it is recorded here rather than only in the code.* `livequiz:tallies`
  > used to hold nothing but integer counters and its registry entry said so — "NOT attendee data, the
  > first registered key that is not". The word cloud's counters are keyed by the **word itself**, so
  > that key now holds attendee-authored text in its field names. It remains keyed by no player id and
  > no display name, so nothing in it says *who* wrote anything; it is in the registry, so `end` re-arms
  > it and `purge` deletes it; and it reaches no log line. The guardrail above is therefore still
  > satisfied on the same terms — but the claim that one registered key was free of attendee content is
  > no longer true, and the entry in `src/lib/session/keys.ts` was corrected in place rather than
  > quietly reworded.
  >
  > *And the consequence for Deviation 1, asked rather than assumed (impl review F8).* `end` re-arms
  > every registered key to ten minutes, so that window — reasoned about in F-03 when this key held
  > nothing but integers — now covers attendee-authored words too. **Accepted, on Deviation 1's own
  > terms**: the words are aggregate, keyed by no player id and no display name, so nothing in them
  > says who wrote what; the window is bounded, self-expiring, and escapable by the explicit purge.
  > The alternative was deleting the word family at `end` instead of re-arming it, which adds a branch
  > to the one Lua path whose failure mode is "the session never ends" in order to shorten a window
  > that carries no name. See `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md`.
- Every capability the existing site provides today continues to work unchanged: event browsing,
  speaker profiles, both signup forms, and the practice of publishing content by committing Markdown.

## User Stories

### US-01: An attendee joins a live session and plays it through

- **Given** a host has started a session and put its link on the large screen
- **When** an attendee opens that link on their phone and enters an unused display name
- **Then** they are in the session within 30 seconds and see the host's current question, answer it
  on their own device, see whether they were right and what they scored, and see the standings
  whenever the host shows them, through to the final reveal
- **Before this change**: no equivalent path existed. A live quiz segment required a paid
  third-party tool with account creation.

#### Acceptance Criteria
- A display name already in use is rejected with a prompt for a different one, not silently accepted
- Reloading or reopening the link on the same device resumes the same player with score intact
- Every question type present in the quiz definition is answerable from a handheld device
- The standings shown to an attendee agree with the standings on the host's screen

### US-02: A host drives the session from the stage

- **Given** a quiz definition authored alongside the project's source, and a room of attendees who
  have joined
- **When** the host advances through the questions and reveals results from the control view
- **Then** each question and each reveal reaches every connected device within a second, with the
  aggregate of attendee answers shown on the large screen
- **Before this change**: the host operated a third-party tool's presentation mode.

#### Acceptance Criteria
- Advancing a question does not require the host to wait for or chase stragglers
- While a scored question is open the large screen shows how many have answered but not what they
  chose; the distribution appears only at reveal
- The word-cloud question's aggregate visibly updates as answers arrive
  > **Delivered 2026-08-14 (S-08).** It updates by the projector **polling**, ~2.5 s, not by broadcast:
  > a display that fills continuously has no host action to ride, and one snapshot to 150 clients bills
  > as 150 messages against a 100/second ceiling. "Visibly updates" is therefore true within a poll tick
  > rather than instantly, which is the trade this criterion was met by and is worth stating plainly.
- No answer submitted before a reveal is lost from the tally

## Scope of Change

Every item below is `[new]`: none of this capability exists in the current system. No existing
capability is modified or removed by this change. Each requirement carries the Socratic
counter-argument raised during shaping and its resolution.

### Quiz definition
- `[new]` FR-001: Organizer can define the quiz's questions, accepted answers, and scoring in a file authored alongside the project's source, with no builder interface. Priority: must-have.
  > Socrates: Counter-argument considered: "only a developer can fix a typo minutes before showtime
  > — a wrong-reading question requires an edit, commit and deploy at the worst possible moment."
  > Resolution: kept unchanged. A non-developer edit path is the builder interface the product exists
  > to avoid. Recorded as an accepted operational risk.
- `[new]` FR-017: Organizer can mark a question as unscored in the quiz definition. Priority: must-have.
  > Socrates: Added as the resolution to FR-012's challenge. Also closes the gap FR-010 left open:
  > the drafted Q2 ("Czy wszyscy są gotowi?") has every answer marked correct because it exists to
  > gather the room, not to test anyone.

### Session control (host)
- `[new]` FR-002: Host can start the session. Priority: must-have.
  > Socrates: Counter-argument considered: "an explicit start is one more mode on stage, and one
  > more thing to be in the wrong one of." Resolution: kept. The deliberate start is what lets the
  > host gather the room before the first question.
- `[new]` FR-003: Host can advance to the next question. Priority: must-have.
  > Socrates: Counter-argument considered: "a per-question timer would be fairer to fast answerers
  > and would free the host from judging when the room is done." Resolution: kept manual advance.
  > The host reading the room beats a fixed clock, and a timer is a whole extra mechanic.
  >
  > **Half-reversed 2026-08-15 by FR-020 (S-11).** The resolution above is kept rather than
  > deleted, so a reader meets the position that was overturned and can see exactly how much of
  > it was. What survives: advancing is still manual, and so are revealing, the leaderboard beat
  > and the close — no clock moves the session. What was reversed: a scored question now stops
  > *accepting answers* on a budget authored per question. The clock bounds answering; it does
  > not pace the segment, and the host reading the room is still what decides when to move on.
- `[new]` FR-004: Host can reveal the results of the current question. Priority: must-have.
  > Socrates: Counter-argument considered: "the reveal carries no judgement, so it's an extra click
  > on stage that could happen automatically." Resolution: kept manual. Controlling the reveal is
  > what lets the host build tension and talk over it.
- `[new]` FR-005: Host can display, on the large screen, how many attendees have answered the current question while it is open, and the distribution of answers once it is revealed. Priority: must-have.
  > Socrates: Counter-argument considered: "showing the distribution while answering is open turns
  > the big screen into a cheat sheet — anyone glancing at it can follow the crowd." Resolution:
  > **FR revised.** While a question is open the screen shows only a count of answers received; the
  > distribution appears at reveal. Keeps the visible energy, removes the leak. Scope note: this
  > applies to scored questions with answer options. It does not override FR-015 — an unscored
  > word-cloud question has no correct answer to leak, so its aggregate may display live.
- `[new]` FR-006: Host can trigger the final winner-reveal sequence. Priority: nice-to-have.
  > Socrates: No counter-argument; it stands as written. Already scoped as nice-to-have.

### Joining (attendee)
- `[new]` FR-007: Attendee can join the session by opening a link and entering a display name, with no account. Priority: must-have.
  > Socrates: Counter-argument considered: "with no identity beyond a typed name, one person can
  > join ten times and farm the leaderboard, or flood the room with fake players and wreck the final
  > reveal." Resolution: FR-007 kept as written; a guard added as FR-018.
- `[new]` FR-018: Attendee is prevented from registering an unreasonable number of players from a single device. Priority: must-have.
  > Socrates: Added as the resolution to FR-007's challenge. Explicitly a lightweight, defeatable
  > guard — not an identity system. Known cost: a shared handset or a venue network could trip it.
- `[new]` FR-008: Attendee is asked for a different name when the one they entered is already taken. Priority: must-have.
  > Socrates: Counter-argument considered: "rejection is a retry loop inside the one flow with a
  > binding 30-second target, and common first names will collide in a room of 150." Resolution:
  > kept rejection over auto-suffixing. An unambiguous leaderboard is worth one retry; a name the
  > attendee didn't choose is worse at the reveal moment.
- `[new]` FR-009: Attendee can resume as the same player with score intact after reloading or reopening on the same device. Priority: must-have.
  > Socrates: Counter-argument considered: "device-scoped identity means a borrowed or shared
  > handset inherits someone else's score." Resolution: kept. A locked screen must not eliminate
  > someone.

### Answering
- `[new]` FR-010: Attendee can answer a single- or multiple-choice question and earn points for a correct selection. Priority: must-have.
  > Socrates: Counter-argument considered: "the drafted Q2 has every answer marked correct, and Q8
  > has two correct answers with no stated partial-credit rule." Resolution: FR stands as written.
  > The all-answers-correct case is handled by FR-017; the partial-credit rule is all-or-nothing
  > (every correct option selected, no incorrect ones) — see Business Logic Changes.
- `[new]` FR-011: Attendee can submit a free-text answer, judged correct if it matches any accepted variant irrespective of letter case, surrounding spacing, or Polish diacritics. Priority: must-have.
  > Socrates: Counter-argument considered: "typos and diacritics turn a knowledge question into a
  > spelling question, and arguing about it mid-segment costs more than the question was worth."
  > Resolution: **FR revised.** Matching is insensitive to case, surrounding spacing and diacritics.
  > Deliberately stops short of tolerating misspellings, which would introduce a threshold the host
  > would have to defend out loud.
- `[new]` FR-012: Attendee can submit one word to a word-cloud question. Priority: must-have.
  > Socrates: Counter-argument considered: "word clouds don't score, so the question sits outside
  > the competitive spine of the segment." Resolution: kept as an unscored question via FR-017,
  > which makes the absence of scoring explicit rather than accidental.
- `[new]` FR-013: Attendee can submit a number to a guess-the-number question and earn points scaled by closeness. Priority: must-have.
  > Socrates: Counter-argument considered: "one distance rule can't span an answer of 67 and an
  > answer of 10,000 — being 30 off is catastrophic on one and a bullseye on the other."
  > Resolution: FR stands as written. Points scale by relative error, which is magnitude-independent
  > and so covers both drafted questions with one rule — see Business Logic Changes.
- `[new]` FR-019: Attendee earns a speed component on every scored answer, based on how quickly they answered measured from when the question became visible on their own device. Priority: must-have.
  > Origin: added during shaping. The user asked for time-based score allocation so that identical
  > final scores become effectively impossible, removing the need for a tie-breaking rule. This
  > deliberately reverses the original non-goal "zaawansowana punktacja (bonus za czas, mnożniki,
  > streaki)" — the time-bonus half of it only. Multipliers and streaks remain non-goals.
- `[new]` FR-020: Each scored question carries a time budget, authored per question, after which it stops accepting answers; attendees and the room can see how long is left. Priority: must-have.
  > Origin: added 2026-08-15 (S-11) at the user's request — "for every question we should have
  > specific time slot".
  >
  > **This reverses half of FR-003's rejection, and the half matters.** That resolution refused a
  > timer on the ground that "the host reading the room beats a fixed clock, and a timer is a
  > whole extra mechanic". The clock added here moves nothing: it does not advance, reveal, show
  > the leaderboard or end the session, and there is no automatic transition anywhere. It closes
  > the *submission window* on a question the host opened and will close themselves. FR-002,
  > FR-003, FR-004 and FR-014 are all unchanged in substance.
  >
  > **Two clocks now exist and they are deliberately different.** FR-019's speed component is
  > measured per device from its own first paint, so a slow connection costs no points. This
  > budget is measured from the host's advance and is shared, so one clock is true for the whole
  > room and the projector cannot disagree with a phone. Merging them would break one guarantee
  > or the other.
  >
  > A budget shorter than the 20-second speed window is legal but compresses the reward curve;
  > every authored value sits at or above it. Unscored questions carry no budget at all — the
  > word cloud fills until the host reveals it, which FR-015 depends on.
  >
  > **Nothing new is published.** The deadline is derived from the session document's existing
  > `updatedAt` plus the authored limit, so no field is added to the broadcast snapshot and no
  > new key exists. The retention deviation chain above therefore needs no entry for this change:
  > its subject is what rides the wire about who played, and nothing here does.
  >
  > Known cost, accepted: an attendee who is reading slowly, or who is on the connection
  > fallback and thus a few seconds behind, has less usable time than the budget suggests. The
  > enforced cutoff sits a short grace past the visible zero so an answer already in flight is
  > not lost, and that grace is deliberately not disclosed to devices.

### Standings & feedback
- `[new]` FR-014: Host can choose when to show the leaderboard between questions. Priority: must-have.
  > Socrates: Counter-argument considered: "a leaderboard beat after each of 14 questions lengthens
  > a segment meant to run short." Resolution: **FR revised.** The leaderboard becomes a
  > host-controlled beat rather than an automatic one after every question, handing pacing to the
  > host — consistent with FR-003 and FR-004 keeping manual control.
  >
  > **The consistency clause survives FR-020 (S-11), narrowed.** Manual pacing is still a
  > property the design holds across FR-002, FR-003, FR-004 and this FR: every *transition* is a
  > deliberate host act, and nothing in the session moves on a clock. What FR-020 added bounds
  > answering inside a question the host opened and will close themselves. Read the clause as
  > being about who moves the session, which is what it was always doing work for.
- `[new]` FR-015: Host can display the word cloud updating as attendees submit words. Priority: must-have.
  > Socrates: Counter-argument considered: "it's the most expensive view in the set, built for a
  > single question." Resolution: kept unchanged and the cost accepted. Watching your own word
  > appear on the big screen is the moment that proves the session is live.
- `[new]` FR-016: Attendee can see, on their own device after each reveal, whether their answer was correct and how many points they earned. Priority: must-have.
  > Socrates: Counter-argument considered: "telling 150 people individually they were wrong invites
  > live objections, and the host cannot amend a question mid-session." Resolution: kept. The
  > personal feedback loop is what makes the next question matter.

## Constraints & Compatibility

**Backward compatibility.** No existing interface contract, content format, or address changes. Both
existing signup form handlers behave exactly as they do today, and every existing page continues to
render as it does now.

**Data migration.** None. This change introduces no new store for existing content, and session data
is not retained past the event (see Success Criteria guardrails).

**Existing integrations that must continue working.** The transactional-email integration behind both
signup forms, the webhook that posts notifications to the team's chat workspace, and the outbound
links to the external event-RSVP service. None is touched by this change. All are named under Current
System Overview.

**Preserved behavior.** Every capability the site provides today: event archive and per-event pages,
speaker directory and profiles, the speaker application form, the newsletter signup, and the practice
of publishing content by committing Markdown. Existing pages remain openly reachable and require no
sign-in.

**Released constraint — cost neutrality.** During shaping the user first named "hosting cost stays at
zero" as the single hard preservation constraint. When the conflict between that constraint and the
150-concurrent and one-second guardrails was surfaced, the user chose to keep full scope and release
the cost constraint instead. Delivering this change may therefore incur real, metered running cost.
Cost neutrality is no longer binding, and no replacement ceiling has been set — see Open Questions.

**Consequence of that release.** This change carries no constraint the user actively chose to
protect. The preserved behavior listed above holds because the change sits alongside the existing
site rather than because it was selected as untouchable.

**Known operational gap.** The most consequential failure mode identified during shaping is not a
broken page but the capability failing in front of a full room: the blast radius is the live event and
the community's reputation, not the repository. Nothing exists today that would alert anyone to such
a failure.

## Business Logic Changes

The existing system applies no domain rule: it renders content that organizers commit. This change
**adds** the project's first domain rule.

**The rule.** The product scores each attendee's answer according to its question's type — exact match
for choice questions, match against a list of accepted variants for free text, points scaled by
relative error for numeric guesses, and no score at all for questions marked unscored — weights every
scored answer by how quickly it was given, and maintains a live ranking of all attendees from their
running totals.

**Inputs.** What each attendee submits for the question currently open: a selection, a typed phrase, a
single word, or a number. Alongside it, how quickly they answered, measured from the moment the
question became visible to them rather than from the moment the host opened it, so that a slower
connection does not cost points.

**Outputs and how they are encountered.** Each submission yields a correctness verdict, a point award,
and a new position in the ranking. The attendee meets all three on their own device right after the
host reveals the question; the room meets the ranking on the large screen when the host chooses to
show it. Rules settled during shaping: multi-answer questions are all-or-nothing, requiring every
correct option and no incorrect ones; numeric guesses score by proportional distance from the true
value, so being ten percent off is worth the same on an answer of 67 as on an answer of 10,000; and
because every scored answer carries a speed weighting, two attendees finishing on an identical total
is effectively impossible, which is why no tie-breaking rule is specified.

## Access Control Changes

The existing site has no authentication, no accounts, and no roles: every page is public and every
form handler is unauthenticated. This change introduces the project's first role separation.

**Roles introduced.**
- **Host** — drives session flow (start, advance, reveal, show standings) from a large screen.
- **Attendee** — joins, answers, and sees their standing. Cannot influence session flow.

**Host access.** No protection. The control view is openly reachable, and the room is trusted for the
duration of a single live session. The user considered and explicitly accepted the consequence: anyone
who obtains the control address — including from a photograph of the host screen — can advance or
reset the session. Recorded as an accepted tradeoff, not an unresolved gap.

**Attendee access.** No accounts, no sign-in, no passwords, no join code. An attendee opens the session
link, enters a display name, and is in.

**Identity within a session.** A display name identifies an attendee. Names are unique within a
session: a second attendee submitting a name already taken is rejected at join and asked for a
different one, so the leaderboard is unambiguous and every attendee can locate themselves on it. An
attendee returning on the same device after a reload or a screen lock resumes as the same player with
their accumulated score intact.

**Unchanged.** Existing site pages remain public and require no sign-in. No accounts or user records
are introduced for the existing site's users.

## Non-Goals

**Functional non-goals**
- **No quiz builder, admin panel, or question import/export.** Load-bearing: avoiding the builder is
  the reason this capability is being built rather than rented. The accepted cost is FR-001's recorded
  risk that only a developer can correct a question.
- **No accounts, no result history, no post-session analytics, reports, or exports.** Consistent with
  the guardrail that nothing about who played survives the session.
- **No parallel sessions.** One session, one room at a time. This removes session management from the
  change entirely.

  **The multiple-quizzes change overturned half of this**, and the position it replaced is quoted
  rather than deleted: *"No parallel sessions and no multiple quizzes. One session, one quiz, one room
  at a time."* Several quizzes now live in a registry, each with its own slug, title and four-digit
  join code, and the session records which one it is running. Parallel *sessions* remain out of
  scope — and that is what keeps the `livequiz:` key registry untouched, since with one session there
  is nothing for a key name to disambiguate. **FR-001 is unaffected:** selecting among committed,
  developer-authored definitions is not a builder interface.
- **No multimedia in questions.** Questions are text only.

**Non-functional non-goals**
- **No moderation of word-cloud submissions.** Submissions reach the large screen unreviewed. The
  reputational risk of an offensive word on a projector at a branded community event was surfaced
  during shaping and accepted.
- **No cost-neutrality guarantee.** Released in favour of keeping the 150-concurrent and one-second
  guardrails binding.
- **No score multipliers and no streak bonuses.** The time-bonus half of the original
  advanced-scoring non-goal was deliberately reversed (see FR-019); multipliers and streaks remain
  out of scope.
- **No host override of a question's time budget.** No extend, no pause, no "+15 seconds" on the
  host view (FR-020). Not an ergonomic call: extending a deadline means writing the session
  document while a question is open, which moves the timestamp the speed clamp measures every
  award against — inflating every award after it *and* granting time nobody authored, with
  nothing on any screen to say either happened. Changing a budget is an edit to the definition
  and a deploy, exactly as changing a question is.
- **No automatic transitions.** Nothing in the session advances, reveals, shows the leaderboard or
  ends on a clock or a schedule. FR-020's budget closes a submission window and moves nothing.
- **No native mobile applications.** The attendee experience is the web on the device they arrived
  with.
- **No change to how existing content is authored or published.** The Markdown-in-repository workflow
  is out of scope for this change.

## Open Questions

1. **~~May the existing site's serving model change?~~ — RESOLVED.** The question assumed the site
   was wholly statically generated and therefore fragile to a change requiring server-held state.
   Rendering is in fact hybrid: `output: "server"` with the Vercel adapter, and the four content
   routes opting into build-time prerendering. An on-demand serverless surface therefore already
   exists — the homepage, `/zglos-sie`, and both API endpoints run per request — so adding
   server-rendered, stateful routes for this change requires no serving-model change and threatens
   nothing about how the prerendered content pages are built or served. What the site genuinely lacks
   is a *persistence* mechanism, not a server. The residual question is narrower and is tracked as
   Open Question 7. Retained here rather than deleted so the reversal is visible.

   *Revision history for this entry:* first resolved during stack assessment with the overstatement
   "there is no static build to preserve", which was wrong — the content routes are prerendered.
   Corrected after auditing every route's `prerender` export.
2. **How many weeks of work is full scope?** — The user's answer was "genuinely unknown until the
   stack is picked", so `timeline_budget.delivery_weeks` is unset in this PRD's frontmatter. Working
   time is mixed: partly day-job, partly evenings. Owner: user, after stack selection. Block: no.
3. **What is the acceptable running-cost ceiling now that cost neutrality is released?** — The
   constraint was released without a replacement figure. "Some cost is acceptable" is not a budget,
   and the 150-concurrent guardrail is the requirement most likely to consume it. Owner: user.
   Block: no.
4. **Timeline cost was never acknowledged against a number.** — Mirrored from the shaping quality
   cross-check. Full scope was kept (four question mechanics, all three engineering targets binding)
   with no effort estimate and no recorded acknowledgment. Consequence: the failure mode for a change
   of this shape is the gap between expected and actual effort, and there is no written expectation to
   measure against. Owner: user. Block: no.
5. **Preserved behavior is asserted rather than chosen.** — Mirrored from the shaping quality
   cross-check. The preservation recorded under Constraints & Compatibility is true because the change
   sits alongside the existing site, not because any of it was selected as untouchable; the one
   constraint actively chosen (cost neutrality) was released. Consequence: there is no tripwire if
   implementation starts reshaping the existing site. Owner: user. Block: no.
6. **What partial-credit behavior applies if a future question has more than two correct options?** —
   The all-or-nothing rule is settled for the drafted quiz, where the multi-answer question has
   exactly two correct options. Whether all-or-nothing stays tolerable as option counts grow was not
   discussed. Owner: user. Block: no.
7. **Where does session state live, given the project has no working persistence today?** — Raised
   during stack assessment, replacing the narrower part of Open Question 1. `src/lib/subscribers.ts`
   writes newsletter subscribers to a JSON file on the serverless filesystem, which does not survive
   between invocations — so the project has no persistence that works in production, and this change
   needs both durable session state and sub-second fan-out to roughly 150 devices. Whether the
   existing newsletter persistence gets fixed as part of this work or stays as-is is a separate
   decision. Owner: user, informed by stack assessment. Block: no — but it is the largest unknown in
   this change.
