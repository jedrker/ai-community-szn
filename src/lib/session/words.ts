/**
 * The word cloud's domain rule: what one word is, and what makes two of them the same
 * word (roadmap S-08, PRD FR-012/FR-015).
 *
 * The pure half of the mechanic. No store access, no `import.meta.env` and no route, so
 * the fold and the validation are unit-testable on their own — the split `players.ts`
 * holds for joining, `guess.ts` for numeric answers and `scoring.ts` for awarding.
 *
 * Nothing is imported from `zod` here and nothing needs to be: this module has no record
 * shape of its own. The folded word is a hash *field* (`tallies.ts` owns that format) and
 * the raw word travels on `AnswerRecord.text`, which already has a schema.
 */

/**
 * The longest word the system accepts.
 *
 * The same number and the same reasoning as `MAX_DISPLAY_NAME_LENGTH` in `players.ts`:
 * what fits a projected line at the type size the back of a venue room needs. It is a
 * domain bound rather than a route detail, which is why it lives here.
 *
 * **Three readers, and they must not drift**: the route's visible refusal
 * (`src/pages/api/quiz/answer.ts`), `answerRecordSchema`'s `.max()` on the word field,
 * and the input's `maxlength`. The third carries a plumbing constraint worth stating
 * here rather than only at the call site: `index.astro`'s `<script>` block may not
 * value-import from `src/lib/session/` (`src/lib/client/boundary.test.ts`), so this
 * reaches the input the way `MAX_TEXT_ANSWER_LENGTH` does — imported in frontmatter and
 * written straight into the markup.
 */
export const MAX_WORD_LENGTH = 24;

/**
 * How many words reach the projector.
 *
 * A **display** bound, not a cost one: the read is a single `HGETALL` whichever way this
 * goes, and 150 distinct words at a legible size do not fit a screen measured for the
 * back of a room. Two readers — the store's slice and the host panel's "N z M" line,
 * which is what keeps the truncation honest rather than silent.
 */
export const WORD_CLOUD_SIZE = 30;

/**
 * Polish letters, digits, and the marks that show up inside a real word.
 *
 * `players.ts`'s allowlist **minus the space**, because FR-012 asks for one word and
 * `validateWord` refuses whitespace outright. Deliberately permissive about *what* a
 * word says and strict about what it is made of: PRD §Non-Goals accepts unmoderated
 * content on the projector, so this is a layout and encoding guard, not a content
 * filter.
 *
 * Emoji are excluded as a side effect, and that is a real cost worth naming rather than
 * discovering: some attendees will type one and be refused. It buys a word that renders
 * predictably at projector scale on whatever the venue laptop happens to be — the same
 * trade `players.ts` takes for display names.
 */
const ALLOWED_CHARACTERS = /^[\p{L}\p{N}._'-]+$/u;

/** Polish, because the attendee view renders these directly. */
const MESSAGES = {
  empty: "Napisz jedno słowo.",
  whitespace: "Wpisz tylko jedno słowo — bez spacji.",
  tooLong: `Słowo może mieć najwyżej ${MAX_WORD_LENGTH} znaki.`,
  disallowed: "Słowo może zawierać tylko litery, cyfry i znaki . _ - '",
} as const;

/**
 * Folds a word to the form two attendees' answers are grouped by — **and displayed
 * as**.
 *
 * ## The third fold in this project, and the only one that keeps diacritics
 *
 * `src/quiz/normalize.ts` holds the other two and tabulates all three. The difference
 * that matters:
 *
 * | | folds diacritics | why |
 * | --- | --- | --- |
 * | `normalizePolish` | yes | the display-name claim key (FR-008) |
 * | `normalizeAnswer` | yes | answer matching (FR-011) |
 * | `foldWord` | **no** | the folded form is what the projector shows |
 *
 * For the other two the fold is invisible — a comparison artefact that decides a claim
 * or an award and is never rendered. Here the folded word *is* the chip on the big
 * screen, so folding diacritics would put `smieszne` on a Polish projector in front of
 * the room, which reads as a typo rather than as a normalisation.
 *
 * **The accepted cost, stated rather than discovered**: a word typed both with and
 * without its diacritics counts as two entries. That is cosmetic on an unscored
 * question — two smaller chips instead of one larger one — where the same slip in
 * `normalizeAnswer` would cost somebody points.
 *
 * Plain `toLowerCase()`, not `toLocaleLowerCase("pl")`. Polish has no locale-specific
 * case mapping (unlike Turkish, where `I` lowercases to a dotless `ı`), so the two agree
 * on every input this can see. Said here because the omission otherwise looks like one.
 *
 * The whitespace collapse is redundant against `validateWord`, which refuses internal
 * whitespace before this is ever called on a submission. Kept so the function is
 * idempotent and total on its own, rather than correct only for inputs its one current
 * caller has already checked.
 */
export function foldWord(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export type ValidatedWord =
  | { ok: true; word: string; key: string }
  | { ok: false; error: string };

/**
 * Checks one submitted word and returns both the form that is stored and the form it is
 * counted by.
 *
 * Mirrors `validateDisplayName`: two return shapes, Polish messages, and a `key` that is
 * the fold. `word` is what the attendee typed (trimmed) and what the reveal echoes back;
 * `key` is what the counter field is keyed by. They differ by case alone.
 *
 * **Whitespace is refused, never collapsed into an accepted answer.** FR-012 asks for
 * one word, and a refusal an attendee can read beats an accepted entry that quietly
 * became something other than what they typed. The check runs on the *trimmed* value, so
 * surrounding spaces are forgiven and internal ones are not.
 *
 * There is deliberately **no minimum length**. `players.ts` requires two characters so
 * that nobody has a display name they cannot find themselves by on a leaderboard; a word
 * carries no identity and nobody has to locate it, so that reasoning does not transfer
 * and a one-letter answer is refused by nothing.
 */
export function validateWord(raw: string): ValidatedWord {
  const word = raw.trim();

  if (word.length === 0) return { ok: false, error: MESSAGES.empty };
  if (/\s/.test(word)) return { ok: false, error: MESSAGES.whitespace };
  if (word.length > MAX_WORD_LENGTH) return { ok: false, error: MESSAGES.tooLong };
  if (!ALLOWED_CHARACTERS.test(word)) return { ok: false, error: MESSAGES.disallowed };

  const key = foldWord(word);

  // A word made only of characters the fold removes would be counted under an empty
  // field name, which every such answer would then silently share. Unreachable through
  // the allowlist above as it stands — the fold removes only case and whitespace — and
  // checked anyway, because the two rules are far enough apart in this file that a later
  // edit to either could open it. `players.ts` carries the same guard for the same
  // reason.
  if (key.length === 0) return { ok: false, error: MESSAGES.disallowed };

  return { ok: true, word, key };
}
