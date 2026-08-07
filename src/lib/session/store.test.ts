import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks `@upstash/redis` and imports the module under test afterwards — the
 * pattern established by `src/lib/newsletter.test.ts`.
 */
const redisMock = {
  get: vi.fn(),
  eval: vi.fn(),
  hlen: vi.fn(),
};

// A class rather than `vi.fn(() => redisMock)`: the store calls `new Redis(...)`,
// and `vi.restoreAllMocks()` in afterEach would restore the mock to the bare
// arrow — which cannot be constructed. Returning an object from a constructor is
// legal and gives every `new Redis()` the same shared spy object.
vi.mock("@upstash/redis", () => ({
  Redis: class {
    constructor() {
      return redisMock;
    }
  },
}));

const {
  claimPlayer,
  createSession,
  endSession,
  purgeSession,
  readPlayerById,
  readPlayerCount,
  readSession,
  writeSession,
  ENDED_TTL_SECONDS,
  SESSION_KEY,
  SESSION_TTL_SECONDS,
} = await import("./store");
const { registeredKeys, PLAYER_IDS_KEY, PLAYERS_KEY } = await import("./keys");
const { quiz } = await import("../../quiz/index");

const NOW = 1_785_000_000_000;

const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
  playerCount: 0,
};

const firstQuestionOpen = {
  version: 2,
  phase: "question-open" as const,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: NOW,
  updatedAt: NOW + 500,
  playerCount: 0,
};

const player = { id: "player-abc", displayName: "Anna", joinedAt: NOW };

function configure(): void {
  vi.stubEnv("KV_REST_API_URL", "https://probe.upstash.io");
  vi.stubEnv("KV_REST_API_TOKEN", "test-token");
}

beforeEach(() => {
  redisMock.get.mockReset();
  redisMock.eval.mockReset();
  redisMock.hlen.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("configuration", () => {
  it("reports missing configuration rather than throwing", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    await expect(readSession()).resolves.toMatchObject({ outcome: "unconfigured" });
    await expect(createSession(NOW)).resolves.toMatchObject({ outcome: "unconfigured" });
    await expect(writeSession(1, firstQuestionOpen)).resolves.toMatchObject({
      outcome: "unconfigured",
    });
  });

  it("accepts the UPSTASH_REDIS_REST_* pair as a fallback", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://probe.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
    redisMock.get.mockResolvedValue(null);

    await expect(readSession()).resolves.toEqual({ outcome: "ok", state: null });
  });
});

describe("readSession", () => {
  beforeEach(configure);

  it("returns null when no session exists", async () => {
    redisMock.get.mockResolvedValue(null);

    await expect(readSession()).resolves.toEqual({ outcome: "ok", state: null });
    expect(redisMock.get).toHaveBeenCalledWith(SESSION_KEY);
  });

  it("returns the parsed state", async () => {
    redisMock.get.mockResolvedValue(firstQuestionOpen);

    await expect(readSession()).resolves.toEqual({
      outcome: "ok",
      state: firstQuestionOpen,
    });
  });

  /**
   * `@upstash/redis` deserializes JSON by default, so an object is the normal
   * shape — but depending on that default silently would break every read if it
   * changed, or if a client were ever constructed with it off.
   */
  it("accepts a raw JSON string as well as a deserialized object", async () => {
    redisMock.get.mockResolvedValue(JSON.stringify(firstQuestionOpen));

    await expect(readSession()).resolves.toEqual({
      outcome: "ok",
      state: firstQuestionOpen,
    });
  });

  it("reports a string that is not JSON as invalid, rather than throwing", async () => {
    redisMock.get.mockResolvedValue("definitely not json");

    const result = await readSession();
    expect(result.outcome).toBe("invalid");
  });

  it("reports an invalid document instead of returning it", async () => {
    redisMock.get.mockResolvedValue({ ...firstQuestionOpen, phase: "nonsense" });

    const result = await readSession();
    expect(result.outcome).toBe("invalid");
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.get.mockRejectedValue(new Error("upstash unreachable"));

    await expect(readSession()).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });
});

