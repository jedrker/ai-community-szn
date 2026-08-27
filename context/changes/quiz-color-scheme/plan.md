# Per-quiz colour scheme, logo and typography — Implementation Plan

## Overview

Split the LiveQuiz palette's 20 `--color-quiz-*` tokens into a **themeable** set (ground,
surfaces, hairlines, type) and a **frozen** set (everything that carries a message the room or the
host is instructed to read), then give BRAVE UnAIted a 1990s palette on the three surfaces where a
quiz is actually in scope: the projector, the host panel and the attendee phone. Close the
verification gap with the repo's first contrast floor, enforced in `vitest`.

The look is a property of **the evening**; the quiz slug is a deliberate proxy for it, because no
event record links to a quiz today (see Frame Brief, D1b).

## Current State Analysis

Verified at `c56424b` (two commits landed after the research doc — neither invalidated it):

- **The colour indirection already exists.** 20 tokens in one `@theme` block
  (`src/styles/global.css:46-67`), consumed as Tailwind 4 utilities in ~246 places across five
  files. **Zero colour literals in `src/lib/client/*.ts`** — `render.ts` takes class-name contracts
  from its caller, so no client module needs to change. A per-quiz palette is a re-declaration of
  custom-property *values*, not a repaint.
- **The palette mixes two layers under one naming scheme.** Nine tokens are structural; eleven
  carry a fact — `mint` (correct), `signal` (refused), `slab-inactive` (*not* the answer, at the
  reveal), `pill-border` (the `pending` register), the `locked-*` trio (my locked pick),
  `chrome-tint` (this one is mine), `mint-tint`, and `ink-on-chrome` (bound to unthemed `chrome`).
- **`chrome` is load-bearing three ways at once**: next-action accent, the attention/degraded
  register, and — by being rationed everywhere else — the closing screen's ground.
- **The closing beat already has three carriers**, which is what makes it safe to leave alone:
  the inversion (`src/pages/quiz/host/[slug].astro:288`, `:344-345`), the heading flip
  `Ranking`→`Zwycięzca` (`:2674`), and the sentence `Sesja zakończona. Dziękujemy za grę!`
  (`:1096`).
- **The projector's left slot is occupied but `hidden` in the lobby.** `#question-counter` holds it
  (`host/[slug].astro:365-375`); the QR block beside it is pinned `ml-auto` for a documented reason
  (`:377-382`). The page is a fixed 1920×1080 artboard with no slack.
- **Nothing in the repo can see a colour.** No CI (`.github/` does not exist), no contrast or a11y
  check anywhere, `context/foundation/test-plan.md` records accessibility as "none, and not
  planned", and no `e2e/` spec opens this quiz — `e2e/support/host-session.ts:34,59` pin the other
  two. The only contrast figure in the repo is a defect: `pill-disabled` on asphalt at **2.22:1**
  (`context/archive/2026-08-15-livequiz-signage-redesign/reviews/impl-review.md:217-218`).
- **A documented prohibition stands in the way** and is overturned deliberately by this plan:
  *"Do not introduce a second `@theme` block, a `:root` override on the quiz pages, or a
  `data-theme` attribute"* (`.../signage-redesign/plan.md:221-222`).

### Key Discoveries

- **Each `[slug]` page renders exactly one quiz**, so the override needs no `data-*` attribute and
  no specificity contest: a `<style is:global>` block that *exists only when the quiz has a theme*
  re-declares the themeable tokens on `:root`. This sidesteps the recorded ordering hazard (F10,
  `.../impl-review.md:195-208`) entirely, because it overrides variable **values** rather than
  adding same-utility rules.
- **`<html>` carries the ground too** (`src/pages/quiz/[slug].astro:106`,
  `host/[slug].astro:283-286`), so the override must land on `:root`, not on `body`.
- **The closing screen is not fully insulated.** Its foreground is `data-[phase=ended]:text-quiz-ink`
  (`host/[slug].astro:344-345`) and the leader row uses `first:text-quiz-ink` — and `ink` *is*
  themeable. Unthemed `chrome` ground × themed `ink` foreground is a real pair and must be
  contrast-tested. This is a gap in "the inversion stays global", not a reason to reverse it.
