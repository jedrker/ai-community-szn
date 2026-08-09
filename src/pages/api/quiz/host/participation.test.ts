import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The participation endpoint (roadmap S-04, PRD FR-005).
 *
 * The store is mocked — what is under test is the response contract and the two
 * properties this route exists to hold: that it never writes, and that per-option data
 * is unreachable from it. Follows `state.test.ts`'s shape.
 */

const readAnsweredCountMock = vi.fn();
const readPlayerCountMock = vi.fn();
const readQuestionTalliesMock = vi.fn();

vi.mock("../../../../lib/session/store", () => ({
  readAnsweredCount: readAnsweredCountMock,
  readPlayerCount: readPlayerCountMock,
  readQuestionTallies: readQuestionTalliesMock,
}));

const { GET: participation } = await import("./participation");
const { HOST_SECRET_HEADER } = await import("../../../../lib/session/host");
const { quiz } = await import("../../../../quiz/index");

const SECRET = "a-very-long-test-secret-value";
const QUESTION_ID = quiz.questions[0]!.id;

/**
 * Astro hands the handler a full `APIContext`; this route reads `request` and `url`.
 *
 * **`null` means "omit the parameter entirely"**, for both fields — deliberately not
 * `undefined`, which a destructuring default silently replaces with the happy value.
 * That is not a hypothetical: written the obvious way, the absent-questionId case below
 * quietly tested the *present* one and passed against a route that had no guard at all.
 * Omission is the case `lessons.md` says to test, so it needs a spelling the language
 * cannot swallow.
 */
function call({
  secret = SECRET,
  questionId = QUESTION_ID,
}: { secret?: string | null; questionId?: string | null } = {}): Promise<Response> {
  const headers: Record<string, string> = {};
  if (secret !== null) headers[HOST_SECRET_HEADER] = secret;

  const url = new URL("https://example.test/api/quiz/host/participation");
  if (questionId !== null) url.searchParams.set("questionId", questionId);

  return participation({
    request: new Request(url, { method: "GET", headers }),
    url,
  } as never) as Promise<Response>;
}