describe("createSession", () => {
  beforeEach(configure);

  it("creates a lobby session at version 1", async () => {
    redisMock.eval.mockResolvedValue([1, JSON.stringify(lobby)]);

    const result = await createSession(NOW);
    expect(result).toEqual({ outcome: "created", state: lobby });
  });

  it("returns the existing session rather than resetting it", async () => {
    redisMock.eval.mockResolvedValue([0, JSON.stringify(firstQuestionOpen)]);

    const result = await createSession(NOW);
    expect(result).toEqual({ outcome: "exists", state: firstQuestionOpen });
  });

  it("passes the TTL so a created session expires on its own", async () => {
    redisMock.eval.mockResolvedValue([1, JSON.stringify(lobby)]);

    await createSession(NOW);
    const [, keys, args] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([SESSION_KEY]);
    expect(args[1]).toBe(String(SESSION_TTL_SECONDS));
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(createSession(NOW)).resolves.toMatchObject({ outcome: "failed" });
  });
});

describe("writeSession", () => {
  beforeEach(configure);

  it("applies a write whose expected version matches", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    const result = await writeSession(1, firstQuestionOpen);
    expect(result).toEqual({ outcome: "applied", state: firstQuestionOpen });
  });

  /**
   * The failure this whole design exists to prevent. A stale write that reported
   * success would leave the host believing the room advanced when it did not.
   */
  it("reports a stale write and does not claim success", async () => {
    redisMock.eval.mockResolvedValue([0, 7]);

    const result = await writeSession(1, firstQuestionOpen);
    expect(result).toEqual({ outcome: "stale", version: 7 });
  });

  it("reports a missing session rather than creating one", async () => {
    redisMock.eval.mockResolvedValue([-1, 0]);

    await expect(writeSession(1, firstQuestionOpen)).resolves.toMatchObject({
      outcome: "failed",
    });
  });

  /**
   * THE GUARD-THE-GUARD TEST.
   *
   * The compare-and-set, the version check and the TTL re-arm must happen in one
   * atomic store call. Anyone who "simplifies" the Lua into a get-then-set in
   * TypeScript reintroduces a lost-update race that no other test would catch,
   * because a mocked client makes the racy version look perfectly correct.
   */
  it("performs the write as exactly one atomic store call", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await writeSession(1, firstQuestionOpen);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("re-arms the TTL inside that same call", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await writeSession(1, firstQuestionOpen);

    const [script, keys, args] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([SESSION_KEY]);
    expect(args[2]).toBe(String(SESSION_TTL_SECONDS));
    // The TTL must be set by the script, not by a follow-up EXPIRE that could
    // fail on its own and leave the session immortal.
    expect(script).toContain("'EX'");
  });

  it("refuses a next state that is not exactly one version ahead", async () => {
    const result = await writeSession(1, { ...firstQuestionOpen, version: 5 });

    expect(result.outcome).toBe("failed");
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("refuses to write a state that breaks its own invariants", async () => {
    const result = await writeSession(1, {
      ...firstQuestionOpen,
      currentQuestionId: "pytanie-ktorego-nie-ma",
    });

    expect(result.outcome).toBe("failed");
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(writeSession(1, firstQuestionOpen)).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });
});

describe("endSession", () => {
  beforeEach(configure);

  const ended = {
    version: 2,
    phase: "ended" as const,
    currentQuestionId: null,
    startedAt: NOW,
    updatedAt: NOW + 5_000,
    playerCount: 0,
  };

  it("applies an end whose expected version matches", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await expect(endSession(1, ended)).resolves.toEqual({ outcome: "applied", state: ended });
  });

  it("performs the end as exactly one atomic store call", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await endSession(1, ended);

    // Same reason as writeSession's equivalent assertion: a read-modify-write split
    // across round trips reintroduces the lost-update race, and a mocked client makes
    // the racy version look perfectly correct.
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
  });

  it("arms the SHORT lifetime, not the four-hour one", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await endSession(1, ended);

    const [, , args] = redisMock.eval.mock.calls[0]!;
    expect(args[2]).toBe(String(ENDED_TTL_SECONDS));
    expect(args[2]).not.toBe(String(SESSION_TTL_SECONDS));
  });

  it("passes every registered key so the whole namespace expires together", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await endSession(1, ended);

    const [, keys] = redisMock.eval.mock.calls[0]!;
    // The session key leads, because the script writes KEYS[1] and re-arms the rest.
    expect(keys[0]).toBe(SESSION_KEY);
    expect([...keys].sort()).toEqual([...registeredKeys()].sort());
  });

  it("re-arms the other keys inside the same script rather than via a follow-up EXPIRE", async () => {
    redisMock.eval.mockResolvedValue([1, 2]);

    await endSession(1, ended);

    const [script] = redisMock.eval.mock.calls[0]!;
    expect(script).toContain("EXPIRE");
    // EXPIRE takes one key, so re-arming N keys is a loop — inside one EVAL, which is
    // the property that matters. A separate EXPIRE per key from TypeScript can fail
    // partway and leave attendee data on the long lifetime.
    expect(script).toContain("for i = 2, #KEYS");
  });

  it("reports a stale end and does not claim success", async () => {
    redisMock.eval.mockResolvedValue([0, 7]);

    await expect(endSession(1, ended)).resolves.toEqual({ outcome: "stale", version: 7 });
  });

  it("reports a missing session rather than creating an ended one", async () => {
    redisMock.eval.mockResolvedValue([-1, 0]);

    const result = await endSession(1, ended);
    expect(result.outcome).toBe("failed");
  });

  it("refuses a state that is not actually ended", async () => {
    const result = await endSession(1, { ...ended, phase: "lobby" });

    expect(result.outcome).toBe("failed");
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("refuses a next state that is not exactly one version ahead", async () => {
    const result = await endSession(1, { ...ended, version: 9 });

    expect(result.outcome).toBe("failed");
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(endSession(1, ended)).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });
});

