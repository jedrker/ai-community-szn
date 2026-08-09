import { describe, expect, it } from "vitest";

import { normalizeAnswer, normalizePolish } from "./normalize";

describe("normalizePolish", () => {
  it("lowercases", () => {
    expect(normalizePolish("Halucynacje")).toBe("halucynacje");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizePolish("  halucynacje  ")).toBe("halucynacje");
  });

  it("collapses repeated internal whitespace", () => {
    expect(normalizePolish("large   language\tmodel")).toBe("large language model");
  });

  it.each([
    ["żółć", "zolc"],
    ["ćma", "cma"],
    ["gęś", "ges"],
    ["źdźbło", "zdzblo"],
    ["ŁÓDŹ", "lodz"],
  ])("folds Polish diacritics: %s -> %s", (input, expected) => {
    expect(normalizePolish(input)).toBe(expected);
  });

  // The regression that motivated the stroke map. `ł` is atomic — it has no
  // combining-mark decomposition, so a bare NFD pass leaves it untouched.
  it.each([
    ["ł", "l"],
    ["Ł", "l"],
    ["łódź", "lodz"],
    ["Michał", "michal"],
    ["żółć łódź", "zolc lodz"],
  ])("folds the stroked ł that NFD alone misses: %s -> %s", (input, expected) => {
    expect(normalizePolish(input)).toBe(expected);
  });

  it("does not leave any ł behind in a mixed phrase", () => {
    expect(normalizePolish("Wesoła Łódka")).not.toMatch(/[łŁ]/);
  });

  it("treats the Q4 accepted variants as equal under folding", () => {
    expect(normalizePolish("  Halucynacje ")).toBe(normalizePolish("halucynacje"));
  });

  it("keeps distinct answers distinct — no misspelling tolerance", () => {
    expect(normalizePolish("halucynacje")).not.toBe(normalizePolish("halucynacja"));
    expect(normalizePolish("halucynacje")).not.toBe(normalizePolish("halucynacke"));
  });

  it("is idempotent", () => {
    const once = normalizePolish("  ŻÓŁTY   Łosoś ");
    expect(normalizePolish(once)).toBe(once);
  });

  /**
   * **This block is what keeps the two folds apart, and it is not decoration.**
   *
   * `normalizePolish` is the display-name claim key (`src/lib/session/players.ts`),
   * where `.` is a legal name character. If a later edit folds trailing punctuation
   * in here — the obvious "simplification" once `normalizeAnswer` exists — then
   * `"Ania."` and `"Ania"` become one claim, and mid-deploy the stored keys written
   * with the old fold stop colliding with the new one, putting two identical names
   * on the leaderboard. FR-008 exists to prevent exactly that.
   */
  describe("stays the name fold — punctuation survives", () => {
    it("keeps a trailing full stop", () => {
      expect(normalizePolish("Ania.")).toBe("ania.");
      expect(normalizePolish("Ania.")).not.toBe(normalizePolish("Ania"));
    });

    it("does not fold a name made only of punctuation to empty", () => {
      expect(normalizePolish("..")).toBe("..");
    });
  });
});

describe("normalizeAnswer", () => {
  it("folds everything normalizePolish does", () => {
    expect(normalizeAnswer("  ŻÓŁTY   Łosoś ")).toBe("zolty losos");
  });

  it.each([
    ["halucynacje.", "halucynacje"],
    ["halucynacje!", "halucynacje"],
    ["halucynacje?", "halucynacje"],
    ["halucynacje,", "halucynacje"],
    ["halucynacje;", "halucynacje"],
    ["halucynacje:", "halucynacje"],
  ])("strips a trailing terminator: %s -> %s", (input, expected) => {
    expect(normalizeAnswer(input)).toBe(expected);
  });

  it("strips repeated terminators", () => {
    expect(normalizeAnswer("halucynacje...")).toBe("halucynacje");
    expect(normalizeAnswer("halucynacje?!")).toBe("halucynacje");
  });

  it("strips a terminator followed by whitespace", () => {
    expect(normalizeAnswer("halucynacje.  ")).toBe("halucynacje");
    // The space *before* the terminator is the interesting one: the whitespace
    // collapse runs first, so this has to survive the strip and the re-trim.
    expect(normalizeAnswer("halucynacje .")).toBe("halucynacje");
  });

  it("preserves internal punctuation — a hyphen or apostrophe is content", () => {
    expect(normalizeAnswer("e-mail")).toBe("e-mail");
    expect(normalizeAnswer("d'Artagnan")).toBe("d'artagnan");
    expect(normalizeAnswer("GPT-4")).toBe("gpt-4");
  });

  it("folds a capitalised, punctuated answer onto the bare variant", () => {
    expect(normalizeAnswer("Halucynacje.")).toBe(normalizeAnswer("halucynacje"));
  });

  it("keeps distinct answers distinct — no misspelling tolerance", () => {
    expect(normalizeAnswer("halucynacje")).not.toBe(normalizeAnswer("halucynacja"));
    expect(normalizeAnswer("halucynacje")).not.toBe(normalizeAnswer("halucynajce"));
  });

  it("folds a punctuation-only answer to empty", () => {
    expect(normalizeAnswer("...")).toBe("");
    expect(normalizeAnswer("   ")).toBe("");
  });

  it("is idempotent", () => {
    const once = normalizeAnswer("  Halucynacje... ");
    expect(normalizeAnswer(once)).toBe(once);
  });

  it("differs from the name fold by exactly the trailing punctuation", () => {
    expect(normalizeAnswer("Ania.")).toBe("ania");
    expect(normalizePolish("Ania.")).toBe("ania.");
  });
});
