# Brave AI Community Szczecin Website — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Polish-language community website for Brave AI Community Szczecin with event listings, speaker directory, photo galleries, email signup, and speaker signup form.

**Architecture:** Astro static site with content collections for events and speakers (Markdown files). Resend API for email (newsletter + speaker signup notifications). Deployed on Vercel. Dark theme with purple accents matching brave.courses brand.

**Tech Stack:** Astro 5, Bun, TypeScript, Tailwind CSS 4, Resend, GLightbox, Vercel

---

## File Structure

```
src/
  content/
    config.ts                      # Content collection schemas (events + speakers)
    events/
      meetup-1.md                  # Sample event
      meetup-2.md                  # Sample event
    speakers/
      sample-speaker.md            # Sample speaker
  layouts/
    BaseLayout.astro               # HTML shell, font loading, meta tags
  components/
    Navbar.astro                   # Top navigation bar
    Footer.astro                   # Footer with sponsor, copyright
    EventCard.astro                # Reusable event card (used on homepage + archive)
    SpeakerCard.astro              # Reusable speaker card (used on directory + event page)
    HeroSection.astro              # Homepage hero with upcoming event
    EmailSignup.astro              # Resend email signup form (island)
    PhotoGallery.astro             # Masonry photo grid + lightbox (island)
    SpeakerSignupForm.astro        # Speaker signup form (island)
  pages/
    index.astro                    # Homepage
    wydarzenia/
      index.astro                  # Event archive
      [...slug].astro              # Individual event page
    prelegenci/
      index.astro                  # Speaker directory
      [...slug].astro              # Individual speaker profile
    zglos-sie.astro                # Speaker signup page
    api/
      speaker-signup.ts            # POST endpoint — sends notification via Resend
      newsletter-signup.ts         # POST endpoint — stores email + sends welcome via Resend
  styles/
    global.css                     # Tailwind directives + custom properties
  lib/
    resend.ts                      # Resend client init
    subscribers.ts                 # Read/write subscriber list (JSON file)
public/
  photos/
    events/
      meetup-1/                    # Event photos
      meetup-2/
    speakers/                      # Speaker headshots
  fonts/
    Archivo-Variable.woff2         # Self-hosted Archivo font
data/
  subscribers.json                 # Email subscriber list (gitignored)
astro.config.ts                    # Astro config with Vercel adapter + Tailwind
tailwind.config.ts                 # Tailwind theme (colors, fonts)
package.json
tsconfig.json
.env.example                       # RESEND_API_KEY, ADMIN_EMAIL
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `astro.config.ts`, `tsconfig.json`, `src/styles/global.css`, `.env.example`

- [ ] **Step 1: Initialize Astro project with Bun**

```bash
cd /Users/jedrek/dev/ai-community-szn
bun create astro@latest . --template minimal --install --no-git --typescript strict
```

When prompted, accept defaults. If it asks about overwriting `.gitignore`, allow it.

- [ ] **Step 2: Install dependencies**

```bash
bun add @astrojs/vercel @astrojs/tailwind tailwindcss @tailwindcss/vite resend glightbox
bun add -d @types/node
```

- [ ] **Step 3: Configure Astro**

Replace `astro.config.ts` (it may be `astro.config.mjs` after scaffolding — rename it):

```typescript
// astro.config.ts
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";

