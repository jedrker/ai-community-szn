import { quizDefinitions } from "./definitions";
import { findDuplicates, quizSchema } from "./schema";

/**
 * The quiz registry as downstream slices consume it: parsed once, validated, typed.
 * No consumer should import `./definitions/*` directly — going through here is what
 * guarantees the invariants held, including the cross-quiz ones no single definition
 * can see.
 */

export type {
  MultipleChoiceQuestion,
  NumberQuestion,
  Question,
  Quiz,
  SingleChoiceQuestion,
  TextQuestion,
  WordCloudQuestion,
} from "./schema";
export { normalizeAnswer, normalizePolish } from "./normalize";

import type { Question, Quiz } from "./schema";

/**
 * Thrown when a committed quiz definition violates its own schema, or when the
 * registry as a whole violates a rule that spans quizzes.
 *
 * **`where` is the only "which file" signal an organizer gets from a failed build**, so
 * it names the offending definition rather than a fixed path. A registry-level failure
 * names the registry.
 */
export class InvalidQuizDefinitionError extends Error {
  constructor(where: string, problems: readonly string[]) {
    super(
      [
        `Definicja quizu jest nieprawidłowa (${where}):`,
        ...problems.map((problem) => `  - ${problem}`),
      ].join("\n"),
    );
    this.name = "InvalidQuizDefinitionError";
  }
}

/**
 * Where a failed parse points the reader.
 *
 * Derived from the raw literal's own `id` rather than from the registry index, because
 * the index is the one thing an organizer cannot see while looking at the file they
 * edited. A definition too malformed to carry a string id falls back to its position.
 */
function sourceOf(raw: unknown, index: number): string {
  const id = (raw as { id?: unknown })?.id;
  return typeof id === "string" && id.length > 0
    ? `src/quiz/definitions/${id}`
    : `src/quiz/definitions/ — quiz nr ${index + 1}`;
}

function parseOrThrow(raw: unknown, where: string): Quiz {
  const result = quizSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidQuizDefinitionError(
      where,
      result.error.issues.map((issue) => issue.message),
    );
  }
  return result.data;
}

function parseAll(): Quiz[] {
  return quizDefinitions.map((raw, index) =>
    parseOrThrow(raw, sourceOf(raw, index)),
  );
}

/**
 * The four things that are invisible to a per-quiz schema and dangerous at runtime.
 *
 * **Cross-quiz question-id uniqueness is the load-bearing one.** It is what lets
 * `getQuestionById` stay quiz-agnostic — and therefore what keeps the polled routes
 * (`participation.ts`, `words.ts`) from having to read the session to learn which quiz
 * a question belongs to. Two quizzes sharing a question id would make a session resolve
 * a question against the wrong quiz, silently, mid-segment. It is refused here so that
 * failure is a red build instead.
 *
 * Every message names both quizzes and the colliding value, in the same register as
 * `checkQuestion`'s: the reader is an organizer minutes before showtime.
 *
 * **Exported so the gate can be shown to fire.** A build gate whose only input is the
 * committed registry can only ever be observed passing, and a rule that has never been
 * seen to refuse anything is a rule nobody has checked — the failure
 * `portability.test.ts` and `boundary.test.ts` each carry fixtures against. Takes
 * already-parsed quizzes, so a fixture is a plain literal rather than a second registry.
 */
