import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The reveal-race refusal, across the seam (rollout phase 2, test-plan §2 Risk #4).
 *
 * **Both halves of this are already green, and neither can see the failure.**
 * `answer.test.ts` asserts the route maps a store-level `not-open` to a 409;
 * `src/lib/client/answer.test.ts` asserts the client maps a refusal-less 409 to
 * `rejected`. Each is right about its own module. The defect lives in the composition:
 * an answer the store never recorded is reported to the attendee as recorded, their
 * control is taken away, and nothing on any screen says so.
 *
 * So this file runs the **real route** against the **real client submitter**, with only
 * the transport between them stubbed. That is the whole recipe, and it needs no store:
 * the interleaving is produced by letting the two mocks the suite already has *disagree* —
 * `readSession` says the question is open, `submitAnswer` says it is not — which is
 * exactly what a reveal landing between the route's read and the script's own re-read
 * looks like from inside the request.
 *
 * **Environment is the suite default (`node`), deliberately.** The client's `submitAnswer`
 * touches no DOM — `window.localStorage` appears only in that module's other exports — so
 * a happy-dom docblock here would buy nothing and inherit the `localStorage` Proxy trap
 * CLAUDE.md documents.
 *
 * **What is pinned versus what is asserted.** The `expired` case below is the contract as
 * designed (S-11 gave it its own refusal class precisely so it would not take the final
 * path). The `not-open` case is a **defect, pinned** — see the note on that test.
 */

const readSessionMock = vi.fn();
const submitAnswerMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  readSession: readSessionMock,
  submitAnswer: submitAnswerMock,
}));

const { POST: route } = await import("./answer");
const { submitAnswer: clientSubmit } =
  await import("../../../lib/client/answer");
const { questionOfKind } = await import("../../../quiz/test-support");
const { SUBMISSION_GRACE_MS } = await import("../../../lib/session/deadline");

/**
 * Real question, resolved by kind — the route looks it up through `getQuestionById`, so a
 * hand-built fixture 404s here. Same rule as `answer.test.ts`: by kind, never by id.
 */
const question = questionOfKind("single-choice", { scored: true });
const correctOptionId = question.correctOptionIds[0]!;
const LIMIT_MS = question.timeLimitSeconds! * 1_000;

const NOW = 1_785_000_000_000;
const PLAYER_ID = "player-seam";

/**
 * A session with the question genuinely open and time left on it.
 *
 * `updatedAt` is derived from the question's own limit rather than typed, so this cannot
 * drift into the expired branch when the quiz is edited — the trap
 * `per-question-timer/reviews/impl-review.md` records, where a test passed because of the
 * grace window rather than because of the rule it named.
 */
function openSession(openedAt = NOW - Math.floor(LIMIT_MS / 2)) {
  return {
    outcome: "ok" as const,
    state: {
      version: 5,
      phase: "question-open" as const,
      currentQuestionId: question.id,
      startedAt: NOW - 120_000,
      updatedAt: openedAt,
      playerCount: 12,
      revealedOptionIds: null,
    },
  };
}

/** The route's own answer, kept for the assertions below. See the clone note inside. */
let routeResponse: Response | null = null;

/**
 * The transport, and the only thing stubbed.
 *
 * The client builds its own `FormData` and calls `fetch`; this hands that request to the
 * route and gives the route's real `Response` back. Nothing here reshapes the body, the
 * status or the refusal class — a helper that built its own response would be testing
 * this file rather than the two modules.
 */
function routeAsTransport(): void {
  routeResponse = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const request = new Request("https://example.test/api/quiz/answer", {
        method: "POST",
        body: init.body,
      });
      const response = (await route({ request } as Parameters<
        typeof route
      >[0])) as Response;
      /**
       * Cloned **here**, not at the assertion. The client reads the body itself, and a
       * `Response` body is a one-shot stream — a clone taken afterwards throws "Body has
       * already been consumed". Taking it before the client sees it also keeps this the
       * observer it claims to be: the client is handed the original, untouched.
       */
      routeResponse = response.clone();
      return response;
    }),
  );
}

