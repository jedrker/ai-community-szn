import { quizzes } from "./index";
import type { Question } from "./schema";

/**
 * How a test picks a question out of the committed quizzes — **by kind, never by id and
 * never by position**.
 *
 * **The search spans the whole registry** (multiple-quizzes), because no single quiz is
 * required to carry all five kinds: a short single-event quiz must stay legal, so it is
 * the *union* that `definition.test.ts` holds complete. A caller that needs to open a
 * session against the question it got can ask `getQuizByQuestionId` which quiz to
 * start — unambiguous because the build gate makes question ids globally unique — or
 * pin the quiz up front with the `quizId` filter below.
 *
 * Test-only, imported by nothing that ships. It exists because the alternative kept
 * reappearing: a fixture written as `quiz.questions.find((q) => q.id === "llm-skrot")!`
 * or `quiz.questions[2]!`, which turns editing the quiz — the one thing
 * `src/quiz/definitions/` is *for* — into a test failure in a file that has nothing to
 * do with the edit. Adding a question shifted every positional fixture; renaming one
 * turned a `!` into a `TypeError` three layers down.
 *
 * Some tests genuinely need a real question rather than a hand-built one: the routes
 * resolve it through `getQuestionById`, so a synthetic id 404s there. Those are the
 * callers here. Everything that only needs *a question-shaped value* should build a
 * literal instead — `deadline.test.ts` and `scoring.test.ts` are the pattern.
 *
 * The miss is an explicit throw rather than a `!`, because the two failures need
 * different answers: "the quiz no longer has a scored text question" is a coverage gap
 * to close, and it should say so in the failure rather than surfacing as
 * `Cannot read properties of undefined`.
 */

type OfKind<K extends Question["kind"]> = Extract<Question, { kind: K }>;

export interface QuestionFilter {
  /** `true` for a question carrying points, `false` for one marked unscored (FR-017). */
  readonly scored?: boolean;
  /**
   * Restrict the search to one quiz, for a test that needs the question *and* the quiz
   * it belongs to — starting a session, say. Omit it and the whole registry is searched.
   */
  readonly quizId?: string;
}

function matches(
  question: Question,
  kind: string,
  filter: QuestionFilter,
): boolean {
  if (question.kind !== kind) return false;
  if (
    filter.scored !== undefined &&
    (question.points !== null) !== filter.scored
  )
    return false;
  return true;
}

/**
 * Every question of `kind` across the registry, in registry-then-authoring order,
 * possibly empty.
 */
export function questionsOfKind<K extends Question["kind"]>(
  kind: K,
  filter: QuestionFilter = {},
): ReadonlyArray<OfKind<K>> {
  return quizzes
    .filter((quiz) => filter.quizId === undefined || quiz.id === filter.quizId)
    .flatMap((quiz) => quiz.questions)
    .filter((question): question is OfKind<K> =>
      matches(question, kind, filter),
    );
}

/**
 * The first question of `kind`, or a failure naming what the registry would have to
 * gain for the test to run again.
 *
 * `definition.test.ts` asserts that the registry's *union* exercises every kind the
 * code supports, so this throwing means that assertion is failing too — this is the
 * second, more specific report of the same fact, at the call site that needed it.
 */
export function questionOfKind<K extends Question["kind"]>(
  kind: K,
  filter: QuestionFilter = {},
): OfKind<K> {
  const [first] = questionsOfKind(kind, filter);
  if (first === undefined) {
    const scoring =
      filter.scored === undefined
        ? ""
        : filter.scored
          ? " scored"
          : " unscored (points: null)";
    const scope =
      filter.quizId === undefined
        ? "The quiz registry has"
        : `Quiz "${filter.quizId}" has`;
    throw new Error(
      `${scope} no${scoring} "${kind}" question, so this test has nothing ` +
        `to run against. Tests derive their fixtures by kind rather than by id — add one ` +
        `to a definition in src/quiz/definitions/, or retire the coverage deliberately.`,
    );
  }
  return first;
}
