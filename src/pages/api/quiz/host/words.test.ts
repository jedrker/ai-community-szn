import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The word-cloud endpoint (roadmap S-08, PRD FR-012/FR-015).
 *
 * The store is mocked — what is under test is the response contract and the properties this
 * route exists to hold: that it never writes, that it refuses a question of another kind
 * rather than inventing an empty cloud, and that "could not say" never reaches the projector
 * as "nobody wrote anything". Follows `participation.test.ts`'s shape throughout, because
 * the two routes hold the same structural rules for the same reasons.
 */

const readWordCloudMock = vi.fn();
const readPlayerCountMock = vi.fn();

vi.mock("../../../../lib/session/store", () => ({
  readWordCloud: readWordCloudMock,
  readPlayerCount: readPlayerCountMock,
}));

const { GET: words } = await import("./words");
const { HOST_SECRET_HEADER } = await import("../../../../lib/session/host");
const { quizzes } = await import("../../../../quiz/index");
// One quiz to run a session against — which one is not what anything here asserts.
const quiz = quizzes[0]!;

const SECRET = "a-very-long-test-secret-value";

/** The word-cloud question, found by kind rather than by position. */
const WORD_CLOUD = quiz.questions.find(
  (question) => question.kind === "word-cloud",
)!;
/** A question of another kind, for the refusal below. */
const CHOICE = quiz.questions.find(
  (question) => question.kind === "single-choice",
)!;

const EMPTY = { answered: 0, distinct: 0, words: [] };

/**
 * Astro hands the handler a full `APIContext`; this route reads `request` and `url`.
 *
 * **`null` means "omit the parameter entirely"**, for both fields — deliberately not
 * `undefined`, which a destructuring default silently replaces with the happy value.
 * `participation.test.ts` records that this is not hypothetical: written the obvious way,
 * the absent-questionId case tested the *present* one and passed against a route with no
 * guard at all.
 */