- **The sanctioned way to read a non-projected quiz field** is a second frontmatter lookup,
  `getQuizById(slug)?.<field>` (`host/[slug].astro:92`, for `code`). Frontmatter is deliberately
  outside `boundary.test.ts`'s scan.
- **`src/lib/` convention**: named exports, no default exports (`src/lib/CLAUDE.md`).
- **The filesystem-reading-test pattern** for keeping two lists in step lives at
  `src/quiz/definition.test.ts:245-270`, including its non-vacuity guard.
- **A second carrier for a coloured fact is already house style**: `const DELTA_UP = "▲"`
  (`src/lib/client/render.ts:758`), fill-vs-outline for single-vs-multiple choice
  (`host/[slug].astro:1698-1712`), and `role="status"` sentences beside every coloured dot.
- **`grep` in this environment silently skips `src/lib/client/render.ts`** (a `ugrep -I`
  misdetection; the file is valid UTF-8). Use `grep -a`, `awk` or `sed` when verifying anything
  there. This matters for the docs-grep step `lessons.md:164-181` requires.

## Desired End State

BRAVE UnAIted renders in a 1990s palette on `/quiz/unaited`, `/quiz/host/unaited` and the
projector, while the other two quizzes are pixel-identical to today. Every message the host or the
room is instructed to read — correct/refused, the four-way rail register, the connection lamp, the
closing inversion — is in exactly the colour it is today, in every quiz. A themed quiz whose
palette would put text below **4.5:1** against its own ground fails `bun run test`, and therefore
fails the build gate's sibling checks before anyone opens a laptop.

Verify: `bun run test`, `bun run type-check`, `bun run lint` all clean; `/quiz/unaited` and
`/quiz/host/unaited` visibly 90s; `/quiz/summer-tour-szczecin` and `/quiz/jesienny-meetup-ai`
unchanged; the closing screen yellow on all three.

## What We're NOT Doing

- **Not touching the Archivo token defect.** `--font-family-archivo` (`src/styles/global.css:39`)
  sits in the wrong Tailwind 4 namespace (`--font-*`), so `.font-archivo` resolves to nothing and
  every surface renders in the platform sans stack. Fixing it re-metrics every measured surface at
  once — including `promptClass`'s character-count step-downs, tuned for Archivo — so it is **its
  own change**, landed and eyeballed separately. Recorded here so it is not lost.
- **Not theming the entry surfaces.** `/quiz`, `/q/<code>` and `src/components/QuizNotice.astro`
  stay default by decision: neither entry page has a quiz in scope on any render that emits HTML
  (they resolve the code and redirect), and `QuizNotice` is shared by four surfaces with different
  theme status. The 404 branches of both `[slug]` pages therefore also stay default.
- **Not theming the picker** (`/quiz/host`): one `<body>`, three quizzes.
- **Not putting a `theme` field in `quizSchema`.** It buys generality nothing asks for, and it is
  the expensive half — a Polish `superRefine` clause, exposure to `public.test.ts:113-120`'s
  join-code substring scan (unAIted's code is `1990`, so `#1990ab` or `theme-1990s` would fail with
  a message about leaking join codes), a widened allowlist plus two deliberately-tripped
  assertions, and an amendment to `src/quiz/CLAUDE.md:177-181`.
- **Not changing the confetti in Phase 1.** `src/lib/client/celebrate.ts:124` hardcodes the four
  signage hexes; since `mint`/`signal`/`signwhite`/`chrome` are all frozen, it stays correct.
- **Not theming the QR.** `host/[slug].astro:227`'s `#0b0b0c`/`#ffffff` is a scanner-reliability
  decision that must not follow a palette.
- **Not adding a visual-regression or screenshot baseline.** `context/foundation/test-plan.md` §7
  dropped the visual phase deliberately; this plan does not reverse that.
