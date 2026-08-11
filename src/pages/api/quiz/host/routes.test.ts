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
const readSessionMock = vi.fn();
const endSessionMock = vi.fn();
const purgeSessionMock = vi.fn();
const readQuestionTalliesMock = vi.fn();
const readStandingsMock = vi.fn();

const SECRET = "a-very-long-test-secret-value";

vi.mock("../../../../lib/session/host", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/session/host")>(
    "../../../../lib/session/host"
  );
  return { ...actual, applyHostAction: applyHostActionMock };
});

vi.mock("../../../../lib/session/store", () => ({
  createSession: createSessionMock,
  readSession: readSessionMock,
  endSession: endSessionMock,
  purgeSession: purgeSessionMock,
  readQuestionTallies: readQuestionTalliesMock,
  readStandings: readStandingsMock,
}));
vi.mock("../../../../lib/session/realtime", () => ({
  publishSnapshot: publishSnapshotMock,
  SESSION_CHANNEL: "livequiz:session",
  SNAPSHOT_EVENT: "snapshot",
}));

const { POST: start } = await import("./start");
const { POST: advance } = await import("./advance");
const { POST: reveal, formatCorrectValue } = await import("./reveal");
const { POST: showStandings } = await import("./standings");
const { POST: end } = await import("./end");
const { POST: purge } = await import("./purge");
const { HOST_SECRET_HEADER } = await import("../../../../lib/session/host");
const { initialSessionState } = await import("../../../../lib/session/state");
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
 * The leaderboard beat (roadmap S-07). It carries the question the room has just been
 * through — see the phase's note in `state.ts` — which is exactly what makes an
 * unguarded `reveal` from here build a valid document instead of failing.
 */
const standings = {
  version: 5,
  phase: "standings" as const,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: NOW,
  updatedAt: NOW + 1_200,
  standings: { rows: [{ rank: 1, displayName: "Ala", points: 30 }], playerCount: 4 },
};

/**
 * Astro hands the handler a full `APIContext`; these routes read only `request`,
 * so the rest is cast away rather than stubbed. Typed against `APIRoute` so the
 * helper accepts the real handler signature.
 */
function call(
  handler: import("astro").APIRoute,
  {
    secret = SECRET,
    version,
  }: { secret?: string | null; version?: number | string } = {}
): Promise<Response> | Response {
  const headers: Record<string, string> = { Origin: "https://example.test" };
  if (secret !== null) headers[HOST_SECRET_HEADER] = secret;

  // Only `end` and `purge` read a body. Omitting it entirely is how the
  // missing-confirmation case is expressed, and it also keeps the three flow verbs
  // exercising exactly the request shape they see today.
  let body: FormData | undefined;
  if (version !== undefined) {
    body = new FormData();
    body.set("version", String(version));
  }

  return handler({
    request: new Request("https://example.test/api/quiz/host/x", {
      method: "POST",
      headers,
      body,
    }),
  } as never);
}

