import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createTokenRequestMock = vi.fn();
const publishMock = vi.fn();
const channelsGetMock = vi.fn(() => ({ publish: publishMock }));

// A class rather than `vi.fn(() => ...)`: the module calls `new Rest(...)`, and a
// restored arrow mock cannot be constructed. See store.test.ts for the same note.
vi.mock("ably", () => ({
  Rest: class {
    auth = { createTokenRequest: createTokenRequestMock };
    channels = { get: channelsGetMock };
  },
}));

const { createTokenRequest, publishSnapshot, SESSION_CHANNEL, SNAPSHOT_EVENT } =
  await import("./realtime");
const { quizzes } = await import("../../quiz/index");
// One quiz to run a session against — which one is not what anything here asserts.
const quiz = quizzes[0]!;

const state = {
  version: 3,
  phase: "question-open" as const,
  quizId: quiz.id,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: 1_785_000_000_000,
  updatedAt: 1_785_000_001_000,
  playerCount: 12,
  revealedOptionIds: null,
  revealedDistribution: null,
  revealedAnswerText: null,
  standings: null,
};

beforeEach(() => {
  createTokenRequestMock.mockReset();
  publishMock.mockReset();
  channelsGetMock.mockClear();
  vi.stubEnv("ABLY_API_KEY", "appid.keyid:secret");
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createTokenRequest", () => {
  /**
   * The property that makes an open token endpoint safe. A client that could
   * publish could forge a state snapshot and move 150 devices to a question the
   * host never opened.
   */
  it("grants subscribe and never publish", async () => {
    createTokenRequestMock.mockResolvedValue({
      keyName: "appid.keyid",
      mac: "sig",
    });

    await createTokenRequest();

    const params = createTokenRequestMock.mock.calls[0]![0];
    expect(params.capability).toEqual({ [SESSION_CHANNEL]: ["subscribe"] });

    const granted = Object.values(
      params.capability as Record<string, string[]>,
    ).flat();
    expect(granted).not.toContain("publish");
    expect(granted).not.toContain("presence");
    expect(granted).not.toContain("*");
  });

  it("scopes the capability to the session channel only", async () => {
    createTokenRequestMock.mockResolvedValue({
      keyName: "appid.keyid",
      mac: "sig",
    });

    await createTokenRequest();

    const params = createTokenRequestMock.mock.calls[0]![0];
    expect(Object.keys(params.capability as object)).toEqual([SESSION_CHANNEL]);
  });

  it("returns the token request", async () => {
    const tokenRequest = { keyName: "appid.keyid", mac: "sig", nonce: "n" };
    createTokenRequestMock.mockResolvedValue(tokenRequest);

    await expect(createTokenRequest()).resolves.toEqual({
      outcome: "ok",
      tokenRequest,
    });
  });

  it("reports missing configuration rather than throwing", async () => {
    vi.stubEnv("ABLY_API_KEY", "");

    await expect(createTokenRequest()).resolves.toMatchObject({
      outcome: "unconfigured",
    });
    expect(createTokenRequestMock).not.toHaveBeenCalled();
  });

  it("reports a vendor failure rather than throwing", async () => {
    createTokenRequestMock.mockRejectedValue(
      new Error("ably rejected the key"),
    );

    await expect(createTokenRequest()).resolves.toEqual({
      outcome: "failed",
      reason: "ably rejected the key",
    });
  });
});

describe("publishSnapshot", () => {
  it("publishes the complete state including its version", async () => {
    publishMock.mockResolvedValue(undefined);

    await publishSnapshot(state);

    expect(channelsGetMock).toHaveBeenCalledWith(SESSION_CHANNEL);
    const [event, payload] = publishMock.mock.calls[0]!;
    expect(event).toBe(SNAPSHOT_EVENT);
    // Whole snapshot, not a delta: a device that missed a message must be able to
    // recover from the next one alone.
    expect(payload).toEqual(state);
    expect(payload.version).toBe(3);
  });

  it("reports success", async () => {
    publishMock.mockResolvedValue(undefined);
    await expect(publishSnapshot(state)).resolves.toEqual({ outcome: "ok" });
  });

  it("reports missing configuration rather than throwing", async () => {
    vi.stubEnv("ABLY_API_KEY", "");

    await expect(publishSnapshot(state)).resolves.toMatchObject({
      outcome: "unconfigured",
    });
    expect(publishMock).not.toHaveBeenCalled();
  });

  it("reports a publish failure rather than throwing", async () => {
    publishMock.mockRejectedValue(new Error("channel unavailable"));

    await expect(publishSnapshot(state)).resolves.toEqual({
      outcome: "failed",
      reason: "channel unavailable",
    });
  });

  it("never uses presence — the O(N^2) join storm infrastructure.md names", async () => {
    publishMock.mockResolvedValue(undefined);

    await publishSnapshot(state);

    const channel = channelsGetMock.mock.results[0]!.value as Record<
      string,
      unknown
    >;
    expect(channel.presence).toBeUndefined();
  });
});
