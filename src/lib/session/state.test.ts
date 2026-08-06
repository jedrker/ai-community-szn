import { describe, expect, it } from "vitest";

import { quiz } from "../../quiz/index";
import {
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
