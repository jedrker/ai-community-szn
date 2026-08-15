// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCountdown } from "./countdown";

/**
 * The countdown state machine (roadmap S-11, FR-020).
 *
 * **These are the tests that did not exist when the two countdown defects shipped**, and
 * the reason this module was extracted from the two Astro pages at all. Both bugs are
 * reproduced here as named regression tests — the recursion one especially, because it is
 * the shape a source scan cannot see.
 *
 * `happy-dom` for `window.setTimeout`/`clearTimeout`, selected per file by the docblock
 * above; fake timers so one advance is exactly one tick, which `lessons.md` requires of any
 * timing test. The clock is injected rather than stubbed globally, so the value the module
 * reads and the value the test believes cannot drift.
 */

const OPENED_AT = 1_785_000_000_000;
const LIMIT_SECONDS = 25;
const LIMIT_MS = LIMIT_SECONDS * 1_000;

let clock = OPENED_AT;
const now = () => clock;

/** Advances both the injected clock and the timer queue by the same amount. */
function advance(ms: number): void {
  clock += ms;
  vi.advanceTimersByTime(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = OPENED_AT;
});

afterEach(() => {
  vi.useRealTimers();
});

function build(overrides: { onExpire?: () => void } = {}) {
  const onPaint = vi.fn();
  const onExpire = overrides.onExpire ?? vi.fn();
  const countdown = createCountdown({ onPaint, onExpire, now });
  return { countdown, onPaint, onExpire };
}

/** The remaining-ms argument of every paint so far. */
const painted = (onPaint: ReturnType<typeof vi.fn>): number[] =>
  onPaint.mock.calls.map((call) => call[0] as number);

describe("arming and ticking", () => {
  it("paints immediately and once per second after that", () => {
    const { countdown, onPaint } = build();

    expect(countdown.start(OPENED_AT, LIMIT_SECONDS)).toBe(false);
    expect(painted(onPaint)).toEqual([LIMIT_MS]);

    advance(1_000);
    advance(1_000);

    expect(painted(onPaint)).toEqual([LIMIT_MS, LIMIT_MS - 1_000, LIMIT_MS - 2_000]);
  });

  it("passes the limit alongside the remainder, so a caller can draw a bar", () => {
    const { countdown, onPaint } = build();

    countdown.start(OPENED_AT, LIMIT_SECONDS);

    expect(onPaint.mock.calls[0]).toEqual([LIMIT_MS, LIMIT_MS]);
  });

  it("lands on whole seconds rather than drifting", () => {
    const { countdown, onPaint } = build();

    // Armed 400 ms into a second, so 24 600 ms remain. The next *whole second* of
    // remaining time is 24 000, which is 600 ms away — not 1000. A fixed interval would
    // paint 23 600 here and stay 400 ms off the second for the rest of the question.
    clock = OPENED_AT + 400;
    countdown.start(OPENED_AT, LIMIT_SECONDS);

    advance(600);

    expect(painted(onPaint)).toEqual([24_600, 24_000]);
  });

  it("recomputes from the clock, so a throttled tab catches up in one paint", () => {
    const { countdown, onPaint } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);
    onPaint.mockClear();

    /**
     * A hidden tab: ten seconds of wall clock pass, and the browser fires the pending
     * timer **once**, late. Modelled by moving the clock and then running exactly one
     * timer — `advanceTimersByTime(10_000)` would instead run ten seconds' worth of the
     * queue, which is a tab that was never throttled.
     */
    clock += 10_000;
    vi.advanceTimersToNextTimer();

    // One paint carrying the true remainder — not ten paints counting down to it.
    expect(painted(onPaint)).toEqual([LIMIT_MS - 10_000]);
  });
});

