import { describe, expect, it } from "vitest";

import { quiz } from "../../quiz/index";
import {
  clampElapsed,
  MAX_TEXT_ANSWER_LENGTH,
  scoreChoiceAnswer,
  scoreTextAnswer,
  speedWeight,
  SPEED_WINDOW_MS,
  type ChoiceQuestion,
} from "./scoring";
import type { TextQuestion } from "../../quiz/index";

/**
 * The first domain rule this project has (roadmap S-03, FR-010 and FR-019).
 *
 * Fixtures rather than the real quiz for the correctness cases, because the property
 * under test is the rule, not the drafted question set — but the two real questions
 * that anchor it (the scored multi-answer one and the unscored gather beat) are
 * pulled from the definition, so a change to either fails here rather than at the
 * event.
 */

const scoredMulti: ChoiceQuestion = {
  kind: "multiple-choice",
  id: "fixture-multi",
  prompt: "?",
  points: 1000,
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
    { id: "c", text: "C" },
  ],
  correctOptionIds: ["a", "b"],
};

const scoredSingle: ChoiceQuestion = {
  kind: "single-choice",
  id: "fixture-single",
  prompt: "?",
  points: 1000,
  options: [
    { id: "a", text: "A" },
    { id: "b", text: "B" },
  ],
  correctOptionIds: ["a"],
};

const unscored: ChoiceQuestion = {
  ...scoredMulti,
  id: "fixture-unscored",
  points: null,
  correctOptionIds: [],
};

const scoredText: TextQuestion = {
  kind: "text",
  id: "fixture-text",
  prompt: "?",
  points: 1000,
  acceptedAnswers: ["halucynacje", "hallucinations"],
};

const unscoredText: TextQuestion = {
  ...scoredText,
  id: "fixture-text-unscored",
  points: null,
};

describe("choice correctness is all-or-nothing (FR-010)", () => {
  it("scores an exact multi-answer match", () => {
    const result = scoreChoiceAnswer(scoredMulti, ["a", "b"], 0);

    expect(result.correct).toBe(true);
    expect(result.awarded).toBe(1000);
  });

  it("scores an exact match regardless of selection order", () => {
    // The options are shuffled per device (`public.ts`), so the order ids arrive in
    // is whatever the attendee tapped.
    expect(scoreChoiceAnswer(scoredMulti, ["b", "a"], 0).correct).toBe(true);
  });

  it("refuses a superset", () => {
    // The one that matters: without it, selecting every option wins every
    // multiple-choice question in the segment.
    const result = scoreChoiceAnswer(scoredMulti, ["a", "b", "c"], 0);

    expect(result.correct).toBe(false);
    expect(result.awarded).toBe(0);
  });

  it("refuses a subset", () => {
    expect(scoreChoiceAnswer(scoredMulti, ["a"], 0)).toEqual({ correct: false, awarded: 0 });
  });

  it("refuses an empty selection", () => {
    expect(scoreChoiceAnswer(scoredMulti, [], 0).correct).toBe(false);
  });

  it("refuses a same-sized wrong selection", () => {
    // Guards against a cardinality-only check passing for the wrong reason.
    expect(scoreChoiceAnswer(scoredMulti, ["a", "c"], 0).correct).toBe(false);
  });

  it("ignores a duplicated id rather than counting it twice", () => {
    expect(scoreChoiceAnswer(scoredSingle, ["a", "a"], 0).correct).toBe(true);
  });
});

describe("an unscored question awards nothing and claims nothing (FR-017)", () => {
  it("returns correct: false and awarded: 0", () => {
    // Not `correct: true` — there is no correct answer to match, and the reveal copy
    // would have to work around the lie. The view branches on `question.scored`.
    expect(scoreChoiceAnswer(unscored, ["a", "b"], 0)).toEqual({ correct: false, awarded: 0 });
  });

  it("holds for the real gather question, which is the one this protects", () => {
    const gather = quiz.questions.find((question) => question.id === "czy-wszyscy-gotowi");
    if (gather?.kind !== "multiple-choice") throw new Error("expected the gather question");

    expect(gather.points).toBeNull();
    expect(scoreChoiceAnswer(gather, ["gotowy"], 0).awarded).toBe(0);
  });
});

