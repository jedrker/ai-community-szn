import { describe, expect, it } from "vitest";

import { answerField, answerRecordSchema, parseAnswerRecord } from "./answers";
import { MAX_TEXT_ANSWER_LENGTH } from "./scoring";
import { MAX_WORD_LENGTH } from "./words";

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

describe("the typed-answer field (roadmap S-05)", () => {
  it("accepts a record carrying typed text and no selection", () => {
    const parsed = answerRecordSchema.safeParse({
      ...valid,
      optionIds: [],
      text: "halucynacje",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.text).toBe("halucynacje");
  });

  /**
   * **The mid-session deploy case.** `valid` is the pre-S-05 shape — it has no `text`
   * — so this proves the field defaults rather than failing the parse. Required, a
   * record written before the deploy would come back `null` from `parseAnswerRecord`
   * and the result route would tell a device it never answered.
   */
  it("defaults to null for a record written before the field existed", () => {
    expect("text" in valid).toBe(false);

    const parsed = answerRecordSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.text).toBeNull();
  });

  it("refuses text longer than the bound the route enforces", () => {
    // The backstop to the route's visible refusal — the last point at which a record
    // that breaks its own shape can be stopped from being stored.
    const tooLong = "a".repeat(MAX_TEXT_ANSWER_LENGTH + 1);

    expect(answerRecordSchema.safeParse({ ...valid, text: tooLong }).success).toBe(false);
  });

  it("accepts text exactly at the bound", () => {
    const atBound = "a".repeat(MAX_TEXT_ANSWER_LENGTH);

    expect(answerRecordSchema.safeParse({ ...valid, text: atBound }).success).toBe(true);
  });

  it("refuses a non-string, non-null text", () => {
    expect(answerRecordSchema.safeParse({ ...valid, text: 42 }).success).toBe(false);
  });
});

describe("the numeric-guess field (roadmap S-06)", () => {
  it("accepts a record carrying a guess and no selection or text", () => {
    const parsed = answerRecordSchema.safeParse({
      ...valid,
      optionIds: [],
      text: null,
      value: 67.5,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.value).toBe(67.5);
  });

  /** The same mid-session-deploy case `text` documents; `valid` predates both fields. */
  it("defaults to null for a record written before the field existed", () => {
    expect("value" in valid).toBe(false);

    const parsed = answerRecordSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.value).toBeNull();
  });

  it.each([
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["NaN", Number.NaN],
  ])("refuses a non-finite value (%s)", (_label, value) => {
    // `Infinity` serialises to `null` through JSON, so a record holding one would
    // round-trip into a record that parses and has lost its answer.
    expect(answerRecordSchema.safeParse({ ...valid, value }).success).toBe(false);
  });

  it("accepts a negative guess — wrong is not malformed", () => {
    expect(answerRecordSchema.safeParse({ ...valid, value: -12 }).success).toBe(true);
  });

  it("refuses a non-number, non-null value", () => {
    expect(answerRecordSchema.safeParse({ ...valid, value: "67" }).success).toBe(false);
  });
});

describe("the word field (roadmap S-08)", () => {
  it("accepts a record carrying a word and no selection, text or guess", () => {
    const parsed = answerRecordSchema.safeParse({
      ...valid,
      optionIds: [],
      // Both are populated for this kind: the typed form on `text`, the counted form
      // here. They differ by case alone.
      text: "Halucynacja",
      word: "halucynacja",
      value: null,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.word).toBe("halucynacja");
  });

  /** The same mid-session-deploy case `text` and `value` document; `valid` predates all three. */
  it("defaults to null for a record written before the field existed", () => {
    expect("word" in valid).toBe(false);

    const parsed = answerRecordSchema.safeParse(valid);

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.word).toBeNull();
  });

  it("refuses a word longer than the bound the route enforces", () => {
    const tooLong = "a".repeat(MAX_WORD_LENGTH + 1);

    expect(answerRecordSchema.safeParse({ ...valid, word: tooLong }).success).toBe(false);
  });

  it("accepts a word exactly at the bound", () => {
    const atBound = "a".repeat(MAX_WORD_LENGTH);

    // `text` must match, or the fold invariant below refuses it for a different reason — which
    // would leave this test passing for the wrong one.
    expect(
      answerRecordSchema.safeParse({ ...valid, text: atBound, word: atBound }).success
    ).toBe(true);
  });

  it("refuses a non-string, non-null word", () => {
    expect(answerRecordSchema.safeParse({ ...valid, word: 42 }).success).toBe(false);
  });

  it("bounds a word more tightly than free text, because it goes on a projector", () => {
    // The two bounds are different numbers for different reasons — 80 is a sentence, 24
    // is a projected line. A word at 25 characters must be refused even though a text
    // answer at 25 is fine.
    expect(MAX_WORD_LENGTH).toBeLessThan(MAX_TEXT_ANSWER_LENGTH);
    const between = "a".repeat(MAX_WORD_LENGTH + 1);
    expect(answerRecordSchema.safeParse({ ...valid, text: between }).success).toBe(true);
    expect(
      answerRecordSchema.safeParse({ ...valid, text: between, word: between }).success
    ).toBe(false);
  });

  /**
   * THE FOLD INVARIANT (impl review F7).
   *
   * `word` and `text` are stored separately and only this clause stops them drifting. The
   * consequence of a drift lands on a projector: the chip is keyed by `word` while the
   * attendee's phone echoes `text`, so a mismatch shows the room one word and its author
   * another.
   */
  describe("word must be the fold of text", () => {
    it("accepts a record whose word is the fold of its text", () => {
      expect(
        answerRecordSchema.safeParse({ ...valid, text: "Żółw", word: "żółw" }).success
      ).toBe(true);
    });

    it("refuses a word that is not the fold of the stored text", () => {
      expect(
        answerRecordSchema.safeParse({ ...valid, text: "kawa", word: "herbata" }).success
      ).toBe(false);
    });

    it("refuses an unfolded word — the case the single current writer cannot produce", () => {
      // `validateWord` folds before storing, so this is what a *second* writer would get wrong.
      expect(
        answerRecordSchema.safeParse({ ...valid, text: "KAWA", word: "KAWA" }).success
      ).toBe(false);
    });

    it("refuses a word with no text beside it", () => {
      expect(answerRecordSchema.safeParse({ ...valid, text: null, word: "kawa" }).success).toBe(
        false
      );
    });

    it("still allows a record carrying neither, which every other kind is", () => {
      expect(answerRecordSchema.safeParse({ ...valid, text: null, word: null }).success).toBe(
        true
      );
    });

    it("still allows text with no word — the free-text kind", () => {
      expect(
        answerRecordSchema.safeParse({ ...valid, text: "halucynacje", word: null }).success
      ).toBe(true);
    });

    it("names the field in its message, so a failure points at the right one", () => {
      const parsed = answerRecordSchema.safeParse({ ...valid, text: "kawa", word: "herbata" });

      expect(parsed.success).toBe(false);
      expect(parsed.success === false && parsed.error.issues[0]?.path).toEqual(["word"]);
    });
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
