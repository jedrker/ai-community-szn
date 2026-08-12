import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mocks `@upstash/redis` and imports the module under test afterwards — the
 * pattern established by `src/lib/newsletter.test.ts`.
 */
const redisMock = {
  get: vi.fn(),
  eval: vi.fn(),
  hlen: vi.fn(),
  hget: vi.fn(),
  hmget: vi.fn(),
  hgetall: vi.fn(),
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
  readAnsweredCount,
  readOwnRank,
  readOwnResult,
  readPlayerById,
  readPlayerCount,
  readQuestionTallies,
  readSession,
  readStandings,
  submitAnswer,
  writeSession,
  ENDED_TTL_SECONDS,
  SESSION_KEY,
  SESSION_TTL_SECONDS,
} = await import("./store");
const { registeredKeys, ANSWERS_KEY, PLAYER_IDS_KEY, PLAYERS_KEY, SCORES_KEY, TALLIES_KEY } =
  await import("./keys");
const { answeredField, optionField, wordField } = await import("./tallies");
const { quiz } = await import("../../quiz/index");

const NOW = 1_785_000_000_000;

const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
  playerCount: 0,
  revealedOptionIds: null,
  revealedDistribution: null,
  revealedAnswerText: null,
  standings: null,
};

const firstQuestionOpen = {
  version: 2,
  phase: "question-open" as const,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: NOW,
  updatedAt: NOW + 500,
  playerCount: 0,
  revealedOptionIds: null,
  revealedDistribution: null,
  revealedAnswerText: null,
  standings: null,
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
  redisMock.hgetall.mockReset();
  redisMock.hget.mockReset();
  redisMock.hmget.mockReset();
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
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
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
    redisMock.eval.mockResolvedValue([1, 7, JSON.stringify(lobby)]);

    await expect(claimPlayer("anna", player)).resolves.toEqual({
      outcome: "claimed",
      playerCount: 7,
      // The document the script checked, carried out so the route needs no second
      // read — see the one-round-trip note on CLAIM_PLAYER.
      state: lobby,
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
    redisMock.eval.mockResolvedValue([1, 1, JSON.stringify(lobby)]);

    await claimPlayer("anna", player);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.hlen).not.toHaveBeenCalled();
  });

  it("passes the three keys and arms both hash TTLs inside that same call", async () => {
    redisMock.eval.mockResolvedValue([1, 1, JSON.stringify(lobby)]);

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
    redisMock.eval.mockResolvedValue([0, 0, JSON.stringify(lobby)]);

    // The ordinary outcome of two people in a room of 150 picking the same first
    // name. The route renders it as a prompt, not a failure.
    await expect(claimPlayer("anna", player)).resolves.toEqual({
      outcome: "taken",
      state: lobby,
    });
  });

  it("refuses when no session exists", async () => {
    redisMock.eval.mockResolvedValue([-1, 0, false]);

    // No session means no document to carry out — the only outcome without state.
    await expect(claimPlayer("anna", player)).resolves.toEqual({ outcome: "no-session" });
  });

  /**
   * `ended` and `lobby` both carry a null `currentQuestionId` and mean opposite
   * things — F-03's lesson, which cost an `advance` that would have reopened a closed
   * quiz. A joiner must be able to tell "not started yet" from "already over".
   */
  it("refuses a session that has ended, distinctly from one that has not started", async () => {
    redisMock.eval.mockResolvedValue([-2, 0, JSON.stringify({ ...lobby, phase: "ended", version: 9 })]);

    const result = await claimPlayer("anna", player);
    expect(result).toMatchObject({ outcome: "closed" });
    // The ended document travels too, so a late joiner can be shown the closing
    // screen rather than a bare error.
    expect(result).toHaveProperty("state.phase", "ended");
  });

  it("reports a transport failure without throwing", async () => {
    redisMock.eval.mockRejectedValue(new Error("upstash unreachable"));

    await expect(claimPlayer("anna", player)).resolves.toEqual({
      outcome: "failed",
      reason: "upstash unreachable",
    });
  });

  /**
   * The success event is emitted by the route, not here — the six rejection lines live
   * there too, and an event family split across two layers means a second caller of
   * this function inherits success logging for free and no rejection logging at all.
   * What this asserts is the part that must hold wherever it is logged: the name never
   * reaches a log line, since logs are retained ~1 hour and covered by no TTL, no
   * purge and no rollback.
   */
  it("never writes a display name to the log", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    redisMock.eval.mockResolvedValue([1, 3, JSON.stringify(lobby)]);

    await claimPlayer("anna", player);

    const lines = log.mock.calls.map(([first]) => String(first)).join("\n");
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
    redisMock.eval.mockResolvedValue([JSON.stringify(player), JSON.stringify(lobby)]);

    await expect(readPlayerById("player-abc")).resolves.toEqual({
      outcome: "found",
      player,
      state: lobby,
    });

    // One round trip for both the record and the session document — a reloading
    // device needs both, and the script has both in hand.
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [, keys] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([PLAYER_IDS_KEY, PLAYERS_KEY, SESSION_KEY]);
  });

  it("accepts an already-deserialized record", async () => {
    // `automaticDeserialization` defaults to true; depending on it silently would
    // mean every lookup failing if it ever changed.
    redisMock.eval.mockResolvedValue([player, lobby]);

    await expect(readPlayerById("player-abc")).resolves.toEqual({
      outcome: "found",
      player,
      state: lobby,
    });
  });

  /**
   * **`not-found` and `failed` must never collapse into one answer.**
   *
   * They did until the full-plan review: both reported a null player, the route
   * answered 404 to both, and the client cleared the id it had stored. A store blip
   * during a reload therefore erased the device's identity, and the attendee re-typed
   * the name they were still holding, was refused as `taken`, and was locked out for
   * the rest of the segment.
   *
   * Both cases really do need the same fallback *screen* — that part of the original
   * reasoning held. What they need opposite treatment for is `localStorage`.
   */
  it("reports an unknown id as not-found, with the session it did read", async () => {
    redisMock.eval.mockResolvedValue([false, JSON.stringify(lobby)]);

    await expect(readPlayerById("nobody")).resolves.toEqual({
      outcome: "not-found",
      player: null,
      state: lobby,
    });
  });

  it("reports a transport failure as failed, not as not-found", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    redisMock.eval.mockRejectedValue(new Error("unreachable"));

    const result = await readPlayerById("player-abc");

    // The assertion that matters: `failed`, distinct from the unknown-id case above.
    // Asserting only `player: null` would pass against the lockout bug.
    expect(result).toEqual({ outcome: "failed", player: null, state: null });
  });

  it("reports an unconfigured store as failed rather than as an unknown player", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    await expect(readPlayerById("player-abc")).resolves.toEqual({
      outcome: "failed",
      player: null,
      state: null,
    });
  });

  it("returns null on a malformed stored record", async () => {
    redisMock.eval.mockResolvedValue([JSON.stringify({ id: "abc" }), JSON.stringify(lobby)]);

    await expect(readPlayerById("player-abc")).resolves.toMatchObject({
      outcome: "not-found",
      player: null,
    });
  });
});