describe("free-text correctness folds case, spacing, diacritics and punctuation (FR-011)", () => {
  it("matches an exact accepted variant", () => {
    expect(scoreTextAnswer(scoredText, "halucynacje", 0)).toEqual({
      correct: true,
      awarded: 1000,
    });
  });

  it("matches any variant, not just the first", () => {
    expect(scoreTextAnswer(scoredText, "hallucinations", 0).correct).toBe(true);
  });

  it.each([
    ["case", "HALUCYNACJE"],
    ["surrounding whitespace", "  halucynacje  "],
    ["a trailing full stop", "halucynacje."],
    ["repeated terminators", "halucynacje?!"],
    ["everything at once", "  Halucynacje...  "],
  ])("folds %s", (_dimension, input) => {
    expect(scoreTextAnswer(scoredText, input, 0).correct).toBe(true);
  });

  it("collapses repeated internal whitespace", () => {
    const phrase: TextQuestion = { ...scoredText, acceptedAnswers: ["large language model"] };

    expect(scoreTextAnswer(phrase, "large   language\tmodel", 0).correct).toBe(true);
  });

  it("folds diacritics — including the stroked ł a bare NFD pass misses", () => {
    const diacritics: TextQuestion = { ...scoredText, acceptedAnswers: ["żółć łódź"] };

    expect(scoreTextAnswer(diacritics, "ZOLC LODZ", 0).correct).toBe(true);
  });

  it("does not tolerate a misspelling", () => {
    // The scoping line: fuzzy matching is a threshold the host would have to defend
    // out loud, so it is out of scope by decision.
    expect(scoreTextAnswer(scoredText, "halucynajce", 0)).toEqual({
      correct: false,
      awarded: 0,
    });
  });

  it("scores an empty or whitespace-only answer as wrong, never as a match", () => {
    for (const input of ["", "   ", "..."]) {
      expect(scoreTextAnswer(scoredText, input, 0)).toEqual({ correct: false, awarded: 0 });
    }
  });

  it("returns correct: false and awarded: 0 for an unscored question", () => {
    // Same rule as the choice path: no correct answer to match, so no fabricated
    // `correct: true` for the reveal copy to work around.
    expect(scoreTextAnswer(unscoredText, "halucynacje", 0)).toEqual({
      correct: false,
      awarded: 0,
    });
  });

  it("holds for the real text question, which is the one this ships", () => {
    const real = quiz.questions.find((question) => question.id === "zmyslanie-faktow");
    if (real?.kind !== "text") throw new Error("expected the text question");

    for (const variant of real.acceptedAnswers) {
      expect(scoreTextAnswer(real, variant, 0).correct).toBe(true);
    }
    // The case the manual run types on a phone.
    expect(scoreTextAnswer(real, "Halucynacje.", 0).correct).toBe(true);
  });
});

describe("the speed curve is shared, not reimplemented per kind (FR-019)", () => {
  it("awards a correct text answer exactly what a correct choice answer gets", () => {
    // **The assertion that fails if the curve is copied rather than reused.** Both
    // questions carry 1000 points, so at equal elapsed the awards must be identical.
    for (const elapsed of [0, 3_333, SPEED_WINDOW_MS / 2, SPEED_WINDOW_MS, SPEED_WINDOW_MS * 3]) {
      const text = scoreTextAnswer(scoredText, "halucynacje", elapsed).awarded;
      const choice = scoreChoiceAnswer(scoredSingle, ["a"], elapsed).awarded;

      expect(text).toBe(choice);
    }
  });

  it("gives the faster of two correct text answers strictly more", () => {
    const fast = scoreTextAnswer(scoredText, "halucynacje", 2_000).awarded;
    const slow = scoreTextAnswer(scoredText, "halucynacje", 12_000).awarded;

    expect(fast).toBeGreaterThan(slow);
  });
});

describe("the text answer bound", () => {
  it("is long enough for every accepted variant in the drafted quiz", () => {
    // The bound is enforced in three places (schema, route, input `maxlength`). This
    // asserts the value itself is not set below something the quiz already needs.
    for (const question of quiz.questions) {
      if (question.kind !== "text") continue;
      for (const variant of question.acceptedAnswers) {
        expect(variant.length).toBeLessThanOrEqual(MAX_TEXT_ANSWER_LENGTH);
      }
    }
  });
});

