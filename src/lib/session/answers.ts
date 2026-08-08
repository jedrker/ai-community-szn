import { z } from "zod";

/**
 * What the store holds per answer, and how the answers hash is keyed (roadmap S-03).
 *
 * Mirrors `players.ts`: a pure module with a Zod schema and no store access, so the
 * atomicity question stays entirely in `store.ts` where the Lua lives.
 *
 * `zod` is imported directly, not through `astro:content` — this module is read by a
 * serverless function and by `vitest`, and `astro:` specifiers resolve in neither.
 */

/**
 * One attendee's answer to one question, already scored.
 *
 * **No display name.** The players hash already owns the id → name mapping, and
 * duplicating a name here would put attendee data in a second place every purge has
 * to reach — the kind of copy that is remembered when it is written and forgotten
 * when a key is added.
 *
 * `correct` and `awarded` are stored rather than recomputed at read time, because the
 * speed weight depends on an elapsed time only the submission knew. Recomputing at
 * reveal would silently re-score every answer from whatever the clock said then.
 */
export const answerRecordSchema = z.object({
  playerId: z.string().min(1),
  questionId: z.string().min(1),
  optionIds: z.array(z.string()),
  /** The clamped elapsed time, in milliseconds, that produced `awarded`. */
  elapsedMs: z.number().int().nonnegative(),
  correct: z.boolean(),
  awarded: z.number().int().nonnegative(),
  /** Epoch milliseconds. */
  answeredAt: z.number().int().positive(),
});

export type AnswerRecord = z.infer<typeof answerRecordSchema>;

/**
 * The field name inside the answers hash (`ANSWERS_KEY`): `<questionId>:<playerId>`.
 *
 * One function rather than two template literals, so the read path and the write path
 * cannot disagree about the separator — a disagreement that would present as "the
 * attendee answered but the reveal says they did not".
 *
 * A colon is unambiguous here: question ids are lowercase slugs (`src/quiz/schema.ts`
 * rejects anything else) and player ids are v4 UUIDs, so neither side can contain one.
 *
 * One hash for every question rather than one key per question, because every
 * namespaced name must be a literal in `keys.ts` — a per-question key assembled at
 * runtime is reached by neither `end` nor `purge`.
 */
export function answerField(questionId: string, playerId: string): string {
  return `${questionId}:${playerId}`;
}

/** Parses a record read back from the store. Never throws, per `parsePlayerRecord`. */
export function parseAnswerRecord(raw: unknown): AnswerRecord | null {
  const result = answerRecordSchema.safeParse(raw);
  return result.success ? result.data : null;
}
