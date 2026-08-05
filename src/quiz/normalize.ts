/**
 * Answer normalization for free-text questions (PRD FR-011).
 *
 * Matching ignores letter case, surrounding and repeated whitespace, and Polish
 * diacritics — and deliberately nothing else. Misspellings are not tolerated:
 * a fuzzy threshold is something the host would have to defend out loud in
 * front of the room, so it is out of scope by decision, not by omission.
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

/** Folds a free-text answer to the form used for comparison. */
export function normalizePolish(value: string): string {
  return value
    .replace(/[łŁ]/g, (letter) => STROKE_LETTERS[letter] ?? letter)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}