describe("submitAnswer", () => {
  beforeEach(configure);

  /**
   * **A real choice question, looked up by id rather than by position.**
   *
   * This used to be `quiz.questions[0]`, which is the *word-cloud* opener — so a fixture
   * commented "a choice answer" was carrying a word-cloud question's id with invented
   * option ids. Harmless here, because `submitAnswer` is kind-agnostic by design, and
   * exactly the shape `lessons.md` warns about ("never build a fixture from a positional
   * index into real data without checking what that datum actually is"). Corrected during
   * S-08 so the word-cloud fixture below can be told apart from this one at a glance.
   */
  const choiceQuestionId = "llm-skrot";

  const answer = {
    playerId: "player-abc",
    questionId: choiceQuestionId,
    optionIds: ["a"],
    // A choice answer, so no typed text, no guess and no word. Those paths are covered
    // in `answer.test.ts`.
    text: null,
    value: null,
    word: null,
    elapsedMs: 3_200,
    correct: true,
    awarded: 920,
    answeredAt: NOW + 3_200,
  };

  it("accepts a first answer and reports the new running total", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await expect(submitAnswer(answer)).resolves.toEqual({ outcome: "accepted", total: 920 });
  });

  /**
   * THE ATOMICITY ASSERTION — the same one that guards the version guard and the name
   * claim, and it exists to stop the same refactor.
   *
   * The phase check, the first-answer lock and the total all have to happen without a
   * gap. Split across round trips, a phone that submits twice in the moment the host
   * advances can be recorded against the wrong question, or scored twice. A mocked
   * client makes every one of those versions look correct.
   */
  it("performs the submission as exactly one atomic store call", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.hlen).not.toHaveBeenCalled();
  });

  it("passes the five keys and arms all three hash TTLs inside that same call", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [script, keys, args] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([SESSION_KEY, ANSWERS_KEY, SCORES_KEY, PLAYER_IDS_KEY, TALLIES_KEY]);
    expect(args[5]).toBe(String(SESSION_TTL_SECONDS));

    // `end` re-arms only keys that exist when the host ends. Between the first answer
    // and the next host action, these three EXPIREs are the only thing covering them.
    expect(script.match(/EXPIRE/g)).toHaveLength(3);
  });

  it("locks the first answer with HSETNX rather than a check-then-write", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [script] = redisMock.eval.mock.calls[0]!;
    // FR-004: no changes before the reveal. The lock and the write must be one
    // operation — HEXISTS followed by HSET has a window two fast taps will find.
    expect(script).toContain("HSETNX");
    expect(script).not.toContain("HSET ");
  });

  it("checks the open question id, not only the phase", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [script, , args] = redisMock.eval.mock.calls[0]!;
    // A phone submitting as the host advances is still in `question-open`. Without
    // the id comparison its answer lands on the question that just opened.
    expect(script).toContain("currentQuestionId");
    expect(script).toContain("question-open");
    expect(args[3]).toBe(answer.questionId);
  });

  it("writes the field the read path will look for", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [, , args] = redisMock.eval.mock.calls[0]!;
    expect(args[0]).toBe(`${answer.questionId}:${answer.playerId}`);
  });

  /**
   * THE TALLY ASSERTIONS (roadmap S-04).
   *
   * **What a mocked client can and cannot prove, said plainly.** The increments happen
   * inside the Lua, so nothing here executes them — these assertions are structural:
   * that the right fields are sent, and that the increments sit below the lock rather
   * than above it. Whether 150 concurrent submissions actually land 150 increments is
   * invisible to this file by construction, and `scripts/rehearse-room.ts` is where it
   * is checked against the real store. Both are needed; neither substitutes.
   */
  it("sends one answered field and one field per selected option", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [, , args] = redisMock.eval.mock.calls[0]!;
    expect(args[6]).toBe(answeredField(answer.questionId));
    expect(args.slice(7)).toEqual([optionField(answer.questionId, "a")]);
  });

  it("sends a field per option for a multiple-choice answer, with no encoding scheme", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer({ ...answer, optionIds: ["a", "b"] });

    const [, , args] = redisMock.eval.mock.calls[0]!;
    // A variadic ARGV tail, not a delimited string — an option id needs no escaping
    // and the script loops to #ARGV.
    expect(args.slice(7)).toEqual([
      optionField(answer.questionId, "a"),
      optionField(answer.questionId, "b"),
    ]);
  });

  /**
   * THE WORD COUNTER (roadmap S-08, FR-012/FR-015).
   *
   * Structural, like the option assertions above and with the same caveat: the increment
   * happens inside the Lua, so nothing here executes it. What is under test is that the
   * right field is sent, that it takes the place of the option counters rather than
   * joining them, and that a record without a word sends none.
   */
  describe("the word counter", () => {
    const wordCloudId = "smieszne-slowo-ai";

    it("covers a question that really is a word cloud", () => {
      // The fixture proved rather than assumed — the mistake corrected above.
      const question = quiz.questions.find((candidate) => candidate.id === wordCloudId);
      expect(question?.kind).toBe("word-cloud");
    });

    const wordAnswer = {
      ...answer,
      questionId: wordCloudId,
      optionIds: [],
      text: "Halucynacja",
      word: "halucynacja",
      correct: false,
      awarded: 0,
    };

    it("sends the answered field and exactly one word field", async () => {
      redisMock.eval.mockResolvedValue([1, 0]);

      await submitAnswer(wordAnswer);

      const [, , args] = redisMock.eval.mock.calls[0]!;
      expect(args[6]).toBe(answeredField(wordCloudId));
      expect(args.slice(7)).toEqual([wordField(wordCloudId, "halucynacja")]);
    });

    it("keys the counter by the folded word, not by what the attendee typed", async () => {
      redisMock.eval.mockResolvedValue([1, 0]);

      await submitAnswer(wordAnswer);

      const [, , args] = redisMock.eval.mock.calls[0]!;
      // `text` is the typed form and must not reach the field name — otherwise two
      // people who typed the same word in different case get two chips.
      expect(args.slice(7)).not.toContain(wordField(wordCloudId, "Halucynacja"));
    });

    it("bills exactly what a single-choice answer bills", async () => {
      redisMock.eval.mockResolvedValue([1, 0]);

      await submitAnswer(wordAnswer);
      const wordArgs = redisMock.eval.mock.calls[0]![2] as string[];

      redisMock.eval.mockClear();
      await submitAnswer(answer);
      const choiceArgs = redisMock.eval.mock.calls[0]![2] as string[];

      // One counter in the tail either way, so S-08 moved the event's cost by nothing.
      expect(wordArgs.length).toBe(choiceArgs.length);
    });

    /**
     * **The regression this exists for, and it was a live defect.** `submitAnswer` used
     * to build its `ARGV` from the raw argument rather than from the parsed record, so a
     * caller that omitted `word` — every choice and text submission, and any record
     * written before the field shipped — sent the literal field
     * `word:<questionId>:undefined`. That is a real hash field the cloud read would have
     * returned, and the projector would have rendered "undefined" as a word somebody
     * wrote. The parse succeeded; nothing reported it.
     */
    it("sends no word field when the record omits one entirely", async () => {
      redisMock.eval.mockResolvedValue([1, 920]);

      const { word: _word, ...withoutWord } = answer;
      await submitAnswer(withoutWord as typeof answer);

      const [, , args] = redisMock.eval.mock.calls[0]!;
      expect(args.slice(7)).toEqual([optionField(answer.questionId, "a")]);
      expect(args.join("|")).not.toContain("undefined");
    });

    it("stores the canonical record, with every per-kind field present", async () => {
      redisMock.eval.mockResolvedValue([1, 920]);

      const { word: _word, ...withoutWord } = answer;
      await submitAnswer(withoutWord as typeof answer);

      const [, , args] = redisMock.eval.mock.calls[0]!;
      // The schema's defaults are what gets written, so what is read back matches what
      // `readOwnResult` expects rather than depending on what the caller remembered.
      expect(JSON.parse(args[1]!)).toMatchObject({ text: null, value: null, word: null });
    });
  });

  it("increments the tallies only after the HSETNX that makes the answer final", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [script] = redisMock.eval.mock.calls[0]!;
    const lock = script.indexOf("HSETNX");
    const firstTally = script.indexOf("KEYS[5]");

    // Above the lock, the increments would count a duplicate submission that the lock
    // then rejects — the projector would show more answers than the answers hash holds,
    // with nothing to report the drift. Below it, they inherit the lock's atomicity.
    expect(lock).toBeGreaterThan(-1);
    expect(firstTally).toBeGreaterThan(lock);
  });

  it("puts every rejection branch above the increments, so a refusal counts nothing", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    const [script] = redisMock.eval.mock.calls[0]!;
    const firstTally = script.indexOf("KEYS[5]");

    // no-session, not-open, unknown-player and already-answered all return before the
    // script reaches the tallies key. Asserted positionally because the mock cannot run
    // the Lua: what it can prove is that no reachable path reaches an increment first.
    for (const branch of ["return { -1, 0 }", "return { -2, 0 }", "return { -3, 0 }", "return { 0, 0 }"]) {
      expect(script.indexOf(branch), `${branch} must precede the tally increments`).toBeGreaterThan(-1);
      expect(script.indexOf(branch)).toBeLessThan(firstTally);
    }
  });

  it.each([
    ["a second answer to the same question", [0, 0], "already-answered"],
    ["no session", [-1, 0], "no-session"],
    ["a question that is not open", [-2, 0], "not-open"],
    ["an unknown player id", [-3, 0], "unknown-player"],
  ])("maps %s to `%s`", async (_label, reply, outcome) => {
    redisMock.eval.mockResolvedValue(reply);

    await expect(submitAnswer(answer)).resolves.toEqual({ outcome });
  });

  it("reports a transport failure as failed, distinct from every refusal above", async () => {
    redisMock.eval.mockRejectedValue(new Error("unreachable"));

    await expect(submitAnswer(answer)).resolves.toMatchObject({ outcome: "failed" });
  });

  /**
   * The accepted branch names its condition rather than being the fall-through, because
   * here the fall-through direction is the unsafe one: a malformed reply makes the
   * status `NaN`, and reporting an answer the store never wrote as recorded is worse
   * than reporting a written one as failed.
   */
  it.each([
    ["a null reply", null],
    ["a reply that is not an array", "nonsense"],
    ["a reply with a non-numeric status", ["ok", 920]],
  ])("reports %s as failed rather than as accepted", async (_label, reply) => {
    redisMock.eval.mockResolvedValue(reply);

    await expect(submitAnswer(answer)).resolves.toMatchObject({ outcome: "failed" });
  });

  it("refuses to store a record that does not satisfy its own schema", async () => {
    // `readOwnResult` parses what it reads, so a malformed record comes back as `null`
    // and the result route tells a device that watched its answer land that it never
    // answered. A refusal here is visible; that is not.
    await expect(submitAnswer({ ...answer, awarded: -5 })).resolves.toMatchObject({
      outcome: "failed",
    });
    expect(redisMock.eval).not.toHaveBeenCalled();
  });

  it("reports an unconfigured store rather than throwing into the request path", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    await expect(submitAnswer(answer)).resolves.toMatchObject({ outcome: "unconfigured" });
  });

  it("publishes nothing — the room learns nothing from a submission", async () => {
    redisMock.eval.mockResolvedValue([1, 920]);

    await submitAnswer(answer);

    // 150 submissions fanning out to 150 subscribers is the O(N²) shape the spine
    // contract forbids. Asserted here because the temptation is a one-line addition.
    expect(redisMock.eval).toHaveBeenCalledTimes(1);
  });
});

