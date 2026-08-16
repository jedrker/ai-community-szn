# Quiz Animations and Transitions — Implementation Plan

## Overview

Extract the three motion rules that `render.ts` already proved — the reduced-motion gate, the
in-flight cancel, the replay signature — into a shared, tested `src/lib/client/motion.ts`, then apply
**entrance-only** motion beat by beat across the projector and the phone. `setHidden` and every exit
path stay exactly as they are.

## Current State Analysis

Motion exists but is not systematized. `renderDistribution`'s count-up
(`src/lib/client/render.ts:420-555`) is the only JS-driven animation in the project and the only
reduced-motion check anywhere; all three of its safety rules are private to that one function. The
countdown bars (`host.astro:721`, `index.astro:258-259`) and the QR hover hint (`host.astro:989-990`)
are the only CSS transitions in the quiz views. Everything else changes instantly.

Four constraints, all established in [`research.md`](./research.md), shape what is buildable:

1. **happy-dom 20.11.2 has no WAAPI, no transition engine, and never fires `transitionend`** — there
   is no `TransitionEvent` class in its exports. Motion built on `Element.animate` or transition
   callbacks is untestable here.
2. **`hidden` is `display: none !important`** (`preflight.css:391-392`), so nothing toggled by
   `setHidden` can be transitioned out.
3. **`syncRail` reads the live `hidden` property** (`host.astro:2127-2135`), so a deferred hide
   leaves the rail standing empty — the defect `2026-08-15-rail-empty-at-reveal` fixed.
4. **The structural guards count call shapes.** `host.test.ts` pins `setHidden(railBox` at 1,
   `setHidden(endRow` at 1, `setHidden(messageBubble` at 3, and `/\blet\s+\w*[Tt]imer\b/` at exactly
   1. `index.test.ts:102` requires **zero** `setTimeout` in the attendee page. Neither forbids
   `requestAnimationFrame`; a *painting* timer is explicitly permitted (`host.test.ts:142-161`).

## Desired End State

One module owns every rule that makes motion safe here. Each beat the room watches has an authored
arrival: the word cloud's new chips rise as people type them, the reveal's answer and the standings
board arrive rather than appear, and on the phone the options, the acknowledgement and the result
land instead of blinking into place. Nothing leaves with motion, nothing reorders, and the projector's
stillness between questions is unchanged. A device asking for reduced motion sees every final state
immediately.

Verify by loading `/quiz/host` and `/quiz` against a live session and stepping the full beat sequence,
plus `bun run test`, `bun run type-check`, `bun run lint`.

### Key Discoveries

- `render.ts:429-433`, `:513-533`, `:535-554` — the cancel, the signature, the gate and the rAF loop,
  in the exact order a shared driver needs them.
- `render.test.ts:559-582` — the `frames[]` queue that makes a frame a step the test takes. This is
  the harness pattern the new module's tests inherit.
- `render.test.ts:570` — `cancelAnimationFrame` is a no-op stub, so **the count-up's cancellation is
  asserted nowhere today.** Phase 1 closes this.
- `index.astro:218-224` — *"and this one is animating"*: an animated element must live outside
  `#question`, which `replaceChildren()` wipes on every snapshot.
- `index.astro:712-717` — option letters come from a CSS counter, so they re-letter if rows are
  **added or reordered**. An opacity/transform stagger over already-present rows is safe.
- `index.astro:563`, `:1819`, `:1855` — `#follow-status`, `#result-award` and `#result-verdict` take
  whole-string `className` assignment, so motion on them must be **inline style**, never a class.
- `countdown.ts:18-20` — the arming call never invokes the terminal callback. The motion driver
  inherits this: calling it never fires a completion callback synchronously.

## What We're NOT Doing

- **No exit motion.** `setHidden` is untouched, `syncRail`'s derivation is untouched, and no element
  defers its hide.
- **No standings reorder / FLIP / rank-change indicators.** Deferred to a follow-up change, the same
  way `leaderboard-contract.md:100` and `winner-reveal-contract.md:73` deferred animation to this one.
