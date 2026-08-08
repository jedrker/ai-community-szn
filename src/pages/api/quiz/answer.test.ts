import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The submission route (roadmap S-03).
 *
 * The store is mocked — what is under test is the branching, the scoring handed to the
 * store, and the response contract. Atomicity is `store.test.ts`'s job; the rule itself
 * is `scoring.test.ts`'s.
 *
 * Follows `join.test.ts`'s shape.
 */

const readSessionMock = vi.fn();
const submitAnswerMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  readSession: readSessionMock,
  submitAnswer: submitAnswerMock,
}));

const { POST: answer } = await import("./answer");
const { quiz } = await import("../../../quiz/index");
const { SPEED_WINDOW_MS } = await import("../../../lib/session/scoring");

const NOW = 1_785_000_000_000;

const single = quiz.questions.find((question) => question.id === "llm-skrot")!;
const multi = quiz.questions.find((question) => question.id === "summer-tour-zakonczenie")!;
const text = quiz.questions.find((question) => question.id === "zmyslanie-faktow")!;
const unscored = quiz.questions.find((question) => question.id === "czy-wszyscy-gotowi")!;

function openOn(questionId: string, openedAt = NOW - 4_000) {
  return {
    outcome: "ok" as const,
    state: {
      version: 5,
      phase: "question-open" as const,
      currentQuestionId: questionId,
      startedAt: NOW - 60_000,
      updatedAt: openedAt,
      playerCount: 12,
      revealedOptionIds: null,
    },
  };
}

function request(fields: Record<string, string>, optionIds: string[] = []): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const id of optionIds) form.append("optionIds", id);

  return new Request("https://example.test/api/quiz/answer", { method: "POST", body: form });
}