- **Not reordering `src/quiz/definitions/index.ts`.** `unaited` is position 0, which
  `fixtureQuiz()`, `/quiz/spine-check` and `scripts/rehearse-room.ts` all read; moving it silently
  points the pre-event rehearsal at an unthemed quiz.
- **Not bulk-renaming `quiz-*` strings.** `host/[slug].astro:1300`'s
  `SECRET_STORAGE_KEY = "quiz-host-secret"` is a bare literal outside `keys.ts`; rewriting it
  typechecks, passes tests, and makes the host retype the secret in front of the room.

## Implementation Approach

One pure module is the source of truth for both the CSS and the test. `src/lib/theme.ts` declares
the themeable token names as a typed const, holds each theme's values, and maps quiz slug → theme.
The two `[slug]` pages resolve it in frontmatter (the `host:92` pattern) and render a
`<style is:global>` block re-declaring those custom properties on `:root` — present only when a
theme exists, so an unthemed quiz emits no extra bytes and no extra rule.

Three tests carry the invariants that prose cannot: no theme may name a frozen token; every theme
key must resolve to a committed quiz; and every foreground/background pair a theme creates must
clear 4.5:1.

### The token split

**Themeable (9)** — ground, surfaces, hairlines and type, none of which carries a message:
`ink`, `asphalt`, `float`, `signwhite`, `zinc`, `divider`, `field-border`, `echo`, `pill-disabled`.

`zinc` is in despite two semantic uses (`VERDICT_TONES.silent` for `Bez odpowiedzi`,
`CONNECTION_UNLIT`) because **both are worded** — the verdict prints text and the lamp keeps a
`role="status"` sentence — and it is the palette's most-used token, so excluding it would leave a
theme barely visible. `pill-disabled` is in and is always accompanied by the real `disabled`
attribute; theming it under a 4.5:1 floor also retires the 2.22:1 defect.

**Frozen (11)** — each carries a fact, or is bound to a token that does:
`chrome`, `mint`, `signal`, `slab-inactive`, `pill-border`, `chrome-tint`, `mint-tint`,
`locked-tint`, `locked-slab`, `locked-letter`, `ink-on-chrome`.

## Critical Implementation Details

**Both `[slug]` pages are pinned in `.prettierignore:24-25`, and the pin is part of the guard** —
their tests assert the inline scripts as literal text, so a manual reflow can *disarm* an assertion
rather than fail it. Add the `<style>` block without re-wrapping neighbouring lines, then run
`npx prettier --check` on both paths and the two page test files.

**The closing pair.** Because `data-[phase=ended]:text-quiz-ink` and `first:text-quiz-ink` paint on
unthemed `chrome`, the contrast test must include `chrome × themed ink` explicitly. Omit it and a
themed `ink` can put the winner's name at an unreadable ratio on the one screen the whole room
looks at.

## Phase 1: The token split, the theme module, and UnAIted's palette

### Overview

Everything visible, nothing semantic. Delivers the 90s palette on the three in-scope surfaces plus
the repo's first enforced contrast floor. This is the phase that ships before the event.

### Changes Required:

#### 1. The theme module

**File**: `src/lib/theme.ts` (new)

**Intent**: One source of truth for which tokens a theme may set, what each theme sets them to, and
which quiz gets which theme — readable from Astro frontmatter and from `vitest` alike.

**Contract**: Named exports only (`src/lib/CLAUDE.md`). Exports the themeable token names as a
readonly tuple; a `QuizTheme` type keyed to exactly those names so a frozen token is a **compile
error**; the UnAIted 90s theme; a slug→theme registry; and a `getThemeForQuiz(slug)` accessor
returning `undefined` for an unthemed quiz. Values are plain hex strings. No `astro:` imports, no
image imports, no `import.meta.env`.

#### 2. The theme's CSS delivery

**Files**: `src/pages/quiz/[slug].astro`, `src/pages/quiz/host/[slug].astro`

**Intent**: Resolve the theme in frontmatter and re-declare its tokens on `:root`, only when one
exists.