- **No rail motion.** The answered count, the clock and the word-cloud counters are numbers the room
  reads continuously; motion there is noise, and `host.astro:154-156` is the position that says so.
- **No marketing-site changes.** `Navbar.astro:57-113` keeps its unguarded transitions; out of scope
  and named as such.
- **No new phase, key, snapshot field or route.** Nothing here touches session state or the wire.
- **No View Transitions.** `health-check.md:208-216` records unfixed Astro 6.x advisories; clearing
  them needs the Astro 7 major, which is always a separate change.
- **No structural motion assertions in the view test files.** Coverage lives in the module.

## Implementation Approach

A single rAF driver keyed per container, holding the three rules. Views describe *what* arrives and
*when it changed*; the module decides whether to animate at all.

The driver paints progress 0 **synchronously** on the call that starts it, before the caller appends
the container's children — so the room never sees a flash of final state, which is the ordering
`render.ts:530` already relies on. Stagger is expressed as a per-element offset **inside one rAF
loop**, never as a timer: that is what keeps `index.test.ts:102`'s zero-`setTimeout` assertion true
and avoids adding a second timer handle to `host.astro`.

## Critical Implementation Details

**Timing & lifecycle.** The signature guard is what makes this safe on a re-rendering page: the host
re-renders on every snapshot *and* every fallback poll tick (~2.5s), and the attendee re-renders on
nine triggers including every Wi-Fi flap. Any entrance without a signature replays in front of the
room — the failure `render.ts:360-366` names. For the word cloud specifically the container's content
changes on almost every poll, so a container-level signature is not enough: the entrance must apply
to **newly-arrived words only**, diffed against the previous word set held in the module.

**User experience spec.** On the phone, the question prompt does **not** animate — only the options
list does. The prompt must be legible on the first frame because the countdown is already running and
`prd.md:108-109` budgets one second for the attendee's screen to reflect the host's action. Entrance
durations are capped at `ENTER_MS` (240ms) with total stagger capped at 160ms regardless of option
count, so the slowest option is fully readable inside 400ms.

## Phase 1: Extract the motion module

### Overview

A new `src/lib/client/motion.ts` carrying the three rules and the rAF driver, with `render.ts`'s
count-up rewired onto it. Behaviour-neutral on screen; the only visible delta is test coverage.

### Changes Required

#### 1. The motion module

**File**: `src/lib/client/motion.ts` (new)

**Intent**: Own every rule that makes motion safe in this project, so a second animation cannot be
written without them. Named exports, no DOM lookups by id, no imports from `src/quiz/` or
`src/lib/session/` — the module docblock should carry the same self-attesting boundary line
`countdown.ts:22-23` and `toast.ts:23-24` do.

**Contract**: Five exports.

- `prefersReducedMotion(): boolean` — moved verbatim from `render.ts:370-375`, keeping both layers of
  defensiveness (`typeof window !== "undefined"` and optional-call `matchMedia?.`).
- `easeOut(t: number): number` — moved from `render.ts:337-339`.
- `runMotion(container: HTMLElement, spec: MotionSpec): void` — the driver. `MotionSpec` carries
  `signature: string`, `durationMs: number`, `paint: (progress: number) => void`, and optional
  `ease`. Behaviour, in this order: compare `signature` against the container's stored one and return
  without painting if unchanged; cancel any in-flight frame for this container; if reduced motion is
  requested or `requestAnimationFrame` is absent, call `paint(1)` and return; otherwise call
  `paint(0)` synchronously, store the new signature, and drive the loop off the rAF timestamp — never
  `Date.now()`. The loop's final frame calls `paint(1)` exactly rather than trusting the clock to
  land there.
- `cancelMotion(container: HTMLElement): void` — cancels in flight without touching the signature.
  Callers use it before an early return so a container that disappears takes its animation with it.
- `forgetMotion(container: HTMLElement): void` — drops the stored signature so a cleared container
  re-animates on return.

Both WeakMaps stay module-private. Note the happy-dom quirk from research: its rAF handle is a
`NodeJS.Immediate`, not a number, so the in-flight map should be typed to what `requestAnimationFrame`
actually returns rather than to `number`.

