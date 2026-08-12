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
const { SPEED_WINDOW_MS, MAX_TEXT_ANSWER_LENGTH } = await import("../../../lib/session/scoring");
const { MAX_GUESS_MAGNITUDE } = await import("../../../lib/session/guess");
const { MAX_WORD_LENGTH } = await import("../../../lib/session/words");

const NOW = 1_785_000_000_000;

const single = quiz.questions.find((question) => question.id === "llm-skrot")!;
const multi = quiz.questions.find((question) => question.id === "summer-tour-zakonczenie")!;
const text = quiz.questions.find((question) => question.id === "zmyslanie-faktow")!;
const unscored = quiz.questions.find((question) => question.id === "czy-wszyscy-gotowi")!;
const number = quiz.questions.find((question) => question.id === "ai-devs-absolwenci")!;
/** The last kind to take the seam (roadmap S-08). */
const wordCloud = quiz.questions.find((question) => question.id === "smieszne-slowo-ai")!;

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

describe("only ids the question actually has reach the store", () => {
  it("drops an option id the question does not have", async () => {
    await submit(single.id, ["large-language-model", "nie-ma-takiej-opcji"]);

    // An open endpoint would otherwise let any holder of a player id write a value of
    // their choosing, at a size of their choosing, into the answers hash.
    expect(submitted().optionIds).toEqual(["large-language-model"]);
  });

  it("de-duplicates a repeated id", async () => {
    await submit(single.id, ["large-language-model", "large-language-model"]);

    expect(submitted().optionIds).toEqual(["large-language-model"]);
  });

  it("still scores correctly when unknown ids were sent alongside the right one", async () => {
    // Filtering must not turn a correct answer into a wrong one: an unknown id fails
    // the all-or-nothing match anyway, so dropping it changes nothing about the score.
    await submit(single.id, ["large-language-model", "x".repeat(5_000)]);

    expect(submitted()).toMatchObject({ correct: true });
  });

  it("records an empty selection when every id sent was unknown", async () => {
    await submit(single.id, ["nonsense"]);

    expect(submitted().optionIds).toEqual([]);
    expect(submitted()).toMatchObject({ correct: false, awarded: 0 });
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

/**
 * The free-text branch (roadmap S-05, FR-011).
 *
 * The fold itself is `normalize.test.ts`'s and the rule is `scoring.test.ts`'s. What is
 * under test here is what the route accepts, what it refuses, and what it hands the
 * store.
 */
describe("text answers", () => {
  /**
   * Sends a text submission. **`text` is omitted entirely when `answerText` is
   * undefined**, rather than set to the string `"undefined"` — the absent-field case is
   * the one `lessons.md` rule 2 is about, and a helper that quietly supplies a value
   * would test the present case while reading as though it covered the absent one.
   */
  function submitText(answerText?: string, elapsedMs = 4_000): Promise<Response> {
    const fields: Record<string, string> = {
      playerId: "player-abc",
      questionId: text.id,
      elapsedMs: String(elapsedMs),
    };
    if (answerText !== undefined) fields.text = answerText;

    return answer({ request: request(fields) } as Parameters<typeof answer>[0]) as Promise<Response>;
  }

  beforeEach(() => {
    readSessionMock.mockResolvedValue(openOn(text.id));
  });

  it("accepts a correct answer and stores the raw trimmed text", async () => {
    const response = await submitText("  Halucynacje.  ");

    expect(response.status).toBe(200);
    // Trimmed, but NOT folded — the fold is a comparison artefact, and the reveal shows
    // the attendee what they actually typed.
    expect(submitted().text).toBe("Halucynacje.");
    expect(submitted().optionIds).toEqual([]);
    expect(submitted().correct).toBe(true);
    expect(submitted().awarded).toBeGreaterThan(0);
  });

  it("accepts a wrong answer as a recorded answer worth nothing", async () => {
    const response = await submitText("halucynajce");

    expect(response.status).toBe(200);
    expect(submitted().correct).toBe(false);
    expect(submitted().awarded).toBe(0);
    expect(submitted().text).toBe("halucynajce");
  });

  it("carries no verdict in the response, exactly as the choice path does not", async () => {
    const serialized = JSON.stringify(await body(await submitText("halucynacje")));

    expect(serialized).not.toContain("correct");
    expect(serialized).not.toContain("awarded");
    expect(serialized).not.toContain("total");
  });

  /**
   * **THE ABSENT-FIELD CASE** (`lessons.md` rule 2). A submission that simply omits
   * `text` must be refused, not scored as an empty answer — which would burn FR-004's
   * one-answer-per-question lock on nothing. Asserted by *outcome*: nothing reached the
   * store, and the status is a refusal.
   */
  it("refuses a submission with no text field at all", async () => {
    const response = await submitText();

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Brak odpowiedzi.");
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
    ["tabs and newlines only", "\t\n "],
  ])("refuses a %s answer", async (_label, value) => {
    const response = await submitText(value);

    expect(response.status).toBe(400);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("refuses an over-length answer and writes nothing", async () => {
    // `curl` ignores an input's `maxlength`, which is why this bound is server-side.
    const response = await submitText("a".repeat(MAX_TEXT_ANSWER_LENGTH + 1));

    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain(String(MAX_TEXT_ANSWER_LENGTH));
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("accepts an answer exactly at the bound", async () => {
    const response = await submitText("a".repeat(MAX_TEXT_ANSWER_LENGTH));

    expect(response.status).toBe(200);
    expect(submitAnswerMock).toHaveBeenCalled();
  });

  it("bounds the trimmed length, so surrounding whitespace does not push it over", async () => {
    // The stored value is what the bound protects, and the stored value is trimmed.
    const response = await submitText(`   ${"a".repeat(MAX_TEXT_ANSWER_LENGTH)}   `);

    expect(response.status).toBe(200);
    expect((submitted().text as string).length).toBe(MAX_TEXT_ANSWER_LENGTH);
  });

  it("weights a text answer by speed on the same curve as a choice answer", async () => {
    await submitText("halucynacje", 0);
    const fast = submitted().awarded as number;

    submitAnswerMock.mockClear();
    await submitText("halucynacje", SPEED_WINDOW_MS);
    const slow = submitted().awarded as number;

    expect(fast).toBeGreaterThan(slow);
  });

  it("never lets the typed answer reach a log line", async () => {
    const log = vi.spyOn(console, "log");

    await submitText("halucynacje");

    // `LogFields` is closed and has no field this fits in — that closure is the
    // enforcement. This asserts the enforcement held.
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("halucynacje");
    }
  });
});

describe("numeric guesses", () => {
  /**
   * Sends a numeric submission. **`value` is omitted entirely when `raw` is
   * undefined** — same discipline as `submitText`: the absent-field case is what
   * `lessons.md` rule 2 is about, and a helper that supplied a default would test the
   * present case while reading as though it covered the absent one.
   */
  function submitGuess(raw?: string, elapsedMs = 4_000): Promise<Response> {
    const fields: Record<string, string> = {
      playerId: "player-abc",
      questionId: number.id,
      elapsedMs: String(elapsedMs),
    };
    if (raw !== undefined) fields.value = raw;

    return answer({ request: request(fields) } as Parameters<typeof answer>[0]) as Promise<Response>;
  }

  beforeEach(() => {
    readSessionMock.mockResolvedValue(openOn(number.id));
  });

  it("covers a real number question whose true value is 10 000", () => {
    // The fixture, proved rather than assumed — every expectation below is relative
    // to this value, and a retyped or renamed question would otherwise pass silently.
    if (number.kind !== "number") throw new Error("expected a number question");
    expect(number.correctValue).toBe(10_000);
  });

  it("accepts an exact guess and stores the parsed number", async () => {
    const response = await submitGuess("10000");

    expect(response.status).toBe(200);
    expect(submitted().value).toBe(10_000);
    expect(submitted().optionIds).toEqual([]);
    expect(submitted().text).toBeNull();
    expect(submitted().correct).toBe(true);
    expect(submitted().awarded as number).toBeGreaterThan(0);
  });

  it("accepts a near-miss with a positive award and correct: false", async () => {
    // **The partial-credit case.** 9 800 is inside 5%, so it scores well — and
    // `correct` stays false, because for this kind that flag means "exact hit".
    const response = await submitGuess("9800");

    expect(response.status).toBe(200);
    expect(submitted().correct).toBe(false);
    expect(submitted().awarded as number).toBeGreaterThan(0);
    expect(submitted().value).toBe(9_800);
  });

  it("accepts a wildly wrong guess as a recorded answer worth nothing", async () => {
    const response = await submitGuess("7000");

    expect(response.status).toBe(200);
    expect(submitted().correct).toBe(false);
    expect(submitted().awarded).toBe(0);
  });

  it("accepts a negative guess — wrong is not malformed — and scores it zero", async () => {
    const response = await submitGuess("-10000");

    expect(response.status).toBe(200);
    expect(submitted().value).toBe(-10_000);
    expect(submitted().awarded).toBe(0);
  });

  it("parses a Polish decimal comma", async () => {
    const response = await submitGuess("9800,5");

    expect(response.status).toBe(200);
    expect(submitted().value).toBe(9_800.5);
  });

  /**
   * **The absent-field case, asserted by outcome rather than by status** —
   * `lessons.md` rule 2. A bare `Number()` would have made this a guess of zero: a
   * 200, a burnt one-answer-per-question lock, and an award of nothing that looks
   * exactly like a wrong answer.
   */
  it("refuses a submission with no value field at all, writing nothing", async () => {
    const response = await submitGuess();

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Wpisz liczbę.");
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it.each([["", "empty"], ["   ", "whitespace"], ["abc", "letters"], ["67abc", "a remainder"], ["1e300", "exponent notation"]])(
    "refuses %s (%s) without writing",
    async (value) => {
      const response = await submitGuess(value);

      expect(response.status).toBe(400);
      expect(submitAnswerMock).not.toHaveBeenCalled();
    }
  );

  it("refuses an over-magnitude value with its own message and writes nothing", async () => {
    const response = await submitGuess("9".repeat(13));

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Ta liczba jest poza zakresem.");
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("accepts a value exactly at the bound", async () => {
    const response = await submitGuess(String(MAX_GUESS_MAGNITUDE));

    expect(response.status).toBe(200);
    expect(submitted().value).toBe(MAX_GUESS_MAGNITUDE);
  });

  it("weights the guess by the same speed curve", async () => {
    await submitGuess("10000", 0);
    const fast = submitted().awarded as number;

    submitAnswerMock.mockClear();
    await submitGuess("10000", SPEED_WINDOW_MS);
    const slow = submitted().awarded as number;

    expect(fast).toBeGreaterThan(slow);
  });

  it("carries no verdict in the response, and no guess into the log", async () => {
    const log = vi.spyOn(console, "log");
    const serialized = JSON.stringify(await body(await submitGuess("9800")));

    expect(serialized).not.toContain("correct");
    expect(serialized).not.toContain("awarded");
    expect(serialized).not.toContain("total");
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("9800");
    }
  });
});

/**
 * The word-cloud branch (roadmap S-08, FR-012).
 *
 * The fold and the validation rule are `words.test.ts`'s. What is under test here is what
 * the route accepts, what it refuses, which status each refusal carries, and what it hands
 * the store.
 */
describe("word-cloud answers", () => {
  it("covers a question that really is a word cloud, and an unscored one", () => {
    // The fixture proved rather than assumed: every expectation below depends on both,
    // and a retyped question would otherwise pass silently.
    expect(wordCloud.kind).toBe("word-cloud");
    expect(wordCloud.points).toBeNull();
  });

  /**
   * Sends a word submission. **`word` is omitted entirely when `value` is undefined**,
   * rather than set to the string `"undefined"` — the absent-field case is what
   * `lessons.md` rule 2 is about, and a helper that quietly supplied a value would test
   * the present case while reading as though it covered the absent one. Same discipline
   * as `submitText` and `submitGuess` above.
   */
  function submitWord(value?: string, elapsedMs = 4_000): Promise<Response> {
    const fields: Record<string, string> = {
      playerId: "player-abc",
      questionId: wordCloud.id,
      elapsedMs: String(elapsedMs),
    };
    if (value !== undefined) fields.word = value;

    return answer({ request: request(fields) } as Parameters<typeof answer>[0]) as Promise<Response>;
  }

  beforeEach(() => {
    readSessionMock.mockResolvedValue(openOn(wordCloud.id));
  });

  it("accepts a word and stores the typed form beside the folded one", async () => {
    const response = await submitWord("  Halucynacja  ");

    expect(response.status).toBe(200);
    // Trimmed but not folded — what the reveal echoes back.
    expect(submitted().text).toBe("Halucynacja");
    // Folded — what the counter is keyed by, so case does not split one word in two.
    expect(submitted().word).toBe("halucynacja");
    expect(submitted().optionIds).toEqual([]);
    expect(submitted().value).toBeNull();
  });

  it("records it as unscored rather than as wrong", async () => {
    await submitWord("robot");

    // No scorer runs: the build gate guarantees `points === null` for this kind. The view
    // tells a warm-up apart from a wrong answer by `scored`, never by the award.
    expect(submitted().correct).toBe(false);
    expect(submitted().awarded).toBe(0);
  });

  it("awards nothing however fast the answer was", async () => {
    await submitWord("robot", 0);

    // The speed curve multiplies a base of zero. Asserted because "fast" and "scored"
    // are wired together everywhere else in this route.
    expect(submitted().awarded).toBe(0);
  });

  it("keeps a word carrying Polish diacritics spelled as it was typed", async () => {
    await submitWord("Żółw");

    expect(submitted().text).toBe("Żółw");
    // The fold lowercases and stops. This is the string the projector renders, so a
    // stripped diacritic here is a misspelt word on the big screen.
    expect(submitted().word).toBe("żółw");
  });

  it("folds two spellings of one word onto a single counter key", async () => {
    await submitWord("SkyNet");
    const first = submitted().word;

    submitAnswerMock.mockClear();
    await submitWord("skynet");

    expect(submitAnswerMock.mock.calls[0]![0].word).toBe(first);
  });

  it("carries no verdict in the response", async () => {
    const response = await submitWord("robot");

    expect(await body(response)).toEqual({ accepted: true });
  });

  it("never lets the word reach a log line", async () => {
    const log = vi.spyOn(console, "log");

    await submitWord("halucynacja");

    // A word is attendee-authored text and logs are covered by no TTL and no purge.
    // `LogFields` has no field it fits in; this pins that the call site respected it.
    for (const call of log.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("halucynacja");
    }
  });

  /**
   * **THE ABSENT-FIELD CASE** (`lessons.md` rule 2), asserted by outcome: nothing reached
   * the store. A submission that omits `word` must not burn FR-004's
   * one-answer-per-question lock on nothing.
   */
  it("refuses a submission with no word field at all, writing nothing", async () => {
    const response = await submitWord();

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Brak odpowiedzi.");
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it.each([
    ["empty", "", "Napisz jedno słowo."],
    ["whitespace only", "   ", "Napisz jedno słowo."],
    ["two words", "sztuczna inteligencja", "Wpisz tylko jedno słowo — bez spacji."],
    ["an emoji", "🤖", "Słowo może zawierać tylko litery, cyfry i znaki . _ - '"],
  ])("refuses %s with its own message and writes nothing", async (_label, value, message) => {
    const response = await submitWord(value);

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe(message);
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("refuses an over-length word — curl ignores maxlength", async () => {
    const response = await submitWord("a".repeat(MAX_WORD_LENGTH + 1));

    expect(response.status).toBe(400);
    expect((await body(response)).error).toContain(String(MAX_WORD_LENGTH));
    expect(submitAnswerMock).not.toHaveBeenCalled();
  });

  it("accepts a word exactly at the bound", async () => {
    const response = await submitWord("a".repeat(MAX_WORD_LENGTH));

    expect(response.status).toBe(200);
    expect(submitAnswerMock).toHaveBeenCalled();
  });

  /**
   * **400, not 409, and the distinction is the whole reason this is asserted.** The
   * client treats a 409 as final: it locks the question and takes the field away. A
   * refusal an attendee can fix must leave both, or someone who typed two words is told
   * their answer was saved and can never answer the question.
   */
  it("refuses with a status the client will not treat as final", async () => {
    const response = await submitWord("dwa slowa");

    expect(response.status).toBe(400);
    expect(response.status).not.toBe(409);
  });
});

describe("refusals", () => {
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
