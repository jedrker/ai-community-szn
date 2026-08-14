import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The join route (roadmap S-02).
 *
 * The store is mocked — what is under test is the branching and the response
 * contract, not the claim's atomicity, which `store.test.ts` pins.
 *
 * Follows `host/routes.test.ts`'s shape.
 */

const claimPlayerMock = vi.fn();
const readPlayerByIdMock = vi.fn();
const readSessionMock = vi.fn();
const publishSnapshotMock = vi.fn();

vi.mock("../../../lib/session/store", () => ({
  claimPlayer: claimPlayerMock,
  readPlayerById: readPlayerByIdMock,
  // Still mocked so the route CANNOT reach a real store if someone reintroduces the
  // second read — the "one round trip" test below asserts it is never called.
  readSession: readSessionMock,
}));

vi.mock("../../../lib/session/realtime", () => ({
  publishSnapshot: publishSnapshotMock,
}));

const { POST: join } = await import("./join");

const NOW = 1_785_000_000_000;

const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
  playerCount: 4,
};

const stored = { id: "player-abc", displayName: "Anna", joinedAt: NOW };

function request(fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);

  return new Request("https://example.test/api/quiz/join", { method: "POST", body: form });
}

/**
 * The claiming device's own opaque id (roadmap S-09).
 *
 * Sent explicitly by `claiming` below rather than defaulted inside `request`, so the
 * absent-field case stays reachable: a helper that filled one in would make a test for
 * "no device id" exercise the present case instead — the shape `lessons.md` records
 * under "prove the fixture reaches the branch".
 */
const DEVICE = "device-xyz";

/** A claim request, which since S-09 must carry a device id to get past the guard. */
function claiming(fields: Record<string, string>): Request {
  return request({ deviceId: DEVICE, ...fields });
}

beforeEach(() => {
  claimPlayerMock.mockReset();
  readPlayerByIdMock.mockReset();
  readSessionMock.mockReset();
  publishSnapshotMock.mockReset();
  readSessionMock.mockResolvedValue({ outcome: "ok", state: lobby });
  claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 1, state: lobby });
  readPlayerByIdMock.mockResolvedValue({ outcome: "not-found", player: null, state: lobby });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function body(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("claiming a name", () => {
  it("returns the player and the current state on a successful claim", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 5, state: lobby });

    const response = await join({ request: claiming({ displayName: "Anna" }) } as never);

    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.player).toMatchObject({ displayName: "Anna" });
    expect(payload.state).toEqual(lobby);
    expect(payload.playerCount).toBe(5);
  });

  /**
   * The state travels with the claim so a joining device renders the host's current
   * question from this one response — no second round trip inside the thirty seconds
   * FR-002 allows.
   */
  it("claims on the folded key but stores what was typed", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 1, state: lobby });

    await join({ request: claiming({ displayName: "  ZaŻÓŁĆ  " }) } as never);

    const [key, record] = claimPlayerMock.mock.calls[0]!;
    expect(key).toBe("zazolc");
    expect(record.displayName).toBe("ZaŻÓŁĆ");
  });

  it("mints a distinct player id per claim", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 1, state: lobby });

    await join({ request: claiming({ displayName: "Anna" }) } as never);
    await join({ request: claiming({ displayName: "Hanna" }) } as never);

    const [[, first], [, second]] = claimPlayerMock.mock.calls;
    expect(first.id).not.toBe(second.id);
  });

  it("rejects a taken name with 409 and a prompt to pick another", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "taken", state: lobby });

    const response = await join({ request: claiming({ displayName: "Anna" }) } as never);

    expect(response.status).toBe(409);
    expect((await body(response)).error).toContain("zajęta");
  });

  it("rejects an invalid name with 400 and the validator's own message", async () => {
    const response = await join({ request: claiming({ displayName: "<script>" }) } as never);

    expect(response.status).toBe(400);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  it("rejects a missing name", async () => {
    const response = await join({ request: request({}) } as never);

    expect(response.status).toBe(400);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  /**
   * "Not started yet" and "already over" are the two phases that both carry a null
   * question and mean opposite things (F-03's lesson). One shared message would leave
   * a latecomer waiting for a session that had finished.
   */
  it("distinguishes a session that has not started from one that has ended", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "no-session" });
    const notStarted = await body(
      await join({ request: claiming({ displayName: "Anna" }) } as never)
    );

    claimPlayerMock.mockResolvedValue({ outcome: "closed", state: lobby });
    const ended = await body(await join({ request: claiming({ displayName: "Anna" }) } as never));

    expect(notStarted.error).not.toBe(ended.error);
    expect(String(notStarted.error)).toContain("jeszcze");
    expect(String(ended.error)).toContain("zakończona");
  });

  it("surfaces an unconfigured store as 503", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "unconfigured", reason: "no url" });

    const response = await join({ request: claiming({ displayName: "Anna" }) } as never);
    expect(response.status).toBe(503);
  });

  it("surfaces a store failure as 503 without throwing", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "failed", reason: "unreachable" });

    const response = await join({ request: claiming({ displayName: "Anna" }) } as never);
    expect(response.status).toBe(503);
  });
});

