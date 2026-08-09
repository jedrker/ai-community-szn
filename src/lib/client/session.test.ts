import { describe, expect, it } from "vitest";

import { classifyConnection } from "./session";

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
 */

/** Ably's own state names, so a typo here is a wrong test rather than a wrong string. */
const HEALTHY = "connected";
const OPENING = ["initialized", "connecting"] as const;
const UNHEALTHY = ["disconnected", "suspended", "closing", "closed", "failed"] as const;

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
      // The host view prints this verbatim, so it must not be translated or folded.
      expect(classifyConnection("suspended", undefined).info.detail).toBe("suspended");
    });
  });

  describe("account-limit codes", () => {
    it.each(ACCOUNT_LIMIT)("classifies $code ($meaning) as account-limit", ({ code }) => {
      const { status, info } = classifyConnection("failed", code);
      expect(status).toBe("lost");
      expect(info.cause).toBe("account-limit");
      expect(info.code).toBe(code);
    });

    it("classifies an account-limit code on any unhealthy state, not just failed", () => {
      // Ably's docs do not commit 40111 to one connection state, which is the whole
      // reason the cause is read from the code. A state-shaped assumption here would
      // reintroduce the guess this function exists to remove.
      for (const state of UNHEALTHY) {
        expect(classifyConnection(state, 40111).info.cause).toBe("account-limit");
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

  describe("recovery", () => {
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
