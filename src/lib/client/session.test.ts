// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  advanceLifecycle,
  classifyConnection,
  createFallbackPoll,
  shouldFallbackPoll,
  INITIAL_LIFECYCLE,
  type Snapshot,
} from "./session";

/**
 * The connection classifier (change `connection-limit-degradation`, Phase 1).
 *
 * `session.ts` had no test before this file. The thing being covered is a lookup table of
 * four Ably error codes, which is the kind of code that rots in total silence: delete a
 * number and every test still passes, every type checks, and the only symptom is a host
 * reading "połączenie: disconnected" in a room that is actually full.
 *
 * Tested through the pure function rather than through a mocked `Ably.Realtime`, for the
 * reason `portability.test.ts` and `keys.test.ts` are written the way they are: a mock of
 * a third-party client freezes that client's API and keeps passing after a real upgrade
 * breaks production.
 *
 * Every case asserts the **whole** `{ status, cause }` pair. Per
 * `context/foundation/lessons.md`'s "Prove the fixture reaches the branch the test names",
 * asserting the status alone would let a case pass through the wrong branch — `lost` is
 * the status for both causes, so a cause-blind assertion proves nothing about the code
 * table at all.
 *
 * The second half covers `createFallbackPoll`. What is being protected there is not "does
 * a poll happen" but **does the loop ever outlive its purpose** — a timer still fetching
 * after the session ended, or after `close`, is exactly the runaway the runbook's Upstash
 * command tripwire is watching for, and nothing on screen would reveal it. So every exit
 * path is asserted on the fetch count and on `isArmed`, not just on the status emitted.
 *
 * `happy-dom` is selected per file (CLAUDE.md — the suite default is `node`) because the
 * loop uses `window.setTimeout` and reads `document.visibilityState`.
 */

/** Ably's own state names, so a typo here is a wrong test rather than a wrong string. */
const HEALTHY = "connected";
const OPENING = ["initialized", "connecting"] as const;
const UNHEALTHY = [
  "disconnected",
  "suspended",
  "closing",
  "closed",
  "failed",
] as const;

/** The four codes `ACCOUNT_LIMIT_CODES` is defined as, restated independently. */
const ACCOUNT_LIMIT = [
  { code: 40111, meaning: "connection limits exceeded" },
  { code: 40115, meaning: "account restricted (request limit exceeded)" },
  { code: 42910, meaning: "rate limit exceeded; request rejected" },
  { code: 42911, meaning: "rate limit exceeded; connection closed" },
] as const;

