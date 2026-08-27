---
date: 2026-08-17T23:15:56+0200
researcher: Jedrzej Meder
git_commit: 605ce273b7f1c06e085c08b738a59509cf1ef5d0
branch: main
repository: ai-community-szn
topic: "Per-quiz colour scheme, logo and typography (a 90s look for BRAVE UnAIted)"
tags: [research, codebase, quiz-registry, styling, tailwind-4, typography, signage]
status: complete
last_updated: 2026-08-17
last_updated_by: Jedrzej Meder
---

# Research: per-quiz colour scheme, logo and typography

**Date**: 2026-08-17T23:15:56+0200
**Researcher**: Jedrzej Meder
**Git Commit**: `605ce273b7f1c06e085c08b738a59509cf1ef5d0`
**Branch**: `main`
**Repository**: ai-community-szn

Permalink base for every reference below (the commit is pushed):
> `https://github.com/jedrker/ai-community-szn/blob/605ce273b7f1c06e085c08b738a59509cf1ef5d0/<path>#L<line>`

## Research Question

> swietnie by bylo dla danego quizu narzucic specyficzna wersje kolorystyczna oraz logo (moze
> sie wyswietlic po lewej u gory) np. nasz quiz unAited chcialbym zrobic w klimacie lat 90

Scope confirmed with the user before research: **all quiz surfaces** (attendee phone, projector,
host panel, `/quiz/host` picker, `/q/<code>`), **depth = colours + logo + typography**, and the
**archive history** pulled in as its own thread.

## Summary

Five findings, in the order they should change the plan.

1. **The colour half is already built.** Every colour on every quiz surface goes through
   **20 `--color-quiz-*` custom properties** declared in one `@theme` block
   (`src/styles/global.css:46-67`), consumed as Tailwind 4 utilities (`bg-quiz-ink`,
   `text-quiz-chrome`) in **246 places across four committed files** (a fifth, uncommitted, is noted
   in §1 — `/quiz` is gaining a code-entry form as this is written). There are **zero colour
   literals in `src/lib/client/*.ts`** — `render.ts` is a deliberately colour-agnostic engine that
   takes class-name contracts from its caller. A per-quiz palette is therefore *not* a repaint: it
   is **overriding ~20 custom properties at render time**, with no change to a single class string.
2. **Getting a theme field out of the registry is cheap; getting it to a phone is not free.**
   `quizSchema` is a flat four-field object (`src/quiz/schema.ts:306-314`), and a server surface can
   read a non-projected field with a second frontmatter lookup — the pattern
   `host/[slug].astro:92` already uses for `code`. But `projectQuiz` is an **allowlist built
   field-by-field** (`src/quiz/public.ts:227-233`), so nothing reaches the attendee view by
   accident, and two positive key-set assertions exist specifically to catch a new field
   (`src/quiz/public.test.ts:102-111`).
3. **A live defect sits in the middle of the typography half: `font-archivo` resolves to nothing.**
   The token is declared as `--font-family-archivo` (`src/styles/global.css:39`), but Tailwind 4's
   font-family namespace is `--font-*`. Verified against the built CSS in `dist/`: there is **no
   `.font-archivo` rule**, and `font-family: "Archivo"` appears exactly twice — in the two
   `@font-face` blocks and nowhere else. The whole site and the whole quiz currently render in the
   platform `ui-sans-serif` stack, while both `.woff2` files are still declared. Every type size in
   the signage plan was measured for Archivo.
4. **The sharpest obstacle is an explicit prohibition, not a technical one.** The signage
   redesign's plan says, in as many words: *"Do **not** introduce a second `@theme` block, a
   `:root` override on the quiz pages, or a `data-theme` attribute"*
   (`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221-222`). A per-quiz palette is
   precisely one of those three. Two named mechanisms lean on the current palette being global:
   chrome's **rationing** (which is what makes the closing screen's chrome-ground inversion read as
   "it's over" from the back of the room), and the **four-colour message register** on the host
   rail. `docs/runbook-live-session.md:549` tells the host the screen *"turns yellow"* as their
   confirmation the close landed — a per-quiz palette makes a documented operational instruction
   wrong.
5. **Per-quiz *presentation* was never proposed and therefore never rejected.** Greps across the
   whole `multiple-quizzes` change (`change.md`, `plan-brief.md`, `plan.md`, `research.md`,
   `reviews/impl-review.md`) for `presentation|visual|palette|logo|colour|theme` return nothing
   relevant. The three per-quiz fields (`id`, `title`, `code`) were each justified by a **routing or
   copy** need. So this is new ground — but `src/quiz/CLAUDE.md` will need to say why a presentation
   field belongs in a directory whose docstring already argues scoring rules do not.

**Shape this suggests**: colours are a small, well-factored change; the logo is a *layout* change on
a fixed artboard whose top-left slot is already occupied; typography is blocked behind a real bug
and a measured type scale. These are three different sizes of risk and probably should not be one
phase.