describe("a device coming back", () => {
  it("recognises a stored player id and reports it as resumed", async () => {
    readPlayerByIdMock.mockResolvedValue({ outcome: "found", player: stored, state: lobby });

    const response = await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.resumed).toBe(true);
    expect(payload.player).toEqual({ id: "player-abc", displayName: "Anna" });
    expect(payload.state).toEqual(lobby);
  });

  /**
   * THE LOCKOUT TEST (plan review F1).
   *
   * A reload during a fifteen-minute segment is near-certain, and a returning attendee
   * holds their own name. If the route claimed instead of recognising, the claim would
   * come back `taken` — refused by their own name — and they would be out of the quiz
   * for the rest of the session.
   */
  it("never attempts a fresh claim for a device presenting an id", async () => {
    readPlayerByIdMock.mockResolvedValue({ outcome: "found", player: stored, state: lobby });

    await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  it("prefers the stored id even when a name is also sent", async () => {
    readPlayerByIdMock.mockResolvedValue({ outcome: "found", player: stored, state: lobby });

    await join({ request: request({ playerId: "player-abc", displayName: "Anna" }) } as never);

    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  /**
   * The ordinary path after a purge or an expiry, not an attendee error — the client
   * clears its storage and shows the form. 404 rather than 200-with-null so a client
   * cannot mistake it for a successful resume.
   */
  /**
   * **503, not 404 — the distinction the full-plan review added.**
   *
   * A 404 tells the device its identity is dead and the client clears the stored id.
   * When the store merely failed, that is a claim the server cannot support: the
   * attendee is still holding a name, so clearing sends them to a form where their own
   * name comes back `taken` and they are locked out for the segment. Asserting only
   * "not 200" would pass against that bug; the status code is the assertion.
   */
  it("reports a store failure as 503 so the client keeps its stored id", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    readPlayerByIdMock.mockResolvedValue({ outcome: "failed", player: null, state: null });

    const response = await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(response.status).toBe(503);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  it("reports an unknown id as 404 so the client falls back to the form", async () => {
    readPlayerByIdMock.mockResolvedValue({ outcome: "not-found", player: null, state: null });

    const response = await join({ request: request({ playerId: "gone" }) } as never);

    expect(response.status).toBe(404);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });
});

describe("what joining must never do", () => {
  /**
   * 150 joins publishing 150 snapshots to 150 subscribers is the O(N²) fan-out the
   * spine contract forbids. The count reaches the room on the host's next action.
   */
  it("publishes nothing, on any path", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 1, state: lobby });
    await join({ request: claiming({ displayName: "Anna" }) } as never);

    claimPlayerMock.mockResolvedValue({ outcome: "taken", state: lobby });
    await join({ request: claiming({ displayName: "Anna" }) } as never);

    readPlayerByIdMock.mockResolvedValue({ outcome: "found", player: stored, state: lobby });
    await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(publishSnapshotMock).not.toHaveBeenCalled();
  });

  /**
   * THE ONE-ROUND-TRIP TEST (impl review F1).
   *
   * `CLAIM_PLAYER` has to `GET` the session document to check the phase, and a joining
   * device needs exactly that document — so the script returns it. Re-reading it from
   * the route doubled the store cost of the only path that scales with room size: ~300
   * commands per 150-device room instead of ~150, on top of a command-counter baseline
   * that is still unexplained.
   *
   * Asserting `readSession` is never called is what stops the second read creeping
   * back, since nothing else about the response would change if it did.
   */
  it("joins in one store round trip, on both paths", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 1, state: lobby });
    await join({ request: claiming({ displayName: "Anna" }) } as never);

    readPlayerByIdMock.mockResolvedValue({ outcome: "found", player: stored, state: lobby });
    await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(readSessionMock).not.toHaveBeenCalled();
    expect(claimPlayerMock).toHaveBeenCalledTimes(1);
    expect(readPlayerByIdMock).toHaveBeenCalledTimes(1);
  });

  /**
   * The state a device receives is the one its claim was checked against, not a later
   * read that could disagree with it — which is also why a store blip can no longer
   * hand a just-joined attendee a null state (impl review F5).
   */
  it("returns the state the claim itself was checked against", async () => {
    const opened = { ...lobby, version: 9, phase: "question-open" as const, currentQuestionId: "llm-skrot" };
    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 2, state: opened });

    const payload = await body(await join({ request: claiming({ displayName: "Anna" }) } as never));

    expect(payload.state).toEqual(opened);
  });

  it("emits both join events from this one layer", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    claimPlayerMock.mockResolvedValue({ outcome: "claimed", playerCount: 3, state: lobby });
    await join({ request: claiming({ displayName: "Anna" }) } as never);

    claimPlayerMock.mockResolvedValue({ outcome: "taken", state: lobby });
    await join({ request: claiming({ displayName: "Anna" }) } as never);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
    expect(lines).toContain("session.player.joined");
    expect(lines).toContain("session.join.rejected");
  });

  it("never writes a display name to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    claimPlayerMock.mockResolvedValue({ outcome: "taken", state: lobby });

    await join({ request: claiming({ displayName: "Anna" }) } as never);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
    expect(lines).toContain("session.join.rejected");
    // Logs are retained ~1 hour and covered by no TTL, no purge and no rollback.
    expect(lines).not.toContain("Anna");
    // The class travels under `rejection`, a closed union — not under the free-text
    // `reason`, which is where it used to sit and where a display name would also fit.
    expect(lines).toContain('"rejection":"taken"');
    expect(lines).not.toContain('"reason"');
  });
});
