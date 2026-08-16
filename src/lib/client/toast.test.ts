// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAutoHide } from "./toast";

/**
 * The message bubble's dismissal clock.
 *
 * `happy-dom` for `window.setTimeout`/`clearTimeout`, selected per file by the docblock
 * above; fake timers so one advance is exactly one tick, which `lessons.md` requires of any
 * timing test.
 *
 * These tests exist because this logic cannot be covered where it is used — `host.astro`'s
 * inline script has no harness, and the structural scan that guards that file cannot execute
 * a timer. Every rule the module's docstring states is asserted here, including the two that
 * look like edge cases and are the ones a live session would meet: a burst of messages, and
 * a duration that is not a number.
 */

const DEFAULT_MS = 4_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function build() {
  const onHide = vi.fn();
  return { onHide, hide: createAutoHide({ onHide, defaultMs: DEFAULT_MS }) };
}

describe("createAutoHide", () => {
  it("hides after the default delay when the caller names none", () => {
    const { onHide, hide } = build();

    hide.show();
    expect(onHide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEFAULT_MS - 1);
    expect(onHide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("honours a per-message duration over the default", () => {
    const { onHide, hide } = build();

    hide.show(10_000);

    vi.advanceTimersByTime(DEFAULT_MS);
    expect(onHide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(6_000);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  /**
   * **The structural rule: `show` never hides synchronously.** Its callers are inside a
   * render or a click handler, and a synchronous `onHide` would blank a sentence in the same
   * tick it was written. Only the timer hides. Same shape as `countdown.ts`'s ban on `start`
   * calling `onExpire`, and for the same reason.
   */
  it("never calls onHide from show itself", () => {
    const { onHide, hide } = build();

    hide.show(1);
    expect(onHide).not.toHaveBeenCalled();
    expect(hide.isRunning()).toBe(true);
  });

  /**
   * A burst of messages — `fire` says "Wysyłam…" and then the outcome, back to back — must
   * leave one timer, keyed to the last thing said. The failure this prevents: the first
   * message's clock firing under the third message and hiding a sentence the host is
   * mid-way through reading.
   */
  it("re-arms from the latest message rather than stacking timers", () => {
    const { onHide, hide } = build();

    hide.show();
    vi.advanceTimersByTime(3_000);
    hide.show();

    // The first message's clock would have fired here. It was dropped.
    vi.advanceTimersByTime(1_000);
    expect(onHide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3_000);
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending hide without hiding", () => {
    const { onHide, hide } = build();

    hide.show();
    hide.cancel();

    vi.advanceTimersByTime(DEFAULT_MS * 10);
    expect(onHide).not.toHaveBeenCalled();
    expect(hide.isRunning()).toBe(false);
  });

  it("is safe to cancel when nothing is armed", () => {
    const { hide } = build();

    expect(() => {
      hide.cancel();
      hide.cancel();
    }).not.toThrow();
    expect(hide.isRunning()).toBe(false);
  });

  /**
   * Fails toward *leaving the message on screen*. The other direction blanks it instantly
   * and is indistinguishable from nothing ever having been said.
   */
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "never hides on a duration of %p",
    (duration) => {
      const { onHide, hide } = build();

      hide.show(duration);

      vi.advanceTimersByTime(60_000);
      expect(onHide).not.toHaveBeenCalled();
      expect(hide.isRunning()).toBe(false);
    },
  );

  it("drops a pending hide when a later message asks never to be hidden", () => {
    const { onHide, hide } = build();

    hide.show();
    hide.show(0);

    vi.advanceTimersByTime(60_000);
    expect(onHide).not.toHaveBeenCalled();
  });
});