beforeEach(() => {
  applyHostActionMock.mockReset();
  createSessionMock.mockReset();
  publishSnapshotMock.mockReset();
  readSessionMock.mockReset();
  readStandingsMock.mockReset();
  endSessionMock.mockReset();
  purgeSessionMock.mockReset();
  readQuestionTalliesMock.mockReset();
  readQuestionTalliesMock.mockResolvedValue({ answered: 0, options: {} });
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
    // Awaited: the transition became async in S-04 so it can read the tallies here
    // rather than in `applyHostAction`, where the read would apply to every action.
    await expect(transition(open, NOW)).resolves.toMatchObject({
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
    await expect(transition(lobby, NOW)).resolves.toBeNull();
    await expect(transition(revealed, NOW)).resolves.toBeNull();
  });

  /**
   * THE SILENT FALL-THROUGH (roadmap S-07).
   *
   * A standings state is the one no-op case that does not announce itself. It keeps a
   * `currentQuestionId` — that is what stops `advance` reopening question 1 — so without
   * an explicit branch it reaches the builder with everything needed to produce a valid
   * `question-revealed` document, and the room is sent back to a question it has already
   * finished with. Nothing rejects it and the snapshot publishes.
   *
   * The fixture proves the branch: its phase is none of `lobby`, `ended` or
   * `question-revealed`, so no pre-existing guard can account for the null.
   */
  it("refuses to reveal from the standings beat, which would otherwise re-reveal", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: standings, applied: false, note: "no-op" },
    });

    await call(reveal);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    await expect(transition(standings, NOW)).resolves.toBeNull();
  });

  it("turns a standings no-op into 409 with a Polish explanation", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: standings, applied: false, note: "no-op" },
    });

    const response = await call(reveal);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Ranking jest już pokazany");
  });

  /**
   * THE DISTRIBUTION, which is the payload S-04 adds to this transition and to no
   * other. These assertions run the transition directly rather than reading a mocked
   * outcome, because what is under test is what the closure *builds* — the store and
   * the publish are somebody else's tests.
   */
  it("attaches the room's answers to the revealed state", async () => {
    readQuestionTalliesMock.mockResolvedValue({ answered: 9, options: { a: 5, b: 4 } });
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });

    await call(reveal);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    // A choice question specifically — `quiz.questions[0]` is the word-cloud opener, and
    // building this fixture from it would have exercised the skip path while looking
    // like it exercised the read.
    const choice = quiz.questions.find((question) => question.kind === "single-choice")!;
    const open = {
      ...revealed,
      phase: "question-open" as const,
      currentQuestionId: choice.id,
      version: 3,
    };
    const next = await transition(open, NOW);

    expect(next.revealedDistribution).toEqual({ answered: 9, options: { a: 5, b: 4 } });
    // Read for the question being revealed, and asked for that question's own option
    // ids — not for whatever the previous reveal happened to look at.
    expect(readQuestionTalliesMock).toHaveBeenCalledWith(
      choice.id,
      choice.options.map((option) => option.id)
    );
  });

  /**
   * **A failed read publishes `null`, never `{ answered: 0 }`.** The reveal itself must
   * still succeed — it is the beat that must not break, and `revealedOptionIds` still
   * marks the right answer, so FR-016 holds. But zeroes render as every bar empty,
   * which on a projector is the claim "nobody answered", made to a room that just
   * answered. Asserted against the *value*, because a test that only checked the reveal
   * succeeded would pass against exactly that bug.
   */
  it("still reveals when the tally read fails, with the distribution null rather than zeroed", async () => {
    readQuestionTalliesMock.mockResolvedValue(null);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });

    const response = await call(reveal);
    expect(response.status).toBe(200);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const choice = quiz.questions.find((question) => question.kind === "single-choice")!;
    const open = {
      ...revealed,
      phase: "question-open" as const,
      currentQuestionId: choice.id,
      version: 3,
    };
    const next = await transition(open, NOW);

    expect(next.revealedDistribution).toBeNull();
    expect(next.revealedDistribution).not.toEqual({ answered: 0, options: {} });
    // The answer key is unaffected — the two fields fail independently on purpose.
    expect(next.revealedOptionIds).not.toBeNull();
  });

  /**
   * The one place the distribution and `revealedOptionIds` diverge: that field yields
   * `[]` for a non-choice kind, because "no options are correct" is a fact about the
   * question, while "no distribution" is an absence. The panel is hidden for these
   * kinds anyway, and no submission for one can exist today.
   */
  it("publishes a null distribution for a non-choice question, and spends no read on it", async () => {
    const nonChoice = quiz.questions.find(
      (question) => question.kind !== "single-choice" && question.kind !== "multiple-choice"
    )!;
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });

    await call(reveal);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const open = {
      ...revealed,
      phase: "question-open" as const,
      currentQuestionId: nonChoice.id,
      version: 3,
    };
    const next = await transition(open, NOW);

    expect(next.revealedDistribution).toBeNull();
    expect(next.revealedOptionIds).toEqual([]);
    expect(readQuestionTalliesMock).not.toHaveBeenCalled();
  });
});

/**
 * `end` and `purge` are the project's first irreversible host actions, and their
 * guards are the entire safety story — each is one condition away from being useless,
 * and none of them is exercised by anything else. That is what this block is for.
 */

const open = {
  version: 3,
  phase: "question-open" as const,
  currentQuestionId: quiz.questions[0]!.id,
  startedAt: NOW,
  updatedAt: NOW + 700,
};

const ended = {
  version: 5,
  phase: "ended" as const,
  currentQuestionId: null,
  startedAt: NOW,
  updatedAt: NOW + 1200,
};

function sessionIs(state: unknown) {
  readSessionMock.mockResolvedValue({ outcome: "ok", state });
}

