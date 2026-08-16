---
date: 2026-08-16T19:09:18+02:00
researcher: Jedrzej Meder
git_commit: fbdc9142109b84b85748638629fded04af2f1bc9
branch: main
repository: ai-community-szn
topic: "Quiz animations and transitions — the complete surface a motion layer would touch"
tags: [research, codebase, livequiz, motion, render, host-view, attendee-view, tailwind, happy-dom]
status: complete
last_updated: 2026-08-16
last_updated_by: Jedrzej Meder
---

# Research: Quiz animations and transitions

**Date**: 2026-08-16T19:09:18+02:00
**Researcher**: Jedrzej Meder
**Git Commit**: `fbdc9142109b84b85748638629fded04af2f1bc9`
**Branch**: `main`
**Repository**: ai-community-szn

## Research Question

Given the premise established in [`frame.md`](./frame.md) — *the quiz has motion but no motion
system* — what is the **complete surface** a motion layer would touch? This is an inventory, not a
design: every beat, every paint site, every guard that constrains the work, and every prior decision
it must reconcile with.

## Summary

Five findings decide the shape of any plan that follows.

1. **The mechanism is already chosen for us by the test environment.** happy-dom 20.11.2 implements
   no Web Animations API, no CSS transition engine, and never dispatches `transitionend` — there is
   no `TransitionEvent` class in its exports at all. A motion layer built on `Element.animate` or on
   `transitionend` callbacks is **untestable in this repo**, and would fall back to the source-text
   scan that `countdown.ts:5-13` records as having *"certified the defect instead"*. The one proven,
   testable path is rAF-driven inline-style writes with `requestAnimationFrame` hand-stubbed —
   exactly what `render.ts` does and `render.test.ts:563-570` tests.

2. **`hidden` is the structural blocker, and it is ~30 call sites wide.** Every beat swap on both
   views runs through `setHidden` (`render.ts:47-49`), which sets the `hidden` property; Tailwind
   preflight ships `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`
   (`preflight.css:391-392`). Nothing toggled this way can be transitioned **out** — it leaves layout
   on the frame. Entrance motion is available today; exit motion needs a different primitive.

3. **`syncRail` reads the live `hidden` DOM property**, not state (`host.astro:2127-2135`). The
   obvious motion pattern — *"fade out, set `hidden` on completion"* — silently breaks it: the rail
   reads the pre-transition value and stands empty. That is the exact defect
   `2026-08-15-rail-empty-at-reveal` was opened to fix.

4. **The structural guards count call *shapes*, and several would fail on a naive wrapper.**
   `host.test.ts` pins `occurrences("setHidden(railBox") === 1`, `setHidden(endRow") === 1`,
   `setHidden(messageBubble") === 3`, and `CODE.match(/\blet\s+\w*[Tt]imer\b/)` at exactly 1 — so
   `let fadeTimer` in `host.astro` fails the suite. `index.test.ts:102` requires **zero**
   `setTimeout` in the attendee page. Neither forbids `requestAnimationFrame`; painting timers are
   explicitly permitted (`host.test.ts:142-161`). The guards point at a module, which is where
   `countdown.ts` and `toast.ts` already live.

