# Frame Brief: per-quiz colour scheme, logo and typography

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

> swietnie by bylo dla danego quizu narzucic specyficzna wersje kolorystyczna oraz logo
> (moze sie wyswietlic po lewej u gory) np. nasz quiz unAited chcialbym zrobic w klimacie lat 90

## Initial Framing (preserved)

- **User's stated cause or approach**: a look is a property of a quiz — the quiz imposes its
  own colours and logo.
- **User's proposed direction**: a per-quiz mechanism for colours + logo (+ typography, added
  when research scope was set).
- **Pre-dispatch narrowing**: only unAIted gets its own look for now, the rest stay as they are
  (N=1); the 90s feel is carried by "**everything together, inseparably**" — colour *and* type
  *and* logo, no single element would do it; and it should be visible "**everywhere, including
  the picker and the entry page**".

## Dimension Map

1. **Unit of ownership** — does the look belong to the quiz, the event/evening, or the session?
   ← initial framing lands here (the quiz)
2. **Generality** — a mechanism for N quizzes, or one evening's skin at N=1?
3. **Collision with the room's signalling** — is the palette decoration, or is it what the host
   and the room are instructed to read?
4. **Typography rests on a defect** — the Archivo token is inert and the whole type scale was
   measured for Archivo.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **D1** A quiz-owned theme cannot cover the surfaces asked for | Of five surfaces, **two never have a quiz in scope on any render that emits HTML** — `/quiz` (`index.astro:33-39`) and `/q/<code>` (`q/[code].astro:28-33`) resolve the code then *redirect*; the rendered branch is always `quiz === undefined`. One has **all three at once**: the picker, one `<body>` for N quizzes (`host/index.astro:4,58`). Renderable on the two `[slug]` routes only — and not on their 404 branches, which is what a mistyped slug or a stale printed QR reaches. | **STRONG** |
| **D1b** The look belongs to the evening, not the question set | The 90s brief lives in the quiz's own docstring (`unaited.ts:3-18`, "*hackathon-and-school-disco day… the party is a szkolna dyskoteka and the join code is a year*"). But there is **no event record for UnAIted** — the events collection has no quiz field (`src/content.config.ts:6-43`) and no UnAIted entry; the only trace is prose in another event's body (`src/content/events/meetup-5.md:258`, describing it as upcoming "*pod koniec sierpnia*"). So "theme belongs to the event" is **not expressible in current data**. | **STRONG** |
| **D2** N=1 argues against building a mechanism | **Contradicted.** This repo ships mechanisms at N=1: the multi-quiz registry landed with one quiz committed (`dff8dde`, "*Behaviour is unchanged with one quiz committed*"), on request, overturning a written PRD non-goal; the second quiz arrived a day later **as a fix so the mechanism's tests were live** (impl-review F10, `jesienny-meetup-ai.ts:3`). The retention guardrail shipped before the data it protects existed. The repo's actual test is **"name the need, or don't add the axis"** (`summer-tour-szczecin.ts:20-23`: per-question weighting refused as "*a decision without a reason*"). | **NONE** (as stated) |
| **D3** The palette is signalling, not decoration | **11 of 20 tokens are free** (ground, surface, hairline, copy). 7 are re-huable only if the *distinctions* survive. Two are overloaded: **`chrome`** is next-action accent + attention/degraded/staleness register + the closing ground *by being rationed*; **`pill-border`** is idle outline *and* the `pending` register. Two messages are **colour-only today**: which choice option was correct (`[slug].astro:832-833`, `host:1736-1740`) and my-locked-pick vs the-correct-answer on the phone (`[slug].astro:828-833`). The runbook instructs colour-first reading in ~13 places incl. a four-row lookup table (`docs/runbook-live-session.md:402-414`). | **STRONG** |
| **D4** Typography is blocked behind a defect | `--font-family-archivo` (`global.css:39`) is in the wrong Tailwind 4 namespace (`--font-*`). Verified against the built CSS: **no `.font-archivo` rule exists** and `font-family: "Archivo"` appears twice — only inside the two `@font-face` blocks. Site and quiz render in platform `ui-sans-serif`. Meanwhile the host page's sizes are fixed px measured *for Archivo*, incl. **character-count** step-downs (`host:1660-1671`, thresholds 52/58; prose measurements at `host:645`, `:1651`). | **STRONG** |

