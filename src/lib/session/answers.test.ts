import { describe, expect, it } from "vitest";

import { answerField, answerRecordSchema, parseAnswerRecord } from "./answers";

/**
 * The shape the answers hash holds, and the field name both paths must agree on
 * (roadmap S-03). Mirrors `players.test.ts`.
 */

const valid = {
  playerId: "3f1c0f1e-6a4f-4f3a-9c2b-9d8e7a6b5c4d",
  questionId: "llm-skrot",
  optionIds: ["large-language-model"],
  elapsedMs: 4321,
  correct: true,
  awarded: 892,
  answeredAt: 1_754_600_000_000,
};

describe("the answer field name", () => {
  it("joins question id and player id with a colon", () => {
    expect(answerField("llm-skrot", "abc")).toBe("llm-skrot:abc");
  });

  it("round-trips: the same inputs always produce the same field", () => {
    // The read path and the write path both call this. A disagreement about the
    // separator would present as "answered, but the reveal says they did not".
    expect(answerField(valid.questionId, valid.playerId)).toBe(
      answerField(valid.questionId, valid.playerId)
    );
  });

  it("distinguishes two players on the same question", () => {
    expect(answerField("q", "a")).not.toBe(answerField("q", "b"));
  });

  it("distinguishes two questions for the same player", () => {
    expect(answerField("q1", "a")).not.toBe(answerField("q2", "a"));
  });

  it("cannot collide, because neither id can contain the separator", () => {
    // Question ids are lowercase slugs (`src/quiz/schema.ts`) and player ids are v4
    // UUIDs, so the colon count is always exactly one.
    const field = answerField("summer-tour-zakonczenie", valid.playerId);
    expect(field.split(":")).toHaveLength(2);
  });
});

describe("the answer record schema", () => {
  it("accepts a well-formed record", () => {
    expect(answerRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("carries no display name", () => {
    // The players hash owns the id -> name mapping. A second copy is a second thing
    // the purge has to reach, and it would be the copy nobody remembers.
    expect(Object.keys(answerRecordSchema.shape)).not.toContain("displayName");
  });

  it("accepts an empty selection — a submitted non-answer is still an answer", () => {
    expect(answerRecordSchema.safeParse({ ...valid, optionIds: [] }).success).toBe(true);
  });

  it("accepts a zero award on a wrong or unscored answer", () => {
    expect(
      answerRecordSchema.safeParse({ ...valid, correct: false, awarded: 0 }).success
    ).toBe(true);
  });

  it("refuses a negative award", () => {
    expect(answerRecordSchema.safeParse({ ...valid, awarded: -1 }).success).toBe(false);
  });

  it("refuses a negative elapsed time", () => {
    expect(answerRecordSchema.safeParse({ ...valid, elapsedMs: -1 }).success).toBe(false);
  });
});

describe("parseAnswerRecord never throws", () => {
  it("returns the record for valid input", () => {
    expect(parseAnswerRecord(valid)?.awarded).toBe(valid.awarded);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not a record"],
    ["a number", 42],
    ["an empty object", {}],
    ["a record missing awarded", { ...valid, awarded: undefined }],
    ["a record with a wrong-typed field", { ...valid, correct: "yes" }],
  ])("returns null for %s", (_label, raw) => {
    expect(parseAnswerRecord(raw)).toBeNull();
  });
});
