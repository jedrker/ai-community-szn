import type { APIRoute } from "astro";

import { candidatesFor } from "../../../../lib/session/candidates";
import {
  applyHostAction,
  authorizeHost,
  extractRevealFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { logSessionEvent } from "../../../../lib/session/log";
import { readQuestionTallies } from "../../../../lib/session/store";
import { getQuestionById, type Question } from "../../../../quiz/index";

/**
 * How a number question's true value reads on a projector (roadmap S-06).
 *
 * **Formatted here, once, rather than per device.** That is a consequence of reusing
 * `revealedAnswerText` — the field is a string — and it is the right side of the trade
 * anyway: the host's screen and 150 phones must show the same characters, and a
 * per-device locale would let them disagree at the moment the room is comparing.
 *
 * `Intl.NumberFormat("pl-PL")` groups thousands with **U+00A0**, not an ordinary
 * space, on this project's Node (22.12, full ICU). A test that types the expected
 * string by hand fails with a diff in which both sides look identical — build the
 * expectation from this function instead.
 */
export function formatCorrectValue(value: number): string {
  return new Intl.NumberFormat("pl-PL").format(value);
}

/** What the room is told the answer was, for the kinds that have one to state. */
function revealedAnswerTextFor(question: Question | undefined): string | null {
  if (question?.kind === "text") return question.acceptedAnswers[0] ?? null;
  if (question?.kind === "number")
    return formatCorrectValue(question.correctValue);
  return null;
}

/** How many places the room is shown. */
const PODIUM_SIZE = 3;

/** Candidates with at least one vote, most votes first; equal counts keep the list's order (`sort` is stable). */
function voteRanking(
  optionIds: readonly string[],
  counts: Readonly<Record<string, number>>,
): string[] {
  return optionIds
    .filter((id) => (counts[id] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
}

/** The ids sharing the top count — two or more is a tie the host has to break. `[]` when nobody voted. */
function topTied(
  ranking: readonly string[],
  counts: Readonly<Record<string, number>>,
): string[] {
  const top = ranking[0];
  return top === undefined
    ? []
    : ranking.filter((id) => counts[id] === counts[top]);
}

/**
 * Reveals the current question's result.
 *
 * **This is the one route that puts an answer key on the wire**, and it is allowed to
 * because the wire is the room and the question is over. The correct option ids — and,
 * for a free-text question, the accepted answer itself — ride the snapshot every device
 * already receives, so correctness lands on 150 phones without 150 requests, and a phone
 * whose own result fetch fails still sees the right answer, which is what FR-016 is for.
 *
 * Rejects when no question is open — revealing from the lobby is meaningless, and
 * silently doing nothing would leave the host unsure whether the click landed.
 * Revealing an already-revealed question is a no-op rather than an error, for the
 * same reason `advance` is past the last question.
 */
export const POST: APIRoute = async ({ request }) => {
  const { secret, winner } = await extractRevealFields(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  /**
   * Set by the transition when a vote's tally could not be read, and read after it to
   * turn the resulting no-op into a 503 — the same carrier `standings.ts` uses, because
   * `applyHostAction` speaks in states and nulls.
   */
  let tallyFailed = false;
  /**
   * Set by the transition when the vote's top count is shared and `winner` did not
   * break it; read after it to turn the no-op into a 409 carrying the tied ids.
   */
  let voteTie: string[] | null = null;

  const outcome = await applyHostAction(async (current, now) => {
    if (current.phase === "lobby" || current.phase === "ended") {
      // Signalled as a no-op with the unchanged state; the route below turns both
      // into an explicit rejection so the host gets told why. `ended` needs its own
      // mention: it carries no `currentQuestionId`, so falling through would build a
      // `question-revealed` state with a null question that the schema rejects — a
      // 503 where the honest answer is "the session is over".
      return null;
    }

    if (current.phase === "question-revealed") return null;

    /**
     * Refused from the leaderboard beat (roadmap S-07).
     *
     * **Without this branch the fall-through is silent and looks correct.** A standings
     * state keeps its `currentQuestionId` — that is what stops `advance` reopening
     * question 1 — so it reaches the code below with everything needed to build a valid
     * `question-revealed` document, and the host who meant to move on re-reveals a
     * question the room has already finished with. Nothing rejects it; the schema is
     * satisfied and the snapshot publishes.
     *
     * A no-op here, turned into a 409 below, because the honest answer is that there is
     * nothing left to reveal: the question closed at the previous reveal, and the beat
     * after it is over too.
     */
    if (current.phase === "standings") return null;

    const question = getQuestionById(current.currentQuestionId ?? "");
    // The question's kind is read once, into the three facts the transition branches on.
    const isVote = question !== undefined && question.kind === "vote";
    const isChoice =
      question !== undefined &&
      (question.kind === "single-choice" ||
        question.kind === "multiple-choice");
    const tallied = isChoice || isVote;
    const optionIds = tallied
      ? candidatesFor(current, question).map((option) => option.id)
      : [];

    /**
     * The room's answers, read HERE and for the same reason `revealedOptionIds` is set
     * here (roadmap S-04, FR-005). Reading it in `applyHostAction` beside `playerCount`
     * would attach a distribution to every action — including the `advance` that opens
     * the next question, publishing the previous question's bars to 150 devices while
     * that question is being answered.
     *
     * **A failed read publishes `null`, never `{ answered: 0, options: {} }`.** The
     * reveal still succeeds: it is the beat that must not break, and `revealedOptionIds`
     * still marks the correct answer, so FR-016 is unaffected. But zeroes would render
     * as every bar empty, which on a projector reads as "nobody answered" — the strongest
     * possible wrong claim, at the moment the room is looking. `null` is the field's own
     * vocabulary for "there is nothing to show", and the view draws nothing.
     *
     * **The race is accepted and documented**: this read sits outside the version guard,
     * so an answer landing between it and the compare-and-set is counted in the hash but
     * not in the published distribution — at most a one-answer drift, at the instant the
     * question closes. The same asymmetry `playerCount` documents in `host.ts`: the
     * count needs no serialization, the version does.
     */
    const tallies = tallied
      ? await readQuestionTallies(current.currentQuestionId!, optionIds)
      : // For any other kind the read is skipped entirely — no submission for one can
        // exist today, and Phase 4 hides the panel for them. **This is the one place the
        // distribution and `revealedOptionIds` diverge**: that field yields `[]` here,
        // because "no options are correct" is a fact about the question, while "no
        // distribution" is an absence.
        null;

    /**
     * A vote departs from choice here. For a choice question the answer key is the
     * beat, so a failed read still reveals; for a vote the count *is* the beat, and the
     * podium is computed from it. Refusing keeps voting open and lets the host tap
     * again.
     */
    let revealedOptionIds: string[];
    if (isVote) {
      if (tallies === null) {
        tallyFailed = true;
        return null;
      }
      const counts = tallies.options;
      const ranking = voteRanking(optionIds, counts);
      const tied = topTied(ranking, counts);
      if (tied.length > 1) {
        // A pick that names a candidate no longer on the top count is a pick about a tally
        // that has moved (a late vote landed); refused again with the current tie.
        if (winner === null || !tied.includes(winner)) {
          voteTie = tied;
          return null;
        }
        revealedOptionIds = [
          winner,
          ...ranking.filter((id) => id !== winner),
        ].slice(0, PODIUM_SIZE);
      } else {
        // `winner` is ignored when there is nothing to break: the count decides.
        revealedOptionIds = ranking.slice(0, PODIUM_SIZE);
      }
    } else {
      revealedOptionIds = isChoice ? question.correctOptionIds : [];
    }

    return {
      version: current.version + 1,
      phase: "question-revealed",
      // Copied unchanged — session identity, not a transition payload. See the field's
      // note in `state.ts`.
      quizId: current.quizId,
      candidates: current.candidates,
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
       * questions get their own reveal in S-05/S-06. For a vote, the field carries the
       * **podium** in rank order, winner first: at most `PODIUM_SIZE` ids, only
       * candidates with at least one vote, none when nobody voted.
       */
      revealedOptionIds,
      // A vote's counts are deliberately kept off the wire: the room is shown places,
      // never figures.
      revealedDistribution: isVote ? null : tallies,
      /**
       * The free-text half of the same job (roadmap S-05, FR-016), set here for the
       * same reason and under the same rule as the two fields above.
       *
       * The **first** accepted variant, not all of them: `acceptedAnswers` exists so an
       * author can accept spellings and synonyms, but the room should see one answer.
       * A list reads as though several different answers were expected.
       *
       * A number question (roadmap S-06) formats its true value into this **same**
       * field rather than adding a third sibling to a family whose two existing
       * members already need a long docstring explaining that they behave oppositely.
       * It also means the large screen needs no change at all: the branch that renders
       * this field renders a number through it unaltered.
       *
       * `null` for every other kind — including choice, where `revealedOptionIds`
       * already carries the answer, and word-cloud, which has no correct answer to
       * carry (S-08).
       */
      revealedAnswerText: revealedAnswerTextFor(question),
      /**
       * Nulled here, unlike the fields above it, because this transition is not the one
       * that sets it (roadmap S-07). A reveal reached from a standings beat would
       * otherwise carry that board into `question-revealed`, where the schema refuses it —
       * but the refusal would be a 503 on stage rather than a null written here.
       */
      standings: null,
    };
  }, Date.now());

  // The session stays `question-open` while the host picks — nothing was written, so
  // phones can still vote; the pick request re-reads the tally and is validated
  // against it, so a late vote only yields a fresh 409 or a tally that needs no host.
  if (voteTie !== null) {
    return toResponse({
      status: 409,
      body: { error: "Remis — wskaż zwycięzcę.", tie: voteTie },
    });
  }

  if (tallyFailed) {
    logSessionEvent("session.vote.failed", {
      reason: "vote tally read failed — reveal refused",
    });
    return toResponse({
      status: 503,
      body: { error: "Nie udało się policzyć głosów. Spróbuj ponownie." },
    });
  }

  // Distinguish "nothing to reveal" from "already revealed": both are no-ops in
  // the store, but only the first is a mistake worth telling the host about.
  if (
    outcome.status === 200 &&
    "applied" in outcome.body &&
    outcome.body.applied === false
  ) {
    if (outcome.body.state.phase === "lobby") {
      return toResponse({
        status: 409,
        body: {
          error: "Żadne pytanie nie jest otwarte — nie ma czego pokazać.",
        },
      });
    }

    if (outcome.body.state.phase === "standings") {
      return toResponse({
        status: 409,
        body: {
          error: "Ranking jest już pokazany — przejdź do następnego pytania.",
        },
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
