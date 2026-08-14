/**
 * The per-question countdown, as a state machine that can actually be tested
 * (roadmap S-11, FR-020).
 *
 * **This module exists because the first version of this logic lived inline in two Astro
 * pages, and both copies shipped a defect a green suite could not see.** An inline
 * `<script>` has no harness, so the only available guard was a source-text scan — and a
 * scan cannot execute a timer. One page recursed without bound the moment a clock reached
 * zero; the other left a clock running over a session that no longer existed. Both were
 * found by review rather than by the 1276 tests that passed over them, and *both guards
 * written to prevent them certified them instead*.
 *
 * The extraction is the fix for that class. `createFallbackPoll` in `session.ts` is the
 * same shape and is thoroughly covered, so the pattern is already proven here.
 *
 * **The structural rule that keeps the recursion gone:** `start` never calls `onExpire`.
 * A window that is *already* closed is reported by its return value, so the caller — which
 * is itself running inside a render — decides what to do, synchronously and without
 * re-entering anything. Only `tick`, firing from a timer with an empty stack beneath it,
 * calls `onExpire`, and only once. `countdown.test.ts` asserts both directions.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`), and
 * does not: it takes numbers and hands back numbers.
 */

export type CountdownDeps = {
  /**
   * Paints the clock. Called on every arm and every tick, including the final one at or
   * below zero, so the display reaches zero rather than stopping a second short.
   */
  readonly onPaint: (remainingMs: number, limitMs: number) => void;
  /**
   * The window closed **while this countdown was running**. Called at most once per
   * `start`, from the tick and never from `start` itself.
   *
   * Omit it where reaching zero changes nothing on screen — the projector simply stops,
   * because the host owns every transition and nothing may move on a clock.
   */
  readonly onExpire?: () => void;
  /** Injected so tests own the clock. Defaults to the wall clock. */
  readonly now?: () => number;
};

export type Countdown = {
  /**
   * Arms the clock for one question and reports whether its window has **already** closed.
   *
   * `limitSeconds` of `undefined` is a question with no clock — the two unscored ones —
   * and is never closed. Any previously running clock is dropped first, so a caller cannot
   * accidentally leave two running.
   */
  start(openedAt: number, limitSeconds: number | undefined): boolean;
  /** Drops the clock. Idempotent, and safe to call when nothing is running. */
  stop(): void;
  /** Whether a tick is currently armed. For tests and for guards. */
  isRunning(): boolean;
};

export function createCountdown(deps: CountdownDeps): Countdown {
  const now = deps.now ?? (() => Date.now());

  let timer: number | null = null;
  let deadline = 0;
  let limitMs = 0;

  function clear(): void {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  /**
   * Lands on the next whole second rather than a fixed 1000 ms, so the digits change when
   * the number changes instead of drifting a few hundred milliseconds per tick.
   */
  function arm(remaining: number): void {
    timer = window.setTimeout(tick, remaining % 1_000 || 1_000);
  }

  function tick(): void {
    timer = null;

    // Recomputed from the clock rather than decremented: a browser throttles timers in a
    // hidden tab, so a counter that subtracted a second per tick would come back minutes
    // fast. This also means one long jump in time lands on the right number in one paint
    // instead of catching up over many.
    const remaining = deadline - now();
    deps.onPaint(remaining, limitMs);

    if (remaining <= 0) {
      deps.onExpire?.();
      return;
    }

    arm(remaining);
  }

  return {
    start(openedAt, limitSeconds) {
      clear();

      if (limitSeconds === undefined) return false;
      // A nonsense open time means we cannot say anything about the window. Fail toward
      // *not* closed: the server is the authority either way, and locking a room out on a
      // bad timestamp is the worse direction — the same reasoning `deadline.ts` records
      // for its own degenerate inputs.
      if (!Number.isFinite(openedAt) || openedAt <= 0) return false;
      if (!Number.isFinite(limitSeconds) || limitSeconds <= 0) return false;

      limitMs = limitSeconds * 1_000;
      deadline = openedAt + limitMs;

      const remaining = deadline - now();
      deps.onPaint(remaining, limitMs);

      // Already over. Paint the zero, arm nothing, and tell the caller — which is inside a
      // render and must not be re-entered. See the module docstring.
      if (remaining <= 0) return true;

      arm(remaining);
      return false;
    },

    stop() {
      clear();
    },

    isRunning() {
      return timer !== null;
    },
  };
}
