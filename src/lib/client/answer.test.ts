// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSeen,
  fetchResult,
  hasSubmitted,
  markSeen,
  markSubmitted,
  submitAnswer,
  submittedText,
  type AnswerPayload,
} from "./answer";

/** The choice arm of the payload, so the call sites below stay readable. */
const choice = (optionIds: string[]): AnswerPayload => ({ kind: "choice", optionIds });

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

/**
 * Runs `body` with `localStorage.setItem` throwing, then puts it back.
 *
 * Restored by hand rather than by `vi.restoreAllMocks()`: happy-dom's `localStorage` is
 * a Proxy, and a spy installed on it is NOT restored by the global teardown — the
 * throwing implementation leaks into every later test in the file, where it silently
 * swallows writes and makes unrelated assertions fail for a reason that looks like a
 * bug in the code under test. (It did exactly that once.)
 */
function withBrokenWrite(body: () => void): void {
  const original = window.localStorage.setItem;
  window.localStorage.setItem = () => {
    throw new Error("quota");
  };

  try {
    body();
  } finally {
    window.localStorage.setItem = original;
  }
}

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
    withBrokenWrite(() => {
      expect(markSeen(SEEN_KEY, "q1", NOW)).toBe(NOW);
    });
  });
});

describe("markSubmitted / hasSubmitted", () => {
  /**
   * Persisted for the same reason the paint time is. Held only in memory, an attendee
   * who answered and then reloaded would watch the reveal be told nothing about
   * themselves — no verdict, no award, no running total — all of which the server is
   * holding and would happily serve.
   */
  it("survives a reload", () => {
    markSeen(SEEN_KEY, "q1", NOW);
    markSubmitted(SEEN_KEY, "q1");

    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(true);
  });

  it("keeps the original paint time, so the clock is not restarted by answering", () => {
    markSeen(SEEN_KEY, "q1", NOW);
    markSubmitted(SEEN_KEY, "q1", { now: NOW + 5_000 });

    expect(markSeen(SEEN_KEY, "q1", NOW + 9_000)).toBe(NOW);
  });

  it("is false for a question this device stayed silent on", () => {
    markSeen(SEEN_KEY, "q1", NOW);

    // The fan-in gate depends on this: a silent device must still issue no request.
    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(false);
  });

  it("is per question", () => {
    markSubmitted(SEEN_KEY, "q1");

    expect(hasSubmitted(SEEN_KEY, "q2")).toBe(false);
  });

  it("is cleared with the rest of the store", () => {
    markSubmitted(SEEN_KEY, "q1");
    clearSeen(SEEN_KEY);

    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(false);
  });

  /**
   * The store held a bare number before it carried `submitted`. A device mid-question
   * when that deploy lands must keep its clock rather than restart it at full speed
   * weight — the same reasoning as the schema defaults on the server.
   */
  it("reads the older bare-number shape rather than discarding it", () => {
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ q1: NOW }));

    expect(markSeen(SEEN_KEY, "q1", NOW + 9_000)).toBe(NOW);
    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    withBrokenWrite(() => {
      expect(() => markSubmitted(SEEN_KEY, "q1")).not.toThrow();
    });
  });
});

/**
 * The free-text answer this device sent (roadmap S-05, impl-review F1).
 *
 * **This exists because of a specific failure.** The view holds the typed value in
 * memory, and `/api/quiz/result` will not serve a device its own answer back until the
 * reveal — so without a stored copy, an attendee who reloads a locked text question
 * sees an empty disabled field under "Odpowiedź zapisana". The plan promised the field
 * stays visible precisely so they can still see what they sent.
 */