#### 2. Rewire the count-up

**File**: `src/lib/client/render.ts`

**Intent**: Delete the four private mechanisms (`countUpFrames`, `countUpSignatures`,
`prefersReducedMotion`, `easeOut`) and express the count-up as one `runMotion` call, so there is one
implementation of each rule rather than two.

**Contract**: `renderDistribution`'s observable behaviour is unchanged — same `COUNT_UP_MS`, same
signature string, same `paintBars(targets, 0)` before `container.append(list)`, same deletes on the
two nothing-drawn paths (now `forgetMotion`), same cancel before the early return (now
`cancelMotion`). `COUNT_UP_MS` and `paintBars` stay in `render.ts`; they are about bars, not motion.
The `animate` option keeps its name and its meaning.

#### 3. Module tests

**File**: `src/lib/client/motion.test.ts` (new)

**Intent**: Prove each rule independently, including the one the count-up's tests never asserted.

**Contract**: `// @vitest-environment happy-dom` on line 1. Hand-stubbed `requestAnimationFrame`
pushing into a `frames[]` queue, per `render.test.ts:559-582` — no fake timers, which research shows
cannot reach happy-dom's rAF. Cases: paints final immediately and queues **no frame** under reduced
motion (stubbing `matchMedia` per `render.test.ts:653-658`) and when `requestAnimationFrame` is
absent; queues no frame for an unchanged signature; re-animates after `forgetMotion`; paints exactly
`1` on the final frame even when the clock overshoots; **`cancelMotion` and a re-run both cancel the
in-flight handle** — asserted with a spy rather than a no-op stub, closing the gap at
`render.test.ts:570`; a staggered spec leaves later elements at lower progress mid-flight.

### Success Criteria

#### Automated Verification

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- `render.test.ts`'s existing count-up suite passes unchanged — the rewire is behaviour-neutral
- Boundary gate passes: `src/lib/client/boundary.test.ts` sees no new violation
- `prefersReducedMotion`, `easeOut`, `countUpFrames` and `countUpSignatures` no longer appear in
  `src/lib/client/render.ts`

#### Manual Verification

- Load `/quiz/host`, open and reveal a choice question: the distribution bars still count up exactly
  as before
- With OS reduced-motion enabled, the bars appear at final figures with no count-up

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 2: Projector entrance beats

### Overview

Four arrivals on `/quiz/host`, all entrance-only, all keyed by a signature. No exit motion, no
reorder, no change to `setHidden`, `syncRail`, `applyShell` or `syncControls`.

### Changes Required

#### 1. Word-cloud chips — new words only

**File**: `src/lib/client/render.ts` (`renderWordCloud`, `:771-830`)

**Intent**: Make FR-015's moment visible — *"the moment a word people typed on their own phones
appears on the big screen is the moment that proves the session is live"* (`prd.md:411`). Only words
that were not in the previous paint animate; everything already on screen is painted final.

**Contract**: A new opt-in option on the render call, matching how `animate` is opted into today, so
the attendee page (which does not render the cloud) is unaffected. The module holds the previous word
set per container and diffs against it; a word that survives a re-render must not re-animate, and the
container being cleared must reset the set. New chips rise and fade over `ENTER_MS`; the existing
total sort order (`word-cloud-contract.md:87-89`) is untouched, since reordering is what the sort
exists to prevent.

#### 2. Standings and the closing board

**File**: `src/lib/client/render.ts` (`renderStandings`, `:615-670`)

**Intent**: The board arrives as a block when the beat lands, rather than appearing between frames.

**Contract**: Opt-in option; the whole list animates as one, keyed by a signature over the phase and
the entries, so a re-render of the same board does not replay. **No per-row stagger and no reorder** —
the rows carry rank identity and the reorder question is explicitly deferred. The winner row's
first-child emphasis (`index.astro:1018-1020`) is a class, unaffected by an inline-style entrance.

#### 3. Accepted answer and question prompt

**File**: `src/pages/quiz/host.astro`

**Intent**: The revealed answer arrives when the host reveals it, and a new question's prompt arrives
when the question changes — the two beats where the projector's content changes wholesale.

