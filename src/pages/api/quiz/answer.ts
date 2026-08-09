import type { APIRoute } from "astro";

import { logSessionEvent } from "../../../lib/session/log";
import { clampElapsed, scoreChoiceAnswer } from "../../../lib/session/scoring";
import { readSession, submitAnswer } from "../../../lib/session/store";
import { getQuestionById } from "../../../quiz/index";

/**
 * Submits one attendee's answer to the open question (roadmap S-03, PRD FR-004/FR-010).
 *
 * On demand — no `prerender` export, per the project's rendering convention.
 *
 * **Deliberately open, with no host secret**, on the same reasoning as `/api/quiz/join`
 * and `/api/quiz/token`: the room is trusted for the length of one session, there are
 * no accounts, and an IP-keyed throttle was rejected because a venue network puts many
 * attendees behind one address. That reasoning was formed when the whole room cost ~8
 * store commands; this route bills **11** per call for a single-choice answer (a
 * `readSession` plus a 10-command `EVAL`), plus one more for each additional option a
 * multiple-choice answer selects — S-04 added the participation counters to the same
 * script, taking the `EVAL` from 7 billed commands to `9 + k`. So a loop against it is a
 * bill rather than a nuisance, and a larger one than when this paragraph was written.
 * What keeps it a nuisance and not an exploit is that a submission needs an unguessable
 * player id and can only ever write one answer per question. Recorded as an accepted risk in
 * `answer-contract.md`, not left to be inferred.
 *
 * **The response carries no verdict.** Not `correct`, not `awarded`, and not the new
 * total — a total that jumps by 800 is a verdict, and the whole point of FR-016's
 * reveal beat is that nobody learns the answer before the host shows it.
 */

