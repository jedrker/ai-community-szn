# Quiz Animations and Transitions — Plan Brief

> Full plan: `context/changes/quiz-animations-and-transitions/plan.md`
> Frame brief: `context/changes/quiz-animations-and-transitions/frame.md`
> Research: `context/changes/quiz-animations-and-transitions/research.md`

## What & Why

The quiz has motion but no *motion system* — every rule that makes motion safe here (reduced-motion,
cancel-in-flight, don't replay on an unchanged re-render) is locked inside one function, and the two
primitives the beats are built on — `replaceChildren()` per snapshot and `hidden` as
`display:none !important` — actively defeat the naive way of adding more. This change extracts those
rules into a shared, tested module and applies entrance motion beat by beat on both surfaces.

## Starting Point

`renderDistribution`'s count-up (`render.ts:420-555`) is the only JS-driven animation in the project
and the only reduced-motion check anywhere; it has exactly one call site. The countdown bars and a QR
hover hint are the only CSS transitions in the quiz views. Everything else — every beat change on
both screens — happens between frames. Animation was deferred by two prior slices (leaderboard,
winner reveal) without ever being argued against.

## Desired End State

Each beat the room watches has an authored arrival: new word-cloud chips rise as people type them,
the revealed answer and the standings board arrive rather than appear, and on the phone the options,
the acknowledgement and the result land instead of blinking into place. Nothing leaves with motion,
nothing reorders, and the projector's stillness between questions is unchanged. A device asking for
reduced motion sees every final state immediately.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What the problem actually is | Extract a motion system, not add effects | Rules are private to one function; the primitives defeat naive motion | Frame |
| Mechanism | rAF-driven inline-style writes | happy-dom has no WAAPI, no transition engine, never fires `transitionend` — anything else is untestable here | Research |
| Exit motion | **Out** — entrance only | Keeps `setHidden` and `syncRail`'s live-`hidden` read intact; avoids re-opening the `rail-empty-at-reveal` defect class | Plan |
| Standings reorder | **Deferred** to a follow-up | The one beat needing element identity across a container wipe — the cost `leaderboard-beat/plan.md:94-96` flagged | Plan |
| Phone scope | All four beats (arrival, ack, result, close) | Deliberately reverses `index.astro:233-236`, which rejected phone motion | Plan |
| Guard split | Module unit-tested; markup CSS transitions untested | Every rule whose failure is invisible on screen gets a test; the split is stated, not accidental | Plan |
| Reduced motion | Quiz views only; marketing nav drawer out | One gate, one owner; keeps the change one idea | Plan |

## Scope

**In scope:** `src/lib/client/motion.ts` + tests · rewiring the count-up onto it · projector
entrances (word-cloud chips, standings/closing board, accepted answer, question prompt) · phone
entrances (options stagger, acknowledgement, result panel + award count-up, closing board) ·
`motion-contract.md`, CLAUDE.md and the two docblocks this change overturns.

**Out of scope:** exit motion of any kind · standings reorder / FLIP / rank-change indicators · rail
motion (answered count, clock, cloud counters) · the marketing site's unguarded transitions · Astro
View Transitions (unfixed 6.x advisories) · any new phase, key, snapshot field or route.

## Architecture / Approach

One rAF driver keyed per container, holding the three rules. Views describe *what* arrives and *when
it changed*; the module decides whether to animate at all. Two details are load-bearing: the driver
paints progress 0 **synchronously** before the caller appends children, so there is no flash of final
state; and stagger is a per-element offset **inside one rAF loop**, never a timer — which is what
keeps `index.test.ts`'s zero-`setTimeout` assertion true and adds no timer handle to `host.astro`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract the motion module | `motion.ts` + tests; count-up rewired; cancellation finally asserted | A behaviour-neutral refactor that isn't — mitigated by `render.test.ts` passing unchanged |
| 2. Projector entrance beats | Word cloud, standings/close, accepted answer, question prompt | The cloud re-renders every ~2.5s; without a per-word diff every chip replays in front of the room |
| 3. Attendee entrance beats | Options stagger, acknowledgement, result + award count-up, close | Question arrival competes with the 1s reflection budget — capped durations, prompt painted final |
| 4. Docs and the reversal | `motion-contract.md`, CLAUDE.md, the two overturned docblocks | Skipping it leaves CLAUDE.md asserting an invariant the code stopped holding |

**Prerequisites:** a live session to step through (two devices plus the host view); OS reduced-motion
toggle for the accessibility pass.
**Estimated effort:** ~3–4 sessions, one per phase, with a manual confirmation gate between each.

## Open Risks & Assumptions

- The word-cloud diff is the sharpest edge in the change: the container is wiped on every poll, so
  "which words are new" must be held in the module, and getting it wrong replays the whole cloud.
- Phase 2 and 3 both assert their view test files pass **with no assertion changed**. If either needs
  a guard weakened, that is a signal the motion escaped its intended shape — stop rather than edit the
  guard.
- Reversing `index.astro:233-236` is a deliberate override of a reasoned prior position, not an
  oversight. If phone motion reads as noisy in the venue, that docblock is the argument to revisit.
- The standings reorder stays flat for at least one more event.

## Success Criteria (Summary)

- Every beat on both screens has a visible arrival, and nothing replays when a snapshot repeats or the
  tab is refocused.
- A device with reduced motion enabled sees every final state immediately, with nothing missing.
- The projector's layout is as still as it is today: no reflow of the flow-verb row, no empty rail, no
  column that appears and folds.
