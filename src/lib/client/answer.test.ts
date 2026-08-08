// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchResult, markSeen, submitAnswer } from "./answer";

/**
 * The device's half of answering (roadmap S-03).
 *
 * `markSeen` gets the most attention here because it is the fix for a failure that is
 * invisible in a single page load: without persistence, reloading mid-question restarts
 * the clock and hands out full speed weight, and a reload during a fifteen-minute
 * segment is near-certain.
 */

const SEEN_KEY = "test:seen";
const NOW = 1_785_000_000_000;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markSeen", () => {
  it("returns the moment the question was first painted", () => {
    expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
  });

  /**
   * THE RELOAD FIX.
   *
   * A second call — which is what a reload produces — must return the *original*
   * timestamp. Returning the new one would mean a phone that reloads three seconds
   * before the question closes scores as though it answered instantly.
   */
  it("returns the original timestamp on a later call, not the later one", () => {
    markSeen(SEEN_KEY, "q1", NOW);

    expect(markSeen(SEEN_KEY, "q1", NOW + 9_000)).toBe(NOW);
  });

  it("is idempotent across many paints of the same question", () => {
    // Called on every render, and `render()` runs on every snapshot and every tap.
    markSeen(SEEN_KEY, "q1", NOW);
    markSeen(SEEN_KEY, "q1", NOW + 1);
    markSeen(SEEN_KEY, "q1", NOW + 2);

    expect(markSeen(SEEN_KEY, "q1", NOW + 3)).toBe(NOW);
  });

  it("keeps a separate clock per question", () => {
    markSeen(SEEN_KEY, "q1", NOW);

    expect(markSeen(SEEN_KEY, "q2", NOW + 30_000)).toBe(NOW + 30_000);
    expect(markSeen(SEEN_KEY, "q1", NOW + 40_000)).toBe(NOW);
  });

  it("starts the clock now when storage holds nothing for this question", () => {
    // The accepted residual: a device that cleared storage, and a latecomer who joined
    // after the question opened. FR-019 says the clock is the device's, and a latecomer
    // genuinely did just see the question.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ other: NOW - 60_000 }));

    expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
  });

  it("survives a malformed or hand-edited store rather than throwing", () => {
    window.localStorage.setItem(SEEN_KEY, "not json at all");

    expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
  });

  it("ignores a stored value that is not a usable timestamp", () => {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ q1: "yesterday" }));

    expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
  });

  it("degrades to the clock starting now when storage cannot be written", () => {
    // Safari in private mode, quota, storage disabled outright. A storage quirk must
    // not stop an attendee answering — `player.ts`'s posture.
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
  });
});

describe("submitAnswer", () => {
  function respond(ok: boolean, payload: unknown = {}): void {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok, json: () => Promise.resolve(payload) })
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports an accepted submission", async () => {
    respond(true, { accepted: true });

    await expect(submitAnswer("p1", "q1", ["a"], 3_200)).resolves.toEqual({
      outcome: "accepted",
    });
  });

  it("sends every selected option as a repeated field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", ["a", "b"], 3_200);

    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.getAll("optionIds")).toEqual(["a", "b"]);
    expect(body.get("elapsedMs")).toBe("3200");
  });

  it("rounds the elapsed time, because the server parses it as an integer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", ["a"], 3_200.7);

    expect((fetchMock.mock.calls[0]![1].body as FormData).get("elapsedMs")).toBe("3201");
  });

  it("carries the server's own message through on a refusal", async () => {
    respond(false, { error: "Odpowiedź została już zapisana." });

    await expect(submitAnswer("p1", "q1", ["a"], 1_000)).resolves.toEqual({
      outcome: "rejected",
      error: "Odpowiedź została już zapisana.",
    });
  });

  it("reports a network failure as failed, distinct from a refusal", async () => {
    // The two mean opposite things to an attendee: a refusal is an answer about their
    // answer, a failure is "we do not know" and is worth retrying.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(submitAnswer("p1", "q1", ["a"], 1_000)).resolves.toEqual({ outcome: "failed" });
  });
});

describe("fetchResult", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the payload for a revealed question", async () => {
    const payload = { answered: true, correct: true, awarded: 900, total: 2_700 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) })
    );

    await expect(fetchResult("p1", "q1")).resolves.toEqual(payload);
  });

  /**
   * Every failure is `null`, and the view must degrade to the correct answer it already
   * holds from the snapshot. That split — correctness broadcast, scoring per device —
   * is the reason the design puts the ids in the snapshot at all.
   */
  it.each([
    ["a refused request", { ok: false, json: () => Promise.resolve({ error: "nie" }) }],
    ["a malformed payload", { ok: true, json: () => Promise.resolve({ nonsense: true }) }],
    ["an unparseable body", { ok: true, json: () => Promise.reject(new Error("bad")) }],
  ])("returns null for %s", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchResult("p1", "q1")).resolves.toBeNull();
  });

  it("returns null when the network is gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(fetchResult("p1", "q1")).resolves.toBeNull();
  });
});
