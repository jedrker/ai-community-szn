/**
 * How the tallies hash is keyed (roadmap S-04).
 *
 * Mirrors `answers.ts`: a pure module with no store access, so the atomicity question
 * stays entirely in `store.ts` where the Lua lives. Unlike `answers.ts` there is no Zod
 * schema and no `zod` import — every value in this hash is an integer written by
 * `HINCRBY`, which cannot produce anything else, so there is no record shape to parse.
 *
 * This module exists for one reason: the write path and the read path must not be able
 * to disagree about a field name. A disagreement there does not throw — it presents as
 * a projector reporting that nobody answered, in front of the room, at the moment the
 * number matters.
 */

/**
 * How many people have answered a question: `answered:<questionId>`.
 *
 * A colon is unambiguous: question ids are lowercase slugs and `src/quiz/schema.ts`
 * rejects anything else, so the id cannot contain one — the same reasoning
 * `answerField` already relies on.
 */
export function answeredField(questionId: string): string {
  return `answered:${questionId}`;
}

/**
 * How many people chose one option: `opt:<questionId>:<optionId>`.
 *
 * **Prefixed rather than bare ids**, for two reasons. It keeps the two families
 * distinguishable to someone reading the hash by hand in the Upstash console, which is
 * the only inspection tool this project has. And it makes collision between them
 * structurally impossible rather than merely unlikely: without the prefixes, a question
 * id could in principle be spelled the same way as a `<questionId>:<optionId>` pair,
 * and the two counters would silently share a slot.
 */
export function optionField(questionId: string, optionId: string): string {
  return `opt:${questionId}:${optionId}`;
}