## Detailed Findings

### 1. The palette: one indirection layer, four files, 246 call sites

`src/styles/global.css` holds **one `@theme` block with two disjoint token families**, and the
separation is documented in-file as deliberate:

- Site tokens (`global.css:36-45`): `--color-brand-purple*`, `--color-surface-*`, `--color-text-*`,
  `--font-family-archivo`. The comment at `:41-45` states the boundary — the site tokens *"serve the
  whole community site and **must not be repointed**"*.
- LiveQuiz tokens (`global.css:46-67`): **8 base + 12 derived**. Base: `--color-quiz-ink #0b0b0c`,
  `asphalt #141416`, `float #1b1b1f`, `signwhite #f5f5f2`, `zinc #8a8a87`, `chrome #ffd400`,
  `mint #3ddc84`, `signal #e5342a`. Derived: `divider`, `slab-inactive`, `field-border`,
  `pill-border`, `pill-disabled`, `echo`, `chrome-tint`, `mint-tint`, `locked-tint`, `locked-slab`,
  `locked-letter`, `ink-on-chrome`.

No `tailwind.config.*` exists anywhere; `astro.config.ts:29` wires Tailwind purely as
`@tailwindcss/vite` with no theme extension. **All theme configuration lives in that CSS file.**

Every quiz colour reference in the codebase is a `*-quiz-*` utility — **246 usages, 32 distinct
token/utility pairs, in four files**:

| File | quiz-token usages |
| --- | --- |
| `src/pages/quiz/host/[slug].astro` | 132 |
| `src/pages/quiz/[slug].astro` | 96 |
| `src/pages/quiz/host/index.astro` | 11 |
| `src/components/QuizNotice.astro` | 7 |
| `src/pages/quiz/index.astro` | 11 — **uncommitted at the time of writing, see below** |

`src/pages/q/[code].astro` carries **zero colours**: it delegates entirely to `<QuizNotice>`, which
renders its own full `<html>` document (`QuizNotice.astro:39`) and imports `global.css` itself
(`:2`). So `/q/<code>` is themed by theming one shared component.