describe("readAnsweredCount", () => {
  beforeEach(configure);

  const questionId = quiz.questions[0]!.id;

  it("reads the answered field in one command", async () => {
    redisMock.hget.mockResolvedValue(37);

    await expect(readAnsweredCount(questionId)).resolves.toBe(37);
    expect(redisMock.hget).toHaveBeenCalledWith(TALLIES_KEY, answeredField(questionId));
    expect(redisMock.hget).toHaveBeenCalledTimes(1);
  });

  it("reads a decimal string as well as a number", async () => {
    // `automaticDeserialization` defaults to true, but depending on it silently would
    // mean every poll reading zero if it were ever turned off.
    redisMock.hget.mockResolvedValue("37");

    await expect(readAnsweredCount(questionId)).resolves.toBe(37);
  });

  it("reports an untouched question as zero, not as an absence", async () => {
    redisMock.hget.mockResolvedValue(null);

    // Nobody has answered yet — a fact, and the first thing the panel shows on every
    // question.
    await expect(readAnsweredCount(questionId)).resolves.toBe(0);
  });

  /**
   * `null`, not `0` — `readPlayerCount`'s discipline. On a projector a count that drops
   * to zero reads as the room having stopped answering, and the poll's whole failure
   * posture (keep the last number, mark it stale) depends on being able to tell the two
   * apart here.
   */
  it("returns null when the store cannot answer", async () => {
    redisMock.hget.mockRejectedValue(new Error("unreachable"));

    await expect(readAnsweredCount(questionId)).resolves.toBeNull();
  });

  it("returns null when the store is unconfigured", async () => {
    vi.unstubAllEnvs();

    await expect(readAnsweredCount(questionId)).resolves.toBeNull();
  });

  /**
   * THE SEPARATION ASSERTION (PRD FR-005).
   *
   * The poll must not be able to return per-option data — not because the route trims
   * it, but because there is no shape for it to travel in. A `readAnsweredCount` that
   * grew an options field would make the distribution reachable from a path served
   * while the question is open, and the screen would look identical.
   */
  it("returns a bare number, with no route for option data to travel", async () => {
    redisMock.hget.mockResolvedValue(4);

    expect(typeof (await readAnsweredCount(questionId))).toBe("number");
    // One field requested, and it is the answered counter — not a wildcard read of the
    // hash that a caller could sift.
    expect(redisMock.hget.mock.calls[0]![1]).toBe(answeredField(questionId));
    expect(redisMock.hmget).not.toHaveBeenCalled();
  });
});

