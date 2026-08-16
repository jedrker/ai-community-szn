import { describe, expect, it } from "vitest";

import { quizDefinition } from "./definition";
import { getQuestionById, normalizeAnswer, quiz } from "./index";
import { quizSchema } from "./schema";
import { questionsOfKind } from "./test-support";

/**
 * The test that turns an authoring mistake into a red test instead of a stage incident.
 * The schema's own rules are proven against synthetic fixtures in `schema.test.ts`;
 * what is left here is everything true of the *committed* quiz that the schema cannot
 * express.
 *
 * **Every assertion in this file is a rule, not a transcript.** It used to pin the
 * content: fourteen questions, the unscored ids spelled out, the numeric values
 * `[67, 10000]`, the opener asserted to be the word cloud by kind. All of it passed and
 * none of it protected anything — the quiz is *meant* to be edited (PRD FR-001 puts it
 * in source precisely so it can be), and a transcript makes routine editing look like
 * breakage. Swapping a question for next month's event failed six tests here and in four
 * session files, every one of them saying only "the quiz changed", which was the point.
 *
 * So: nothing below counts questions, names an id, or quotes an answer. If an assertion
 * here fails, something is actually wrong with the quiz.
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

  /**
   * The one place the quiz's *shape* is still constrained, and it earns it: tests across
   * `src/lib/session/` and `src/pages/api/quiz/` derive their fixtures by kind through
   * `questionOfKind`, because the routes resolve a question through `getQuestionById`
   * and a synthetic id 404s there. A quiz that drops a kind therefore silently drops
   * that kind's route coverage. Failing here says so once, in the file that owns the
   * definition, instead of five times in files that only borrowed from it.
   *
   * Note what it does *not* say: how many questions of each kind, in what order, or
   * carrying what. One of each is enough.
   */
  it("exercises every question kind the code supports", () => {
    const kinds = new Set(quiz.questions.map((question) => question.kind));

    expect([...kinds].sort()).toEqual([
      "multiple-choice",
      "number",
      "single-choice",
      "text",
      "word-cloud",
    ]);
  });

  /**
   * FR-018's join window, as a property of the running order.
   *
   * The room is still arriving while the first question is on screen — someone reading
   * the QR off the projector has not typed a name yet. Opening on a scored question
   * charges them for the walk to their seat. Which kind does the warming up is an
   * authoring choice (today a word cloud, then the gather beat); that it costs nobody
   * points is not.
   */
  it("opens on a question nobody can lose points to", () => {
    expect(quiz.questions[0]?.points).toBeNull();
  });

  /**
   * **A question id reaches the attendee's browser** — the published snapshot names the
   * open question by id, so it is in page source on 150 phones while the question is
   * being asked.
   *
   * S-02 found this the expensive way: the text question was `id: "halucynacje"`, which
   * is its accepted answer spelled out. Ids describing their subject is the convention
   * (`definition.ts` says so); this is the case where the subject *is* the answer, and
   * the convention has to bend.
   */
  describe("no question id gives its own answer away", () => {
    const flatten = (value: string) => normalizeAnswer(value).replace(/[^\p{L}\p{N}]/gu, "");

    it.each(questionsOfKind("text"))("$id does not contain an accepted answer", (question) => {
      const id = flatten(question.id);

      for (const accepted of question.acceptedAnswers) {
        expect(id, `question id "${question.id}" contains the answer "${accepted}"`).not.toContain(
          flatten(accepted)
        );
      }
    });

    it.each(questionsOfKind("number"))("$id does not contain the true value", (question) => {
      expect(flatten(question.id)).not.toContain(String(question.correctValue));
    });

    it.each([...questionsOfKind("single-choice"), ...questionsOfKind("multiple-choice")])(
      "$id does not contain a correct option id",
      (question) => {
        const id = flatten(question.id);

        for (const optionId of question.correctOptionIds) {
          expect(id, `question id "${question.id}" contains the correct option`).not.toContain(
            flatten(optionId)
          );
        }
      }
    );
  });
});

describe("getQuestionById", () => {
  it("finds every question the definition carries", () => {
    for (const question of quiz.questions) {
      expect(getQuestionById(question.id)).toBe(question);
    }
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
