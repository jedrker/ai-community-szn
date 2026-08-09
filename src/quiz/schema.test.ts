import { describe, expect, it } from "vitest";

import { quizSchema } from "./schema";

/**
 * Synthetic fixtures only — the real quiz is Phase 2's concern. Keeping them
 * apart means a failure in the definition test is unambiguously a content
 * problem, not a schema problem.
 */

const singleChoice = {
  kind: "single-choice",
  id: "llm-skrot",
  prompt: "Co oznacza skrót LLM?",
  points: 1000,
  options: [
    { id: "a", text: "Large Language Model" },
    { id: "b", text: "Linear Logic Machine" },
  ],
  correctOptionIds: ["a"],
};

const multipleChoice = {
  kind: "multiple-choice",
  id: "summer-tour-final",
  prompt: "Czym kończy się dzisiejszy Summer Tour?",
  points: 1000,
  options: [
    { id: "kino", text: "Kinem plenerowym" },
    { id: "networking", text: "Networkingiem" },
    { id: "wyklad", text: "Wykładem" },
  ],
  correctOptionIds: ["kino", "networking"],
};

const text = {
  kind: "text",
  id: "halucynacje",
  prompt: "Jak nazywa się zjawisko, gdy AI zmyśla fakty?",
  points: 1000,
  acceptedAnswers: ["halucynacje", "hallucinations"],
};

const number = {
  kind: "number",
  id: "lyro-procent",
  prompt: "Ile procent rozmów automatyzuje Lyro AI?",
  points: 1000,
  correctValue: 67,
};

const wordCloud = {
  kind: "word-cloud",
  id: "smieszne-slowo",
  prompt: "Napisz śmieszne słowo związane z AI",
  points: null,
};

const quizOf = (...questions: unknown[]) => ({ questions });

/** Returns the joined issue messages of a failed parse. */
function rejectionMessage(input: unknown): string {
  const result = quizSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error("unreachable");
  return result.error.issues.map((issue) => issue.message).join(" | ");
}

describe("accepts a valid question of every kind", () => {
  it.each([
    ["single-choice", singleChoice],
    ["multiple-choice", multipleChoice],
    ["text", text],
    ["number", number],
    ["word-cloud", wordCloud],
  ])("accepts %s", (_kind, question) => {
    expect(quizSchema.safeParse(quizOf(question)).success).toBe(true);
  });

  it("accepts a whole quiz of mixed kinds", () => {
    const result = quizSchema.safeParse(
      quizOf(singleChoice, multipleChoice, text, number, wordCloud)
    );
    expect(result.success).toBe(true);
  });

  it("accepts an unscored choice question with no correct options (the gather question)", () => {
    const gather = {
      ...multipleChoice,
      id: "czy-gotowi",
      points: null,
      correctOptionIds: [],
    };
    expect(quizSchema.safeParse(quizOf(gather)).success).toBe(true);
  });
});

