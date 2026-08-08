import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { getQuestionById } from "../../../../quiz/index";

/**
 * Reveals the current question's result.
 *
 * **This is the one route that puts an answer key on the wire**, and it is allowed to
 * because the wire is the room and the question is over. The correct option ids ride
 * the snapshot every device already receives, so correctness lands on 150 phones
 * without 150 requests — and a phone whose own result fetch fails still sees the right
 * answer highlighted, which is what FR-016 is for.
 *
 * Rejects when no question is open — revealing from the lobby is meaningless, and
 * silently doing nothing would leave the host unsure whether the click landed.
 * Revealing an already-revealed question is a no-op rather than an error, for the
 * same reason `advance` is past the last question.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  const outcome = await applyHostAction((current, now) => {
    if (current.phase === "lobby" || current.phase === "ended") {
      // Signalled as a no-op with the unchanged state; the route below turns both
      // into an explicit rejection so the host gets told why. `ended` needs its own
      // mention: it carries no `currentQuestionId`, so falling through would build a
      // `question-revealed` state with a null question that the schema rejects — a
      // 503 where the honest answer is "the session is over".
      return null;
    }

    if (current.phase === "question-revealed") return null;

    const question = getQuestionById(current.currentQuestionId ?? "");

    return {
      version: current.version + 1,
      phase: "question-revealed",
      currentQuestionId: current.currentQuestionId,
      startedAt: current.startedAt,
      updatedAt: now,
      // Carried, then overwritten by `applyHostAction` — same as `advance.ts`.
      playerCount: current.playerCount,
      /**
       * Set HERE, and deliberately not in `applyHostAction` beside `playerCount`.
       * The two fields sit next to each other and behave oppositely: a stale count is
       * harmless, a stale answer key is the previous question's answer shown to the
       * room. This is the only transition that may set it; every other one nulls it.
       *
       * An empty array for a non-choice question and for an unscored one with no
       * correct ids — the client renders that as "nothing to highlight" rather than as
       * an error, which is what an unscored warm-up should look like. Text and number
       * questions get their own reveal in S-05/S-06.
       */
      revealedOptionIds:
        question && (question.kind === "single-choice" || question.kind === "multiple-choice")
          ? question.correctOptionIds
          : [],
    };
  }, Date.now());

  // Distinguish "nothing to reveal" from "already revealed": both are no-ops in
  // the store, but only the first is a mistake worth telling the host about.
  if (outcome.status === 200 && "applied" in outcome.body && outcome.body.applied === false) {
    if (outcome.body.state.phase === "lobby") {
      return toResponse({
        status: 409,
        body: { error: "Żadne pytanie nie jest otwarte — nie ma czego pokazać." },
      });
    }

    if (outcome.body.state.phase === "ended") {
      return toResponse({
        status: 409,
        body: { error: "Sesja została zakończona — nie ma czego pokazać." },
      });
    }
  }

  return toResponse(outcome);
};
