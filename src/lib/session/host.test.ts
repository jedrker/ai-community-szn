import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readSessionMock = vi.fn();
const writeSessionMock = vi.fn();
const publishSnapshotMock = vi.fn();

vi.mock("./store", () => ({
  readSession: readSessionMock,
  writeSession: writeSessionMock,
}));

vi.mock("./realtime", () => ({
  publishSnapshot: publishSnapshotMock,
}));

const { applyHostAction, authorizeHost, extractSecret, HOST_SECRET_HEADER } =
  await import("./host");
const { quiz } = await import("../../quiz/index");
type SessionState = import("./state").SessionState;

const NOW = 1_785_000_000_000;
const SECRET = "a-very-long-test-secret-value";

const lobby = {
  version: 1,
  phase: "lobby" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW,
};

function opened(version: number) {
  return {
    version,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[0]!.id,
    startedAt: NOW,
    updatedAt: NOW + 100,
  };
}

/**
 * The advance-shaped transition used across these tests. Typed against
 * `SessionState` rather than the narrow literal types of the fixtures above —
 * `applyHostAction` hands its callback any valid state, so a narrower parameter
 * would be unsound.
 */
const openFirstQuestion = (current: SessionState): SessionState =>
  opened(current.version + 1);

beforeEach(() => {
  readSessionMock.mockReset();
  writeSessionMock.mockReset();
  publishSnapshotMock.mockReset();
  vi.stubEnv("LIVEQUIZ_HOST_SECRET", SECRET);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("authorizeHost", () => {
  it("accepts the configured secret", () => {
    expect(authorizeHost(SECRET).ok).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(authorizeHost("wrong").ok).toBe(false);
  });

  /**
   * The distinction matters operationally: the runbook tells the host that
   * `session.action.stale` is a benign double-tap race and can be ignored. Logging
   * an unauthorized attempt under that name would hide the only security-relevant
   * signal behind the one event nobody looks at.
   */
  it("logs a rejection as session.auth.rejected, not as a stale action", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    authorizeHost("wrong");

    const line = log.mock.calls.map(([first]) => String(first)).join("\n");
    expect(line).toContain("session.auth.rejected");
    expect(line).not.toContain("session.action.stale");
    // And never the secret itself, in either direction.
    expect(line).not.toContain(SECRET);
    expect(line).not.toContain("wrong");
  });

  it("rejects a missing secret", () => {
    expect(authorizeHost(null).ok).toBe(false);
  });

  /**
   * An unset secret must not mean "everything is authorized". That would turn a
   * forgotten environment variable into an open write path on a production site
   * whose host view is already unprotected by design.
   */
  it("rejects everything when the secret is not configured", () => {
    vi.stubEnv("LIVEQUIZ_HOST_SECRET", "");
    expect(authorizeHost("").ok).toBe(false);
    expect(authorizeHost(SECRET).ok).toBe(false);
  });
});

describe("extractSecret", () => {
  it("reads the header", async () => {
    const request = new Request("https://example.test/api/quiz/host/advance", {
      method: "POST",
      headers: { [HOST_SECRET_HEADER]: SECRET },
    });

    await expect(extractSecret(request)).resolves.toBe(SECRET);
  });

  it("falls back to a form field", async () => {
    const form = new FormData();
    form.set("secret", SECRET);
    const request = new Request("https://example.test/api/quiz/host/advance", {
      method: "POST",
      body: form,
    });

    await expect(extractSecret(request)).resolves.toBe(SECRET);
  });

  it("returns null when neither is present", async () => {
    const request = new Request("https://example.test/api/quiz/host/advance", {
      method: "POST",
    });

    await expect(extractSecret(request)).resolves.toBeNull();
  });
});

describe("applyHostAction", () => {
  it("writes and publishes, reporting the new state", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: lobby });
    writeSessionMock.mockResolvedValue({ outcome: "applied", state: opened(2) });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    const result = await applyHostAction(openFirstQuestion, NOW);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ state: opened(2), applied: true });
    expect(writeSessionMock).toHaveBeenCalledWith(1, opened(2));
  });

  /**
   * The decision the plan review installed. A stage double-tap is a no-op, not a
   * failure — but reporting plain success would make the host count two advances
   * and lose track of where the room is.
   */
  it("reports a stale write as already-applied, not as success or an error", async () => {
    readSessionMock
      .mockResolvedValueOnce({ outcome: "ok", state: lobby })
      .mockResolvedValueOnce({ outcome: "ok", state: opened(2) });
    writeSessionMock.mockResolvedValue({ outcome: "stale", version: 2 });

    const result = await applyHostAction(openFirstQuestion, NOW);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ applied: false, note: "already-applied" });
    // The host is shown where the room actually is, not where it was.
    expect(result.body).toMatchObject({ state: opened(2) });
    expect(publishSnapshotMock).not.toHaveBeenCalled();
  });

  it("treats a null transition as a no-op without writing", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: opened(4) });

    const result = await applyHostAction(() => null, NOW);

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ applied: false, note: "no-op" });
    expect(writeSessionMock).not.toHaveBeenCalled();
  });

  /**
   * The state is committed, so the host must not be told the action failed
   * outright — the retry is a re-broadcast, not a re-advance.
   */
  it("reports a publish failure as committed-but-not-broadcast", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: lobby });
    writeSessionMock.mockResolvedValue({ outcome: "applied", state: opened(2) });
    publishSnapshotMock.mockResolvedValue({ outcome: "failed", reason: "down" });

    const result = await applyHostAction(openFirstQuestion, NOW);

    expect(result.status).toBe(502);
    expect(result.body).toMatchObject({ applied: true });
    expect(result.body).toHaveProperty("error");
  });

  it("refuses to act when no session exists", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: null });

    const result = await applyHostAction(openFirstQuestion, NOW);

    expect(result.status).toBe(409);
    expect(writeSessionMock).not.toHaveBeenCalled();
  });

  it("surfaces an unconfigured store as 503", async () => {
    readSessionMock.mockResolvedValue({ outcome: "unconfigured", reason: "no url" });

    const result = await applyHostAction(openFirstQuestion, NOW);
    expect(result.status).toBe(503);
  });

  it("surfaces a store failure as 503 without throwing", async () => {
    readSessionMock.mockResolvedValue({ outcome: "failed", reason: "unreachable" });

    const result = await applyHostAction(openFirstQuestion, NOW);
    expect(result.status).toBe(503);
  });

  it("surfaces an invalid stored document as 409", async () => {
    readSessionMock.mockResolvedValue({ outcome: "invalid", problems: ["bad phase"] });

    const result = await applyHostAction(openFirstQuestion, NOW);
    expect(result.status).toBe(409);
  });

  /** Never a plain success when the store rejected the write. */
  it("does not report success on a store write failure", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: lobby });
    writeSessionMock.mockResolvedValue({ outcome: "failed", reason: "boom" });

    const result = await applyHostAction(openFirstQuestion, NOW);

    expect(result.status).toBe(503);
    expect(publishSnapshotMock).not.toHaveBeenCalled();
  });
});

