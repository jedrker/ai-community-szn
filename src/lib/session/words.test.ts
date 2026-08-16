import { describe, expect, it } from "vitest";

import { normalizeAnswer, normalizePolish } from "../../quiz/index";
import {
  foldWord,
  MAX_WORD_LENGTH,
  validateWord,
  WORD_CLOUD_SIZE,
} from "./words";

/**
 * The word-cloud domain rule (roadmap S-08, PRD FR-012/FR-015). Mirrors
 * `players.test.ts`: the fold, then every refusal.
 */

describe("foldWord", () => {
  it("lowercases, so one word is one entry however it was capitalised", () => {
    expect(foldWord("AI")).toBe("ai");
    expect(foldWord("Ai")).toBe(foldWord("ai"));
    expect(foldWord("HALUCYNACJA")).toBe(foldWord("halucynacja"));
  });

  it("trims surrounding whitespace", () => {
    expect(foldWord("  robot  ")).toBe("robot");
  });

  it("is idempotent", () => {
    const once = foldWord("  Halucynacja ");
    expect(foldWord(once)).toBe(once);
  });

  /**
   * Composes decomposed input (impl review F10), so `text` and `word` end up in the same form and
   * `answerRecordSchema`'s fold invariant can compare them exactly.
   */
  it("composes a decomposed diacritic to NFC", () => {
    /**
     * **Both forms are built from escapes, deliberately.** Typed literally, the decomposed and
     * composed strings are visually identical, so a failure would print a diff in which both
     * sides look the same — the trap CLAUDE.md records for `Intl`'s U+00A0 group separator,
     * arriving here through a different door.
     */
    const decomposed = "sa\u0328czek";
    const composed = "s\u0105czek";

    expect(decomposed).not.toBe(composed);
    expect(foldWord(decomposed)).toBe(composed);
  });

  /**
   * **The property that distinguishes this fold from the other two, and the reason it
   * exists at all.** The folded word is what the projector renders, so a stripped
   * diacritic is a misspelt Polish word on the big screen rather than an invisible
   * comparison artefact.
   */
  describe("keeps Polish diacritics — this fold is rendered, not just compared", () => {
    it.each([
      ["Żółw", "żółw"],
      ["ŚMIESZNE", "śmieszne"],
      ["Łódź", "łódź"],
      ["gęś", "gęś"],
    ])("%s -> %s", (input, expected) => {
      expect(foldWord(input)).toBe(expected);
    });

    it("leaves the stroked ł alone, unlike the two folds in src/quiz/normalize.ts", () => {
      expect(foldWord("Łosoś")).toMatch(/ł/);
    });
  });

  /**
   * THE TRIPWIRE (`lessons.md`: "Grep every caller before editing a shared pure
   * function").
   *
   * The tempting simplification is to delete this fold and call `normalizeAnswer`, which
   * looks equivalent and is not — it strips the diacritics this one is here to keep, and
   * the symptom is a projector rather than a failing assertion. These three cases fail
   * the moment the bodies converge.
   *
   * Stated in this file rather than in `normalize.test.ts` so the assertion sits beside
   * the function it guards; that file's docstring points here.
   */
  describe("stays distinct from the two folds in src/quiz/", () => {
    /**
     * **The fixture is `gęś` and deliberately NOT `żółw`, and that is the whole
     * substance of these two assertions.**
     *
     * Found by breaking the guard: replacing this fold's body with the NFD pass the
     * other two use turns `Żółw` into `zołw`, because `ł` is atomic and survives NFD —
     * the trap `normalize.ts` documents. So a divergence asserted on `żółw` still holds
     * against a fold that has lost every *other* diacritic, and the test passes while
     * the projector shows `zołw`. `gęś` has no stroked letter, so the naive break makes
     * all three folds coincide and both of these fail.
     *
     * `lessons.md`: naming a branch is not reaching it — prove the fixture discriminates.
     */
    const DIVERGES = "Gęś";

    it("differs from the answer fold on a diacritic-bearing word", () => {
      expect(foldWord(DIVERGES)).toBe("gęś");
      expect(normalizeAnswer(DIVERGES)).toBe("ges");
      expect(foldWord(DIVERGES)).not.toBe(normalizeAnswer(DIVERGES));
    });

    it("differs from the name fold on the same word", () => {
      expect(foldWord(DIVERGES)).not.toBe(normalizePolish(DIVERGES));
    });

    it("agrees with both on a word that carries no diacritic and no punctuation", () => {
      // The reason the divergence above has to be asserted on a diacritic: on plain
      // input all three folds coincide, so a test built on `robot` would pass against
      // any of them.
      expect(foldWord("Robot")).toBe(normalizeAnswer("Robot"));
      expect(foldWord("Robot")).toBe(normalizePolish("Robot"));
    });

    it("keeps trailing punctuation, which the answer fold strips", () => {
      expect(foldWord("robot.")).toBe("robot.");
      expect(normalizeAnswer("robot.")).toBe("robot");
    });
  });
});