export function registryProblems(parsed: readonly Quiz[]): string[] {
  const problems: string[] = [];

  if (parsed.length === 0) {
    problems.push(
      "Rejestr quizów jest pusty — dodaj co najmniej jeden quiz w src/quiz/definitions/index.ts.",
    );
    return problems;
  }

  for (const id of findDuplicates(parsed.map((quiz) => quiz.id))) {
    problems.push(
      `Dwa quizy mają to samo id "${id}" — id trafia do adresu /quiz/<id>, więc musi być unikalne.`,
    );
  }

  for (const code of findDuplicates(parsed.map((quiz) => quiz.code))) {
    const sharing = parsed
      .filter((quiz) => quiz.code === code)
      .map((quiz) => `"${quiz.id}"`)
      .join(" i ");
    problems.push(
      `Kod dołączenia "${code}" jest użyty w dwóch quizach (${sharing}) — /q/${code} nie wiedziałby, dokąd prowadzi.`,
    );
  }

  const owner = new Map<string, string>();
  for (const quiz of parsed) {
    for (const question of quiz.questions) {
      const first = owner.get(question.id);
      if (first === undefined) {
        owner.set(question.id, quiz.id);
        continue;
      }
      // Only across quizzes: a duplicate *within* one quiz is already refused by
      // `quizSchema`, and reporting it twice would send the author looking for a second
      // problem that does not exist.
      if (first !== quiz.id) {
        problems.push(
          `Pytanie "${question.id}" występuje w dwóch quizach ("${first}" i "${quiz.id}") — ` +
            "id pytań muszą być unikalne w całym rejestrze, bo sesja rozwiązuje je bez znajomości quizu.",
        );
      }
    }
  }

  return problems;
}

function assertRegistryConsistent(parsed: readonly Quiz[]): void {
  const problems = registryProblems(parsed);
  if (problems.length > 0) {
    throw new InvalidQuizDefinitionError("src/quiz/definitions/", problems);
  }
}

/**
 * Every committed quiz, parsed once at module scope rather than per request, and in
 * registry order — which is the order the host's picker lists them in.
 *
 * A serverless function importing this pays the parse on cold start only, and cannot
 * fail here in practice, because the build gate rejects a bad registry before it
 * deploys.
 */
export const quizzes: readonly Quiz[] = (() => {
  const parsed = parseAll();
  assertRegistryConsistent(parsed);
  return parsed;
})();

/**
 * Entry point for the build-time gate in `astro.config.ts`. Importing this module
 * already parses and cross-checks (see `quizzes` above), so an invalid registry throws
 * at import — this exists to make the gate a visible, greppable call rather than an
 * invisible side effect of an import that looks unused.
 *
 * The name and the no-argument signature are load-bearing: `astro.config.ts` imports it
 * by name, and that call *is* the gate.
 */
export function assertQuizValid(): void {
  assertRegistryConsistent(parseAll());
}

/** One quiz by its slug, or `undefined` for a slug that is not in the registry. */
export function getQuizById(id: string): Quiz | undefined {
  return quizzes.find((quiz) => quiz.id === id);
}

/** One quiz by its four-digit join code, or `undefined` for an unknown code. */
export function getQuizByCode(code: string): Quiz | undefined {
  return quizzes.find((quiz) => quiz.code === code);
}

/**
 * Looks up a question by id, **across the whole registry**.
 *
 * Quiz-agnostic on purpose, and legal precisely because the gate above makes question
 * ids globally unique: the polled routes resolve a question without reading the session
 * to learn which quiz it belongs to, which is two billed Upstash commands per poll
 * rather than three, every ~2.5 s for a whole session.
 *
 * Returns `undefined` on a miss rather than throwing: a question id arriving from an
 * attendee's device is untrusted input, and nothing here may throw into a request path
 * (the `src/lib/slack.ts` posture).
 */
export function getQuestionById(id: string): Question | undefined {
  for (const quiz of quizzes) {
    const question = quiz.questions.find((candidate) => candidate.id === id);
    if (question !== undefined) return question;
  }
  return undefined;
}

/**
 * The quiz a question belongs to, or `undefined` for an unknown question id.
 *
 * The companion to `getQuestionById` for the callers that need the *owner* rather than
 * the question — advancing within a quiz, or opening a session against the quiz a test
 * fixture came from. Unambiguous for the same reason `getQuestionById` is quiz-agnostic.
 */
export function getQuizByQuestionId(id: string): Quiz | undefined {
  return quizzes.find((quiz) =>
    quiz.questions.some((question) => question.id === id),
  );
}
