import type { PublicQuestion } from "../../quiz/public";

/**
 * What a revealed audience vote announces, shared by the projector and the phone so the
 * two say the same words at the same moment.
 *
 * `reveal.ts` publishes a vote's **winners** in `revealedOptionIds` — every candidate on
 * the top count, `[]` when nobody voted. This turns that list into names and a headline.
 * Pure, with no DOM: the pages do the painting.
 */
export type VoteResult = {
  /** The winners' option ids, in the question's projection order. Empty when nobody voted. */
  readonly winnerIds: readonly string[];
  /** The announcement, or null when nobody voted. */
  readonly headline: string | null;
};

const LIST = new Intl.ListFormat("pl", { style: "long", type: "conjunction" });

/**
 * The result of a revealed vote, or `null` when there is none to announce: the question
 * is not a vote, or it is not revealed (`revealedOptionIds === null`).
 *
 * Ids the question does not carry are dropped rather than trusted, so a stale snapshot
 * cannot name a candidate the page cannot show.
 */
export function voteResultFor(
  question: PublicQuestion | undefined,
  revealedOptionIds: readonly string[] | null,
): VoteResult | null {
  if (question?.kind !== "vote" || revealedOptionIds === null) return null;

  const winners = (question.options ?? []).filter((option) =>
    revealedOptionIds.includes(option.id),
  );
  const names = LIST.format(winners.map((option) => option.text));

  return {
    winnerIds: winners.map((option) => option.id),
    headline:
      winners.length === 0
        ? null
        : winners.length === 1
          ? `Wygrywa ${names}!`
          : `Remis! Wygrywają ${names}`,
  };
}