## Narrowing Signals

Decisive answers from the user, each of which moved the hypothesis space:

- **The closing screen is a signal, not a look** — it may change hue but must stay recognisable
  and identical in function across quizzes; the host does not relearn it per event. This makes
  `plan.md:65-68`'s chrome-rationing a constraint on any theme rather than a casualty of it.
- **`/quiz` and `/q/<code>` stay default** — the user withdrew "everywhere" once the two
  zero-quiz surfaces were named. This removes D1's worst breakage outright: no session read has
  to be re-added, and `/quiz`'s deliberate "**No session read**" decision (`index.astro:28-30`,
  removed for correctness, not cosmetics) stands.
- **The vibe belongs to the evening; the quiz inherits it** — which, combined with D1b's finding
  that no event record exists, means the quiz slug is a **deliberate proxy** for the occasion,
  not its owner. Worth writing down as a proxy so a later event/quiz split does not read as drift.

Findings from an independent pressure-test agent that was **not told the hypothesis** and
converged on the same core, plus four mechanisms nobody had named:

- **A body-scoped override does not reach the closing screen.** `host/[slug].astro:288` is
  `html:has(body[data-phase="ended"]) { background-color: var(--color-quiz-chrome) }` — it
  resolves on `<html>`, *outside* a `body`-scoped theme, while `:344-345` sets the same
  inversion on the body *inside* it. A naive scoped override splits the finale: letterbox in the
  old yellow, artboard in the new colour.
- **No e2e spec ever opens the themed quiz.** `e2e/support/host-session.ts:34,59` pin
  `summer-tour-szczecin` and `jesienny-meetup-ai`; no file under `e2e/` mentions `unaited`.
- **A bulk rename over `quiz-*` would break the host's session.** `host:1300`
  `const SECRET_STORAGE_KEY = "quiz-host-secret"` is a bare inline literal outside `keys.ts`;
  rewriting it typechecks, passes tests, and makes the host retype the secret in front of the room.
- **`unaited` is `quizzes[0]`**, read by `fixtureQuiz()`, `/quiz/spine-check` and the room-scale
  rehearsal (`definitions/index.ts:20-31`, `test-support.ts:112`). Reordering the registry — a
  natural instinct — silently moves the pre-event rehearsal onto an *unthemed* quiz.

## Cross-System Convention

This repo's convention for presentation is **one global signage system, scoped by prefix**, and
the prohibition is explicit: "*Do **not** introduce a second `@theme` block, a `:root` override on
the quiz pages, or a `data-theme` attribute*"
(`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221-222`). A per-quiz palette is
one of those three by construction, so it must be overturned deliberately and in writing.

Its convention for *meaning*, however, cuts the other way and supports the reframe: where a
colour carries a fact, this codebase already adds a second carrier — `▲`/`▼` for rank movement
(`render.ts:758-759`, "*the shape says the same thing the colour does*"), `role="status"` /
`role="alert"` sentences beside every coloured dot, fill-vs-outline for single-vs-multiple choice
(`host:1698-1712`), and three carriers on the closing beat (inversion `:344-345`, heading
`Ranking`→`Zwycięzca` `:2674`, sentence `Sesja zakończona…` `:1096`). **Redundant coding is
already the house style**; the theme should extend it, not fight it.

## Reframed Problem Statement

> **The actual problem to plan around is**: the quiz palette currently mixes a *decorative*
> layer with a *signalling* layer under one set of token names, so no evening can be given its
> own look without also changing what the room is told — and the two places that would break
> first (the closing inversion and the confetti) are outside the reach of the obvious mechanism,
> on surfaces no test in this repo can see.

The request itself is sound and the unit is workable: for the surfaces that matter after the
user's narrowing — projector, host panel, attendee phone — the quiz slug is available at render
time and is an acceptable proxy for the occasion. What was underestimated is that "impose a
palette" is not a restyle. It requires **naming the roles the 20 tokens play** (ground, surface,
copy, accent-rationed, affirm, refuse, pending, mine, not-the-answer) and stating which are
themeable, before any hex is chosen. Addressed that way, a 90s look is deliverable without
touching a signal, the closing beat keeps working because it already has three carriers, and the
runbook's colour words become role words in the same change. Not addressed that way, the failure
mode is a host on stage reading a colour table that is false for one quiz in three.

