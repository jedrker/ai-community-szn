import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { nextQuestionId } from "../../../../lib/session/state";

/**
 * Advances to the next question.
 *
 * From the lobby this opens question 1 (see `start.ts` for why the lobby is a
 * phase rather than an absence of one). Past the last question it is a no-op
 * rather than an error — a host tapping advance once more at the end of the quiz
 * has not done anything wrong, and an error on stage would read as a fault.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  const outcome = await applyHostAction((current, now) => {
    const next = nextQuestionId(current.currentQuestionId);
    if (next === null) return null;

    return {
      version: current.version + 1,
      phase: "question-open",
      currentQuestionId: next,
      startedAt: current.startedAt,
      updatedAt: now,
    };
  }, Date.now());

  return toResponse(outcome);
};
