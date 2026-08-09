import { z } from "zod";
import { normalizeAnswer } from "./normalize";

/**
 * The quiz definition's shape and its domain invariants (PRD FR-001, FR-017).
 *
 * `zod` is imported directly rather than from `astro:content`: this module has
 * to parse in a bare `vitest run` and inside a serverless function, and
 * `astro:content` resolves in neither. See CLAUDE.md.
 *
 * Scoring lives elsewhere by design. `points` is the only scoring field here —
 * the speed weighting (FR-019) and the relative-error curve (FR-013) are global
 * rules owned by later slices, so this file stays a data contract.
 */

const QUESTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
    message: "correctValue musi być liczbą.",
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

  if (question.kind === "number" && !Number.isFinite(question.correctValue)) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: correctValue musi być skończoną liczbą.`,
    });
  }

  // FR-015 lets the word cloud's aggregate display live precisely because it has
  // no correct answer to leak. Scoring one would break that reasoning.
  if (question.kind === "word-cloud" && scored) {
    ctx.addIssue({
      code: "custom",
      message: `${where}: pytanie typu word-cloud musi być niepunktowane (points: null).`,
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
