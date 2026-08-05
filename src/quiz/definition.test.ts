import { describe, expect, it } from "vitest";

import { quizDefinition } from "./definition";
import { getQuestionById, quiz } from "./index";
import { quizSchema } from "./schema";

/**
 * The test that turns an authoring mistake into a red test instead of a stage
 * incident. Everything here is about the real committed quiz — the schema's own
 * rules are proven against synthetic fixtures in `schema.test.ts`.
 */

describe("the committed quiz definition", () => {
  it("parses against the schema", () => {
    const result = quizSchema.safeParse(quizDefinition);
    if (!result.success) {
      throw new Error(
        "\n" + result.error.issues.map((issue) => `  - ${issue.message}`).join("\n")
      );
    }
    expect(result.success).toBe(true);
  });

  it("has the 14 drafted questions", () => {
    expect(quiz.questions).toHaveLength(14);
  });

  it("uses every question kind the drafted quiz calls for", () => {
    const kinds = new Set(quiz.questions.map((question) => question.kind));
    expect(kinds).toEqual(
      new Set(["word-cloud", "multiple-choice", "single-choice", "text", "number"])
    );
  });

  it("opens with the unscored word cloud", () => {
    const first = quiz.questions[0];
    expect(first?.kind).toBe("word-cloud");
    expect(first?.points).toBeNull();
  });

  it("keeps the gather question unscored", () => {
    const gather = getQuestionById("czy-wszyscy-gotowi");
    expect(gather?.points).toBeNull();
  });

  it("scores every other question", () => {
    const unscored = quiz.questions
      .filter((question) => question.points === null)
      .map((question) => question.id);
    expect(unscored).toEqual(["smieszne-slowo-ai", "czy-wszyscy-gotowi"]);
  });

  it("keeps the two numeric questions at the magnitudes FR-013 was written for", () => {
    const values = quiz.questions
      .filter((question) => question.kind === "number")
      .map((question) => question.correctValue);
    expect(values).toEqual([67, 10000]);
  });
});

describe("getQuestionById", () => {
  it("finds a question that exists", () => {
    expect(getQuestionById("llm-skrot")?.kind).toBe("single-choice");
  });

  // Untrusted input from an attendee's device must not throw into a request path.
  it("returns undefined for an unknown id rather than throwing", () => {
    expect(() => getQuestionById("nie-ma-takiego")).not.toThrow();
    expect(getQuestionById("nie-ma-takiego")).toBeUndefined();
  });

  it("returns undefined for an empty id", () => {
    expect(getQuestionById("")).toBeUndefined();
  });
});