/** Polish, because the attendee view renders these directly. */
const MESSAGES = {
  missing: "Brak odpowiedzi.",
  notOpen: "To pytanie nie jest już otwarte.",
  alreadyAnswered: "Odpowiedź została już zapisana.",
  notStarted: "Sesja jeszcze się nie rozpoczęła.",
  unknownPlayer: "Nie rozpoznajemy tego urządzenia. Dołącz ponownie.",
  unsupportedKind: "Ten typ pytania nie przyjmuje jeszcze odpowiedzi.",
  unconfigured: "Sesja nie jest skonfigurowana.",
  failed: "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.",
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
  // A repeated form field, so a multiple-choice answer needs no encoding scheme.
  const optionIds = form.getAll("optionIds").filter((value): value is string => {
    return typeof value === "string" && value.length > 0;
  });
  /**
   * **`Number(null)` is `0`, not `NaN` — which is why this is not a bare `Number()`.**
   *
   * A submission with no `elapsedMs` field at all would otherwise be scored as an
   * instant answer and take full speed weight, without the device having to claim
   * anything. The accepted, undetectable risk is a device that *asserts* zero
   * (`clampElapsed`'s docstring says so); a device that simply omits the field getting
   * the same reward is a different thing, and it would be the default for any client
   * that forgot to send it.
   *
   * `NaN` here means "said nothing", and `clampElapsed` reads that as the slowest
   * answer the window allows.
   */
  const rawElapsedField = form.get("elapsedMs");
  const rawElapsed =
    typeof rawElapsedField === "string" && rawElapsedField.trim().length > 0
      ? Number(rawElapsedField)
      : Number.NaN;

  if (typeof playerId !== "string" || playerId.length === 0) {
    logSessionEvent("session.answer.rejected", { rejection: "unknown-player" });
    return json(400, { error: MESSAGES.unknownPlayer });
  }

  if (typeof questionId !== "string" || questionId.length === 0) {
    logSessionEvent("session.answer.rejected", { rejection: "invalid" });
    return json(400, { error: MESSAGES.missing });
  }

  /**
   * **An explicit, billed store read — the plan prices it and it earns its cost
   * twice.** Scoring happens here, before the script runs, so the route needs the
   * question's open time to clamp the elapsed against; and having the document in hand
   * also lets an answer for a question that is no longer open be refused without
   * spending a write.
   *
   * This is not a read-then-write across the two (spine rule 3): the script re-checks
   * the phase and the question id against its own read. This read decides the *award*;
   * the script's read decides whether the award counts.
   */
  const session = await readSession();

  if (session.outcome === "unconfigured") {
    return json(503, { error: MESSAGES.unconfigured });
  }
  if (session.outcome === "failed" || session.outcome === "invalid") {
    console.error("Answer submission could not read the session");
    return json(503, { error: MESSAGES.failed });
  }
  if (session.state === null) {
    logSessionEvent("session.answer.rejected", { rejection: "no-session" });
    return json(409, { error: MESSAGES.notStarted });
  }

  if (session.state.phase !== "question-open" || session.state.currentQuestionId !== questionId) {
    logSessionEvent("session.answer.rejected", { rejection: "not-open", questionId });
    return json(409, { error: MESSAGES.notOpen });
  }

  // The RAW definition, not the public projection — this is the one place in the
  // request path where `correctOptionIds` is legitimately read, and it never leaves
  // this function.
  const question = getQuestionById(questionId);
  if (!question) {
    logSessionEvent("session.answer.rejected", { rejection: "invalid", questionId });
    return json(409, { error: MESSAGES.notOpen });
  }

  // The seam S-05 (text), S-06 (number) and S-08 (word cloud) extend: a refusal with a
  // message rather than a crash, so a host who advances to a question this slice does
  // not handle sees a phone that says so.
  if (question.kind !== "single-choice" && question.kind !== "multiple-choice") {
    logSessionEvent("session.answer.rejected", { rejection: "invalid", questionId });
    return json(409, { error: MESSAGES.unsupportedKind });
  }

  /**
   * **During `question-open`, `updatedAt` IS the moment the question opened** — the
   * advance that opened it was the last write, and only host actions write the session
   * document. That is what makes it usable as the clamp's upper bound.
   *
   * State it here because it is exactly the kind of reasoning that stops holding
   * quietly: the day a slice adds a host action that fires while a question is open
   * (a live participation count, say), this bound silently shortens and every clamp
   * after it hands out more speed weight than it should.
   */
  /**
   * **Only ids this question actually has.**
   *
   * `getAll` returns whatever the request sent — any count, any length, any content —
   * and the array is stored verbatim in the answers hash. Unknown ids change no award
   * (an unrecognised id fails the all-or-nothing match anyway), so the cost is not a
   * wrong score: it is that an open endpoint would let anyone holding a player id write
   * a value of their choosing, at a size of their choosing, into the store. Bounding it
   * against the definition costs one pass and removes the whole class.
   *
   * `join.ts` runs `validateDisplayName` before touching the store for the same reason.
   * This is that step for this route.
   */
  const knownOptionIds = new Set(question.options.map((option) => option.id));
  const selectedOptionIds = [...new Set(optionIds.filter((id) => knownOptionIds.has(id)))];

  const now = Date.now();
  const elapsedMs = clampElapsed(rawElapsed, now - session.state.updatedAt);
  const { correct, awarded } = scoreChoiceAnswer(question, selectedOptionIds, elapsedMs);

  const result = await submitAnswer({
    playerId,
    questionId,
    optionIds: selectedOptionIds,
    elapsedMs,
    correct,
    awarded,
    answeredAt: now,
  });

  if (result.outcome === "already-answered") {
    // FR-004: the first answer is final. Not an error — a double tap, or a device
    // resubmitting after a reload — so the phone renders it as the confirmation it
    // would have shown anyway.
    logSessionEvent("session.answer.rejected", { rejection: "already-answered", questionId });
    return json(409, { error: MESSAGES.alreadyAnswered });
  }

  if (result.outcome === "not-open") {
    // The session advanced between this route's read and the script's. The store is
    // right and this route was a beat behind.
    logSessionEvent("session.answer.rejected", { rejection: "not-open", questionId });
    return json(409, { error: MESSAGES.notOpen });
  }

  if (result.outcome === "no-session") {
    logSessionEvent("session.answer.rejected", { rejection: "no-session" });
    return json(409, { error: MESSAGES.notStarted });
  }

  if (result.outcome === "unknown-player") {
    logSessionEvent("session.answer.rejected", { rejection: "unknown-player" });
    return json(404, { error: MESSAGES.unknownPlayer });
  }

  if (result.outcome === "unconfigured") {
    console.warn("Answer submitted but the store is not configured");
    return json(503, { error: MESSAGES.unconfigured });
  }

  if (result.outcome === "failed") {
    console.error("Answer submission failed:", result.reason);
    return json(503, { error: MESSAGES.failed });
  }

  // The question, never the selection. `LogFields` has no field an option id fits in,
  // which is the enforcement rather than a note beside one.
  logSessionEvent("session.answer.accepted", { questionId });

  // Accepted, and nothing else. `correct`, `awarded` and `total` all wait for the
  // reveal — see the module docstring.
  return json(200, { accepted: true });
};
