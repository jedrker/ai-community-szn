import { describe, expect, it } from "vitest";

import { quiz } from "../../quiz/index";
import {
  clampElapsed,
  CLOSENESS_BANDS,
  MAX_TEXT_ANSWER_LENGTH,
  scoreChoiceAnswer,
  scoreNumberAnswer,
  scoreTextAnswer,
  speedWeight,
  SPEED_WINDOW_MS,
  type ChoiceQuestion,
} from "./scoring";
import type { NumberQuestion, TextQuestion } from "../../quiz/index";

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

const scoredNumber: NumberQuestion = {
  kind: "number",
  id: "fixture-number",
  prompt: "?",
  points: 1000,
  correctValue: 67,
};

/**
 * The two live number questions, pulled from the definition rather than mirrored as
 * fixtures — magnitude-independence is only observable across the pair, and the pair
 * is the thing the FR's resolution rests on. `definition.ts` says as much at the first
 * of them: they were chosen two orders of magnitude apart for exactly this test.
 *
 * Resolved through a kind check rather than a positional index, so a reordering of the
 * quiz fails here loudly instead of quietly pointing every band assertion at some other
 * kind of question.
 */
function liveNumberQuestion(id: string): NumberQuestion {
  const question = quiz.questions.find((candidate) => candidate.id === id);
  if (question?.kind !== "number") throw new Error(`expected ${id} to be a number question`);
  return question;
}

const lyro = liveNumberQuestion("lyro-automatyzacja");
const aiDevs = liveNumberQuestion("ai-devs-absolwenci");

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