**Contract**: Two `runMotion` calls in the existing render path, keyed on the revealed answer text and
on the current question id respectively. No new timer handle, no new `let`, no wrapping of
`setHidden`, no second `setHidden(railBox` — the four counting guards in `host.test.ts` must pass
untouched. The calls sit **after** the existing `setHidden` for each element, so an element that is
hidden this render simply never animates.

### Success Criteria

#### Automated Verification

- Unit tests pass: `bun run test`
- `src/pages/quiz/host.test.ts` passes with **no assertion changed** — this is the guard that the
  page gained no timer, no second predicate and no extra `setHidden`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- New render options are covered in `render.test.ts` for the two rules that matter: an unchanged paint
  animates nothing, and a word already on screen does not re-animate

#### Manual Verification

- Word cloud: with two devices submitting, each new word rises as it lands; words already on the
  screen stay still across the ~2.5s poll
- Reveal a choice question: bars count up as before, the accepted answer arrives once
- Advance to standings, then close the session: the board arrives once in each phase, rows in the
  order given, no reflow of the flow-verb row
- Step the full sequence twice and confirm nothing replays on a repeated snapshot
- The rail appears and disappears exactly as it does today

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 3: Attendee entrance beats

### Overview

Four arrivals on `/quiz`. All timing lives in the module; `index.astro` gains no timer, which
`index.test.ts:102` requires.

### Changes Required

#### 1. Question arrival — options only

**File**: `src/pages/quiz/index.astro`, `src/lib/client/render.ts` (`renderQuestion`)

**Intent**: Mark the beat change without costing legibility. The prompt is painted final; the option
rows stagger in.

**Contract**: Opt-in on the render call, keyed by question id so a re-render mid-question animates
nothing. Stagger is a per-element offset inside one rAF loop — **no `setTimeout`, no second loop**.
Total stagger capped at 160ms regardless of option count, entrance capped at `ENTER_MS`. Rows are all
present from the first frame (only opacity and transform move), so the CSS counter at
`index.astro:712-717` cannot re-letter them. Text and number questions have no options and are
unaffected.

#### 2. Answer acknowledgement

**File**: `src/pages/quiz/index.astro`

**Intent**: Confirm the round-trip landed — the one moment an attendee genuinely doubts.

**Contract**: A `runMotion` call on `#answer-note` keyed by the note's text, so the note animates when
what it says changes and not on every snapshot. Inline style only: the note's siblings
`#result-award` and `#result-verdict` take whole-string `className` assignment (`:1819`, `:1855`) and
a class would be wiped.

#### 3. The result moment

**File**: `src/pages/quiz/index.astro`

**Intent**: The beat with the most emotional payload on the phone — the verdict, the award and the
running total.

**Contract**: The `#result` panel enters as a block keyed by question id, and the award figure counts
up from zero over the same driver. The count-up reads the awarded value the route already returned —
**the animation is the decoration, never the data**, so a device without it sees the true figure
immediately. Number questions keep branching on kind before `correct` (`AnswerRecord.correct` is
exact-hit-only), which this change does not touch.

#### 4. The close

**File**: `src/pages/quiz/index.astro`

**Intent**: The phone's final board arrives with the projector's.

**Contract**: The same `renderStandings` entrance option Phase 2 added, opted into on the attendee's
board, keyed the same way. No reorder.

### Success Criteria

#### Automated Verification

- Unit tests pass: `bun run test`
- `src/pages/quiz/index.test.ts` passes with **no assertion changed** — in particular
  `occurrences("setTimeout") === 0` and the no-`let *Timer*` assertion
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- Boundary gate passes — the page's `<script>` gains no `import.meta.env` read and no value import
  from `src/quiz/` or `src/lib/session/`

#### Manual Verification

- On a phone (or narrow window), open a choice question: the prompt is readable immediately and the
  options land within ~400ms; the countdown is unaffected
- Submit: the acknowledgement lands; submitting again on a later question repeats it
- Reveal: the result panel arrives once and the award counts up to the true figure; re-rendering
  (background/foreground the tab) does not replay it