⚠️ **Concurrent work in scope.** `src/pages/quiz/index.astro` was `zero colours` in commit
`605ce27` and is **modified in the working tree** as this document is written (`git status` reports
` M src/pages/quiz/index.astro` and ` M CLAUDE.md`). The working-tree version adds a four-digit
code-entry `GET` form to `/quiz` — a labelled input (`:105-108`: `border-quiz-field-border
bg-quiz-asphalt text-quiz-signwhite placeholder:text-quiz-zinc focus:border-quiz-chrome`), a chrome
submit button (`:114-115`) and a helper card (`:133-137`) — **11 quiz-token usages**, still inside
`<QuizNotice>`. The root `CLAUDE.md` routing table was amended to match (`/quiz` now "asks for the
four-digit code and redirects to that quiz" rather than reading the session). Whoever plans this
change should re-check that file's state and count: it is a **fifth themeable surface**, it
introduces the first themed *form field* outside the attendee view, and the plan must not be written
against a four-file assumption that was already stale.

The densest single objects, worth knowing before touching anything:

- the attendee option list — one 27-line concatenated class string with 12 token references
  covering base slab, live pick, locked pick and reveal (`src/pages/quiz/[slug].astro:807-833`);
- the host answer bands `bandClass` (`host/[slug].astro:1706-1750`, 14 refs), the distribution-bar
  contract (`:1915-1940`, 15 refs) and the standings contract (`:2715-2772`, ~14 refs, every slot
  dual-branched on `closing`).

**Class strings are concatenated but never interpolated from data**, and the code says why —
`host/[slug].astro:2915` warns that Tailwind's scanner *"would see nothing in a
`border-l-quiz-${register}` built at runtime, and the edge would come out in the default grey in
production while working in dev. **Never assemble a class name from parts here.**"* This is exactly
why the override-the-variable approach is the right one and a build-a-class-name approach is not.

Marketing and quiz are cleanly separated: there is exactly one layout
(`src/layouts/BaseLayout.astro`), the quiz routes deliberately bypass it and each owns its own
document shell (rationale at `src/pages/quiz/[slug].astro:38-41`), and no quiz page imports any
marketing component. The stylesheet is shared by five entry points; the *palette* is not.

### 2. The client layer knows nothing about colour — with two exceptions

`src/lib/client/render.ts` authors no colour at all. It defines four caller-supplied class
contracts — `QuestionClassNames` (`:168-180`), `DistributionClassNames` (`:482-494`),
`StandingsClassNames` (`:691-706`), `WordCloudClassNames` (`:946-951`) — and every inline style it
writes is **geometry only**: opacity/transform (`:91-97`), bar width (`:537`, `:1286`), chip font
size (`:1079`). A grep for `classList|className|setAttribute("class|.style.|cssText` across every
non-test client module returns no colour writes.

The two places a hex is hand-written:

- **`src/lib/client/celebrate.ts:124`** — `const COLORS = ["#ffd400", "#3ddc84", "#f5f5f2",
  "#e5342a"]` for the confetti and ribbons. These are hand-duplicated copies of chrome / mint /
  signwhite / signal; the docstring at `:114-122` admits it and says *"swap it here if the room
  disagrees."* A per-quiz palette must decide whether the confetti follows it. Note the motion
  contract never specified confetti colours at all, so this is a *new* decision, not an overturned
  one.
- **`src/pages/quiz/host/[slug].astro:227`** — `QRCode.toString(..., color: { dark: "#0b0b0c",
  light: "#ffffff" })`. `#0b0b0c` duplicates `--color-quiz-ink`, and the comment at `:214-218`
  argues the white ground is a **scanner-reliability** decision that deliberately must *not* follow
  the page palette. **The QR should be exempt from any theme.**

Third, smaller: the 404 fallback at `host/[slug].astro:110-123` is a hand-built HTML string with
inline `background:#12121c; color:#e8e8f0` matching *neither* token family, and `:108` already
records it as a duplicate of `QuizNotice` with the component named canonical.

`src/pages/quiz/spine-check.astro` is an outlier and out of scope: no `global.css` import, no
Tailwind, ~16 hardcoded hexes in its own `<style>` block (`:57-160`), zero `quiz-*` usages. A
developer harness, not a room surface.

### 3. Adding a field to the registry: the flow and the gates

`quizSchema` (`src/quiz/schema.ts:306-352`) is a flat `z.object({ id, title, code, questions })`
plus a top-level `superRefine`. All three identity fields are declared as bare `z.string()` with
their **formats checked in the `superRefine`**, and `schema.ts:296-305` states why: a field-level
failure reports against a path, and *"a path names neither the quiz nor the fix. The reader is an
organizer looking at a failed build minutes before showtime."* Every message is Polish, prefixed
`Quiz "<id>"`. **A theme field's value rules belong in that `superRefine`, not as `.regex()` on
nested fields.**

One trap: Zod objects here are not `.strict()`/`.strip()`-annotated, so **default Zod behaviour
strips unknown keys**. A `theme` key added to a definition literal would type-check under
`satisfies Quiz` and be silently dropped by `safeParse` until it is declared in the schema.

`src/quiz/index.ts` parses once at module scope (`:202-206`) and exposes `getQuizById` (`:222`),
`getQuizByCode` (`:227`), `getQuestionById` (`:243`), `getQuizByQuestionId` (`:258`). **Every server
consumer gets the full parsed `Quiz`**, so `getQuizById(slug)?.theme` needs no plumbing at all in
frontmatter or an API route.

**The public projection is the real boundary.** `projectQuiz` builds a new object field-by-field
(`src/quiz/public.ts:227-233`), and the header comment at `:14-16` is explicit: *"Built by allowlist,
never by deletion. Picking the fields that may travel means a field added to `schema.ts` later is
invisible here by default."* Consequences for a theme:

- Reaching the **host/projector** needs nothing but a second frontmatter lookup — the sanctioned
  pattern, already in use for `code` at `host/[slug].astro:92` with its own justification at
  `:83-91` (*"Two lookups over a registry parsed once at module scope"*).
- Reaching the **attendee phone** means adding the field to `PublicQuiz` *and* `projectQuiz`, which
  deliberately trips `src/quiz/public.test.ts:102-111`
  (`expect(Object.keys(projection).sort()).toEqual(["id","questions","title"])`). That test exists to
  catch *"the next one, whatever it is called"* (`:264-275`), so widening it is a deliberate edit.
- **A theme string in the projection is scanned by value.** `public.test.ts` serializes the whole
  registry (`:28`) and asserts no accepted answer or numeric true value appears as a substring
  (`:47-59`) and that **no quiz's four-digit join code appears anywhere** (`:113-120`). unAIted's
  code is `1990` — a hex like `#1990ab` would fail that scan. Low probability, non-obvious failure.

**The build gate** is `assertQuizValid()` (`src/quiz/index.ts:217-219`), called at
`astro.config.ts:23`. Cross-quiz rules live in `registryProblems` (`index.ts:118-185`). Nothing
structural demands a cross-quiz theme rule: a theme is not an address and not a lookup key, and two
quizzes sharing a palette is not ambiguous the way a shared `title` is.

**A "does the logo file exist?" check cannot live at the gate.** `index.ts:86-90` states the reason
`RESERVED_QUIZ_SLUGS` is a literal rather than a directory read: *"this module has to import inside
a serverless function and a bare `vitest run`, where `node:fs` is either absent or the wrong
answer."* The sanctioned workaround is a **test** that reads the filesystem, as
`definition.test.ts:245-270` already does for the reserved slugs. Note the asymmetry that follows:
such a check gates `bun run test` / `pre-push`, **not the Vercel deploy** — and per the root
`CLAUDE.md`, a failed deploy is silent. A missing logo ships as a broken `<img>`, not a red build.

**Asset imports are out of the question in `src/quiz/`.** `portability.test.ts:25` fails any
`astro:`-prefixed import per file, recursively including `definitions/`. And although the regex
would *miss* `import logo from "../../assets/x.svg"`, that form is worse: it only resolves through
Vite's asset pipeline, and this module must load under a bare `vitest run` (there is no vitest
config in this repo) and inside a serverless function. **A logo must be a plain string path resolved
at render time** — which is exactly what the rest of the project already does (§5).