describe("classifyConnection", () => {
  describe("status folding", () => {
    it("reports the one healthy state as connected", () => {
      const { status, info } = classifyConnection(HEALTHY, undefined);
      expect(status).toBe("connected");
      expect(info.cause).toBeNull();
    });

    it.each(OPENING)("reports %s as connecting", (state) => {
      const { status, info } = classifyConnection(state, undefined);
      expect(status).toBe("connecting");
      // No cause: nothing has failed yet, so there is nothing to explain.
      expect(info.cause).toBeNull();
    });

    it.each(UNHEALTHY)("reports %s as lost", (state) => {
      expect(classifyConnection(state, undefined).status).toBe("lost");
    });

    it("carries Ably's own state name through as the detail", () => {
      // The host view prints this verbatim, so the classifier must not translate or fold it.
      // Note the field's documented contract is wider than this — `channel-failed` and a
      // failed prime's error text also travel in it — so this pins the classifier's output,
      // not an invariant on the field.
      expect(classifyConnection("suspended", undefined).info.detail).toBe(
        "suspended",
      );
    });
  });

  describe("account-limit codes", () => {
    it.each(ACCOUNT_LIMIT)(
      "classifies $code ($meaning) as account-limit",
      ({ code }) => {
        const { status, info } = classifyConnection("failed", code);
        expect(status).toBe("lost");
        expect(info.cause).toBe("account-limit");
        expect(info.code).toBe(code);
      },
    );

    it("classifies an account-limit code on any unhealthy state, not just failed", () => {
      // Ably's docs do not commit 40111 to one connection state, which is the whole
      // reason the cause is read from the code. A state-shaped assumption here would
      // reintroduce the guess this function exists to remove.
      for (const state of UNHEALTHY) {
        expect(classifyConnection(state, 40111).info.cause).toBe(
          "account-limit",
        );
      }
    });

    it("names the cause while the SDK is still retrying", () => {
      // Deliberate: a retry loop carrying a limit code is exactly when the host most
      // needs to be told why it will not settle.
      const { status, info } = classifyConnection("connecting", 40111);
      expect(status).toBe("connecting");
      expect(info.cause).toBe("account-limit");
    });
  });

  describe("transient failures", () => {
    it("classifies an unhealthy state with no code as transient", () => {
      const { status, info } = classifyConnection("disconnected", undefined);
      expect(status).toBe("lost");
      expect(info.cause).toBe("transient");
      expect(info.code).toBeNull();
    });

    it("classifies an unrelated error code as transient", () => {
      // 80003 is "disconnected" — a network condition, not an account ceiling.
      const { status, info } = classifyConnection("disconnected", 80003);
      expect(status).toBe("lost");
      expect(info.cause).toBe("transient");
      expect(info.code).toBe(80003);
    });
  });

  describe("recovery of the reported cause", () => {
    it("reports no cause on a healthy connection even when a code came with it", () => {
      /**
       * The guard that keeps a recovered room from reading as a full one. Ably reports
       * the *previous* failure's reason on the transition that recovers from it, so
       * without this a room that briefly hit its limit would keep the limit message on
       * screen over a working connection — a wrong message with a working quiz behind
       * it, which is harder to notice than an outage.
       */
      const { status, info } = classifyConnection(HEALTHY, 40111);
      expect(status).toBe("connected");
      expect(info.cause).toBeNull();
      // The code still travels; only the cause is suppressed.
      expect(info.code).toBe(40111);
    });
  });
});

/** `POLL_BASE_MS` and `POLL_JITTER_MS`, restated — they are module-private by design. */
const BASE_MS = 6_000;
const JITTER_MS = 1_500;

/**
 * One tick, with the jitter pinned to zero.
 *
 * **The jitter has to be neutralised rather than out-waited**, and the first draft of this
 * file got it wrong in a way worth recording: advancing by the *widest* interval looks
 * safe per tick, but fake time is one continuous line, so the unused remainder of each
 * advance accumulates and eventually pays for an extra tick. The counts drifted upward by
 * one somewhere around the third advance. Pinning `Math.random` to the midpoint (see
 * `beforeEach`) makes each advance exactly one tick, and the jitter's actual range gets
 * its own test below instead of being smuggled into every other assertion.
 */
const ONE_TICK_MS = BASE_MS;

/** `POLL_MAX_MS`, restated for the same reason as the two above. */
const MAX_MS = 20_000;

/**
 * The interval after `n` consecutive failures — the loop doubles from the base and stops at
 * the ceiling. Computed rather than written out so the sequence in each test reads as
 * "advance one tick" instead of a column of magic numbers.
 */
function delayAfterFailures(n: number): number {
  let value = BASE_MS;
  for (let i = 0; i < n; i += 1) value = Math.min(value * 2, MAX_MS);
  return value;
}

/**
 * Hide the document, run, and restore by hand.
 *
 * Hand-restored deliberately: CLAUDE.md records that `vi.restoreAllMocks()` does not undo
 * a spy installed on some of happy-dom's proxied globals, and a leaked `hidden` would make
 * every later test in this file observe a loop that never arms — passing or failing for a
 * reason that has nothing to do with the code under test.
 */
function withHiddenDocument(run: () => void): void {
  Object.defineProperty(document, "visibilityState", {
    value: "hidden",
    configurable: true,
  });
  try {
    run();
  } finally {
    delete (document as unknown as Record<string, unknown>).visibilityState;
  }
}

