import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The state endpoint (roadmap F-02, extended in S-02).
 *
 * The store is mocked — what is under test is the response contract, in particular
 * that the join count is read **live** and returned beside the document rather than
 * inside it. That distinction is not cosmetic: the Phase 4 two-device run found the
 * host's refresh button showing an empty lobby because the only count available was
 * the one frozen into the document at the last host action.
 *
 * Follows `join.test.ts`'s shape.
 */

const readSessionMock = vi.fn();
const readPlayerCountMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  readSession: readSessionMock,
  readPlayerCount: readPlayerCountMock,
}));

const { GET: state } = await import("./state");

const NOW = 1_785_000_000_000;

/** `playerCount: 0` is the *published* count — deliberately stale here. */
const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
  playerCount: 0,
};

function call(): Promise<Response> {
  return state({} as Parameters<typeof state>[0]) as Promise<Response>;
}

beforeEach(() => {
  readSessionMock.mockReset();
  readPlayerCountMock.mockReset();
  readSessionMock.mockResolvedValue({ outcome: "ok", state: lobby });
  readPlayerCountMock.mockResolvedValue(0);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/quiz/state", () => {
  it("returns the document with a live count beside it", async () => {
    readPlayerCountMock.mockResolvedValue(7);

    const response = await call();
    const body = (await response.json()) as { state: unknown; playerCount: number | null };

    expect(response.status).toBe(200);
    // The live figure, NOT the document's frozen 0. An assertion that only checked the
    // field exists would pass against the bug this test was written for.
    expect(body.playerCount).toBe(7);
    // And the document travels untouched: overwriting its count would let a client
    // apply a number under a version that never carried it.
    expect(body.state).toEqual(lobby);
  });

  it("reports null rather than zero when the count cannot be read", async () => {
    readPlayerCountMock.mockResolvedValue(null);

    const body = (await (await call()).json()) as { playerCount: number | null };

    // Distinct from 0 on purpose — the host keeps the number already on screen rather
    // than rendering an empty room to a room that is not empty.
    expect(body.playerCount).toBeNull();
  });

  it("spends no store command on the count when there is no session", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: null });

    const body = (await (await call()).json()) as {
      state: unknown;
      playerCount: number | null;
    };

    expect(body.state).toBeNull();
    expect(body.playerCount).toBeNull();
    expect(readPlayerCountMock).not.toHaveBeenCalled();
  });

  it.each([
    ["unconfigured", { outcome: "unconfigured" as const }, 503],
    ["failed", { outcome: "failed" as const, reason: "boom" }, 503],
    ["invalid", { outcome: "invalid" as const, problems: ["bad"] }, 409],
  ])("maps a %s read to %i without reading the count", async (_label, result, status) => {
    readSessionMock.mockResolvedValue(result);

    const response = await call();

    expect(response.status).toBe(status);
    expect(readPlayerCountMock).not.toHaveBeenCalled();
  });
});
