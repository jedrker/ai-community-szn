import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-device result route (roadmap S-03).
 *
 * The store is mocked; what is under test is the phase gate and the three-way split
 * between "you answered", "you did not" and "the store could not say".
 */

const readOwnResultMock = vi.fn();
const readOwnRankMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  readOwnResult: readOwnResultMock,
  readOwnRank: readOwnRankMock,
}));

const { POST: result } = await import("./result");
const { quizzes } = await import("../../../quiz/index");
// One quiz to run a session against — which one is not what anything here asserts.
const quiz = quizzes[0]!;

const NOW = 1_785_000_000_000;
/**
 * Two real, distinct question ids — real because `parseSessionState` refuses a
 * `currentQuestionId` that resolves to nothing, distinct because the phase gate's job is
 * to tell "your answer to this question" from "your answer to another one". Taken by
 * position rather than named: which two is irrelevant, and naming them made an edit to
 * the quiz fail a test about phases.
 */
const QUESTION = quiz.questions[0]!.id;
const OTHER = quiz.questions[1]!.id;

function state(
  phase:
    "lobby" | "question-open" | "question-revealed" | "ended" | "standings",
  questionId = QUESTION,
) {
  const questionless = phase === "lobby" || phase === "ended";
  return {
    version: 6,
    phase,
    currentQuestionId: questionless ? null : questionId,
    startedAt: NOW - 60_000,
    updatedAt: NOW,
    playerCount: 12,
    revealedOptionIds:
      phase === "question-revealed" ? ["fixture-option"] : null,
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
  optionIds: ["fixture-option"],
  text: null,
  value: null,
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

/**
 * The same device, on a number question — a **near miss**, deliberately: `correct` is
 * exact-hit-only for this kind, so this is the record whose flag says nothing about
 * whether it scored.
 */
const answeredNumber = {
  ...answered,
  optionIds: [],
  correct: false,
  awarded: 800,
  value: 9_800,
};

function ask(
  questionId = QUESTION,
  playerId = "player-abc",
): Promise<Response> {
  const form = new FormData();
  form.set("playerId", playerId);
  form.set("questionId", questionId);

  return result({
    request: new Request("https://example.test/api/quiz/result", {
      method: "POST",
      body: form,
    }),
  } as Parameters<typeof result>[0]) as Promise<Response>;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  readOwnResultMock.mockReset();
  readOwnRankMock.mockReset();
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
  it.each(["lobby", "question-open"] as const)(
    "refuses in %s",
    async (phase) => {
      readOwnResultMock.mockResolvedValue({
        outcome: "ok",
        state: state(phase),
        answer: answered,
        total: 2_740,
      });

      const response = await ask();

      expect(response.status).toBe(409);
      expect(JSON.stringify(await body(response))).not.toContain("awarded");
    },
  );

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
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: null,
      answer: null,
      total: 0,
    });

    expect((await ask()).status).toBe(409);
  });

  it("serves the verdict once that question is revealed", async () => {
    expect(await body(await ask())).toEqual({
      answered: true,
      correct: true,
      awarded: 920,
      text: null,
      value: null,
      // Present and null on every branch but the standings one, so the client parses one
      // response shape rather than two (roadmap S-07).
      rank: null,
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

    expect(await body(await ask())).toMatchObject({
      answered: false,
      text: null,
    });
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

/**
 * The device's own guess (roadmap S-06), returned for the same reason its typed text
 * is: the view's memory of it does not survive a reload, and the reveal panel needs
 * both numbers because `correct` alone cannot tell a near miss from a zero.
 */
describe("the numeric guess travels back to its own device", () => {
  it("returns what this device guessed for a number question", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: answeredNumber,
      total: 2_740,
    });

    expect(await body(await ask())).toMatchObject({
      answered: true,
      value: 9_800,
      // The pair the reveal copy actually branches on: not correct, and yet it scored.
      correct: false,
      awarded: 800,
    });
  });

  it("returns null for a device that stayed silent", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: null,
      total: 2_740,
    });

    expect(await body(await ask())).toMatchObject({
      answered: false,
      value: null,
    });
  });

  it("stays behind the phase gate, like the verdict it travels with", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-open"),
      answer: answeredNumber,
      total: 2_740,
    });

    const response = await ask();

    // An unrevealed number question is the same cheat sheet a choice one would be —
    // the award alone tells a device how close it was, and there is time to change.
    expect(response.status).toBe(409);
    expect(JSON.stringify(await body(response))).not.toContain("9800");
  });
});

