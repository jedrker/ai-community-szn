import { describe, expect, it } from "vitest";

import { quiz } from "./index";
import {
  FORBIDDEN_KEYS,
  forbiddenAnswerValues,
  getPublicQuestionById,
  publicQuiz,
} from "./public";

/**
 * The gate on what reaches a phone (roadmap S-02).
 *
 * The attendee view embeds all 14 questions at page render so switching questions
 * costs no network — which means every one of these assertions is about bytes that
 * really do land in a browser someone can open devtools on.
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

    // The drafted quiz has exactly two unscored questions — the word cloud that opens
    // the segment and the gather beat. If either becomes scored, this fails and the
    // warm-up copy needs rethinking rather than silently disappearing.
    expect(flags.filter((scored) => scored === false)).toHaveLength(2);
    expect(flags.filter((scored) => scored === true).length).toBeGreaterThan(0);
  });

  it("says whether, never how much", () => {
    // `points` stays in FORBIDDEN_KEYS above; this pins the *value* out too, so a
    // future `scored: 1000` truthiness shortcut fails here.
    for (const question of publicQuiz.questions) {
      expect(typeof question.scored).toBe("boolean");
    }
    expect(serialized).not.toContain("1000");
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

    // The same two unscored questions as the `scored` pair above, from the other side.
    expect(withoutLimit).toHaveLength(2);
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

describe("the option shuffle removes the positional tell", () => {
  const singleChoice = quiz.questions.filter((q) => q.kind === "single-choice");

  /**
   * THE REASON THE SHUFFLE EXISTS.
   *
   * As drafted, the correct answer sits first in six of eight single-choice questions,
   * so an attendee who always tapped the first option would score most of the segment.
   * Nobody spots that by reading `definition.ts` — positional correlation is invisible
   * in a list of four — which is why it is fixed in code rather than by hand.
   *
   * The bar is deliberately loose: this asserts the *bias* is gone, not that some
   * exact permutation was produced. A stricter assertion would break every time a
   * question is added, and would be testing the hash rather than the property.
   */
  /**
   * Asserts the whole *distribution*, not just index 0.
   *
   * The first version of this test checked only "is the correct answer first", and it
   * passed against a shuffle that had put the correct answer at index 2 or 3 in all
   * eight questions — trading "always first" for "never in the first two", which is
   * the same tell wearing a different hat. Checking one position is how you ship a
   * fix that fixed nothing.
   *
   * When this fails, the generator is not broken: bump `SHUFFLE_SALT` in `public.ts`
   * until the draw spreads. See the note there.
   */
  it("spreads the correct answer across every position", () => {
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

    const optionCount = 4; // every single-choice question in the drafted quiz has four
    const worst = Math.max(...positions.values());

    // No position may hold more than half the correct answers, and every position
    // must be used at least once. Loose enough to survive adding a question, tight
    // enough that "always first" and "never first" both fail.
    expect(worst).toBeLessThanOrEqual(Math.ceil(singleChoice.length / 2));
    expect(positions.size).toBe(optionCount);
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

  it("gives different questions different permutations", () => {
    // A seed that ignored the id would shuffle every question identically, which
    // would move the tell rather than remove it.
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

    expect(orders.size).toBeGreaterThan(1);
  });
});

describe("the allowlist actually fires", () => {
  /**
   * The `keys.test.ts` precedent: a gate that silently stopped matching would pass
   * forever and read as compliance. This proves the detector still detects.
   */
  it("would catch an answer field if one were projected", () => {
    const leaky = JSON.stringify({
      questions: [{ id: "q", kind: "single-choice", prompt: "p", correctOptionIds: ["a"] }],
    });

    expect(leaky).toContain("correctOptionIds");
    expect(serialized).not.toContain("correctOptionIds");
  });

  it("would catch a leaked accepted answer", () => {
    const [first] = forbiddenAnswerValues();
    expect(first).toBeTruthy();
    expect(JSON.stringify({ leak: first })).toContain(first!);
  });
});
