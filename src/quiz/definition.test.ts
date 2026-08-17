import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { quizDefinitions } from "./definitions";
import {
  getQuestionById,
  getQuizByCode,
  getQuizById,
  getQuizByQuestionId,
  normalizeAnswer,
  quizzes,
  registryProblems,
  RESERVED_QUIZ_SLUGS,
} from "./index";
import type { Quiz } from "./schema";
import { quizSchema } from "./schema";
import { questionsOfKind } from "./test-support";

/**
 * The test that turns an authoring mistake into a red test instead of a stage incident.
 * The schema's own rules are proven against synthetic fixtures in `schema.test.ts`;
 * what is left here is everything true of the *committed* registry that the schema
 * cannot express.
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
 * here fails, something is actually wrong with the registry.
 */

describe("every committed quiz definition", () => {
  it("has at least one quiz to check", () => {
    expect(quizDefinitions.length).toBeGreaterThan(0);
  });

  it.each(quizDefinitions)("parses against the schema", (definition) => {
    const result = quizSchema.safeParse(definition);
    if (!result.success) {
      throw new Error(
        "\n" +
          result.error.issues.map((issue) => `  - ${issue.message}`).join("\n"),
      );
    }
    expect(result.success).toBe(true);
  });

  /**
   * FR-018's join window, as a property of each running order.
   *
   * The room is still arriving while the first question is on screen — someone reading
   * the QR off the projector has not typed a name yet. Opening on a scored question
   * charges them for the walk to their seat. Which kind does the warming up is an
   * authoring choice (today a word cloud, then the gather beat); that it costs nobody
   * points is not.
   */
  it.each(quizzes)(
    "$id opens on a question nobody can lose points to",
    (quiz) => {
      expect(quiz.questions[0]?.points).toBeNull();
    },
  );
});

/**
 * The one place the registry's *shape* is still constrained, and it earns it: tests
 * across `src/lib/session/` and `src/pages/api/quiz/` derive their fixtures by kind
 * through `questionOfKind`, because the routes resolve a question through
 * `getQuestionById` and a synthetic id 404s there.
 *
 * **Stated over the union, not per quiz** (multiple-quizzes). A short single-event quiz
 * that only asks two choice questions must stay legal to commit; what must not happen is
 * the *registry as a whole* losing a kind, because that is what `test-support.ts` draws
 * fixtures from and a dropped kind silently drops that kind's route coverage. Failing
 * here says so once, in the file that owns the definitions, instead of five times in
 * files that only borrowed from them.
 *
 * Note what it does *not* say: how many questions of each kind, in which quiz, in what
 * order, or carrying what. One of each, anywhere in the registry, is enough.
 */
