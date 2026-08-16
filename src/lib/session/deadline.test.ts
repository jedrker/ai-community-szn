import { describe, expect, it } from "vitest";

import type { Question } from "../../quiz/schema";
import { SUBMISSION_GRACE_MS, deadlineAt, isSubmissionExpired } from "./deadline";

/**
 * The submission window (roadmap S-11, FR-020).
 *
 * Synthetic fixtures rather than the real definition, for the reason `schema.test.ts`
 * gives: a failure here must mean the rule is wrong, not that someone re-timed a
 * question. The one thing taken from the real quiz is the *shape*.
 *
 * Every boundary expectation below is built from `SUBMISSION_GRACE_MS` and the fixture's
 * own limit. Typing the millisecond figures by hand would leave this file asserting a
 * grace the module no longer applies — the failure mode `scoring.test.ts` avoids the
 * same way with the closeness bands.
 */

const OPENED_AT = 1_785_000_000_000;

/** A scored question with a 25-second budget. */
const scored = {
  kind: "single-choice",
  id: "fixture-scored-question",
  prompt: "Co oznacza skrót LLM?",
  points: 1000,
  timeLimitSeconds: 25,
  options: [
    { id: "a", text: "Large Language Model" },
    { id: "b", text: "Linear Logic Machine" },
  ],
  correctOptionIds: ["a"],
} as const satisfies Question;

/** An unscored question, which the schema refuses to give a limit at all. */
const unscored = {
  kind: "word-cloud",
  id: "fixture-unscored-question",
  prompt: "Napisz śmieszne słowo związane z AI",
  points: null,
} as const satisfies Question;

const LIMIT_MS = scored.timeLimitSeconds * 1_000;
/** The visible zero. */
const VISIBLE_ZERO = OPENED_AT + LIMIT_MS;
/** The enforced cutoff — later, and deliberately not what a phone is told. */
const ENFORCED_CUTOFF = VISIBLE_ZERO + SUBMISSION_GRACE_MS;

describe("deadlineAt", () => {
  it("is the open moment plus the question's own limit", () => {
    expect(deadlineAt(OPENED_AT, scored)).toBe(VISIBLE_ZERO);
  });

  it("is the VISIBLE zero, not the enforced cutoff", () => {
    // The two must not be conflated: this value is what a countdown renders, and the
    // grace is added only by the enforcement decision.
    expect(deadlineAt(OPENED_AT, scored)).not.toBe(ENFORCED_CUTOFF);
    expect(ENFORCED_CUTOFF - deadlineAt(OPENED_AT, scored)!).toBe(SUBMISSION_GRACE_MS);
  });

  it("is null for a question with no limit", () => {
    // Not zero, and not "now" — those would read as "already expired" to a caller doing
    // arithmetic, which is the whole reason this returns null.
    expect(deadlineAt(OPENED_AT, unscored)).toBeNull();
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("is null for a %s open time rather than a nonsense deadline", (_label, openedAt) => {
    expect(deadlineAt(openedAt, scored)).toBeNull();
  });

  it("scales with the limit rather than assuming one", () => {
    const longer = { ...scored, timeLimitSeconds: 180 } as const satisfies Question;
    expect(deadlineAt(OPENED_AT, longer)).toBe(OPENED_AT + 180_000);
  });
});

describe("isSubmissionExpired", () => {
  it("accepts a submission well inside the window", () => {
    expect(isSubmissionExpired(OPENED_AT + 1_000, OPENED_AT, scored)).toBe(false);
  });

  it("accepts one arriving exactly at the visible zero", () => {
    expect(isSubmissionExpired(VISIBLE_ZERO, OPENED_AT, scored)).toBe(false);
  });

  it("accepts one inside the grace, which is what the grace is for", () => {
    // An answer the attendee watched themselves send at 0.3s remaining, on a venue
    // network. The PRD calls losing one of these the most expensive requirement it has.
    expect(isSubmissionExpired(VISIBLE_ZERO + 1, OPENED_AT, scored)).toBe(false);
    expect(isSubmissionExpired(ENFORCED_CUTOFF, OPENED_AT, scored)).toBe(false);
  });

  it("refuses one a millisecond past the grace", () => {
    // The exact edge, from the far side. Together with the row above this pins the
    // comparison as `>` against the cutoff rather than `>=`.
    expect(isSubmissionExpired(ENFORCED_CUTOFF + 1, OPENED_AT, scored)).toBe(true);
  });

  it("refuses one long past the deadline", () => {
    expect(isSubmissionExpired(VISIBLE_ZERO + 60_000, OPENED_AT, scored)).toBe(true);
  });

  it("never expires a question with no limit, however long it has been open", () => {
    // The word cloud fills until the host reveals it. An hour in, it is still open.
    expect(isSubmissionExpired(OPENED_AT + 3_600_000, OPENED_AT, unscored)).toBe(false);
  });

  /**
   * **The degenerate case fails toward acceptance, and that is the opposite direction
   * from `clampElapsed` on purpose.**
   *
   * There the unknown value is one device's claim about itself, so the safe end is the
   * stingy one. Here it is the server's own clock: refusing would take out every answer
   * in the room for the rest of the question, silently, with nothing on screen to
   * explain it. One late answer is recoverable; a refused room is not.
   */
  it.each([
    ["a NaN clock", Number.NaN, OPENED_AT],
    ["a NaN open time", VISIBLE_ZERO + 60_000, Number.NaN],
    ["a zero open time", VISIBLE_ZERO + 60_000, 0],
    ["a negative open time", VISIBLE_ZERO + 60_000, -1],
  ])("does not expire on %s", (_label, now, openedAt) => {
    expect(isSubmissionExpired(now, openedAt, scored)).toBe(false);
  });

  it("reads the question's own limit, not a shared constant", () => {
    // A moment that is late for a 5-second question and early for a 180-second one.
    const short = { ...scored, timeLimitSeconds: 5 } as const satisfies Question;
    const long = { ...scored, timeLimitSeconds: 180 } as const satisfies Question;
    const at = OPENED_AT + 30_000;

    expect(isSubmissionExpired(at, OPENED_AT, short)).toBe(true);
    expect(isSubmissionExpired(at, OPENED_AT, long)).toBe(false);
  });
});
