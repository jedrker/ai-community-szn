import { afterEach, describe, expect, it, vi } from "vitest";

import { LOG_PREFIX, logSessionEvent, SESSION_EVENTS } from "./log";

/**
 * The log is a storage surface under the PRD's retention guardrail (roadmap F-03).
 *
 * `vercel logs` retains roughly an hour on the Hobby plan, and nothing in this project
 * expires it — not the store's TTL, not `purge`, not `vercel rollback`. So a display
 * name written here outlives the session document by design, which is precisely what
 * the guardrail forbids.
 *
 * The defence is a closed `LogFields` type. The case below is what makes that a
 * checked claim rather than a believed one.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logSessionEvent", () => {
  it("emits one greppable line per call", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logSessionEvent("session.purged", { keysRemoved: 1 });

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]![0] as string;
    expect(line.startsWith(LOG_PREFIX)).toBe(true);
    expect(JSON.parse(line.slice(LOG_PREFIX.length))).toEqual({
      event: "session.purged",
      keysRemoved: 1,
    });
  });

  it("survives a field it cannot serialize rather than failing the action", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    // The cast is the point: this is what a caller doing something unwise looks like,
    // and logging must not be able to take a host action down with it.
    logSessionEvent("session.action.applied", { reason: cyclic as unknown as string });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toContain("fields unserializable");
  });

  it("carries the two F-03 events in the closed vocabulary", () => {
    expect(SESSION_EVENTS).toContain("session.ended");
    expect(SESSION_EVENTS).toContain("session.purged");
  });

  it("carries F-04's token event, and it takes no fields", () => {
    expect(SESSION_EVENTS).toContain("session.token.issued");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    logSessionEvent("session.token.issued");

    // Asserted as an exact object: the token endpoint is unauthenticated and one
    // line is emitted per joining device, so this is the event most likely to be
    // "improved" later with something identifying. It has nothing to add.
    expect(JSON.parse(spy.mock.calls[0]![0].slice(LOG_PREFIX.length + 1))).toEqual({
      event: "session.token.issued",
    });
  });

  it("carries S-02's two join events", () => {
    expect(SESSION_EVENTS).toContain("session.player.joined");
    expect(SESSION_EVENTS).toContain("session.join.rejected");
  });

  /**
   * The join events are the first that fire once per *attendee*, so they are the ones
   * most likely to be "improved" later with something identifying. Asserted as exact
   * objects for the same reason `session.token.issued` is: a count and a reason class
   * are the whole of what they may carry.
   */
  it("emits a count and a reason class, never anything about a person", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logSessionEvent("session.player.joined", { playerCount: 7 });
    logSessionEvent("session.join.rejected", { reason: "taken" });

    const parse = (index: number): unknown =>
      JSON.parse(spy.mock.calls[index]![0].slice(LOG_PREFIX.length + 1));

    expect(parse(0)).toEqual({ event: "session.player.joined", playerCount: 7 });
    expect(parse(1)).toEqual({ event: "session.join.rejected", reason: "taken" });
  });

  /**
   * **This is the enforcement, and it is load-bearing in both directions.**
   *
   * As written, the call below is a type error because `displayName` is not in
   * `LogFields`, and `@ts-expect-error` absorbs it — so `bun run type-check` stays
   * green while the rule holds.
   *
   * If someone reopens the field set — restores the index signature, adds a catch-all
   * — the call stops being an error, the directive becomes unused, and TypeScript
   * reports ts(2578) "Unused '@ts-expect-error' directive". The gate fails loudly at
   * exactly the moment the protection is removed, which is the property a comment
   * could never have.
   *
   * Do not delete this case to make a build green. Deleting it is the regression.
   */
  it("rejects an attendee display name at compile time", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logSessionEvent("session.created", {
      version: 1,
      // @ts-expect-error — display names are attendee data and logs outlive the store TTL
      displayName: "Jędrzej",
    });

    // Runtime behaviour is not the assertion here; the compiler is. This only proves
    // the call was reached, so a future refactor cannot quietly delete the line above
    // while leaving a passing test behind.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
