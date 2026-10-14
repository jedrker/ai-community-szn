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
      podium: [{ id: "fixture-ania", text: "Ania" }],
      headline: "Wygrywa Ania!",
    });
  });

  it("keeps the published order and names the first as the winner", () => {
    // Given out of projection order: the server ranked them, the page does not re-sort.
    expect(voteResultFor(vote, ["fixture-celina", "fixture-ania"])).toEqual({
      podium: [
        { id: "fixture-celina", text: "Celina" },
        { id: "fixture-ania", text: "Ania" },
      ],
      headline: "Wygrywa Celina!",
    });
  });

  it("announces nothing when nobody voted", () => {
    expect(voteResultFor(vote, [])).toEqual({ podium: [], headline: null });
  });

  it("ignores an id the question does not carry", () => {
    expect(voteResultFor(vote, ["fixture-bartek", "fixture-nikt"])).toEqual({
      podium: [{ id: "fixture-bartek", text: "Bartek" }],
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