export default defineConfig({
  output: "server",
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Note: We use `output: "server"` because we need API endpoints for email signup and speaker signup. Astro will still prerender static pages by default.

- [ ] **Step 4: Set up Tailwind global CSS**

Replace `src/styles/global.css`:

```css
@import "tailwindcss";

@theme {
  --color-brand-purple: #7c3aed;
  --color-brand-purple-light: #a78bfa;
  --color-brand-purple-dark: #5b21b6;
  --color-surface-primary: #0a0a0f;
  --color-surface-secondary: #141420;
  --color-surface-border: #222233;
  --color-text-primary: #f0f0f0;
  --color-text-secondary: #999999;
  --font-family-archivo: "Archivo", sans-serif;
}
```

- [ ] **Step 5: Create .env.example**

```bash
# .env.example
RESEND_API_KEY=re_xxxxxxxxxxxx
ADMIN_EMAIL=admin@example.com
```

- [ ] **Step 6: Download and self-host Archivo font**

```bash
mkdir -p public/fonts
curl -L "https://fonts.google.com/download?family=Archivo" -o /tmp/archivo.zip
unzip /tmp/archivo.zip -d /tmp/archivo
cp /tmp/archivo/Archivo-VariableFont_wdth,wght.ttf public/fonts/Archivo-Variable.ttf
rm -rf /tmp/archivo /tmp/archivo.zip
```

- [ ] **Step 7: Create placeholder directories**

```bash
mkdir -p public/photos/events/meetup-1 public/photos/events/meetup-2 public/photos/speakers
mkdir -p src/content/events src/content/speakers src/components src/layouts src/pages/wydarzenia src/pages/prelegenci src/pages/api src/lib
mkdir -p data
echo "[]" > data/subscribers.json
```

- [ ] **Step 8: Add data/ to .gitignore**

Append to `.gitignore`:
```
# Subscriber data
data/subscribers.json
```

- [ ] **Step 9: Verify project builds**

```bash
bun run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: scaffold Astro project with Bun, Tailwind, Vercel adapter"
```

---

### Task 2: Content Collections Schema

**Files:**
- Create: `src/content/config.ts`, `src/content/events/meetup-1.md`, `src/content/events/meetup-2.md`, `src/content/speakers/sample-speaker-1.md`, `src/content/speakers/sample-speaker-2.md`

- [ ] **Step 1: Define content collection schemas**

Create `src/content/config.ts`:

```typescript
import { defineCollection, z, reference } from "astro:content";

const events = defineCollection({
  type: "content",
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    time: z.string(),
    location: z.string(),
    lumaUrl: z.string().url(),
    description: z.string(),
    speakers: z.array(z.string()).default([]),
    photos: z.array(z.string()).default([]),
    status: z.enum(["upcoming", "past"]),
  }),
});

const speakers = defineCollection({
  type: "content",
  schema: z.object({
    name: z.string(),
    role: z.string(),
    company: z.string(),
    photo: z.string(),
    links: z
      .object({
        linkedin: z.string().url().optional(),
        github: z.string().url().optional(),
        twitter: z.string().url().optional(),
        website: z.string().url().optional(),
      })
      .default({}),
  }),
});

export const collections = { events, speakers };
```

- [ ] **Step 2: Create sample event — meetup-1**

Create `src/content/events/meetup-1.md`:

```markdown
---
title: "Wprowadzenie do AI"
date: 2026-02-20
time: "18:00"
location: "Szczecin"
lumaUrl: "https://luma.com/brave-ai-community-szczecin-1"
description: "Pierwsze spotkanie społeczności Brave AI w Szczecinie"
speakers:
  - sample-speaker-1
photos: []
status: past
---

Pierwsze spotkanie Brave AI Community Szczecin! Rozmawialiśmy o podstawach sztucznej inteligencji, aktualnych trendach i kierunkach rozwoju AI w Polsce.
```

- [ ] **Step 3: Create sample event — meetup-2**

Create `src/content/events/meetup-2.md`:

```markdown
---
title: "LLM w Praktyce"
date: 2026-03-15
time: "18:00"
location: "Szczecin"
lumaUrl: "https://luma.com/brave-ai-community-szczecin-2"
description: "Drugie spotkanie — praktyczne zastosowania dużych modeli językowych"
speakers:
  - sample-speaker-1
  - sample-speaker-2
photos: []
status: past
---

Drugie spotkanie poświęcone praktycznym zastosowaniom LLM. Prelegenci pokazali jak wdrażać modele językowe w produkcji.
```

- [ ] **Step 4: Create sample speakers**

Create `src/content/speakers/sample-speaker-1.md`:

```markdown
---
name: "Jan Kowalski"
role: "ML Engineer"
company: "Example Corp"
photo: /photos/speakers/jan-kowalski.jpg
links:
  linkedin: "https://linkedin.com/in/jankowalski"
  github: "https://github.com/jankowalski"
---

Jan jest inżynierem ML z 5-letnim doświadczeniem w budowaniu systemów rekomendacji i przetwarzaniu języka naturalnego.
```

Create `src/content/speakers/sample-speaker-2.md`:

```markdown
---
name: "Anna Nowak"
role: "AI Researcher"
company: "Tech Startup"
photo: /photos/speakers/anna-nowak.jpg
links:
  linkedin: "https://linkedin.com/in/annanowak"
  website: "https://annanowak.dev"
---

Anna zajmuje się badaniami nad generatywnymi modelami AI. Specjalizuje się w fine-tuningu i ewaluacji LLM.
```

- [ ] **Step 5: Verify content collections load**

```bash
bun run build
```

Expected: Build succeeds — Astro parses content collections without schema errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add content collection schemas and sample events/speakers"
```

---

### Task 3: Base Layout, Navbar, Footer

**Files:**
- Create: `src/layouts/BaseLayout.astro`, `src/components/Navbar.astro`, `src/components/Footer.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create BaseLayout**

Create `src/layouts/BaseLayout.astro`:

```astro
---
interface Props {
  title: string;
  description?: string;
}

const { title, description = "Brave AI Community Szczecin — społeczność AI w Szczecinie" } = Astro.props;
---

<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title} | Brave AI Community Szczecin</title>
    <style>
      @font-face {
        font-family: "Archivo";
        src: url("/fonts/Archivo-Variable.ttf") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
      }
    </style>
  </head>
  <body
    class="bg-surface-primary text-text-primary font-archivo min-h-screen flex flex-col"
  >
    <slot name="navbar" />
    <main class="flex-1">
      <slot />
    </main>
    <slot name="footer" />
  </body>
</html>
```

- [ ] **Step 2: Import global CSS in BaseLayout**

Add to the `<head>` in `BaseLayout.astro`, before the `<style>` tag:

```astro
<link rel="stylesheet" href="/src/styles/global.css" />
```

Actually — in Astro, import the CSS in the frontmatter instead:

Update the frontmatter of `BaseLayout.astro` to include:

```astro
---
import "../styles/global.css";

interface Props {
  title: string;
  description?: string;
}

const { title, description = "Brave AI Community Szczecin — społeczność AI w Szczecinie" } = Astro.props;
---
```

- [ ] **Step 3: Create Navbar**

Create `src/components/Navbar.astro`:

```astro
---
const currentPath = Astro.url.pathname;

const links = [
  { href: "/wydarzenia", label: "Wydarzenia" },
  { href: "/prelegenci", label: "Prelegenci" },
  { href: "/zglos-sie", label: "Zgłoś się" },
];
---

<nav class="border-b border-surface-border px-6 py-4">
  <div class="max-w-6xl mx-auto flex items-center justify-between">
    <a href="/" class="text-lg font-bold text-white">
      BRAVE <span class="text-brand-purple">AI Community</span> Szczecin
    </a>
    <div class="flex gap-6 text-sm">
      {
        links.map((link) => (
          <a
            href={link.href}
            class:list={[
              "transition-colors hover:text-brand-purple",
              currentPath.startsWith(link.href)
                ? "text-brand-purple"
                : "text-text-secondary",
            ]}
          >
            {link.label}
          </a>
        ))
      }
    </div>
  </div>
</nav>
```

- [ ] **Step 4: Create Footer**

Create `src/components/Footer.astro`:

```astro
<footer class="border-t border-surface-border px-6 py-8 mt-16">
  <div class="max-w-6xl mx-auto flex flex-col items-center gap-4 text-center">
    <a
      href="https://www.brave.courses/"
      target="_blank"
      rel="noopener noreferrer"
      class="text-text-secondary text-sm hover:text-brand-purple transition-colors"
    >
      Wspierane przez Brave Courses
    </a>
    <p class="text-text-secondary text-xs">
      &copy; {new Date().getFullYear()} Brave AI Community Szczecin
    </p>
  </div>
</footer>
```

- [ ] **Step 5: Wire up homepage with layout**

Replace `src/pages/index.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Navbar from "../components/Navbar.astro";
import Footer from "../components/Footer.astro";
---

<BaseLayout title="Strona główna">
  <Navbar slot="navbar" />
  <div class="max-w-6xl mx-auto px-6 py-16">
    <h1 class="text-4xl font-bold">Brave AI Community Szczecin</h1>
    <p class="text-text-secondary mt-4">Strona w budowie...</p>
  </div>
  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 6: Verify layout renders**

```bash
bun run dev
```

Open `http://localhost:4321` — verify navbar, content area, and footer render correctly with dark theme and Archivo font.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add BaseLayout with Navbar and Footer components"
```

---

### Task 4: EventCard Component + Homepage Hero

**Files:**
- Create: `src/components/EventCard.astro`, `src/components/HeroSection.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create EventCard component**

Create `src/components/EventCard.astro`:

```astro
---
interface Props {
  title: string;
  date: Date;
  slug: string;
  description: string;
  speakerCount: number;
  photoCount: number;
  status: "upcoming" | "past";
}

const { title, date, slug, description, speakerCount, photoCount, status } =
  Astro.props;

const formattedDate = date.toLocaleDateString("pl-PL", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
---

<a
  href={`/wydarzenia/${slug}`}
  class="block bg-surface-secondary border border-surface-border rounded-lg overflow-hidden hover:border-brand-purple/50 transition-colors"
>
  <div
    class="h-32 bg-gradient-to-br from-surface-secondary to-brand-purple/20"
  >
  </div>
  <div class="p-4">
    <div class="flex items-center gap-2 mb-2">
      <span class="text-xs text-brand-purple">{formattedDate}</span>
      {
        status === "upcoming" && (
          <span class="text-[10px] bg-brand-purple text-white px-2 py-0.5 rounded-full font-semibold uppercase">
            Nadchodzące
          </span>
        )
      }
    </div>
    <h3 class="text-base font-semibold text-white mb-1">{title}</h3>
    <p class="text-xs text-text-secondary">
      {speakerCount} prelegentów · {photoCount} zdjęć
    </p>
  </div>
</a>
```

- [ ] **Step 2: Create HeroSection component**

Create `src/components/HeroSection.astro`:

```astro
---
interface Props {
  event?: {
    title: string;
    date: Date;
    time: string;
    location: string;
    lumaUrl: string;
  };
}

const { event } = Astro.props;

const formattedDate = event
  ? event.date.toLocaleDateString("pl-PL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
  : null;
---

<section
  class="text-center py-20 px-6 bg-gradient-to-br from-surface-primary via-brand-purple/10 to-surface-primary"
>
  {
    event ? (
      <>
        <p class="text-xs uppercase tracking-[3px] text-brand-purple mb-4">
          Nadchodzące wydarzenie
        </p>
        <h1 class="text-4xl md:text-5xl font-bold text-white mb-3">
          {event.title}
        </h1>
        <p class="text-text-secondary mb-8">
          {formattedDate} · {event.time} · {event.location}
        </p>
        <a
          href={event.lumaUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-block bg-brand-purple hover:bg-brand-purple-dark text-white font-semibold px-8 py-3 rounded-lg transition-colors"
        >
          Zapisz się na Luma →
        </a>
      </>
    ) : (
      <>
        <h1 class="text-4xl md:text-5xl font-bold text-white mb-3">
          Brave AI Community Szczecin
        </h1>
        <p class="text-text-secondary mb-8">
          Śledź nas, aby nie przegapić kolejnego meetupu
        </p>
      </>
    )
  }
</section>
```

- [ ] **Step 3: Wire up homepage with real content**

Replace `src/pages/index.astro`:

```astro
---
import { getCollection } from "astro:content";
import BaseLayout from "../layouts/BaseLayout.astro";
import Navbar from "../components/Navbar.astro";
import Footer from "../components/Footer.astro";
import HeroSection from "../components/HeroSection.astro";
import EventCard from "../components/EventCard.astro";

const allEvents = await getCollection("events");
const sortedEvents = allEvents.sort(
  (a, b) => b.data.date.getTime() - a.data.date.getTime()
);

const upcomingEvent = sortedEvents.find((e) => e.data.status === "upcoming");
const pastEvents = sortedEvents
  .filter((e) => e.data.status === "past")
  .slice(0, 4);
---

<BaseLayout title="Strona główna">
  <Navbar slot="navbar" />

  <HeroSection
    event={
      upcomingEvent
        ? {
            title: upcomingEvent.data.title,
            date: upcomingEvent.data.date,
            time: upcomingEvent.data.time,
            location: upcomingEvent.data.location,
            lumaUrl: upcomingEvent.data.lumaUrl,
          }
        : undefined
    }
  />

  <section class="max-w-6xl mx-auto px-6 py-12">
    <div class="flex items-center justify-between mb-8">
      <h2 class="text-2xl font-bold">Ostatnie wydarzenia</h2>
      <a
        href="/wydarzenia"
        class="text-sm text-brand-purple hover:text-brand-purple-light transition-colors"
      >
        Zobacz wszystkie →
      </a>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {
        pastEvents.map((event) => (
          <EventCard
            title={event.data.title}
            date={event.data.date}
            slug={event.id}
            description={event.data.description}
            speakerCount={event.data.speakers.length}
            photoCount={event.data.photos.length}
            status={event.data.status}
          />
        ))
      }
    </div>
  </section>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 4: Verify homepage renders with events**

```bash
bun run dev
```

Open `http://localhost:4321` — verify hero section shows (no upcoming event = fallback text) and past event cards render below.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add homepage with hero section and event cards"
```

---

### Task 5: Event Archive + Individual Event Page

**Files:**
- Create: `src/pages/wydarzenia/index.astro`, `src/pages/wydarzenia/[...slug].astro`

- [ ] **Step 1: Create event archive page**

Create `src/pages/wydarzenia/index.astro`:

```astro
---
import { getCollection } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";
import Navbar from "../../components/Navbar.astro";
import Footer from "../../components/Footer.astro";
import EventCard from "../../components/EventCard.astro";

const allEvents = await getCollection("events");
const sortedEvents = allEvents.sort(
  (a, b) => b.data.date.getTime() - a.data.date.getTime()
);
---

<BaseLayout title="Wydarzenia">
  <Navbar slot="navbar" />

  <section class="max-w-6xl mx-auto px-6 py-12">
    <h1 class="text-3xl font-bold mb-8">Wydarzenia</h1>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      {
        sortedEvents.map((event) => (
          <EventCard
            title={event.data.title}
            date={event.data.date}
            slug={event.id}
            description={event.data.description}
            speakerCount={event.data.speakers.length}
            photoCount={event.data.photos.length}
            status={event.data.status}
          />
        ))
      }
    </div>
  </section>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 2: Create individual event page**

Create `src/pages/wydarzenia/[...slug].astro`:

```astro
---
import { getCollection, getEntry } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";
import Navbar from "../../components/Navbar.astro";
import Footer from "../../components/Footer.astro";
import SpeakerCard from "../../components/SpeakerCard.astro";

export async function getStaticPaths() {
  const events = await getCollection("events");
  return events.map((event) => ({
    params: { slug: event.id },
    props: { event },
  }));
}

const { event } = Astro.props;
const { Content } = await event.render();

const formattedDate = event.data.date.toLocaleDateString("pl-PL", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

const speakers = await Promise.all(
  event.data.speakers.map((id: string) => getEntry("speakers", id))
);
const validSpeakers = speakers.filter(Boolean);
---

<BaseLayout title={event.data.title}>
  <Navbar slot="navbar" />

  <article class="max-w-4xl mx-auto px-6 py-12">
    <header class="mb-8">
      <div class="flex items-center gap-3 mb-4">
        <span class="text-sm text-brand-purple">{formattedDate}</span>
        <span class="text-sm text-text-secondary">· {event.data.time}</span>
        <span class="text-sm text-text-secondary">
          · {event.data.location}
        </span>
      </div>
      <h1 class="text-4xl font-bold mb-4">{event.data.title}</h1>
      {
        event.data.status === "upcoming" && (
          <a
            href={event.data.lumaUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-block bg-brand-purple hover:bg-brand-purple-dark text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
          >
            Zapisz się na Luma →
          </a>
        )
      }
    </header>

    <div class="prose prose-invert max-w-none mb-12">
      <Content />
    </div>

    {
      validSpeakers.length > 0 && (
        <section class="mb-12">
          <h2 class="text-2xl font-bold mb-6">Prelegenci</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {validSpeakers.map(
              (speaker) =>
                speaker && (
                  <SpeakerCard
                    name={speaker.data.name}
                    role={speaker.data.role}
                    company={speaker.data.company}
                    photo={speaker.data.photo}
                    slug={speaker.id}
                  />
                )
            )}
          </div>
        </section>
      )
    }

    {
      event.data.photos.length > 0 && (
        <section>
          <h2 class="text-2xl font-bold mb-6">Galeria</h2>
          <div id="photo-gallery" class="columns-2 md:columns-3 gap-3 space-y-3">
            {event.data.photos.map((photo: string, i: number) => (
              <a href={photo} class="glightbox block" data-gallery="event-photos">
                <img
                  src={photo}
                  alt={`${event.data.title} — zdjęcie ${i + 1}`}
                  class="w-full rounded-lg hover:opacity-80 transition-opacity"
                  loading="lazy"
                />
              </a>
            ))}
          </div>
        </section>
      )
    }
  </article>

  <Footer slot="footer" />
</BaseLayout>

<script>
  import GLightbox from "glightbox";
  import "glightbox/dist/css/glightbox.min.css";

  document.addEventListener("astro:page-load", () => {
    GLightbox({ selector: ".glightbox" });
  });
</script>
```

- [ ] **Step 3: Verify event pages render**

```bash
bun run dev
```

Open `http://localhost:4321/wydarzenia` — verify archive shows both events.
Open `http://localhost:4321/wydarzenia/meetup-1` — verify individual event page renders with speakers section.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add event archive and individual event pages with photo gallery"
```

---

### Task 6: SpeakerCard Component + Speaker Pages

**Files:**
- Create: `src/components/SpeakerCard.astro`, `src/pages/prelegenci/index.astro`, `src/pages/prelegenci/[...slug].astro`

- [ ] **Step 1: Create SpeakerCard component**

Create `src/components/SpeakerCard.astro`:

```astro
---
interface Props {
  name: string;
  role: string;
  company: string;
  photo: string;
  slug: string;
}

const { name, role, company, photo, slug } = Astro.props;
---

<a
  href={`/prelegenci/${slug}`}
  class="flex items-center gap-4 bg-surface-secondary border border-surface-border rounded-lg p-4 hover:border-brand-purple/50 transition-colors"
>
  <img
    src={photo}
    alt={name}
    class="w-14 h-14 rounded-full object-cover bg-surface-border"
    loading="lazy"
  />
  <div>
    <h3 class="font-semibold text-white">{name}</h3>
    <p class="text-sm text-text-secondary">
      {role} · {company}
    </p>
  </div>
</a>
```

- [ ] **Step 2: Create speaker directory page**

Create `src/pages/prelegenci/index.astro`:

```astro
---
import { getCollection } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";
import Navbar from "../../components/Navbar.astro";
import Footer from "../../components/Footer.astro";
import SpeakerCard from "../../components/SpeakerCard.astro";

const speakers = await getCollection("speakers");
---

<BaseLayout title="Prelegenci">
  <Navbar slot="navbar" />

  <section class="max-w-6xl mx-auto px-6 py-12">
    <h1 class="text-3xl font-bold mb-8">Prelegenci</h1>
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
      {
        speakers.map((speaker) => (
          <SpeakerCard
            name={speaker.data.name}
            role={speaker.data.role}
            company={speaker.data.company}
            photo={speaker.data.photo}
            slug={speaker.id}
          />
        ))
      }
    </div>
  </section>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 3: Create individual speaker page**

Create `src/pages/prelegenci/[...slug].astro`:

```astro
---
import { getCollection } from "astro:content";
import BaseLayout from "../../layouts/BaseLayout.astro";
import Navbar from "../../components/Navbar.astro";
import Footer from "../../components/Footer.astro";

export async function getStaticPaths() {
  const speakers = await getCollection("speakers");
  return speakers.map((speaker) => ({
    params: { slug: speaker.id },
    props: { speaker },
  }));
}

const { speaker } = Astro.props;
const { Content } = await speaker.render();

const allEvents = await getCollection("events");
const speakerEvents = allEvents
  .filter((event) => event.data.speakers.includes(speaker.id))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

const linkIcons: Record<string, string> = {
  linkedin: "LinkedIn",
  github: "GitHub",
  twitter: "X (Twitter)",
  website: "Strona www",
};
---

<BaseLayout title={speaker.data.name}>
  <Navbar slot="navbar" />

  <article class="max-w-4xl mx-auto px-6 py-12">
    <div class="flex flex-col sm:flex-row items-start gap-6 mb-8">
      <img
        src={speaker.data.photo}
        alt={speaker.data.name}
        class="w-28 h-28 rounded-full object-cover bg-surface-border"
      />
      <div>
        <h1 class="text-3xl font-bold mb-1">{speaker.data.name}</h1>
        <p class="text-text-secondary mb-4">
          {speaker.data.role} · {speaker.data.company}
        </p>
        <div class="flex gap-3">
          {
            Object.entries(speaker.data.links)
              .filter(([, url]) => url)
              .map(([key, url]) => (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-sm text-brand-purple hover:text-brand-purple-light transition-colors"
                >
                  {linkIcons[key] || key}
                </a>
              ))
          }
        </div>
      </div>
    </div>

    <div class="prose prose-invert max-w-none mb-12">
      <Content />
    </div>

    {
      speakerEvents.length > 0 && (
        <section>
          <h2 class="text-2xl font-bold mb-6">Wystąpienia</h2>
          <ul class="space-y-3">
            {speakerEvents.map((event) => (
              <li>
                <a
                  href={`/wydarzenia/${event.id}`}
                  class="flex items-center gap-3 bg-surface-secondary border border-surface-border rounded-lg p-4 hover:border-brand-purple/50 transition-colors"
                >
                  <span class="text-sm text-brand-purple whitespace-nowrap">
                    {event.data.date.toLocaleDateString("pl-PL", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span class="font-semibold text-white">
                    {event.data.title}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )
    }
  </article>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 4: Verify speaker pages render**

```bash
bun run dev
```

Open `http://localhost:4321/prelegenci` — verify directory shows both speakers.
Open `http://localhost:4321/prelegenci/sample-speaker-1` — verify profile page with talk history.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add speaker directory and individual speaker profile pages"
```

---

### Task 7: Email Signup (Resend)

**Files:**
- Create: `src/lib/resend.ts`, `src/lib/subscribers.ts`, `src/pages/api/newsletter-signup.ts`, `src/components/EmailSignup.astro`
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Create Resend client helper**

Create `src/lib/resend.ts`:

```typescript
import { Resend } from "resend";

const apiKey = import.meta.env.RESEND_API_KEY;

if (!apiKey) {
  console.warn("RESEND_API_KEY is not set — email features will not work");
}

export const resend = new Resend(apiKey || "");
```

- [ ] **Step 2: Create subscriber list helper**

Create `src/lib/subscribers.ts`:

```typescript
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SUBSCRIBERS_PATH = join(process.cwd(), "data", "subscribers.json");

export async function getSubscribers(): Promise<string[]> {
  try {
    const data = await readFile(SUBSCRIBERS_PATH, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function addSubscriber(email: string): Promise<boolean> {
  const subscribers = await getSubscribers();
  if (subscribers.includes(email)) {
    return false;
  }
  subscribers.push(email);
  await writeFile(SUBSCRIBERS_PATH, JSON.stringify(subscribers, null, 2));
  return true;
}
```

- [ ] **Step 3: Create newsletter signup API endpoint**

Create `src/pages/api/newsletter-signup.ts`:

```typescript
import type { APIRoute } from "astro";
import { addSubscriber } from "../../lib/subscribers";
import { resend } from "../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const email = formData.get("email")?.toString().trim();

  if (!email || !email.includes("@")) {
    return new Response(
      JSON.stringify({ error: "Podaj prawidłowy adres email" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const isNew = await addSubscriber(email);

  if (isNew && import.meta.env.RESEND_API_KEY) {
    await resend.emails.send({
      from: "Brave AI Community <noreply@braveai.community>",
      to: email,
      subject: "Witamy w Brave AI Community Szczecin!",
      html: `<p>Cześć!</p><p>Dziękujemy za zapisanie się do newslettera Brave AI Community Szczecin. Powiadomimy Cię o nadchodzących meetupach.</p><p>Do zobaczenia!</p>`,
    });
  }

  return new Response(
    JSON.stringify({
      message: isNew
        ? "Zapisano! Sprawdź swoją skrzynkę."
        : "Ten email jest już zapisany.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
```

- [ ] **Step 4: Create EmailSignup component**

Create `src/components/EmailSignup.astro`:

```astro
<section class="border-t border-surface-border py-16 px-6">
  <div class="max-w-md mx-auto text-center">
    <h2 class="text-xl font-bold mb-2">Nie przegap kolejnego meetupu!</h2>
    <p class="text-text-secondary text-sm mb-6">
      Zapisz się, a powiadomimy Cię o nowych wydarzeniach.
    </p>
    <form id="email-signup-form" class="flex gap-2">
      <input
        type="email"
        name="email"
        required
        placeholder="twoj@email.pl"
        class="flex-1 bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
      />
      <button
        type="submit"
        class="bg-brand-purple hover:bg-brand-purple-dark text-white font-semibold px-6 py-2.5 rounded-lg transition-colors text-sm"
      >
        Zapisz się
      </button>
    </form>
    <p id="signup-message" class="text-sm mt-3 hidden"></p>
  </div>
</section>

<script>
  document.addEventListener("astro:page-load", () => {
    const form = document.getElementById(
      "email-signup-form"
    ) as HTMLFormElement;
    const message = document.getElementById("signup-message") as HTMLElement;

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(form);

      try {
        const res = await fetch("/api/newsletter-signup", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        message.textContent = data.message || data.error;
        message.className = `text-sm mt-3 ${res.ok ? "text-green-400" : "text-red-400"}`;
        message.classList.remove("hidden");

        if (res.ok) form.reset();
      } catch {
        message.textContent = "Wystąpił błąd. Spróbuj ponownie.";
        message.className = "text-sm mt-3 text-red-400";
        message.classList.remove("hidden");
      }
    });
  });
</script>
```

- [ ] **Step 5: Add EmailSignup to homepage**

In `src/pages/index.astro`, add the import and component. After the "Ostatnie wydarzenia" section closing `</section>` and before `<Footer>`, add:

```astro
import EmailSignup from "../components/EmailSignup.astro";
```

(in the frontmatter)

And in the template, before `<Footer slot="footer" />`:

```astro
<EmailSignup />
```

- [ ] **Step 6: Verify email signup works**

```bash
bun run dev
```

Open `http://localhost:4321` — scroll to bottom, submit an email. Check that `data/subscribers.json` now contains the email. (Email send will fail without a valid RESEND_API_KEY — that's expected.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add email newsletter signup with Resend integration"
```

---

### Task 8: Speaker Signup Form + API

**Files:**
- Create: `src/pages/zglos-sie.astro`, `src/pages/api/speaker-signup.ts`, `src/components/SpeakerSignupForm.astro`

- [ ] **Step 1: Create speaker signup API endpoint**

Create `src/pages/api/speaker-signup.ts`:

```typescript
import type { APIRoute } from "astro";
import { resend } from "../../lib/resend";

export const POST: APIRoute = async ({ request }) => {
  const formData = await request.formData();
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim();
  const topic = formData.get("topic")?.toString().trim();
  const bio = formData.get("bio")?.toString().trim();
  const linkedin = formData.get("linkedin")?.toString().trim();
  const github = formData.get("github")?.toString().trim();
  const website = formData.get("website")?.toString().trim();

  if (!name || !email || !topic || !bio) {
    return new Response(
      JSON.stringify({ error: "Wypełnij wszystkie wymagane pola." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const adminEmail = import.meta.env.ADMIN_EMAIL;

  if (import.meta.env.RESEND_API_KEY && adminEmail) {
    await resend.emails.send({
      from: "Brave AI Community <noreply@braveai.community>",
      to: adminEmail,
      subject: `Nowe zgłoszenie prelegenta: ${name}`,
      html: `
        <h2>Nowe zgłoszenie prelegenta</h2>
        <p><strong>Imię i nazwisko:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Temat prezentacji:</strong> ${topic}</p>
        <p><strong>Bio:</strong> ${bio}</p>
        ${linkedin ? `<p><strong>LinkedIn:</strong> ${linkedin}</p>` : ""}
        ${github ? `<p><strong>GitHub:</strong> ${github}</p>` : ""}
        ${website ? `<p><strong>Strona www:</strong> ${website}</p>` : ""}
      `,
    });
  }

  return new Response(
    JSON.stringify({
      message: "Dziękujemy za zgłoszenie! Odezwiemy się wkrótce.",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
```

- [ ] **Step 2: Create SpeakerSignupForm component**

Create `src/components/SpeakerSignupForm.astro`:

```astro
<form id="speaker-signup-form" class="space-y-5 max-w-lg">
  <div>
    <label for="name" class="block text-sm font-medium mb-1">
      Imię i nazwisko *
    </label>
    <input
      type="text"
      id="name"
      name="name"
      required
      class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
    />
  </div>

  <div>
    <label for="email" class="block text-sm font-medium mb-1">Email *</label>
    <input
      type="email"
      id="email"
      name="email"
      required
      class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
    />
  </div>

  <div>
    <label for="topic" class="block text-sm font-medium mb-1">
      Temat prezentacji *
    </label>
    <textarea
      id="topic"
      name="topic"
      required
      rows="3"
      placeholder="O czym chciałbyś/chciałabyś opowiedzieć?"
      class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple resize-y"
    ></textarea>
  </div>

  <div>
    <label for="bio" class="block text-sm font-medium mb-1">
      Krótki bio *
    </label>
    <textarea
      id="bio"
      name="bio"
      required
      rows="3"
      placeholder="Kilka zdań o sobie i swoim doświadczeniu"
      class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple resize-y"
    ></textarea>
  </div>

  <div>
    <label class="block text-sm font-medium mb-1">Linki (opcjonalne)</label>
    <div class="space-y-2">
      <input
        type="url"
        name="linkedin"
        placeholder="LinkedIn URL"
        class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
      />
      <input
        type="url"
        name="github"
        placeholder="GitHub URL"
        class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
      />
      <input
        type="url"
        name="website"
        placeholder="Strona www"
        class="w-full bg-surface-secondary border border-surface-border rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-text-secondary focus:outline-none focus:border-brand-purple"
      />
    </div>
  </div>

  <button
    type="submit"
    class="bg-brand-purple hover:bg-brand-purple-dark text-white font-semibold px-8 py-3 rounded-lg transition-colors text-sm"
  >
    Wyślij zgłoszenie
  </button>

  <p id="speaker-signup-message" class="text-sm hidden"></p>
</form>

<script>
  document.addEventListener("astro:page-load", () => {
    const form = document.getElementById(
      "speaker-signup-form"
    ) as HTMLFormElement;
    const message = document.getElementById(
      "speaker-signup-message"
    ) as HTMLElement;

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const formData = new FormData(form);

      try {
        const res = await fetch("/api/speaker-signup", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();

        message.textContent = data.message || data.error;
        message.className = `text-sm ${res.ok ? "text-green-400" : "text-red-400"}`;
        message.classList.remove("hidden");

        if (res.ok) form.reset();
      } catch {
        message.textContent = "Wystąpił błąd. Spróbuj ponownie.";
        message.className = "text-sm text-red-400";
        message.classList.remove("hidden");
      }
    });
  });
</script>
```

- [ ] **Step 3: Create speaker signup page**

Create `src/pages/zglos-sie.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import Navbar from "../components/Navbar.astro";
import Footer from "../components/Footer.astro";
import SpeakerSignupForm from "../components/SpeakerSignupForm.astro";
---

<BaseLayout title="Zgłoś się jako prelegent">
  <Navbar slot="navbar" />

  <section class="max-w-6xl mx-auto px-6 py-12">
    <h1 class="text-3xl font-bold mb-2">Zgłoś się jako prelegent</h1>
    <p class="text-text-secondary mb-8">
      Chcesz podzielić się wiedzą na naszym meetupie? Wypełnij formularz, a
      odezwiemy się do Ciebie!
    </p>
    <SpeakerSignupForm />
  </section>

  <Footer slot="footer" />
</BaseLayout>
```

- [ ] **Step 4: Verify speaker signup page renders and form submits**

```bash
bun run dev
```

Open `http://localhost:4321/zglos-sie` — fill the form and submit. Verify the success message appears. (Email send fails without valid RESEND_API_KEY — expected.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add speaker signup form with Resend notification"
```

---

### Task 9: Responsive Navigation (Mobile Menu)

**Files:**
- Modify: `src/components/Navbar.astro`

- [ ] **Step 1: Add mobile hamburger menu to Navbar**

Replace `src/components/Navbar.astro`:

```astro
---
const currentPath = Astro.url.pathname;

const links = [
  { href: "/wydarzenia", label: "Wydarzenia" },
  { href: "/prelegenci", label: "Prelegenci" },
  { href: "/zglos-sie", label: "Zgłoś się" },
];
---

<nav class="border-b border-surface-border px-6 py-4">
  <div class="max-w-6xl mx-auto flex items-center justify-between">
    <a href="/" class="text-lg font-bold text-white">
      BRAVE <span class="text-brand-purple">AI Community</span> Szczecin
    </a>

    <!-- Desktop nav -->
    <div class="hidden md:flex gap-6 text-sm">
      {
        links.map((link) => (
          <a
            href={link.href}
            class:list={[
              "transition-colors hover:text-brand-purple",
              currentPath.startsWith(link.href)
                ? "text-brand-purple"
                : "text-text-secondary",
            ]}
          >
            {link.label}
          </a>
        ))
      }
    </div>

    <!-- Mobile hamburger -->
    <button
      id="mobile-menu-toggle"
      class="md:hidden text-text-secondary hover:text-white"
      aria-label="Menu"
    >
      <svg
        class="w-6 h-6"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M4 6h16M4 12h16M4 18h16"></path>
      </svg>
    </button>
  </div>

  <!-- Mobile menu -->
  <div id="mobile-menu" class="hidden md:hidden mt-4 pb-2 space-y-3">
    {
      links.map((link) => (
        <a
          href={link.href}
          class:list={[
            "block text-sm transition-colors hover:text-brand-purple",
            currentPath.startsWith(link.href)
              ? "text-brand-purple"
              : "text-text-secondary",
          ]}
        >
          {link.label}
        </a>
      ))
    }
  </div>
</nav>

<script>
  document.addEventListener("astro:page-load", () => {
    const toggle = document.getElementById("mobile-menu-toggle");
    const menu = document.getElementById("mobile-menu");

    toggle?.addEventListener("click", () => {
      menu?.classList.toggle("hidden");
    });
  });
</script>
```

- [ ] **Step 2: Verify mobile menu works**

```bash
bun run dev
```

Open `http://localhost:4321`, resize browser to mobile width. Verify hamburger appears and toggles menu.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add responsive mobile navigation menu"
```

---

### Task 10: SEO Meta Tags + Final Polish

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Add Open Graph and meta tags to BaseLayout**

Update `src/layouts/BaseLayout.astro` head section to include:

```astro
---
import "../styles/global.css";

interface Props {
  title: string;
  description?: string;
  ogImage?: string;
}

const {
  title,
  description = "Brave AI Community Szczecin — społeczność AI w Szczecinie. Meetupy, prezentacje i networking.",
  ogImage = "/og-default.png",
} = Astro.props;

const canonicalUrl = new URL(Astro.url.pathname, Astro.site ?? "https://braveai.community");
---

<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <link rel="canonical" href={canonicalUrl.href} />

    <!-- Open Graph -->
    <meta property="og:title" content={`${title} | Brave AI Community Szczecin`} />
    <meta property="og:description" content={description} />
    <meta property="og:image" content={ogImage} />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="pl_PL" />

    <title>{title} | Brave AI Community Szczecin</title>
    <style>
      @font-face {
        font-family: "Archivo";
        src: url("/fonts/Archivo-Variable.ttf") format("truetype");
        font-weight: 100 900;
        font-style: normal;
        font-display: swap;
      }
    </style>
  </head>
  <body
    class="bg-surface-primary text-text-primary font-archivo min-h-screen flex flex-col"
  >
    <slot name="navbar" />
    <main class="flex-1">
      <slot />
    </main>
    <slot name="footer" />
  </body>
</html>
```

- [ ] **Step 2: Verify build succeeds**

```bash
bun run build
```

Expected: Build completes with all pages generated.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add SEO meta tags and Open Graph support"
```

---

### Task 11: Vercel Deployment Configuration

**Files:**
- Create: `vercel.json`

- [ ] **Step 1: Create Vercel config**

Create `vercel.json`:

```json
{
  "framework": "astro"
}
```

- [ ] **Step 2: Verify production build works end-to-end**

```bash
bun run build && bun run preview
```

Open the preview URL and test all pages:
- Homepage: hero, event cards, email signup
- `/wydarzenia`: event archive
- `/wydarzenia/meetup-1`: individual event with speakers
- `/prelegenci`: speaker directory
- `/prelegenci/sample-speaker-1`: speaker profile with talk history
- `/zglos-sie`: speaker signup form

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add Vercel deployment configuration"
```

- [ ] **Step 4: Deploy to Vercel**

```bash
bunx vercel --prod
```

Follow prompts to link to a Vercel project. Set environment variables `RESEND_API_KEY` and `ADMIN_EMAIL` in the Vercel dashboard.
