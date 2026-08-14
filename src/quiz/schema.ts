import { z } from "zod";
import { normalizeAnswer } from "./normalize";

/**
 * The quiz definition's shape and its domain invariants (PRD FR-001, FR-017).
 *
 * `zod` is imported directly rather than from `astro:content`: this module has
 * to parse in a bare `vitest run` and inside a serverless function, and
 * `astro:content` resolves in neither. See CLAUDE.md.
 *
 * Scoring lives elsewhere by design. `points` is the only *scoring* field here —
 * the speed weighting (FR-019) and the relative-error curve (FR-013) are global
 * rules owned by later slices, so this file stays a data contract.
 *
 * **`timeLimitSeconds` (S-11) is the one field that looks like an exception and is
 * not.** It is pacing, not scoring: it decides how long a question accepts answers,
 * never what an answer is worth. Nothing here weighs anything, and the deadline
 * arithmetic it feeds lives in `src/lib/session/deadline.ts` for the same reason
 * `scoring.ts` is not in this directory.
 */

const QUESTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The authorable range for a question's time budget, in seconds (S-11).
 *
 * Bounds live here rather than beside the scoring rules because they constrain
 * *authoring* — the same job `QUESTION_ID` does. The floor keeps a typo of `1` from
 * shipping a question nobody in a 150-person room can physically answer; the ceiling
 * keeps a stray `1800` from producing a clock that outlives the segment.
 *
 * **A value below `SPEED_WINDOW_MS` (20 s) is deliberately legal.** On such a question
 * the speed weight can never reach its floor, so the reward spread compresses. That is
 * a real authoring tradeoff rather than an error, and refusing it here would be this
 * file deciding a scoring question it has no business deciding.
 */
export const MIN_TIME_LIMIT_SECONDS = 5;
export const MAX_TIME_LIMIT_SECONDS = 180;

const optionSchema = z.object({
  id: z.string().regex(QUESTION_ID, "option id must be a lowercase slug"),
  text: z.string().min(1, "option text must not be empty"),
});

/**
 * `points: null` is how FR-017's "mark a question as unscored" is expressed.
 * There is no separate boolean — one field, one source of truth.
 */
const baseFields = {
  id: z.string().regex(QUESTION_ID, "question id must be a lowercase slug"),
  prompt: z.string().min(1, "question prompt must not be empty"),
  points: z.number().positive().nullable(),
  /**
   * How long this question accepts answers, in seconds (S-11).
   *
   * **Optional in the shape, mandatory in the domain — and only for a scored
   * question.** `checkQuestion` requires it wherever `points !== null` and refuses it
   * wherever `points === null`, so the two states are "scored, with a clock" and
   * "unscored, host-paced", never anything in between. Expressed as an optional field
   * plus refinements rather than as a required one because a *missing* limit and an
   * *out-of-range* one deserve different messages, and both must name the question.
   *
   * The range is checked there too rather than with `.min()/.max()` here, for the
   * reason `correctValue` checks its finiteness there: a bare Zod bound reports
   * "too small" against a path, which names neither the question nor the fix.
   */
  timeLimitSeconds: z.number().int().positive().optional(),
};

const choiceFields = {
  ...baseFields,
  options: z.array(optionSchema),
  correctOptionIds: z.array(z.string()).default([]),
};

const singleChoiceSchema = z.object({ kind: z.literal("single-choice"), ...choiceFields });
const multipleChoiceSchema = z.object({ kind: z.literal("multiple-choice"), ...choiceFields });
const textSchema = z.object({
  kind: z.literal("text"),
  ...baseFields,
  /**
   * Every spelling that counts as correct, folded by `normalizeAnswer` before
   * comparison (FR-011).
   *
   * **The first entry is the one the room sees.** `reveal.ts` publishes
   * `acceptedAnswers[0]` as the accepted answer on every phone and the large screen,
   * so order is not arbitrary here — put the canonical form first and the variants
   * after it.
   */
  acceptedAnswers: z.array(z.string().min(1)),
});
const numberSchema = z.object({
  kind: z.literal("number"),
  ...baseFields,
  // Deliberately not `z.number()`: that rejects NaN and Infinity itself, before
  // the refinements below can run, and reports it as "expected number, received
  // number" — which names neither the question nor the problem. Checking only
  // the typeof here lets the question-level refinement own the message.
  correctValue: z.custom<number>((value) => typeof value === "number", {
    error: "correctValue musi być liczbą.",
  }),
});
const wordCloudSchema = z.object({ kind: z.literal("word-cloud"), ...baseFields });

const questionShapeSchema = z.discriminatedUnion("kind", [
  singleChoiceSchema,
  multipleChoiceSchema,
  textSchema,
  numberSchema,
  wordCloudSchema,
]);

type QuestionShape = z.infer<typeof questionShapeSchema>;

/**
 * Cross-field rules a flat schema cannot express. Each message names the
 * offending question id, because the reader is an organizer looking at a failed
 * build minutes before showtime, not a developer reading a stack trace.
 */