- Answer a number question and confirm a partial award still reads as a positive result
- With OS reduced-motion enabled, every one of the above appears final immediately
- Close the session: the board arrives on the phone

**Implementation Note**: Pause after this phase for manual confirmation before proceeding.

---

## Phase 4: Docs and the reversal

### Overview

Record the contract, and amend every document this change makes false — per `lessons.md`, *"The
CLAUDE.md edit is part of the slice, not a discovery at the end of it."*

### Changes Required

#### 1. The contract

**File**: `context/changes/quiz-animations-and-transitions/motion-contract.md` (new)

**Intent**: The durable artifact, in the shape the archived slices use.

**Contract**: States the entrance-only rule and why (the `hidden` primitive and `syncRail`'s live
read); the three rules and their single owner; the guard/decoration split; the duration ceilings and
the reason the phone's prompt does not animate; and a Scope boundary section naming what was deferred
— the standings reorder, exit motion, rail motion, the marketing site.

#### 2. The two positions this change overturns

**Files**: `src/lib/client/render.ts` (the `animate` docblock, `:300-307`),
`src/pages/quiz/index.astro` (the countdown urgency docblock, `:233-236`)

**Intent**: Both currently assert positions that are now false. Amend them **quoting the position
overturned** rather than deleting it, as the PRD and `state.ts` already do.

**Contract**: `render.ts`'s *"Opt-in, and only the projector opts in"* becomes opt-in with both
surfaces opting in, keeping the reasoning about narration and about the animation never being the
data. `index.astro`'s *"Nothing else changes: no size, no motion, no sound"* stays true **of the
clock** — the amendment must make clear the rejection was about a moving clock competing with a
running countdown, and that authored entrance motion elsewhere on the phone is now in.

#### 3. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: The file every future agent reads first must not assert an invariant the code stopped
holding.

**Contract**: Add `motion.ts` to the client-modules discussion, and state the entrance-only rule and
the `hidden`/`syncRail` reasoning where the rail and the polling sections already discuss them. The
polling section's *"There are also timers that fetch nothing"* paragraph needs the distinction
extended: motion is rAF-driven and holds no timer at all, which is why it does not weaken
`host.test.ts`'s one-fetching-timer property.

#### 4. The projector's stillness principle

**File**: `src/pages/quiz/host.astro` (`:154-156`)

**Intent**: *"nothing on the projector moves between questions except the content that is supposed
to"* is the sentence this change operates under, not against — but it now needs to say that arrivals
are authored while layout is still.

**Contract**: One amended sentence distinguishing incidental motion (layout shift, a column that
appears and folds — still a defect) from authored entrance motion (content arriving — now intended).

### Success Criteria

#### Automated Verification

- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- Formatting passes: `bun run format`
- Full suite passes: `bun run test`

#### Manual Verification

- `motion-contract.md` names every deferred item, so the follow-up change has a written handoff
- Re-reading `CLAUDE.md`'s rendering, client-interactivity and polling sections turns up no sentence
  this change made false

---

## Testing Strategy

### Unit Tests

- `motion.test.ts` — each rule independently: the reduced-motion gate, the no-rAF fallback, the
  signature guard both ways, exact final-frame painting, cancellation observed with a spy, stagger
  offsets.
- `render.test.ts` — the existing count-up suite must pass unchanged after the rewire; new cases for
  the word-set diff (an existing word does not re-animate) and for the standings entrance's signature.

### Integration Tests

None. Nothing here touches a route, a key, the snapshot or session state, so the route and session
suites should be untouched — a diff in either is a signal that the change escaped its scope.

### Manual Testing Steps

1. Two devices plus the host view. Step the full sequence: lobby → each question kind → reveal →
   standings → close.
2. On each beat, re-render without changing state (background/foreground the tab, or let a fallback
   poll tick) and confirm nothing replays.
3. Watch the word cloud specifically across several polls: only new words move.
4. Repeat the whole sequence with OS reduced-motion enabled — every final state should appear
   immediately, and nothing should be missing.
5. Drive the host view at 1440 as well as 1920 and confirm the flow-verb row never reflows.

