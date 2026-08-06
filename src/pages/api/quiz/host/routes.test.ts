import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The host routes are mostly thin, but not entirely — `reveal` turns a store-level
 * no-op into a `409` by inspecting the outcome shape, and `start` branches on
 * created-vs-existing. That logic lives in exactly one place each and would break
 * silently if `applyHostAction`'s outcome shape changed, because nothing else
 * reads it.
 *
 * `createSession` and `applyHostAction` are mocked: what is under test here is the
 * branching, not the store.
 */

const applyHostActionMock = vi.fn();
const createSessionMock = vi.fn();
const publishSnapshotMock = vi.fn();

const SECRET = "a-very-long-test-secret-value";

vi.mock("../../../../lib/session/host", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/session/host")>(
    "../../../../lib/session/host"
  );
  return { ...actual, applyHostAction: applyHostActionMock };
});

vi.mock("../../../../lib/session/store", () => ({ createSession: createSessionMock }));
vi.mock("../../../../lib/session/realtime", () => ({
  publishSnapshot: publishSnapshotMock,
  SESSION_CHANNEL: "livequiz:session",
  SNAPSHOT_EVENT: "snapshot",
}));

const { POST: start } = await import("./start");
const { POST: advance } = await import("./advance");
const { POST: reveal } = await import("./reveal");
const { HOST_SECRET_HEADER } = await import("../../../../lib/session/host");
const { quiz } = await import("../../../../quiz/index");

const NOW = 1_785_000_000_000;

const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
};

const revealed = {
  version: 4,
  phase: "question-revealed" as const,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: NOW,
  updatedAt: NOW + 900,
};

/**
 * Astro hands the handler a full `APIContext`; these routes read only `request`,
 * so the rest is cast away rather than stubbed. Typed against `APIRoute` so the
 * helper accepts the real handler signature.
 */
function call(
  handler: import("astro").APIRoute,
  { secret = SECRET }: { secret?: string | null } = {}
): Promise<Response> | Response {
  const headers: Record<string, string> = { Origin: "https://example.test" };
  if (secret !== null) headers[HOST_SECRET_HEADER] = secret;

  return handler({
    request: new Request("https://example.test/api/quiz/host/x", {
      method: "POST",
      headers,
    }),
  } as never);
}

beforeEach(() => {
  applyHostActionMock.mockReset();
  createSessionMock.mockReset();
  publishSnapshotMock.mockReset();
  vi.stubEnv("LIVEQUIZ_HOST_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the host secret guards every route", () => {
  it.each([
    ["start", start],
    ["advance", advance],
    ["reveal", reveal],
  ])("%s rejects a missing secret with 401", async (_name, handler) => {
    const response = await call(handler, { secret: null });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toHaveProperty("error");
    expect(applyHostActionMock).not.toHaveBeenCalled();
    expect(createSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["start", start],
    ["advance", advance],
    ["reveal", reveal],
  ])("%s rejects a wrong secret with 401", async (_name, handler) => {
    const response = await call(handler, { secret: "wrong" });
    expect(response.status).toBe(401);
  });
});

describe("start", () => {
  it("reports a created session as applied", async () => {
    createSessionMock.mockResolvedValue({ outcome: "created", state: lobby });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    const response = await call(start);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: lobby, applied: true });
  });

  /** Idempotence surfaced to the host: not an error, not a plain success. */
  it("reports an existing session as already-started without resetting it", async () => {
    createSessionMock.mockResolvedValue({ outcome: "exists", state: revealed });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    const response = await call(start);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ applied: false, note: "already-started" });
    // The existing state is returned untouched — a double-tapped start must not
    // rewind a running session.
    expect(body.state).toEqual(revealed);
  });

  it("re-broadcasts even when the session already existed", async () => {
    createSessionMock.mockResolvedValue({ outcome: "exists", state: revealed });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    await call(start);

    expect(publishSnapshotMock).toHaveBeenCalledWith(revealed);
  });

  it("reports a committed-but-unbroadcast state as 502, not as a failure", async () => {
    createSessionMock.mockResolvedValue({ outcome: "created", state: lobby });
    publishSnapshotMock.mockResolvedValue({ outcome: "failed", reason: "down" });

    const response = await call(start);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ applied: true });
  });

  it("surfaces an unconfigured store as 503", async () => {
    createSessionMock.mockResolvedValue({ outcome: "unconfigured", reason: "no url" });

    const response = await call(start);
    expect(response.status).toBe(503);
  });
});

describe("advance", () => {
  it("passes a transition that opens the next question", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });

    await call(advance);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const next = transition(lobby, NOW);
    // From the lobby, advance opens question 1 — FR-002's gathering beat means
    // `start` does not.
    expect(next).toMatchObject({
      version: 2,
      phase: "question-open",
      currentQuestionId: quiz.questions[0]!.id,
    });
  });

  it("returns null past the last question so the route is a no-op, not an error", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: false, note: "no-op" },
    });

    await call(advance);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const last = quiz.questions[quiz.questions.length - 1]!.id;
    expect(transition({ ...revealed, currentQuestionId: last }, NOW)).toBeNull();
  });
});

describe("reveal", () => {
  /**
   * THE BRANCH THIS FILE EXISTS FOR. A no-op in the store means two different
   * things to a host: "nothing is open, your click was a mistake" and "already
   * revealed, harmless". Only the first deserves an error.
   */
  it("turns a lobby no-op into 409 with a Polish explanation", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: lobby, applied: false, note: "no-op" },
    });

    const response = await call(reveal);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Żadne pytanie nie jest otwarte");
  });

  it("leaves an already-revealed no-op as a 200", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: false, note: "no-op" },
    });

    const response = await call(reveal);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ applied: false });
  });

  it("passes a transition that reveals an open question", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });

    await call(reveal);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const open = { ...revealed, phase: "question-open" as const, version: 3 };
    expect(transition(open, NOW)).toMatchObject({
      version: 4,
      phase: "question-revealed",
      currentQuestionId: open.currentQuestionId,
    });
  });

  it("refuses to reveal from the lobby at the transition level too", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: lobby, applied: false, note: "no-op" },
    });

    await call(reveal);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    expect(transition(lobby, NOW)).toBeNull();
    expect(transition(revealed, NOW)).toBeNull();
  });
});
