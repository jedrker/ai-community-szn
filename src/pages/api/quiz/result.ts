import type { APIRoute } from "astro";

import { readOwnRank, readOwnResult } from "../../../lib/session/store";

/**
 * Gives one device its own result for one question (roadmap S-03, PRD FR-016).
 *
 * On demand — no `prerender` export, per the project's rendering convention.
 *
 * Separate from the reveal snapshot because the two halves of a result travel
 * differently. The correct option ids are quiz content and ride the broadcast every
 * device already receives; the verdict, the award and the running total are
 * per-player, and per-player data may not enter a published snapshot — Ably retains
 * one for ~120s irreducibly and `/api/quiz/token` is deliberately open. So each
 * device fetches its own.
 *
 * ## The phase gate is the reason this endpoint exists separately
 *
 * It returns a correctness verdict. Served while the question is still open, it is a
 * cheat sheet anyone can reach with one `curl` — answer, ask, and change your answer
 * before the reveal if the answer had not already been locked. It therefore refuses
 * anything but `question-revealed` **for the question being asked about**, and that
 * check reads the session document rather than trusting a parameter.
 *
 * **One deliberate exception: the `ended` phase serves the running total and the final
 * position** — no verdict, no award, no question id. `ENDED_TTL_SECONDS` exists precisely
 * so a device that reloads just after the host closes the segment still finds the final
 * standings, and a gate that refused everything in `ended` would keep those totals for ten
 * minutes with no way to read them. There is nothing left to leak once the segment is
 * over. **S-07's leaderboard inherits this gate and this exception** rather than
 * rediscovering them; **S-10 added the position** to what the exception serves, since the
 * total alone left everyone outside the top five with nothing to measure it against.
 *
 * `answered: false` is a normal outcome — a latecomer, or someone who did not tap in
 * time — and not a 404. A store failure is a 503, and the client must treat the two
 * differently: concluding from a blip that an answer was never recorded tells an
 * attendee they missed a question they watched themselves answer.
 *
 * ## Why this route emits no `logSessionEvent`, deliberately
 *
 * Every other route in the slice logs its accepted and rejected classes, so the silence
 * here should be read as a decision rather than an omission. This is the densest path in
 * the project — ~150 devices × 12 scored questions, all inside a second or two of each
 * reveal — and one line per fetch would put ~1,800 lines into a stream whose whole
 * purpose is that a host can grep it mid-segment and see what happened. The failures
 * that matter are already visible: a 503 prints its reason below, and a result that
 * never arrives shows up as the attendee's missing score line, not as a missing log.
 * If S-07 needs the fan-in observed, count it in the harness rather than here.
 */