describe("rejects a violation of every domain invariant", () => {
  it("rejects duplicate question ids", () => {
    const message = rejectionMessage(quizOf(singleChoice, { ...text, id: singleChoice.id }));
    expect(message).toContain("llm-skrot");
    expect(message).toContain("Zduplikowane id pytań");
  });

  it("rejects duplicate option ids within a question", () => {
    const message = rejectionMessage(
      quizOf({
        ...singleChoice,
        options: [
          { id: "a", text: "Large Language Model" },
          { id: "a", text: "Linear Logic Machine" },
        ],
      })
    );
    expect(message).toContain("llm-skrot");
    expect(message).toContain("zduplikowane id odpowiedzi");
  });

  it("rejects a choice question with fewer than two options", () => {
    const message = rejectionMessage(
      quizOf({ ...singleChoice, options: [{ id: "a", text: "Large Language Model" }] })
    );
    expect(message).toContain("llm-skrot");
    expect(message).toContain("co najmniej 2 odpowiedzi");
  });

  it("rejects correctOptionIds pointing at an option that does not exist", () => {
    const message = rejectionMessage(quizOf({ ...singleChoice, correctOptionIds: ["nope"] }));
    expect(message).toContain("llm-skrot");
    expect(message).toContain("nieistniejące odpowiedzi");
  });

  it("rejects a scored single-choice question with two correct options", () => {
    const message = rejectionMessage(quizOf({ ...singleChoice, correctOptionIds: ["a", "b"] }));
    expect(message).toContain("llm-skrot");
    expect(message).toContain("dokładnie 1 poprawną odpowiedź");
  });

  it("rejects a scored single-choice question with no correct option", () => {
    const message = rejectionMessage(quizOf({ ...singleChoice, correctOptionIds: [] }));
    expect(message).toContain("dokładnie 1 poprawną odpowiedź");
  });

  it("rejects a scored multiple-choice question with no correct option", () => {
    const message = rejectionMessage(quizOf({ ...multipleChoice, correctOptionIds: [] }));
    expect(message).toContain("summer-tour-final");
    expect(message).toContain("co najmniej 1 poprawną odpowiedź");
  });

  it("rejects a text question with no accepted answers", () => {
    const message = rejectionMessage(quizOf({ ...text, acceptedAnswers: [] }));
    expect(message).toContain("halucynacje");
    expect(message).toContain("co najmniej 1 akceptowaną odpowiedź");
  });

  it("rejects accepted answers that collapse to the same value under folding", () => {
    const message = rejectionMessage(
      quizOf({ ...text, acceptedAnswers: ["halucynacje", "  HALUCYNACJE "] })
    );
    expect(message).toContain("halucynacje");
    expect(message).toContain("sprowadzają się do tej samej wartości");
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("rejects a non-finite correctValue (%s), naming the question", (_label, value) => {
    const message = rejectionMessage(quizOf({ ...number, correctValue: value }));
    expect(message).toContain("lyro-procent");
    expect(message).toContain("skończoną liczbą");
  });

  it("rejects a correctValue of zero, naming the question", () => {
    // Zero is finite, so the sibling refinement above does not catch it — and a
    // relative-error rule divides by it. This is the gate that stops such a question
    // from deploying at all.
    const message = rejectionMessage(quizOf({ ...number, correctValue: 0 }));
    expect(message).toContain("lyro-procent");
    expect(message).toContain("nie może wynosić 0");
  });

  it("rejects a correctValue that is not a number at all", () => {
    expect(quizSchema.safeParse(quizOf({ ...number, correctValue: "67" })).success).toBe(false);
  });

  it("rejects a scored word-cloud question", () => {
    const message = rejectionMessage(quizOf({ ...wordCloud, points: 1000 }));
    expect(message).toContain("smieszne-slowo");
    expect(message).toContain("niepunktowane");
  });

  it("rejects an empty quiz", () => {
    expect(rejectionMessage(quizOf())).toContain("co najmniej 1 pytanie");
  });

  it("rejects a question id that is not a slug", () => {
    expect(quizSchema.safeParse(quizOf({ ...singleChoice, id: "LLM Skrót" })).success).toBe(false);
  });

  it("rejects an unknown question kind", () => {
    expect(quizSchema.safeParse(quizOf({ ...singleChoice, kind: "ranking" })).success).toBe(false);
  });

  it("rejects zero or negative points", () => {
    expect(quizSchema.safeParse(quizOf({ ...singleChoice, points: 0 })).success).toBe(false);
    expect(quizSchema.safeParse(quizOf({ ...singleChoice, points: -100 })).success).toBe(false);
  });
});

describe("rejection messages are actionable", () => {
  it("names the offending question rather than only a Zod path", () => {
    const message = rejectionMessage(quizOf(singleChoice, { ...wordCloud, points: 500 }));
    expect(message).toMatch(/Pytanie "smieszne-slowo"/);
  });
});
