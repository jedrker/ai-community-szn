import { describe, expect, it } from "vitest";

import { quiz } from "./index";
import type { Quiz } from "./schema";
import {
  FORBIDDEN_KEYS,
  forbiddenAnswerValues,
  getPublicQuestionById,
  projectQuiz,
  publicQuiz,
} from "./public";

/**
 * The gate on what reaches a phone (roadmap S-02).
 *
 * The attendee view embeds every question at page render so switching questions costs
 * no network — which means every one of these assertions is about bytes that really do
 * land in a browser someone can open devtools on.
 */

const serialized = JSON.stringify(publicQuiz);

describe("the public projection carries no answers", () => {
  it.each(FORBIDDEN_KEYS)("has no %s key anywhere", (key) => {
    expect(serialized).not.toContain(key);
  });

  /**
   * By value, not only by key — so a new answer-bearing field added to `schema.ts`
   * under some other name is still caught, as long as it carries one of these
   * strings. Key-level checks alone would pass it straight through.
   */
  it("contains no accepted free-text answer and no numeric true value", () => {
    const forbidden = forbiddenAnswerValues();

    // Guard the guard: if this ever collects nothing, every assertion below is
    // vacuous and the suite would applaud.
    expect(forbidden.length).toBeGreaterThan(0);

    for (const value of forbidden) {
      expect(serialized).not.toContain(value);
    }
  });

  /**
   * The one that would have been easy to get wrong in the other direction: the
   * correct option's id **must** be present, because an attendee cannot select an
   * option that was never sent. What must not be present is anything saying which one
   * it is. A test asserting the id's absence would be asserting the feature away.
   */
  it("does send every option id, including the correct one", () => {
    const choice = quiz.questions.find((q) => q.kind === "single-choice");
    if (choice?.kind !== "single-choice") throw new Error("expected a single-choice question");

    const correct = choice.correctOptionIds[0]!;
    const projected = getPublicQuestionById(choice.id);

    expect(projected?.options?.map((option) => option.id)).toContain(correct);
  });
});