describe("the crossing", () => {
  it("calls onExpire exactly once, from the tick", () => {
    const { countdown, onExpire } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);

    advance(LIMIT_MS);

    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("paints the zero before handing over", () => {
    const { countdown, onPaint, onExpire } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);
    onPaint.mockClear();

    advance(LIMIT_MS);

    expect(painted(onPaint)).toEqual([0]);
    expect(onExpire).toHaveBeenCalled();
  });

  it("stops: nothing is armed after the crossing", () => {
    const { countdown, onPaint } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);

    advance(LIMIT_MS);
    expect(countdown.isRunning()).toBe(false);

    onPaint.mockClear();
    advance(60_000);
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("does not call onExpire twice when time keeps passing", () => {
    const { countdown, onExpire } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);

    advance(LIMIT_MS);
    advance(LIMIT_MS);

    expect(onExpire).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE RECURSION REGRESSION (finding F1).
 *
 * The inline version held a shared `timeUp` flag that the renderer cleared as its first
 * statement. On an expired question the paint path saw it clear, set it, and called the
 * renderer again — which cleared it again, unbounded, ~1900 frames deep before `RangeError`,
 * on every attendee phone, at the exact moment the feature was supposed to act.
 *
 * The structural fix is that `start` reports the closed window by **return value** and never
 * invokes `onExpire`. These two tests are what a source scan could not do: they execute it.
 */
describe("an already-closed window is reported, never announced", () => {
  it("returns true without calling onExpire", () => {
    const { countdown, onExpire } = build();

    // A device joining, reloading or reconnecting after the deadline.
    clock = OPENED_AT + LIMIT_MS + 30_000;

    expect(countdown.start(OPENED_AT, LIMIT_SECONDS)).toBe(true);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("arms no timer for a window that is already closed", () => {
    const { countdown, onPaint } = build();
    clock = OPENED_AT + LIMIT_MS + 30_000;

    countdown.start(OPENED_AT, LIMIT_SECONDS);

    expect(countdown.isRunning()).toBe(false);
    onPaint.mockClear();
    advance(60_000);
    expect(onPaint).not.toHaveBeenCalled();
  });

  it("cannot recurse even when onExpire itself re-enters start", () => {
    /**
     * The caller's `onExpire` is a renderer, and a renderer arms the next clock. That is
     * exactly the loop that crashed. Here the callback does the most hostile thing a real
     * caller could — stop and immediately re-start an expired window — and it must settle.
     */
    let reentries = 0;
    const countdown = createCountdown({
      onPaint: () => {},
      onExpire: () => {
        reentries += 1;
        if (reentries > 50) throw new Error("runaway re-entry");
        countdown.stop();
        countdown.start(OPENED_AT, LIMIT_SECONDS);
      },
      now,
    });

    countdown.start(OPENED_AT, LIMIT_SECONDS);
    advance(LIMIT_MS);

    // One crossing, one re-entry, and the re-armed call returned `true` rather than firing
    // the callback again.
    expect(reentries).toBe(1);
    expect(countdown.isRunning()).toBe(false);
  });

  it("paints the zero on the way out, so the display does not freeze mid-count", () => {
    const { countdown, onPaint } = build();
    clock = OPENED_AT + LIMIT_MS + 5_000;

    countdown.start(OPENED_AT, LIMIT_SECONDS);

    // Negative, and the caller clamps for display — what matters is that it painted.
    expect(onPaint).toHaveBeenCalledTimes(1);
    expect(painted(onPaint)[0]).toBeLessThanOrEqual(0);
  });
});

/**
 * THE OUTLIVES-ITS-QUESTION REGRESSION (finding F2).
 *
 * The projector's clock kept re-arming over a session that had been purged, because the
 * only `stop` sat inside a function the null branch returned before reaching.
 */
describe("stopping", () => {
  it("stops the chain", () => {
    const { countdown, onPaint } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);
    advance(1_000);
    onPaint.mockClear();

    countdown.stop();
    advance(10_000);

    expect(onPaint).not.toHaveBeenCalled();
    expect(countdown.isRunning()).toBe(false);
  });

  it("is idempotent and safe before anything started", () => {
    const { countdown } = build();

    expect(() => {
      countdown.stop();
      countdown.stop();
    }).not.toThrow();
  });

  it("never leaves two chains running when re-started", () => {
    const { countdown, onPaint } = build();

    countdown.start(OPENED_AT, LIMIT_SECONDS);
    // The host advanced: same object, new question, no explicit stop in between.
    countdown.start(OPENED_AT + 5_000, LIMIT_SECONDS);
    onPaint.mockClear();

    advance(1_000);

    // One paint, not two — a second chain would double every tick from here on.
    expect(onPaint).toHaveBeenCalledTimes(1);
  });
});

describe("questions with no clock", () => {
  it("is never closed and arms nothing when the limit is absent", () => {
    const { countdown, onPaint, onExpire } = build();

    // The word cloud and the gather question, an hour in.
    clock = OPENED_AT + 3_600_000;

    expect(countdown.start(OPENED_AT, undefined)).toBe(false);
    expect(countdown.isRunning()).toBe(false);
    expect(onPaint).not.toHaveBeenCalled();
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("drops a running clock when a question without one arrives", () => {
    const { countdown, onPaint } = build();
    countdown.start(OPENED_AT, LIMIT_SECONDS);

    countdown.start(OPENED_AT, undefined);
    onPaint.mockClear();
    advance(10_000);

    // Otherwise the previous question's clock would tick on under the word cloud.
    expect(onPaint).not.toHaveBeenCalled();
  });
});

describe("degenerate input fails toward not-closed", () => {
  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("does not close the window on a %s open time", (_label, openedAt) => {
    const { countdown } = build();

    // Locking a whole room out on a bad timestamp is worse than showing no clock — the
    // server decides either way. `deadline.ts` records the same reasoning server-side.
    expect(countdown.start(openedAt, LIMIT_SECONDS)).toBe(false);
    expect(countdown.isRunning()).toBe(false);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    ["NaN", Number.NaN],
  ])("does not close the window on a %s limit", (_label, limitSeconds) => {
    const { countdown } = build();

    expect(countdown.start(OPENED_AT, limitSeconds)).toBe(false);
    expect(countdown.isRunning()).toBe(false);
  });
});
