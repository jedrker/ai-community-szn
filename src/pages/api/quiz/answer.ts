import type { APIRoute } from "astro";

import { isSubmissionExpired } from "../../../lib/session/deadline";
import { MAX_GUESS_MAGNITUDE, parseGuess } from "../../../lib/session/guess";
import { logSessionEvent } from "../../../lib/session/log";
import {
  clampElapsed,
  MAX_TEXT_ANSWER_LENGTH,
  scoreChoiceAnswer,
  scoreNumberAnswer,
  scoreTextAnswer,
} from "../../../lib/session/scoring";
import { readSession, submitAnswer } from "../../../lib/session/store";
import { validateWord } from "../../../lib/session/words";
import { getQuestionById } from "../../../quiz/index";

/**
 * Submits one attendee's answer to the open question
 * (roadmap S-03/S-05/S-06/S-08, PRD FR-004/FR-010/FR-011/FR-012/FR-013).
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
  /**
   * Distinct from `notOpen` on purpose: the question *is* still open — the host has not
   * advanced — and only the clock ran out. Telling an attendee the question closed when
   * the projector still shows it is the kind of small lie that produces a hand in the
   * air mid-segment.
   */
  expired: "Czas na odpowiedź minął.",
  notStarted: "Sesja jeszcze się nie rozpoczęła.",
  unknownPlayer: "Nie rozpoznajemy tego urządzenia. Dołącz ponownie.",
  tooLong: `Odpowiedź może mieć najwyżej ${MAX_TEXT_ANSWER_LENGTH} znaków.`,
  notANumber: "Wpisz liczbę.",
  outOfRange: "Ta liczba jest poza zakresem.",
  unconfigured: "Sesja nie jest skonfigurowana.",
  failed: "Nie udało się zapisać odpowiedzi. Spróbuj ponownie.",
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
  // A repeated form field, so a multiple-choice answer needs no encoding scheme.
  const optionIds = form
    .getAll("optionIds")
    .filter((value): value is string => {
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

  if (
    session.state.phase !== "question-open" ||
    session.state.currentQuestionId !== questionId
  ) {
    logSessionEvent("session.answer.rejected", {
      rejection: "not-open",
      questionId,
    });
    return json(409, { error: MESSAGES.notOpen });
  }

  // The RAW definition, not the public projection — this is the one place in the
  // request path where `correctOptionIds` is legitimately read, and it never leaves
  // this function.
  const question = getQuestionById(questionId);
  if (!question) {
    logSessionEvent("session.answer.rejected", {
      rejection: "invalid",
      questionId,
    });
    return json(409, { error: MESSAGES.notOpen });
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
   *
   * **S-11 made that reasoning load-bearing twice.** The same timestamp is now also the
   * start of the submission window below, so a mid-question write would not only inflate
   * awards — it would push the deadline out and give the room extra time nobody granted.
   * That is why the limit has no host override.
   */
  const now = Date.now();

  /**
   * **The submission window (roadmap S-11, FR-020).**
   *
   * Refused here, above the kind branches, because the rule is global and because a
   * refusal must cost nothing: no scoring, and no `EVAL` — an expired submission spends
   * only the read this route had already made.
   *
   * **Both inputs are the server's.** `now` is this route's clock and `updatedAt` came
   * out of the store; the attendee's `elapsedMs` is deliberately *not* consulted. That
   * field is attacker-controlled — `clampElapsed` documents the accepted risk — so a
   * cutoff that read it would be a cutoff any phone could opt out of by claiming to have
   * answered sooner.
   *
   * **Below the phase gate, never above it.** A submission to a question that is not
   * open must keep saying `notOpen`: that is the truthful message, and the two refusals
   * are not interchangeable on a phone that has to tell the attendee which happened.
   *
   * The enforced cutoff sits `SUBMISSION_GRACE_MS` past the zero the countdown showed,
   * so an answer already in flight is not lost. `deadline.ts` owns that reasoning and
   * the reason the grace never travels to a client.
   */
  if (isSubmissionExpired(now, session.state.updatedAt, question)) {
    logSessionEvent("session.answer.rejected", {
      rejection: "expired",
      questionId,
    });
    return json(409, { error: MESSAGES.expired, refusal: "expired" });
  }

  /**
   * Computed above the kind branch because the timing rule is global — every scored
   * answer is weighted the same way regardless of what it is made of.
   */
  const elapsedMs = clampElapsed(rawElapsed, now - session.state.updatedAt);

  let selectedOptionIds: string[] = [];
  let answerText: string | null = null;
  let guessValue: number | null = null;
  let foldedWord: string | null = null;
  let correct: boolean;
  let awarded: number;

  if (question.kind === "text") {
    /**
     * **Parsed explicitly, never coerced** — `lessons.md` rule 2, and the same care the
     * `elapsedMs` block above takes. Decide what "said nothing" means before deciding
     * what "lied" means: an absent field, a non-string (a file part, a repeated field),
     * and a string that is only whitespace are all *refusals*, not empty-but-valid
     * answers. Scored as an answer, an empty submission would burn FR-004's
     * one-answer-per-question lock on nothing.
     */
    const rawText = form.get("text");
    const trimmed = typeof rawText === "string" ? rawText.trim() : "";

    if (trimmed.length === 0) {
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: MESSAGES.missing });
    }

    /**
     * **Bounded before the store is touched**, and refused rather than truncated —
     * scoring a prefix the attendee did not type is worse than a clean no.
     *
     * The same reasoning that bounds `optionIds` against the definition below: this
     * endpoint is open, takes `formData`, and `curl` ignores an input's `maxlength`.
     * `join.ts` runs `validateDisplayName` before touching the store for this reason.
     *
     * Measured on the trimmed string because that is what gets stored, so this and
     * `answerRecordSchema`'s `.max()` bound the same value. That schema check is the
     * backstop; this one is what produces a message an attendee can read.
     */
    if (trimmed.length > MAX_TEXT_ANSWER_LENGTH) {
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: MESSAGES.tooLong });
    }

    // The raw trimmed text, not the fold: the fold is a comparison artefact, and the
    // reveal shows the attendee what they actually typed.
    answerText = trimmed;
    ({ correct, awarded } = scoreTextAnswer(question, trimmed, elapsedMs));
  } else if (question.kind === "number") {
    /**
     * **Parsed explicitly, refused rather than coerced** — the same `lessons.md` rule 2
     * discipline as the text branch and the `elapsedMs` block. `parseGuess` returns
     * `NaN` for an absent field, an empty or whitespace-only one, and anything with a
     * non-numeric remainder; none of those is a guess of zero.
     */
    const guess = parseGuess(form.get("value"));

    if (!Number.isFinite(guess)) {
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: MESSAGES.notANumber });
    }

    /**
     * **Bounded before the store is touched**, exactly as the text length and the
     * option ids are, and for the same reason: this endpoint is open and takes
     * `formData`, so an input's attributes bound nothing.
     *
     * A negative guess is *not* refused — it is wrong, not malformed, and it scores
     * zero through the ordinary rule. The bound is about magnitude only, keeping an
     * arbitrary value out of an arithmetic path whose result is stored as an integer.
     */
    if (Math.abs(guess) > MAX_GUESS_MAGNITUDE) {
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: MESSAGES.outOfRange });
    }

    // The parsed number, not the raw string: the reveal shows it back, and a later
    // reader should not have to re-parse an attendee's typing.
    guessValue = guess;
    ({ correct, awarded } = scoreNumberAnswer(question, guess, elapsedMs));
  } else if (question.kind === "word-cloud") {
    /**
     * The word cloud (roadmap S-08, FR-012) — **the last kind behind this seam**, which
     * until now answered every submission with a refusal.
     *
     * **Parsed explicitly, never coerced**, and validated before the store is touched:
     * `lessons.md` rule 2 and the same discipline as the two branches above. An absent
     * field, a non-string, whitespace, two words and an over-length word are all
     * refusals, and `validateWord` owns every one of those decisions so there is exactly
     * one place they are made. The bound in particular has to be server-side because
     * `curl` ignores an input's `maxlength` — `join.ts`'s reasoning for validating a
     * display name before claiming it.
     */
    const rawWord = form.get("word");

    if (typeof rawWord !== "string") {
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: MESSAGES.missing });
    }

    const validated = validateWord(rawWord);

    if (!validated.ok) {
      /**
       * **400, deliberately not 409.** Nothing was written, and the client treats a 409
       * as final — it locks the question and takes the field away. An attendee told
       * "one word only" has to be able to fix it and send again, which is exactly the
       * distinction `client/answer.ts` draws between `invalid` and `rejected`.
       */
      logSessionEvent("session.answer.rejected", {
        rejection: "invalid",
        questionId,
      });
      return json(400, { error: validated.error });
    }

    // The typed form travels on `text`, the counted form on `word` — see the note on
    // that field in `answers.ts` for why one word occupies two of them.
    answerText = validated.word;
    foldedWord = validated.key;

    /**
     * **No scorer is called, and that is not an omission.** The build gate refuses a
     * scored word-cloud question (`src/quiz/schema.ts`), so `points` is `null` here by
     * construction and there is nothing to weigh — `scoring.ts` says in as many words
     * that this kind "takes none of" the seam S-05 and S-06 extended.
     *
     * `correct: false` rather than a flattering `true`: there is no correct answer to
     * match, and a fabricated verdict is a lie the reveal copy would then have to work
     * around. The view distinguishes a warm-up from a wrong answer by `question.scored`,
     * never by the award — the rule `scoreChoiceAnswer` states for the unscored case.
     */
    correct = false;
    awarded = 0;
  } else {
    /**
     * **Only ids this question actually has.**
     *
     * `getAll` returns whatever the request sent — any count, any length, any content —
     * and the array is stored verbatim in the answers hash. Unknown ids change no award
     * (an unrecognised id fails the all-or-nothing match anyway), so the cost is not a
     * wrong score: it is that an open endpoint would let anyone holding a player id write
     * a value of their choosing, at a size of their choosing, into the store. Bounding it
     * against the definition costs one pass and removes the whole class.
     */
    const knownOptionIds = new Set(question.options.map((option) => option.id));
    selectedOptionIds = [
      ...new Set(optionIds.filter((id) => knownOptionIds.has(id))),
    ];

    ({ correct, awarded } = scoreChoiceAnswer(
      question,
      selectedOptionIds,
      elapsedMs,
    ));
  }

  const result = await submitAnswer({
    playerId,
    questionId,
    optionIds: selectedOptionIds,
    text: answerText,
    // The numeric branch (roadmap S-06) fills this; every other kind leaves it null.
    value: guessValue,
    // The word-cloud branch (roadmap S-08) fills this with the *folded* word, which is
    // what its counter was keyed by; every other kind leaves it null.
    word: foldedWord,
    elapsedMs,
    correct,
    awarded,
    answeredAt: now,
  });

  if (result.outcome === "already-answered") {
    // FR-004: the first answer is final. Not an error — a double tap, or a device
    // resubmitting after a reload — so the phone renders it as the confirmation it
    // would have shown anyway.
    logSessionEvent("session.answer.rejected", {
      rejection: "already-answered",
      questionId,
    });
    return json(409, { error: MESSAGES.alreadyAnswered });
  }

  if (result.outcome === "not-open") {
    // The session advanced between this route's read and the script's. The store is
    // right and this route was a beat behind.
    logSessionEvent("session.answer.rejected", {
      rejection: "not-open",
      questionId,
    });
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
