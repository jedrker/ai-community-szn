// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deviceId } from "./device";

/**
 * The device's own opaque id (roadmap S-09).
 *
 * **Every test uses its own storage key**, and that is not tidiness. `device.ts`
 * memoises per key so a broken-storage device cannot mint two ids in one page load, and
 * the memo is module state that outlives a single test. Distinct keys give each test a
 * genuinely separate slot, which is also the only way to reach the "first ever load"
 * branch more than once in one file.
 */

beforeEach(() => {
  window.localStorage.clear();
});

/**
 * Breaks one `localStorage` method for the duration of the body.
 *
 * **`vi.spyOn` and an explicit `mockRestore` are the only combination that works here**,
 * and the two obvious alternatives both fail silently in opposite directions — verified
 * against this happy-dom version rather than assumed:
 *
 * - **Plain assignment** (`window.localStorage.setItem = () => { throw }`) is *swallowed
 *   by the Proxy*. The write still succeeds, the body never sees a failure, and the test
 *   passes against code with no `try`/`catch` at all — it certifies nothing. Written that
 *   way first, this file's six tests all passed with both guards in `device.ts` deleted.
 * - **`vi.restoreAllMocks()`** does not reach a spy installed on the Proxy, so the throw
 *   leaks into every later test in the file and quietly swallows their writes.
 *
 * Hence: install with `spyOn`, restore with `mockRestore` in a `finally`, and never rely
 * on the global restore for this object.
 */
function withBroken(method: "setItem" | "getItem", body: () => void): void {
  const spy = vi.spyOn(window.localStorage, method).mockImplementation(() => {
    throw new Error("storage unavailable");
  });

  try {
    body();
  } finally {
    spy.mockRestore();
  }
}

const withBrokenWrite = (body: () => void): void => withBroken("setItem", body);
const withBrokenRead = (body: () => void): void => withBroken("getItem", body);

afterEach(() => {
  window.localStorage.clear();
});

describe("deviceId", () => {
  it("mints an id on first load and persists it", () => {
    const key = "test:device:mint";

    const id = deviceId(key);

    expect(id.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(key)).toBe(id);
  });

  /**
   * THE POINT OF THE WHOLE MODULE.
   *
   * A device that gets a new id on every load is never capped, so this is the assertion
   * FR-018 actually rests on. Written as a pre-seeded read rather than as two calls,
   * because two calls in one test would be answered by the memo and would pass against
   * a module that never touched storage at all.
   */
  it("returns the stored id on a later load", () => {
    const key = "test:device:stored";
    window.localStorage.setItem(key, "already-here");

    expect(deviceId(key)).toBe("already-here");
  });

  /**
   * A stored empty string is not an id: sent as one, the route refuses the claim, which
   * is the single outcome this module exists to make impossible.
   */
  it("mints over a stored empty string", () => {
    const key = "test:device:empty";
    window.localStorage.setItem(key, "");

    const id = deviceId(key);

    expect(id.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(key)).toBe(id);
  });

  it("still returns a usable id when the write throws", () => {
    const key = "test:device:broken-write";

    withBrokenWrite(() => {
      expect(deviceId(key).length).toBeGreaterThan(0);
    });
  });

  it("still returns a usable id when the read throws", () => {
    const key = "test:device:broken-read";

    withBrokenRead(() => {
      expect(deviceId(key).length).toBeGreaterThan(0);
    });
  });

  /**
   * The memo, and it is the cap's correctness rather than a performance note: two calls
   * in one load on a device that cannot persist would otherwise mint two ids and count
   * as two devices.
   */
  it("hands back one id per page load even when storage is unavailable", () => {
    const key = "test:device:memo";

    withBrokenWrite(() => {
      expect(deviceId(key)).toBe(deviceId(key));
    });
  });
});
