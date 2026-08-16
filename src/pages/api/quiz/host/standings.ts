import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { logSessionEvent } from "../../../../lib/session/log";
import { publishSnapshot } from "../../../../lib/session/realtime";
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

    /**
     * The question the room has just been through, which is what the rank arrows are
     * measured against (this change).
     *
     * Non-null by the guard above: `question-revealed` is the only phase this transition
     * is reachable from, and every phase but the lobby carries a question id. Passing the
     * *current* id rather than remembering the last board is the whole of the baseline —
     * `readStandings` reconstructs each player's previous total by subtracting this
     * question's award, so nothing has to be stored between beats.
     *
     * A re-tap cannot change what the arrows say: the branch below re-broadcasts the
     * document already in the store rather than reaching this transition at all.
     */
    const standings = await readStandings(current.currentQuestionId);

    if (standings === null) {
      readFailed = true;
      return null;
    }

    return {
      version: current.version + 1,
      phase: "standings",
      // Copied unchanged — session identity, not a transition payload. See the field's
      // note in `state.ts`.
      quizId: current.quizId,
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
    logSessionEvent("session.standings.failed", {
      reason: "standings read failed",
    });
    return toResponse({
      status: 503,
      body: { error: "Nie udało się odczytać rankingu. Spróbuj ponownie." },
    });
  }

  if (
    outcome.status === 200 &&
    "applied" in outcome.body &&
    outcome.body.applied === true
  ) {
    // Two counts, and deliberately nothing about who is on the board — see the event's note
    // in `log.ts`. `rowCount` is the one worth having: a board shorter than `STANDINGS_SIZE`
    // means the room was smaller than the board or records were dropped, and without it a
    // two-row beat and a five-row beat are the same line.
    logSessionEvent("session.standings.shown", {
      playerCount: outcome.body.state.playerCount,
      rowCount: outcome.body.state.standings?.rows.length ?? 0,
    });
  }

  if (
    outcome.status === 200 &&
    "applied" in outcome.body &&
    outcome.body.applied === false
  ) {
    const phase = outcome.body.state.phase;

    /**
     * **A re-tap while already in this phase RE-BROADCASTS rather than doing nothing**
     * (impl review F5).
     *
     * Without this, a failed publish left the beat unrecoverable while the host was being
     * told to retry. `applyHostAction` answers a committed-but-unbroadcast write with a 502
     * and "Powtórz akcję, aby rozgłosić go ponownie" — but the retry's transition sees the
     * session already in `standings` and returns `null`, which arrives here as a benign
     * no-op. The store held the board, the room was still looking at the previous reveal,
     * `reveal` 409'd, and the only way out was `advance`, which abandons the beat entirely.
     *
     * `reveal` has the same shape and does not do this, deliberately left alone: there the
     * answer key had already reached the room on the earlier publish, so a lost broadcast
     * costs a bar chart. Here the phase's whole content is the board that never went out.
     *
     * Safe in the ordinary double-tap case: a device drops a snapshot whose version it
     * already holds, which is the same property that makes the 502's retry advice sound.
     */
    if (phase === "standings" && outcome.body.state.standings !== null) {
      const republished = await publishSnapshot(outcome.body.state);

      if (republished.outcome !== "ok") {
        return toResponse({
          status: 502,
          body: {
            state: outcome.body.state,
            applied: true,
            error:
              "Ranking jest zapisany, ale nie dotarł do urządzeń. Kliknij ponownie, aby rozgłosić go jeszcze raz.",
          },
        });
      }

      /**
       * **Its own note, because `no-op` would be a false report of the branch above.**
       *
       * The transition returned `null`, so nothing in the store changed and `applied` stays
       * `false` — but a snapshot did go out to every device, which is the entire point of
       * this branch. Falling through with the generic note left the host panel saying "nic
       * do zrobienia (koniec pytań?). Stan bez zmian." at the exact moment the retry the 502
       * asked for had just succeeded, so the one interaction that fixes a lost broadcast
       * reported itself as the one that does nothing.
       *
       * `applied` deliberately stays `false`: no version was bumped and no transition
       * happened, and claiming otherwise would put the panel's vocabulary at odds with the
       * state it is looking at. The note is what carries the difference — which is what
       * notes are for.
       */
      return toResponse({
        status: 200,
        body: {
          state: outcome.body.state,
          applied: false,
          note: "republished",
        },
      });
    }

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
