import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The distribution drift at the reveal (rollout phase 2, test-plan §2 Risk #4).
 *
 * **`reveal.ts` reads the tallies outside the version guard**, and that is accepted and
 * documented (`reveal.ts:104-108`, `host-participation-and-distribution/participation-contract.md`).
 * What was never asserted is the bound: "at most a one-answer drift" is a claim in a
 * comment, and the gap it describes is wider than it sounds — `applyHostAction` makes a
 * further round trip (`readPlayerCount`) between the callback that reads the tallies and
 * the compare-and-set that commits.
 *
 * **This file exists because `routes.test.ts` cannot express it.** That file mocks
 * `applyHostAction` itself, so the gap is not there to interleave into. Here the store is
 * mocked and `applyHostAction` is **real**, which is the only arrangement in which the
 * read, the gap and the write are three separate moments.
 *
 * The concurrent answer is landed from the `readPlayerCount` mock — the one await the real
 * `applyHostAction` makes inside the gap. Landing it anywhere else models a race that
 * cannot happen, and the test would assert nothing.
 *
 * **The drift is a defect, pinned rather than fixed** (test-plan's 2026-08-16 decision).
 * See the note on the first test.
 */

const readSessionMock = vi.fn();
const writeSessionMock = vi.fn();
const readPlayerCountMock = vi.fn();
const readQuestionTalliesMock = vi.fn();
const publishSnapshotMock = vi.fn();

vi.mock("../../../../lib/session/store", () => ({
  readSession: readSessionMock,
  writeSession: writeSessionMock,
  readPlayerCount: readPlayerCountMock,
  readQuestionTallies: readQuestionTalliesMock,
}));
vi.mock("../../../../lib/session/realtime", () => ({
  publishSnapshot: publishSnapshotMock,
  SESSION_CHANNEL: "livequiz:session",
  SNAPSHOT_EVENT: "snapshot",
}));

const { POST: reveal } = await import("./reveal");
const { HOST_SECRET_HEADER } = await import("../../../../lib/session/host");
const { questionOfKind } = await import("../../../../quiz/test-support");
import type { SessionState } from "../../../../lib/session/state";

const SECRET = "a-very-long-test-secret-value";
const NOW = 1_785_000_000_000;

/** By kind, never by id — the route resolves it through `getQuestionById`. */
const question = questionOfKind("single-choice", { scored: true });
const [firstOption, secondOption] = question.options;

/**
 * The store's answer tallies, as a mutable object the test can move mid-request.
 *
 * This stands in for `livequiz:tallies`. Nothing here models the Lua — the atomic script
 * is `store.test.ts`'s subject and its real behaviour is only reachable from
 * `scripts/rehearse-room.ts`. What is modelled is the one thing this seam owns: **when**
 * the reveal looks at the counters relative to when it commits.
 */
let tallies: { answered: number; options: Record<string, number> };

/** One more answer arrives — the same shape `submitAnswer`'s increments would leave. */
function landOneAnswer(): void {
  tallies = {
    answered: tallies.answered + 1,
    options: {
      ...tallies.options,
      [firstOption!.id]: (tallies.options[firstOption!.id] ?? 0) + 1,
    },
  };
}

function openSession() {
  return {
    outcome: "ok" as const,
    state: {
      version: 7,
      phase: "question-open" as const,
      currentQuestionId: question.id,
      startedAt: NOW - 120_000,
      updatedAt: NOW - 20_000,
      playerCount: 12,
    } as unknown as SessionState,
  };
}

/** What the route asked the store to commit. */
function written(): SessionState {
  return writeSessionMock.mock.calls[0]![1] as SessionState;
}

function callReveal(): Promise<Response> {
  return reveal({
    request: new Request("https://example.test/api/quiz/host/reveal", {
      method: "POST",
      headers: {
        Origin: "https://example.test",
        [HOST_SECRET_HEADER]: SECRET,
      },
    }),
  } as never) as Promise<Response>;
}

beforeEach(() => {
  readSessionMock.mockReset();
  writeSessionMock.mockReset();
  readPlayerCountMock.mockReset();
  readQuestionTalliesMock.mockReset();
  publishSnapshotMock.mockReset();

  tallies = {
    answered: 3,
    options: { [firstOption!.id]: 2, [secondOption!.id]: 1 },
  };

  readSessionMock.mockResolvedValue(openSession());
  // A snapshot of the counters as they stand when the callback asks — the read is a round
  // trip, so what comes back is a copy, not a live view.
  readQuestionTalliesMock.mockImplementation(async () => ({
    answered: tallies.answered,
    options: { ...tallies.options },
  }));
  readPlayerCountMock.mockResolvedValue(12);
  writeSessionMock.mockImplementation(async (_version, next) => ({
    outcome: "applied" as const,
    state: next,
  }));
  publishSnapshotMock.mockResolvedValue({ outcome: "ok" });
  vi.stubEnv("LIVEQUIZ_HOST_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("an answer landing between the tally read and the commit", () => {
  it("is in the store's counters but not in the distribution the room is shown", async () => {
    /**
     * **The pinned drift.** The answer arrives after the callback has read the counters
     * and before the compare-and-set — so the store holds four answers and the projector
     * draws three. On stage this is a bar chart that is quietly one short, at the exact
     * moment the room is looking at it.
     *
     * Accepted at the time, and the accepting comment is right that the window is small.
     * What the comment cannot do is hold: nothing stops the gap widening, and a second
     * round trip added inside `applyHostAction` would enlarge it with no test to notice.
     *
     * **If this test fails, the drift was closed: invert the expectation and delete this
     * note — do not restore the behaviour.**
     */
    readPlayerCountMock.mockImplementation(async () => {
      landOneAnswer();
      return 12;
    });

    const response = await callReveal();
    expect(response.status).toBe(200);

    // The room sees the pre-gap count…
    expect(written().revealedDistribution).toEqual({
      answered: 3,
      options: { [firstOption!.id]: 2, [secondOption!.id]: 1 },
    });
    // …while the store holds the answer that landed.
    expect(tallies.answered).toBe(4);
  });

  it("publishes exactly the document it committed", async () => {
    // The drift reaches every device, not just the store: there is no second read between
    // the write and the broadcast that could reconcile it.
    readPlayerCountMock.mockImplementation(async () => {
      landOneAnswer();
      return 12;
    });

    await callReveal();

    expect(publishSnapshotMock).toHaveBeenCalledWith(written());
    expect(
      (publishSnapshotMock.mock.calls[0]![0] as SessionState)
        .revealedDistribution,
    ).toMatchObject({ answered: 3 });
  });

  it("reads the tallies once, and before the write", async () => {
    /**
     * The two facts that place the read outside the guard. A read moved below the write —
     * or repeated after it — would change the drift above, so this states the ordering the
     * first test's expectation depends on rather than leaving it implied.
     */
    await callReveal();

    expect(readQuestionTalliesMock).toHaveBeenCalledTimes(1);
    expect(readQuestionTalliesMock.mock.invocationCallOrder[0]!).toBeLessThan(
      writeSessionMock.mock.invocationCallOrder[0]!,
    );
  });
});

describe("with nothing landing in the gap", () => {
  it("shows the room exactly what the store holds", async () => {
    /**
     * The control, and it is not decoration: without it every assertion above would also
     * pass against a reveal that published a hard-coded three, or that dropped the tally
     * read entirely. This is the case that proves the distribution tracks the counters.
     */
    await callReveal();

    expect(written().revealedDistribution).toEqual({
      answered: tallies.answered,
      options: tallies.options,
    });
  });
});
