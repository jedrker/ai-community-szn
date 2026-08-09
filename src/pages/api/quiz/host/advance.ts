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
      // Cleared — and note this is the exact opposite of the line above it. The
      // count is copied because `applyHostAction` overwrites it; the revealed ids
      // are cleared *here* because nothing overwrites them, and a carried value
      // would publish the previous question's answer key alongside the new
      // question. See the field's note in `state.ts`.
      revealedOptionIds: null,
      // Cleared for the same reason and it is the sharper of the two: a carried
      // distribution would put the previous question's bars on the projector while
      // the new question is being answered — a running tally of what the room is
      // choosing, which is precisely what FR-005 was revised to keep off the screen.
      // The schema refuses a non-null value outside `question-revealed`, so this is
      // belt and braces; the null is written explicitly anyway, because a reader
      // scanning the three transitions should see all three fields in each of them.
      revealedDistribution: null,
    };
  }, Date.now());

  return toResponse(outcome);
};