describe("readQuestionTallies", () => {
  beforeEach(configure);

  const questionId = quiz.questions[0]!.id;
  const optionIds = ["a", "b", "c"];

  it("reads the answered field and every option field in one command", async () => {
    redisMock.hmget.mockResolvedValue({
      [answeredField(questionId)]: 10,
      [optionField(questionId, "a")]: 6,
      [optionField(questionId, "b")]: 3,
      [optionField(questionId, "c")]: 1,
    });

    await expect(readQuestionTallies(questionId, optionIds)).resolves.toEqual({
      answered: 10,
      options: { a: 6, b: 3, c: 1 },
    });

    expect(redisMock.hmget).toHaveBeenCalledTimes(1);
    expect(redisMock.hmget).toHaveBeenCalledWith(
      TALLIES_KEY,
      answeredField(questionId),
      optionField(questionId, "a"),
      optionField(questionId, "b"),
      optionField(questionId, "c")
    );
  });

  it("keys the result by option id, not by hash field", async () => {
    // The caller renders against the question definition; the field format is
    // `tallies.ts`' business and must not leak into the reveal payload.
    redisMock.hmget.mockResolvedValue({ [optionField(questionId, "a")]: 2 });

    const tallies = await readQuestionTallies(questionId, ["a"]);
    expect(Object.keys(tallies!.options)).toEqual(["a"]);
  });

  it("reports an option nobody picked as zero rather than omitting it", async () => {
    redisMock.hmget.mockResolvedValue({
      [answeredField(questionId)]: 4,
      [optionField(questionId, "a")]: 4,
    });

    // "Nobody chose this" is a fact about the room. A missing bar would misreport it.
    await expect(readQuestionTallies(questionId, optionIds)).resolves.toEqual({
      answered: 4,
      options: { a: 4, b: 0, c: 0 },
    });
  });

  it("reports an untouched question as zeros, not as a failure", async () => {
    // HMGET answers null for the whole reply when the hash does not exist yet, which is
    // every question until its first submission.
    redisMock.hmget.mockResolvedValue(null);

    await expect(readQuestionTallies(questionId, optionIds)).resolves.toEqual({
      answered: 0,
      options: { a: 0, b: 0, c: 0 },
    });
  });

  /**
   * **`null` for the whole read, never a set of zeroes.** At reveal, zeroes render as
   * every bar empty, which on a projector reads as "nobody answered" — the same wrong
   * message the poll refuses, at the higher-stakes moment. `null` is the field's own
   * vocabulary for "there is nothing to show".
   */
  it("returns null when the store cannot answer", async () => {
    redisMock.hmget.mockRejectedValue(new Error("unreachable"));

    await expect(readQuestionTallies(questionId, optionIds)).resolves.toBeNull();
  });

  it("returns null when the store is unconfigured", async () => {
    vi.unstubAllEnvs();

    await expect(readQuestionTallies(questionId, optionIds)).resolves.toBeNull();
  });
});