describe("submittedText", () => {
  it("gives back the text an accepted answer was sent with", () => {
    markSeen(SEEN_KEY, "q1", NOW);
    markSubmitted(SEEN_KEY, "q1", { text: "Halucynacje." });

    expect(submittedText(SEEN_KEY, "q1")).toBe("Halucynacje.");
  });

  /** THE RELOAD, which is the whole point — a fresh read of the same storage. */
  it("survives a reload", () => {
    markSubmitted(SEEN_KEY, "q1", { text: "Halucynacje." });

    // Nothing in memory carries over a reload; only what `readSeen` finds does.
    const raw = window.localStorage.getItem(SEEN_KEY);
    window.localStorage.clear();
    window.localStorage.setItem(SEEN_KEY, raw!);

    expect(submittedText(SEEN_KEY, "q1")).toBe("Halucynacje.");
    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(true);
  });

  it("is null for a choice answer, which passes no text", () => {
    markSubmitted(SEEN_KEY, "q1");

    // Submitted, but nothing to put back in a field — the two are different questions.
    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(true);
    expect(submittedText(SEEN_KEY, "q1")).toBeNull();
  });

  it("is null for a question this device stayed silent on", () => {
    markSeen(SEEN_KEY, "q1", NOW);

    expect(submittedText(SEEN_KEY, "q1")).toBeNull();
  });

  it("is null for an entry written before the field existed", () => {
    // The mid-deploy shape: submitted, but with no text recorded.
    window.localStorage.setItem(SEEN_KEY, JSON.stringify({ q1: { at: NOW, submitted: true } }));

    expect(hasSubmitted(SEEN_KEY, "q1")).toBe(true);
    expect(submittedText(SEEN_KEY, "q1")).toBeNull();
  });

  it("ignores a non-string text rather than returning it", () => {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ q1: { at: NOW, submitted: true, text: 42 } })
    );

    expect(submittedText(SEEN_KEY, "q1")).toBeNull();
  });

  it("keeps the original paint time when recording the text", () => {
    markSeen(SEEN_KEY, "q1", NOW);
    markSubmitted(SEEN_KEY, "q1", { text: "halucynacje", now: NOW + 5_000 });

    expect(markSeen(SEEN_KEY, "q1", NOW + 9_000)).toBe(NOW);
  });

  it("is cleared with the rest of the store, so it does not outlive the session", () => {
    markSubmitted(SEEN_KEY, "q1", { text: "halucynacje" });
    clearSeen(SEEN_KEY);

    expect(submittedText(SEEN_KEY, "q1")).toBeNull();
  });
});

