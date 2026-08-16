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
const { MAX_DEVICE_ID_LENGTH } = await import("../../../lib/session/players");

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
  readPlayerByIdMock.mockResolvedValue({
    outcome: "not-found",
    player: null,
    state: lobby,
    total: 0,
  });
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

  /**
   * THE CAP, AS THE ATTENDEE MEETS IT (roadmap S-09, FR-018).
   *
   * `capped` and `taken` are both 409s and both ordinary, but they are not the same
   * answer: `taken` invites another name, `capped` is final for this device. Copy that
   * blurred them would send someone through three more refusals before they learned the
   * reason, so the messages are asserted to differ rather than merely to exist.
   */
  it("refuses a device at its allowance with copy that does not invite another name", async () => {
    claimPlayerMock.mockResolvedValue({ outcome: "taken", state: lobby });
    const taken = await body(await join({ request: claiming({ displayName: "Anna" }) } as never));

    claimPlayerMock.mockResolvedValue({ outcome: "capped", state: lobby });
    const response = await join({ request: claiming({ displayName: "Anna" }) } as never);
    const capped = await body(response);

    expect(response.status).toBe(409);
    expect(capped.error).not.toBe(taken.error);
    expect(String(capped.error)).toContain("urządzenia");
    // The retry prompt belongs to `taken` alone — this one has nothing to retry with.
    expect(String(capped.error)).not.toContain("Wybierz inną");
  });

  /**
   * THE ABSENT FIELD (roadmap S-09; `lessons.md`, "absent untrusted input must fail
   * toward the safe end").
   *
   * A claim carrying no device id is refused rather than counted against nothing. The
   * assertion that matters is `claimPlayer` never being reached: a route that let the
   * request through and simply passed an empty string would still answer 400-ish under
   * some later edit while quietly claiming a player, and the cap would be bypassed by
   * omitting one field.
   *
   * Note the fixture uses `request`, not `claiming` — the helper that supplies a device
   * id would put this test on the *present* path, which is the failure `lessons.md`
   * records under "prove the fixture reaches the branch".
   */
  it("refuses a claim that carries no device id, without reaching the store", async () => {
    const response = await join({ request: request({ displayName: "Anna" }) } as never);

    expect(response.status).toBe(400);
    expect(claimPlayerMock).not.toHaveBeenCalled();
    // Recoverable in one tap — the honest way to hit this is a page cached from before
    // the guard shipped.
    expect(String((await body(response)).error)).toContain("Odśwież");
  });

  /**
   * The bound every other attendee-supplied field already has (impl review F3). A device
   * id becomes a hash *field name*, and this route is deliberately open, so an
   * unbounded one is a needlessly enormous write on any successful claim.
   *
   * Built from the constant rather than from a literal length: a test that hardcoded 65
   * would keep passing if the two ever drifted apart.
   */
  it("refuses a claim whose device id is longer than the bound", async () => {
    const response = await join({
      request: request({
        displayName: "Anna",
        deviceId: "d".repeat(MAX_DEVICE_ID_LENGTH + 1),
      }),
    } as never);

    expect(response.status).toBe(400);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  it("accepts a device id exactly at the bound", async () => {
    const response = await join({
      request: request({
        displayName: "Anna",
        deviceId: "d".repeat(MAX_DEVICE_ID_LENGTH),
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(claimPlayerMock).toHaveBeenCalled();
  });

  it("refuses a claim whose device id is present but empty", async () => {
    const response = await join({
      request: request({ displayName: "Anna", deviceId: "" }),
    } as never);

    expect(response.status).toBe(400);
    expect(claimPlayerMock).not.toHaveBeenCalled();
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
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });

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
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });

    await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  /**
   * THE EXEMPTION (roadmap S-09, FR-018 against FR-009).
   *
   * The cap governs the claim path and never this one. A phone that legitimately
   * registered three players and then locked its screen must come back as itself; a
   * guard that refused it would turn a lightweight anti-farming counter into something
   * that eliminates a player, losing a score already earned.
   *
   * The request deliberately carries **no** device id, which is what a resume actually
   * sends — so this fails if a future edit hoists the device-id guard to the top of the
   * handler, which is the natural place to put it and the one place it must not go.
   */
  it("resumes a device that sends no device id at all, so the cap can never refuse it", async () => {
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });

    const response = await join({ request: request({ playerId: "player-abc" }) } as never);

    expect(response.status).toBe(200);
    expect((await body(response)).resumed).toBe(true);
  });

  /**
   * The same property from the other side: even a device that presents an id AND is at
   * its allowance resumes, because nothing on this path asks the store to claim — and
   * `capped` can only ever come back from a claim.
   */
  it("resumes without consulting the cap even when a device id is present", async () => {
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });
    claimPlayerMock.mockResolvedValue({ outcome: "capped", state: lobby });

    const response = await join({
      request: request({ playerId: "player-abc", deviceId: "device-xyz" }),
    } as never);

    expect(response.status).toBe(200);
    expect(claimPlayerMock).not.toHaveBeenCalled();
  });

  /**
   * WHAT THE DEVICE IS COMING BACK WITH (roadmap S-09, FR-009).
   *
   * The score survives a reload by construction — it lives in the scores hash keyed by
   * player id, and nothing on this path touches it. What did not survive was the
   * attendee's *knowledge* of that: `result-total` is painted only from inside the
   * result panel, so a reload during an open question left a screen with no score on it
   * until the next reveal.
   */
  it("carries the running total back to a resuming device", async () => {
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 1_200,
    });

    const payload = await body(
      await join({ request: request({ playerId: "player-abc" }) } as never)
    );

    expect(payload.total).toBe(1_200);
  });

  /**
   * Zero is a real answer here, not a missing one: `HINCRBY` only writes when something
   * was awarded, so every player is absent from the scores hash until their first
   * scoring answer. The client tells `0` apart from an absent field — a response without
   * one has said nothing about this device's score, and shows no line at all.
   */
  it("reports a scoreless player as zero rather than omitting the field", async () => {
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });

    const payload = await body(
      await join({ request: request({ playerId: "player-abc" }) } as never)
    );

    expect(payload.total).toBe(0);
    expect("total" in payload).toBe(true);
  });

  it("prefers the stored id even when a name is also sent", async () => {
    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });

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

    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });
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

    readPlayerByIdMock.mockResolvedValue({
      outcome: "found",
      player: stored,
      state: lobby,
      total: 0,
    });
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
    const opened = { ...lobby, version: 9, phase: "question-open" as const, currentQuestionId: "fixture-question" };
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

  /**
   * The same rule, for the identifier S-09 introduced.
   *
   * A device id in a log line is a stable handle on one phone, in a stream retained
   * ~1 hour and covered by no TTL, no purge and no rollback — so it would outlive the
   * session document the whole retention guardrail is built around. The class is what a
   * host needs anyway: a burst of these says someone is farming.
   */
  it("logs the capped class without the device id", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    claimPlayerMock.mockResolvedValue({ outcome: "capped", state: lobby });

    await join({ request: claiming({ displayName: "Anna" }) } as never);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
    expect(lines).toContain('"rejection":"capped"');
    expect(lines).not.toContain(DEVICE);
  });

  it("logs the no-device class, distinctly from an invalid name", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await join({ request: request({ displayName: "Anna" }) } as never);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
    // Its own class: this one says "reload the page", `invalid` says "fix your name".
    expect(lines).toContain('"rejection":"no-device"');
    expect(lines).not.toContain('"rejection":"invalid"');
  });
});
