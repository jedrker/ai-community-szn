import type { APIRoute } from "astro";

import { readOwnResult } from "../../../lib/session/store";

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
 * **One deliberate exception: the `ended` phase serves the running total alone** — no
 * verdict, no award, no question id. `ENDED_TTL_SECONDS` exists precisely so a device
 * that reloads just after the host closes the segment still finds the final standings,
 * and a gate that refused everything in `ended` would keep those totals for ten
 * minutes with no way to read them. There is nothing left to leak once the segment is
 * over. **S-07's leaderboard inherits this gate and this exception** rather than
 * rediscovering them.
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
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
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

  // The closing exception: the total alone, with no verdict attached to it.
  if (state?.phase === "ended") {
    return json(200, { answered: false, correct: null, awarded: null, total: result.total });
  }

  // THE GATE. Both halves matter: the phase, and that it is *this* question being
  // revealed. Asking about question 3 while question 7 is revealed must not answer.
  if (state?.phase !== "question-revealed" || state.currentQuestionId !== questionId) {
    return json(409, { error: MESSAGES.notRevealed });
  }

  // A device that stayed silent. Normal, and reported as a 200 so the client can tell
  // it apart from the 503 above without inspecting a message.
  if (result.answer === null) {
    return json(200, { answered: false, correct: null, awarded: null, total: result.total });
  }

  return json(200, {
    answered: true,
    correct: result.answer.correct,
    awarded: result.answer.awarded,
    total: result.total,
  });
};
