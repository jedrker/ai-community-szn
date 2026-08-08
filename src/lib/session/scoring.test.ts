import { describe, expect, it } from "vitest";

import { quiz } from "../../quiz/index";
import {
  clampElapsed,
  scoreChoiceAnswer,
  speedWeight,
  SPEED_WINDOW_MS,
  type ChoiceQuestion,
} from "./scoring";

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

  it("returns zero when the server's own elapsed is nonsense", () => {
    expect(clampElapsed(4_000, -1)).toBe(0);
    expect(clampElapsed(4_000, Number.NaN)).toBe(0);
  });

  it("leaves a claim of zero intact — the accepted, undetectable case", () => {
    // Recorded as a test so the risk is visible in the suite rather than only in a
    // docstring. Bounded by the 2× ceiling, not defended against.
    expect(clampElapsed(0, 9_000)).toBe(0);
  });
});
