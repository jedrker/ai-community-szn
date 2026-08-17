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

    const next = nextQuestionId(current.quizId, current.currentQuestionId);

    /**
     * The session document and the quiz registry disagree — the session names a quiz
     * that is gone, or an open question belonging to another quiz, or it predates quiz
     * identity *and* sits in the lobby with no question to resolve from. The `quizId`
     * clause in `sessionStateSchema` makes the first two unreachable through a parsed
     * document; the third is the sentinel's one remaining dead end, and it is deliberate
     * (see `PRE_IDENTITY_QUIZ_ID`).
     *
     * Still a no-op on stage, because an error here would read as a fault in front of
     * the room and the host's way out is the same either way (`bun run quiz:reset`).
     * What changes is that it is no longer *silent*: the line below is the difference
     * between a host who taps twice and moves on, and an operator who can see why.
     */
    if (next.outcome === "unresolved") {
      console.error("Session advance unresolved:", next.reason);
      return null;
    }

    if (next.outcome === "end-of-quiz") return null;

    return {
      version: current.version + 1,
      phase: "question-open",
      /**
       * The quiz `nextQuestionId` resolved, not the stored value — and in every ordinary
       * case those are the same string. They differ in exactly one: a session written
       * before quizzes had identity carries the sentinel, and advancing it **heals** the
       * field to the identity its open question already implied.
       *
       * That is a repair, not a change of quiz: it only ever moves "no identity" to an
       * identity, never one real quiz to another. Advancing still moves *within* a quiz.
       * See the field's note in `state.ts`.
       */
      quizId: next.quizId,
      currentQuestionId: next.questionId,
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
      // And the free-text answer, for exactly the same reason — carried, it would put
      // the previous question's accepted answer on 150 phones while the new question
      // is open. Written explicitly so the reader sees all four here too.
      revealedAnswerText: null,
      // And the leaderboard (roadmap S-07). Carried, it would leave the previous beat's
      // board on 150 phones under a question they are being asked to answer. Note that
      // this transition is also the one that reads `currentQuestionId` from a standings
      // state — which is why that phase keeps one; see its note in `state.ts`.
      standings: null,
    };
  }, Date.now());

  return toResponse(outcome);
};
