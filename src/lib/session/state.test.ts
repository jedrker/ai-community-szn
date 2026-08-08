import { describe, expect, it } from "vitest";

import { quiz } from "../../quiz/index";
import {
  endedSessionState,
  initialSessionState,
  nextQuestionId,
  parseSessionState,
  sessionStateSchema,
} from "./state";

const NOW = 1_785_000_000_000;

describe("initialSessionState", () => {
  it("starts a session in the lobby at version 1", () => {
    const state = initialSessionState(NOW);

    expect(state).toEqual({
      version: 1,
      phase: "lobby",
      currentQuestionId: null,
      startedAt: NOW,
      updatedAt: NOW,
      playerCount: 0,
      revealedOptionIds: null,
    });
  });

  it("produces a document that satisfies its own schema", () => {
    expect(sessionStateSchema.safeParse(initialSessionState(NOW)).success).toBe(true);
  });

  /**
   * THE MID-DEPLOY TEST.
   *
   * A session running when S-02 ships holds a document written before `playerCount`
   * existed. If the field were required, the next read would report the document as
   * invalid — a 409 on the host's next action, in front of the room. The schema
   * default is what makes the old shape parse, and this is the test that stops the
   * default being tidied away as redundant.
   */
  it("parses a document written before playerCount existed, defaulting it to 0", () => {
    const beforeS02 = {
      version: 4,
      phase: "lobby",
      currentQuestionId: null,
      startedAt: NOW,
      updatedAt: NOW,
    };

    const result = sessionStateSchema.safeParse(beforeS02);

    expect(result.success).toBe(true);
    expect(result.data?.playerCount).toBe(0);
  });

  it("refuses a negative or fractional count", () => {
    const base = initialSessionState(NOW);
    expect(sessionStateSchema.safeParse({ ...base, playerCount: -1 }).success).toBe(false);
    expect(sessionStateSchema.safeParse({ ...base, playerCount: 1.5 }).success).toBe(false);
  });

  it("does not open the first question — FR-002 keeps a gathering beat", () => {
    expect(initialSessionState(NOW).currentQuestionId).toBeNull();
  });
});

describe("nextQuestionId", () => {
  it("opens the first question from the lobby", () => {
    expect(nextQuestionId(null)).toBe(quiz.questions[0]!.id);
  });

  it("walks the definition's order", () => {
    expect(nextQuestionId(quiz.questions[0]!.id)).toBe(quiz.questions[1]!.id);
  });

  it("returns null past the last question so advance is a no-op, not an error", () => {
    const last = quiz.questions[quiz.questions.length - 1]!.id;
    expect(nextQuestionId(last)).toBeNull();
  });

  it("returns null for a question id that is not in the definition", () => {
    expect(nextQuestionId("nie-ma-takiego-pytania")).toBeNull();
  });
});

