/**
 * How a typed numeric guess becomes a number (roadmap S-06, PRD FR-013).
 *
 * **This is the only parser, and it is server-side.** The client does not have one and
 * must not grow one: `boundary.test.ts` forbids `src/pages/quiz/*.astro`'s scripts from
 * value-importing `src/lib/session/`, so a shared parser would have to be duplicated
 * across the boundary, and two parsers that disagree is a scoring dispute on stage. The
 * attendee view only needs to decide whether to enable the submit button, which "does
 * this contain a digit" answers without parsing anything.
 *
 * Pure — no store, no env, no route — for the same reason `scoring.ts` is.
 */

/**
 * The largest magnitude a guess may have (roadmap S-06).
 *
 * A domain bound rather than a route detail, which is why it sits beside
 * `MAX_TEXT_ANSWER_LENGTH` in spirit: this endpoint is open, takes `formData`, and
 * `curl` ignores an input's attributes, so something has to stop an arbitrary number
 * from entering an arithmetic path whose result is stored as an integer.
 *
 * 1e12 is a judgement call — twelve digits is far beyond any plausible answer in a quiz
 * about a meetup, and comfortably inside the range where a double still represents
 * integers exactly.
 */
export const MAX_GUESS_MAGNITUDE = 1e12;

/**
 * How many characters the numeric input accepts, **derived from the bound above**.
 *
 * The text field beside it takes `MAX_TEXT_ANSWER_LENGTH` through frontmatter for
 * exactly this reason — a hand-picked `maxlength` drifts from the server bound, and the
 * drift shows up as an input that invites characters the route unconditionally refuses.
 * It reaches the markup the same way, imported in `index.astro`'s frontmatter, because
 * the `<script>` block may not value-import from `src/lib/session/`.
 *
 * The longest string the route can accept is the bound written with grouping, a sign
 * and a decimal part: `-1 000 000 000 000,00`.
 */
const MAX_GUESS_DIGITS = `${MAX_GUESS_MAGNITUDE}`.length;
export const MAX_GUESS_INPUT_LENGTH =
  MAX_GUESS_DIGITS + // the digits themselves
  Math.floor((MAX_GUESS_DIGITS - 1) / 3) + // one separator per thousands group
  1 + // a leading sign
  3; // a decimal separator and two decimals

/**
 * Characters a Polish attendee (or a paste from a formatted source) may use to group
 * thousands. U+00A0 is what `Intl.NumberFormat("pl-PL")` itself emits, so a value
 * copied off the projector round-trips.
 */
const GROUPING = /[\s\u00A0\u202F]/g;

/** The same characters, anchored, so surrounding whitespace can be trimmed first. */
const OUTER_WHITESPACE = /^[\s\u00A0\u202F]+|[\s\u00A0\u202F]+$/g;

/**
 * A number written with its thousands **grouped** \u2014 and the position is checked, not
 * just the characters.
 *
 * Stripping every space wherever it appeared was the earlier shape, and it turned
 * `"6 7"` into 67 and `"1 2 3"` into 123: a stray space on a phone keypad became a
 * silently different number, stored and scored with nothing on either screen to say a
 * transformation had happened. That is the coercion this module's own docstring
 * promises not to do. A separator is legal only between a leading 1\u20133 digit group and
 * further groups of exactly 3.
 */
const GROUPED = /^[+-]?\d{1,3}(?:[\s\u00A0\u202F]\d{3})+(?:[.,]\d+)?$/;

/** A number written without grouping: sign, digits, at most one decimal separator. */
const PLAIN = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/;

/**
 * Parses what a phone sent into a number, or `NaN` for "that was not a number".
 *
 * **Explicitly, never `Number()`** — `lessons.md` rule 2. `Number("")` and
 * `Number(null)` are both `0`, so a bare coercion would score a device that sent
 * nothing as having guessed zero, which is the exact shape of the `elapsedMs` bug that
 * rule was written about. An absent field, a non-string, an empty or whitespace-only
 * string, and anything with a non-numeric remainder are all refusals.
 *
 * A comma is the **decimal** separator, not a thousands one: `67,5` is 67.5 and never
 * 675. The consequence, accepted deliberately, is that `10,000` reads as ten — Polish
 * writes that grouping with a space, and guessing which meaning was intended would be
 * a rule the host could not state. Spaces are grouping and are simply removed.
 *
 * `NaN` is the sentinel rather than `null` so the caller's guard is the same
 * `Number.isFinite` check that already guards `elapsedMs` in the same route. It also
 * refuses `Infinity`, `1e300` and `NaN` as *inputs*: none of them is something a
 * numeric keypad produces, and the exponent form is not worth the ambiguity.
 */
export function parseGuess(raw: unknown): number {
  if (typeof raw !== "string") return Number.NaN;

  const trimmed = raw.replace(OUTER_WHITESPACE, "");
  if (trimmed.length === 0) return Number.NaN;

  // **Shape first, strip second.** Validating what is left after removing every space
  // would accept `"6 7"`, because by then it is indistinguishable from `"67"`.
  if (!GROUPED.test(trimmed) && !PLAIN.test(trimmed)) return Number.NaN;

  // Only the first comma is a decimal separator; the patterns above have already
  // refused anything carrying a second one, so this cannot silently drop a digit.
  const normalized = trimmed.replace(GROUPING, "").replace(",", ".");

  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}