function submit(questionId: string, optionIds: string[], elapsedMs = 4_000): Promise<Response> {
  return answer({
    request: request({ playerId: "player-abc", questionId, elapsedMs: String(elapsedMs) }, optionIds),
  } as Parameters<typeof answer>[0]) as Promise<Response>;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/** What the route handed the store — the scored record. */
function submitted(): Record<string, unknown> {
  return submitAnswerMock.mock.calls[0]![0] as Record<string, unknown>;
}

beforeEach(() => {
  readSessionMock.mockReset();
  submitAnswerMock.mockReset();
  readSessionMock.mockResolvedValue(openOn(single.id));
  submitAnswerMock.mockResolvedValue({ outcome: "accepted", total: 920 });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("scoring happens at submit, from the raw definition", () => {
  it("scores a correct single-choice answer", async () => {
    const response = await submit(single.id, ["large-language-model"]);

    expect(response.status).toBe(200);
    expect(submitted()).toMatchObject({ correct: true });
    expect(submitted().awarded as number).toBeGreaterThan(0);
  });

  it("scores an exact multi-select match", async () => {
    readSessionMock.mockResolvedValue(openOn(multi.id));

    await submit(multi.id, ["kino", "networking"]);

    expect(submitted()).toMatchObject({ correct: true });
  });

  it("refuses to award a partial multi-select — all-or-nothing (FR-010)", async () => {
    readSessionMock.mockResolvedValue(openOn(multi.id));

    await submit(multi.id, ["kino"]);

    expect(submitted()).toMatchObject({ correct: false, awarded: 0 });
  });

  it("refuses to award a superset", async () => {
    readSessionMock.mockResolvedValue(openOn(multi.id));

    await submit(multi.id, ["kino", "networking", "konkurs"]);

    expect(submitted()).toMatchObject({ correct: false, awarded: 0 });
  });

  it("awards nothing on an unscored question and still records the answer", async () => {
    readSessionMock.mockResolvedValue(openOn(unscored.id));

    const response = await submit(unscored.id, ["gotowy"]);

    // Recorded, so the reveal can say "you took part" rather than "you were silent".
    expect(response.status).toBe(200);
    expect(submitted()).toMatchObject({ correct: false, awarded: 0 });
  });

  it("records the selection it scored, so the reveal cannot disagree with it", async () => {
    await submit(single.id, ["large-language-model"]);

    expect(submitted().optionIds).toEqual(["large-language-model"]);
  });
});

describe("the elapsed time is the device's, but it is bounded", () => {
  it("trusts a plausible claim", async () => {
    // The question opened 4s ago; the device says 3.2s.
    readSessionMock.mockResolvedValue(openOn(single.id, NOW - 4_000));

    await submit(single.id, ["large-language-model"], 3_200);

    expect(submitted().elapsedMs).toBe(3_200);
  });

  it("caps a claim longer than the question has been open", async () => {
    readSessionMock.mockResolvedValue(openOn(single.id, NOW - 4_000));

    await submit(single.id, ["large-language-model"], 999_000);

    expect(submitted().elapsedMs).toBe(4_000);
  });

  it("floors a negative claim at zero", async () => {
    await submit(single.id, ["large-language-model"], -50_000);

    expect(submitted().elapsedMs).toBe(0);
  });

  it("treats a missing claim as the slowest answer rather than the fastest", async () => {
    readSessionMock.mockResolvedValue(openOn(single.id, NOW - SPEED_WINDOW_MS * 2));

    await answer({
      request: request({ playerId: "player-abc", questionId: single.id }, [
        "large-language-model",
      ]),
    } as Parameters<typeof answer>[0]);

    // `Number(null)` is 0, not NaN — so the guard that matters is the one in
    // `clampElapsed`, and this pins that a formless claim cannot buy full speed.
    expect(submitted().awarded).toBe(single.points! * 0.5);
  });

  it("gives a faster answer a strictly larger award", async () => {
    await submit(single.id, ["large-language-model"], 1_000);
    const fast = submitted().awarded as number;

    submitAnswerMock.mockClear();
    await submit(single.id, ["large-language-model"], 15_000);
    const slow = submitAnswerMock.mock.calls[0]![0].awarded as number;

    expect(fast).toBeGreaterThan(slow);
  });
});

describe("the response carries no verdict", () => {
  /**
   * THE ASSERTION FR-016 RESTS ON.
   *
   * `correct`, `awarded` and the new total all wait for the reveal. A total that
   * jumped by 800 is a verdict, and a device that could read one before the host
   * revealed would defeat the beat the whole segment is built around.
   */
  it("replies with accepted and nothing else", async () => {
    const response = await submit(single.id, ["large-language-model"]);

    expect(await body(response)).toEqual({ accepted: true });
  });

  it("leaks nothing even when the answer was correct and scored high", async () => {
    submitAnswerMock.mockResolvedValue({ outcome: "accepted", total: 4_820 });

    const serialized = JSON.stringify(await body(await submit(single.id, ["large-language-model"])));

    expect(serialized).not.toContain("correct");
    expect(serialized).not.toContain("awarded");
    expect(serialized).not.toContain("total");
    expect(serialized).not.toContain("4820");
  });
});

describe("refusals", () => {
  it("refuses a kind this slice does not handle, with a message rather than a crash", async () => {
    readSessionMock.mockResolvedValue(openOn(text.id));

    const response = await submit(text.id, []);

    // The seam S-05 and S-06 extend.
    expect(response.status).toBe(409);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("refuses an answer to a question that is not the open one", async () => {
    readSessionMock.mockResolvedValue(openOn(multi.id));

    const response = await submit(single.id, ["large-language-model"]);

    // A phone that submitted as the host advanced. Refused before a write is spent.
    expect(response.status).toBe(409);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("refuses while the question is revealed", async () => {
    readSessionMock.mockResolvedValue({
      outcome: "ok",
      state: { ...openOn(single.id).state, phase: "question-revealed", revealedOptionIds: [] },
    });

    expect((await submit(single.id, ["large-language-model"])).status).toBe(409);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("reports no session as 409, not as a failure", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: null });

    expect((await submit(single.id, ["large-language-model"])).status).toBe(409);
  });

  it("reports a missing player id without touching the store", async () => {
    const response = (await answer({
      request: request({ questionId: single.id, elapsedMs: "1000" }, ["large-language-model"]),
    } as Parameters<typeof answer>[0])) as Response;

    expect(response.status).toBe(400);
    expect(readSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["already-answered", 409],
    ["not-open", 409],
    ["no-session", 409],
    ["unknown-player", 404],
    ["unconfigured", 503],
    ["failed", 503],
  ])("maps a store outcome of %s to %i", async (outcome, status) => {
    submitAnswerMock.mockResolvedValue({ outcome, total: 0, reason: "x" });

    expect((await submit(single.id, ["large-language-model"])).status).toBe(status);
  });

  it("reports an unreadable session as 503 rather than recording an unscored answer", async () => {
    readSessionMock.mockResolvedValue({ outcome: "failed", reason: "unreachable" });

    expect((await submit(single.id, ["large-language-model"])).status).toBe(503);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });
});

describe("what reaches the log", () => {
  it("never logs the selected options", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => void logged.push(String(line)));

    await submit(single.id, ["large-language-model"]);

    // An answer is attendee data, and logs are covered by no TTL and no purge.
    // `LogFields` has no field an option id fits in — this pins the call site too.
    expect(logged.join("\n")).not.toContain("large-language-model");
    expect(logged.join("\n")).toContain("session.answer.accepted");
  });

  it("logs the rejection class on a refusal", async () => {
    const logged: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line) => void logged.push(String(line)));
    submitAnswerMock.mockResolvedValue({ outcome: "already-answered" });

    await submit(single.id, ["large-language-model"]);

    expect(logged.join("\n")).toContain("already-answered");
  });
});