describe("purgeSession", () => {
  beforeEach(configure);

  it("deletes every registered key in exactly one call", async () => {
    redisMock.eval.mockResolvedValue(1);

    await purgeSession();

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [script, keys] = redisMock.eval.mock.calls[0]!;
    expect([...keys].sort()).toEqual([...registeredKeys()].sort());
    // DEL does accept a key list, so this one is genuinely a single command.
    expect(script).toContain("DEL");
  });

  it("reports how many keys existed", async () => {
    redisMock.eval.mockResolvedValue(1);

    await expect(purgeSession()).resolves.toEqual({ outcome: "purged", keysRemoved: 1 });
  });

  it("treats an empty namespace as a normal outcome, not a failure", async () => {
    redisMock.eval.mockResolvedValue(0);

    // Purging when nothing is there is what residue cleanup looks like. Reporting it
    // as an error would train a host to ignore the one verb whose errors matter.
    await expect(purgeSession()).resolves.toEqual({ outcome: "purged", keysRemoved: 0 });
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(purgeSession()).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });
});

describe("claimPlayer", () => {
  beforeEach(configure);

  it("claims a free name and reports the new count", async () => {
    redisMock.eval.mockResolvedValue([1, 7]);

    await expect(claimPlayer("anna", player)).resolves.toEqual({
      outcome: "claimed",
      playerCount: 7,
    });
  });

  /**
   * THE ATOMICITY ASSERTION — the reason this function is Lua at all.
   *
   * ~150 devices claim names within the same few seconds. A `HEXISTS` in one round
   * trip and an `HSET` in another hands two attendees the same name whenever another
   * claim lands in the gap, and the leaderboard stops being unambiguous — the single
   * guarantee FR-008 exists to provide. A mocked client makes the racy version look
   * perfectly correct, which is exactly why this assertion has to exist: it is the
   * only thing standing between the room and a "simplification" into TypeScript.
   */
  it("performs the claim as exactly one atomic store call", async () => {
    redisMock.eval.mockResolvedValue([1, 1]);

    await claimPlayer("anna", player);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.hlen).not.toHaveBeenCalled();
  });

  it("passes the three keys and arms both hash TTLs inside that same call", async () => {
    redisMock.eval.mockResolvedValue([1, 1]);

    await claimPlayer("anna", player);

    const [script, keys, args] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([SESSION_KEY, PLAYERS_KEY, PLAYER_IDS_KEY]);
    expect(args[3]).toBe(String(SESSION_TTL_SECONDS));
    // Both EXPIREs in the script, not as follow-up calls that can fail on their own
    // and leave a hash of attendee names on no lifetime at all.
    expect(script.match(/EXPIRE/g)).toHaveLength(2);
    // And the phase check is in the script too — read outside, it would be a check
    // against a session that could end before the claim lands.
    expect(script).toContain("ended");
  });

  it("reports a taken name as `taken`, not as an error", async () => {
    redisMock.eval.mockResolvedValue([0, 0]);

    // The ordinary outcome of two people in a room of 150 picking the same first
    // name. The route renders it as a prompt, not a failure.
    await expect(claimPlayer("anna", player)).resolves.toEqual({ outcome: "taken" });
  });

  it("refuses when no session exists", async () => {
    redisMock.eval.mockResolvedValue([-1, 0]);

    await expect(claimPlayer("anna", player)).resolves.toEqual({ outcome: "no-session" });
  });

  /**
   * `ended` and `lobby` both carry a null `currentQuestionId` and mean opposite
   * things — F-03's lesson, which cost an `advance` that would have reopened a closed
   * quiz. A joiner must be able to tell "not started yet" from "already over".
   */
  it("refuses a session that has ended, distinctly from one that has not started", async () => {
    redisMock.eval.mockResolvedValue([-2, 0]);

    await expect(claimPlayer("anna", player)).resolves.toEqual({ outcome: "closed" });
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(claimPlayer("anna", player)).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });

  it("never writes a display name to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    redisMock.eval.mockResolvedValue([1, 3]);

    await claimPlayer("anna", player);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
    expect(lines).toContain("session.player.joined");
    // Logs are retained ~1 hour and covered by no TTL, no purge and no rollback.
    expect(lines).not.toContain("Anna");
    expect(lines).not.toContain("anna");
  });

  it("reports an unconfigured store rather than throwing", async () => {
    vi.unstubAllEnvs();

    await expect(claimPlayer("anna", player)).resolves.toMatchObject({
      outcome: "unconfigured",
    });
  });
});