describe("clearSeen", () => {
  /**
   * Question ids are stable across sessions, so a map left behind is read back by the
   * next one — and every correct answer that device gives is then worth the 0.5 floor,
   * silently. This is why the clock is the one piece of per-question state that has a
   * lifecycle at all.
   */
  it("lets a later session start its own clock", () => {
    markSeen(SEEN_KEY, "q1", NOW);
    clearSeen(SEEN_KEY);

    expect(markSeen(SEEN_KEY, "q1", NOW + 86_400_000)).toBe(NOW + 86_400_000);
  });

  it("is safe to call when nothing was stored", () => {
    expect(() => clearSeen(SEEN_KEY)).not.toThrow();
  });

  it("does not throw when storage is unavailable", () => {
    const original = window.localStorage.removeItem;
    window.localStorage.removeItem = () => {
      throw new Error("disabled");
    };

    try {
      expect(() => clearSeen(SEEN_KEY)).not.toThrow();
    } finally {
      window.localStorage.removeItem = original;
    }
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

    await expect(submitAnswer("p1", "q1", choice(["a"]), 3_200)).resolves.toEqual({
      outcome: "accepted",
    });
  });

  it("sends every selected option as a repeated field", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", choice(["a", "b"]), 3_200);

    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.getAll("optionIds")).toEqual(["a", "b"]);
    expect(body.get("elapsedMs")).toBe("3200");
  });

  it("rounds the elapsed time, because the server parses it as an integer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", choice(["a"]), 3_200.7);

    expect((fetchMock.mock.calls[0]![1].body as FormData).get("elapsedMs")).toBe("3201");
  });

  it("sends a text answer raw, leaving the trim and the fold to the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", { kind: "text", text: "  Halucynacje.  " }, 3_200);

    const body = fetchMock.mock.calls[0]![1].body as FormData;
    // Untouched: the server is the only parser, and a client-side trim here would be
    // the first half of a second implementation of the rule.
    expect(body.get("text")).toBe("  Halucynacje.  ");
    // And no empty option field alongside it, which the route would read as a choice.
    expect(body.getAll("optionIds")).toEqual([]);
  });

  it("sends a numeric guess raw, leaving the parse to the server", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    // A Polish decimal comma and a grouping space — exactly what a phone keypad and a
    // paste produce. `parseGuess` is the only thing that decides what this means.
    await submitAnswer("p1", "q1", { kind: "number", value: " 9 800,5 " }, 3_200);

    const body = fetchMock.mock.calls[0]![1].body as FormData;
    expect(body.get("value")).toBe(" 9 800,5 ");
    // And nothing that would send the route down another kind's branch.
    expect(body.get("text")).toBeNull();
    expect(body.getAll("optionIds")).toEqual([]);
  });

  it("sends no value field on a choice or text answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", choice(["a"]), 3_200);
    await submitAnswer("p1", "q2", { kind: "text", text: "halucynacje" }, 3_200);

    expect((fetchMock.mock.calls[0]![1].body as FormData).get("value")).toBeNull();
    expect((fetchMock.mock.calls[1]![1].body as FormData).get("value")).toBeNull();
  });

  it("treats a 5xx on a numeric guess as failed, never as a refusal", async () => {
    // Same distinction as the text path, asserted for this kind too: `rejected` is
    // final and costs the attendee the control, so a store blip must not read as one.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "Nie udało się zapisać odpowiedzi." }),
      })
    );

    await expect(
      submitAnswer("p1", "q1", { kind: "number", value: "9800" }, 1_000)
    ).resolves.toEqual({ outcome: "failed" });
  });

  it("still reports a refused guess as a refusal, with the server's message", async () => {
    respond(false, { error: "Wpisz liczbę." });

    await expect(
      submitAnswer("p1", "q1", { kind: "number", value: "abc" }, 1_000)
    ).resolves.toEqual({ outcome: "rejected", error: "Wpisz liczbę." });
  });

  it("sends no text field on a choice answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    await submitAnswer("p1", "q1", choice(["a"]), 3_200);

    expect((fetchMock.mock.calls[0]![1].body as FormData).get("text")).toBeNull();
  });

  it("treats a 5xx on a text answer as failed, never as a refusal", async () => {
    // The distinction the whole module turns on: `rejected` is final and the attendee
    // loses the control, so a store blip must not be reported as one.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "Sesja nie jest skonfigurowana." }),
      })
    );

    await expect(
      submitAnswer("p1", "q1", { kind: "text", text: "halucynacje" }, 1_000)
    ).resolves.toEqual({ outcome: "failed" });
  });

  it("carries the server's own message through on a refusal", async () => {
    respond(false, { error: "Odpowiedź została już zapisana." });

    await expect(submitAnswer("p1", "q1", choice(["a"]), 1_000)).resolves.toEqual({
      outcome: "rejected",
      error: "Odpowiedź została już zapisana.",
    });
  });

  /**
   * A 503 carries a Polish message exactly as a 409 does, and nothing was written.
   * Trusting the message made the caller lock the question and tell the attendee the
   * answer was saved, with no way back — one store blip, one lost question.
   */
  it("reports a 5xx as failed even though it carries an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({ error: "Nie udało się zapisać odpowiedzi." }),
      })
    );

    await expect(submitAnswer("p1", "q1", choice(["a"]), 1_000)).resolves.toEqual({ outcome: "failed" });
  });

  it("still reports a 409 as a refusal, with the server's message", async () => {
    // The other side of the same branch: this one IS final, and the attendee should
    // read why rather than be invited to retry into the same refusal.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ error: "Odpowiedź została już zapisana." }),
      })
    );

    await expect(submitAnswer("p1", "q1", choice(["a"]), 1_000)).resolves.toEqual({
      outcome: "rejected",
      error: "Odpowiedź została już zapisana.",
    });
  });

  it("refuses a concurrent submission for the SAME question", async () => {
    // Two fast taps against a closing question. The second must not reach the route,
    // or it comes back `already-answered` and tells the attendee their own accepted
    // answer was refused.
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValue(pending.then(() => ({ ok: true, json: () => Promise.resolve({}) })))
    );

    const first = submitAnswer("p1", "q1", choice(["a"]), 1_000);
    const second = await submitAnswer("p1", "q1", choice(["a"]), 1_000);

    expect(second).toEqual({ outcome: "failed" });

    release(null);
    await expect(first).resolves.toEqual({ outcome: "accepted" });
  });

  /**
   * The guard is keyed by question, not module-wide. A single flag made one slow
   * request block the *next* question too — every tap there returned instantly and the
   * view showed a network error that was not one.
   */
  it("does not let a slow submission block a different question", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockReturnValueOnce(pending.then(() => ({ ok: true, json: () => Promise.resolve({}) })))
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal("fetch", fetchMock);

    const stuck = submitAnswer("p1", "q1", choice(["a"]), 1_000);

    await expect(submitAnswer("p1", "q2", choice(["b"]), 1_000)).resolves.toEqual({
      outcome: "accepted",
    });

    release(null);
    await stuck;
  });

  it("releases the guard once the question's submission settles", async () => {
    respond(true, {});

    await submitAnswer("p1", "q1", choice(["a"]), 1_000);

    // Otherwise a failed first attempt would lock the attendee out of retrying.
    await expect(submitAnswer("p1", "q1", choice(["a"]), 1_000)).resolves.toEqual({
      outcome: "accepted",
    });
  });

  it("reports a network failure as failed, distinct from a refusal", async () => {
    // The two mean opposite things to an attendee: a refusal is an answer about their
    // answer, a failure is "we do not know" and is worth retrying.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await expect(submitAnswer("p1", "q1", choice(["a"]), 1_000)).resolves.toEqual({ outcome: "failed" });
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
