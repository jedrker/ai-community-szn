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
    // An ended session has `currentQuestionId: null`, exactly like the lobby — so
    // without this guard `nextQuestionId(null)` would return question 1 and advance
    // would REOPEN a quiz the host had closed, on a document already living on the
    // short ended lifetime. The two questionless phases mean opposite things and
    // must not share the lobby's transition.
    if (current.phase === "ended") return null;

    const next = nextQuestionId(current.currentQuestionId);
    if (next === null) return null;

    return {
      version: current.version + 1,
      phase: "question-open",
      currentQuestionId: next,
      startedAt: current.startedAt,
      updatedAt: now,
      // Carried, then overwritten with a freshly-read count by `applyHostAction` —
      // see the note there. Copying here is correct *because* of that overwrite; a
      // transition that tried to read the count itself would be the one out of step.
      playerCount: current.playerCount,
    };
  }, Date.now());

  return toResponse(outcome);
};