describe("the registry as a whole", () => {
  it("exercises every question kind the code supports", () => {
    const kinds = new Set(
      quizzes.flatMap((quiz) =>
        quiz.questions.map((question) => question.kind),
      ),
    );

    expect([...kinds].sort()).toEqual([
      "multiple-choice",
      "number",
      "single-choice",
      "text",
      "word-cloud",
    ]);
  });

  it("gives every quiz a title a host and an attendee can read", () => {
    for (const quiz of quizzes) {
      expect(
        quiz.title.trim().length,
        `quiz "${quiz.id}" has no title`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * The three uniqueness rules, asserted against the *committed* registry rather than
   * against a fixture — this is the direction that catches an author adding a second
   * quiz that collides. The other direction, that the rules actually refuse a
   * collision, is `registryProblems` below.
   */
  it("holds the registry rules it enforces at the build gate", () => {
    expect(registryProblems(quizzes)).toEqual([]);
  });
});

/**
 * The gate, shown to fire.
 *
 * A build gate whose only input is the committed registry can only ever be observed
 * passing, and `registryProblems([...quizzes])` returning `[]` above is evidence of
 * nothing on its own — a function returning a constant empty array would satisfy it.
 * Each rule gets a fixture that trips it and a near-miss that must not.
 */
describe("the cross-quiz gate refuses what a per-quiz schema cannot see", () => {
  const question = {
    kind: "word-cloud",
    id: "fixture-opener",
    prompt: "Napisz słowo",
    points: null,
  } as const;

  const quizOf = (id: string, code: string, questionIds: string[]): Quiz => ({
    id,
    title: `Quiz ${id}`,
    code,
    questions: questionIds.map((questionId) => ({
      ...question,
      id: questionId,
    })),
  });

  const a = quizOf("fixture-a", "0001", ["fixture-a-otwarcie"]);
  const b = quizOf("fixture-b", "0002", ["fixture-b-otwarcie"]);

  it("passes two quizzes that share nothing", () => {
    expect(registryProblems([a, b])).toEqual([]);
  });

  it("refuses an empty registry", () => {
    const [problem] = registryProblems([]);
    expect(problem).toContain("Rejestr quizów jest pusty");
  });

  it("refuses two quizzes with the same id", () => {
    const problems = registryProblems([a, { ...b, id: a.id }]).join(" | ");
    expect(problems).toContain(a.id);
    expect(problems).toContain("to samo id");
  });

  /**
   * Titles are checked because the title is the whole of what two surfaces show
   * (impl-review F7): the host picks from it at `/quiz/host`, and a phone on the wrong quiz
   * is told "W tej sali trwa «X»". Two quizzes sharing one make both ambiguous on exactly
   * the screens the field exists for, while every id- and code-level rule still passes.
   */
  it("refuses two quizzes with the same title", () => {
    const problems = registryProblems([a, { ...b, title: a.title }]).join(
      " | ",
    );

    expect(problems).toContain(a.title);
    expect(problems).toContain(a.id);
    expect(problems).toContain(b.id);
  });

  /**
   * A slug a static route already owns (impl-review F7). The quiz parses, reaches the picker
   * and gets a join code — and its *attendee* view is unreachable, because the static route
   * wins. `spine-check` is the sharper one: it 404s in production, so such a quiz would work
   * in preview and vanish at the event.
   */
  it.each(RESERVED_QUIZ_SLUGS)("refuses a quiz whose id is %s", (reserved) => {
    const problems = registryProblems([{ ...a, id: reserved }]).join(" | ");

    expect(problems).toContain(reserved);
    expect(problems).toContain("nieosiągalny");
  });

  it("refuses two quizzes with the same join code", () => {
    const problems = registryProblems([a, { ...b, code: a.code }]).join(" | ");
    expect(problems).toContain(a.code);
    expect(problems).toContain(a.id);
    expect(problems).toContain(b.id);
  });

  it("refuses the same question id in two different quizzes", () => {
    const shared = a.questions[0]!.id;
    const problems = registryProblems([
      a,
      { ...b, questions: [{ ...question, id: shared }] },
    ]).join(" | ");

    expect(problems).toContain(shared);
    expect(problems).toContain(a.id);
    expect(problems).toContain(b.id);
  });

  /**
   * A duplicate *within* one quiz is `quizSchema`'s job and is already refused there.
   * Reporting it here too would send the author looking for a second problem that does
   * not exist — and would make the cross-quiz message fire on a single-quiz registry.
   */
  it("leaves a within-quiz duplicate to the schema", () => {
    const withDuplicate = quizOf("fixture-c", "0003", [
      "fixture-c-jeden",
      "fixture-c-jeden",
    ]);

    expect(registryProblems([withDuplicate])).toEqual([]);
    expect(quizSchema.safeParse(withDuplicate).success).toBe(false);
  });
});

/**
 * **The reserved set, kept in step with the routes that cause it** (impl-review F7).
 *
 * `RESERVED_QUIZ_SLUGS` is a literal because `src/quiz/index.ts` must import inside a
 * serverless function and a bare `vitest run`, where reading the filesystem is the wrong
 * answer. A literal drifts, though — someone adds a static page under `src/pages/quiz/` and
 * a quiz can silently take its address. A *test* may read the filesystem, so the sync is
 * checked here rather than hoped for.
 *
 * Compared as an equality in both directions: a missing entry is the drift this exists to
 * catch, and a stale extra entry needlessly forbids a slug an author could legitimately want.
 */
describe("the reserved slugs match the routes that reserve them", () => {
  const QUIZ_PAGES = fileURLToPath(new URL("../pages/quiz/", import.meta.url));

  /** Every address directly under `/quiz/` that a static file, not `[slug].astro`, owns. */
  function staticSiblingSlugs(): string[] {
    return (
      readdirSync(QUIZ_PAGES, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("["))
        .filter((entry) => entry.isDirectory() || entry.name.endsWith(".astro"))
        .map((entry) => entry.name.replace(/\.astro$/, ""))
        // `index` is `/quiz` itself, which no slug can collide with.
        .filter((name) => name !== "index")
    );
  }

  it("finds the routes to compare against", () => {
    // Non-vacuity: an empty read would make the equality below pass by comparing nothing.
    expect(staticSiblingSlugs().length).toBeGreaterThan(0);
  });

  it("reserves exactly the slugs a static route would shadow", () => {
    expect([...RESERVED_QUIZ_SLUGS].sort()).toEqual(
      staticSiblingSlugs().sort(),
    );
  });
});

describe("getQuestionById", () => {
  it("finds every question in every quiz the registry carries", () => {
    for (const quiz of quizzes) {
      for (const question of quiz.questions) {
        expect(getQuestionById(question.id)).toBe(question);
      }
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

describe("the registry lookups", () => {
  it("finds every quiz by its id and by its code", () => {
    for (const quiz of quizzes) {
      expect(getQuizById(quiz.id)).toBe(quiz);
      expect(getQuizByCode(quiz.code)).toBe(quiz);
    }
  });

  it("resolves every question back to the quiz that carries it", () => {
    for (const quiz of quizzes) {
      for (const question of quiz.questions) {
        expect(getQuizByQuestionId(question.id)).toBe(quiz);
      }
    }
  });

  it("returns undefined rather than throwing on an unknown slug, code or question", () => {
    expect(getQuizById("nie-ma-takiego-quizu")).toBeUndefined();
    expect(getQuizByCode("0000")).toBeUndefined();
    expect(getQuizByQuestionId("nie-ma-takiego")).toBeUndefined();
  });
});

/**
 * **A question id reaches the attendee's browser** — the published snapshot names the
 * open question by id, so it is in page source on 150 phones while the question is
 * being asked.
 *
 * S-02 found this the expensive way: the text question was `id: "halucynacje"`, which
 * is its accepted answer spelled out. Ids describing their subject is the convention
 * (the definition files say so); this is the case where the subject *is* the answer, and
 * the convention has to bend.
 */
describe("no question id gives its own answer away", () => {
  const flatten = (value: string) =>
    normalizeAnswer(value).replace(/[^\p{L}\p{N}]/gu, "");

  it.each(questionsOfKind("text"))(
    "$id does not contain an accepted answer",
    (question) => {
      const id = flatten(question.id);

      for (const accepted of question.acceptedAnswers) {
        expect(
          id,
          `question id "${question.id}" contains the answer "${accepted}"`,
        ).not.toContain(flatten(accepted));
      }
    },
  );

  it.each(questionsOfKind("number"))(
    "$id does not contain the true value",
    (question) => {
      expect(flatten(question.id)).not.toContain(String(question.correctValue));
    },
  );

  it.each([
    ...questionsOfKind("single-choice"),
    ...questionsOfKind("multiple-choice"),
  ])("$id does not contain a correct option id", (question) => {
    const id = flatten(question.id);

    for (const optionId of question.correctOptionIds) {
      expect(
        id,
        `question id "${question.id}" contains the correct option`,
      ).not.toContain(flatten(optionId));
    }
  });
});