describe("the host secret guards the destructive routes too", () => {
  it.each([
    ["end", end],
    ["purge", purge],
  ])("%s rejects a missing secret with 401", async (_name, handler) => {
    const response = await call(handler, { secret: null, version: 1 });

    expect(response.status).toBe(401);
    // Nothing may be read, let alone written, before authorization.
    expect(readSessionMock).not.toHaveBeenCalled();
    expect(purgeSessionMock).not.toHaveBeenCalled();
  });

  it.each([
    ["end", end],
    ["purge", purge],
  ])("%s rejects a wrong secret with 401", async (_name, handler) => {
    const response = await call(handler, { secret: "wrong", version: 1 });
    expect(response.status).toBe(401);
  });
});

describe("end", () => {
  it("refuses to fire while a question is open", async () => {
    sessionIs(open);

    const response = await call(end, { version: open.version });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("Pytanie jest wciąż otwarte");
    expect(applyHostActionMock).not.toHaveBeenCalled();
  });

  it("is accepted from question-revealed", async () => {
    sessionIs(revealed);
    applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

    const response = await call(end, { version: revealed.version });

    expect(response.status).toBe(200);
    expect(applyHostActionMock).toHaveBeenCalled();
  });

  it("is accepted from the lobby, so a session that never ran can still be closed", async () => {
    sessionIs(lobby);
    applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

    const response = await call(end, { version: lobby.version });

    expect(response.status).toBe(200);
  });

  it("commits through endSession, not the ordinary write", async () => {
    sessionIs(revealed);
    applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

    await call(end, { version: revealed.version });

    // The third argument is the writer. Passing the default here would leave every
    // key on the four-hour lifetime while the document said the session was over.
    const [, , writer] = applyHostActionMock.mock.calls[0]!;
    expect(writer).toBe(endSessionMock);
  });

  it("produces a terminal state at a strictly higher version", async () => {
    sessionIs(revealed);
    applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

    await call(end, { version: revealed.version });

    const [transition] = applyHostActionMock.mock.calls[0]!;
    const next = transition(revealed, NOW + 9_000);

    expect(next.phase).toBe("ended");
    expect(next.currentQuestionId).toBeNull();
    expect(next.version).toBeGreaterThan(revealed.version);
  });

  describe("the confirmation guard", () => {
    it("refuses a request with no confirmation at all", async () => {
      sessionIs(revealed);

      const response = await call(end);
      const body = await response.json();

      expect(response.status).toBe(409);
      expect(body.error).toContain("wymaga potwierdzenia");
      expect(applyHostActionMock).not.toHaveBeenCalled();
    });

    it("refuses a stale confirmation and reports the version that is actually current", async () => {
      sessionIs(revealed);

      const response = await call(end, { version: revealed.version - 1 });
      const body = await response.json();

      expect(response.status).toBe(409);
      // The host has to be told where the session really is, or the retry is blind.
      expect(body.error).toContain(String(revealed.version));
      expect(applyHostActionMock).not.toHaveBeenCalled();
    });

    /**
     * THE INVERSION THIS GUARD EXISTS FOR. start/advance/reveal are safe on stage
     * because a replayed request is a harmless no-op. `end` has to be safe for the
     * opposite reason: a replayed request must be REFUSED. Once the first end lands,
     * the version has moved, so the identical second request no longer matches.
     */
    it("refuses a replay of the identical request", async () => {
      sessionIs(revealed);
      applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

      const first = await call(end, { version: revealed.version });
      expect(first.status).toBe(200);

      // The session has moved on; the same body arrives again.
      sessionIs(ended);
      const second = await call(end, { version: revealed.version });

      expect(second.status).toBe(200);
      await expect(second.json()).resolves.toMatchObject({
        applied: false,
        note: "already-ended",
      });
    });

    it("ignores a non-numeric confirmation rather than coercing it", async () => {
      sessionIs(revealed);

      const response = await call(end, { version: "nonsense" });

      expect(response.status).toBe(409);
      expect(applyHostActionMock).not.toHaveBeenCalled();
    });
  });

  it("passes the confirmed version through to the write, not the re-read one", async () => {
    sessionIs(revealed);
    applyHostActionMock.mockResolvedValue({ status: 200, body: { state: ended, applied: true } });

    await call(end, { version: revealed.version });

    const [, , , expectedVersion] = applyHostActionMock.mock.calls[0]!;
    expect(expectedVersion).toBe(revealed.version);
  });

  it("reports an already-ended session as a no-op rather than an error", async () => {
    sessionIs(ended);

    const response = await call(end, { version: ended.version });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ note: "already-ended" });
  });

  it("refuses when no session has been started", async () => {
    sessionIs(null);

    const response = await call(end, { version: 1 });
    expect(response.status).toBe(409);
  });
});