function call({
  secret = SECRET,
  questionId = WORD_CLOUD.id,
}: {
  secret?: string | null;
  questionId?: string | null;
} = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers[HOST_SECRET_HEADER] = secret;

  const url = new URL("https://example.test/api/quiz/host/words");
  if (questionId !== null) url.searchParams.set("questionId", questionId);

  return words({
    request: new Request(url, { method: "GET", headers }),
    url,
  } as never) as Promise<Response>;
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

beforeEach(() => {
  readWordCloudMock.mockReset();
  readPlayerCountMock.mockReset();
  readWordCloudMock.mockResolvedValue(EMPTY);
  readPlayerCountMock.mockResolvedValue(0);
  vi.stubEnv("LIVEQUIZ_HOST_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the fixtures are what the tests claim", () => {
  it("uses a real word-cloud question and a real question of another kind", () => {
    // Proved rather than assumed: the kind refusal below is meaningless if both fixtures
    // happen to be the same kind, and a positional lookup into real data is the mistake
    // `lessons.md` has an entry about.
    expect(WORD_CLOUD.kind).toBe("word-cloud");
    expect(CHOICE.kind).not.toBe("word-cloud");
  });
});

describe("GET /api/quiz/host/words", () => {
  it("returns the cloud, the answered count and the live join count", async () => {
    readWordCloudMock.mockResolvedValue({
      answered: 37,
      distinct: 12,
      words: [
        { word: "halucynacja", count: 9 },
        { word: "robot", count: 4 },
      ],
    });
    readPlayerCountMock.mockResolvedValue(150);

    const response = await call();

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      questionId: WORD_CLOUD.id,
      answered: 37,
      playerCount: 150,
      words: [
        { word: "halucynacja", count: 9 },
        { word: "robot", count: 4 },
      ],
      distinct: 12,
    });
  });

  it("echoes the requested questionId back", async () => {
    // The host may advance mid-flight, and a cloud painted under the next question's prompt
    // would look entirely plausible. The echo is what lets the page discard it.
    expect((await body(await call())).questionId).toBe(WORD_CLOUD.id);
  });

  it("reports distinct above the number of words it returned", async () => {
    readWordCloudMock.mockResolvedValue({
      answered: 60,
      distinct: 47,
      words: Array.from({ length: 30 }, (_, index) => ({
        word: `w${index}`,
        count: 1,
      })),
    });

    const payload = await body(await call());

    // The truncation is not silent: the panel can say "30 of 47" rather than presenting the
    // top of the list as the whole room.
    expect((payload.words as unknown[]).length).toBe(30);
    expect(payload.distinct).toBe(47);
  });

  it("returns exactly questionId, answered, playerCount, words and distinct", async () => {
    // One shape, so nothing extra can leak into a response the projector renders.
    expect(Object.keys(await body(await call())).sort()).toEqual([
      "answered",
      "distinct",
      "playerCount",
      "questionId",
      "words",
    ]);
  });

  it("is never cached", async () => {
    // A cached cloud is a projector that has quietly stopped filling — from the back of a
    // room, indistinguishable from one nobody is answering.
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("passes a null join count through rather than turning it into zero", async () => {
    readPlayerCountMock.mockResolvedValue(null);

    // `null` is "the store could not say"; the page keeps the number it already has. A `0`
    // would be the claim that the room is empty.
    expect((await body(await call())).playerCount).toBeNull();
  });

  it("serves an empty cloud as a 200, not as a failure", async () => {
    readWordCloudMock.mockResolvedValue(EMPTY);

    const response = await call();

    // Nobody has answered yet — a real state, and the state every question is in for its
    // first seconds.
    expect(response.status).toBe(200);
    expect((await body(response)).words).toEqual([]);
  });
});

describe("the host secret gates it", () => {
  it("refuses a request with no secret", async () => {
    const response = await call({ secret: null });

    expect(response.status).toBe(401);
    expect(readWordCloudMock).not.toHaveBeenCalled();
  });

  it("refuses a wrong secret", async () => {
    const response = await call({ secret: "nope" });

    expect(response.status).toBe(401);
    expect(readWordCloudMock).not.toHaveBeenCalled();
  });

  it("refuses when no secret is configured at all", async () => {
    vi.unstubAllEnvs();

    expect((await call()).status).toBe(401);
    expect(readWordCloudMock).not.toHaveBeenCalled();
  });

  it("carries no-store even on a refusal", async () => {
    expect((await call({ secret: null })).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
});

describe("an unusable questionId is refused, never guessed", () => {
  it.each([
    ["omitted entirely", null],
    ["empty", ""],
    ["unknown to the definition", "nie-ma-takiego-pytania"],
  ])("refuses a questionId that is %s", async (_label, questionId) => {
    const response = await call({ questionId });

    // Never a fallback to whatever the session has open, and never an empty cloud — which
    // on the projector is the specific claim that nobody in the room wrote a word.
    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe("Nieznane pytanie.");
    expect(readWordCloudMock).not.toHaveBeenCalled();
  });

  /**
   * **A question of another kind is refused rather than answered with an empty cloud.**
   *
   * Every word field is scoped by question id, so a choice question's cloud would read back
   * empty — which is exactly the value that means "nobody has written anything" where that
   * claim is meaningful. Refusing keeps the two apart, and stops a client rendering a cloud
   * panel under a question that has none.
   */
  it("refuses a question that is not a word cloud", async () => {
    const response = await call({ questionId: CHOICE.id });

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe(
      "To pytanie nie jest chmurą słów.",
    );
    expect(readWordCloudMock).not.toHaveBeenCalled();
  });
});

describe("a store failure is not an empty cloud", () => {
  it("reports 503 when the cloud cannot be read", async () => {
    readWordCloudMock.mockResolvedValue(null);

    const response = await call();

    // The page takes its staleness path and holds the cloud it has. A 200 with no words
    // would tell the room it had written nothing.
    expect(response.status).toBe(503);
    expect((await body(response)).error).toBe(
      "Nie udało się odczytać chmury słów.",
    );
  });

  it("keeps the two absences distinguishable", async () => {
    readWordCloudMock.mockResolvedValue(null);
    const failed = (await call()).status;

    readWordCloudMock.mockResolvedValue(EMPTY);
    const empty = (await call()).status;

    // The whole point of `readWordCloud` returning `null` rather than an empty cloud.
    expect(failed).not.toBe(empty);
  });
});

/**
 * THE STRUCTURAL GATE.
 *
 * Scans this route's own source, because the property is about what the code is *able* to
 * do rather than what it does on any one request — a behavioural test passes happily the day
 * someone adds the import. `participation.test.ts` carries the same gate for the same reason.
 */
describe("the route's shape", () => {
  /**
   * **Comments are stripped before scanning, and that is not a loophole.** This route's
   * docstrings name `writeSession` and `updatedAt` explicitly, because a rule whose reason
   * is not written next to it is a rule someone deletes — and a scan over raw source would
   * force the file to choose between explaining itself and passing. What the gate is about
   * is what the code can *call*, which lives in the code.
   */
  const source = readFileSync(
    fileURLToPath(new URL("./words.ts", import.meta.url)),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("still has code left to scan after the comments are stripped", () => {
    // Without this, a stripper that over-matched would empty the source and turn the gate
    // below green by vacuity.
    expect(source).toContain("readWordCloud");
    expect(source).toContain("export const GET");
  });

  it("calls no write path", () => {
    /**
     * `answer.ts` explains the stake: during `question-open`, `updatedAt` is the moment the
     * question opened and bounds the speed clamp. A write from a polled host-side route
     * moves it forward and inflates every award after it, silently — and this route is
     * polled while a question is open, which is precisely when that matters.
     */
    for (const forbidden of [
      "writeSession",
      "endSession",
      "applyHostAction",
      "createSession",
    ]) {
      expect(
        source,
        `words.ts must not reference ${forbidden} — it is a read`,
      ).not.toContain(forbidden);
    }
  });

  it("does not publish to the channel", () => {
    // The decision the whole slice rests on: a cloud that fills as the room types has no
    // host action to ride, and publishing per submission is the O(N^2) fan-out the spine
    // contract forbids. This is what keeps it off the wire.
    expect(source).not.toContain("publishSnapshot");
    expect(source).not.toContain("SESSION_CHANNEL");
  });
});