describe("the public projection is complete enough to render", () => {
  it("projects every question, in definition order", () => {
    expect(publicQuiz.questions.map((q) => q.id)).toEqual(quiz.questions.map((q) => q.id));
  });

  it("carries the prompt and kind for every question", () => {
    for (const question of publicQuiz.questions) {
      expect(question.prompt.length).toBeGreaterThan(0);
      expect(question.kind).toBeTruthy();
    }
  });

  it("carries options for choice questions and omits them elsewhere", () => {
    for (const question of quiz.questions) {
      const projected = getPublicQuestionById(question.id);
      const isChoice =
        question.kind === "single-choice" || question.kind === "multiple-choice";

      if (isChoice) {
        expect(projected?.options).toHaveLength(question.options.length);
      } else {
        // text, number and word-cloud are answered into an empty field — the prompt
        // is the whole of what a device needs.
        expect(projected?.options).toBeUndefined();
      }
    }
  });

  it("projects the same set of options, ignoring order", () => {
    const choice = quiz.questions.find((q) => q.kind === "multiple-choice");
    if (choice?.kind !== "multiple-choice") throw new Error("expected a multiple-choice question");

    // Order is deliberately not definition order — see the shuffle tests below.
    expect(getPublicQuestionById(choice.id)?.options?.map((o) => o.text).sort()).toEqual(
      choice.options.map((o) => o.text).sort()
    );
  });

  it("keeps each option's id paired with its own text", () => {
    // The shuffle moves whole options. A bug that permuted ids and texts separately
    // would relabel every answer in the room — worse than the bias it is fixing.
    for (const question of quiz.questions) {
      const projected = getPublicQuestionById(question.id);
      if (!projected?.options) continue;

      for (const option of projected.options) {
        const source = question.kind === "single-choice" || question.kind === "multiple-choice"
          ? question.options.find((o) => o.id === option.id)
          : undefined;
        expect(source?.text).toBe(option.text);
      }
    }
  });

  /**
   * S-03's one addition to the projection, and the reason it exists: an unscored
   * question and a wrong answer produce the identical result payload
   * (`{ correct: false, awarded: 0 }`), so a view that inferred "warm-up" from the
   * award would tell every latecomer who answered the gather question that they
   * failed. The flag is what lets the copy differ.
   */
  it("marks whether each question is scored, matching points !== null", () => {
    for (const question of quiz.questions) {
      expect(getPublicQuestionById(question.id)?.scored).toBe(question.points !== null);
    }
  });

  it("covers both cases, so neither branch is asserted vacuously", () => {
    const flags = publicQuiz.questions.map((question) => question.scored);

    // Both branches populated, in whatever proportion the quiz authors them. This used
    // to demand exactly two unscored questions, which turned "we dropped the gather
    // beat" into a failed assertion about vacuity — a different fact, reported wrongly.
    expect(flags.filter((scored) => scored === false).length).toBeGreaterThan(0);
    expect(flags.filter((scored) => scored === true).length).toBeGreaterThan(0);
  });

  it("says whether, never how much", () => {
    // `points` stays in FORBIDDEN_KEYS above; this pins the *value* out too, so a
    // future `scored: 1000` truthiness shortcut fails here.
    for (const question of publicQuiz.questions) {
      expect(typeof question.scored).toBe("boolean");
    }
    // Built from what the quiz authors rather than typed: a `scored: 1000` truthiness
    // shortcut has to fail here whatever a question is currently worth.
    for (const question of quiz.questions) {
      if (question.points === null) continue;
      expect(serialized).not.toContain(String(question.points));
    }
  });

  /**
   * S-11's addition, and the one value in this projection that exists *to* be seen:
   * both the phone and the projector build their countdown from this plus the
   * snapshot's `updatedAt`, so a question missing it would render no clock at all while
   * the server still enforced one.
   */
  it("carries the time limit for scored questions and omits it for unscored ones", () => {
    for (const question of quiz.questions) {
      const projected = getPublicQuestionById(question.id);

      if (question.points === null) {
        // Absent as a *key*, not present holding undefined — a view checking for a
        // clock with `in` or `Object.keys` must see nothing here.
        expect(projected && "timeLimitSeconds" in projected).toBe(false);
      } else {
        expect(projected?.timeLimitSeconds).toBe(question.timeLimitSeconds);
        expect(typeof projected?.timeLimitSeconds).toBe("number");
      }
    }
  });

  it("covers both limit cases, so neither branch is asserted vacuously", () => {
    const withLimit = publicQuiz.questions.filter((q) => q.timeLimitSeconds !== undefined);
    const withoutLimit = publicQuiz.questions.filter((q) => q.timeLimitSeconds === undefined);

    // The same pairing as the `scored` guard above, from the other side.
    expect(withoutLimit.length).toBeGreaterThan(0);
    expect(withLimit.length).toBeGreaterThan(0);
  });

  /**
   * The allowlist, asserted positively — the counterpart to `FORBIDDEN_KEYS`.
   *
   * That list catches the four fields we already know are dangerous; this catches the
   * *next* one, whatever it is called. The projection is built by allowlist precisely
   * so a new `schema.ts` field is invisible here by default, and this test is what
   * fails if someone widens `toPublicQuestion` without deciding to.
   *
   * It is also the guard on the server's grace window: the enforced cutoff sits past
   * the visible zero, and a client that knew by how much would show a clock that lies
   * in the generous direction. Nothing about the grace may appear in a payload a phone
   * can read.
   */
  it("exposes only the keys on the allowlist, so a new field cannot ride along", () => {
    const seen = new Set<string>();
    for (const question of publicQuiz.questions) {
      for (const key of Object.keys(question)) seen.add(key);
    }

    expect([...seen].sort()).toEqual([
      "id",
      "kind",
      "options",
      "prompt",
      "scored",
      "timeLimitSeconds",
    ]);
  });

  it("returns undefined for an unknown id rather than throwing", () => {
    // A question id arriving from a device is untrusted input.
    expect(getPublicQuestionById("nie-ma-takiego-pytania")).toBeUndefined();
  });
});

/**
 * The shuffle's properties, measured over generated questions rather than the fourteen
 * that happen to be committed.
 *
 * These assertions are about a *distribution*, and a distribution needs a population.
 * Reading it off the live quiz meant the strength of the test was set by how many
 * single-choice questions the event happened to want — and the sharpest assertion,
 * "every position is used", silently required at least four of them. Editing the quiz
 * down to three broke a test about a hash function.
 *
 * The correct answer sits first in every generated question, which is the bias as
 * drafted (six of eight, when this was written) taken to its worst case.
 */
