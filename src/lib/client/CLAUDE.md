# src/lib/client/ — browser behaviour, as plain modules

Everything that runs in a browser lives here as plain TypeScript modules, imported by Astro
`<script>` tags. The server hands values down with **`define:vars`**.

## No UI framework, and none should be added

Not React, not Preact, not Alpine. This was decided deliberately (roadmap Open Question 2), not by
omission: the pattern was already proven by `spine-check.astro`, and it keeps the client bundle to
essentially the Ably SDK, which matters because the venue network is the one link nobody controls.
The accepted cost is that the quiz views do hand-written DOM updates with no diffing.

## The boundary — `boundary.test.ts` enforces it

A client module — **and any `<script>` block in `src/pages/quiz/*.astro`** — may not read
`import.meta.env` and may not *value*-import from `src/quiz/` or `src/lib/session/`. `import type` is
erased and is therefore allowed; that is how `SessionState` and `PublicQuestion` reach these modules.

Name the two failure modes, because the rule reads arbitrary without them:

- A value import from `src/quiz/` ships every question's `correctOptionIds`, `acceptedAnswers` and
  `correctValue` **to the phone being asked the question**. That is the exact leak `src/quiz/public.ts`
  exists to prevent, and the page still looks correct afterwards.
- A value import from `src/lib/session/`, or an `import.meta.env` read, pulls server configuration
  into a public bundle and drags `zod` and the Upstash and Ably server SDKs into a download budget
  that has to survive a venue network.

**Astro frontmatter is deliberately not scanned** — it runs server-side and is *meant* to read env
and import server modules. That is how the views get the channel name to pass down. Do not "fix" a
boundary failure by deleting a frontmatter import.

`qrcode` is server-side only and must never be imported from here; `boundary.test.ts` will not catch
that, since the rule it enforces is about `src/quiz/` and `src/lib/session/`, not bundle weight.

## This directory is where logic goes to become testable

An Astro inline `<script>` has no harness, so the only guard available over anything in one is a
source-text scan — and a scan for an expression that exists today certifies whatever is there,
defects included. `countdown.ts` was extracted for that reason (two inline copies, both shipping a
defect a green suite could not see), `toast.ts` followed it, and `controls.ts` is the third — the
host panel's phase-to-verb decision plus `atLastQuestion` and `pollTargetFor`. The shape is the same
each time: **pure named exports here, DOM writes left on the page.** See test-plan §6.5.

## Motion — `motion.ts` owns every rule that makes an animation safe here

The reduced-motion gate, the cancel-in-flight, and the signature that stops an unchanged thing
re-animating on a page that re-renders on every snapshot and every fallback poll.

**It is rAF only.** `happy-dom` has no animation engine, no `Element.animate` and no
`TransitionEvent`, so motion built on CSS transitions or the Web Animations API cannot be tested in
this project and falls back to the source scan that `countdown.ts` records as having certified a
defect instead. Markup-declared CSS transitions are still fine where nothing depends on them — the
countdown bar is one.

**Entrance only, and that is structural rather than taste.** `setHidden` writes the `hidden`
property, which preflight makes `display: none !important`, so nothing toggled that way can be
transitioned *out*; and `syncRail` derives the rail's visibility from its sections' **live `hidden`
state**, so a hide deferred until an animation finished would put an empty column beside the stage —
the defect `rail-empty-at-reveal` exists to prevent. The **standings reorder is deliberately not
done**: it needs row identity across a `replaceChildren()`, which is exactly where no-diffing bites
hardest.

The option stagger is a per-element offset *inside one rAF loop*, never one `setTimeout` per row —
that is what keeps the motion layer out of the page-level timer guards (`host.test.ts` allows exactly
one timer that can reach a `fetch`; `index.test.ts` requires the attendee page to hold **zero**
timers).

Read `context/changes/quiz-animations-and-transitions/motion-contract.md` before animating anything
here.

**One deliberate exception to the bundle rule.** The closing screen runs confetti.js.org's
"Confetti + Ribbons" on every phone (`celebrate.ts`). **It is two libraries** —
`@tsparticles/confetti` and `@tsparticles/ribbons` are separate packages, not two modes of one — plus
`@tsparticles/plugin-interactivity`, which is an *optional peer dependency* of `plugin-emitters` that
the build hard-fails without once ribbons are in (`"ExternalInteractorBase is not exported by
__vite-optional-peer-dep…"`). Do not add `@tsparticles/shape-ribbon`; it arrives transitively.

They total ~1.5 MB unpacked but are loaded through **dynamic `import()`s**, so a device downloads
~42 KB gzipped *at the close* and the attendee's entry script is unchanged at 7 KB gzip. Four things
keep that true and none is optional: **keep the imports dynamic and resolved together**, keep the
reduced-motion check *before* them rather than relying on either library's own
`disableForReducedMotion`, keep the failure absorbed, and **keep every timer stoppable** — the
sequence is six seconds of intervals and it is wired to `pagehide`. `canvas-confetti` (90 KB, no
dependencies) was the declined alternative; it cannot do the ribbons half.

## Three modules write to `localStorage`, and one behaves oppositely

`player.ts` and `answer.ts` absorb every storage failure and report *nothing stored* — a join must
never fail over a storage quirk. `device.ts` absorbs the same failures but **always returns an id**,
minting one in memory when it cannot persist.

The asymmetry is load-bearing: `/api/quiz/join` **refuses a claim that carries no `deviceId`**,
because an absent id treated as un-counted is the per-device cap's bypass, and a shared "unknown
device" bucket would let a few private-mode attendees consume the room's whole allowance. A client
that forgets to send one gets a 400, not a free pass.

### Testing storage failures — two halves, both required

`happy-dom`'s `localStorage` is a Proxy. A fix for either half alone certifies nothing.

- **Install with `vi.spyOn`.** A plain assignment — `window.localStorage.setItem = () => { throw }`
  — is *swallowed by the Proxy's set trap*. The write goes on succeeding, the test never meets a
  failure, and it passes against code whose `try`/`catch` has been deleted.
- **Restore with `spy.mockRestore()`, never `vi.restoreAllMocks()`** — the global teardown does not
  reach a spy on the Proxy, so the throwing implementation leaks into every later test in the file,
  where it silently swallows writes and fails unrelated assertions in a way that reads as a bug in
  the code under test.

`answer.test.ts`'s and `device.test.ts`'s `withBroken(method, body)` helper is the pattern. Note
which method a test needs: `clearSeen` calls `removeItem` and never `setItem`, so breaking the write
would have left it exercising perfectly healthy storage.

`happy-dom` is selected **per file** by a `// @vitest-environment happy-dom` docblock; the suite's
default environment is `node` and there is no `vitest.config.ts` in this project.
