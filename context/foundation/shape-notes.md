---
project: "LiveQuiz"
context_type: brownfield
created: 2026-08-05
updated: 2026-08-05
checkpoint:
  current_phase: 3
  phases_completed: [1, 2]
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
  frs_drafted: 0
  quality_check_status: pending
---

# Shape notes — LiveQuiz

Seed input: `idea-notes.md` (read verbatim, 2026-08-05). Context type auto-detected as brownfield
(28 commits of git history, `bun.lock`, `astro.config.ts`, `src/`, `vercel.json`) and confirmed by the user.

Body sections below anticipate the 11 brownfield PRD sections defined in
`.claude/skills/10x-shape/references/prd-schema.md`.

## Current System Overview

**Purpose.** A Polish-language community website for Brave AI Community Szczecin — the hub for
event discovery, past-event browsing, speaker profiles, and community signup.

**Architecture.** Static site generation with two thin serverless API routes. No persistent
server-held state, no database, no authentication.

**Tech stack.** Astro 6 (SSG) + TypeScript + Tailwind CSS 4, Bun runtime, deployed on Vercel via
`@astrojs/vercel`. Resend for transactional email. Luma (external) for event RSVPs. Content is
Markdown in the repo via Astro Content Collections.

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

**Trigger.** A concrete upcoming session — the Summer Tour stop in Szczecin — with a 14-question
quiz already drafted in `idea-notes.md`, ending in a leaderboard reveal.

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

## Constraints & Compatibility

*(Opened in Phase 1; extended in Phases 5 and 6.)*

**Preserved behavior — explicitly named by the user:**
- Hosting cost stays at zero / hobby tier. The change must not push the project onto a paid plan
  or introduce a metered service with a real bill. Named as a hard constraint, not a preference.

**Not selected as must-preserve** (recorded because their absence is itself a decision — see Open
Questions): the existing site continuing to build and deploy unchanged; the two existing API
routes and their Resend integration; the Markdown-in-repo content workflow.

## Access Control Changes

The existing site has no authentication, no accounts, and no roles: every page is public and
statically served, and the two API routes are unauthenticated form handlers. LiveQuiz introduces
the project's first role separation.

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

## Open Questions

1. **Is the existing site's static build genuinely allowed to change?** — When asked what must not
   break, the user named only hosting cost, and did not select "the existing site keeps building
   and deploying as-is", "the two existing API routes keep working", or "the Markdown-in-repo
   content workflow". A live quiz needs persistent session state and sub-second fan-out to ~150
   devices, which is a different runtime shape from the current SSG-plus-two-endpoints site. If
   those three are in fact preservation constraints, they belong in Constraints & Compatibility.
   Owner: user. To be revisited in Phase 5.
