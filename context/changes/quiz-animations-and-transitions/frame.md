# Frame Brief: Quiz animations and transitions

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

"quiz animations and transitions" — an open-ended scope question about how the two
LiveQuiz views (`/quiz/host` on the projector, `/quiz` on the phone) move between
session beats. No incident, no reproduction: the views feel static for a live event.

## Initial Framing (preserved)

- **User's stated cause or approach**: none given. The observation and the direction
  arrived as one word-pair; no cause was proposed.
- **User's proposed direction**: none given — implicitly "add animations".
- **Pre-dispatch narrowing**: open-ended polish (not an observed incident); **both**
  surfaces equally; **all** beats, not narrowed. Follow-up narrowing: motion should do
  **both** continuity/legibility *and* event energy ("they don't conflict"), and the
  attendee phone "feels dead too" — which is a deliberate reversal of the existing
  projector-only position at `render.ts:302`, not an oversight.

## Dimension Map

The felt staticness could originate at any of these dimensions:

1. **No motion at all exists** — the naive reading: nothing moves, so add effects.
2. **Motion exists but is not systematized** — one call site owns every hard-won rule
   (reduced-motion, cancel-in-flight, don't-replay), and nothing else can reuse it.
   ← where the evidence lands
3. **The render cadence forbids naive motion** — `render()` runs on *every* applied
   snapshot and every fallback poll, and every renderer wipes its container.
4. **The beat-swap primitive is structurally un-animatable** — phase changes are
   `setHidden` toggles, and `hidden` is `display:none !important`.
5. **Motion was rejected on principle by a prior slice** — i.e. the framing is
   re-opening a settled decision.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. No motion exists | False. `render.ts:522` counts distribution bars up over `COUNT_UP_MS` = 900 (`render.ts:334`) on ease-out cubic (`render.ts:337`); both countdown bars use `transition-[width] duration-1000` (`host.astro:721`, `index.astro:258`). | **NONE** |
| 2. Motion is not systematized | Strong. `prefersReducedMotion` exists once, at `render.ts:370`, honoured by exactly one caller; no `motion-safe:`/`motion-reduce:` Tailwind variants anywhere in `src/`; the in-flight cancel (`countUpFrames`, `render.ts:357`) and the re-render guard (`countUpSignatures`, `render.ts:368`) are private to one function. Every rule a second effect needs already exists — and is unreachable. | **STRONG** |
| 3. Render cadence forbids naive motion | Strong, and already cost someone a fix. `render()` runs per applied snapshot (`index.astro:190`, `host.astro:2218`); all four renderers call `replaceChildren()` (`render.ts:186, 425, 620, 776`). `render.ts:360` names the failure verbatim: *"a dropped Ably message replaying the same state would reset all eight bars to zero in front of the room."* Any entrance effect not keyed by a signature reproduces this. | **STRONG** |
| 4. Beat swaps are un-animatable as built | Strong. ~30 `setHidden` call sites across the two views (`host.astro:1616–2422`, `index.astro:581–806`); CLAUDE.md records that `hidden` wins over Tailwind `flex` only because preflight carries `[hidden] { display: none !important }` — so an element cannot be transitioned *out*, it leaves layout on the frame. Cross-beat motion needs a different primitive, not a CSS class on the existing one. | **STRONG** |
| 5. Prior slice rejected motion | False — **deferred twice, never decided.** `leaderboard-contract.md:100` scope boundary: *"animation and rank-change indicators"*. `winner-reveal-contract.md:73`: *"a staged 3 → 2 → 1 reveal, any animation"*. Both list it as out of scope for that slice, neither argues against it. This change is the follow-up they handed forward. | **NONE** |

## Narrowing Signals

- Motion's purpose is **both** continuity and energy — so this cannot be planned as a
  single effect budget. Continuity is a per-beat property of the render path; energy is
  two or three authored moments (reveal, winner). They share a mechanism, not a scope.
- The phone is **in scope by decision**, reversing `render.ts:302` (*"Opt-in, and only
  the projector opts in"*). That line must be amended, not quietly contradicted — the
  reasoning it carries (the animation is decoration, never the data) still binds.
- Prior art cuts the opposite way from what "add animations" suggests: the signage
  redesign *removed* motion, and `rail-empty-at-reveal/reviews/impl-review.md:65` calls
  a column that appears and folds *"the kind of motion the redesign spent effort
  removing."* **Incidental motion is a defect here; authored motion is the ask.** A plan
  that does not separate the two will be read as reopening a closed decision.

## Cross-System Convention

This project's convention for a rule with more than one reader is already established
and is the whole shape of the answer: extract it to `src/lib/client/` as a tested module
(`countdown.ts`, `toast.ts`, `controls.ts` all arrived this way), never inline in a view.
Two structural guards enforce it — `index.test.ts:102` asserts the attendee page contains
**zero** `setTimeout`, and `host.test.ts:149` asserts exactly one timer whose callback can
fetch (a painting timer is explicitly permitted; a fetching one is not). `render.ts`'s
count-up uses `requestAnimationFrame`, which is the proven path through both guards. The
leading hypothesis matches the convention exactly.

## Reframed Problem Statement

> **The actual problem to plan around is**: the quiz has motion but no *motion system* —
> every rule that makes motion safe here (reduced-motion, cancel-in-flight, don't replay
> on an unchanged re-render) is locked inside one function, and the two primitives the
> beats are built on — `replaceChildren()` per snapshot and `hidden` as
> `display:none !important` — actively defeat the naive way of adding more.

"Add animations and transitions" as stated would produce effects that replay on every
dropped-message re-render and fallback poll, in front of the room, and that cannot fade
out because the element they live in vanishes on the frame it is hidden. Addressed at the
right level instead, this is one small shared client module carrying the three rules
`render.ts` already proved, plus a decision about which beats are *continuity* (cheap,
everywhere, incidental-motion-free) and which are *authored moments* (reveal, winner —
where the energy is spent). The phone comes into scope by explicit reversal of the
projector-only rule, and `render.ts:302` gets amended in the same change rather than left
asserting the old position.

## Confidence

**HIGH** — every dimension is backed by file:line evidence in this project; the two
hypotheses that would have invalidated the change (motion doesn't exist / motion was
rejected) are both disproved by direct quotation; the leading hypothesis matches an
established convention with two structural guards already pointing at it. The one
genuinely open item was a design position (phone in or out), and the user decided it.

## What Changes for /10x-plan

Plan a **motion layer plus the beats it serves**, not a list of effects: a tested
`src/lib/client/` module exposing the reduced-motion gate, the in-flight cancel and the
re-render signature that `render.ts` currently keeps private, then apply it beat by beat
with continuity and authored-moment treated as separate budgets. Per `lessons.md`
("The CLAUDE.md edit is part of the slice"), the docs phase must list CLAUDE.md — the
projector-only claim and the "no framework / hand-written DOM" section both need
amending — alongside `render.ts:302`'s own docblock.

## References

- Source: `src/lib/client/render.ts:302, 334, 337, 357, 368, 370, 522`; `src/pages/quiz/host.astro:721, 1616–2422, 2218, 2611`; `src/pages/quiz/index.astro:190, 258, 581–806`
- Guards: `src/pages/quiz/index.test.ts:102`; `src/pages/quiz/host.test.ts:149`
- Prior decisions: `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md:100`; `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md:73`; `context/archive/2026-08-15-rail-empty-at-reveal/reviews/impl-review.md:65`
- Investigation: run inline (no sub-agents dispatched — standing session instruction)