describe("purge", () => {
  /**
   * The asymmetry with `end`, pinned deliberately. `purge` is the escape hatch for
   * exactly the mid-question abandonment `end` refuses — a session going wrong, a room
   * being evacuated. Someone applying the two routes' rules symmetrically would add a
   * phase guard here and remove the only exit.
   */
  it("IS accepted while a question is open, unlike end", async () => {
    sessionIs(open);
    endSessionMock.mockResolvedValue({ outcome: "applied", state: { ...ended, version: 4 } });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 1 });

    const response = await call(purge, { version: open.version });

    expect(response.status).toBe(200);
    expect(purgeSessionMock).toHaveBeenCalled();
  });

  it("writes, then publishes, then deletes — in that order", async () => {
    sessionIs(revealed);
    endSessionMock.mockResolvedValue({ outcome: "applied", state: ended });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 1 });

    await call(purge, { version: revealed.version });

    const wrote = endSessionMock.mock.invocationCallOrder[0]!;
    const published = publishSnapshotMock.mock.invocationCallOrder[0]!;
    const deleted = purgeSessionMock.mock.invocationCallOrder[0]!;

    expect(wrote).toBeLessThan(published);
    expect(published).toBeLessThan(deleted);
  });

  /**
   * The bug this ordering exists to prevent. Clients drop any snapshot not strictly
   * newer than what they hold, so a purge that broadcast the session at its existing
   * version would be discarded by every device — the closing screen would never
   * change and the failure would look like a dead network.
   */
  it("publishes a snapshot strictly newer than the one it read", async () => {
    sessionIs(revealed);
    endSessionMock.mockResolvedValue({ outcome: "applied", state: ended });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 1 });

    await call(purge, { version: revealed.version });

    const [published] = publishSnapshotMock.mock.calls[0]!;
    expect(published.version).toBeGreaterThan(revealed.version);
    expect(published.phase).toBe("ended");
  });

  it("deletes even when the broadcast fails — retention outranks the closing screen", async () => {
    sessionIs(revealed);
    endSessionMock.mockResolvedValue({ outcome: "applied", state: ended });
    publishSnapshotMock.mockResolvedValue({ outcome: "failed", reason: "ably down" });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 1 });

    const response = await call(purge, { version: revealed.version });

    expect(purgeSessionMock).toHaveBeenCalled();
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ purged: true });
  });

  it("refuses rather than forcing when the state moved under it", async () => {
    sessionIs(revealed);
    endSessionMock.mockResolvedValue({ outcome: "stale", version: 99 });

    const response = await call(purge, { version: revealed.version });

    expect(response.status).toBe(409);
    // A wipe must not proceed unattended when someone else is driving the session.
    expect(purgeSessionMock).not.toHaveBeenCalled();
  });

  it("runs with no session at all, and says nothing was there", async () => {
    sessionIs(null);
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 0 });

    const response = await call(purge);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ purged: true, keysRemoved: 0, note: "nothing-to-purge" });
    // No confirmation is demanded, because there is no version to confirm against.
    expect(endSessionMock).not.toHaveBeenCalled();
  });

  it("cleans up residue behind an unparseable document", async () => {
    readSessionMock.mockResolvedValue({ outcome: "invalid", problems: ["broken"] });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 2 });

    const response = await call(purge);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ note: "residue-removed" });
  });

  it("still demands confirmation when a readable session exists", async () => {
    sessionIs(revealed);

    const response = await call(purge);

    expect(response.status).toBe(409);
    expect(purgeSessionMock).not.toHaveBeenCalled();
  });

  it("skips the terminal write when the session is already ended", async () => {
    sessionIs(ended);
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });
    purgeSessionMock.mockResolvedValue({ outcome: "purged", keysRemoved: 1 });

    const response = await call(purge, { version: ended.version });

    expect(response.status).toBe(200);
    expect(endSessionMock).not.toHaveBeenCalled();
    expect(purgeSessionMock).toHaveBeenCalled();
  });
});

