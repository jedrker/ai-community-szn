// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCelebration, type CelebrationEffects } from "./celebrate";

/**
 * The closing confetti (this change, phase 5).
 *
 * What is under test is everything *except* how it looks: that it fires once and not per
 * render, that the published sample's sequence is actually what runs, that a device asking
 * for reduced motion never even downloads the libraries, that a chunk which fails to arrive
 * costs the closing screen nothing, and that every timer it starts can be stopped.
 *
 * The loader is injected, so no test here pulls the tsParticles engine into the suite — the
 * real dynamic import is exercised only by `bun run build`. Timers are faked, which works
 * because the module calls `window.setInterval` / `window.setTimeout` rather than the bare
 * globals, exactly as `countdown.ts` and `toast.ts` do.
 */

describe("createCelebration", () => {
  beforeEach(() => {
    // `setImmediate` is deliberately left real: the unhandled-rejection check below needs a
    // macrotask turn that the fake clock is not driving, and faking it deadlocks the flush.
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "Date",
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function stub() {
    // The parameter is declared so `mock.calls` carries it — the origin assertion below
    // reads it, and a bare `vi.fn(() => …)` types the calls as an empty tuple.
    const confetti = vi.fn((_options: { origin: { x: number; y: number } }) =>
      Promise.resolve(undefined),
    );
    const ribbons = vi.fn((_options: unknown) => Promise.resolve(undefined));
    const init = vi.fn(() => Promise.resolve());
    const load = vi.fn(() =>
      Promise.resolve({
        confetti,
        ribbons,
        init,
      } as unknown as CelebrationEffects),
    );
    return { confetti, ribbons, init, load };
  }

  /** Lets the injected loader's promise settle without advancing the fake clock. */
  async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }

  describe("the published sequence", () => {
    it("bursts confetti every 50ms and starts ribbons two seconds in", async () => {
      const { load, confetti, ribbons } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();

      // Nothing has been fired yet: the first burst is one interval away, not immediate.
      expect(confetti).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(500);
      expect(confetti).toHaveBeenCalledTimes(10);
      // Ribbons wait their two seconds — the sample's shape, and the reason the effect
      // reads as building rather than as one dump.
      expect(ribbons).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1_500);
      expect(ribbons).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(ribbons).toHaveBeenCalledTimes(2);
    });

    it("stops on its own after six seconds", async () => {
      const { load, confetti, ribbons } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(6_000);

      const burstsAtEnd = confetti.mock.calls.length;
      const ribbonsAtEnd = ribbons.mock.calls.length;

      // A celebration that never ended would keep painting over the closing screen for as
      // long as the host left it up.
      await vi.advanceTimersByTimeAsync(30_000);

      expect(confetti).toHaveBeenCalledTimes(burstsAtEnd);
      expect(ribbons).toHaveBeenCalledTimes(ribbonsAtEnd);
    });

    it("fires each burst from a fresh point along the top edge", async () => {
      const { load, confetti } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(500);

      const origins = confetti.mock.calls.map(([options]) => options.origin);
      expect(origins.every((origin) => origin.y === 0)).toBe(true);
      // Ten bursts from one x would be a column, not a curtain.
      expect(new Set(origins.map((origin) => origin.x)).size).toBeGreaterThan(
        1,
      );
    });
  });

  describe("the shared engine", () => {
    it("registers both plugin sets before either half fires", async () => {
      const order: string[] = [];
      const confetti = vi.fn(
        (_options: { origin: { x: number; y: number } }) => {
          order.push("confetti");
          return Promise.resolve(undefined);
        },
      );
      const ribbons = vi.fn((_options: unknown) => {
        order.push("ribbons");
        return Promise.resolve(undefined);
      });
      const init = vi.fn(() => {
        order.push("init");
        return Promise.resolve();
      });
      const load = vi.fn(() =>
        Promise.resolve({
          confetti,
          ribbons,
          init,
        } as unknown as CelebrationEffects),
      );

      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });
      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(3_000);

      // THE BUG THIS FILE EXISTS FOR. The two packages register against one `tsParticles`
      // singleton, and the engine refuses registration once anything has called `load()` —
      // so a confetti burst fired before init makes every later `ribbons()` throw
      // "Register plugins can only be done before calling tsParticles.load()". Absorbed, as
      // it must be, that reads on screen as confetti with no ribbons and a clean console.
      expect(init).toHaveBeenCalledTimes(1);
      expect(order[0]).toBe("init");
      expect(order).toContain("ribbons");
    });

    it("fires nothing at all if registration fails", async () => {
      const { confetti, ribbons } = stub();
      const init = vi.fn(() =>
        Promise.reject(new Error("engine already loaded")),
      );
      const load = vi.fn(() =>
        Promise.resolve({
          confetti,
          ribbons,
          init,
        } as unknown as CelebrationEffects),
      );

      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });
      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(6_000);

      // Half an effect is worse than none: confetti alone is what the bug looked like.
      expect(confetti).not.toHaveBeenCalled();
      expect(ribbons).not.toHaveBeenCalled();
    });
  });

  describe("firing once", () => {
    it("does not restart for the same signature", async () => {
      const { load, confetti } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(500);
      const after = confetti.mock.calls.length;

      // The closing screen stays up for minutes, and `render()` runs again on every
      // snapshot, every fallback poll and every connection flap.
      celebration.fire("ended|Ania");
      celebration.fire("ended|Ania");
      await settle();

      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(100);
      // Still one sequence: the count moved by one interval's worth, not two.
      expect(confetti.mock.calls.length).toBe(after + 2);
    });

    it("does not start a second download while the first is still in flight", () => {
      let release: ((effects: CelebrationEffects) => void) | undefined;
      const load = vi.fn(
        () =>
          new Promise<CelebrationEffects>((resolve) => {
            release = resolve;
          }),
      );
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      // A re-render landing while the chunk is still on the wire. Marking the signature only
      // on success would let this one start a second download and run the sequence twice.
      celebration.fire("ended|Ania");

      expect(load).toHaveBeenCalledTimes(1);
      release?.({
        confetti: () => Promise.resolve(undefined),
        ribbons: () => Promise.resolve(undefined),
      } as unknown as CelebrationEffects);
    });

    it("fires again for a different signature", async () => {
      const { load } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();

      // A second session in the same tab is a second close, not the first one still ending.
      celebration.fire("ended|Bartek");
      await settle();

      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe("stopping", () => {
    it("clears every pending burst, including the ribbons interval", async () => {
      const { load, confetti, ribbons } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();
      // Past the ribbons start, so the interval created *inside* the timeout exists — the
      // one a named-handle implementation forgets, because it does not exist yet when the
      // handle is assigned.
      await vi.advanceTimersByTimeAsync(2_500);

      const burstsAtStop = confetti.mock.calls.length;
      const ribbonsAtStop = ribbons.mock.calls.length;

      celebration.stop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(confetti).toHaveBeenCalledTimes(burstsAtStop);
      expect(ribbons).toHaveBeenCalledTimes(ribbonsAtStop);
    });

    it("stops the ribbons that have not started yet", async () => {
      const { load, ribbons } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await settle();
      // Stopped inside the two-second gap, so the pending timeout is the only thing holding
      // ribbons. A stop that only cleared intervals would let them start anyway.
      await vi.advanceTimersByTimeAsync(500);
      celebration.stop();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(ribbons).not.toHaveBeenCalled();
    });

    it("is safe when nothing is running", () => {
      const { load } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      expect(() => {
        celebration.stop();
        celebration.stop();
      }).not.toThrow();
    });
  });

  describe("the devices that get nothing", () => {
    it("downloads nothing at all under reduced motion", async () => {
      const { load, confetti, ribbons } = stub();
      const celebration = createCelebration({
        load,
        reducedMotion: () => true,
      });

      celebration.fire("ended|Ania");
      await settle();
      await vi.advanceTimersByTimeAsync(6_000);

      // The gate runs *before* the import: a device that asked for less motion should not
      // spend the bytes either. Checking `load` rather than the effects is the whole point —
      // both libraries' own `disableForReducedMotion` would have paid for the download first.
      expect(load).not.toHaveBeenCalled();
      expect(confetti).not.toHaveBeenCalled();
      expect(ribbons).not.toHaveBeenCalled();
    });
  });

  describe("failure", () => {
    /**
     * Runs `body` and reports any rejection that nothing handled.
     *
     * **Asserting `fire()` does not throw is not enough**, and that gap was live until it
     * was checked: the failure path is asynchronous, so a `fire()` with its `.catch` deleted
     * still returns cleanly and the test still passed — while every failed close left an
     * unhandled rejection in the console.
     */
    async function unhandledDuring(body: () => void): Promise<unknown[]> {
      const rejections: unknown[] = [];
      const onRejection = (reason: unknown): void => {
        rejections.push(reason);
      };
      process.on("unhandledRejection", onRejection);
      try {
        body();
        await vi.advanceTimersByTimeAsync(0);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      } finally {
        process.off("unhandledRejection", onRejection);
      }
      return rejections;
    }

    it("absorbs chunks that never arrive", async () => {
      const load = vi.fn(() => Promise.reject(new Error("offline")));
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      // The network at the close is the same network as at the start. A rejected import must
      // reach nothing — not the render that called this, and not the console.
      const rejections = await unhandledDuring(() => {
        expect(() => celebration.fire("ended|Ania")).not.toThrow();
      });

      expect(load).toHaveBeenCalledTimes(1);
      expect(rejections).toEqual([]);
    });

    it("absorbs a burst that throws", async () => {
      const confetti = vi.fn(() => Promise.reject(new Error("no canvas")));
      const ribbons = vi.fn(() => Promise.resolve(undefined));
      const init = vi.fn(() => Promise.resolve());
      const load = vi.fn(() =>
        Promise.resolve({
          confetti,
          ribbons,
          init,
        } as unknown as CelebrationEffects),
      );
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      const rejections = await unhandledDuring(() => {
        celebration.fire("ended|Ania");
      });
      // Two hops now, not one: the loader resolves, then registration is awaited before any
      // timer is armed. See `CelebrationEffects.init`.
      await settle();
      await vi.advanceTimersByTimeAsync(200);
      await new Promise((resolve) => setImmediate(resolve));

      expect(confetti).toHaveBeenCalled();
      expect(rejections).toEqual([]);
    });

    it("does not retry a failure on the next render", async () => {
      const load = vi.fn(() => Promise.reject(new Error("offline")));
      const celebration = createCelebration({
        load,
        reducedMotion: () => false,
      });

      celebration.fire("ended|Ania");
      await vi.advanceTimersByTimeAsync(0);

      celebration.fire("ended|Ania");

      // Decoration that failed once on this network will not succeed by being asked harder,
      // and the closing screen re-renders often enough to make retrying expensive.
      expect(load).toHaveBeenCalledTimes(1);
    });
  });
});