5. **The prior objections are narrower than they look, and one is a genuine reversal.** Animation was
   *deferred* twice without argument (leaderboard, winner reveal). The one argued rejection —
   `winner-reveal/plan.md:72-74` — is against **client-side timing that carries state** ("150 phones
   on their own clocks against the projector"), not against decoration; the count-up already coexists
   with it. But `index.astro:233-236` **is** a reasoned rejection of phone motion, and the
   "phone feels dead too" position reverses it deliberately rather than by oversight.

## Detailed Findings

### 1. The existing motion, and the three rules it already proved

`renderDistribution`'s count-up (`src/lib/client/render.ts:420-555`) is the only JS-driven motion in
the project and the only reduced-motion check anywhere. It has exactly **one** call site:
`host.astro:1653` (`animate: true`).

| Rule | Mechanism | Lines |
| --- | --- | --- |
| A re-render cancels the in-flight loop | `countUpFrames` WeakMap read + `cancelAnimationFrame` **before any early return**, so a chart that disappears takes its animation with it | `render.ts:357`, `:429-433` |
| An unchanged chart does not re-animate | `countUpSignatures` WeakMap keyed `` `${question.id}|${answered}|${counts.join(",")}` ``; deleted on the two nothing-drawn paths so a cleared container re-animates on return | `render.ts:368`, `:513-520`, `:446`, `:459` |
| Reduced motion / no rAF gets finals immediately | `animate = options.animate === true && changed && typeof requestAnimationFrame === "function" && !prefersReducedMotion()`; `paintBars(targets, animate ? 0 : 1)` runs **before** `container.append(list)` so there is no flash of finals | `render.ts:522-533` |

Two further mechanics worth carrying: **the rAF timestamp is the clock** (`render.ts:535-540`,
"nothing here reads `Date.now`"), and **the final frame is written by the loop, not by the clock
landing on 1** (`render.ts:542-548`, "a dropped frame must not leave a bar short").

`prefersReducedMotion` (`render.ts:370-375`) is **private** — no `export`, one caller. Nothing else
in the repo consults the media query, including the marketing-site nav drawer
(`Navbar.astro:57-113`), which animates unconditionally.

**Gap inherited:** the count-up's *cancellation* is never actually asserted. `cancelAnimationFrame`
is a no-op stub (`render.test.ts:570`) and no test covers "two overlapping renders leave one loop".
The nearest test (`:667-681`) drives a `distribution: null` render in between and asserts the second
re-animates.

Other motion that exists, all CSS, none of it scripted:

- Countdown bar fill — `transition-[width] duration-1000 ease-linear` (`host.astro:721`,
  `index.astro:258-259`), driven by an inline `style.width` write at `render.ts:931`, roughly once a
  second from a `setTimeout` aligned to the next whole second (`countdown.ts:75-78`).
- QR hover hint — `opacity-0 transition-opacity` (`host.astro:989-990`), pinned CSS-only by
  `host.test.ts:1428-1433`.
- Toast — timed hide, **no fade**; `hidden`-toggled (`toast.ts`, `host.astro:2521-2554`).

**Zero** `transform`, `translate`, `scale`, `will-change`, `@keyframes`, `animate-*`,
`motion-safe:`, `motion-reduce:`, `Element.animate`, or `transitionend` anywhere in `src/`.

### 2. The attendee view — 16 beats, all through one `render()`

`src/pages/quiz/index.astro`. Three mutually exclusive top-level sections: `#boot` (`:73`), `#join`
(`:86`), `#follow` (`:153`). Everything from lobby onward lives in `#follow`, whose `data-waiting`
attribute (`:156-157`) switches the column between `justify-between` and top-stacked — written only
by `showQuestion()` (`:580-583`).

Beats: boot → join form → joining → join refused → entering → lobby → connection lost → degraded →
question open (×4 kinds: choice `:1306`, text `:1384`, number `:1450`, word-cloud `:1512`) → time-up
`:1366` → submitting `:1969` → reveal `:1672` (with five result sub-beats) → standings `:988` →
ended `:869` → session gone `:913` → tab hidden `:2291`.

**Render cadence — nine call sites, no diffing, no early-out.** `render()` is defined at
`index.astro:771` and called from: `onSnapshot` (`:754` — every host action *and* every fallback poll
tick), `onConnection` (`:758` — every Wi-Fi flap), `countdown.onExpire` (`:1192`), option tap
(`:1328`), result fetch resolved (`:1791`), submit outcomes (`:2048`, `:2071`, `:2089`),
`enterSession` (`:2141`), tab re-focus (`:2293`). Each run unconditionally calls `stopCountdown()`
(`:781`) and wipes `#question`.

**Wiped (`replaceChildren`) — element identity does not survive:** `#question` (via `renderQuestion`,
7 call sites) and `#standings-board` (via `renderStandings`, `:1009`). Everything else is patched via
`textContent`, whole-string `className =`, `style`, `dataset`, `.disabled`, `.value`.

**The precedent is already written down.** `index.astro:218-224`, on the countdown:

> A STATIC element shown and hidden, for the same reason the inputs below are: `renderQuestion` calls
> `replaceChildren()` on the question container, so anything emitted there is destroyed and rebuilt
> on every snapshot — **and this one is animating.**

The same reasoning appears three more times for the three input fields (`:271-276`, `:294-296`,
`:322-325`) — an input inside `#question` would be destroyed mid-keystroke, and *another attendee
joining is enough to trigger it*. **Corollary for the plan: anything that animates must live outside
`#question`.**

**The prior rejection of phone motion** — `index.astro:233-236`, on the urgency cue:

> Nothing else changes: no size, no motion, no sound. It is a colour, because an attendee is reading
> a phone in a dark room and a moving clock is already saying the rest.

**Existing attribute-driven state vocabulary** a motion layer would extend rather than invent:
`data-[waiting=true]:` (`:157`), `[[data-urgent=true]_&]:` (`:248`, `:259`), `aria-pressed:`
(`:723-724`), `data-[selected=true]` / `data-[correct=true]` (`:735-740`), `data-[own=true]`
(`:1027`), `[&>li:first-child]` winner emphasis (`:1018-1020`).

⚠️ **Three elements take whole-string `className` assignment** — `#follow-status` (`:563`),
`#result-award` (`:1819`), `#result-verdict` (`:1855`). Any motion class added to these from
elsewhere is wiped on the next write.

⚠️ **Option letters come from a CSS counter** (`[counter-reset:option]` `:712`,
`[counter-increment:option]` `:717`) — so a staggered or reordered entrance **re-letters the
options**.

### 3. The host view — the shell, and what absorbs a size change

`src/pages/quiz/host.astro`. `<body>` is `flex h-dvh flex-col overflow-hidden` (`:174-178`) —
`host.astro:158-160`: *"A projector has no scrollbar… content that overflows must be visibly wrong
here rather than quietly parked below the fold."*

`#body-split` (`:491`) splits `#stage` (`:499-503`, `flex min-w-0 flex-1 flex-col justify-between
overflow-hidden`) from `#rail` (`:610-614`, `hidden` in markup, `w-[440px] shrink-0`). **`#stage` is
the only `flex-1`**, so the rail's disappearance and `#end-row`'s appearance both resolve into stage
geometry instantly.

`applyShell(phase)` (`:2086-2098`) writes five hides:

| phase | `#lobby` | `#body-split` | `#top-strip` | `#control-row` | `#ended-note` |
| --- | --- | --- | --- | --- | --- |
| `lobby` | shown | hidden | shown | shown | hidden |
| `question-open` / `question-revealed` / `standings` | hidden | shown | shown | shown | hidden |
| `ended` | hidden | shown | **hidden** | **hidden** | **shown** |
| `NO_SESSION` | hidden | shown | shown | shown | hidden |

**~15 `hidden` writes fire per snapshot** on the ordinary path: `stopCountdown` → 4 hides in
`renderParticipation` (`:1616-1619`) → 3 in `renderWordCloudPanel` (`:1703-1705`) → 4 in `render`
itself (`:2234`, `:2275`, `:2301`, `:2422`) → `syncRail` (`:2134`) → `syncControls` →
`syncEndButton` (`:2042`, `:2048`).

Panel paint modes: **wiped** — `#distribution` (`render.ts:425`), `#word-cloud-words` (`:776`),
`#standings-board` (`:620`), `#question` (`:186`). **Patched** — participation counters, word-cloud
counters, accepted answer, question counter, countdown (`setText` / inline width).

**`syncRail` is the hazard** (`:2127-2135`):

```ts
const nothingToShow = Boolean(
  participationBox.hidden && wordCloudBox.hidden && hostCountdownBox.hidden,
);
setHidden(railBox, nothingToShow);
```

It reads the live DOM property, takes no `state` parameter on purpose (`:2118-2119`: *"a parameter is
the door a phase condition walks back in through"*), and must run **after** the three panel
renderers. Three pinned call sites: `:2203`, `:2429`, `:2627` (inside `stopCountdown`, because
`visibilitychange`/`pagehide` clear the clock without passing through `render`).

`FLOW_PILL` (`:111-116`) carries the geometry rule twice (`:108-109`, `:1948-1950`):
**`data-[next=true]` sets border, background, weight and colour — and no geometry**, or the row
reflows mid-session. Its `clamp()`s are the only ones in the codebase; `2.08vw` is exactly 40px at
1920.

Note `CONTROL_RULES` **no longer lives in this file** — it moved to `src/lib/client/controls.ts` and
is private there; the page imports `verbsFor` (`:1016-1023`), and `host.test.ts:622` asserts
`expect(CODE).not.toContain("CONTROL_RULES")`.

### 4. The guards — what a motion layer may and may not do

**`index.test.ts` (attendee page, pure source scan):**

- `occurrences("setTimeout") === 0`, `clearTimeout === 0`, no `let *[Tt]imer*`, no `setInterval`
  (`:102-108`). Heading (`:87-97`): *"**THE PAGE OWNS NO TIMER.** … a scan cannot execute a timer."*
- `occurrences("startCountdown(") === 2` (`:153-160`); `stopCountdown();` must precede
  `connection === "lost"` inside `render` (`:139-151`); `stopCountdown` must appear in both lifecycle
  exits and be the first thing after `pagehide` (`:125-137`).
- ⚠️ Two assertions pin **indentation**: `/createCountdown\(\{[\s\S]*?\n {6}\}\);/` (`:203-216`) and
  `/function startCountdown\([\s\S]*?\n {6}}/` (`:218-224`).

**`host.test.ts`:**

- Exactly one timer whose callback can fetch (`:149-161`) — a second *painting* timer is explicitly
  permitted, which is the doorway a motion module walks through.
- `CODE.match(/\blet\s+\w*[Tt]imer\b/g)` length 1, `let polling` 1, `let *[Dd]elay*` 1 (`:174-180`);
  `occurrences("clearTimeout") === 1` (`:185-194`). **`let fadeTimer` or `let motionDelay` in this
  file fails.**
- `occurrences("setHidden(railBox") === 1` (`:816`), `syncRail();` exactly 3 (`:820-836`),
  `setHidden(endRow` 1 (`:1118`), `setHidden(endNote` 1 (`:1334`), `setHidden(messageBubble` 3 with 2
  inside `say` (`:1222-1223`); negatives on `setHidden(endButton` (`:1099`) and
  `setHidden(el("connection")` (`:1458`).
- `not.toContain("mouseenter")` / `not.toContain("mouseover")` (`:1431-1432`); no
  `messageBubble.className` (`:1240`).
- Comments are stripped before scanning (`:37-39`) — documentation in the page is free.

**`boundary.test.ts`** — forbids value imports from `src/quiz/` and `src/lib/session/` and any
`import.meta.env` read, in `src/lib/client/*.ts` **and in the `<script>` blocks of
`src/pages/quiz/*.astro`**; frontmatter is excluded (`:29-39`). Only `import type` is erased — a
mixed `import { type A, B }` still brings `B` across (`:120-122`). The detector is exported and
proven against fixtures (`:201-279`).

### 5. Module conventions — the shape a motion module must take

| | `countdown.ts` | `toast.ts` | `controls.ts` |
| --- | --- | --- | --- |
| Shape | factory → handle (`:59`) | factory → handle (`:55`) | pure named functions |
| DOM | **none** | **none** | none |
| Injected | `onPaint`, `onExpire?`, `now?` ("Injected so tests own the clock", `:40-41`) | `onHide`, `defaultMs` | — |
| Handle | `start`/`stop`/`isRunning` | `show`/`cancel`/`isRunning` | — |

Shared conventions: named exports only; elements received **by element, never by id** (only `el(id)`
in `render.ts:36-40`, called by the *pages*); private `let timer` cleared via a local `clear()`;
`window.setTimeout` not the bare global (this is what makes happy-dom the required test env);
**the arming call never invokes the terminal callback** (`countdown.ts:18-20`); degenerate input
fails toward the safe direction (`toast.ts:70` — a non-finite delay means *never hide*).
The pages own the lifecycle listeners (`host.astro:3091`, `:3100`; `index.astro:2291`, `:2295`).

The richer precedent is `createFallbackPoll` (`session.ts:386`), whose handle distinguishes four
teardown verbs — `arm` / `pause` / `stop` / `dispose` — plus `isArmed()` (`:342-369`).

**Why these modules exist at all** is the argument a motion layer inherits verbatim
(`countdown.ts:5-13`):

> **This module exists because the first version of this logic lived inline in two Astro pages, and
> both copies shipped a defect a green suite could not see.** An inline `<script>` has no harness, so
> the only available guard was a source-text scan — and a scan cannot execute a timer… *both guards
> written to prevent them certified them instead*.

### 6. Styling substrate — Tailwind 4.2.2, CSS-first, no motion tokens

`src/styles/global.css` is the only stylesheet; **no `tailwind.config.*` exists**. Twenty
LiveQuiz tokens in one `@theme` block: 8 signage core (`:46-53`) + 12 derived tints (`:56-67`).
**No spacing, radius, duration or easing tokens** — every size is an arbitrary-value utility.

⚠️ Token **declaration order is load-bearing** — `signage-redesign/reviews/impl-review.md:F10`:
*"reordering the `--color-quiz-*` block would silently flip the reveal's slabs back to chrome."*

Free from Tailwind 4.2.2 (`theme.css`): `--ease-in/out/in-out` (`:434-436`); `--animate-spin/ping/
pulse/bounce` (`:438-441`); `--default-transition-duration: 150ms` (`:492-493`); the full
`transition-*` / `duration-*` / `delay-*` / `ease-*` families; and the `motion-safe:` /
`motion-reduce:` variants — **built in, currently unused anywhere in this repo**.

A custom animation is declared CSS-first: `--animate-rise: rise 400ms var(--ease-out) both;` in the
existing `@theme` plus a sibling `@keyframes`. No config file needed or wanted.

**The blocker, exactly** — `node_modules/tailwindcss/preflight.css:391-392`:

```css
[hidden]:where(:not([hidden='until-found'])) { display: none !important; }
```

The `until-found` carve-out is the one escape hatch inside the selector itself.

### 7. Test environment — the decisive constraint

happy-dom **20.11.2** (`package.json:50`), vitest 4.1.10, six `.test.ts` files carrying
`// @vitest-environment happy-dom`, all in `src/lib/client/`. No `vitest.config.ts` by design.

| Capability | Supported? | Evidence |
| --- | --- | --- |
| `requestAnimationFrame` | Yes — **mocked over `setImmediate`** ("Mock animation frames with timeouts") | `BrowserWindow.js:2089`, `:2146`; returns `NodeJS.Immediate`, **not a number** |
| rAF timestamp | Real `performance.now()` — wall clock, so easing is nondeterministic under it | `BrowserWindow.js:2125`, `:2135` |
| `matchMedia` | Yes, genuinely parsed | `lib/match-media/` |
| `prefers-reduced-motion` | Yes; **default `no-preference`**, so the animated path is the test default | `MediaQueryItem.js:187`, `DefaultBrowserSettings.js:50` |
| `Element.animate` / WAAPI | **No** | no `Animation`, `KeyframeEffect`, `getAnimations` in `index.d.ts:242` |
| CSS transitions actually running | **No** | no layout/animation engine |
| `transitionend` | **Handler property only, never fired** — no `TransitionEvent` class exists | `HTMLElement.d.ts:130-131` |

⚠️ **`vi.useFakeTimers()` will not reliably drive happy-dom's rAF**: `BrowserWindow.js:277-285`
captures `TIMER = { setImmediate: globalThis.setImmediate.bind(globalThis), … }` at module-load time,
so a later fake-timer install does not reach it. Hand-driven rAF stubbing is the only reliable route
— which is why `render.test.ts` uses a `frames[]` queue and no fake timers, while
`countdown.test.ts` / `toast.test.ts` (which call `window.setTimeout`) do use them.

## Code References

- `src/lib/client/render.ts:47-49` — `setHidden`, the single shared visibility primitive (~90 call sites)
- `src/lib/client/render.ts:300-307` — the `animate` docblock; *"only the projector opts in"*
- `src/lib/client/render.ts:334-392` — `COUNT_UP_MS`, `easeOut`, `BarTarget`, `paintBars`
- `src/lib/client/render.ts:357`, `:368`, `:370-375` — the three safety rules' storage and the private reduced-motion gate
- `src/lib/client/render.ts:429-433`, `:513-533`, `:535-554` — cancel, signature, gate, rAF loop
- `src/lib/client/render.test.ts:537-690` — the count-up's test harness (`frames[]` queue, matchMedia stub)
- `src/lib/client/countdown.ts:5-13` — why inline view logic became a module
- `src/lib/client/session.ts:342-369` — the four-verb teardown handle
- `src/pages/quiz/index.astro:218-224` — *"and this one is animating"*: animated elements live outside `#question`
- `src/pages/quiz/index.astro:233-236` — the reasoned rejection of phone motion
- `src/pages/quiz/index.astro:771` — `render()`, nine call sites, no diffing
- `src/pages/quiz/index.test.ts:87-108` — THE PAGE OWNS NO TIMER
- `src/pages/quiz/host.astro:111-116`, `:108-109`, `:1948-1950` — `FLOW_PILL` and the no-geometry rule
- `src/pages/quiz/host.astro:154-160` — the shell's stated stillness principle and `overflow-hidden`
- `src/pages/quiz/host.astro:605-608` — why `#rail` ships `hidden` in markup
- `src/pages/quiz/host.astro:2086-2098` — `applyShell`
- `src/pages/quiz/host.astro:2127-2135` — `syncRail`, reading live `hidden`
- `src/pages/quiz/host.test.ts:142-194`, `:815-836`, `:1118`, `:1222-1223` — the counting guards
- `src/lib/client/boundary.test.ts:29-39`, `:57`, `:120-142` — scope, forbidden areas, `import type`
- `src/styles/global.css:46-67` — the twenty LiveQuiz tokens
- `node_modules/tailwindcss/preflight.css:391-392` — `[hidden] { display: none !important }`

## Architecture Insights

**The project already has a motion doctrine; it is just not written as one.** Four rules recur across
unrelated files, each stated locally and none generalized:

1. *The animation is the decoration, never the data* (`render.ts:300-307`) — the final figures are
   always true, and every device without the animation sees them immediately.
2. *Nothing moves that is not supposed to* (`host.astro:154-156`: "every phase now paints into a slot
   whose size the room has already learnt"; `rail-empty-at-reveal/reviews/impl-review.md:65`:
   "a column that appears and folds is the kind of motion the redesign spent effort removing").
3. *The host owns every transition* (`countdown.ts:36-37`) — nothing may move the session on a clock.
4. *Reserved emptiness is worse than a single grow* (`host.astro:814-828`) — "reserved emptiness is a
   thing the room looks at all session; the bar growing once, at the final beat, is a thing the room
   sees for a moment."

Rules 2 and 4 are about **incidental** motion — layout shift — and they cut *against* careless
animation while saying nothing about authored motion. Rule 3 is about session state, not pixels.
The vocabulary collision is real and worth naming in the plan: in this codebase "transition" means a
**phase** transition owned by the host, not a CSS one.

**The no-framework decision is what makes some motion expensive.** `leaderboard-beat/plan.md:94-96`
names the sharp edge precisely: *"Hand-written DOM with no diffing is the accepted cost of the
no-framework decision; **an animated reordering list is where that cost bites hardest**."* A
rank-change animation on `#standings-board` needs element identity across renders, and
`renderStandings` wipes the container (`render.ts:620`). That is the one beat where motion is a
genuine architecture question rather than an application of the existing pattern.

**Astro View Transitions are effectively off the table** as a beat-swap primitive:
`health-check.md:208-216` records unfixed advisories in the 6.x line ("unescaped View Transition
animation properties", "XSS via `transition:*` directive values"), clearing only with the Astro 7
major — which CLAUDE.md says is always a separate, deliberate change.

## Historical Context (from prior changes)

- `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md:100` — deferred: *"animation
  and rank-change indicators"*. Reasoning at `plan.md:94-96` (above).
- `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md:73` — deferred: *"a staged
  3 → 2 → 1 reveal, any animation"*. The argument, `plan.md:72-74`: *"A client-side timed reveal would
  put **150 phones on their own clocks against the projector in the one moment everyone is watching
  both** — the divergence the PRD guardrail is about."* **Read narrowly: this objects to client-side
  timing that carries state, not to decoration.**
- `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:65-68`, `:106-107` — chrome is *"one
  intense moment per screen"* and is rationed so the `ended` inversion lands; type floors are 20px on
  the phone, 26px on the projector.
- `context/archive/2026-08-15-livequiz-signage-redesign/plan.md:339-341` — open question 2, bubble
  dwell time, resolved into timed expiry (`host.astro:2458-2472`) but **still with no visual fade**.
- `context/archive/2026-08-15-rail-empty-at-reveal/` — the whole change is about a region outliving
  its content; `syncRail` is its artifact and its constraint.
- `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md:87-89` — a total sort order
  exists specifically to prevent cloud flicker.
- `context/foundation/test-plan.md:313-324` — visual regression dropped as a rollout phase, citing
  *"two shipped geometry defects on the projector … both caught by eye rather than by a test."*
  Partly stale: `e2e/` now exists but is scoped to *"which verb is enabled, never how it looks"*.
- `context/foundation/prd.md:108-114` — the three guardrails motion could violate: reflection within
  **1 second** of the host acting; **no divergence in standings between devices**; legibility from
  the back of the room. `prd.md:411` (FR-015) is the strongest pro-motion sentence in the PRD:
  *"the moment a word people typed on their own phones appears on the big screen is the moment that
  proves the session is live"* — and the cloud currently has no entrance treatment at all.

## Related Research

- [`frame.md`](./frame.md) — the framing step this research rests on; reached findings 2 and 5
  independently and at less depth.

## Open Questions

1. **Exit motion, or entrance only?** Entrance is available today and costs nothing structural. Exit
   requires changing the `hidden` primitive at ~30 sites — and `syncRail`'s live-`hidden` read makes a
   deferred hide actively dangerous. Scoping to entrance-only would sidestep the largest risk in the
   change; whether that is enough for "feels dead" is a judgement the plan must make explicitly.
2. **The standings reorder.** The one beat where motion needs element identity across a
   `replaceChildren()`, and the one the no-framework decision was already flagged against. In or out?
3. **How much is testable, and is that acceptable?** rAF-driven motion is unit-testable; CSS
   transitions declared in markup are not (and the countdown bar's existing one is untested). The plan
   should state which motion carries a guard and which is decoration accepted without one, rather than
   letting the split happen by accident.
4. **Does `prefersReducedMotion` get exported, or does the layer own it?** Related: nothing else in
   the project honours the media query, including the marketing nav drawer — is bringing that into
   line in scope, or explicitly out?
5. **The 1-second budget** (`prd.md:108-109`) is stated for state reflection, not for animation
   completion. A 900ms count-up already sits inside it. Does the plan need a stated ceiling for
   entrance durations, and is it the same number?