describe("the flow verbs refuse to reopen an ended session", () => {
  /**
   * An ended session has `currentQuestionId: null`, exactly like the lobby. Without
   * an explicit guard, `nextQuestionId(null)` returns question 1 and `advance` would
   * REOPEN a quiz the host had closed — on a document already living on the short
   * ended lifetime.
   */
  it("advance is a no-op on an ended session rather than restarting the quiz", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: ended, applied: false, note: "no-op" },
    });

    await call(advance);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    expect(transition(ended, NOW)).toBeNull();
  });

  it("reveal reports 409 on an ended session instead of failing the schema", async () => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: ended, applied: false, note: "no-op" },
    });

    const response = await call(reveal);
    const body = await response.json();

    // Falling through would build a question-revealed state with a null question,
    // which the schema rejects — a 503 where the honest answer is "it's over".
    expect(response.status).toBe(409);
    expect(body.error).toContain("Sesja została zakończona");
  });
});

describe("the reveal payload (roadmap S-03)", () => {
  /**
   * `applyHostAction` is mocked, so the transition itself is exercised by capturing
   * the callback the route hands it and running it against a state. That is the only
   * place `revealedOptionIds` is ever set, which makes it worth pinning here.
   */
  function transitionFrom(): (current: any, now: number) => any {
    return applyHostActionMock.mock.calls[0]![0] as (current: any, now: number) => any;
  }

  const open = (questionId: string) => ({
    version: 3,
    phase: "question-open" as const,
    currentQuestionId: questionId,
    startedAt: NOW,
    updatedAt: NOW + 500,
    playerCount: 6,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
  });

  beforeEach(() => {
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: revealed, applied: true },
    });
  });

  it("puts the correct option ids on the revealed state", async () => {
    await call(reveal);

    const next = await transitionFrom()(open("llm-skrot"), NOW + 5_000);

    expect(next.revealedOptionIds).toEqual(["large-language-model"]);
  });

  it("carries every correct id for a multi-answer question", async () => {
    await call(reveal);

    const next = await transitionFrom()(open("summer-tour-zakonczenie"), NOW + 5_000);

    expect(next.revealedOptionIds).toEqual(["kino", "networking"]);
  });

  it("reveals an empty array for an unscored choice question", async () => {
    await call(reveal);

    // Nothing to highlight, and the client must read that as a warm-up rather than
    // as an error — this is the gather beat that welcomes latecomers.
    expect((await transitionFrom()(open("czy-wszyscy-gotowi"), NOW)).revealedOptionIds).toEqual([]);
  });

  it("reveals an empty array for a kind with no options", async () => {
    // A text question has no options to highlight — its answer travels on
    // `revealedAnswerText` instead (see the S-05 block below). Number and word-cloud
    // are still S-06/S-08.
    await call(reveal);

    expect((await transitionFrom()(open("zmyslanie-faktow"), NOW)).revealedOptionIds).toEqual([]);
  });

  it("advance clears it, so an answer key cannot outlive its question", async () => {
    await call(advance);

    const next = transitionFrom()(
      { ...open("llm-skrot"), phase: "question-revealed", revealedOptionIds: ["large-language-model"] },
      NOW + 9_000
    );

    // THE ONE THAT MATTERS. A carried value publishes the previous question's answer
    // key alongside the new question, to every phone in the room.
    expect(next.revealedOptionIds).toBeNull();
  });

  /**
   * The same for the distribution, and it is the sharper of the two: a carried value
   * puts the previous question's bars on the projector while the new question is being
   * answered — a running tally of what the room is choosing, which is exactly what
   * FR-005 was revised to keep off the screen.
   */
  it("advance clears the distribution too, and spends no tally read doing it", async () => {
    await call(advance);

    const next = transitionFrom()(
      {
        ...open("llm-skrot"),
        phase: "question-revealed",
        revealedOptionIds: ["large-language-model"],
        revealedDistribution: { answered: 12, options: { "large-language-model": 12 } },
      },
      NOW + 9_000
    );

    expect(next.revealedDistribution).toBeNull();
    // `advance` stayed synchronous and reads nothing. The read lives in `reveal.ts`
    // alone — putting it in `applyHostAction` is what would have attached a
    // distribution to this transition.
    expect(readQuestionTalliesMock).not.toHaveBeenCalled();
  });

  it("start publishes a lobby with the distribution null", async () => {
    createSessionMock.mockResolvedValue({ outcome: "created", state: initialSessionState(NOW) });
    publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

    await call(start);

    const [published] = publishSnapshotMock.mock.calls[0]!;
    expect(published.revealedDistribution).toBeNull();
  });

  /**
   * The free-text answer on the wire (roadmap S-05, FR-016).
   *
   * The accepted answer rides the snapshot for the reason `revealedOptionIds` does:
   * it reaches 150 phones and the projector without 150 requests, and a device whose
   * own result fetch fails still sees the right answer.
   */
  describe("revealedAnswerText", () => {
    /**
     * Read from the definition rather than hardcoded, so an edit to the question's
     * accepted variants fails here instead of silently passing against a stale
     * literal. Guarded by kind, so this cannot quietly become a non-text question.
     */
    const textQuestion = quiz.questions.find((question) => question.id === "zmyslanie-faktow");
    if (textQuestion?.kind !== "text") throw new Error("expected a text question");

    it("publishes the first accepted variant for a text question", async () => {
      await call(reveal);

      const next = await transitionFrom()(open("zmyslanie-faktow"), NOW + 5_000);

      // The first variant specifically — a list of all four would read as though
      // several different answers were expected.
      expect(next.revealedAnswerText).toBe(textQuestion.acceptedAnswers[0]);
      expect(next.revealedAnswerText).not.toBeNull();
    });

    it("is null for a choice question, whose answer travels as option ids", async () => {
      await call(reveal);

      const next = await transitionFrom()(open("llm-skrot"), NOW + 5_000);

      expect(next.revealedAnswerText).toBeNull();
    });

    it("is null for the word-cloud kind, which has no correct answer to state", async () => {
      await call(reveal);

      // The one remaining kind (S-08). FR-015 lets its aggregate display live
      // precisely because there is nothing correct to leak.
      const wordCloud = quiz.questions.find((question) => question.kind === "word-cloud");
      if (wordCloud === undefined) throw new Error("expected a word-cloud question");

      expect((await transitionFrom()(open(wordCloud.id), NOW)).revealedAnswerText).toBeNull();
    });

    /**
     * The numeric half of the same job (roadmap S-06, FR-013).
     *
     * Both live number questions, because their true values are two orders of
     * magnitude apart and only the larger one exercises thousands grouping at all.
     */
    describe("a number question's true value", () => {
      const numberQuestions = quiz.questions.filter((question) => question.kind === "number");

      it("covers both drafted number questions", () => {
        // The table below is only worth what its fixtures are. If a question is
        // removed or retyped, fail here rather than passing on a shrunken set.
        expect(numberQuestions.map((question) => question.id)).toEqual([
          "lyro-automatyzacja",
          "ai-devs-absolwenci",
        ]);
      });

      it.each(numberQuestions)("publishes $id formatted for pl-PL", async (question) => {
        if (question.kind !== "number") throw new Error("expected a number question");

        await call(reveal);

        const next = await transitionFrom()(open(question.id), NOW + 5_000);

        // Built from the formatter, never typed: pl-PL groups with U+00A0, and a
        // hand-typed "10 000" fails with a diff in which both sides look identical.
        expect(next.revealedAnswerText).toBe(formatCorrectValue(question.correctValue));
      });

      it("groups thousands with a non-breaking space, not an ordinary one", async () => {
        // The trap stated as its own assertion, so the reason the expectation above
        // is built rather than typed survives in the suite.
        expect(formatCorrectValue(10000)).toBe("10\u00A0000");
        expect(formatCorrectValue(10000)).not.toBe("10 000");
      });

      it("leaves revealedOptionIds empty — a number question has none to highlight", async () => {
        await call(reveal);

        const next = await transitionFrom()(open("ai-devs-absolwenci"), NOW + 5_000);

        expect(next.revealedOptionIds).toEqual([]);
      });

      it("advance clears it, so a true value cannot outlive its question", async () => {
        await call(advance);

        // `lyro-automatyzacja`, not `ai-devs-absolwenci`: the latter is the last
        // question in the definition, so `advance` past it is a no-op that returns
        // no state at all and the assertion would never reach the transition.
        const next = transitionFrom()(
          {
            ...open("lyro-automatyzacja"),
            phase: "question-revealed",
            revealedAnswerText: formatCorrectValue(67),
          },
          NOW + 9_000
        );

        expect(next.revealedAnswerText).toBeNull();
      });
    });

    it("advance clears it, so an accepted answer cannot outlive its question", async () => {
      await call(advance);

      const next = transitionFrom()(
        {
          ...open("zmyslanie-faktow"),
          phase: "question-revealed",
          revealedAnswerText: textQuestion.acceptedAnswers[0],
        },
        NOW + 9_000
      );

      // Carried, it would put the previous question's accepted answer on 150 phones
      // while the next question is open.
      expect(next.revealedAnswerText).toBeNull();
    });

    it("start publishes a lobby with it null", async () => {
      createSessionMock.mockResolvedValue({ outcome: "created", state: initialSessionState(NOW) });
      publishSnapshotMock.mockResolvedValue({ outcome: "ok" });

      await call(start);

      const [published] = publishSnapshotMock.mock.calls[0]!;
      expect(published.revealedAnswerText).toBeNull();
    });
  });
});

