import { describe, expect, it } from "vitest";

import { answeredField, optionField } from "./tallies";

/**
 * The two field names the write path and the read path must agree on (roadmap S-04).
 * Mirrors `answers.test.ts`.
 *
 * A disagreement here does not throw. It presents as a projector reporting that nobody
 * answered while a hundred people are looking at it.
 */

describe("the answered field name", () => {
  it("prefixes the question id", () => {
    expect(answeredField("llm-skrot")).toBe("answered:llm-skrot");
  });

  it("distinguishes two questions", () => {
    expect(answeredField("q1")).not.toBe(answeredField("q2"));
  });

  it("round-trips: the same input always produces the same field", () => {
    expect(answeredField("llm-skrot")).toBe(answeredField("llm-skrot"));
  });
});

describe("the option field name", () => {
  it("prefixes the question id and the option id", () => {
    expect(optionField("llm-skrot", "large-language-model")).toBe(
      "opt:llm-skrot:large-language-model"
    );
  });

  it("distinguishes two options on the same question", () => {
    expect(optionField("q", "a")).not.toBe(optionField("q", "b"));
  });

  it("distinguishes the same option id on two questions", () => {
    expect(optionField("q1", "a")).not.toBe(optionField("q2", "a"));
  });
});

describe("the two families cannot collide", () => {
  /**
   * The reason both names carry a prefix rather than being bare ids. Without them a
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

  it("keeps the two families distinguishable by prefix alone", () => {
    // What someone reading the hash by hand in the Upstash console relies on — the only
    // inspection tool this project has.
    expect(answeredField("q").startsWith("answered:")).toBe(true);
    expect(optionField("q", "a").startsWith("opt:")).toBe(true);
  });
});
