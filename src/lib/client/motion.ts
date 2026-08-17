/**
 * The rules that make an animation safe in this project, in one place.
 *
 * **This module exists because all three of them were private to one function.**
 * `renderDistribution`'s count-up learned each of them the hard way — a reveal that reset
 * to zero when a dropped Ably message replayed the same state, a re-render leaving two
 * loops writing the same nodes, a device asking for reduced motion and getting an
 * animation anyway — and every one of those lessons was reachable only from inside that
 * function. A second animation written anywhere else would have had to rediscover them,
 * and the first two are invisible on a green suite: they only show up in front of a room.
 *
 * **rAF, never CSS transitions or the Web Animations API.** Not a stylistic preference —
 * `happy-dom` implements no animation engine, exposes no `Element.animate`, and never
 * dispatches `transitionend`, so motion built on either is untestable here and would fall
 * back to the source-text scan `countdown.ts` records as having *certified the defect
 * instead*. A CSS transition declared in markup is still fine where nothing depends on it
 * (the countdown bar is one); this module is for motion whose correctness matters.
 *
 * **Entrance only.** Nothing here defers a hide. `setHidden` writes the `hidden` property,
 * which Tailwind's preflight makes `display: none !important`, so an element cannot be
 * transitioned out — and `host.astro`'s `syncRail` derives the rail's visibility from its
 * sections' *live* `hidden` state, so a hide that waited for an animation would leave an
 * empty column beside the stage. Both are load-bearing; see `motion-contract.md`.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`), and
 * does not: it takes elements and numbers, and paints through a callback the caller owns.
 */

/**
 * What the caller wants animated, and how to tell whether it changed.
 *
 * `paint` is the whole interface to the DOM: this module never touches a node itself, so
 * what a beat looks like stays with the renderer that owns it, and what is *safe* stays
 * here.
 */
export type MotionSpec = {
  /**
   * Identifies what is being painted, so **an unchanged thing is not re-animated**.
   *
   * Both views re-render far more often than they change: the host on every snapshot and
   * every fallback poll tick, the attendee on nine triggers including every connection
   * flap. Without this, a replayed snapshot restarts every animation on screen — which is
   * exactly what a dropped message on a venue network produces.
   *
   * Key it by what was actually drawn, never by the render. A question id alone is too
   * coarse for a chart whose numbers move within one question; the drawn figures are what
   * `renderDistribution` keys on for that reason.
   */
  readonly signature: string;
  /** How long the animation runs. Spent once per change, not once per render. */
  readonly durationMs: number;
  /**
   * Writes the animated state at `progress`, where 1 is the true, final state.
   *
   * **Called with exactly 1 whenever the animation does not run** — an unchanged
   * signature, an opt-out, reduced motion, no `requestAnimationFrame` — so a caller can
   * paint through this unconditionally and never has a separate static path that might
   * format differently. It is also called with 1 by the loop's last step rather than by
   * the clock happening to land there: a dropped frame must not leave a beat short.
   */
  readonly paint: (progress: number) => void;
  /** Defaults to `easeOut`. */
  readonly ease?: (t: number) => number;
  /**
   * Whether the caller wants motion at all. Defaults to `true`.
   *
   * Opt-out rather than opt-in *here*, while the render functions above this module stay
   * opt-in: a caller that reached for `runMotion` has already decided, and the surfaces
   * that must not animate simply do not call it. Passing `false` still records the
   * signature, so a later render that does want motion does not treat an unchanged thing
   * as new.
   */
  readonly enabled?: boolean;
};

/**
 * The frame in flight for a container, so a re-render cancels it rather than leaving two
 * loops writing the same nodes.
 *
 * Typed by what `requestAnimationFrame` actually returns rather than as `number`: under
 * `happy-dom` it is a `NodeJS.Immediate`, because that environment mocks animation frames
 * over `setImmediate`. The value is opaque to us either way — it only ever goes back into
 * `cancelAnimationFrame`.
 */
const frames = new WeakMap<
  HTMLElement,
  ReturnType<typeof requestAnimationFrame>
>();

/** What was last painted into a container. See `MotionSpec.signature`. */
const signatures = new WeakMap<HTMLElement, string>();

/** Ease-out cubic: fast off the mark, settling onto the true state rather than snapping to it. */
export function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

/**
 * Whether this device has asked for less motion.
 *
 * Guarded twice on purpose: `typeof window` for the server, where these modules are
 * imported but never run, and the optional call for an environment whose `window` carries
 * no `matchMedia`. A device that asks for reduced motion gets every final state
 * immediately — the animation is the decoration, never the data.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  );
}

/**
 * Stops whatever was animating into this container, without forgetting what it drew.
 *
 * Call it **before** the early returns of a render, not after: a container that empties
 * must take its animation with it, or the loop keeps writing into nodes that have already
 * been detached.
 *
 * Idempotent, and safe when nothing is running.
 */