### 4. Delivery to the browser, and the two guards around the quiz pages

`src/lib/client/CLAUDE.md:15-17` is binding: *"A client module — **and any `<script>` block in
`src/pages/quiz/*.astro`** — may not read `import.meta.env` and may not *value*-import from
`src/quiz/` or `src/lib/session/`."* Frontmatter is deliberately unscanned (`:28-30`). So a theme
reaches the browser one of two ways: **server-rendered markup / classes / inline `style`**, or
**`define:vars`**. Today *no* colour crosses `define:vars` at any of its three sites
(`[slug].astro:526-535`, `host/[slug].astro:1225-1231`, `spine-check.astro:218`) — payloads are
channel names, storage keys, `quizId`, `quizTitles`, `questions`.

Two guards make edits to these two pages more expensive than they look:

- **Both pages are pinned in `.prettierignore`, and the pin is part of the guard.** Their tests
  assert the inline scripts as **literal text**, so re-wrapping a line can *silently disarm* an
  assertion rather than merely fail it (`src/pages/quiz/CLAUDE.md:9-14`). Adding a `define:vars`
  key touches text those tests match.
- Timer budgets: `host/[slug].test.ts` allows exactly one timer that can reach a `fetch`, and
  `[slug].test.ts` requires the attendee page to hold **zero** timers
  (`src/lib/client/CLAUDE.md:88-90`).

If a theme is delivered as an inline `style` on `:root`/`<body>`, one motion rule is adjacent:
`paintEntrance` removes its inline properties at completion because *"An element left holding
inline values is one whose stylesheet no longer decides them"*
(`context/archive/2026-08-16-quiz-animations-and-transitions/motion-contract.md:151-160`). A theme's
inline custom properties are a different thing from an animation's leftovers, but the principle is
worth answering explicitly rather than ignoring.

### 5. Typography — a live defect first, then the constraints

**`font-archivo` resolves to nothing, verified against a production build.** The token is
`--font-family-archivo` (`src/styles/global.css:39`); Tailwind 4's font-family namespace is
`--font-*`, so the token would generate `.font-family-archivo`, not `.font-archivo`. In
`dist/client/_astro/global.DSOcqY2f.css`:

- `.font-archivo` — **no such rule** (the only `.font-*` rules emitted are `.font-bold`,
  `.font-extrabold`, `.font-medium`, `.font-semibold`);
- `--font-family-archivo` — present in `:root`, referenced by nothing;
- `font-family: "Archivo"` — appears exactly **twice**, i.e. only inside the two `@font-face`
  blocks.

Every surface claims the class anyway: `BaseLayout.astro:58`, `src/pages/quiz/[slug].astro:126`,
`host/[slug].astro:344`, `host/index.astro:42`, `QuizNotice.astro:47`. **Net effect: the whole site
and the whole quiz render in the platform `ui-sans-serif` stack, while both `.woff2` files are
downloaded-declared and applied to nothing.** Two `@font-face` blocks split by `unicode-range` sit at
`global.css:4-28` over `public/fonts/Archivo-Variable-latin{,-ext}.woff2`; there is no preload link
for either.

This matters for the plan beyond being a bug: **every type size in the signage plan was measured for
Archivo** (`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:70-104`), with a hard floor
at `:106-107` — *"Nothing below 20px on the phone and nothing below 26px on the projector. If
something does not fit, cut words or drop a line — do not go smaller."* So fixing the token is not a
neutral cleanup: it changes the metrics of every measured surface at once, in the same change that
would introduce a second family. Those are two separate risks.

Font infrastructure facts (verified in the installed package, not assumed): `package.json:31` is
`astro@^6.4.8`, installed `6.4.8`. `fonts` is a **top-level, non-experimental** config key
(`node_modules/astro/dist/core/config/schemas/base.d.ts:466-480`), `Font.astro` ships
(`node_modules/astro/components/Font.astro`), and the providers include `google()`,
`googleicons()` and **`local()`** (`.../assets/fonts/providers/index.d.ts:13-17`) — so the existing
`public/fonts/*.woff2` could be adopted by the built-in pipeline. **Nothing in this repo exercises
any of it**, and `fonts` would go in `astro.config.ts`, the same file that carries the registry gate.