describe("createFallbackPoll", () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    // The midpoint: `(0.5 * 2 - 1) * JITTER_MS` is 0, so the interval is exactly the base.
    randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.5);
  });

  afterEach(() => {
    randomSpy.mockRestore();
    vi.useRealTimers();
  });

  /**
   * A poll harness whose `refresh` succeeds or fails on command, so a test can shape a
   * sequence of outcomes rather than mock the transport.
   */
  function harness(options?: {
    shouldPoll?: () => boolean;
    deferred?: boolean;
  }) {
    let succeed = true;
    /**
     * Set in deferred mode: resolves the request the loop is currently waiting on.
     *
     * **Deferred mode is what makes "mid-flight" mean anything.** With an immediately
     * resolved `refresh`, advancing fake time runs the tick *and* its `finally` before the
     * next line of the test, so nothing is ever actually in flight across an assertion —
     * which is how the first version of this file shipped a test named for the `finally`
     * guard that could only ever reach the fire-time guard.
     */
    let settle: (() => void) | null = null;

    const refresh = vi.fn(() => {
      if (!options?.deferred) {
        return succeed
          ? Promise.resolve()
          : Promise.reject(new Error("state fetch returned 503"));
      }
      return new Promise<void>((resolve, reject) => {
        settle = () =>
          succeed ? resolve() : reject(new Error("state fetch returned 503"));
      });
    });

    const degradedReports: boolean[] = [];

    const poll = createFallbackPoll({
      refresh,
      shouldPoll: options?.shouldPoll ?? (() => true),
      onDegraded: (next) => degradedReports.push(next),
    });

    return {
      poll,
      refresh,
      degradedReports,
      fail: () => {
        succeed = false;
      },
      recover: () => {
        succeed = true;
      },
      /** Resolve the in-flight request and let its `finally` run. */
      settleInFlight: async () => {
        if (settle === null) throw new Error("no request is in flight");
        settle();
        settle = null;
        await vi.advanceTimersByTimeAsync(0);
      },
    };
  }

  it("polls after arming and reports degraded on the first success", async () => {
    const { poll, refresh, degradedReports } = harness();

    poll.arm();
    expect(refresh).not.toHaveBeenCalled();
    // Nothing is reported before the fetch resolves: degraded is earned, not assumed.
    expect(degradedReports).toEqual([]);

    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(degradedReports).toEqual([true]);
  });

  it("keeps polling on its own after each tick", async () => {
    const { poll, refresh } = harness();

    poll.arm();
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  describe("the interval and its jitter", () => {
    /**
     * The spread is what keeps a refused cohort from polling in lockstep — every device
     * turned away by a connection limit is turned away within the same second or two, so a
     * fixed interval would synchronise them for the whole segment. Asserting the bounds
     * also pins the shape: a *symmetric* spread around the base, not a delay added to it,
     * which would quietly make the real interval longer than the number in the source.
     */
    it.each([
      { random: 0, expected: BASE_MS - JITTER_MS, label: "shortest" },
      { random: 1, expected: BASE_MS + JITTER_MS, label: "longest" },
      { random: 0.5, expected: BASE_MS, label: "midpoint" },
    ])(
      "waits $expected ms at the $label end of the jitter",
      async ({ random, expected }) => {
        randomSpy.mockReturnValue(random);
        const { poll, refresh } = harness();

        poll.arm();
        await vi.advanceTimersByTimeAsync(expected - 1);
        expect(refresh).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(refresh).toHaveBeenCalledTimes(1);
      },
    );
  });

  it("reports degraded once, not on every success", async () => {
    const { poll, degradedReports } = harness();

    poll.arm();
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

    expect(degradedReports).toEqual([true]);
  });

  it("never arms a second timer, however many times arm is called", async () => {
    const { poll, refresh } = harness();

    poll.arm();
    poll.arm();
    poll.arm();
    poll.arm();

    await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

    // One tick, not four. A stacked timer would leave the screen looking right while the
    // command spend multiplied — the failure mode with no visible symptom.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  describe("demotion back to lost", () => {
    it("survives one failure and demotes on the second", async () => {
      const { poll, degradedReports, fail } = harness();

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(degradedReports).toEqual([true]);

      fail();
      await vi.advanceTimersByTimeAsync(delayAfterFailures(0));
      // One failure is an ordinary venue-network blip. Flashing red here is what the
      // two-failure threshold exists to avoid.
      expect(degradedReports).toEqual([true]);

      await vi.advanceTimersByTimeAsync(delayAfterFailures(1));
      expect(degradedReports).toEqual([true, false]);
    });

    it("climbs back to degraded when polling starts working again", async () => {
      const { poll, degradedReports, fail, recover } = harness();

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      fail();
      await vi.advanceTimersByTimeAsync(delayAfterFailures(0));
      await vi.advanceTimersByTimeAsync(delayAfterFailures(1));
      expect(degradedReports).toEqual([true, false]);

      recover();
      await vi.advanceTimersByTimeAsync(delayAfterFailures(2));

      expect(degradedReports).toEqual([true, false, true]);
    });

    it("keeps polling while demoted, so recovery is possible at all", async () => {
      const { poll, refresh, fail } = harness();

      fail();
      poll.arm();
      await vi.advanceTimersByTimeAsync(delayAfterFailures(0));
      await vi.advanceTimersByTimeAsync(delayAfterFailures(1));
      await vi.advanceTimersByTimeAsync(delayAfterFailures(2));

      expect(refresh).toHaveBeenCalledTimes(3);
    });

    it("lengthens the interval after a failure and resets it on a success", async () => {
      /**
       * The backoff, asserted as a *timing* fact rather than trusted from the source: after a
       * failure, one base interval is no longer enough to fire the next tick. A permanently
       * unreachable endpoint must not be asked every six seconds for a whole segment.
       */
      const { poll, refresh, fail, recover } = harness();

      fail();
      poll.arm();
      await vi.advanceTimersByTimeAsync(BASE_MS);
      expect(refresh).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(BASE_MS);
      expect(refresh).toHaveBeenCalledTimes(1); // still waiting out the doubled interval

      await vi.advanceTimersByTimeAsync(delayAfterFailures(1) - BASE_MS);
      expect(refresh).toHaveBeenCalledTimes(2);

      // A success returns the loop to the base interval, so recovery is not penalised by
      // however long the outage lasted.
      recover();
      await vi.advanceTimersByTimeAsync(delayAfterFailures(2));
      expect(refresh).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(BASE_MS);
      expect(refresh).toHaveBeenCalledTimes(4);
    });

    it("caps the backoff at the ceiling", async () => {
      const { poll, refresh, fail } = harness();

      fail();
      poll.arm();
      // Five failures would be 6s → 12 → 24 → 48 → 96 without the cap.
      for (let i = 0; i < 5; i += 1) {
        await vi.advanceTimersByTimeAsync(delayAfterFailures(i));
      }
      expect(refresh).toHaveBeenCalledTimes(5);

      // The sixth arrives one ceiling later, not one doubling later.
      await vi.advanceTimersByTimeAsync(MAX_MS);
      expect(refresh).toHaveBeenCalledTimes(6);
    });

    it("pause keeps the status, unlike stop", async () => {
      /**
       * The distinction a hidden tab depends on. `stop` drops `degraded`, which is right for
       * a recovered channel and wrong for a backgrounded page: it paints a red "connection
       * lost" nobody is looking at, then flashes it again on the way back in for a fallback
       * that was working the whole time.
       */
      const { poll, degradedReports } = harness();

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(degradedReports).toEqual([true]);

      poll.pause();
      expect(poll.isArmed()).toBe(false);
      expect(degradedReports).toEqual([true]);

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(degradedReports).toEqual([true]);
    });

    it("reports nothing when polling never worked in the first place", async () => {
      const { poll, degradedReports, fail } = harness();

      fail();
      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);

      // The device is already `lost` and stays there. Reporting `false` would be a
      // transition that never happened.
      expect(degradedReports).toEqual([]);
    });
  });

  describe("exit paths", () => {
    it("stops on stop, and issues no further fetches", async () => {
      const { poll, refresh, degradedReports } = harness();

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(refresh).toHaveBeenCalledTimes(1);

      poll.stop();
      expect(poll.isArmed()).toBe(false);
      // Leaving degraded is part of stopping: the caller is about to render a recovered
      // or closed connection, and a stale amber banner would outlive the loop.
      expect(degradedReports).toEqual([true, false]);

      await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 5);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("does not arm when the caller says polling no longer applies", async () => {
      let applies = false;
      const { poll, refresh } = harness({ shouldPoll: () => applies });

      poll.arm();
      expect(poll.isArmed()).toBe(false);
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(refresh).not.toHaveBeenCalled();

      applies = true;
      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it("declines to fire a tick scheduled before the session ended", async () => {
      /**
       * The **fire-time** guard, not the `finally` one — the distinction this test's earlier
       * name got wrong. A tick scheduled while the session was live is still queued when the
       * host ends it; without the re-check at fire time each already-armed timer spends one
       * more fetch, which is ~220 of them in a full room at the moment the store is purged.
       *
       * The `finally` guard has its own tests below, in deferred mode.
       */
      let ended = false;
      const { poll, refresh } = harness({ shouldPoll: () => !ended });

      poll.arm();
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(refresh).toHaveBeenCalledTimes(1);

      ended = true;
      await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 5);

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(poll.isArmed()).toBe(false);
    });

    describe("with a request genuinely in flight", () => {
      it("dispose during an open request leaves the loop dead after it settles", async () => {
        /**
         * The bug this mode exists to catch. `stop()` clears the timer but not the in-flight
         * request, and that request's `finally` calls `arm()` — so a cancel can be undone by
         * a fetch it never knew about. `dispose()` is terminal precisely so `close()` cannot
         * be defeated that way, and nothing observable would reveal the difference: the
         * screen looks identical while a closed client keeps spending commands.
         */
        const { poll, refresh, settleInFlight } = harness({ deferred: true });

        poll.arm();
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(poll.isArmed()).toBe(false); // in flight, so no timer is pending

        poll.dispose();
        await settleInFlight();

        expect(poll.isArmed()).toBe(false);
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 5);
        expect(refresh).toHaveBeenCalledTimes(1);
      });

      it("stop during an open request is resumable, unlike dispose", async () => {
        // The other half of the distinction: `stop` is what a recovered channel and a
        // bfcache suspension use, so a later `arm` must work.
        const { poll, refresh, settleInFlight } = harness({ deferred: true });

        poll.arm();
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
        poll.stop();
        await settleInFlight();

        poll.arm();
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
        expect(refresh).toHaveBeenCalledTimes(2);
      });

      it("does not re-arm from the finally when polling stopped applying mid-request", async () => {
        // The `finally` guard proper: the host ends the session while the reply is open.
        let applies = true;
        const { poll, refresh, settleInFlight } = harness({
          deferred: true,
          shouldPoll: () => applies,
        });

        poll.arm();
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
        applies = false;
        await settleInFlight();

        expect(poll.isArmed()).toBe(false);
        await vi.advanceTimersByTimeAsync(ONE_TICK_MS * 5);
        expect(refresh).toHaveBeenCalledTimes(1);
      });
    });

    it("does not arm while the tab is hidden", async () => {
      const { poll, refresh } = harness();

      withHiddenDocument(() => {
        poll.arm();
        expect(poll.isArmed()).toBe(false);
      });

      await vi.advanceTimersByTimeAsync(ONE_TICK_MS);
      expect(refresh).not.toHaveBeenCalled();

      // Restored: the same call arms once the document is visible again, which is what
      // the caller's `visibilitychange` listener relies on.
      poll.arm();
      expect(poll.isArmed()).toBe(true);
    });
  });
});