/**
 * The leaderboard beat (roadmap S-07, PRD FR-014).
 *
 * Same shape of test as `reveal`'s: the transition closure is run directly, because what
 * is under test is what the closure *builds* and which phases it refuses. The store and
 * the publish are somebody else's tests.
 */
describe("standings", () => {
  const board = { rows: [{ rank: 1, displayName: "Ala", points: 30 }], playerCount: 4 };

  it("rejects a missing secret with 401 before reading anything", async () => {
    const response = await call(showStandings, { secret: null });

    expect(response.status).toBe(401);
    expect(applyHostActionMock).not.toHaveBeenCalled();
    expect(readStandingsMock).not.toHaveBeenCalled();
  });

  it("builds a standings state from a revealed question", async () => {
    readStandingsMock.mockResolvedValue(board);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: standings, applied: true },
    });

    await call(showStandings);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    await expect(transition(revealed, NOW)).resolves.toMatchObject({
      version: 5,
      phase: "standings",
      // THE FIELD THAT STOPS ADVANCE REOPENING QUESTION 1. Carried, not cleared.
      currentQuestionId: revealed.currentQuestionId,
      standings: board,
      revealedOptionIds: null,
      revealedDistribution: null,
      revealedAnswerText: null,
    });
  });

  /**
   * Reachable only from a reveal. `question-open` is the one that matters most: a board
   * on the projector while the room is still answering shows a contest mid-move, and it
   * moves again while they watch.
   */
  it.each([
    ["lobby", lobby],
    ["question-open", { ...revealed, phase: "question-open" as const }],
    ["ended", { ...lobby, phase: "ended" as const }],
    ["standings", standings],
  ])("refuses to build from %s", async (_name, state) => {
    readStandingsMock.mockResolvedValue(board);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state, applied: false, note: "no-op" },
    });

    await call(showStandings);

    const [transition] = applyHostActionMock.mock.calls[0]!;
    await expect(transition(state, NOW)).resolves.toBeNull();
  });

  it("leaves an already-showing board as a 200 no-op, not an error", async () => {
    readStandingsMock.mockResolvedValue(board);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: standings, applied: false, note: "no-op" },
    });

    const response = await call(showStandings);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ applied: false });
  });

  it("turns a no-op from the wrong phase into 409 with a Polish explanation", async () => {
    readStandingsMock.mockResolvedValue(board);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: lobby, applied: false, note: "no-op" },
    });

    const response = await call(showStandings);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toContain("po ujawnieniu odpowiedzi");
  });

  it("says the session is over when the no-op came from ended", async () => {
    readStandingsMock.mockResolvedValue(board);
    applyHostActionMock.mockResolvedValue({
      status: 200,
      body: { state: { ...lobby, phase: "ended" as const }, applied: false, note: "no-op" },
    });

    const response = await call(showStandings);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("zakończona"),
    });
  });

  /**
   * THE DEPARTURE FROM `reveal`, and the reason it is a departure. A failed tally read
   * still reveals, because the answer key is the beat and the bars are decoration. Here
   * the board IS the beat, so a transition that completed would put a blank screen in
   * front of the room. Asserted on the *status* and on the phase not moving, because a
   * handler that returned 200 with an unchanged state would look fine to a weaker test.
   */
  it("refuses the transition when the board cannot be read", async () => {
    readStandingsMock.mockResolvedValue(null);
    applyHostActionMock.mockImplementation(async (transition: never) => {
      const next = await (transition as unknown as (s: unknown, n: number) => Promise<unknown>)(
        revealed,
        NOW
      );
      return { status: 200, body: { state: revealed, applied: next !== null, note: "no-op" } };
    });

    const response = await call(showStandings);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toContain("Nie udało się odczytać rankingu");
  });
});