describe("validateWord accepts one word", () => {
  it("returns the trimmed word and its fold", () => {
    const result = validateWord("  Halucynacja  ");
    expect(result).toEqual({
      ok: true,
      word: "Halucynacja",
      key: "halucynacja",
    });
  });

  it("keeps the typed form separate from the counted form", () => {
    const result = validateWord("SkyNet");
    if (!result.ok) throw new Error("expected the word to be accepted");
    // What the attendee sees echoed back, and what the counter groups by.
    expect(result.word).toBe("SkyNet");
    expect(result.key).toBe("skynet");
  });

  it.each([
    "robot",
    "GPT-4",
    "e-mail",
    "d'Artagnan",
    "sztuczna.inteligencja",
    "AI_2026",
    "ł",
  ])("accepts %s", (word) => {
    expect(validateWord(word).ok).toBe(true);
  });

  it("accepts a word of exactly the maximum length", () => {
    expect(validateWord("a".repeat(MAX_WORD_LENGTH)).ok).toBe(true);
  });

  it("has no minimum length — a word carries no identity to be found by", () => {
    // Unlike a display name, which `players.ts` requires two characters of.
    expect(validateWord("a").ok).toBe(true);
  });

  /**
   * **Decomposed Polish is accepted, not refused** (impl review F10). `ALLOWED_CHARACTERS` matches
   * `\p{L}` and `\p{N}` and deliberately not `\p{M}`, so before the NFC pass a pasted `sączek`
   * whose `ą` is `a` + U+0328 was told it may contain "only letters, digits and . _ - '" — about a
   * word that visibly is letters. Escapes rather than literals, for the reason the fold's own NFC
   * test gives.
   */
  it("accepts a decomposed diacritic and stores it composed", () => {
    const result = validateWord("sa\u0328czek");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.word).toBe("s\u0105czek");
    expect(result.key).toBe("s\u0105czek");
  });
});

describe("validateWord refuses, with a message rather than a silent repair", () => {
  /** Every refusal asserts the message, because the attendee view renders it directly. */
  function refusal(raw: string): string {
    const result = validateWord(raw);
    if (result.ok) throw new Error(`expected "${raw}" to be refused`);
    return result.error;
  }

  it("refuses an empty word", () => {
    expect(refusal("")).toBe("Napisz jedno słowo.");
  });

  it("refuses a whitespace-only word", () => {
    // Trimmed first, so this takes the empty path rather than the whitespace one.
    expect(refusal("   ")).toBe("Napisz jedno słowo.");
    expect(refusal("\t\n")).toBe("Napisz jedno słowo.");
  });

  /**
   * **Refused, never collapsed into an accepted entry.** FR-012 asks for one word, and
   * an answer quietly stored as something other than what was typed is worse than a
   * refusal the attendee can read and act on.
   */
  it.each(["sztuczna inteligencja", "a b", "robot\tzabawka", "dwa  slowa"])(
    "refuses internal whitespace: %s",
    (raw) => {
      expect(refusal(raw)).toBe("Wpisz tylko jedno słowo — bez spacji.");
    },
  );

  it("refuses a word one character over the bound", () => {
    expect(refusal("a".repeat(MAX_WORD_LENGTH + 1))).toBe(
      `Słowo może mieć najwyżej ${MAX_WORD_LENGTH} znaki.`,
    );
  });

  it("measures the bound on the trimmed word, not on what was typed", () => {
    // Surrounding spaces are forgiven; they must not push a legal word over the edge.
    expect(validateWord(`  ${"a".repeat(MAX_WORD_LENGTH)}  `).ok).toBe(true);
  });

  it.each(["🤖", "robot🤖", "słowo!", "a+b", "cena$", "<b>", "\\"])(
    "refuses a disallowed character: %s",
    (raw) => {
      expect(refusal(raw)).toBe(
        "Słowo może zawierać tylko litery, cyfry i znaki . _ - '",
      );
    },
  );

  /**
   * The refusal order is asserted rather than assumed: a two-word phrase containing a
   * disallowed character must report the whitespace, which is the thing the attendee has
   * to fix first and the only one of the two they will recognise.
   */
  it("reports whitespace before a disallowed character", () => {
    expect(refusal("robot 🤖")).toBe("Wpisz tylko jedno słowo — bez spacji.");
  });
});

describe("the display bounds", () => {
  it("bounds a word at the projected-line length players.ts uses", () => {
    expect(MAX_WORD_LENGTH).toBe(24);
  });

  it("bounds the cloud at a count that fits the screen", () => {
    expect(WORD_CLOUD_SIZE).toBe(30);
  });
});
