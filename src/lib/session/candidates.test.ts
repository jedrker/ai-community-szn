import { describe, expect, it } from "vitest";

import {
  candidateListSchema,
  candidatesFor,
  MAX_CANDIDATE_TEXT_LENGTH,
  MAX_CANDIDATES,
  MIN_CANDIDATES,
} from "./candidates";

/** `n` candidates with fixture ids — no committed option id is named here. */
function listOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `fixture-k-${i + 1}`,
    text: `Kandydat ${i + 1}`,
  }));
}

function firstMessage(input: unknown): string | undefined {
  return candidateListSchema.safeParse(input).error?.issues[0]?.message;
}

describe("candidateListSchema", () => {
  it("accepts the smallest and the largest legal list, trimming names", () => {
    const smallest = candidateListSchema.safeParse([
      { id: "fixture-a", text: "  Ala  " },
      { id: "fixture-b", text: "Ola" },
    ]);
    expect(smallest.success).toBe(true);
    expect(smallest.data?.[0]?.text).toBe("Ala");

    expect(candidateListSchema.safeParse(listOf(MAX_CANDIDATES)).success).toBe(
      true,
    );
  });

  it("refuses a list outside the size bounds with the host's message", () => {
    const message = `Lista musi mieć od ${MIN_CANDIDATES} do ${MAX_CANDIDATES} uczestników.`;
    expect(firstMessage(listOf(MIN_CANDIDATES - 1))).toBe(message);
    expect(firstMessage(listOf(MAX_CANDIDATES + 1))).toBe(message);
  });

  it("refuses an empty name, even one made of spaces", () => {
    expect(firstMessage([{ id: "fixture-a", text: "   " }, ...listOf(1)])).toBe(
      "Nazwa uczestnika nie może być pusta.",
    );
  });

  it("refuses a name past the projector's length", () => {
    expect(
      firstMessage([
        { id: "fixture-a", text: "x".repeat(MAX_CANDIDATE_TEXT_LENGTH + 1) },
        ...listOf(1),
      ]),
    ).toBe(`Nazwa uczestnika ma najwyżej ${MAX_CANDIDATE_TEXT_LENGTH} znaków.`);
  });

  it("refuses an id that is not a slug", () => {
    expect(firstMessage([{ id: "Fixture A", text: "Ala" }, ...listOf(1)])).toBe(
      "Nieprawidłowy identyfikator uczestnika.",
    );
  });

  it("refuses two rows sharing an id", () => {
    expect(
      firstMessage([
        { id: "fixture-a", text: "Ala" },
        { id: "fixture-a", text: "Ola" },
      ]),
    ).toBe("Dwa wiersze mają ten sam identyfikator.");
  });

  /**
   * Folded with `normalizePolish`, the display-name fold: two names the room would read
   * as the same candidate are the same candidate, diacritics and case aside.
   */
  it("refuses two names equal under the Polish fold", () => {
    expect(
      firstMessage([
        { id: "fixture-a", text: "Żółw" },
        { id: "fixture-b", text: "zolw" },
      ]),
    ).toBe("Dwóch uczestników ma tę samą nazwę.");
  });
});

describe("candidatesFor", () => {
  const question = { id: "fixture-vote", options: listOf(4) };

  it("returns the session's list when the host set one", () => {
    const list = listOf(2);
    expect(
      candidatesFor({ candidates: { "fixture-vote": list } }, question),
    ).toBe(list);
  });

  it("falls back to the committed options when the session set none", () => {
    expect(
      candidatesFor({ candidates: { "fixture-other": listOf(2) } }, question),
    ).toBe(question.options);
  });
});
