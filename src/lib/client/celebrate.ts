import { prefersReducedMotion } from "./motion";

import type { ConfettiOptions } from "@tsparticles/confetti";
import type { RibbonsOptions } from "@tsparticles/ribbons";

/**
 * The confetti at the final result (this change, phase 5).
 *
 * **Two libraries, because the effect is two libraries.** `confetti.js.org`'s "Confetti +
 * Ribbons" sample calls `confetti()` and `ribbons()` — the second is a separate package
 * (`ribbons.js.org`) and not a mode of the first. The recipe below is that sample's timing
 * and shape, kept deliberately close to it: a 6-second window, a confetti burst every 50 ms
 * from a random point along the top edge, and ribbons starting two seconds in and repeating
 * every two seconds.
 *
 * **The heaviest client dependency in this project, loaded through a dynamic `import()` and
 * never any other way.** Against a rule CLAUDE.md states plainly — the client bundle is kept
 * to essentially the Ably SDK, because the venue network is the one link nobody controls,
 * and FR-002 puts a 30-second target on joining. Four things keep those facts compatible,
 * and all four are load-bearing:
 *
 * - **The imports are dynamic**, so both libraries are their own chunks, requested at the
 *   close and absent from everything an attendee downloads in order to play. The two share
 *   an engine, so the second costs far less than its package size suggests.
 * - **The reduced-motion gate runs before the import**, not through either library's own
 *   `disableForReducedMotion`. A device that asked for less motion should not spend the
 *   bytes at all — and six seconds of full-viewport particles is by some distance the most
 *   motion-sensitive thing this app does.
 * - **A failed import is absorbed and never retried.** The network at the close is the same
 *   network as at the start; a chunk that does not arrive must cost the closing screen
 *   nothing. `player.ts` and `answer.ts` take the same posture toward storage.
 * - **Every timer this module starts can be stopped**, which the published sample does not
 *   bother with because a demo page has no lifecycle. A phone does: 120 confetti calls
 *   queued against a backgrounded tab, or against a session that has been purged, is
 *   exactly the "clock left running over a session that no longer exists" defect
 *   `countdown.ts` was extracted to fix.
 *
 * `canvas-confetti` — 90 KB, no dependencies — was offered and declined, because it cannot
 * do the ribbons half. See `motion-contract.md` before revisiting that.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`), and
 * does not: it takes a string and paints over the whole viewport.
 */

type ConfettiFire = (options: ConfettiOptions) => Promise<unknown>;
type RibbonsFire = (options: RibbonsOptions) => Promise<unknown>;

/** Both halves of the effect, resolved together so a partial load never half-fires. */
export type CelebrationEffects = {
  readonly confetti: ConfettiFire;
  readonly ribbons: RibbonsFire;
  /**
   * Registers **both** plugin sets on the shared engine, and must finish before either half
   * fires.
   *
   * **This is the whole bug that shipped in the first version of this module, and it is
   * invisible from the outside.** The two packages are separate but they register against
   * one `tsParticles` singleton, and the engine refuses registration once anything has
   * called `load()`: firing confetti first makes the later `ribbons()` throw *"Register
   * plugins can only be done before calling tsParticles.load()"*. With the failure absorbed
   * — which it must be — the screen simply showed confetti and no ribbons, with nothing in
   * the console.
   *
   * It does not reproduce in the published demo, because those are UMD bundles that each
   * carry their own copy of the engine. It only appears once a bundler dedupes them, which
   * is exactly what our build does.
   *
   * Part of this type rather than hidden inside the default loader so the ordering is
   * something a test can hold the module to.
   */
  readonly init: () => Promise<void>;
};

export type CelebrationDeps = {
  /**
   * Loads both libraries. Injected so tests own it — a real dynamic import in a unit test
   * would either pull the whole engine into the suite or fail outright in `node`.
   */
  readonly load?: () => Promise<CelebrationEffects>;
  /** Injected for the same reason. Defaults to the project's single gate. */
  readonly reducedMotion?: () => boolean;
};

export type Celebration = {
  /**
   * Runs the celebration, at most once per `signature`.
   *
   * **Idempotent per signature, and that is the whole reason this is a handle rather than a
   * function.** The attendee view re-renders on every snapshot, every fallback poll tick and
   * every connection flap, and the closing screen stays up for as long as the host leaves it
   * — a bare call in that branch would restart the effect for minutes.
   *
   * Never throws, and returns nothing to await: a render is the caller, and this is
   * decoration over a screen that must paint whatever happens here.
   */
  fire(signature: string): void;
  /**
   * Stops every pending burst. Idempotent, and safe when nothing is running.
   *
   * Wired to the page's `pagehide`, beside the countdown's own stop.
   */
  stop(): void;
};

/** How long the whole celebration lasts. From the published sample. */
const CELEBRATION_MS = 6_000;

