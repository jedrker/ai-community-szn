import { describe, expect, it } from "vitest";

import {
  answeredField,
  optionField,
  wordField,
  wordFromField,
} from "./tallies";

/**
 * The field names the write path and the read path must agree on (roadmap S-04, extended
 * by S-08). Mirrors `answers.test.ts`.
 *
 * A disagreement here does not throw. It presents as a projector reporting that nobody
 * answered while a hundred people are looking at it.
 */

describe("the answered field name", () => {
  it("prefixes the question id", () => {
    expect(answeredField("fixture-question")).toBe("answered:fixture-question");
  });

  it("distinguishes two questions", () => {
    expect(answeredField("q1")).not.toBe(answeredField("q2"));
  });

  it("round-trips: the same input always produces the same field", () => {
    expect(answeredField("fixture-question")).toBe(
      answeredField("fixture-question"),
    );
  });
});

describe("the option field name", () => {
  it("prefixes the question id and the option id", () => {
    expect(optionField("fixture-question", "fixture-option")).toBe(
      "opt:fixture-question:fixture-option",
    );
  });

  it("distinguishes two options on the same question", () => {
    expect(optionField("q", "a")).not.toBe(optionField("q", "b"));
  });

  it("distinguishes the same option id on two questions", () => {
    expect(optionField("q1", "a")).not.toBe(optionField("q2", "a"));
  });
});

describe("the word field name", () => {
  it("prefixes the question id and carries the folded word", () => {
    expect(wordField("fixture-word-cloud", "halucynacja")).toBe(
      "word:fixture-word-cloud:halucynacja",
    );
  });

  it("distinguishes two words on the same question", () => {
    expect(wordField("q", "robot")).not.toBe(wordField("q", "android"));
  });

  it("distinguishes the same word on two questions", () => {
    expect(wordField("q1", "robot")).not.toBe(wordField("q2", "robot"));
  });
});

describe("the word field's inverse", () => {
  it("recovers the word it was built from", () => {
    expect(wordFromField("q", wordField("q", "halucynacja"))).toBe(
      "halucynacja",
    );
  });

  it("recovers a word carrying Polish diacritics untouched", () => {
    // `foldWord` keeps them, so the field name carries them and this has to as well —
    // it is the string the projector renders.
    expect(wordFromField("q", wordField("q", "żółw"))).toBe("żółw");
  });

  /**
   * **The case that rules out `split(":")`.** `foldWord` removes only case and
   * whitespace, so a submitted word may contain a colon — and splitting on colons would
   * return `time`, merging this word with any other one ending there. Nothing throws;
   * one chip is quietly wrong.
   */
  it("recovers a word that itself contains a colon", () => {
    expect(wordFromField("q", wordField("q", "time:zone"))).toBe("time:zone");
    expect(wordFromField("q", "word:q:a:b:c")).toBe("a:b:c");
  });

  it("rejects a field belonging to another question", () => {
    expect(wordFromField("q1", wordField("q2", "robot"))).toBeNull();
  });

  it("rejects the other two families", () => {
    expect(wordFromField("q", answeredField("q"))).toBeNull();
    expect(wordFromField("q", optionField("q", "a"))).toBeNull();
  });

  it("rejects a field whose word is empty", () => {
    // Unreachable through `validateWord`, which refuses an empty word — and rejected
    // here anyway, because an empty chip on the projector has nothing to say.
    expect(wordFromField("q", "word:q:")).toBeNull();
  });

  it("rejects a question id that is a prefix of this one", () => {
    // `word:q:robot` must not read as a word of question `q2`, nor `word:q2:robot` as
    // one of `q` — the trailing colon in the prefix is what makes both true.
    expect(wordFromField("q2", wordField("q", "robot"))).toBeNull();
    expect(wordFromField("q", wordField("q2", "robot"))).toBeNull();
  });
});

describe("the three families cannot collide", () => {
  /**
   * The reason every name carries a prefix rather than being bare ids. Without them a
   * question id could in principle be spelled the same way as a `<question>:<option>`
   * pair, and the two counters would silently share one slot in the hash — an answered
   * count inflated by every vote for one option, with nothing on the wire to say so.
   *
   * Asserted over a deliberately adversarial pair: `answered:q:a` is the shape a bare
   * scheme would have produced for both.
   */
  it("never produces the same field for an answered counter and an option counter", () => {
    expect(answeredField("q:a")).not.toBe(optionField("q", "a"));
    expect(answeredField("opt:q:a")).not.toBe(optionField("q", "a"));
  });

  /**
   * The word family is the one that can be *fed* an adversarial value: option ids come
   * from the definition, but a word is whatever an attendee typed. So the collision test
   * that matters here is a word spelled to look like another family's field.
   */
  it("never produces the same field for a word counter and either counter family", () => {
    expect(wordField("q", "a")).not.toBe(optionField("q", "a"));
    expect(wordField("q", "a")).not.toBe(answeredField("q"));
    // A word that spells out another family's prefix still lands in its own.
    expect(wordField("q", "answered:q")).not.toBe(answeredField("q"));
    expect(wordField("q", "opt:q:a")).not.toBe(optionField("q", "a"));
  });

  it("keeps the three families distinguishable by prefix alone", () => {
    // What someone reading the hash by hand in the Upstash console relies on — the only
    // inspection tool this project has.
    expect(answeredField("q").startsWith("answered:")).toBe(true);
    expect(optionField("q", "a").startsWith("opt:")).toBe(true);
    expect(wordField("q", "robot").startsWith("word:")).toBe(true);
  });
});
