import { z } from "zod";

import { MAX_TEXT_ANSWER_LENGTH } from "./scoring";

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
  /**
   * What the attendee typed for a free-text question (roadmap S-05), raw and
   * trimmed — not folded. The fold is a comparison artefact; showing it back at
   * reveal would confuse, and a scoring dispute on stage needs the real input.
   *
   * `null` for every other kind, which leave `optionIds` populated instead.
   *
   * **This is attendee-authored free text — the most identifying payload in the
   * store — and it must never reach `logSessionEvent`.** `LogFields` has no field
   * it fits, and that closure is the enforcement rather than this comment.
   *
   * `.max()` is deliberately not redundant with the route's refusal. The route's
   * bound is what produces a *visible* Polish message; this one is the backstop
   * `submitAnswer` already leans on ("the last point at which a record that breaks
   * its own shape can be stopped from becoming a stored value"). Without it a
   * future writer of this record bypasses the bound and the failure is silent.
   *
   * `.default(null)` is load-bearing: a session running when this ships holds
   * records written before the field existed, and `readOwnResult` parses what it
   * reads. Required, those records would fail `parseAnswerRecord`, come back
   * `null`, and report `answered: false` to a device that watched its answer land.
   */
  text: z.string().max(MAX_TEXT_ANSWER_LENGTH).nullable().default(null),
  /**
   * The parsed numeric guess for a number question (roadmap S-06), stored as a
   * number rather than as the raw string — the reveal shows it back, and a future
   * histogram or a stage dispute should read a value, not re-parse one.
   *
   * `null` for every other kind, exactly as `text` is.
   *
   * **`.finite()` matters here specifically.** This is the only field whose value
   * comes out of arithmetic on untrusted input, and `Infinity` serialises to `null`
   * through `JSON.stringify` — so without it a record could round-trip, parse
   * cleanly, and have silently lost the answer it was written to hold.
   *
   * `.default(null)` for the same mid-session-deploy reason `text` carries one.
   */
  value: z.number().finite().nullable().default(null),
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