**Contract**: A frontmatter `getThemeForQuiz(slug)` call beside the existing lookups, and a
conditional `<style is:global>` block in `<head>` emitting `:root { --color-quiz-<name>: <hex>; … }`.
Must target `:root` (not `body`) because `<html>` carries the ground
(`[slug].astro:106`, `host/[slug].astro:283-286`). Must not introduce a `data-theme` attribute, and
must not touch any frozen token — so the closing inversion, the rail register and the reveal keep
reading the global values.

#### 3. The invariants

**File**: `src/lib/theme.test.ts` (new)

**Intent**: Enforce in code the three things this plan asserts in prose.

**Contract**: (a) no theme object contains any frozen token name — asserted at runtime as well as
in the type, since a future theme could be authored loosely; (b) every slug in the theme registry
resolves through `getQuizById`, in that direction only (an unthemed quiz is legal, a theme for a
non-existent quiz is not) — patterned on `src/quiz/definition.test.ts:245-270`, including a
non-vacuity guard; (c) a contrast assertion, below. Names no hex value and no quiz title: the
assertions iterate the registry and name the offending theme in the failure message.

#### 4. The contrast floor

**File**: `src/lib/theme.ts` (contrast helper) + `src/lib/theme.test.ts` (the assertion)

**Intent**: Give the repo its first stated, enforced legibility floor, so a themed palette cannot
reach a room illegible.

**Contract**: A pure `contrastRatio(foreground, background)` implementing WCAG 2.x relative
luminance, exported for the test. The assertion iterates every theme and requires **≥ 4.5:1** for
each foreground/background pair the theme creates: `signwhite`/`echo`/`zinc`/`pill-disabled` over
`ink`, `asphalt` and `float`, plus the **unthemed `chrome` × themed `ink`** closing pair. A
deviation requires an explicit, commented entry in an exceptions list that starts empty. Failure
messages name the theme, the pair and the measured ratio.

#### 5. UnAIted's 90s values

**File**: `src/lib/theme.ts`

**Intent**: The actual look — a period palette for the *szkolna dyskoteka* motif the quiz's own
docstring describes (`src/quiz/definitions/unaited.ts:3-18`).

**Contract**: Nine hex values for the themeable tokens, every text pair clearing 4.5:1 against its
own ground. No value may contain a four-digit run matching a committed join code (`1990`, `1001`,
`2002`) — not enforced by `public.test.ts` here, since the theme never enters the projection, but
worth avoiding so a future move into the registry does not trip that scan.

#### 6. The documents this makes false

**Files**: `src/styles/global.css`, `src/pages/quiz/CLAUDE.md`, `docs/runbook-live-session.md`,
`context/changes/quiz-color-scheme/` (this change)

**Intent**: Amend, in this same change, every statement Phase 1 overturns — per
`context/foundation/lessons.md:164-181`.

**Contract**: `global.css:41-45`'s claim that every `quiz-` class name is self-evident in a diff
becomes "self-evident for the frozen set; the themeable nine are re-declared per quiz, see
`src/lib/theme.ts`". `src/pages/quiz/CLAUDE.md` gains a short section naming the split, the
`:root`-not-`body` rule, and the frozen list. `docs/runbook-live-session.md`'s colour instructions
(`:402-414`, `:549`) gain one sentence stating that the register colours, the lamp and the closing
inversion are the same in every quiz **by construction** — which makes the existing table true
rather than rewriting it. Quote and overturn `.../signage-redesign/plan.md:221-222` rather than
deleting it. **Grep the docs with `grep -a`** — plain `grep` silently skips `render.ts`.

### Success Criteria:

#### Automated Verification:

- Tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- Formatting clean on the two pinned pages: `npx prettier --check "src/pages/quiz/[slug].astro" "src/pages/quiz/host/[slug].astro"`
- The frozen-token guard fails when a theme is given a frozen token (verify by temporarily adding one, per `lessons.md:122-142`)
- The contrast guard fails when a theme value is darkened below the floor (verify the same way, then restore)
- The stale-slug guard fails when the theme registry names a non-existent quiz