describe("parseSessionState", () => {
  const openState = {
    version: 2,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[0]!.id,
    startedAt: NOW,
    updatedAt: NOW + 1000,
  };

  it("accepts a well-formed open question", () => {
    const result = parseSessionState(openState);
    expect(result.ok).toBe(true);
  });

  it("rejects a question id absent from the quiz definition", () => {
    const result = parseSessionState({
      ...openState,
      currentQuestionId: "pytanie-ktorego-nie-ma",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join(" ")).toContain("pytanie-ktorego-nie-ma");
    }
  });

  it("rejects a lobby that somehow has a question open", () => {
    const result = parseSessionState({
      ...openState,
      phase: "lobby",
    });

    expect(result.ok).toBe(false);
  });

  it("rejects an open phase with no question", () => {
    const result = parseSessionState({
      ...openState,
      currentQuestionId: null,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects version 0 — versions are positive so a missing field cannot pass as one", () => {
    expect(parseSessionState({ ...openState, version: 0 }).ok).toBe(false);
  });

  it("rejects a non-integer version", () => {
    expect(parseSessionState({ ...openState, version: 2.5 }).ok).toBe(false);
  });

  it("rejects an unknown phase", () => {
    expect(parseSessionState({ ...openState, phase: "finished" }).ok).toBe(false);
  });

  it("reports problems instead of throwing on junk", () => {
    const result = parseSessionState("not a session at all");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.length).toBeGreaterThan(0);
  });
});

describe("endedSessionState", () => {
  const revealed = {
    version: 7,
    phase: "question-revealed" as const,
    currentQuestionId: quiz.questions[0]!.id,
    startedAt: NOW,
    updatedAt: NOW + 5_000,
    playerCount: 9,
    revealedOptionIds: null,
  };

  it("bumps the version, so the terminal snapshot is newer than anything devices hold", () => {
    // Not cosmetic. Clients drop any snapshot whose version is not strictly greater
    // than the one they already have, so a terminal state at the same version would
    // be discarded by every device and the closing screen would never appear.
    expect(endedSessionState(revealed, NOW + 9_000).version).toBe(8);
  });

  it("clears the current question", () => {
    expect(endedSessionState(revealed, NOW + 9_000).currentQuestionId).toBeNull();
  });

  it("preserves startedAt and stamps updatedAt", () => {
    const ended = endedSessionState(revealed, NOW + 9_000);
    expect(ended.startedAt).toBe(NOW);
    expect(ended.updatedAt).toBe(NOW + 9_000);
  });

  it("produces a document that satisfies its own schema", () => {
    expect(sessionStateSchema.safeParse(endedSessionState(revealed, NOW + 9_000)).success).toBe(
      true
    );
  });

  /**
   * Carried, not reset. `applyHostAction` overwrites it with a freshly-read count on
   * the way out, so this constructor's job is only to not lose it — a zero here would
   * mean the closing snapshot told the room nobody had played.
   */
  it("carries the join count into the terminal document", () => {
    expect(endedSessionState(revealed, NOW + 9_000).playerCount).toBe(9);
  });

  it("can end a session that never left the lobby", () => {
    const lobby = initialSessionState(NOW);
    const ended = endedSessionState(lobby, NOW + 100);

    expect(ended.phase).toBe("ended");
    expect(sessionStateSchema.safeParse(ended).success).toBe(true);
  });
});

describe("the ended phase invariant", () => {
  const ended = {
    version: 8,
    phase: "ended" as const,
    currentQuestionId: null,
    startedAt: NOW,
    updatedAt: NOW + 9_000,
  };

  it("accepts an ended session with no open question", () => {
    expect(parseSessionState(ended).ok).toBe(true);
  });

  it("rejects an ended session that still carries a question", () => {
    // The rule is stated as two explicit phase sets. Written as "not lobby implies a
    // question", `ended` would have fallen through and demanded one.
    const result = parseSessionState({ ...ended, currentQuestionId: quiz.questions[0]!.id });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join(" ")).toContain("ended");
    }
  });

  it("still requires a question for the phases that have one", () => {
    expect(parseSessionState({ ...ended, phase: "question-open" }).ok).toBe(false);
    expect(parseSessionState({ ...ended, phase: "question-revealed" }).ok).toBe(false);
  });
});

describe("revealedOptionIds", () => {
  const open = {
    version: 3,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[1]!.id,
    startedAt: NOW,
    updatedAt: NOW + 1_000,
    playerCount: 5,
    revealedOptionIds: null,
  };

  /**
   * THE MID-DEPLOY TEST, again — the `playerCount` reasoning applies unchanged.
   *
   * A session running when S-03 ships holds a document written before this field
   * existed. Required, it would fail the next read and 409 the host's next action in
   * front of the room. The default is what makes the old shape parse, and this is the
   * test that stops it being tidied away.
   */
  it("defaults to null so a pre-deploy document still parses", () => {
    const { revealedOptionIds: _omitted, ...preDeploy } = open;

    const result = sessionStateSchema.safeParse(preDeploy);

    expect(result.success).toBe(true);
    expect(result.data?.revealedOptionIds).toBeNull();
  });

  it("accepts the correct ids in question-revealed", () => {
    const revealed = { ...open, phase: "question-revealed" as const, revealedOptionIds: ["a"] };

    expect(sessionStateSchema.safeParse(revealed).success).toBe(true);
  });

  it("accepts an empty array in question-revealed — nothing to highlight", () => {
    // What an unscored question and a non-choice question both produce. It must not
    // read as an error, because a warm-up is a normal beat.
    const revealed = { ...open, phase: "question-revealed" as const, revealedOptionIds: [] };

    expect(sessionStateSchema.safeParse(revealed).success).toBe(true);
  });

  /**
   * THE INVARIANT THAT KEEPS AN ANSWER FROM OUTLIVING ITS QUESTION.
   *
   * A non-null value in `question-open` is the previous question's answer key,
   * published to every phone in the room while that question is still being answered.
   * This is also the reason the field is set in `reveal.ts` and cleared everywhere
   * else, rather than injected in `applyHostAction` beside `playerCount`.
   */
  it.each(["lobby", "question-open", "ended"] as const)(
    "refuses a non-null value in %s",
    (phase) => {
      const questionless = phase === "lobby" || phase === "ended";
      const candidate = {
        ...open,
        phase,
        currentQuestionId: questionless ? null : open.currentQuestionId,
        revealedOptionIds: ["a"],
      };

      expect(sessionStateSchema.safeParse(candidate).success).toBe(false);
    }
  );

  it("is null on every constructor that is not a reveal", () => {
    expect(initialSessionState(NOW).revealedOptionIds).toBeNull();

    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedOptionIds: ["a", "b"],
    };
    // Cleared, not carried: the ending snapshot is about the session, not about
    // whichever question was on screen when the host closed it.
    expect(endedSessionState(revealed, NOW + 9_000).revealedOptionIds).toBeNull();
  });
});