describe("applyHostAction with a caller-confirmed version", () => {
  /**
   * The race the impl review caught (F1). A route that validates a confirmation
   * against its own read and then calls `applyHostAction` has performed a
   * read-then-write across two round trips: the check ran against the route's read,
   * the write against this function's later one. Anything that moved the session in
   * between would be committed without ever having been confirmed — the guard would
   * look like it held while authorizing a state the host never saw.
   *
   * That is precisely what the spine contract's rule 3 forbids, and it is why `end`
   * passes its confirmed version through instead of trusting the re-read.
   */
  it("refuses when the session moved since the caller confirmed it", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: opened(4) });

    const outcome = await applyHostAction(openFirstQuestion, NOW, writeSessionMock, 3);

    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ applied: false, note: "already-applied" });
    // Nothing was committed against a version the caller never saw.
    expect(writeSessionMock).not.toHaveBeenCalled();
  });

  it("proceeds when the confirmed version still matches", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: opened(3) });
    writeSessionMock.mockResolvedValue({ outcome: "applied", state: opened(4) });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    const outcome = await applyHostAction(openFirstQuestion, NOW, writeSessionMock, 3);

    expect(outcome.status).toBe(200);
    expect(writeSessionMock).toHaveBeenCalledWith(3, expect.objectContaining({ version: 4 }));
  });

  it("leaves the flow verbs unguarded — a replayed advance stays a harmless no-op", async () => {
    readSessionMock.mockResolvedValue({ outcome: "ok", state: opened(9) });
    writeSessionMock.mockResolvedValue({ outcome: "applied", state: opened(10) });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    // No confirmed version supplied: start/advance/reveal are safe precisely
    // BECAUSE a repeat is idempotent, and must not inherit end's stricter guard.
    const outcome = await applyHostAction(openFirstQuestion, NOW, writeSessionMock);

    expect(outcome.status).toBe(200);
    expect(writeSessionMock).toHaveBeenCalled();
  });
});