describe("the ended-phase exception", () => {
  /**
   * `ENDED_TTL_SECONDS` exists so a device that reloads just after the host closes
   * the segment still finds the final standings. A gate refusing everything in
   * `ended` would keep those totals for ten minutes with no way to read them — and
   * there is nothing left to leak once the segment is over. S-07 inherits this.
   */
  beforeEach(() => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("ended"),
      answer: answered,
      total: 8_420,
    });
    readOwnRankMock.mockResolvedValue({ rank: 11, total: 8_420 });
  });

  it("serves no verdict, award, text or value", async () => {
    expect(await body(await ask())).toMatchObject({
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
    });
  });

  /**
   * THE HALF S-10 ADDED (FR-006). Until then this branch served the total alone, so an
   * attendee who placed 11th left the room with a number and nothing to measure it against.
   * The rank comes from the same `rankOf` the published board's rows were numbered by.
   */
  it("serves the final position alongside the total", async () => {
    expect(await body(await ask())).toEqual({
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
      rank: 11,
      total: 8_420,
    });
    expect(readOwnRankMock).toHaveBeenCalledWith("player-abc");
  });

  /**
   * **THE DIVERGENCE FROM THE STANDINGS BRANCH, which reports the same failure as a 503.**
   * There the beat is live and the host can show the board again; here the segment is over,
   * so refusing the whole response would take the attendee's total away over a missing line.
   *
   * Asserted on the total being intact as well as on the status, because a handler that
   * 503'd would satisfy a test checking only that no rank came back.
   */
  it("still serves the total when the rank read fails, with the rank null rather than 503", async () => {
    readOwnRankMock.mockResolvedValue(null);

    const response = await ask();

    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ rank: null, total: 8_420 });
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
    readOwnResultMock.mockResolvedValue({
      outcome: "failed",
      reason: "unreachable",
    });

    const response = await ask();

    expect(response.status).toBe(503);
    expect(await body(response)).not.toHaveProperty("answered");
  });

  it("reports an unconfigured store as 503", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "unconfigured",
      reason: "no creds",
    });

    expect((await ask()).status).toBe(503);
  });
});

describe("input handling", () => {
  it("refuses a missing player id without touching the store", async () => {
    const form = new FormData();
    form.set("questionId", QUESTION);

    const response = (await result({
      request: new Request("https://example.test/api/quiz/result", {
        method: "POST",
        body: form,
      }),
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

/**
 * The leaderboard branch (roadmap S-07, PRD FR-014).
 *
 * The third case in a gate this route's docstring said S-07 would inherit rather than
 * rediscover. A separate endpoint would have been a second copy of the phase check, and
 * two gates deciding what a device may learn is the pair that drifts.
 */
describe("the standings branch", () => {
  beforeEach(() => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("standings"),
      answer: answered,
      total: 2_740,
    });
    readOwnRankMock.mockResolvedValue({ rank: 7, total: 2_740 });
  });

  it("returns this device's own rank and total", async () => {
    const response = await ask();

    expect(response.status).toBe(200);
    await expect(body(response)).resolves.toMatchObject({
      rank: 7,
      total: 2_740,
    });
  });

  /**
   * Every verdict field null. The question is closed and its result was served at the
   * reveal; a branch that answered `correct` here would serve a verdict outside the phase
   * the gate exists to confine it to.
   */
  it("serves no verdict, award, text or value", async () => {
    const payload = await body(await ask());

    expect(payload).toMatchObject({
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
    });
  });

  /**
   * **A rank is not about a question.** The `questionId` a caller sends is ignored here —
   * this asks about the question the room has NOT just been through, and it is still
   * answered. Under the reveal branch the same request is a 409, which is what makes this
   * assertion about the new branch rather than about the parameter.
   */
  it("answers even when the questionId is not the one the session carries", async () => {
    const response = await ask(OTHER);

    expect(response.status).toBe(200);
    await expect(body(response)).resolves.toMatchObject({ rank: 7 });
  });

  /**
   * "The store could not say" is a 503, never a 200 carrying a rank of 0 or 1 — both of
   * which are claims about where this attendee stands. Asserted on the status AND on the
   * absence of a rank, because a handler that fell through to the reveal branch would
   * return a 200 with `rank: null` and pass a status-only test for the wrong reason.
   */
  it("reports a failed rank read as 503 rather than inventing a position", async () => {
    readOwnRankMock.mockResolvedValue(null);

    const response = await ask();

    expect(response.status).toBe(503);
    await expect(body(response)).resolves.not.toHaveProperty("rank");
  });

  /**
   * Renamed by S-10: the closing branch returns a rank too now, so "the only branch" was
   * about to become false while the fixture below stayed correct. What it actually pins is
   * that the *reveal* branch spends no rank read and reports the field as null.
   */
  it("leaves the reveal branch's rank null, and spends no read on it", async () => {
    readOwnResultMock.mockResolvedValue({
      outcome: "ok",
      state: state("question-revealed"),
      answer: answered,
      total: 2_740,
    });

    // Present and null rather than absent, so the client parses one shape.
    await expect(body(await ask())).resolves.toMatchObject({ rank: null });
    expect(readOwnRankMock).not.toHaveBeenCalled();
  });
});