/** What the route actually answered, for asserting *why* the client mapped it as it did. */
async function routeBody(): Promise<Record<string, unknown>> {
  if (routeResponse === null) throw new Error("the route was never called");
  return (await routeResponse.json()) as Record<string, unknown>;
}

function submit(): ReturnType<typeof clientSubmit> {
  return clientSubmit(
    PLAYER_ID,
    question.id,
    { kind: "choice", optionIds: [correctOptionId] },
    4_000,
  );
}

beforeEach(() => {
  readSessionMock.mockReset();
  submitAnswerMock.mockReset();
  readSessionMock.mockResolvedValue(openSession());
  submitAnswerMock.mockResolvedValue({ outcome: "accepted", total: 920 });
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.spyOn(console, "log").mockImplementation(() => {});
  routeAsTransport();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("an answer that lands as the host reveals", () => {
  it("is reported to the attendee as recorded, though nothing was written", async () => {
    /**
     * **The pinned defect.** The reveal lands between the route's `readSession` and the
     * script's own `GET`, so the script refuses with `not-open` and writes nothing. The
     * route answers 409 — correctly, the store is right and the route was a beat behind —
     * but that 409 carries no refusal class, and the client treats every classless 409 as
     * `rejected`, which is **final**: the page marks the question submitted and takes the
     * control away. The attendee believes they answered; the store holds nothing.
     *
     * S-11 shows the shape of the fix — `expired` was given its own class for exactly this
     * reason — and applying it to `not-open` is a product change beyond a testing rollout.
     *
     * **If this test fails, the defect was fixed: invert the expectation and delete this
     * note — do not restore the behaviour.**
     */
    submitAnswerMock.mockResolvedValue({ outcome: "not-open" });

    const outcome = await submit();

    expect(outcome).toEqual({
      outcome: "rejected",
      error: expect.any(String),
    });
    // Prove the fixture reached the branch it names: the route got as far as the script,
    // rather than refusing at its own phase gate above it.
    expect(submitAnswerMock).toHaveBeenCalledTimes(1);
  });

  it("carries no refusal class, which is why it maps as final", async () => {
    // The mechanism behind the test above, asserted separately so a fix that adds a class
    // fails *here* with a legible reason rather than only as a changed outcome.
    submitAnswerMock.mockResolvedValue({ outcome: "not-open" });

    await submit();

    const body = await routeBody();
    expect(body.error).toEqual(expect.any(String));
    expect(body).not.toHaveProperty("refusal");
  });
});

describe("an answer that misses the deadline", () => {
  it("reaches the attendee as expired rather than as a final refusal", async () => {
    /**
     * The contrast, and the reason it lives beside the case above rather than in either
     * module's own suite: the two refusals are both 409s from the same route, and it is
     * only across the seam that the asymmetry between them is visible in one place.
     *
     * This half is the design working. `expired` is not final on the client, so the
     * attendee keeps a control and a truthful message.
     */
    readSessionMock.mockResolvedValue(
      openSession(NOW - LIMIT_MS - SUBMISSION_GRACE_MS - 1),
    );

    const outcome = await submit();

    expect(outcome).toEqual({
      outcome: "expired",
      error: expect.any(String),
    });
    // The refusal costs no write: the route stops above the script.
    expect(submitAnswerMock).not.toHaveBeenCalled();
    expect(await routeBody()).toMatchObject({ refusal: "expired" });
  });
});

describe("the seam itself", () => {
  it("passes an accepted answer straight through", async () => {
    // The baseline. Without it the two refusals above could both be produced by a broken
    // transport stub, and every assertion in this file would be about nothing.
    expect(await submit()).toEqual({ outcome: "accepted" });
  });
});