**Per lessons.md**: for each guard added in `motion.test.ts`, break the guard, confirm that specific
test fails, then restore. A test that cannot fail has been checked, not verified.

## Performance Considerations

The venue network is the constraint that matters, and this change adds no requests, no polling and no
payload beyond one small module. On the phone the budget is `prd.md:108-109`'s one second for state
reflection: entrances are capped at 240ms with stagger capped at 160ms, and the prompt is painted
final on the first frame, so the attendee reads the question well inside it. On the projector the
word cloud animates only new chips, so a room typing quickly does not put every chip on a rAF loop at
once.

## Migration Notes

None. No stored data, no schema, no wire format. Reverting is deleting the module and the opt-ins.

## References

- Frame brief: `context/changes/quiz-animations-and-transitions/frame.md`
- Research: `context/changes/quiz-animations-and-transitions/research.md`
- The pattern this module follows: `src/lib/client/countdown.ts`, `src/lib/client/toast.ts`
- The rules being extracted: `src/lib/client/render.ts:429-433`, `:513-533`, `:535-554`
- The test harness pattern: `src/lib/client/render.test.ts:559-582`
- Deferred by prior slices: `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md:100`,
  `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md:73`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extract the motion module

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — f3c4baf
- [x] 1.2 Type checking passes: `bun run type-check` — f3c4baf
- [x] 1.3 Linting passes: `bun run lint` — f3c4baf
- [x] 1.4 `render.test.ts`'s existing count-up suite passes unchanged — f3c4baf
- [x] 1.5 Boundary gate sees no new violation — f3c4baf
- [x] 1.6 The four private mechanisms no longer appear in `render.ts` — f3c4baf

#### Manual

- [x] 1.7 Distribution bars still count up exactly as before — f3c4baf
- [x] 1.8 With reduced motion enabled, bars appear at final figures — f3c4baf

### Phase 2: Projector entrance beats

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 594d4df
- [x] 2.2 `host.test.ts` passes with no assertion changed — 594d4df
- [x] 2.3 Type checking passes: `bun run type-check` — 594d4df
- [x] 2.4 Linting passes: `bun run lint` — 594d4df
- [x] 2.5 New render options covered for the two rules that matter — 594d4df

#### Manual

- [x] 2.6 Only new word-cloud chips move across polls — 594d4df
- [x] 2.7 Reveal: bars count up, accepted answer arrives once — 594d4df
- [x] 2.8 Standings and close: board arrives once per phase, no row reorder, no flow-row reflow — 594d4df
- [x] 2.9 Nothing replays on a repeated snapshot — 594d4df
- [x] 2.10 The rail appears and disappears exactly as today — 594d4df

### Phase 3: Attendee entrance beats

#### Automated

- [x] 3.1 Unit tests pass: `bun run test` — 85706c5
- [x] 3.2 `index.test.ts` passes with no assertion changed — 85706c5
- [x] 3.3 Type checking passes: `bun run type-check` — 85706c5
- [x] 3.4 Linting passes: `bun run lint` — 85706c5
- [x] 3.5 Boundary gate passes for the page's `<script>` — 85706c5

#### Manual

- [x] 3.6 Prompt readable immediately; options land within ~400ms — 85706c5
- [x] 3.7 Acknowledgement lands on submit, and repeats on a later question — 85706c5
- [x] 3.8 Result panel arrives once and the award counts up; no replay on tab refocus — 85706c5
- [x] 3.9 A partial numeric award still reads as a positive result — 85706c5
- [x] 3.10 With reduced motion enabled, every beat appears final immediately — 85706c5
- [x] 3.11 The board arrives on the phone at the close — 85706c5

### Phase 4: Docs and the reversal

#### Automated

- [x] 4.1 Type checking passes: `bun run type-check`
- [x] 4.2 Linting passes: `bun run lint`
- [x] 4.3 Formatting passes: `bun run format`
- [x] 4.4 Full suite passes: `bun run test`

#### Manual

- [x] 4.5 `motion-contract.md` names every deferred item
- [x] 4.6 No sentence in CLAUDE.md's rendering, client-interactivity or polling sections is left false
