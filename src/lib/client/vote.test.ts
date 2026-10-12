import { describe, expect, it } from "vitest";

import { voteResultFor } from "./vote";
import type { PublicQuestion } from "../../quiz/public";

const vote: PublicQuestion = {
  id: "fixture-vote",
  kind: "vote",
  prompt: "Który setup był najlepszy?",
  scored: false,
  options: [
    { id: "fixture-ania", text: "Ania" },
    { id: "fixture-bartek", text: "Bartek" },
    { id: "fixture-celina", text: "Celina" },
  ],
};

describe("voteResultFor", () => {
  it("announces a single winner", () => {
    expect(voteResultFor(vote, ["fixture-ania"])).toEqual({
      winnerIds: ["fixture-ania"],
      headline: "Wygrywa Ania!",
    });
  });

  it("announces a tie with every winner, in the question's order", () => {
    // Given out of order: the list follows the projection, not the ids.
    expect(
      voteResultFor(vote, ["fixture-celina", "fixture-ania", "fixture-bartek"]),
    ).toEqual({
      winnerIds: ["fixture-ania", "fixture-bartek", "fixture-celina"],
      headline: "Remis! Wygrywają Ania, Bartek i Celina",
    });
  });

  it("announces nothing when nobody voted", () => {
    expect(voteResultFor(vote, [])).toEqual({ winnerIds: [], headline: null });
  });

  it("ignores an id the question does not carry", () => {
    expect(voteResultFor(vote, ["fixture-bartek", "fixture-nikt"])).toEqual({
      winnerIds: ["fixture-bartek"],
      headline: "Wygrywa Bartek!",
    });
  });

  it("has no result for a question that is not a vote", () => {
    expect(
      voteResultFor({ ...vote, kind: "single-choice", scored: true }, [
        "fixture-ania",
      ]),
    ).toBeNull();
  });

  it("has no result outside a reveal", () => {
    expect(voteResultFor(vote, null)).toBeNull();
  });
});