There is **no Google Fonts link anywhere** and no `fonts.googleapis.com` reference. `BaseLayout`
has **no `<slot name="head">`**, so there is no per-page head extension point — but the quiz routes
bypass that layout entirely and each owns its `<head>`, which is where a per-quiz `@font-face` or
preload would go.

### 6. The logo — no precedent for per-quiz assets, and the slot is taken

**Asset conventions.** `src/assets/` does not exist. `astro:assets` is used **nowhere**: zero
`<Image>`, zero `<Picture>`, zero `getImage`, zero `import img from`. Every image in the project is a
plain `public/` path in a raw `<img src>`. That is fortunate here — it is exactly the shape
`portability.test.ts` and the serverless/vitest constraint require.

Two precedents a per-quiz logo could copy:

- **`public/images/logo/`** — flat string paths (`BRAVE-WHITE.svg`, `BRAVE-BLACK.svg`,
  `HuuugeLogo.svg`, two Tidio files with spaces in their names), referenced verbatim at
  `src/components/Navbar.astro:14,72` and `src/components/Footer.astro:7`. **The closest match** is
  actually the content-collection partner logo: `src/content.config.ts:29,37` declares
  `logo: z.string()` — a required plain string path — rendered generically as
  `<img src={partner.logo} …>` at `src/pages/wydarzenia/[...slug].astro:102`. That is already "an
  entity declares its own logo as a string path" in this codebase.
- **`public/photos/events/<event-slug>/`** — per-entity subfolders, but paths are listed
  **explicitly in frontmatter, never globbed** (`src/content.config.ts:16`,
  `src/content/events/meetup-3.md:22-28`). The `<event-slug>` segment is convention only; nothing
  constructs or validates it. This is the shape a `public/images/quiz/<slug>/` would follow, and its
  never-globbed rule matches the no-`node:fs`-in-`src/quiz/` constraint.

**How to inject markup server-side**: the `qrcode` precedent. Generated in frontmatter
(`host/[slug].astro:223-228`), injected as `<Fragment set:html={…} />` at two call sites (`:415-422`,
`:626-632`), sized from the parent with `[&>svg]:h-full [&>svg]:w-full`. The constraint is stated at
`:220-222` — *"The generator is server-only. `boundary.test.ts` would fail the suite if a `<script>`
block below ever imported it."* There is no icon component and no icon library anywhere; inline
`<svg>` literals appear ad hoc in four marketing files, with `stroke="currentColor"` as the only
colour-inheritance convention. **No quiz page contains an inline `<svg>` literal at all.**

**The top-left slot the user asked for is occupied.** `host/[slug].astro:348-352` documents the top
strip's contract, and `#question-counter` holds the left (96px chrome index + 48px zinc total). The
right side is the QR and short address, pinned with `ml-auto` for a recorded reason (`:355-360`): *"a
lone flex child under `justify-between` sits at the *start*, so the QR slid to the left edge exactly
when the room was looking for it."* And `:357-359` records that the counter is `hidden` in the lobby
because *"A counter reading '— / 14' is not a fact about the session; it is a slot waiting to be
filled, and it reads from the back of the room as debris."* A logo added top-left changes the flex
arithmetic those comments exist to protect — and there is no slack: **the projector is a fixed
1920×1080 artboard**, `<body>` *is* the artboard, scaled by
`min(tan(atan2(100dvw, 1920px)), tan(atan2(100dvh, 1080px)))`, and `src/pages/quiz/CLAUDE.md:100-116`
forbids adding relative units to make a region fit and forbids answering an overflow by shrinking the
shell. Note the lobby's hidden counter means the left slot is *empty* in the lobby — which may be the
one phase where a logo costs nothing.

**No quiz view carries a logo today** (grep for `logo|Brave` under `src/pages/quiz/` returns
nothing). Separately: the Brave Courses logo and outbound link are what put Vercel Hobby's
non-commercial restriction at issue, accepted as a risk with a tripwire
(`context/foundation/infrastructure.md:35,167,193,266`, `tech-stack.md:52`,
`docs/runbook-live-session.md:345`). Adding sponsor branding to the projector touches that risk
register — a factor to flag, not a blocker.

### 7. What the history already decided, and what a theme would make false

The signage redesign (`context/archive/2026-08-15-livequiz-signage-redesign/`) declared itself
*"**Presentation only.** No route, schema, session-key, scoring or state-machine change"*
(`change.md:22-24`). This change is its mirror image — a **schema** change made for presentation's
sake — which is precisely the justification `src/quiz/CLAUDE.md:177-181` demands of anything living
in that directory (it argues `timeLimitSeconds` is *pacing, not scoring*, and that distinction is
"the whole of why it is allowed in this directory").

**The one explicit prohibition**, `plan.md:221-222`:

> Do **not** introduce a second `@theme` block, a `:root` override on the quiz pages, or a
> `data-theme` attribute. A prefix is boring and it makes every quiz class name self-evident in a
> diff.

A per-quiz palette is one of those three, by construction. It is a prohibition to overturn
deliberately and in writing, not to work around.

