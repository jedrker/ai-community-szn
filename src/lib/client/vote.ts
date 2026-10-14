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

/**
 * The phone's status label for a question — `Pytanie N z M`, or what changed at the
 * reveal. A vote carries no label while open, because the wordmark above already says
 * "Głosowanie" and a second copy right under it reads as a stutter; at the reveal it
 * says only what changed. `position` is `-1` for a question the projection does not
 * carry.
 */
export function questionLabelFor(
  question: PublicQuestion | undefined,
  position: number,
  total: number,
  revealed: boolean,
): string {
  if (question?.kind === "vote") return revealed ? "Wyniki" : "";
  const label =
    position === -1 ? "Pytanie" : `Pytanie ${position + 1} z ${total}`;
  return revealed ? `${label} — odpowiedź ujawniona` : label;
}

/**
 * What the phone says around a question's controls — the words that differ between a
 * vote and an answer, in one place rather than a kind test per sentence on the page.
 *
 * A vote is *cast*, not answered. Everything else keeps the quiz wording, including
 * FR-017's warm-up sentence, driven by `scored` from the projection and never inferred
 * from a zero award — the payloads are identical.
 */
export type AnswerCopy = {
  /** The submit button. */
  readonly submit: string;
  /** Under the controls after this device has submitted. */
  readonly lockedNote: string;
  /** Under the controls while this device may still submit. */
  readonly openNote: string;
};

export function answerCopyFor(question: PublicQuestion): AnswerCopy {
  if (question.kind === "vote") {
    return {
      submit: "Oddaj głos",
      lockedNote: "Głos oddany. Czekamy na wyniki…",
      openNote:
        "Głosowanie jest tajne. Wybierz jeden setup — głosu nie da się zmienić.",
    };
  }
  return {
    submit: "Wyślij odpowiedź",
    lockedNote: "Odpowiedź zapisana. Czekamy na prowadzącego…",
    openNote: question.scored
      ? question.kind === "multiple-choice"
        ? "Możesz wybrać kilka odpowiedzi. Liczy się też czas."
        : "Liczy się też czas — im szybciej, tym więcej punktów."
      : "To pytanie na rozgrzewkę — bez punktów.",
  };
}
