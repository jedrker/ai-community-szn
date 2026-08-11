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
      revealedDistribution: null,
      revealedAnswerText: null,
      standings: null,
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
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
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

/**
 * The standings phase keeps a question id (roadmap S-07).
 *
 * Its own block rather than a line in the block above, because the two phases are
 * opposites on exactly this point and the reason is worth stating where it fails: `ended`
 * must NOT carry a question, `standings` must. A standings phase that lost its id would
 * make `nextQuestionId(null)` return question 1, and advancing from the leaderboard would
 * reopen the quiz from the start — mid-segment, in front of the room, with the store and
 * the schema both satisfied.
 */
describe("the standings phase invariant", () => {
  const board = { rows: [{ rank: 1, displayName: "Ala", points: 30 }], playerCount: 4 };

  const standings = {
    version: 6,
    phase: "standings" as const,
    currentQuestionId: quiz.questions[0]!.id,
    startedAt: NOW,
    updatedAt: NOW + 7_000,
    playerCount: 4,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: board,
  };

  it("accepts a standings phase carrying the question just finished", () => {
    expect(parseSessionState(standings).ok).toBe(true);
  });

  /**
   * THE TEST THAT STOPS THE QUIZ REOPENING. If `standings` is ever added to
   * `QUESTIONLESS_PHASES`, this is the assertion that fails.
   */
  it("rejects a standings phase with no question — advance would reopen question 1", () => {
    const result = parseSessionState({ ...standings, currentQuestionId: null });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.join(" ")).toContain("standings");
    }
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
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
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

  it("is null on every constructor that is not a reveal (option ids)", () => {
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

/**
 * The distribution (roadmap S-04, FR-005).
 *
 * Deliberately a mirror of the `revealedOptionIds` block above rather than a merged
 * one: the two fields hold the same *shape* of invariant for different reasons, and a
 * shared block would let one of them lose its assertions to a refactor without the
 * failure naming which field stopped being protected.
 */
describe("revealedDistribution", () => {
  const open = {
    version: 3,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[1]!.id,
    startedAt: NOW,
    updatedAt: NOW + 1_000,
    playerCount: 5,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
  };

  const distribution = { answered: 9, options: { kino: 5, networking: 4 } };

  /**
   * THE MID-DEPLOY TEST, a third time. A session running when S-04 ships holds a
   * document written before this field existed; required, it would fail the next read
   * and 409 the host's next action on stage.
   */
  it("defaults to null so a pre-deploy document still parses", () => {
    const { revealedDistribution: _omitted, ...preDeploy } = open;

    const result = sessionStateSchema.safeParse(preDeploy);

    expect(result.success).toBe(true);
    expect(result.data?.revealedDistribution).toBeNull();
  });

  it("accepts a distribution in question-revealed", () => {
    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedDistribution: distribution,
    };

    expect(sessionStateSchema.safeParse(revealed).success).toBe(true);
  });

  it("accepts a distribution nobody answered, since zero is a fact about the room", () => {
    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedDistribution: { answered: 0, options: {} },
    };

    // The schema permits it; what refuses to *publish* it is `reveal.ts`, which sends
    // `null` on a failed read. The two are different questions and only one of them
    // belongs here.
    expect(sessionStateSchema.safeParse(revealed).success).toBe(true);
  });

  /**
   * THE INVARIANT FR-005 WAS REVISED TO CREATE.
   *
   * A non-null value in `question-open` is a live tally of what the room is choosing,
   * on the projector, while people are still answering — a cheat sheet for anyone who
   * glances up. This clause, not the comment on the field, is what makes "set only by
   * reveal.ts" true.
   */
  it.each(["lobby", "question-open", "ended"] as const)(
    "refuses a non-null value in %s",
    (phase) => {
      const questionless = phase === "lobby" || phase === "ended";
      const candidate = {
        ...open,
        phase,
        currentQuestionId: questionless ? null : open.currentQuestionId,
        revealedDistribution: distribution,
      };

      expect(sessionStateSchema.safeParse(candidate).success).toBe(false);
    }
  );

  it("names itself when it is the field at fault", () => {
    const candidate = { ...open, revealedDistribution: distribution };

    const result = sessionStateSchema.safeParse(candidate);

    // Its own superRefine clause rather than one shared with `revealedOptionIds`, so a
    // host reading the 409 learns which field broke.
    expect(result.error?.issues.some((issue) => issue.path[0] === "revealedDistribution")).toBe(
      true
    );
  });

  it("is null on every constructor that is not a reveal", () => {
    expect(initialSessionState(NOW).revealedDistribution).toBeNull();

    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedDistribution: distribution,
    };
    // Cleared, not carried — the closing screen showing the last question's bars would
    // make the segment look like it ended mid-question.
    expect(endedSessionState(revealed, NOW + 9_000).revealedDistribution).toBeNull();
  });
});

/**
 * The free-text answer (roadmap S-05, FR-016).
 *
 * A third mirror of the `revealedOptionIds` block, kept separate for the reason the
 * distribution block above states: same shape of invariant, different reasons, and a
 * merged block would let one field lose its assertions without the failure naming it.
 */
describe("revealedAnswerText", () => {
  const open = {
    version: 3,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[1]!.id,
    startedAt: NOW,
    updatedAt: NOW + 1_000,
    playerCount: 5,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
  };

  const accepted = "halucynacje";

  /** THE MID-DEPLOY TEST, a fourth time. Same reasoning as its three siblings. */
  it("defaults to null so a pre-deploy document still parses", () => {
    const { revealedAnswerText: _omitted, ...preDeploy } = open;

    const result = sessionStateSchema.safeParse(preDeploy);

    expect(result.success).toBe(true);
    expect(result.data?.revealedAnswerText).toBeNull();
  });

  it("accepts an accepted answer in question-revealed", () => {
    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedAnswerText: accepted,
    };

    expect(sessionStateSchema.safeParse(revealed).success).toBe(true);
  });

  /**
   * THE INVARIANT. A non-null value outside the reveal is the accepted answer to a
   * question the room is still typing into — the free-text equivalent of publishing
   * the answer key early, and it would look entirely correct on screen.
   */
  it.each(["lobby", "question-open", "ended"] as const)(
    "refuses a non-null value in %s",
    (phase) => {
      const questionless = phase === "lobby" || phase === "ended";
      const candidate = {
        ...open,
        phase,
        currentQuestionId: questionless ? null : open.currentQuestionId,
        revealedAnswerText: accepted,
      };

      expect(sessionStateSchema.safeParse(candidate).success).toBe(false);
    }
  );

  it("names itself when it is the field at fault", () => {
    const candidate = { ...open, revealedAnswerText: accepted };

    const result = sessionStateSchema.safeParse(candidate);

    expect(result.error?.issues.some((issue) => issue.path[0] === "revealedAnswerText")).toBe(
      true
    );
  });

  it("is null on every constructor that is not a reveal", () => {
    expect(initialSessionState(NOW).revealedAnswerText).toBeNull();

    const revealed = {
      ...open,
      phase: "question-revealed" as const,
      revealedAnswerText: accepted,
    };
    expect(endedSessionState(revealed, NOW + 9_000).revealedAnswerText).toBeNull();
  });
});

