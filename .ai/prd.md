# PRD: Brave AI Community Szczecin — Website

## Overview

A Polish-language community website for Brave AI Community Szczecin — a tech/AI meetup community based in Szczecin, Poland. The site serves as the primary hub for event discovery, past event browsing, speaker profiles, and community engagement.

**Sponsor:** [Brave Courses](https://www.brave.courses/) — the site's visual identity aligns with their brand.

## Goals

1. **Highlight upcoming events** — the next meetup is always front and center with a clear CTA to Luma for RSVPs
2. **Easy browsing of past events** — chronological archive with photos, speakers, and descriptions
3. **Build the community** — email newsletter signup (Resend) to notify about new meetups
4. **Showcase speakers** — directory of people who've presented, with profiles and talk history
5. **Recruit speakers** — simple signup form for people who want to present

## Tech Stack

- **Framework:** Astro (SSG — static site generation)
- **Runtime:** Bun
- **Hosting:** Vercel
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Content:** Astro Content Collections (Markdown files in repo)
- **Photos:** Stored in repo (`public/photos/events/`)
- **Email:** Resend (newsletter signup + speaker signup notifications)
- **Event RSVPs:** Luma (external — site links out to Luma)

## Design & Brand

- **Language:** Polish
- **Theme:** Dark background, light text
- **Accent color:** Purple (#7c3aed or similar, aligned with Brave brand)
- **Font:** Archivo (matching brave.courses)
- **Vibe:** Bold, energetic, futuristic — tech-forward AI aesthetic
- **Logo:** Composite — existing Brave logo + "AI Community Szczecin" text

## Site Structure

### Pages

| Route | Description |
|---|---|
| `/` | Homepage — hero with upcoming event, recent past events, email signup |
| `/wydarzenia` | Full event archive — filterable chronological list |
| `/wydarzenia/[slug]` | Individual event — description, speakers, photo gallery |
| `/prelegenci` | Speaker directory — grid of all speakers |
| `/prelegenci/[slug]` | Speaker profile — bio, links, talk history |
| `/zglos-sie` | Speaker signup form |

### Navigation

Top bar with: Logo | Wydarzenia | Prelegenci | Zgłoś się

### Footer

- Brave Courses sponsor logo + link
- Social media links (if applicable)
- "Brave AI Community Szczecin" copyright

## Page Details

### Homepage (`/`)

1. **Hero section** — full-width, gradient background
   - Label: "Nadchodzące wydarzenie"
   - Event title, date, location
   - CTA button linking to Luma
   - If no upcoming event: show "Śledź nas, aby nie przegapić kolejnego meetupu" with email signup

2. **Recent events** — grid of 2-4 most recent past events as cards
   - Each card: event photo/gradient, date, title, speaker count, photo count
   - "Zobacz wszystkie" link to `/wydarzenia`

3. **Email signup section** — Resend integration
   - "Nie przegap kolejnego meetupu!"
   - Email input + submit button

### Event Archive (`/wydarzenia`)

- Chronological list (newest first) of all events
- Each event card shows: title, date, short description, speaker count, photo count
- Upcoming events highlighted with a distinct badge/style
- Click through to individual event page

### Individual Event (`/wydarzenia/[slug]`)

1. **Event header** — title, date, location, Luma link (if upcoming/active)
2. **Description** — Markdown content about the event
3. **Speakers** — list of speakers with photos, linked to their profiles
4. **Photo gallery** — masonry layout (Pinterest-style), click to open lightbox

### Speaker Directory (`/prelegenci`)

- Grid of speaker cards
- Each card: photo, name, role/company
- Click through to individual profile

### Speaker Profile (`/prelegenci/[slug]`)

- Photo
- Name, role, company
- Short bio
- Links: LinkedIn, GitHub, Twitter/X, personal website
- List of talks given — linked to respective event pages

### Speaker Signup (`/zglos-sie`)

Form fields:
- Imię i nazwisko (Name) — required
- Email — required
- Temat prezentacji (Topic proposal) — required, textarea
- Krótki bio (Short bio) — required, textarea
- Linki (Links) — optional (LinkedIn, GitHub, website)

Submission: form submits to an Astro API endpoint (`/api/speaker-signup`) that sends an email notification to the community admin. The endpoint uses Resend (free tier) for transactional email delivery.

## Content Model

### Events (`src/content/events/`)

```yaml
# meetup-1.md frontmatter
title: "Wprowadzenie do AI"
date: 2026-02-20
time: "18:00"
location: "Szczecin"
lumaUrl: "https://luma.com/brave-ai-community-szczecin-1"
description: "Pierwsze spotkanie społeczności Brave AI w Szczecinie"
speakers:
  - jan-kowalski
  - anna-nowak
photos:
  - /photos/events/meetup-1/01.jpg
  - /photos/events/meetup-1/02.jpg
status: past # or "upcoming"
```

### Speakers (`src/content/speakers/`)

```yaml
# jan-kowalski.md frontmatter
name: "Jan Kowalski"
role: "ML Engineer"
company: "Example Corp"
photo: /photos/speakers/jan-kowalski.jpg
links:
  linkedin: "https://linkedin.com/in/jankowalski"
  github: "https://github.com/jankowalski"
  twitter: "https://x.com/jankowalski"
  website: "https://jankowalski.dev"
```

## Content Workflow

Adding a new event:
1. Create `src/content/events/meetup-N.md` with frontmatter and description
2. Add photos to `public/photos/events/meetup-N/`
3. Add/update speaker files in `src/content/speakers/` if needed
4. Push to `main` — Vercel auto-deploys

## Out of Scope (MVP)

- Comments on speaker profiles (deferred post-MVP)
- CMS / admin panel (content managed via repo)
- User authentication / member accounts
- Multi-language support (Polish only)
- Search functionality
- Blog / articles section