/**
 * A snapshot stand-in.
 *
 * Only `phase` is read by the function under test, so a partial cast is honest here rather
 * than lazy — building a full `SessionState` would add fields no branch consults and invite
 * the reader to think one of them matters. `version` is included because `apply`'s guard
 * reads it, and a fixture that could never survive that guard would be misleading.
 */
function snapshot(phase: string): Snapshot {
  return { version: 1, phase } as unknown as Snapshot;
}

/**
 * The two predicates the loop's own tests could not reach, because those tests substitute a
 * hand-written `shouldPoll`. Both defects the implementation review found lived here.
 */
describe("shouldFallbackPoll", () => {
  it("stays off unless the caller opted in", () => {
    // `undefined` is the default for every view that has not asked for the fallback, and it
    // must behave like `false` rather than like "truthy enough".
    for (const fallbackPolling of [undefined, false]) {
      expect(
        shouldFallbackPoll({
          fallbackPolling,
          transportStatus: "lost",
          sessionOver: false,
        }),
      ).toBe(false);
    }
  });

  it("does not poll while the channel is healthy", () => {
    expect(
      shouldFallbackPoll({
        fallbackPolling: true,
        transportStatus: "connected",
        sessionOver: false,
      }),
    ).toBe(false);
  });

  it.each(["lost", "connecting"] as const)(
    "polls while the transport is %s",
    (status) => {
      // `connecting` counts deliberately: Ably passes through it on every retry, and treating
      // it as healthy would cancel the fallback several times a minute on a device that never
      // reconnects.
      expect(
        shouldFallbackPoll({
          fallbackPolling: true,
          transportStatus: status,
          sessionOver: false,
        }),
      ).toBe(true);
    },
  );

  it("stops for good once the session is over", () => {
    // The bound that makes state.ts's command budget true. Without it a phone left open
    // after a purge polls forever under a screen reading "To już koniec".
    expect(
      shouldFallbackPoll({
        fallbackPolling: true,
        transportStatus: "lost",
        sessionOver: true,
      }),
    ).toBe(false);
  });
});

