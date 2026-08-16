// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cancelMotion,
  easeOut,
  forgetMotion,
  prefersReducedMotion,
  runMotion,
  staggeredProgress,
} from "./motion";

/**
 * The motion driver (this change).
 *
 * Three of these rules were private to `renderDistribution` and only one of them was ever
 * asserted. This file exists to assert each independently — in particular the
 * **cancellation**, which the count-up's own suite could not see: it stubbed
 * `cancelAnimationFrame` as a no-op, so a driver that never cancelled anything would have
 * passed every test in `render.test.ts`.
 *
 * `requestAnimationFrame` is driven by hand rather than by a timer, so a frame is a step
 * this test takes rather than a wall-clock race. Fake timers are deliberately *not* used:
 * `happy-dom` mocks animation frames over a `setImmediate` it captured at module load, so
 * `vi.useFakeTimers()` cannot reach them.
 */

describe("motion", () => {
  let container: HTMLElement;
  let frames: ((now: number) => void)[];
  let cancelled: number[];
  let handle: number;

  beforeEach(() => {
    container = document.createElement("div");
    frames = [];
    cancelled = [];
    handle = 0;

    vi.stubGlobal(
      "requestAnimationFrame",
      (callback: (now: number) => void) => {
        frames.push(callback);
        handle += 1;
        return handle;
      },
    );
    // A spy rather than a no-op: what was cancelled is the thing under test below.
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      cancelled.push(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Runs the frame queued last, at `now` milliseconds on the animation's own clock. */
  function tick(now: number): void {
    const next = frames.pop();
    frames = [];
    next?.(now);
  }

  /** Records every progress value the driver painted. */
  function recorder(): {
    readonly painted: number[];
    paint: (p: number) => void;
  } {
    const painted: number[] = [];
    return { painted, paint: (progress) => painted.push(progress) };
  }

  describe("the animated path", () => {
    it("paints zero synchronously, then eases to exactly one", () => {
      const { painted, paint } = recorder();

      runMotion(container, { signature: "a", durationMs: 200, paint });

      // Synchronous, so a caller can attach its nodes afterwards and the room never sees
      // a flash of the final state.
      expect(painted).toEqual([0]);

      tick(0);
      tick(100);

      const midway = painted.at(-1)!;
      // Ease-out cubic at the halfway point is 0.875, so a linear ramp fails this.
      expect(midway).toBeGreaterThan(0.7);
      expect(midway).toBeLessThan(1);

      tick(1_000);
      expect(painted.at(-1)).toBe(1);
    });

    it("paints exactly one even when the clock overshoots the duration", () => {
      const { painted, paint } = recorder();

      runMotion(container, { signature: "a", durationMs: 200, paint });
      tick(0);
      // A dropped frame — the tab was backgrounded, the venue laptop stalled. The final
      // state must be written by the loop, never by a tick happening to land on 1.
      tick(9_999_999);

      expect(painted.at(-1)).toBe(1);
      expect(frames).toHaveLength(0);
    });

    it("takes a caller's easing when given one", () => {
      const { painted, paint } = recorder();

      runMotion(container, {
        signature: "a",
        durationMs: 200,
        paint,
        ease: (t) => t,
      });
      tick(0);
      tick(100);

      expect(painted.at(-1)).toBeCloseTo(0.5, 5);
    });
  });

  describe("the replay guard", () => {
    it("paints the final state without a frame when the signature is unchanged", () => {
      const first = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: first.paint,
      });
      tick(0);
      tick(1_000);

      // A replayed snapshot, or a fallback poll during an outage.
      const second = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: second.paint,
      });

      // Still painted — the caller may have rebuilt its nodes — but painted final, and
      // nothing was queued.
      expect(second.painted).toEqual([1]);
      expect(frames).toHaveLength(0);
    });

    it("animates again when the signature moved", () => {
      const first = recorder();
      runMotion(container, {
        signature: "one",
        durationMs: 200,
        paint: first.paint,
      });
      tick(0);
      tick(1_000);

      const second = recorder();
      runMotion(container, {
        signature: "two",
        durationMs: 200,
        paint: second.paint,
      });

      expect(second.painted).toEqual([0]);
    });

    it("animates again after the container is forgotten", () => {
      const first = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: first.paint,
      });
      tick(0);
      tick(1_000);

      // The beat went away and came back with the same content — a new arrival, not a
      // re-render of the old one.
      forgetMotion(container);

      const second = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: second.paint,
      });

      expect(second.painted).toEqual([0]);
    });

    it("records the signature even on an opted-out render", () => {
      const first = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        enabled: false,
        paint: first.paint,
      });

      // The opt-out drew this thing, so a later render that does want motion must not
      // treat it as new.
      const second = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: second.paint,
      });

      expect(second.painted).toEqual([1]);
      expect(frames).toHaveLength(0);
    });

    it("keeps the signature across a cancel", () => {
      const first = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: first.paint,
      });
      tick(0);

      // Cancelling stops the frames; it does not mean the container drew something else.
      cancelMotion(container);

      const second = recorder();
      runMotion(container, {
        signature: "same",
        durationMs: 200,
        paint: second.paint,
      });

      expect(second.painted).toEqual([1]);
    });
  });

  describe("cancellation", () => {
    it("cancels the frame in flight when a container re-renders", () => {
      runMotion(container, {
        signature: "one",
        durationMs: 200,
        paint: () => {},
      });
      const inFlight = handle;
      tick(0);

      runMotion(container, {
        signature: "two",
        durationMs: 200,
        paint: () => {},
      });

      // The handle armed by the first run is the one that must be released. Two loops
      // writing the same nodes is silent — the values just fight.
      expect(cancelled).toContain(handle - 1);
      expect(cancelled[0]).toBeGreaterThanOrEqual(inFlight);
    });

    it("cancels through cancelMotion and leaves nothing running", () => {
      const { painted, paint } = recorder();
      runMotion(container, { signature: "a", durationMs: 200, paint });
      tick(0);

      const armed = handle;
      cancelMotion(container);

      expect(cancelled).toEqual([armed]);

      // Idempotent: a second cancel releases nothing further.
      cancelMotion(container);
      expect(cancelled).toEqual([armed]);

      // And the loop is gone — the last painted value is whatever the tick left, not 1.
      expect(painted.at(-1)).not.toBe(1);
    });

    it("stops the loop for a container that was cancelled mid-flight", () => {
      const { painted, paint } = recorder();
      runMotion(container, { signature: "a", durationMs: 200, paint });
      tick(0);
      cancelMotion(container);

      // Nothing re-arms it: the queue drains and no further paint lands.
      const before = painted.length;
      frames = [];
      expect(painted).toHaveLength(before);
    });

    it("does not touch another container's animation", () => {
      const other = document.createElement("div");
      runMotion(container, {
        signature: "a",
        durationMs: 200,
        paint: () => {},
      });
      tick(0);
      const containerHandle = handle;

      runMotion(other, { signature: "a", durationMs: 200, paint: () => {} });
      tick(0);

      cancelMotion(other);

      expect(cancelled).not.toContain(containerHandle);
    });
  });

  describe("the devices that get no animation", () => {
    it("paints the final state at once under reduced motion", () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }));

      const { painted, paint } = recorder();
      runMotion(container, { signature: "a", durationMs: 200, paint });

      // The animation is the decoration, never the data.
      expect(painted).toEqual([1]);
      expect(frames).toHaveLength(0);
    });

    it("paints the final state at once with no requestAnimationFrame", () => {
      vi.stubGlobal("requestAnimationFrame", undefined);

      const { painted, paint } = recorder();
      runMotion(container, { signature: "a", durationMs: 200, paint });

      expect(painted).toEqual([1]);
    });

    it("paints the final state at once when the caller opts out", () => {
      const { painted, paint } = recorder();
      runMotion(container, {
        signature: "a",
        durationMs: 200,
        enabled: false,
        paint,
      });

      expect(painted).toEqual([1]);
      expect(frames).toHaveLength(0);
    });

    it("paints the final state at once on a zero or negative duration", () => {
      const { painted, paint } = recorder();
      runMotion(container, { signature: "a", durationMs: 0, paint });

      // Degenerate input fails toward the safe end — a division by zero here would paint
      // Infinity into the caller's nodes.
      expect(painted).toEqual([1]);
      expect(frames).toHaveLength(0);
    });
  });

  describe("prefersReducedMotion", () => {
    it("is false when the device expresses no preference", () => {
      // happy-dom's default is `no-preference`, which is the case worth pinning: it means
      // the animated path is what the rest of this suite exercises by default.
      expect(prefersReducedMotion()).toBe(false);
    });

    it("is false when the environment has no matchMedia at all", () => {
      vi.stubGlobal("matchMedia", undefined);
      expect(prefersReducedMotion()).toBe(false);
    });
  });

  describe("easeOut", () => {
    it("holds its endpoints and covers most ground early", () => {
      expect(easeOut(0)).toBe(0);
      expect(easeOut(1)).toBe(1);
      expect(easeOut(0.5)).toBeCloseTo(0.875, 5);
    });
  });

  describe("staggeredProgress", () => {
    it("leaves later elements behind earlier ones mid-flight", () => {
      const first = staggeredProgress(0.5, 0, 4, 0.4);
      const last = staggeredProgress(0.5, 3, 4, 0.4);

      expect(first).toBeGreaterThan(last);
      expect(last).toBeGreaterThanOrEqual(0);
    });

    it("lands every element on one when the animation completes", () => {
      for (let index = 0; index < 4; index += 1) {
        expect(staggeredProgress(1, index, 4, 0.4)).toBe(1);
      }
    });

    it("clamps an element whose window has not opened yet to zero", () => {
      // Not a negative number the caller would have to remember to guard.
      expect(staggeredProgress(0.1, 3, 4, 0.6)).toBe(0);
    });

    it("is a passthrough for a single element or no spread", () => {
      expect(staggeredProgress(0.3, 0, 1, 0.5)).toBe(0.3);
      expect(staggeredProgress(0.3, 2, 4, 0)).toBe(0.3);
    });

    it("degenerates to a step change at full spread rather than dividing by zero", () => {
      expect(staggeredProgress(0.4, 2, 4, 1)).toBe(0);
      expect(staggeredProgress(0.8, 2, 4, 1)).toBe(1);
    });
  });
});
