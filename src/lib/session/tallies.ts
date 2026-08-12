/**
 * How the tallies hash is keyed (roadmap S-04, extended by S-08).
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
 *
 * **Three families now: `answered:`, `opt:` and `word:`.** The third is the only one
 * whose field count grows with the *room* rather than with the quiz — one field per
 * distinct word, so up to one per attendee — and the only one that is also read back as
 * a value, since the word cloud renders its field names. Both facts are why it has an
 * inverse below and the other two do not.
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

/** The prefix of the word family, spelled once so the field and its inverse agree. */
function wordPrefix(questionId: string): string {
  return `word:${questionId}:`;
}

/**
 * How many people wrote one word: `word:<questionId>:<foldedWord>` (roadmap S-08,
 * FR-012/FR-015).
 *
 * `foldedWord` comes from `foldWord` in `words.ts` and is the *displayed* form, so this
 * field name is the only place the cloud's content lives — there is no second copy to
 * disagree with it.
 *
 * Prefixed for the reasons `optionField` gives, and one more that is specific to this
 * family: it is unbounded in cardinality, so it is the family someone reading the hash by
 * hand most needs to be able to skip past.
 */
export function wordField(questionId: string, foldedWord: string): string {
  return `${wordPrefix(questionId)}${foldedWord}`;
}

/**
 * The word a field carries, or `null` if the field does not belong to this question's
 * word family. The inverse of `wordField`, and the only inverse in this module — the
 * read path has to reconstruct the cloud from field names, where the other two families
 * are read by name and never parsed.
 *
 * **A prefix strip, deliberately not `split(":")`.** `foldWord` removes only case and
 * whitespace, so a submitted word may contain a colon — and splitting would silently
 * truncate `time:zone` to `time`, merging it with any other word ending there. The
 * question id cannot contain a colon (`QUESTION_ID` in `src/quiz/schema.ts` rejects
 * anything but a lowercase slug), which is what makes the prefix unambiguous no matter
 * what the word is. The same reasoning `answerField` already rests on, and the same
 * failure mode: nothing throws, one chip is quietly wrong.
 */
export function wordFromField(questionId: string, field: string): string | null {
  const prefix = wordPrefix(questionId);
  if (!field.startsWith(prefix)) return null;

  const word = field.slice(prefix.length);
  return word.length === 0 ? null : word;
}
