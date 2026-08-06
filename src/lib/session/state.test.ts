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
    });
  });

  it("produces a document that satisfies its own schema", () => {
    expect(sessionStateSchema.safeParse(initialSessionState(NOW)).success).toBe(true);
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
