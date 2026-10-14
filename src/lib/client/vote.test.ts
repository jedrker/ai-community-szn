import { describe, expect, it } from "vitest";

import { answerCopyFor, questionLabelFor, voteResultFor } from "./vote";
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

const scoredSingle: PublicQuestion = {
  id: "fixture-single",
  kind: "single-choice",
  prompt: "Ile?",
  scored: true,
  timeLimitSeconds: 30,
  options: [{ id: "fixture-a", text: "A" }],
};

describe("questionLabelFor", () => {
  it("numbers a quiz question, and says what changed at the reveal", () => {
    expect(questionLabelFor(scoredSingle, 2, 14, false)).toBe("Pytanie 3 z 14");
    expect(questionLabelFor(scoredSingle, 2, 14, true)).toBe(
      "Pytanie 3 z 14 — odpowiedź ujawniona",
    );
  });

  it("falls back to a bare label for a question the projection lacks", () => {
    expect(questionLabelFor(undefined, -1, 14, false)).toBe("Pytanie");
  });

  it("carries no label on an open vote and only the change at its reveal", () => {
    expect(questionLabelFor(vote, 0, 1, false)).toBe("");
    expect(questionLabelFor(vote, 0, 1, true)).toBe("Wyniki");
  });
});

describe("answerCopyFor", () => {
  it("casts a vote rather than answering", () => {
    expect(answerCopyFor(vote)).toEqual({
      submit: "Oddaj głos",
      lockedNote: "Głos oddany. Czekamy na wyniki…",
      openNote:
        "Głosowanie jest tajne. Wybierz jeden setup — głosu nie da się zmienić.",
    });
  });

  it("keys the warm-up sentence on scored, never on the award", () => {
    expect(answerCopyFor({ ...scoredSingle, scored: false }).openNote).toBe(
      "To pytanie na rozgrzewkę — bez punktów.",
    );
    expect(answerCopyFor(scoredSingle).openNote).toBe(
      "Liczy się też czas — im szybciej, tym więcej punktów.",
    );
    expect(
      answerCopyFor({ ...scoredSingle, kind: "multiple-choice" }).openNote,
    ).toBe("Możesz wybrać kilka odpowiedzi. Liczy się też czas.");
  });
});