#### Manual Verification:

- `/quiz/unaited` and `/quiz/host/unaited` render the 90s palette; the other two quizzes are unchanged
- The projector's closing screen is yellow with black type on **all three** quizzes, and the winner's name is legible
- The rail's four message colours, the connection lamp, the correct-answer band and the reveal are unchanged on the themed quiz
- Read the projector from the back of the room, or as far back as available — the one step no test replaces

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: The logo

### Overview

The evening's mark where the slot is genuinely free and the room is already looking: the
projector's lobby, and the attendee's join screen.

### Changes Required:

#### 1. The asset and its path

**File**: `src/lib/theme.ts`, plus the asset under `public/images/quiz/unaited/`

**Intent**: Let a theme name a logo without an import.

**Contract**: An optional `logo` field on `QuizTheme` — a plain string path, following
`src/content.config.ts:29`'s `logo: z.string()` precedent. Never an ESM or `astro:assets` import:
the module must load under a bare `vitest run` and inside a serverless function.

#### 2. Projector lobby placement

**File**: `src/pages/quiz/host/[slug].astro`

**Intent**: Show the mark in the lobby only, where `#question-counter` is `hidden` and the left
slot is free.

**Contract**: A lobby-only element in the top strip's left slot, sized in fixed px against the
1920×1080 artboard — no `vw`, no `clamp` (`src/pages/quiz/CLAUDE.md:100-116`). Must not disturb the
QR block's `ml-auto` (`:377-382`), and must be hidden in every phase where the counter is shown, so
the two never compete for the slot.

#### 3. Attendee join screen

**File**: `src/pages/quiz/[slug].astro`

**Intent**: The same mark above the join form, where the page is fluid.

**Contract**: An `<img>` with the theme's path, rendered only when a theme with a logo exists,
above the join card. Fluid units are fine here — this page is `min-h-dvh`, not an artboard.

#### 4. A resolvable-path guard

**File**: `src/lib/theme.test.ts`

**Intent**: Catch a mistyped or missing logo before a session, since a broken `<img>` is silent.

**Contract**: A test reading `public/` from disk and asserting every theme's `logo` resolves to a
real file — the `definition.test.ts:245-270` pattern. A test may use `node:fs`; `src/lib/theme.ts`
may not.

### Success Criteria:

#### Automated Verification:

- Tests pass: `bun run test`, including the new path guard
- The path guard fails when the logo path is misspelled (verify, then restore)
- Type checking and linting pass; the two pinned pages stay prettier-clean

#### Manual Verification:

- The logo shows in the projector's lobby and disappears once the first question is on screen
- The join QR and short address stay exactly where they were in the lobby
- The logo shows on the attendee join screen and pushes nothing below the fold on a small phone
- No layout shift on the projector when the first question opens

---

## Phase 3: A second carrier for the two colour-only messages

### Overview

Accessibility work that this plan's token split made **optional rather than urgent** — `mint` and
the `locked-*` trio are frozen, so nothing here blocks the skin. Decoupled on purpose.

### Changes Required:

#### 1. The correct option, on both surfaces

**Files**: `src/lib/client/render.ts`, `src/pages/quiz/[slug].astro`,
`src/pages/quiz/host/[slug].astro`

**Intent**: Give "this was the correct option" a carrier besides hue, as `▲`/`▼` already does for
rank movement.

**Contract**: A glyph or short label emitted beside the correct option at the reveal, driven by the
`data-correct` attribute `render.ts` already sets. Follows `DELTA_UP`'s shape
(`src/lib/client/render.ts:758`) — a module-level constant, not an inline string. The class-name
contracts stay caller-supplied; `render.ts` must remain colour-agnostic.

#### 2. My locked pick versus the correct answer

**File**: `src/pages/quiz/[slug].astro`

**Intent**: Distinguish "mine" from "correct" on the phone by something other than two tints.

