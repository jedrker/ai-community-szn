import type { PublicOption, PublicQuestion } from "../../quiz/public";

/**
 * What a revealed audience vote announces, shared by the projector and the phone so the
 * two say the same words at the same moment.
 *
 * `reveal.ts` publishes a vote's **podium** in `revealedOptionIds` — rank order, winner
 * first, `[]` when nobody voted. This turns that list into options and a headline.
 * Pure, with no DOM: the pages do the painting.
 */
export type VoteResult = {
  /** The podium as published: rank order, winner first. Empty when nobody voted. */
  readonly podium: readonly PublicOption[];
  /** `Wygrywa <winner>!`, or null when nobody voted. */
  readonly headline: string | null;
};

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

  const options = question.options ?? [];
  // Published order, not projection order: the server ranked them.
  const podium = revealedOptionIds.flatMap((id) => {
    const option = options.find((candidate) => candidate.id === id);
    return option ? [option] : [];
  });
  const winner = podium[0];

  return { podium, headline: winner ? `Wygrywa ${winner.text}!` : null };
}