/** Polish, because the attendee view renders these directly. */
const MESSAGES = {
  missing: "Brak danych urządzenia.",
  notRevealed: "Wynik będzie dostępny po pokazaniu odpowiedzi.",
  unconfigured: "Sesja nie jest skonfigurowana.",
  failed: "Nie udało się pobrać wyniku. Spróbuj ponownie.",
} as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: MESSAGES.missing });
  }

  const playerId = form.get("playerId");
  const questionId = form.get("questionId");

  if (typeof playerId !== "string" || playerId.length === 0) {
    return json(400, { error: MESSAGES.missing });
  }
  if (typeof questionId !== "string" || questionId.length === 0) {
    return json(400, { error: MESSAGES.missing });
  }

  const result = await readOwnResult(playerId, questionId);

  if (result.outcome === "unconfigured") {
    return json(503, { error: MESSAGES.unconfigured });
  }

  // 503, not 404 — "the store could not say" is not "you did not answer". The client
  // keeps the correct answer on screen and does not claim the attendee stayed silent.
  if (result.outcome === "failed") {
    // The reason, as `answer.ts` does — a bare "it failed" in a log stream a host is
    // tailing mid-segment says only that something is wrong, which they can already see
    // on 150 phones.
    console.error("Result read failed:", result.reason);
    return json(503, { error: MESSAGES.failed });
  }

  const state = result.state;

  /**
   * The closing exception: the total and the final position, with no verdict attached.
   *
   * **S-10 added the rank here** (FR-006). Until then this branch served the total alone —
   * the gap `leaderboard-contract.md` recorded as inherited — so everyone outside the
   * published top five left the room with a number and nothing to measure it against. The
   * rank comes from `readOwnRank`, i.e. from the same `rankOf` that numbered the rows on the
   * projector, which is what stops a tied attendee's phone contradicting the big screen.
   *
   * **A failed rank read degrades to `null` rather than 503, and that is a deliberate
   * divergence from the standings branch below.** There, a 503 is right: the beat is live,
   * the client shows a neutral line, and the host can show the board again. Here the segment
   * is over, there is no beat to retry into, and the total is still worth serving — refusing
   * the whole response over a missing position would take the attendee's score away with it.
   * `standingsPositionText` already renders an absent rank as a neutral line.
   *
   * Every verdict field stays null for the reason the standings branch's are: the questions
   * are closed and their results were served at their reveals.
   */
  if (state?.phase === "ended") {
    const own = await readOwnRank(playerId);

    if (own === null) {
      // Logged rather than surfaced — the attendee gets their total and one missing line.
      console.error("Rank read failed for player at the close");
    }

    return json(200, {
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
      // From the closing read when it answered, and from the document read otherwise. The
      // two agree; preferring `own.total` keeps the pair on this response consistent, so a
      // rank and a total that arrived together cannot describe different moments.
      total: own?.total ?? result.total,
      rank: own?.rank ?? null,
    });
  }

  /**
   * THE LEADERBOARD BRANCH (roadmap S-07, FR-014).
   *
   * What S-07 did with the gate this docstring said it would inherit: it took the phase
   * check and added a third case rather than standing up a second endpoint. A new route
   * would have been a second copy of this gate, and two gates on the paths that decide
   * what a device may learn and when is exactly the pair that drifts.
   *
   * **The `questionId` the caller sent is ignored here, deliberately.** A position is not
   * about a question — the one the standings phase carries is the question the room has
   * just been through, and an attendee asking "where am I?" is not asking about it. The
   * field stays required above because every caller has one and rejecting a formless
   * request is the cheaper contract, not because this branch needs it.
   *
   * Every verdict field is null. That is not tidiness: the question is closed, its result
   * was already served at the reveal, and a branch that answered `correct` here would be
   * serving a verdict outside the phase the gate exists to confine it to.
   *
   * One extra billed command on top of the read above, and it buys the rank from `rankOf`
   * — the same function that numbered the published board's rows, which is what stops a
   * tied attendee's phone contradicting the projector.
   */
  if (state?.phase === "standings") {
    const own = await readOwnRank(playerId);

    // "The store could not say" — never a rank of 0 or 1, which would be a claim about
    // where this attendee stands. The client shows the board and a neutral line.
    if (own === null) {
      console.error("Rank read failed for player during standings");
      return json(503, { error: MESSAGES.failed });
    }

    return json(200, {
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
      total: own.total,
      rank: own.rank,
    });
  }

  // THE GATE. Both halves matter: the phase, and that it is *this* question being
  // revealed. Asking about question 3 while question 7 is revealed must not answer.
  if (
    state?.phase !== "question-revealed" ||
    state.currentQuestionId !== questionId
  ) {
    return json(409, { error: MESSAGES.notRevealed });
  }

  // A device that stayed silent. Normal, and reported as a 200 so the client can tell
  // it apart from the 503 above without inspecting a message.
  if (result.answer === null) {
    return json(200, {
      answered: false,
      correct: null,
      awarded: null,
      text: null,
      value: null,
      total: result.total,
      rank: null,
    });
  }

  return json(200, {
    answered: true,
    correct: result.answer.correct,
    awarded: result.answer.awarded,
    /**
     * What this device typed, for a free-text question — `null` for every other kind
     * (roadmap S-05).
     *
     * Returned here rather than read from the view's memory because that memory does
     * not survive a reload, and an attendee who answered and then reloaded should still
     * see their own answer beside the accepted one at reveal.
     *
     * No new leak: this is the requesting player's own answer, protected by the same
     * phase gate that already protects `correct` and `awarded` above.
     */
    text: result.answer.text,
    /**
     * What this device guessed, for a number question — `null` for every other kind
     * (roadmap S-06), and returned for the same reason `text` is: the view's memory of
     * it does not survive a reload, and the reveal shows the guess beside the true
     * value.
     *
     * It also has to come from here rather than from the input's current contents,
     * because for this kind the panel's copy depends on both numbers — `correct` is
     * exact-hit-only and says nothing about a guess that scored 800.
     */
    value: result.answer.value,
    total: result.total,
    /**
     * Null on every branch but the standings one (roadmap S-07). Present here so the
     * client parses one response shape rather than two — a field the reveal path has no
     * use for costs nothing, while a second shape is a second thing to keep in step.
     */
    rank: null,
  });
};