export function cancelMotion(container: HTMLElement): void {
  const inFlight = frames.get(container);
  if (inFlight === undefined) return;

  frames.delete(container);
  // Guarded because `runMotion` will animate only where `requestAnimationFrame` exists,
  // but a handle can outlive a stubbed environment losing its counterpart mid-test.
  if (typeof cancelAnimationFrame === "function")
    cancelAnimationFrame(inFlight);
}

/**
 * Drops what a container last drew, so the next paint counts as a change.
 *
 * The case it exists for: a beat that goes away and comes back with the same content. The
 * reveal's chart cleared by the next question opening is one — coming back to the same
 * figures later is a new reveal, not a re-render of the old one, and without this it would
 * arrive already-final and silent.
 */
export function forgetMotion(container: HTMLElement): void {
  signatures.delete(container);
}

/**
 * Runs one animation for a container, or paints its final state — deciding which.
 *
 * The order of the checks is the contract:
 *
 * 1. Any frame in flight for this container is cancelled. Two loops writing the same nodes
 *    is the failure, and it is silent — the numbers just fight.
 * 2. The signature is recorded, whatever happens next, so an opt-out render still counts as
 *    having drawn this thing.
 * 3. `paint(1)` and return, unless *all* of: the caller opted in, the signature changed,
 *    `requestAnimationFrame` exists, and this device has not asked for reduced motion.
 * 4. Otherwise `paint(0)` **synchronously**, then drive the loop. Synchronously matters:
 *    the caller is expected to attach its nodes after this returns, so the first frame the
 *    room sees is the start of the animation rather than a flash of the final state.
 *
 * Never calls back on completion. The rule `countdown.ts` states for its own arming call
 * holds here too — a caller is usually inside a render, and re-entering one from an
 * animation is how a paint turns into a loop.
 */
export function runMotion(container: HTMLElement, spec: MotionSpec): void {
  cancelMotion(container);

  const changed = signatures.get(container) !== spec.signature;
  signatures.set(container, spec.signature);

  const animate =
    spec.enabled !== false &&
    changed &&
    spec.durationMs > 0 &&
    typeof requestAnimationFrame === "function" &&
    !prefersReducedMotion();

  if (!animate) {
    spec.paint(1);
    return;
  }

  const ease = spec.ease ?? easeOut;
  spec.paint(0);

  // The rAF timestamp is the clock, so nothing here reads `Date.now`.
  let started: number | null = null;

  const step = (now: number): void => {
    started ??= now;
    const progress = Math.min((now - started) / spec.durationMs, 1);

    if (progress >= 1) {
      // The true state is written by the end of the loop, never by the last tick happening
      // to land on 1 — a dropped frame must not leave a beat short.
      frames.delete(container);
      spec.paint(1);
      return;
    }

    spec.paint(ease(progress));
    frames.set(container, requestAnimationFrame(step));
  };

  frames.set(container, requestAnimationFrame(step));
}

/**
 * One element's own progress within a staggered group.
 *
 * **Offsets inside one animation, never one timer per element.** A stagger built from
 * `setTimeout` would be a second timer on a page whose structural guards pin the number of
 * them — `[slug].test.ts` allows the attendee page exactly zero, and `host/[slug].test.ts` allows
 * one — and it would need its own cancellation to stay honest with `cancelMotion`. Here
 * the whole group is one rAF loop and the arithmetic is what separates the elements.
 *
 * `spread` is the fraction of the run given over to offsets: at 0 everything moves
 * together, at 0.5 the last element starts halfway through. The last element still lands
 * exactly at 1, so the group finishes when the animation does — a stagger must not extend
 * the beat past the duration the caller budgeted.
 *
 * Progress is clamped to `[0, 1]`, so an element whose window has not opened yet reads 0
 * rather than a negative number a caller would have to remember to guard.
 */
export function staggeredProgress(
  progress: number,
  index: number,
  count: number,
  spread: number,
): number {
  if (count <= 1 || spread <= 0) return progress;

  // Exactly, rather than by arithmetic that lands a rounding error short: the last
  // element's offset divided by its window comes out `0.9999999999999998` in binary, and
  // an entrance that stops a hair before its final state leaves an option list permanently
  // dimmed. Same rule the driver states for its own last frame.
  if (progress >= 1) return 1;

  const clampedSpread = Math.min(spread, 1);
  const offset = (clampedSpread * Math.min(index, count - 1)) / (count - 1);
  const window = 1 - clampedSpread;

  // A spread of exactly 1 leaves no window: every element is a step change at its own
  // offset. Reported as done at or past the offset rather than dividing by zero.
  if (window <= 0) return progress >= offset ? 1 : 0;

  return Math.max(0, Math.min((progress - offset) / window, 1));
}