/**
 * The leaderboard (roadmap S-07, FR-014).
 *
 * A fifth mirror of the `revealedOptionIds` block, kept separate for the reason its
 * siblings state — and with one assertion they do not have: this field is *required* in
 * its own phase. For them a null payload is a reveal missing a decoration; here it is a
 * blank projector.
 */
describe("standings", () => {
  const open = {
    version: 3,
    phase: "question-open" as const,
    currentQuestionId: quiz.questions[1]!.id,
    startedAt: NOW,
    updatedAt: NOW + 1_000,
    playerCount: 5,
    revealedOptionIds: null,
    revealedDistribution: null,
    revealedAnswerText: null,
    standings: null,
  };

  const board = {
    rows: [
      { rank: 1, displayName: "Ala", points: 30 },
      { rank: 2, displayName: "Bartek", points: 20 },
    ],
    playerCount: 5,
  };

  /** THE MID-DEPLOY TEST, a fifth time. Same reasoning as its four siblings. */
  it("defaults to null so a pre-deploy document still parses", () => {
    const { standings: _omitted, ...preDeploy } = open;

    const result = sessionStateSchema.safeParse(preDeploy);

    expect(result.success).toBe(true);
    expect(result.data?.standings).toBeNull();
  });

  it("accepts a board in the standings phase", () => {
    const candidate = { ...open, phase: "standings" as const, standings: board };

    expect(sessionStateSchema.safeParse(candidate).success).toBe(true);
  });

  /**
   * THE INVARIANT. A board outside its own phase is the previous beat's leaderboard on
   * 150 phones underneath the question they are being asked to answer.
   */
  it.each(["lobby", "question-open", "question-revealed", "ended"] as const)(
    "refuses a board in %s",
    (phase) => {
      const questionless = phase === "lobby" || phase === "ended";
      const candidate = {
        ...open,
        phase,
        currentQuestionId: questionless ? null : open.currentQuestionId,
        standings: board,
      };

      expect(sessionStateSchema.safeParse(candidate).success).toBe(false);
    }
  );

  /**
   * The half the three reveal fields do not have. The route refuses to transition when
   * the store cannot answer; this clause is what makes that refusal structural rather
   * than one handler's habit.
   */
  it("refuses the standings phase with no board — the board IS the phase", () => {
    const candidate = { ...open, phase: "standings" as const, standings: null };

    const result = sessionStateSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === "standings")).toBe(true);
  });

  it("names itself when it is the field at fault", () => {
    const candidate = { ...open, standings: board };

    const result = sessionStateSchema.safeParse(candidate);

    expect(result.error?.issues.some((issue) => issue.path[0] === "standings")).toBe(true);
  });

  /**
   * The reveal fields are refused in the new phase too — and the fixture carries a valid
   * board so the ONLY thing wrong with each candidate is the reveal field under test. A
   * candidate with a null board would be rejected by the clause above whether or not the
   * reveal clauses fired, and would pass against a schema that had stopped protecting
   * them (`lessons.md`, "Prove the fixture reaches the branch the test names").
   */
  it.each([
    ["revealedOptionIds", { revealedOptionIds: ["a"] }],
    ["revealedDistribution", { revealedDistribution: { answered: 3, options: { a: 3 } } }],
    ["revealedAnswerText", { revealedAnswerText: "halucynacje" }],
  ] as const)("still refuses %s in the standings phase", (field, overlay) => {
    const candidate = {
      ...open,
      phase: "standings" as const,
      standings: board,
      ...overlay,
    };

    const result = sessionStateSchema.safeParse(candidate);

    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it("is null on every constructor that is not the standings route", () => {
    expect(initialSessionState(NOW).standings).toBeNull();

    const showing = { ...open, phase: "standings" as const, standings: board };
    // Cleared, not carried. S-10 owns what the closing screen shows; until then, ending
    // from a leaderboard beat should not freeze the room on it.
    expect(endedSessionState(showing, NOW + 9_000).standings).toBeNull();
  });
});