describe("the option shuffle, measured at scale", () => {
  const OPTION_COUNT = 4;
  const POPULATION = 60;

  const generated: Quiz = {
    questions: Array.from({ length: POPULATION }, (_unused, index) => ({
      kind: "single-choice" as const,
      id: `generated-${index}`,
      prompt: "?",
      points: 1000,
      timeLimitSeconds: 25,
      options: Array.from({ length: OPTION_COUNT }, (_option, position) => ({
        id: `opt-${position}`,
        text: `Option ${position}`,
      })),
      correctOptionIds: ["opt-0"],
    })),
  };

  const projected = projectQuiz(generated).questions;

  /**
   * THE REASON THE SHUFFLE EXISTS: an attendee who always tapped the first option
   * scored most of the segment. Nobody spots that by reading `definition.ts` —
   * positional correlation is invisible in a list of four.
   *
   * Asserts the whole distribution, not just index 0. The first version checked only
   * "is the correct answer first", and passed against a shuffle that had moved every
   * correct answer to index 2 or 3 — the same tell wearing a different hat.
   *
   * When this fails, the generator is not broken: bump `SHUFFLE_SALT` in `public.ts`
   * until the draw spreads. See the note there.
   */
  it("spreads the correct answer evenly across every position", () => {
    const positions = new Map<number, number>();

    for (const question of projected) {
      const index = question.options!.findIndex((option) => option.id === "opt-0");
      positions.set(index, (positions.get(index) ?? 0) + 1);
    }

    expect(positions.size).toBe(OPTION_COUNT);

    // Every position within a factor of two of its share. Loose enough not to be a
    // test of the hash, tight enough that any surviving tell fails it.
    const expected = POPULATION / OPTION_COUNT;
    for (const [index, count] of positions) {
      expect(count, `position ${index} holds ${count} of ${POPULATION}`).toBeGreaterThan(
        expected / 2
      );
      expect(count).toBeLessThan(expected * 2);
    }
  });

  it("gives different questions different permutations", () => {
    // A seed that ignored the id would shuffle every question identically, which would
    // move the tell rather than remove it.
    const orders = new Set(projected.map((q) => q.options!.map((o) => o.id).join(",")));

    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("the option shuffle reaches the committed quiz", () => {
  const singleChoice = quiz.questions.filter((q) => q.kind === "single-choice");

  /**
   * The conformance half: whatever questions the quiz currently carries, the correct
   * answer is not parked on one position across them.
   *
   * The bar has to scale with the population — with two single-choice questions there
   * are only two draws, and demanding four distinct positions would fail the shuffle for
   * the quiz's size rather than for its behaviour. `spreads the correct answer evenly`
   * above is where the property is really proven.
   */
  it("shows no positional tell across the drafted questions", () => {
    const positions = new Map<number, number>();

    for (const question of singleChoice) {
      if (question.kind !== "single-choice") continue;
      const projected = getPublicQuestionById(question.id);
      const index = projected?.options?.findIndex(
        (option) => option.id === question.correctOptionIds[0]
      );
      if (index === undefined || index < 0) throw new Error(`no correct option in ${question.id}`);
      positions.set(index, (positions.get(index) ?? 0) + 1);
    }

    const optionCount = Math.max(
      ...singleChoice.map((q) => (q.kind === "single-choice" ? q.options.length : 0))
    );
    const worst = Math.max(...positions.values());

    // No position holds more than half the correct answers, and the draws are spread
    // as widely as this many questions allow.
    expect(worst).toBeLessThanOrEqual(Math.ceil(singleChoice.length / 2));
    expect(positions.size).toBeGreaterThanOrEqual(Math.min(singleChoice.length, optionCount));
  });

  it("actually reorders something, rather than being an expensive identity", () => {
    const moved = quiz.questions.filter((question) => {
      if (question.kind !== "single-choice" && question.kind !== "multiple-choice") return false;
      const projected = getPublicQuestionById(question.id);
      return (
        projected?.options?.map((o) => o.id).join(",") !==
        question.options.map((o) => o.id).join(",")
      );
    }).length;

    expect(moved).toBeGreaterThan(0);
  });

  /**
   * Determinism is what lets 150 phones and a projector agree about which option is
   * which. A per-render random order would put every device out of step, and S-04's
   * distribution chart would mislabel its bars.
   */
  it("is stable across repeated projections", () => {
    const once = JSON.stringify(publicQuiz);
    expect(JSON.stringify(publicQuiz)).toBe(once);

    const question = singleChoice[0]!;
    expect(getPublicQuestionById(question.id)?.options?.map((o) => o.id)).toEqual(
      getPublicQuestionById(question.id)?.options?.map((o) => o.id)
    );
  });

  it("gives the drafted questions different permutations", () => {
    const orders = new Set(
      singleChoice.map((question) => {
        const projected = getPublicQuestionById(question.id);
        const sourceIds =
          question.kind === "single-choice" ? question.options.map((o) => o.id) : [];
        return (projected?.options ?? [])
          .map((option) => sourceIds.indexOf(option.id))
          .join(",");
      })
    );

    // Bounded by how many questions there are to differ, for the reason above.
    expect(orders.size).toBeGreaterThanOrEqual(Math.min(2, singleChoice.length));
  });
});
