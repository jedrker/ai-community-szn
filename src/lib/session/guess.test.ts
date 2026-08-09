import { describe, expect, it } from "vitest";

import { MAX_GUESS_MAGNITUDE, parseGuess } from "./guess";

/**
 * The one parser for a typed numeric guess (roadmap S-06).
 *
 * The refusal set matters more than the acceptance set here: `lessons.md` rule 2 is
 * about an absent field taking the favourable path through a guard written for a
 * hostile one, and a bare `Number()` would score a device that sent nothing as having
 * guessed zero.
 */

describe("what a Polish attendee actually types", () => {
  it.each([
    ["a plain integer", "67", 67],
    ["a decimal point", "67.5", 67.5],
    ["a decimal comma — the Polish spelling", "67,5", 67.5],
    ["a space as a thousands separator", "10 000", 10000],
    ["a non-breaking space, as pl-PL itself emits", "10\u00A0000", 10000],
    ["a narrow non-breaking space", "10\u202F000", 10000],
    ["several groups", "1 234 567", 1234567],
    ["leading and trailing whitespace", "  67  ", 67],
    ["an explicit plus", "+67", 67],
    ["a negative guess — wrong, not malformed", "-12", -12],
    ["a leading decimal point", ".5", 0.5],
    ["a trailing decimal point", "67.", 67],
    ["zero", "0", 0],
  ])("parses %s", (_label, input, expected) => {
    expect(parseGuess(input)).toBe(expected);
  });

  it("reads a comma as a decimal separator, never as a thousands one", () => {
    // THE ONE THAT MATTERS on a Polish keypad: 675 would be a wildly wrong guess
    // recorded as though the attendee had typed it.
    expect(parseGuess("67,5")).toBe(67.5);
    expect(parseGuess("67,5")).not.toBe(675);
  });

  it("reads `10,000` as ten, the documented consequence of that rule", () => {
    // Accepted deliberately rather than guessed at: Polish groups thousands with a
    // space, and a parser that decided between the two readings would be a rule the
    // host could not state from the stage.
    expect(parseGuess("10,000")).toBe(10);
  });
});

describe("what it refuses", () => {
  it("refuses an absent field rather than reading it as zero", () => {
    // `lessons.md` rule 2. `Number(null)` is 0, and this is the shape of the bug that
    // rule was written about — asserted by the returned value, not by a status code.
    expect(parseGuess(null)).toBeNaN();
    expect(parseGuess(undefined)).toBeNaN();
  });

  it.each([
    ["an empty string", ""],
    ["whitespace only", "   "],
    ["a non-breaking space only", "\u00A0"],
    ["letters", "abc"],
    ["a trailing remainder", "67abc"],
    ["a leading remainder", "abc67"],
    ["a doubled sign", "--5"],
    ["a sign with no digits", "-"],
    ["the word Infinity", "Infinity"],
    ["the word NaN", "NaN"],
    ["exponent notation", "1e300"],
    ["a small exponent", "6e1"],
    ["two decimal separators", "1,2,3"],
    ["a mixed pair of separators", "1.2,3"],
    ["a hex literal", "0x10"],
    ["a bare decimal point", "."],
  ])("refuses %s", (_label, input) => {
    expect(parseGuess(input)).toBeNaN();
  });

  it.each([
    ["a number", 67],
    ["a boolean", true],
    ["an array", ["67"]],
    ["an object", {}],
    ["a File-like part", new Blob(["67"])],
  ])("refuses a non-string (%s)", (_label, input) => {
    // `form.get` returns `File | string | null`, so a multipart part reaches here.
    expect(parseGuess(input)).toBeNaN();
  });

  it("refuses a digit string too long to represent, rather than returning Infinity", () => {
    expect(parseGuess("9".repeat(400))).toBeNaN();
  });
});

describe("the magnitude bound", () => {
  it("is large enough for every drafted answer and then some", () => {
    // The route enforces it; this asserts the constant is not set somewhere a real
    // question could reach.
    expect(MAX_GUESS_MAGNITUDE).toBeGreaterThan(10_000);
  });

  it("parses values on either side of it — bounding is the route's job, not the parser's", () => {
    // Stated so the split is visible: the parser answers "is this a number", the route
    // answers "is this a number we will store".
    expect(parseGuess(String(MAX_GUESS_MAGNITUDE))).toBe(MAX_GUESS_MAGNITUDE);
    expect(parseGuess("9999999999999")).toBe(9_999_999_999_999);
  });
});