**Two mechanisms that depend on the palette being global:**

- **Chrome's rationing.** `plan.md:65-68`: *"Chrome is the accent everywhere except the closing
  screen, where it becomes the ground and ink becomes the type — that inversion is the visual signal
  that the session ended, **and it only works because chrome was rationed up to that point.** Mint
  and signal never appear together on one screen."* Restated at `host/[slug].astro:332-334` and at
  `motion-contract.md:148-149`, which is also why the projector deliberately gets **no confetti**.
  A 90s palette that is loud everywhere, or whose ground is not ink, removes the mechanism.
- **The four-colour message register.** `plan.md:172-186`: *"Marker colour is the whole
  message-register system"* — mint = it happened, `#3A3A40` = in flight, chrome = you must decide,
  signal = refused (`EDGE_COLOURS`, `host/[slug].astro:2925-2930`). **`mint` and `signal` are
  semantic, not decorative** (`plan.md:46-48`: "Correct answer / correct verdict. Nothing else." /
  "Refusal or failure. Nothing else."), and `zinc` is "Labels only." A theme should probably be
  forbidden from reaching these.

**An operational instruction that a per-quiz palette makes wrong** —
`docs/runbook-live-session.md:549`:

> **The projector inverts when it lands** — the whole screen turns yellow with the winner's name in
> […] room that it is over, so you will know the close took without reading anything.

**A recorded hazard the naive approach reopens.** `reviews/impl-review.md:195-208` (F10): the reveal
resolved correctly *"only because Tailwind orders same-utility rules by theme-token declaration
order and `slab-inactive` is declared after `chrome` — **reordering the `--color-quiz-*` block would
silently flip the reveal's slabs back to chrome**"*. Fixed by moving to mutually exclusive `data-`
variants. Overriding custom-property *values* (not adding same-utility rules) stays clear of this,
but an override layer built as extra classes walks straight back into it.

**The only contrast number in the repo, and it is a defect**: `reviews/impl-review.md:222-223` —
`#version` renders at **2.22:1**, below the 3:1 large-text floor. There is no WCAG target anywhere,
no contrast budget, no colour-blindness consideration. And `verification.md:53-55` records that the
one step never completed is *"The read from the back of the venue"* — so **the current palette's
legibility has never been validated in the room**, and a second palette multiplies the unvalidated
combinations.

**unAIted already exists and already carries the 90s brief.** `git show --stat 605ce27`:
`src/quiz/definitions/unaited.ts` (new, 303 lines) plus the registry line.
Identity — `id: "unaited"`, `title: "BRAVE UnAIted"`, `code: "1990"` (`unaited.ts:51-53`). It sits at
**position 0** of `quizDefinitions`, which makes it the picker's first entry, `fixtureQuiz()`'s quiz
and `/quiz/spine-check`'s. The brief is already written in its docstring (`unaited.ts:3-18`): *"The
centre of gravity is 1990s subculture, played for nostalgia, with BRAVE bookending it… the party is a
szkolna dyskoteka and the join code is a year"*. The join code `1990` is itself part of the motif.

**In-flight conflict check**: `context/changes/testing-sync-degraded-link/` (status
`impl_reviewed`) is test-only, touches no styling, **no conflict**. Its one adjacency is the
degraded banner, which is a chrome-coloured surface.

## Code References

Palette and styling
- `src/styles/global.css:36-45` — site tokens + the inert `--font-family-archivo`
- `src/styles/global.css:46-67` — the 20 `--color-quiz-*` tokens; `:41-45` the scoping rationale
- `src/styles/global.css:4-28` — the two `@font-face` blocks over `public/fonts/`
- `astro.config.ts:29` — Tailwind wired as `@tailwindcss/vite`, no config file, no theme extension
- `astro.config.ts:23` — `assertQuizValid()`, the only pre-production gate

Quiz surfaces
- `src/pages/quiz/[slug].astro:126` — attendee body classes; `:807-833` the 12-token option list
- `src/pages/quiz/[slug].astro:38-41` — why there is no `BaseLayout`; `:526-535` `define:vars`
- `src/pages/quiz/host/[slug].astro:344` — host body; `:282-299` the canvas `<style is:global>`
- `src/pages/quiz/host/[slug].astro:348-360` — the top strip's contract and the `ml-auto` reason
- `src/pages/quiz/host/[slug].astro:92` — the second-lookup pattern for a non-projected field
- `src/pages/quiz/host/[slug].astro:223-228`, `:415-422`, `:626-632` — the QR generate/inject precedent
- `src/pages/quiz/host/[slug].astro:227` — hardcoded QR hexes, deliberately palette-independent
- `src/pages/quiz/host/[slug].astro:2915` — never assemble a class name from parts
- `src/components/QuizNotice.astro:2,39,47` — the shared full-document shell for `/quiz` and `/q/<code>`
- `src/pages/quiz/spine-check.astro:57-160` — the out-of-scope harness with its own hexes

