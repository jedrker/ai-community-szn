import { describe, expect, it } from "vitest";

import { normalizePolish } from "./normalize";

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
});
