import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { logSessionEvent } from "../../../../lib/session/log";
import { readStandings } from "../../../../lib/session/store";

/**
 * Puts the leaderboard on the large screen (roadmap S-07, PRD FR-014).
 *
 * The beat FR-014 was revised during shaping to make host-controlled rather than
 * automatic: a board after each of fourteen questions lengthens a segment meant to run
 * short, so the host decides when the room sees one.
 *
 * ## Reachable only from a reveal
 *
 * Refused from `lobby` (nothing has been scored), from `question-open` (a leaderboard on
 * the projector while the room is still answering shows the state of a contest mid-move,
 * and it moves again while they watch), from `ended` (S-10 owns the closing sequence), and
 * from `standings` itself, where it is a no-op rather than an error — the same reading
 * `reveal.ts` takes of a re-reveal, and for the same reason: a host tapping twice on stage
 * has not done anything wrong.
 *
 * ## The board is built here, not in `applyHostAction`
 *
 * For the reason `reveal.ts` reads its tallies in its own transition: a read placed beside
 * `playerCount` would attach a board to *every* action, including the `advance` that opens
 * the next question, and publish it to 150 devices while that question is being answered.
 * The schema refuses that document — but the refusal would arrive as a 503 on stage rather
 * than as a design that could not produce it.
 *
 * ## A failed read refuses the transition
 *
 * **This is the one place the slice deliberately departs from `reveal.ts`**, which
 * publishes a `null` distribution and completes. There, the answer key is still on screen
 * and only a bar chart is missing; here the board *is* the phase, so completing would put
 * a blank screen in front of the room with nothing for the host to say about it. The room
 * stays on the reveal it is already showing, and the host can tap again.
 *
 * The state's `superRefine` clause is what makes that structural: a `standings` phase with
 * a null board does not parse, so this handler could not publish one even if it tried.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  /**
   * Set by the transition when the store could not answer, and read after it to turn the
   * resulting no-op into a 503 rather than a silent nothing. The closure cannot return an
   * error itself — `applyHostAction` speaks in states and nulls — so the distinction
   * between "there was nothing to do" and "the store failed" is carried out here.
   */
  let readFailed = false;

  const outcome = await applyHostAction(async (current, now) => {
    if (current.phase !== "question-revealed") return null;

    const standings = await readStandings();

    if (standings === null) {
      readFailed = true;
      return null;
    }

    return {
      version: current.version + 1,
      phase: "standings",
      // Carried, and load-bearing rather than incidental: it is what lets `advance` open
      // the *next* question from here instead of reopening question 1. See the phase's
      // note in `state.ts`.
      currentQuestionId: current.currentQuestionId,
      startedAt: current.startedAt,
      updatedAt: now,
      // Carried, then overwritten with a freshly-read count by `applyHostAction` — same
      // as every other transition.
      playerCount: current.playerCount,
      // Cleared. The reveal is over; carrying its answer key into the leaderboard beat
      // would leave the previous question's answer on screen beside the standings.
      revealedOptionIds: null,
      revealedDistribution: null,
      revealedAnswerText: null,
      /**
       * Set HERE, and only here. The field belongs to the same family as the three
       * nulled above it — part of a transition, not decoration on one — so every other
       * constructor nulls it and this one owns it.
       */
      standings,
    };
  }, Date.now());

  if (readFailed) {
    logSessionEvent("session.standings.failed", { reason: "standings read failed" });
    return toResponse({
      status: 503,
      body: { error: "Nie udało się odczytać rankingu. Spróbuj ponownie." },
    });
  }

  if (outcome.status === 200 && "applied" in outcome.body && outcome.body.applied === true) {
    // The size of the room, and deliberately nothing about who is on the board. See the
    // event's note in `log.ts` — there is no field a name or a total would fit in.
    logSessionEvent("session.standings.shown", { playerCount: outcome.body.state.playerCount });
  }

  if (outcome.status === 200 && "applied" in outcome.body && outcome.body.applied === false) {
    const phase = outcome.body.state.phase;

    // Already showing it. A no-op, and not worth an error — see the module note.
    if (phase !== "standings") {
      return toResponse({
        status: 409,
        body: {
          error:
            phase === "ended"
              ? "Sesja została zakończona — ranking jest już zamknięty."
              : "Ranking można pokazać dopiero po ujawnieniu odpowiedzi.",
        },
      });
    }
  }

  return toResponse(outcome);
};