function checkQuestion(question: QuestionShape, ctx: z.RefinementCtx): void {
  const where = `Pytanie "${question.id}"`;
  const scored = question.points !== null;

  if (question.kind === "single-choice" || question.kind === "multiple-choice") {
    if (question.options.length < 2) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: pytanie wyboru musi mieć co najmniej 2 odpowiedzi (ma ${question.options.length}).`,
      });
    }

    const optionIds = question.options.map((option) => option.id);
    const duplicateOptionIds = findDuplicates(optionIds);
    if (duplicateOptionIds.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: zduplikowane id odpowiedzi: ${duplicateOptionIds.join(", ")}.`,
      });
    }

    const unknown = question.correctOptionIds.filter((id) => !optionIds.includes(id));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: correctOptionIds wskazuje na nieistniejące odpowiedzi: ${unknown.join(", ")}.`,
      });
    }

    if (scored && question.kind === "single-choice" && question.correctOptionIds.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: punktowane pytanie jednokrotnego wyboru musi mieć dokładnie 1 poprawną odpowiedź (ma ${question.correctOptionIds.length}).`,
      });
    }

    if (scored && question.kind === "multiple-choice" && question.correctOptionIds.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: punktowane pytanie wielokrotnego wyboru musi mieć co najmniej 1 poprawną odpowiedź.`,
      });
    }
  }

  if (question.kind === "text") {
    if (question.acceptedAnswers.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: pytanie tekstowe musi mieć co najmniej 1 akceptowaną odpowiedź.`,
      });
    }

    // A variant that folds onto another is dead weight the author meant to be
    // distinct — surfacing it is cheaper than wondering why it never matches.
    //
    // `normalizeAnswer`, the same fold that scores an answer at runtime. Using the
    // narrower `normalizePolish` here would let an author ship "halucynacje" and
    // "halucynacje." as two variants the schema accepts and the scorer treats as
    // one.
    const collapsed = findDuplicates(question.acceptedAnswers.map(normalizeAnswer));
    if (collapsed.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: akceptowane odpowiedzi sprowadzają się do tej samej wartości: ${collapsed.join(", ")}.`,
      });
    }
  }

  if (question.kind === "number") {
    if (!Number.isFinite(question.correctValue)) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: correctValue musi być skończoną liczbą.`,
      });
    }

    // FR-013 scores a guess by its *relative* error, so the true value is the
    // denominator — and there is no sensible reading of "within 5% of zero". Caught
    // here, at the build gate, rather than as a zero award nobody can explain on
    // stage. See `closeness` in `src/lib/session/scoring.ts`.
    if (question.correctValue === 0) {
      ctx.addIssue({
        code: "custom",
        message: `${where}: correctValue nie może wynosić 0 — punktacja liczbowa opiera się na błędzie względnym.`,
      });
    }
  }

  // FR-015 lets the word cloud's aggregate display live precisely because it has
  // no correct answer to leak. Scoring one would break that reasoning.
  if (question.kind === "word-cloud" && scored) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: pytanie typu word-cloud musi być niepunktowane (points: null).`,
    });
  }

  /**
   * The time budget, required exactly where it means something (S-11).
   *
   * Keyed on `scored` rather than on `kind` deliberately: the clock exists to bound
   * *answering for points*, so the rule follows `points`, and marking a question
   * unscored is enough to take its clock away. That also means these two clauses
   * cannot disagree with the word-cloud clause above — an unscored word cloud is
   * simply covered by the same branch as the unscored gather question.
   */
  if (scored && question.timeLimitSeconds === undefined) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: punktowane pytanie musi mieć timeLimitSeconds (limit czasu na odpowiedź).`,
    });
  }

  // Refused rather than ignored. A limit sitting on an unscored question would be a
  // number the author believes is enforced and nothing enforces — the word cloud fills
  // until the host reveals it, and that is the documented behaviour.
  if (!scored && question.timeLimitSeconds !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: niepunktowane pytanie nie może mieć timeLimitSeconds — jego tempo należy do hosta.`,
    });
  }

  if (
    question.timeLimitSeconds !== undefined &&
    (question.timeLimitSeconds < MIN_TIME_LIMIT_SECONDS ||
      question.timeLimitSeconds > MAX_TIME_LIMIT_SECONDS)
  ) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: timeLimitSeconds musi być w zakresie ${MIN_TIME_LIMIT_SECONDS}–${MAX_TIME_LIMIT_SECONDS} s (jest ${question.timeLimitSeconds}).`,
    });
  }
}

const questionSchema = questionShapeSchema.superRefine(checkQuestion);

export const quizSchema = z
  .object({
    questions: z.array(questionSchema).min(1, "Quiz musi mieć co najmniej 1 pytanie."),
  })
  .superRefine((quiz, ctx) => {
    const duplicateIds = findDuplicates(quiz.questions.map((question) => question.id));
    if (duplicateIds.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `Zduplikowane id pytań: ${duplicateIds.join(", ")}.`,
      });
    }
  });

function findDuplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}

export type Quiz = z.infer<typeof quizSchema>;
export type Question = Quiz["questions"][number];
export type SingleChoiceQuestion = Extract<Question, { kind: "single-choice" }>;
export type MultipleChoiceQuestion = Extract<Question, { kind: "multiple-choice" }>;
export type TextQuestion = Extract<Question, { kind: "text" }>;
export type NumberQuestion = Extract<Question, { kind: "number" }>;
export type WordCloudQuestion = Extract<Question, { kind: "word-cloud" }>;