describe("readOwnResult", () => {
  beforeEach(configure);

  /**
   * Deliberately written **without** `text`, `value` or `word` — this is the shape a
   * record written before S-05, S-06 and S-08 shipped has, and a session live across any
   * of those deploys holds them. The assertion below is that it still parses, defaulting
   * the new fields, rather than coming back `null` and reporting `answered: false` to a
   * device that watched its answer land.
   */
  const stored = {
    playerId: "player-abc",
    questionId: quiz.questions[0]!.id,
    optionIds: ["a"],
    elapsedMs: 3_200,
    correct: true,
    awarded: 920,
    answeredAt: NOW + 3_200,
  };

  it("returns the answer, the total and the session in one round trip", async () => {
    redisMock.eval.mockResolvedValue([
      JSON.stringify(firstQuestionOpen),
      JSON.stringify(stored),
      "920",
    ]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toEqual({
      outcome: "ok",
      state: firstQuestionOpen,
      // The pre-S-05/S-06/S-08 record, plus the fields it did not carry.
      answer: { ...stored, text: null, value: null, word: null },
      total: 920,
    });

    expect(redisMock.eval).toHaveBeenCalledTimes(1);
    const [, keys, args] = redisMock.eval.mock.calls[0]!;
    expect(keys).toEqual([SESSION_KEY, ANSWERS_KEY, SCORES_KEY]);
    expect(args[0]).toBe(`${stored.questionId}:player-abc`);
  });

  it("accepts already-deserialized values", async () => {
    // `automaticDeserialization` defaults to true; depending on it silently would
    // mean every result read failing if it ever changed.
    redisMock.eval.mockResolvedValue([firstQuestionOpen, stored, 920]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toMatchObject({
      outcome: "ok",
      answer: stored,
      total: 920,
    });
  });

  /**
   * **"Did not answer" and "could not say" must stay distinguishable** — the
   * `LookupResult` lesson, in the one other place it applies. A phone that concludes
   * from a store blip that its answer was never recorded tells the attendee they
   * missed a question they watched themselves answer.
   */
  it("reports a device that did not answer as ok with a null answer", async () => {
    redisMock.eval.mockResolvedValue([JSON.stringify(firstQuestionOpen), false, false]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toEqual({
      outcome: "ok",
      state: firstQuestionOpen,
      answer: null,
      total: 0,
    });
  });

  it("reports a transport failure as failed, not as an unanswered question", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    redisMock.eval.mockRejectedValue(new Error("unreachable"));

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toMatchObject({
      outcome: "failed",
    });
  });

  it("reports an unconfigured store as unconfigured, not as an unanswered question", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("KV_REST_API_TOKEN", "");

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toMatchObject({
      outcome: "unconfigured",
    });
  });

  it("reads a total of zero for a player who has scored nothing", async () => {
    redisMock.eval.mockResolvedValue([JSON.stringify(firstQuestionOpen), false, false]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toMatchObject({
      total: 0,
    });
  });

  it("returns a null answer rather than throwing on a malformed stored record", async () => {
    redisMock.eval.mockResolvedValue([
      JSON.stringify(firstQuestionOpen),
      JSON.stringify({ playerId: "player-abc" }),
      "920",
    ]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toMatchObject({
      outcome: "ok",
      answer: null,
      total: 920,
    });
  });

  it("survives a session document that is absent entirely", async () => {
    redisMock.eval.mockResolvedValue([false, false, false]);

    await expect(readOwnResult("player-abc", stored.questionId)).resolves.toEqual({
      outcome: "ok",
      state: null,
      answer: null,
      total: 0,
    });
  });
});

/**
 * The leaderboard reads (roadmap S-07, PRD FR-014).
 *
 * Two functions rather than one, and split along the same line the S-04 pair is:
 * `readStandings` is the host's read and returns everybody, `readOwnRank` is the device's
 * read and returns only the caller's own numbers. There is no shape in which the second
 * could hand a phone somebody else's name.
 */
describe("readStandings", () => {
  beforeEach(configure);

  const ala = { id: "id-ala", displayName: "Ala", joinedAt: NOW };
  const bartek = { id: "id-bartek", displayName: "Bartek", joinedAt: NOW + 1_000 };

  function hashes(
    players: Record<string, unknown>,
    scores: Record<string, unknown>
  ): void {
    redisMock.hgetall.mockImplementation((key: string) =>
      Promise.resolve(key === PLAYERS_KEY ? players : scores)
    );
  }

  it("joins scores to names through the record's own id", () => {
    hashes({ ala: JSON.stringify(ala), bartek: JSON.stringify(bartek) }, {
      "id-ala": 10,
      "id-bartek": 30,
    });

    // The players hash is keyed by FOLDED NAME, not by id — so a join that used the hash
    // field would find nothing in the scores hash and every total would read zero.
    return expect(readStandings()).resolves.toEqual({
      rows: [
        { rank: 1, displayName: "Bartek", points: 30 },
        { rank: 2, displayName: "Ala", points: 10 },
      ],
      playerCount: 2,
    });
  });

  it("accepts an already-deserialized record as well as a JSON string", () => {
    hashes({ ala: ala }, { "id-ala": 5 });

    return expect(readStandings()).resolves.toMatchObject({
      rows: [{ rank: 1, displayName: "Ala", points: 5 }],
    });
  });

  it("counts a player with no score entry rather than dropping them", () => {
    hashes({ ala: JSON.stringify(ala), bartek: JSON.stringify(bartek) }, { "id-ala": 10 });

    return expect(readStandings()).resolves.toMatchObject({
      rows: [
        { rank: 1, displayName: "Ala", points: 10 },
        { rank: 2, displayName: "Bartek", points: 0 },
      ],
      playerCount: 2,
    });
  });

  /** One corrupt record must not cost the room its leaderboard. */
  it("skips a record it cannot parse and keeps the rest", async () => {
    hashes({ ala: JSON.stringify(ala), broken: "{{{ not json" }, { "id-ala": 10 });

    const standings = await readStandings();

    expect(standings?.rows).toEqual([{ rank: 1, displayName: "Ala", points: 10 }]);
    // The dropped row is dropped from the count too — a denominator that included a
    // player with no name would leave the attendee's "position N of M" unreachable at M.
    expect(standings?.playerCount).toBe(1);
  });

  /**
   * A player whose total cannot be parsed still appears, at zero — not dropped, and never as
   * `NaN` on a projector. Same note as `readOwnRank`'s sibling test: this holds under both
   * the explicit parse and the bare coercion it replaced, so it pins the contract rather
   * than the fix (impl review F8).
   */
  it("lists a player whose total cannot be parsed, at zero", async () => {
    hashes({ ala: JSON.stringify(ala), bartek: JSON.stringify(bartek) }, {
      "id-ala": 10,
      "id-bartek": "nonsense",
    });

    const standings = await readStandings();

    expect(standings?.rows).toEqual([
      { rank: 1, displayName: "Ala", points: 10 },
      { rank: 2, displayName: "Bartek", points: 0 },
    ]);
  });

  it("reads an empty room as an empty board, not as a failure", () => {
    // `HGETALL` on a hash that does not exist answers null for the whole reply. Nobody
    // has joined yet; that is a fact, not an outage.
    hashes(null as never, null as never);

    return expect(readStandings()).resolves.toEqual({ rows: [], playerCount: 0 });
  });

  /**
   * **`null`, never an empty board.** An empty leaderboard on a projector is the claim
   * that nobody in the room has scored, at the moment the room is looking at it. Asserted
   * against the value rather than against "it did not throw", because a function that
   * returned `{ rows: [] }` here would pass the weaker test and fail the room.
   */
  it("returns null when the store cannot answer", () => {
    redisMock.hgetall.mockRejectedValue(new Error("upstash unreachable"));

    return expect(readStandings()).resolves.toBeNull();
  });

  /**
   * Two billed commands. Folding them into one `EVAL` would make it three — Upstash bills
   * the script *and* every call inside it — which is the arithmetic `participation.ts`
   * documents for its own pair.
   */
  it("issues two commands and no eval", async () => {
    hashes({ ala: JSON.stringify(ala) }, { "id-ala": 10 });

    await readStandings();

    expect(redisMock.hgetall).toHaveBeenCalledTimes(2);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});

describe("readOwnRank", () => {
  beforeEach(configure);

  it("returns the caller's rank and total", () => {
    redisMock.hgetall.mockResolvedValue({ "id-ala": 30, "id-bartek": 50, "id-cela": 10 });

    return expect(readOwnRank("id-ala")).resolves.toEqual({ rank: 2, total: 30 });
  });

  /**
   * A device that has scored nothing has never touched the scores hash. It still gets a
   * position — the whole point of counting everyone who joined — rather than an error.
   */
  it("ranks an id absent from the hash at zero rather than failing", () => {
    redisMock.hgetall.mockResolvedValue({ "id-bartek": 50, "id-cela": 10 });

    return expect(readOwnRank("id-nobody")).resolves.toEqual({ rank: 3, total: 0 });
  });

  /**
   * THE AGREEMENT WITH THE PROJECTOR. Two players tied on 50 are both rank 1, and the
   * board built from the same totals numbers them the same way — because both call
   * `rankOf`. The fixture ties deliberately: with distinct totals this assertion would
   * pass against a positional rank too.
   */
  it("gives a tied caller the same rank the board shows", () => {
    redisMock.hgetall.mockResolvedValue({ "id-ala": 50, "id-bartek": 50, "id-cela": 10 });

    return expect(readOwnRank("id-bartek")).resolves.toMatchObject({ rank: 1 });
  });

  it("returns null when the store cannot answer, never a rank of 1", () => {
    redisMock.hgetall.mockRejectedValue(new Error("upstash unreachable"));

    return expect(readOwnRank("id-ala")).resolves.toBeNull();
  });

  /**
   * A corrupt entry belonging to somebody else does not move this caller's rank.
   *
   * Pins the observable contract rather than the implementation: `storedTotal` drops the
   * value and the older bare `Number(x) || 0` read it as zero, and **neither is greater than
   * anything**, so both produce this result. Written down because the impl-review fix here
   * (F8) is a clarity change with no behavioural difference — worth knowing before someone
   * "simplifies" it back and looks for the test that should have failed.
   */
  it("is unaffected by another player's unparseable total", () => {
    redisMock.hgetall.mockResolvedValue({
      "id-ala": 30,
      "id-bartek": 50,
      "id-broken": "nonsense",
    });

    return expect(readOwnRank("id-ala")).resolves.toEqual({ rank: 2, total: 30 });
  });

  it("still answers a caller whose own total is corrupt, reading it as zero", () => {
    redisMock.hgetall.mockResolvedValue({ "id-ala": "nonsense", "id-bartek": 50 });

    // Refusing to tell a device where it stands, over a value only store corruption can
    // produce, costs the attendee their line for no gain.
    return expect(readOwnRank("id-ala")).resolves.toEqual({ rank: 2, total: 0 });
  });

  it("issues one command", async () => {
    redisMock.hgetall.mockResolvedValue({ "id-ala": 10 });

    await readOwnRank("id-ala");

    expect(redisMock.hgetall).toHaveBeenCalledTimes(1);
    expect(redisMock.hgetall).toHaveBeenCalledWith(SCORES_KEY);
    expect(redisMock.eval).not.toHaveBeenCalled();
  });
});
