/**
 * The two folds in this file (PRD FR-011, FR-008) — and a pointer to the third,
 * which is deliberately not here.
 *
 * **The two below are two on purpose, and merging them back into one would be a
 * bug with no visible symptom until a live session.** They differ by exactly one
 * rule — trailing sentence punctuation — and they have different jobs:
 *
 * | | `normalizePolish` | `normalizeAnswer` |
 * | --- | --- | --- |
 * | Folds | case, whitespace, diacritics | the same, plus trailing punctuation |
 * | Used by | the display-name claim key (`src/lib/session/players.ts`) | answer matching + the authoring-collision check |
 * | Owns | FR-008 name uniqueness | FR-011 answer matching |
 *
 * Neither fold tolerates misspellings. A fuzzy threshold is something the host
 * would have to defend out loud in front of the room, so it is out of scope by
 * decision, not by omission.
 *
 * ## S-08 added a third fold, elsewhere. Both halves of that sentence matter
 *
 * `foldWord` in **`src/lib/session/words.ts`** groups word-cloud submissions
 * (FR-012/FR-015). It folds case and whitespace and **keeps diacritics**, because
 * unlike the two above its output is *rendered*: the folded word is the chip on the
 * projector, and folding `ó` away would put a misspelt Polish word on the big screen
 * in front of the room. See that function for the accepted cost.
 *
 * It was added **beside** these two, not by widening either — `lessons.md` has an
 * entry about exactly that mistake, made against `normalizePolish` during S-05. Both
 * functions here are unchanged, and the tests below still pin them. The tripwire for
 * the third fold lives in `src/lib/session/words.test.ts`, next to the function it
 * guards.
 *
 * It lives outside `src/quiz/` because it is a session-aggregation rule rather than a
 * rule about the quiz definition — the same reasoning that keeps `scoring.ts` out of
 * this directory (CLAUDE.md). This file stays part of the data contract.
 */

/**
 * Polish letters whose diacritic is a stroke rather than a combining mark.
 *
 * These are the reason a bare NFD pass is not enough. `ó ż ź ć ń ś ą ę` all
 * decompose into a base letter plus a combining mark that `\p{Diacritic}`
 * removes, but `ł` is an atomic codepoint with no decomposition — it survives
 * NFD untouched. Without this map, "żółć łódź" folds to "zołc łodz".
 */
const STROKE_LETTERS: Record<string, string> = {
  ł: "l",
  Ł: "L",
};

/**
 * Folds case, whitespace and Polish diacritics. Punctuation survives.
 *
 * **This is the display-name claim key** (`src/lib/session/players.ts`), which is
 * what makes the surviving punctuation load-bearing rather than incidental. `.` is
 * a legal name character there, so folding it away here would:
 *
 * - merge `"Ania."` and `"Ania"` into one claim, refusing one of two attendees who
 *   can both join today;
 * - fold `".."` — a valid name — to empty, tripping that module's empty-key guard;
 * - and worst, only during a deploy: `livequiz:players` is keyed by the folded name
 *   and was written with the *old* fold, so a post-deploy `"Ania"` would find no
 *   collision with a pre-deploy `"Ania."` and both would sit on the leaderboard
 *   looking identical. FR-008 exists to prevent exactly that.
 *
 * Answer matching wants punctuation folded, and that is `normalizeAnswer` below.
 */
export function normalizePolish(value: string): string {
  return value
    .replace(/[łŁ]/g, (letter) => STROKE_LETTERS[letter] ?? letter)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Sentence terminators folded from the end of an answer, repeats included.
 *
 * Only at the end, and only for answers. An attendee whose phone keyboard appended
 * a full stop, or who answered in sentence form, should not lose a correct answer
 * to it. Internal punctuation is content — a hyphen or apostrophe inside a word is
 * part of the answer, and a future question whose accepted variant contains one has
 * to stay authorable.
 */
const TRAILING_PUNCTUATION = /[.!?,;:]+$/;

/**
 * Folds a free-text answer to the form used for comparison (FR-011).
 *
 * `normalizePolish` first, then the trailing strip — so the whitespace collapse and
 * trim have already run and `"halucynacje ."` folds the same as `"halucynacje."`.
 *
 * **The same function scores an answer at runtime and rejects colliding accepted
 * variants at build time** (`src/quiz/schema.ts`). That is deliberate: if the two
 * ever folded differently, an author could ship two variants the schema accepts and
 * the scorer treats as one.
 */
export function normalizeAnswer(value: string): string {
  return normalizePolish(value).replace(TRAILING_PUNCTUATION, "").trim();
}