/** How often a confetti burst goes up, in milliseconds. From the published sample. */
const BURST_EVERY_MS = 50;

/** When ribbons join, and how often they repeat. From the published sample. */
const RIBBONS_AFTER_MS = 2_000;
const RIBBONS_EVERY_MS = 2_000;

/**
 * The palette, and the one place this departs from the published sample.
 *
 * The sample fires gold, hot pink, cyan and orange-red. These are the signage colours —
 * `quiz-chrome`, `quiz-mint`, `quiz-signwhite` and `quiz-signal` from `global.css` — because
 * the closing screen has just inverted its ground to chrome, and confetti in four colours
 * this project does not define would be the one moment the session stops looking like
 * itself. One constant; swap it here if the room disagrees.
 */
const COLORS = ["#ffd400", "#3ddc84", "#f5f5f2", "#e5342a"];

/** One burst, from a random point along the top edge. The sample's numbers. */
function burst(): ConfettiOptions {
  return {
    particleCount: 8,
    angle: 90,
    spread: 70,
    origin: { x: Math.random(), y: 0 },
    gravity: 1.2,
    ticks: 0,
    colors: COLORS,
  };
}

const RIBBONS: RibbonsOptions = { colors: COLORS };

export function createCelebration(deps: CelebrationDeps = {}): Celebration {
  const load =
    deps.load ??
    (async (): Promise<CelebrationEffects> => {
      // Together rather than in sequence: the two share an engine, and a ribbons chunk that
      // arrived after the confetti had finished would be six seconds of nothing followed by
      // ribbons over an empty screen.
      const [confettiModule, ribbonsModule] = await Promise.all([
        import("@tsparticles/confetti"),
        import("@tsparticles/ribbons"),
      ]);
      return {
        confetti: confettiModule.confetti as ConfettiFire,
        ribbons: ribbonsModule.ribbons as RibbonsFire,
        // Both, before either fires. See `CelebrationEffects.init`.
        init: async () => {
          await Promise.all([
            confettiModule.confetti.init(),
            ribbonsModule.ribbons.init(),
          ]);
        },
      };
    });
  const reducedMotion = deps.reducedMotion ?? prefersReducedMotion;

  /**
   * Every signature this handle has already answered — **marked before the import resolves,
   * not after.**
   *
   * A render can land again while the chunk is still downloading on a venue network, and a
   * set written on success would let the second render start a second download and fire a
   * second time. Marked up front, a failure is also never retried, which is the intended
   * posture rather than an oversight: decoration that failed once on this network is not
   * going to succeed by being asked harder.
   */
  const fired = new Set<string>();

  /**
   * Every timer this handle owns, so `stop` can reach all of them.
   *
   * A list rather than three named handles, because the ribbons interval is created inside
   * a timeout and therefore does not exist yet when `stop` may first be called — the shape
   * the sample's `activeIntervals` array has, for the same reason.
   */
  let timers: number[] = [];

  function clearTimers(): void {
    for (const timer of timers) window.clearInterval(timer);
    timers = [];
  }

  /**
   * The sample's sequence, with its timings intact.
   *
   * `window.setInterval` / `window.setTimeout` rather than the bare globals, which is what
   * lets `happy-dom` drive these under fake timers — `countdown.ts` and `toast.ts` both do
   * the same and say so.
   */
  function run(effects: CelebrationEffects): void {
    const endsAt = Date.now() + CELEBRATION_MS;

    const bursts = window.setInterval(() => {
      if (Date.now() >= endsAt) {
        window.clearInterval(bursts);
        return;
      }
      void effects.confetti(burst()).catch(() => {});
    }, BURST_EVERY_MS);
    timers.push(bursts);

    const ribbonsStart = window.setTimeout(() => {
      void effects.ribbons(RIBBONS).catch(() => {});

      const ribbonsEvery = window.setInterval(() => {
        if (Date.now() >= endsAt) {
          window.clearInterval(ribbonsEvery);
          return;
        }
        void effects.ribbons(RIBBONS).catch(() => {});
      }, RIBBONS_EVERY_MS);
      timers.push(ribbonsEvery);
    }, RIBBONS_AFTER_MS);
    // `setTimeout` and `setInterval` share an id space in the browser, and `clearInterval`
    // clears either — so one list and one clear covers both.
    timers.push(ribbonsStart);
  }

  return {
    fire(signature) {
      if (fired.has(signature)) return;
      fired.add(signature);

      // Before the import: a device that asked for less motion spends no bytes either.
      if (reducedMotion()) return;

      void load()
        .then(async (effects) => {
          // Registration before any firing, never interleaved: the first `confetti()` call
          // calls `load()` on the shared engine, and after that the engine refuses to
          // register the ribbons plugins at all.
          await effects.init();
          run(effects);
        })
        .catch(() => {
          // Absorbed. The closing screen is already painted and owes this nothing.
        });
    },

    stop() {
      clearTimers();
    },
  };
}