Client layer
- `src/lib/client/render.ts:168-180`, `:482-494`, `:691-706`, `:946-951` — the four class contracts
- `src/lib/client/celebrate.ts:114-124` — the hand-duplicated confetti hexes
- `src/lib/client/CLAUDE.md:15-17` — the boundary; `:28-30` frontmatter carve-out; `:88-90` timer budgets

Registry
- `src/quiz/schema.ts:306-352` — `quizSchema` and the `superRefine`; `:296-305` why formats live there
- `src/quiz/index.ts:202-206`, `:217-219` — parse at module scope, the greppable gate
- `src/quiz/index.ts:86-90` — no `node:fs` in this module, and why
- `src/quiz/public.ts:14-16`, `:227-233` — the allowlist projection
- `src/quiz/public.test.ts:102-111`, `:113-120`, `:47-59` — the key-set and substring tripwires
- `src/quiz/portability.test.ts:25` — the recursive `astro:` import ban
- `src/quiz/definitions/unaited.ts:3-18`, `:51-53` — the 90s brief and the identity fields
- `src/content.config.ts:29,37` + `src/pages/wydarzenia/[...slug].astro:102` — `logo: z.string()` precedent

Guards on the two quiz pages
- `src/pages/quiz/CLAUDE.md:9-14` — the `.prettierignore` pin *is* the guard
- `src/pages/quiz/CLAUDE.md:100-116` — the 1920×1080 artboard and the no-relative-units rule

## Architecture Insights

1. **The project already separated "what colour" from "where colour is used" — once.** The
   `--color-quiz-*` layer means a palette swap touches ~22 declarations, not 246 call sites. What it
   did *not* anticipate is a *second* set of values for the same names. Tailwind 4's `@theme`
   compiles utilities to `var(--color-quiz-*)`, so a scoped re-declaration is mechanically the right
   lever — and it is also the exact thing `plan.md:221` forbids. The technical answer and the
   documented decision point in opposite directions; that is the plan's central question, not a
   detail.
2. **Semantic colour and decorative colour are mixed in one namespace.** `mint`, `signal`, `zinc`
   and the four register colours *mean* things (correct, refused, label, in-flight). `ink`,
   `asphalt`, `float`, `signwhite`, `chrome` are the ground and accent. A theme that repaints
   everything breaks meaning; a theme that repaints only the ground/accent set is a much smaller,
   defensible change. **The token list probably needs splitting into themeable and fixed before
   anything else happens.**
3. **Chrome is load-bearing twice over.** It is both the accent and — by being rationed — the
   closing-screen signal, which the runbook tells the host to rely on. Any theme must either preserve
   an inversion the room can read, or the runbook changes with it.
4. **Server-side theming has a clean route and the client boundary does not need to move.** A theme
   read in frontmatter and rendered into markup/`<style>` never touches `define:vars`, never trips
   `boundary.test.ts`, and keeps `render.ts` colour-agnostic. That is the cheapest correct shape.
5. **The three asks are three different risk sizes.** Colours: one indirection layer, already
   factored. Logo: a layout change on a fixed artboard with an occupied slot and a documented flex
   arithmetic. Typography: blocked behind a real defect whose fix re-metrics every measured surface.
   Sequencing them as one phase would put the riskiest work behind the safest.
6. **The build gate cannot enforce most of what matters here.** No filesystem check, so "the logo
   exists" is a test, not a gate — and a failed deploy is silent. Contrast has no target anywhere in
   the repo, and the current palette was never read from the back of the venue.

## Historical Context (from prior changes)

- `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221-222` — the explicit prohibition
  on a second `@theme`, a `:root` override on the quiz pages, or `data-theme`.
- `.../plan.md:39-68` — the eight base tokens, the twelve tints, and the pairings declared
  "decisions, not preferences" (chrome rationing; mint and signal never on one screen).
- `.../plan.md:70-107` — the full type scale, measured for Archivo, with the 20px/26px floors.
- `.../plan.md:172-186` — the four-colour message register; the bubble docks inside the control bar,
  "overlay was tried and rejected".
- `.../plan.md:313-329` — the guardrails: boundary test, single loop / single fetch / single
  `CONTROL_RULES` reader, no UI framework, Polish copy verbatim.
- `.../reviews/impl-review.md:195-208` — F10, the token-declaration-order hazard, fixed by
  `data-` variants.
- `.../reviews/impl-review.md:222-223` — `#version` at 2.22:1, the only contrast figure in the repo.
- `.../verification.md:53-55` — the read from the back of the venue was never done.
- `context/archive/2026-08-16-quiz-animations-and-transitions/motion-contract.md:54-64` — reduced
  motion gets the final state immediately; a re-render cancels the frame; an unchanged thing is not
  re-animated. `:128-140` — the confetti imports stay dynamic and the reduced-motion gate runs
  *before* them. `:148-149` — the projector deliberately gets no confetti, because chrome is
  rationed. `:88-149` — **confetti colours were never specified**.
