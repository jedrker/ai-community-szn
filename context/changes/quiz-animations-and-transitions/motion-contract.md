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

## The confetti, and the dependencies this change added

The phone's closing screen runs confetti.js.org's **"Confetti + Ribbons"** sample, on **every** phone
at `ended`, not only the winner's.

**It is two libraries, and that is the thing to know first.** `confetti()` and `ribbons()` are
separate packages — `@tsparticles/confetti` and `@tsparticles/ribbons` (ribbons.js.org) — not two
modes of one. The demo's own code calls both. A first attempt at this reproduced the look from
`@tsparticles/confetti` alone on the reasoning that "the ribbons config is not published", which was
simply wrong: the config is in the demo page's bundle and the second library is on npm.

Three packages are installed, and the third is not obvious:

| Package | Why |
| --- | --- |
| `@tsparticles/confetti` | the bursts |
| `@tsparticles/ribbons` | the ribbons; pulls `shape-ribbon` transitively, so do **not** install that separately |
| `@tsparticles/plugin-interactivity` | **an optional peer dependency of `plugin-emitters`.** Without it `bun run build` fails with *"ExternalInteractorBase is not exported by __vite-optional-peer-dep…"*. Confetti alone did not need it; ribbons pulls in `EmittersInteractor`, which does. |

**The trap, and it shipped once.** Both packages register their plugins against **one**
`tsParticles` singleton, and the engine refuses registration after anything has called `load()`. So
firing confetti first makes every later `ribbons()` throw *"Register plugins can only be done before
calling tsParticles.load()"* — absorbed, as it must be, which on screen is **confetti with no ribbons
and a clean console**. `celebrate.ts` therefore awaits `init()` on both *before* either half fires,
and `CelebrationEffects.init` is part of the type rather than hidden in the loader so a test can hold
the order.

It does **not** reproduce against the published demo, and that is the part worth remembering: the
demo loads UMD bundles that each carry their own copy of the engine. The conflict only appears once a
bundler dedupes them — which is exactly what our build does. Copying a working snippet from that page
is not evidence it works here.

The costs, and which number to argue from:

- **`canvas-confetti` (90 KB, zero dependencies) was offered and declined**, because it cannot do the
  ribbons half. The trade was made deliberately with both figures visible.
- **The packages total ~1.5 MB unpacked, but that is not what a phone pays.** Measured from the
  build: the lazy chunks come to **~42 KB gzipped**, and the attendee's entry script is unchanged at
  **7 KB gzip** with no library code in it. Argue from the measured number, not the package size —
  and re-measure rather than trusting this line after a version bump.
- **The `import()`s are dynamic and must stay dynamic**, and both resolve together — a ribbons chunk
  arriving after the confetti had finished would be six seconds of nothing followed by ribbons over
  an empty screen. A static import would move all of it into the bundle that has to clear FR-002's
  30-second join target on a venue network.
- **Every timer it starts can be stopped**, wired to the page's `pagehide` beside the countdown's own
  stop. The published sample does not bother — a demo page has no lifecycle, a phone does, and 120
  bursts queued against a backgrounded tab is the "clock left running over a session that no longer
  exists" defect `countdown.ts` was extracted to fix. The ribbons interval is created *inside* a
  timeout, so the handles live in a list rather than in named variables: at the moment `stop` may
  first be called, that interval does not exist yet.
- **The reduced-motion gate runs *before* the import**, not through the library's own
  `disableForReducedMotion` — a device that asked for less motion should not spend the bytes either.
  This is the most motion-sensitive thing the app does.
- **Fires once per signature.** The closing screen re-renders on every snapshot, every fallback poll
  and every connection flap; the signature is marked *before* the import resolves, so a re-render
  arriving mid-download cannot start a second one.
- **A failure is absorbed and never retried.** `celebrate.test.ts` asserts this by watching for
  unhandled rejections, not just by checking that `fire()` does not throw — the failure path is
  asynchronous, and the weaker assertion passed against a version with no `catch` at all.

The projector deliberately gets none: the closing screen already inverts to a chrome ground, and
chrome is rationed to one intense moment per screen.

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