describe("advanceLifecycle", () => {
  it("does not treat an absent session as a finished one", () => {
    // The case a naive `current !== null` fix breaks: a device that arrives before the host
    // has created a session must still poll, or the fallback strands exactly the device it
    // exists for.
    const next = advanceLifecycle(INITIAL_LIFECYCLE, null);
    expect(next).toEqual({ sawSession: false, sessionOver: false });
  });

  it("records having seen a live session without ending it", () => {
    const next = advanceLifecycle(INITIAL_LIFECYCLE, snapshot("lobby"));
    expect(next).toEqual({ sawSession: true, sessionOver: false });
  });

  it("ends on a purge — a session seen, then gone", () => {
    const seen = advanceLifecycle(INITIAL_LIFECYCLE, snapshot("question-open"));
    expect(advanceLifecycle(seen, null).sessionOver).toBe(true);
  });

  it("ends on the ended phase", () => {
    expect(
      advanceLifecycle(INITIAL_LIFECYCLE, snapshot("ended")).sessionOver,
    ).toBe(true);
  });

  it("is sticky — a later live snapshot does not re-open it", () => {
    /**
     * The accepted cost, pinned so nobody removes it by accident while "fixing" the
     * purge-and-restart case: once over, this client stays over, and a degraded device needs
     * a reload. Un-sticking it restores the unbounded spend the latch was added to stop,
     * because a lost device emits Ably transitions for as long as the tab is open.
     */
    const over = advanceLifecycle(INITIAL_LIFECYCLE, snapshot("ended"));
    expect(advanceLifecycle(over, snapshot("lobby")).sessionOver).toBe(true);
  });
});
