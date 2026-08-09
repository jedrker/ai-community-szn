import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-device result route (roadmap S-03).
 *
 * The store is mocked; what is under test is the phase gate and the three-way split
 * between "you answered", "you did not" and "the store could not say".
 */

const readOwnResultMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  readOwnResult: readOwnResultMock,
}));

const { POST: result } = await import("./result");
const { quiz } = await import("../../../quiz/index");

const NOW = 1_785_000_000_000;
const QUESTION = quiz.questions[2]!.id;
const OTHER = quiz.questions[4]!.id;

function state(phase: "lobby" | "question-open" | "question-revealed" | "ended", questionId = QUESTION) {
  const questionless = phase === "lobby" || phase === "ended";
  return {
    version: 6,
    phase,
    currentQuestionId: questionless ? null : questionId,
    startedAt: NOW - 60_000,
    updatedAt: NOW,
    playerCount: 12,
    revealedOptionIds: phase === "question-revealed" ? ["large-language-model"] : null,
  };
}

/**
 * A choice answer. `text: null` is spelled out rather than omitted because that is what
 * `readOwnResult` actually returns — it parses through `answerRecordSchema`, which
 * defaults the field — and a fixture that left it `undefined` would make the route drop
 * the key from its JSON entirely, so the assertions below would pass without the field
 * ever being wired.
 */
const answered = {
  playerId: "player-abc",
  questionId: QUESTION,
  optionIds: ["large-language-model"],
  text: null,
  elapsedMs: 3_200,
  correct: true,
  awarded: 920,
  answeredAt: NOW,
};

/** The same device, on a free-text question. */
const answeredText = {
  ...answered,
  optionIds: [],
  text: "Halucynacje.",
};

function ask(questionId = QUESTION, playerId = "player-abc"): Promise<Response> {
  const form = new FormData();
  form.set("playerId", playerId);
  form.set("questionId", questionId);

  return result({
    request: new Request("https://example.test/api/quiz/result", { method: "POST", body: form }),
  } as Parameters<typeof result>[0]) as Promise<Response>;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  readOwnResultMock.mockReset();
  readOwnResultMock.mockResolvedValue({
    outcome: "ok",
    state: state("question-revealed"),
    answer: answered,
    total: 2_740,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the phase gate", () => {
  /**
   * THE REASON THIS ENDPOINT IS SEPARATE FROM THE SUBMISSION.
   *
   * It returns a correctness verdict. Served while the question is open it is a cheat
   * sheet anyone in the room can reach with one `curl`, and the check has to read the
   * session document rather than trust a parameter.
   */
  it.each(["lobby", "question-open"] as const)("refuses in %s", async (phase) => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state(phase),
      answer: answered,
      total: 2_740,
    });

    const response = await ask();

    expect(response.status).toBe(409);
    expect(JSON.stringify(await body(response))).not.toContain("awarded");
  });

  it("refuses when a different question is the one revealed", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed", OTHER),
      answer: answered,
      total: 2_740,
    });

    // Otherwise a device could ask about question 3 while question 7 is revealed and
    // read a verdict for a question the room is still to be shown.
    expect((await ask()).status).toBe(409);
  });

  it("refuses when there is no session at all", async () => {
    readOwnResultMock.mockResolvedValue({ outcome: "ok", state: null, answer: null, total: 0 });

    expect((await ask()).status).toBe(409);
  });

  it("serves the verdict once that question is revealed", async () => {
    expect(await body(await ask())).toEqual({
      answered: true,
      correct: true,
      awarded: 920,
      text: null,
      total: 2_740,
    });
  });
});

/**
 * The device's own typed answer (roadmap S-05).
 *
 * Returned here rather than read from the view's memory, which a reload loses — an
 * attendee who answered and then reloaded should still see their own words beside the
 * accepted answer at reveal.
 */
describe("the typed answer travels back to its own device", () => {
  it("returns what this device typed for a text question", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: answeredText,
      total: 2_740,
    });

    expect(await body(await ask())).toMatchObject({
      answered: true,
      // Raw and trimmed, exactly as stored — not the fold.
      text: "Halucynacje.",
    });
  });

  it("returns null for a device that stayed silent", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: null,
      total: 2_740,
    });

    expect(await body(await ask())).toMatchObject({ answered: false, text: null });
  });

  it("stays behind the phase gate, like the verdict it travels with", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-open"),
      answer: answeredText,
      total: 2_740,
    });

    const response = await ask();

    // Served while the question is open, this is a cheat sheet reachable with one
    // `curl` — the reason this endpoint has a gate at all.
    expect(response.status).toBe(409);
    expect(JSON.stringify(await body(response))).not.toContain("Halucynacje");
  });
});

describe("the ended-phase exception", () => {
  /**
   * `ENDED_TTL_SECONDS` exists so a device that reloads just after the host closes
   * the segment still finds the final standings. A gate refusing everything in
   * `ended` would keep those totals for ten minutes with no way to read them — and
   * there is nothing left to leak once the segment is over. S-07 inherits this.
   */
  it("serves the running total alone, with no verdict attached", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("ended"),
      answer: answered,
      total: 8_420,
    });

    expect(await body(await ask())).toEqual({
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      total: 8_420,
    });
  });
});

describe("not-found and failed stay distinct", () => {
  /**
   * The `LookupResult` lesson. A phone that concluded from a store blip that it never
   * answered would tell the attendee they missed a question they watched themselves
   * answer — and the client acts differently on each of these two.
   */
  it("reports a device that did not answer as 200 with answered: false", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: null,
      total: 0,
    });

    const response = await ask();

    // A latecomer, or someone who did not tap in time. Normal, not a 404.
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ answered: false, total: 0 });
  });

  it("reports a store failure as 503, never as a silent non-answer", async () => {
    readOwnResultMock.mockResolvedValue({ outcome: "failed", reason: "unreachable" });

    const response = await ask();

    expect(response.status).toBe(503);
    expect(await body(response)).not.toHaveProperty("answered");
  });

  it("reports an unconfigured store as 503", async () => {
    readOwnResultMock.mockResolvedValue({ outcome: "unconfigured", reason: "no creds" });

    expect((await ask()).status).toBe(503);
  });
});

describe("input handling", () => {
  it("refuses a missing player id without touching the store", async () => {
    const form = new FormData();
    form.set("questionId", QUESTION);

    const response = (await result({
      request: new Request("https://example.test/api/quiz/result", { method: "POST", body: form }),
    } as Parameters<typeof result>[0])) as Response;

    expect(response.status).toBe(400);
    expect(readOwnResultMock).not.toHaveBeenCalled();
  });

  it("passes the player id and question id through unchanged", async () => {
    await ask(QUESTION, "player-xyz");

    expect(readOwnResultMock).toHaveBeenCalledWith("player-xyz", QUESTION);
  });

  it("never carries a display name or an option id in the response", async () => {
    const serialized = JSON.stringify(await body(await ask()));

    // Per-device data only, and only the parts the reveal is meant to show.
    expect(serialized).not.toContain("optionIds");
    expect(serialized).not.toContain("displayName");
    expect(serialized).not.toContain("playerId");
  });
});