**Contract**: A short Polish label or mark on the attendee's own locked pick, alongside the
existing `locked-*` treatment (`:828-833`). Must not disturb `#result-verdict`, which already
writes words and colour together as one statement.

#### 3. Tests

**Files**: `src/lib/client/render.test.ts`, the two page test files

**Intent**: Pin the new carriers so a later edit cannot silently drop them back to colour-only.

**Contract**: Assertions on the rendered glyph/label — the *property*, never a class-name shape
(`src/quiz/CLAUDE.md`'s source-scan rule). Verify each in both directions: passes on correct code,
fails when the carrier is removed.

### Success Criteria:

#### Automated Verification:

- Tests pass: `bun run test`
- Each new carrier's test fails when that carrier is removed (verify, then restore)
- Type checking, linting, and prettier on the pinned pages all clean

#### Manual Verification:

- The correct option is identifiable on projector and phone with the screen's colour turned down
  (greyscale screenshot, or a display in monochrome)
- "Mine" and "correct" are distinguishable on the phone without relying on hue
- Nothing shifted on the reveal beat

---

## Phase 4: Typography — a display face on non-measured text only

### Overview

The one typography move that is safe while the Archivo defect stands and the artboard's measured
sizes remain keyed to character counts.

### Changes Required:

#### 1. The face and its scope

**Files**: `src/styles/global.css` or a themed `@font-face`, `src/lib/theme.ts`

**Intent**: Let a theme carry a display face for headline-ish, non-measured text — the logo
wordmark area, the lobby's join heading — never the question prompt, the counter, the timer or the
standings.

**Contract**: An optional display-face field on `QuizTheme` plus a self-hosted `woff2` under
`public/fonts/`. The face must be applied by an explicit opt-in class used only on elements whose
size is not one of the artboard's measured values, so `promptClass`'s character-count step-downs
(`host/[slug].astro:1660-1671`) and the 20px/26px floors keep their meaning. `@font-face` must not
ship to the marketing site — scope it to the quiz pages' own `<head>`, since `global.css` is
imported by `BaseLayout.astro` too.

#### 2. A guard on the scope

**File**: `src/lib/theme.test.ts` or the host page's test

**Intent**: Keep the face off measured text.

**Contract**: An assertion that the display-face class does not appear on the prompt, counter,
timer or standings elements. Asserts the property, verified in both directions.

### Success Criteria:

#### Automated Verification:

- Tests pass: `bun run test`, including the scope guard
- The scope guard fails when the display class is added to the prompt (verify, then restore)
- Type checking, linting, prettier clean

#### Manual Verification:

- The display face appears only where intended; the prompt and counter are visually unchanged
- No layout shift on first paint on the projector (the face swaps without moving measured text)
- The marketing site's network panel shows no new font request

---

## Testing Strategy

### Unit Tests:

- The frozen-token guard, the stale-slug guard, the contrast floor (Phase 1)
- The logo path guard (Phase 2)
- The second-carrier assertions (Phase 3) and the display-face scope guard (Phase 4)
- Every guard verified in **both** directions, per `context/foundation/lessons.md:144-162`

### Integration Tests:

None new. No `e2e/` spec is added: `context/foundation/test-plan.md` §7's decision against a visual
phase stands, and the properties worth asserting here are pure functions or source properties.

### Manual Testing Steps:

1. `bun run dev`; open `/quiz/host/unaited` at 1920×1080 and confirm the 90s palette
2. Open `/quiz/host/summer-tour-szczecin` and confirm it is unchanged
3. Run a session on `unaited` to the close; confirm the projector goes yellow with black type and
   the winner is legible
4. On the themed quiz, confirm at a reveal that the correct band is the usual mint and the rail's
   register colours are unchanged
5. Join from a phone at `/quiz/unaited`; confirm the palette and that the join controls are reachable
6. Repeat step 3 on an unthemed quiz to confirm the closing beat is identical
7. Read the projector from the back of the room — the step no test replaces

## Performance Considerations

The `<style>` block is a few hundred bytes of custom properties, server-rendered, present only on a
themed quiz — no effect on FR-002's 30-second join budget. Phase 4's `woff2` is the only real
weight and must be scoped to the quiz pages so it never reaches the marketing site.

## Migration Notes

No stored data changes; no `livequiz:` key gains a dimension; `quizSchema` is untouched, so a
session started before this change is unaffected. Rollback is deleting the theme registry entry —
the pages then emit no `<style>` block and render exactly as today.

**Do not rename `unaited`'s `id`** to accommodate a theme: the runbook forbids it while a session
exists (`docs/runbook-live-session.md:167`), and the theme registry is keyed by that slug — the
stale-slug guard would catch the mismatch, but only at test time.

## References

- Frame brief: `context/changes/quiz-color-scheme/frame.md`
- Research: `context/changes/quiz-color-scheme/research.md`
- The prohibition overturned: `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221-222`
- Token source: `src/styles/global.css:46-67`
- Second-lookup pattern: `src/pages/quiz/host/[slug].astro:92`
- Filesystem-test pattern: `src/quiz/definition.test.ts:245-270`
- Second-carrier precedent: `src/lib/client/render.ts:758`
- Contrast defect this retires: `.../signage-redesign/reviews/impl-review.md:217-218`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: The token split, the theme module, and UnAIted's palette

#### Automated

- [x] 1.1 Tests pass: `bun run test` — b6e324d
- [x] 1.2 Type checking passes: `bun run type-check` — b6e324d
- [x] 1.3 Linting passes: `bun run lint` — b6e324d
- [x] 1.4 Formatting clean on the two pinned pages — b6e324d
- [x] 1.5 Frozen-token guard fails when a theme names a frozen token — b6e324d
- [x] 1.6 Contrast guard fails when a theme value drops below the floor — b6e324d
- [x] 1.7 Stale-slug guard fails when the registry names a non-existent quiz — b6e324d

#### Manual

- [x] 1.8 Themed quiz renders 90s; other two unchanged — b6e324d
- [x] 1.9 Closing screen yellow with black type on all three quizzes, winner legible — b6e324d
- [x] 1.10 Rail register, lamp, correct band and reveal unchanged on the themed quiz — b6e324d
- [x] 1.11 Projector read from the back of the room — b6e324d

### Phase 2: The logo

#### Automated

- [x] 2.1 Tests pass, including the logo path guard — 8a32e56
- [x] 2.2 Path guard fails on a misspelled path — 8a32e56
- [x] 2.3 Type checking, linting, prettier clean — 8a32e56

#### Manual

- [x] 2.4 Logo in the projector lobby, gone once a question opens — 8a32e56
- [x] 2.5 Join QR and short address unmoved in the lobby — 8a32e56
- [x] 2.6 Logo on the attendee join screen, nothing pushed below the fold — 8a32e56
- [x] 2.7 No layout shift when the first question opens — 8a32e56

### Phase 3: A second carrier for the two colour-only messages

#### Automated

- [x] 3.1 Tests pass: `bun run test` — e5cf20f
- [x] 3.2 Each carrier's test fails when that carrier is removed — e5cf20f
- [x] 3.3 Type checking, linting, prettier clean — e5cf20f

#### Manual

- [x] 3.4 Correct option identifiable in greyscale on projector and phone — e5cf20f
- [x] 3.5 "Mine" vs "correct" distinguishable without hue on the phone — e5cf20f
- [x] 3.6 Nothing shifted on the reveal beat — e5cf20f

### Phase 4: Typography — a display face on non-measured text only

#### Automated

- [x] 4.1 Tests pass, including the scope guard — 0804dc7
- [x] 4.2 Scope guard fails when the display class reaches the prompt — 0804dc7
- [x] 4.3 Type checking, linting, prettier clean — 0804dc7

#### Manual

- [x] 4.4 Display face only where intended; prompt and counter unchanged — 0804dc7
- [x] 4.5 No layout shift on first paint on the projector — 0804dc7
- [x] 4.6 No new font request on the marketing site — 0804dc7