describe("numeric closeness is banded on relative error (FR-013)", () => {
  /**
   * Every row is run against **both** live questions, whose true values are two orders
   * of magnitude apart. That is the property FR-013's resolution rests on — one rule,
   * no per-question tuning — and it is invisible against a single value.
   *
   * `relativeError` is turned into a guess on each side of the true value, so the edges
   * are asserted from above and below rather than only where the arithmetic is kind.
   */
  const bands: ReadonlyArray<{ label: string; relativeError: number; closeness: number }> = [
    { label: "exact", relativeError: 0, closeness: 1 },
    { label: "inside 5%", relativeError: 0.03, closeness: 0.8 },
    { label: "exactly on the 5% edge", relativeError: 0.05, closeness: 0.8 },
    { label: "just past 5%", relativeError: 0.051, closeness: 0.6 },
    { label: "exactly on the 10% edge", relativeError: 0.1, closeness: 0.6 },
    { label: "just past 10%", relativeError: 0.101, closeness: 0.3 },
    { label: "inside 25%", relativeError: 0.2, closeness: 0.3 },
    { label: "exactly on the 25% edge", relativeError: 0.25, closeness: 0.3 },
    { label: "just past 25%", relativeError: 0.251, closeness: 0 },
    { label: "wildly off", relativeError: 3, closeness: 0 },
  ];

  const questions: ReadonlyArray<[string, NumberQuestion]> = [
    ["lyro-automatyzacja (67)", lyro],
    ["ai-devs-absolwenci (10 000)", aiDevs],
  ];

  for (const [name, question] of questions) {
    for (const side of [1, -1] as const) {
      const direction = side === 1 ? "above" : "below";

      it.each(bands)(`awards $closeness for $label ${direction} on ${name}`, ({
        relativeError,
        closeness,
      }) => {
        const points = question.points;
        if (points === null) throw new Error("expected a scored question");

        const guess = question.correctValue * (1 + side * relativeError);

        // At elapsed 0 the speed weight is exactly 1, so the award *is* the band —
        // any other elapsed would fold two rules into one assertion.
        expect(scoreNumberAnswer(question, guess, 0).awarded).toBe(Math.round(points * closeness));
      });
    }
  }

  it("holds that the two live questions really are two orders of magnitude apart", () => {
    // The pair is the fixture for everything above. If a later edit brings them close
    // together, the band table still passes while proving nothing.
    expect(Math.abs(aiDevs.correctValue / lyro.correctValue)).toBeGreaterThan(100);
  });

  it("reports an exact hit as correct with the full band", () => {
    expect(scoreNumberAnswer(lyro, 67, 0)).toEqual({ correct: true, awarded: 1000 });
  });

  it("reports a scoring near-miss as correct: false with a positive award", () => {
    // **The partial-credit case the reveal copy depends on.** A guess of 65 against 67
    // is inside 5%, so it earns 800 of 1000 — and `correct` is still false, because for
    // this kind the flag means "exact hit" and nothing else. Anything reading it as
    // "scored nothing" is wrong here.
    const result = scoreNumberAnswer(lyro, 65, 0);

    expect(result.correct).toBe(false);
    expect(result.awarded).toBe(800);
  });

  it("scores a guess far outside every band as nothing", () => {
    expect(scoreNumberAnswer(lyro, 50, 0)).toEqual({ correct: false, awarded: 0 });
  });

  it("scores a negative guess as wrong rather than treating the sign as distance", () => {
    expect(scoreNumberAnswer(lyro, -67, 0).awarded).toBe(0);
  });

  it("returns correct: false and awarded: 0 for an unscored question", () => {
    const unscoredNumber: NumberQuestion = { ...scoredNumber, points: null };

    expect(scoreNumberAnswer(unscoredNumber, 67, 0)).toEqual({ correct: false, awarded: 0 });
  });

  it("awards nothing for a zero correctValue rather than Infinity or NaN", () => {
    // The schema refuses this at the build gate (`schema.test.ts`), so it is only
    // reachable through a hand-built question — but a scorer that divided by it would
    // put `Infinity` into a field stored as an integer.
    const zeroed: NumberQuestion = { ...scoredNumber, correctValue: 0 };

    for (const guess of [0, 1, -1]) {
      const result = scoreNumberAnswer(zeroed, guess, 0);
      expect(result).toEqual({ correct: false, awarded: 0 });
      expect(Number.isFinite(result.awarded)).toBe(true);
    }
  });

  it("awards nothing for a non-finite guess", () => {
    // The route parses and refuses these first; this is the floor under that.
    for (const guess of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(scoreNumberAnswer(lyro, guess, 0)).toEqual({ correct: false, awarded: 0 });
    }
  });

  it("keeps the band table monotonic and terminal", () => {
    // The table is quoted in the plan, the tests and CLAUDE.md. This is the assertion
    // that a well-meaning edit to one of the five rows has to survive.
    const errors = CLOSENESS_BANDS.map((band) => band.maxRelativeError);
    const closenesses = CLOSENESS_BANDS.map((band) => band.closeness);

    expect(errors).toEqual([...errors].sort((a, b) => a - b));
    expect(closenesses).toEqual([...closenesses].sort((a, b) => b - a));
    expect(CLOSENESS_BANDS.at(-1)?.maxRelativeError).toBe(Number.POSITIVE_INFINITY);
    expect(CLOSENESS_BANDS.at(-1)?.closeness).toBe(0);
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

  it("awards an exact numeric hit exactly what a correct choice answer gets", () => {
    // Same assertion, third kind: at closeness 1 the numeric award is the choice award,
    // and it stops being so the moment the curve is copied instead of reused.
    for (const elapsed of [0, 3_333, SPEED_WINDOW_MS / 2, SPEED_WINDOW_MS, SPEED_WINDOW_MS * 3]) {
      const number = scoreNumberAnswer(scoredNumber, 67, elapsed).awarded;
      const choice = scoreChoiceAnswer(scoredSingle, ["a"], elapsed).awarded;

      expect(number).toBe(choice);
    }
  });

  it("weights a partial-credit guess by the same curve", () => {
    // 800 of 1000 at full speed, halved at the window — the two rules multiply rather
    // than one of them shadowing the other.
    expect(scoreNumberAnswer(scoredNumber, 65, 0).awarded).toBe(800);
    expect(scoreNumberAnswer(scoredNumber, 65, SPEED_WINDOW_MS).awarded).toBe(400);
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