describe("readPlayerCount", () => {
  beforeEach(configure);

  it("returns the hash length", async () => {
    redisMock.hlen.mockResolvedValue(42);

    await expect(readPlayerCount()).resolves.toBe(42);
    expect(redisMock.hlen).toHaveBeenCalledWith(PLAYERS_KEY);
  });

  /**
   * `null`, not `0`. The caller keeps the previous number instead of publishing a
   * zero — on a large screen a zero reads as the room having left, and a host who
   * cannot read the count is in a different situation from one whose room is empty.
   */
  it("returns null when the store cannot answer", async () => {
    redisMock.hlen.mockRejectedValue(new Error("unreachable"));

    await expect(readPlayerCount()).resolves.toBeNull();
  });

  it("returns null when the store is unconfigured", async () => {
    vi.unstubAllEnvs();

    await expect(readPlayerCount()).resolves.toBeNull();
  });
});

describe("readPlayerById", () => {
  beforeEach(configure);

  it("resolves an id through the reverse index in one round trip", async () => {
    redisMock.eval.mockResolvedValue(JSON.stringify(player));

    await expect(readPlayerById("player-abc")).resolves.toEqual(player);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [, keys] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([PLAYER_IDS_KEY, PLAYERS_KEY]);
  });

  it("accepts an already-deserialized record", async () => {
    // `automaticDeserialization` defaults to true; depending on it silently would
    // mean every lookup failing if it ever changed.
    redisMock.eval.mockResolvedValue(player);

    await expect(readPlayerById("player-abc")).resolves.toEqual(player);
  });

  /**
   * An unknown id and an unreadable store collapse to the same answer on purpose: a
   * device holding an id from a purged session and a device that hit a store blip
   * both need the same next step — the name form — and distinguishing them would mean
   * showing an attendee an error inside the thirty seconds they have to be playing.
   */
  it("returns null for an unknown id", async () => {
    redisMock.eval.mockResolvedValue(false);

    await expect(readPlayerById("nobody")).resolves.toBeNull();
  });

  it("returns null on a transport failure rather than throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    redisMock.eval.mockRejectedValue(new Error("unreachable"));

    await expect(readPlayerById("player-abc")).resolves.toBeNull();
  });

  it("returns null on a malformed stored record", async () => {
    redisMock.eval.mockResolvedValue(JSON.stringify({ id: "abc" }));

    await expect(readPlayerById("player-abc")).resolves.toBeNull();
  });
});
