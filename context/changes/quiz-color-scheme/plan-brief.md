# Per-quiz colour scheme, logo and typography — Plan Brief

> Full plan: `context/changes/quiz-color-scheme/plan.md`
> Frame brief: `context/changes/quiz-color-scheme/frame.md`
> Research: `context/changes/quiz-color-scheme/research.md`

## What & Why

The quiz palette currently mixes a *decorative* layer with a *signalling* layer under one set of
token names, so no evening can be given its own look without also changing what the room is told —
and the two places that would break first (the closing inversion and the confetti) sit outside the
reach of the obvious mechanism, on surfaces no test in this repo can see.

So: split the 20 `--color-quiz-*` tokens into **9 themeable** and **11 frozen**, then give BRAVE
UnAIted a 1990s palette on the surfaces where a quiz is actually in scope.

## Starting Point

The colour indirection already exists — 20 tokens in one `@theme` block
(`src/styles/global.css:46-67`), used ~246 times across five files, with **zero colour literals in
`src/lib/client/*.ts`**. What does not exist is any separation between tokens that decorate and
tokens that mean something: `mint` is "correct", `signal` is "refused", `pill-border` is "in
flight", and `chrome` is the closing signal *because* it is rationed. The host is instructed in
writing to read colour before words (`docs/runbook-live-session.md:402-414`), and nothing in the
repo — no CI, no contrast check, no e2e touching this quiz — can catch a mistake before a room sees
it.

## Desired End State

`/quiz/unaited` and `/quiz/host/unaited` render in a 90s palette; the other two quizzes are
identical to today. Every message the host or the room reads — correct/refused, the four-way rail
register, the connection lamp, the closing inversion — is the same colour in every quiz, by
construction rather than by care. A theme whose text would fall below 4.5:1 against its own ground
fails `bun run test`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unit of ownership | The quiz slug, as a deliberate proxy for the evening | No event record links to a quiz today, so the slug is the only handle available at render time | Frame |
| Themed surfaces | Projector, host panel, attendee phone | `/quiz` and `/q/<code>` never have a quiz in scope on any render that emits HTML | Frame |
| Theme scope | 9 themeable tokens; semantics untouchable | Ground/surface/type carry no message; the other 11 carry a fact or bind to one | Plan |
| Closing inversion | Stays global — the theme never reaches it | Keeps the runbook true and makes the `html:has` selector a non-issue rather than a workaround | Plan |
| `theme` in `quizSchema` | No — keyed off the slug instead | Buys generality nothing asks for, and it is the half that is expensive and hard to undo | Frame |
| Delivery | A `<style is:global>` block on `:root`, present only when a theme exists | Each `[slug]` page renders one quiz, so no `data-*` attribute and no specificity contest — sidesteps the recorded ordering hazard | Plan |
| Verification | A `vitest` contrast floor + a runbook step | Catches the failure that reaches the room, without reversing test-plan §7's decision against visual tests | Plan |
| Colour-only messages | Add a second carrier, but in its own phase | Frozen tokens mean the skin does not depend on it, so the a11y work carries no schedule risk | Plan |
| Logo placement | Projector lobby + attendee join screen | The only place the left slot is genuinely free, and where the room is already looking for how to join | Plan |
| Archivo token defect | Out of scope, recorded | Fixing it re-metrics every measured surface at once, including character-count step-downs tuned for Archivo | Frame |

## Scope

**In scope:** the token split and its guards; a pure theme module; the 90s palette for UnAIted; the
first enforced contrast floor; a lobby logo on the projector and one on the attendee join screen; a
second carrier for the two colour-only messages; a display face on non-measured text; amendments to
`global.css`, `src/pages/quiz/CLAUDE.md` and the runbook.

**Out of scope:** the Archivo namespace defect (its own change); `/quiz`, `/q/<code>` and
`QuizNotice`; the picker; a `theme` field in `quizSchema`; the confetti hexes; the QR colours; any
visual-regression baseline; reordering the registry; bulk-renaming `quiz-*` strings.

## Architecture / Approach

`src/lib/theme.ts` is the single source of truth for both the CSS and the tests: it declares the
themeable token names as a typed const (so a frozen token is a compile error), holds each theme's
values, and maps slug → theme. The two `[slug]` pages resolve it in frontmatter — the same
second-lookup pattern `host/[slug].astro:92` already uses for `code` — and render a
`<style is:global>` block re-declaring those custom properties on `:root`, emitted only when a
theme exists. Nothing crosses into a client script, so `boundary.test.ts` is untouched and
`render.ts` stays colour-agnostic.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Token split + module + contrast floor + UnAIted palette | The visible 90s look, with semantics provably untouched | Editing two `.prettierignore`-pinned pages whose tests scan text literally |
| 2. Logo | The evening's mark in the projector lobby and on the join screen | Geometry on a fixed 1920×1080 artboard with no slack |
| 3. Second carrier | "Correct" and "mine" readable without hue | Touches `render.ts` and both pages' text-scanning tests |
| 4. Display face | Period typography on non-measured text only | A face on measured text would invalidate character-count step-downs |

**Prerequisites:** none for Phase 1. Phase 4 reads better once the Archivo defect is fixed in its
own change, but does not depend on it.
**Estimated effort:** ~1 session for Phase 1; ~1 session for Phases 2–4 together.

## Open Risks & Assumptions

- **The closing screen is not fully insulated.** Its foreground is
  `data-[phase=ended]:text-quiz-ink` and `ink` *is* themeable, so unthemed `chrome` × themed `ink`
  is a real pair — covered by the contrast test, and the reason that pair is named explicitly.
- **No automated check sees layout.** The contrast floor catches illegibility, not clipping or a
  wrapped control bar; the projector still has to be looked at.
- **The palette's legibility has never been validated in the venue** — recorded as unclosed in the
  signage redesign's own verification. A second palette multiplies unvalidated combinations.
- **BRAVE UnAIted is imminent** (`src/content/events/meetup-5.md:258`, "pod koniec sierpnia"),
  against a pipeline with no CI where a failed deploy is silent. Phase 1 is deliberately the
  lowest-risk phase for that reason.
- **`grep` here silently skips `src/lib/client/render.ts`** (a `ugrep -I` misdetection on a valid
  UTF-8 file — not a defect, do not "fix" it). Use `grep -a`, `awk` or `sed` when checking that
  module, including for the docs-grep step `lessons.md` requires.

## Success Criteria (Summary)

- UnAIted looks like 1990 on the projector and the phone; the other two quizzes look exactly as
  they did.
- A host running any quiz sees the same colours mean the same things, and the closing screen still
  turns yellow.
- A palette that would put text below 4.5:1 against its own ground cannot be committed.
