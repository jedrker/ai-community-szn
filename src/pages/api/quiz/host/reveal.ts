import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";

/**
 * Reveals the current question's result.
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

    return {
      version: current.version + 1,
      phase: "question-revealed",
      currentQuestionId: current.currentQuestionId,
      startedAt: current.startedAt,
      updatedAt: now,
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
