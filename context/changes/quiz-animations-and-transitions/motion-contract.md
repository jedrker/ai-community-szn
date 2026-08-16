# Motion contract

> What the LiveQuiz views may animate, how, and what was deliberately left out.
> Written alongside `src/lib/client/motion.ts`; read this before adding an animation anywhere
> in `src/pages/quiz/` or `src/lib/client/`.

## The position this change reversed

Animation was **deferred twice and never argued against** —
`leaderboard-contract.md:100` ("animation and rank-change indicators") and
`winner-reveal-contract.md:73` ("a staged 3 → 2 → 1 reveal, any animation"). This change is the
follow-up those two slices handed forward.

The one *argued* objection is narrower than it reads. `winner-reveal/plan.md:72-74` refuses a
staged reveal because "a client-side timed reveal would put **150 phones on their own clocks
against the projector in the one moment everyone is watching both**". That is an objection to
client-side timing that **carries state**, not to decoration — the reveal's count-up already
coexisted with it. Nothing here decides, delays or reorders anything the room is told; every
animation is over data that is already final on arrival.

The phone was different: `index.astro`'s countdown docblock said "Nothing else changes: no size,
no motion, no sound." That was a reasoned rejection, and this change **overrides it deliberately**
for four beats. It stays true of the clock itself — a moving countdown competes with a countdown.

## Entrance only

**Nothing defers a hide.** Two mechanisms make exit motion a different and much larger change:

- `setHidden` writes the `hidden` property, and Tailwind's preflight ships
  `[hidden]:where(:not([hidden='until-found'])) { display: none !important }`. An element toggled
  this way leaves layout on the frame; there is nothing to transition.
- `host.astro`'s `syncRail` derives the rail's visibility from its three sections' **live `hidden`
  state**. A hide that waited for an animation to finish would be read as "still visible", leaving
  an empty 440px column beside the stage — which is the exact defect
  `2026-08-15-rail-empty-at-reveal` was opened to fix.

Changing this means changing the visibility primitive at ~30 call sites *and* re-deriving
`syncRail`. Out of scope here, and not a small follow-up.

## rAF, not CSS transitions or WAAPI

Not a stylistic preference. `happy-dom` implements no animation engine, exposes no
`Element.animate`, and has no `TransitionEvent` class at all — `transitionend` never fires. Motion
built on either is untestable in this project, and would fall back to the source-text scan that
`countdown.ts:5-13` records as having *certified the defect instead*.

**The split, stated rather than accidental:** motion whose correctness matters goes through
`motion.ts` and carries unit tests. A CSS transition declared in markup is still fine where nothing
depends on it — the countdown bar's `transition-[width]` and the QR hover hint are both untested and
both fine, because a regression in either is visible the moment anyone looks at the screen.

## The three rules

All in `src/lib/client/motion.ts`, none of them optional:

1. **Reduced motion, and no-rAF, get the final state immediately.** The animation is the
   decoration, never the data.
2. **A re-render cancels the frame in flight.** Two loops writing the same nodes is silent — the
   values just fight. `cancelMotion` is called *before* a render's early returns, so a container
   that empties takes its animation with it.
3. **An unchanged thing is not re-animated.** Both views re-render far more often than they change:
   the host on every snapshot and every ~2.5s fallback poll, the attendee on nine triggers including
   every connection flap. Without a signature, a dropped Ably message restarts every animation on
   screen.

`staggeredProgress` exists so rule 3 survives a staggered group: offsets live **inside one rAF
loop**, never one timer per element. A `setTimeout` stagger would fail `index.test.ts`'s
zero-timer assertion on the attendee page and add a second timer handle to `host.astro`.

## What animates

| Beat | Keyed on | Note |
| --- | --- | --- |
| Word-cloud chips | the words that are **new** | Only words the container has not drawn before move. The panel repaints every ~2.5s; a list-wide entrance would restart thirty chips several times a minute. FR-015. |
| Standings / closing board | `motionKey` + the rows | One block. `motionKey` tells the standings beat from the close, which publish the same five names. |
| Projector question | `id` + revealed-or-open | The reveal is its own beat, so the marked bands arrive. |
| Accepted answer | its text | |
| Attendee option rows | the question id **alone** | Deliberately not the mode or the selection: tapping re-renders the block, and a key that moved with the tap would restart the list under the reader's thumb. |
| Attendee note | the sentence | One writer, `noteSays`. Stays quiet while a word is typed, because the same string is not an arrival. |
| Result panel | the question id | |
| Award figure | question + figure | Counts to the true value; lands on it **exactly**, including a fractional award. |

**The prompt never animates on the phone.** FR-002 budgets one second for a device to reflect what
the host did, the clock is already running, and the prompt is what the reader needs first.
`ENTER_MS` is 240ms; the option stagger is a fraction of it (`OPTION_SPREAD`), so four rows and
eight rows land inside the same budget.

## What does not animate, on purpose

- **The rail** — the answered count, the clock, the word-cloud counters. Numbers the room reads
  continuously; `host.astro:154-156` is the position, and motion there is noise.
- **Layout.** Incidental motion is still a defect here: `rail-empty-at-reveal/reviews/impl-review.md:65`
  calls a column that appears and folds "the kind of motion the redesign spent effort removing". This
  change animates **content arriving**, never geometry. `FLOW_PILL`'s no-geometry rule for
  `data-[next=true]` is untouched.
- **`paintEntrance` removes its inline properties at completion** rather than setting `opacity: 1`.
  An element left holding inline values is one whose stylesheet no longer decides them.

## Scope boundary

Not here, and each deferred with a reason rather than forgotten:

- **The standings reorder / FLIP / rank-change indicators.** The one beat where motion needs row
  identity across a `replaceChildren()`, and `leaderboard-beat/plan.md:94-96` already named it: "an
  animated reordering list is where [hand-written DOM with no diffing] bites hardest." The next
  slice, if the board's flatness is still the complaint after an event.
- **Exit motion**, for the two mechanisms above.
- **Rail motion.**
- **The marketing site.** `Navbar.astro:57-113` animates unconditionally and consults no
  reduced-motion query. Out of scope; the gate reaches the quiz views only, so "we honour reduced
  motion" is true of `/quiz*` and not yet of the site.
- **Astro View Transitions** as a beat-swap primitive. `health-check.md:208-216` records unfixed
  6.x advisories; clearing them needs the Astro 7 major.

## Pointers

`src/lib/client/motion.ts` · `src/lib/client/motion.test.ts` ·
`context/archive/2026-08-15-rail-empty-at-reveal/` (why `syncRail` reads live `hidden`) ·
`context/archive/2026-08-11-leaderboard-beat/plan.md:94-96` (the reorder cost) ·
`context/archive/2026-08-14-final-winner-reveal/plan.md:72-74` (the narrow objection)