Two scope corrections follow, and both shrink the work:

- **The entry surfaces are out** (user's own narrowing), so no session read and no zero-quiz
  theming problem.
- **The `theme` field in `quizSchema` is the only part of this that N justifies, and N does not
  justify it yet.** It is also the expensive half: a Polish `superRefine` clause, exposure to
  `public.test.ts:112-118`'s join-code substring scan (unAIted's code is `1990`, so a hex like
  `#1990ab`, a `theme-1990s` class or a `unaited-1990.svg` path fails with a message about
  *leaking join codes* and sends the reader down the wrong path), a widened allowlist plus two
  deliberately-tripped assertions (`public.test.ts:102-111`), and an amendment to
  `src/quiz/CLAUDE.md:177-181`. Everything else — the role split, the closing contract, the
  runbook — is paid identically at N=1 and N=12.

## Confidence

**HIGH.** Three of four dimensions returned strong, file-verified evidence; the fourth returned
evidence against a hypothesis I had put on the map myself, which is recorded rather than quietly
dropped. An independent agent, not told the hypothesis, converged on the same core and added four
mechanisms that sharpen it rather than contradict it. Three decisive user answers narrowed scope
in the same direction. Every load-bearing claim here was re-verified directly.

One caveat, and it is about tooling rather than the reframe: **`grep` in this environment is a
shell function wrapping `ugrep -I`, and it silently skips `src/lib/client/render.ts`**, which
`ugrep` misdetects as binary (the file is valid UTF-8, no NUL bytes, max line 100 — **this is a
tool quirk, not a defect; do not "fix" the file**). Plain `grep` therefore returns **false
negatives** on the one shared module every class-name contract passes through. It is the only such
file in `src/`, `docs/` and `context/`. Use `grep -a`, `awk` or `sed` when verifying anything
there — this matters directly for `lessons.md:164-181`, which instructs grepping the docs for
claims a change will falsify.

## What Changes for /10x-plan

Plan **a token-role split and a signalling contract first**, then unAIted's skin on top of it —
not a theming feature with a palette attached. Scope: projector, host panel and attendee phone
only; entry pages and `/q/<code>` stay default by decision. Keep `theme` out of `quizSchema` and
key the override off the slug the page already has (the sanctioned second-lookup pattern,
`host:92`) until a second quiz wants a second look. The plan must explicitly cover the closing
inversion's `html:has` selector, `celebrate.ts:124`'s hardcoded confetti hexes, the two
colour-only messages, and the runbook's colour table; and it must state how anyone will *see* the
result, since no automated check in this repo can. Treat the Archivo token defect as its own
change, landed and eyeballed first — fixing it re-metrics every measured surface at once, and the
host page's step-downs are keyed to character counts tuned for Archivo.

Timing note for scoping: `meetup-5.md:258` describes BRAVE UnAIted as upcoming "*pod koniec
sierpnia*", i.e. days away as this is written, against a deploy pipeline with no CI where **a
failed deploy is silent** (root `CLAUDE.md`).

## References

- Research: `context/changes/quiz-color-scheme/research.md`
- Prohibition being overturned: `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221-222`
- Token source: `src/styles/global.css:46-67` (20 tokens, verified)
- Closing beat: `src/pages/quiz/host/[slug].astro:288`, `:344-345`, `:2674`, `:1096`
- Colour-only messages: `src/pages/quiz/[slug].astro:828-833`, `src/pages/quiz/host/[slug].astro:1736-1740`
- Host colour instructions: `docs/runbook-live-session.md:402-414`, `:549`
- Zero-quiz surfaces: `src/pages/quiz/index.astro:28-39`, `src/pages/q/[code].astro:28-33`
- Registry position: `src/quiz/definitions/index.ts:20-31`
- e2e blind spot: `e2e/support/host-session.ts:34,59`
- Rename hazard: `src/pages/quiz/host/[slug].astro:1300`
- Investigation threads: ownership unit; semantic-vs-decorative split; generality; independent
  no-preconception pressure test