describe("the speed weight (FR-019)", () => {
  it("is 1.0 at zero elapsed", () => {
    expect(speedWeight(0)).toBe(1);
  });

  it("is 0.5 at the window and beyond it", () => {
    expect(speedWeight(SPEED_WINDOW_MS)).toBe(0.5);
    expect(speedWeight(SPEED_WINDOW_MS * 10)).toBe(0.5);
  });

  it("is 0.75 at half the window", () => {
    expect(speedWeight(SPEED_WINDOW_MS / 2)).toBe(0.75);
  });

  it("decreases monotonically across the window", () => {
    let previous = Infinity;
    for (let elapsed = 0; elapsed <= SPEED_WINDOW_MS; elapsed += SPEED_WINDOW_MS / 20) {
      const weight = speedWeight(elapsed);
      expect(weight).toBeLessThanOrEqual(previous);
      previous = weight;
    }
  });

  it("never leaves [0.5, 1] for any input, including nonsense", () => {
    for (const elapsed of [-1e9, -1, 0, 1, 1e9, Number.NaN, Number.POSITIVE_INFINITY]) {
      const weight = speedWeight(elapsed);
      expect(weight).toBeGreaterThanOrEqual(0.5);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it("falls back to the floor rather than poisoning the award on a bad number", () => {
    // A NaN from a failed parse must not propagate into `Math.round(1000 * NaN)`.
    expect(speedWeight(Number.NaN)).toBe(0.5);
  });
});

describe("awards are integers in the 500–1000 band", () => {
  it("rounds to whole points", () => {
    const result = scoreChoiceAnswer(scoredSingle, ["a"], 7333);

    expect(Number.isInteger(result.awarded)).toBe(true);
  });

  it("stays within the band for every plausible elapsed", () => {
    for (const elapsed of [0, 1, 5000, SPEED_WINDOW_MS, SPEED_WINDOW_MS * 3]) {
      const { awarded } = scoreChoiceAnswer(scoredSingle, ["a"], elapsed);
      expect(awarded).toBeGreaterThanOrEqual(500);
      expect(awarded).toBeLessThanOrEqual(1000);
    }
  });

  it("gives the faster of two correct answers strictly more", () => {
    // The property the whole speed component exists for — and the one the two-device
    // manual run checks against reality.
    const fast = scoreChoiceAnswer(scoredSingle, ["a"], 2_000).awarded;
    const slow = scoreChoiceAnswer(scoredSingle, ["a"], 12_000).awarded;

    expect(fast).toBeGreaterThan(slow);
  });
});

describe("clampElapsed bounds what a device claims", () => {
  it("trusts a plausible value", () => {
    expect(clampElapsed(4_000, 9_000)).toBe(4_000);
  });

  it("caps a value longer than the question has been open", () => {
    expect(clampElapsed(60_000, 9_000)).toBe(9_000);
  });

  it("floors a negative claim at zero", () => {
    expect(clampElapsed(-5_000, 9_000)).toBe(0);
  });

  it("treats a non-finite claim as the slowest answer, not the fastest", () => {
    // Garbage must not be rewarded: there is no reading of a missing or unparseable
    // timestamp that means "answered instantly".
    expect(clampElapsed(Number.NaN, 9_000)).toBe(9_000);
    expect(clampElapsed(Number.POSITIVE_INFINITY, 9_000)).toBe(9_000);
  });

  /**
   * Both nonsense-input branches must fail in the SAME direction — toward the floor.
   *
   * This returned `0` at first, and `speedWeight(0)` is 1.0, so a negative server window
   * (clock skew between the instance that handled the advance and the one handling the
   * answer) handed out a full award. The sibling branch for a garbage *client* value
   * already failed to the floor; the two disagreed.
   */
  it("falls back to the floor when the server's own elapsed is nonsense", () => {
    expect(clampElapsed(4_000, -1)).toBe(SPEED_WINDOW_MS);
    expect(clampElapsed(4_000, Number.NaN)).toBe(SPEED_WINDOW_MS);
  });

  it("never turns a nonsense window into a full award", () => {
    const { awarded } = scoreChoiceAnswer(scoredSingle, ["a"], clampElapsed(0, -1));

    expect(awarded).toBe(500);
  });

  it("leaves a claim of zero intact — the accepted, undetectable case", () => {
    // Recorded as a test so the risk is visible in the suite rather than only in a
    // docstring. Bounded by the 2× ceiling, not defended against.
    expect(clampElapsed(0, 9_000)).toBe(0);
  });
});