- `context/archive/2026-08-16-multiple-quizzes/plan-brief.md:38` — the three per-quiz fields and
  their routing/copy justification; `:56-57` the out-of-scope list, in which presentation appears
  **neither** as in-scope nor out-of-scope. Per-quiz presentation was never raised.
- `src/quiz/definitions/index.ts` — "Order is the picker's order": the one existing precedent for an
  editorial choice living in the definition rather than the page (ordering only, and it is data the
  page reads, not styling).
- `context/foundation/prd.md:281` (FR-001, no builder interface), `:311` (FR-005 large screen),
  `:318` (FR-006 winner reveal), `:408` (FR-015 word cloud), `:292` (FR-002 join budgets),
  `:365` (FR-020 the room sees the clock), `:113-115` (the legibility and Polish guardrails).
  **There is no FR about palette, branding, typography or accessibility.**
- `context/changes/testing-sync-degraded-link/` — in flight, test-only, no conflict.

Documents that would carry a false statement after this change (per `lessons.md:164-181`, the
CLAUDE.md edit belongs in the plan's docs phase, not discovered at the end):

| File | Sentence that becomes false |
| --- | --- |
| `src/styles/global.css:41-45` | "Every `quiz-` class name is therefore self-evident in a diff" — `bg-quiz-chrome` would mean two colours |
| `src/quiz/CLAUDE.md:132-142`, `:177-181` | the per-quiz field list, and the argument about what may live in this directory |
| `src/pages/quiz/host/[slug].astro:332-334` | the chrome inversion "works *because* chrome was rationed" |
| `docs/runbook-live-session.md:549` | "the whole screen turns yellow" |
| `.../signage-redesign/plan.md:221-222` | quote and overturn in place, as the PRD and `state.ts` already do |
| `.../motion-contract.md:148-149` | the projector's no-confetti rationale, if the palette changes |
| `src/pages/quiz/host/[slug].astro:348-360` | the top strip's contract and the `ml-auto` arithmetic, if a logo lands top-left |

## Related Research

- `context/archive/2026-08-16-testing-host-control-rules/research.md` — the house convention for
  permalinks (base stated once, local `file:line` inline) followed above.
- `context/archive/2026-08-16-multiple-quizzes/research.md` — how the registry became multi-quiz.
- `context/foundation/health-check.md`, `stack-assessment.md` — standing defect and tooling context.

## Open Questions

Decisions for `/10x-plan` (or `/10x-frame` if the first one is contested):

1. **Overturn or respect `plan.md:221`?** A per-quiz palette *is* a `:root` override or a
   `data-theme` attribute. If overturned, the plan must quote the position and say what replaced the
   reasoning — a diff-legibility argument, which the override layer weakens by design.
2. **Which tokens are themeable?** Recommendation from the evidence: ground and accent
   (`ink`, `asphalt`, `float`, `signwhite`, `chrome` + their tints) themeable; **`mint`, `signal`,
   `zinc` and the four register colours fixed**, because they carry meaning the host reads under
   pressure. Needs an explicit decision either way.
3. **What replaces the closing inversion if chrome is no longer rationed?** Either every theme
   declares a distinct closing ground with the same "unmistakable from the back" property, or the
   inversion stays global and themes may not touch it. The runbook changes in the same slice.
4. **The Archivo defect: fix it in this change or in its own?** Fixing `--font-family-archivo` →
   `--font-archivo` re-metrics every surface measured in `plan.md:70-104` at once. My read: **its own
   change, landed and eyeballed first** — otherwise a per-quiz font lands on top of an
   unvalidated global type change and neither can be assessed.
5. **Does the theme reach the attendee phone at all, or only the projector and panel?** Phone-only
   costs a `PublicQuiz` field plus two widened allowlist tests plus exposure to the substring scans;
   projector-and-panel-only costs one frontmatter lookup. The 90s brief is a *room* moment, so the
   cheaper scope may also be the better one.
6. **Where does the logo actually go, given the counter holds the left slot?** Options: the lobby
   only (where the counter is `hidden` and the slot is genuinely free), a third flex child with the
   arithmetic re-derived, or somewhere other than top-left. The artboard has no slack and no relative
   units are allowed.
7. **Do the confetti colours follow the theme?** Never specified before, so it is a new decision;
   `celebrate.ts:124` invites the swap in its own docstring.
8. **Contrast: what is the floor?** There is no target in the repo, one known 2.22:1 defect, and the
   current palette was never read from the back of the venue. A second palette without a stated floor
   is how an illegible screen ships to a room.
9. **Where do theme values live — the definition, or a themes module the definition names by key?**
   A `theme: "nineties"` key pointing at a themes module keeps hex values out of `src/quiz/`
   (avoiding the join-code substring scan and the "why is presentation in this directory" argument),
   at the cost of one more indirection.
