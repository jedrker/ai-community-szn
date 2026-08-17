import { quizzes } from "./index";
import type { Question, Quiz } from "./schema";

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

/**
 * The quiz a session fixture runs against, when the test does not care which one it is
 * (impl-review F3).
 *
 * **Why this exists rather than `quizzes[0]!` at the top of ten test files.** Most session
 * and route tests need *a* quiz and *a* real question id — the store never resolves an id,
 * and `parseSessionState` only requires that one exists — so which quiz they get is not
 * something any assertion in those files is about. Written as a positional index it looked
 * like it might be: "which quiz's question 0" is exactly the ambiguity `lessons.md`'s
 * positional-fixture rule is about, and it was repeated per file, so a registry
 * rearrangement was ten edits and ten chances to disagree.
 *
 * Now it is one decision, named, in the module that already owns fixture selection.
 *
 * **This is not an escape hatch from `questionOfKind`.** A test whose branch depends on a
 * question's *kind* must still take it by kind — the two functions answer different
 * questions, and a fixture built here for a kind-sensitive branch is the failure
 * `lessons.md` describes. Use this only where the id is an opaque session key.
 */
export function fixtureQuiz(): Quiz {
  const [first] = quizzes;
  if (first === undefined) {
    throw new Error(
      "The quiz registry is empty, so there is no quiz to build a fixture from. The " +
        "build gate refuses an empty registry, so reaching this means the gate was " +
        "bypassed — see assertQuizValid in src/quiz/index.ts.",
    );
  }
  return first;
}

/**
 * A real question id, for a fixture that needs one only as an **opaque session key**.
 *
 * Named for what the caller wants rather than for where it comes from: `someQuestionId()`
 * cannot be read as a claim about kind, position or content, which `quiz.questions[0]!.id`
 * could and sometimes was.
 */
export function someQuestionId(): string {
  const [first] = fixtureQuiz().questions;
  if (first === undefined) {
    throw new Error("The fixture quiz has no questions.");
  }
  return first.id;
}

/**
 * A second question id, distinct from `someQuestionId()`.
 *
 * For the fixtures whose whole point is that two ids differ — "a result for a question the
 * player did not answer", "the tally moved to another question". Distinctness is the
 * property; which two they are is not.
 */
export function anotherQuestionId(): string {
  const [, second] = fixtureQuiz().questions;
  if (second === undefined) {
    throw new Error(
      "The fixture quiz has fewer than two questions, so no fixture can distinguish one " +
        "question from another.",
    );
  }
  return second.id;
}
