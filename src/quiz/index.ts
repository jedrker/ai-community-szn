import { quizDefinition } from "./definition";
import { quizSchema } from "./schema";

/**
 * The quiz as downstream slices consume it: parsed once, validated, typed.
 * No consumer should import `./definition` directly — going through here is what
 * guarantees the invariants held.
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
export { normalizePolish } from "./normalize";

import type { Question, Quiz } from "./schema";

/** Thrown when the committed quiz definition violates its own schema. */
export class InvalidQuizDefinitionError extends Error {
  constructor(problems: readonly string[]) {
    super(
      [
        "Definicja quizu jest nieprawidłowa (src/quiz/definition.ts):",
        ...problems.map((problem) => `  - ${problem}`),
      ].join("\n")
    );
    this.name = "InvalidQuizDefinitionError";
  }
}

function parseOrThrow(raw: unknown): Quiz {
  const result = quizSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidQuizDefinitionError(result.error.issues.map((issue) => issue.message));
  }
  return result.data;
}

/**
 * Parsed once at module scope, not per request. A serverless function importing
 * this pays the parse on cold start only — and cannot fail here in practice,
 * because the build gate rejects a bad definition before it deploys.
 */
export const quiz: Quiz = parseOrThrow(quizDefinition);

/**
 * Entry point for the build-time gate. Re-parses so the gate has an explicit
 * call site rather than relying on import side effects surviving bundling.
 */
export function assertQuizValid(): void {
  parseOrThrow(quizDefinition);
}

/**
 * Looks up a question by id. Returns `undefined` on a miss rather than throwing:
 * a question id arriving from an attendee's device is untrusted input, and
 * nothing here may throw into a request path (the `src/lib/slack.ts` posture).
 */
export function getQuestionById(id: string): Question | undefined {
  return quiz.questions.find((question) => question.id === id);
}