beforeEach(() => {
  readAnsweredCountMock.mockReset();
  readPlayerCountMock.mockReset();
  readQuestionTalliesMock.mockReset();
  readAnsweredCountMock.mockResolvedValue(0);
  readPlayerCountMock.mockResolvedValue(0);
  vi.stubEnv("LIVEQUIZ_HOST_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/quiz/host/participation", () => {
  it("returns the answered count and the live join count", async () => {
    readAnsweredCountMock.mockResolvedValue(37);
    readPlayerCountMock.mockResolvedValue(112);

    const response = await call();
    const body = (await response.json()) as {
      questionId: string;
      answered: number;
      playerCount: number | null;
    };

    expect(response.status).toBe(200);
    expect(body.answered).toBe(37);
    expect(body.playerCount).toBe(112);
    expect(readAnsweredCountMock).toHaveBeenCalledWith(QUESTION_ID);
  });

  /**
   * The echo is not decoration. The host page polls on a timer while the host is free
   * to advance at any moment, so a reply can arrive after the question changed. Without
   * the echo the page would paint a count from the previous question under the new
   * prompt, and the number would look entirely plausible.
   */
  it("echoes the requested questionId back", async () => {
    const second = quiz.questions[1]!.id;

    const body = (await (await call({ questionId: second })).json()) as { questionId: string };

    expect(body.questionId).toBe(second);
  });

  /**
   * Asserted against the key SET, not by picking fields out of it. A future field added
   * to this response is a future field on a path served *while the question is open* —
   * which is the one thing FR-005 was revised to prevent — so it must not be possible to
   * add one without a test noticing.
   */
  it("returns exactly questionId, answered and playerCount", async () => {
    const body = (await (await call()).json()) as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual(["answered", "playerCount", "questionId"]);
  });

  it("is never cached", async () => {
    // Polled every couple of seconds: a cached count is a projector that has quietly
    // stopped moving, which from the back of a room looks like a count that is not
    // rising.
    expect((await call()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns null rather than zero when the join count cannot be read", async () => {
    readPlayerCountMock.mockResolvedValue(null);

    const body = (await (await call()).json()) as { playerCount: number | null };

    expect(body.playerCount).toBeNull();
  });
});

describe("the host secret gates it", () => {
  it.each([
    ["a missing secret", null],
    ["a wrong secret", "not-the-secret-value-at-all"],
  ])("rejects %s with 401 and reads nothing", async (_label, secret) => {
    const response = await call({ secret });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toHaveProperty("error");
    // Unlike `/api/quiz/state`, which is open because it returns only what is already
    // broadcast. An answered count is not broadcast, and an endpoint built to be polled
    // is the cheapest way to run up commands against the budget.
    expect(readAnsweredCountMock).not.toHaveBeenCalled();
    expect(readPlayerCountMock).not.toHaveBeenCalled();
  });
});

describe("an unusable questionId is refused, never guessed", () => {
  /**
   * `lessons.md`, "Absent untrusted input must fail toward the safe end". The hostile
   * value here is an unknown id; the *absent* one is the parameter simply not being
   * sent, which is what a client bug or a future caller produces. Both must refuse.
   * Neither may fall back to the session's current question — which would report a
   * count for a question the caller is not showing — and neither may answer `0`, which
   * on a projector is the specific claim that nobody in the room has answered.
   */
  it.each([
    ["an absent questionId", null],
    ["an empty questionId", ""],
    ["an unknown questionId", "pytanie-ktorego-nie-ma"],
  ])("refuses %s with 400 and reads nothing", async (_label, questionId) => {
    const response = await call({ questionId });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toHaveProperty("error");
    expect(readAnsweredCountMock).not.toHaveBeenCalled();
  });
});

describe("a store failure is not a count of zero", () => {
  it("reports 503 when the count cannot be read", async () => {
    readAnsweredCountMock.mockResolvedValue(null);

    const response = await call();

    // `null` from the store means "could not say". Serving it as a 200 with a zero — or
    // as a 200 the page has to decode a second flavour of absence out of — is how a
    // projector ends up telling the room that nobody answered.
    expect(response.status).toBe(503);
  });
});

/**
 * THE TWO STRUCTURAL GATES.
 *
 * Both scan this route's own source, because both properties are about what the code is
 * *able* to do rather than what it does on any one request — and a behavioural test
 * passes happily the day someone adds the import.
 */
describe("the route's shape", () => {
  /**
   * **Comments are stripped before scanning, and that is not a loophole.** The route's
   * docstrings name `writeSession` and `readQuestionTallies` explicitly, because a rule
   * whose reason is not written next to it is a rule someone deletes — and a scan over
   * raw source would force the file to choose between explaining itself and passing.
   * What these gates are about is what the code can *call*, which lives in the code.
   */
  const source = readFileSync(fileURLToPath(new URL("./participation.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("still has code left to scan after the comments are stripped", () => {
    // Without this, a stripper that over-matched would empty the source and turn both
    // gates below green by vacuity — the failure mode `keys.test.ts` guards with its
    // own non-empty-registry assertion.
    expect(source).toContain("readAnsweredCount");
    expect(source).toContain("export const GET");
  });

  it("calls no write path", () => {
    /**
     * `answer.ts` explains the stake: during `question-open`, `updatedAt` is the moment
     * the question opened and bounds the speed clamp. A write from a polled host-side
     * route moves it forward and inflates every award after it, silently.
     */
    for (const forbidden of ["writeSession", "endSession", "applyHostAction", "createSession"]) {
      expect(source, `participation.ts must not reference ${forbidden} — it is a read`).not.toContain(
        forbidden
      );
    }
  });

  it("cannot reach the distribution", () => {
    // Not withheld by this handler choosing what to serialize — unreachable. The two
    // reads are separate functions in `store.ts` precisely so this assertion can be
    // about an import rather than about a response body.
    expect(source).not.toContain("readQuestionTallies");
    expect(readQuestionTalliesMock).not.toHaveBeenCalled();
  });
});
