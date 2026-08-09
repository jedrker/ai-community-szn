import type { APIRoute } from "astro";

import {
  authorizeHost,
  extractSecret,
  unauthorized,
} from "../../../../lib/session/host";
import { readAnsweredCount, readPlayerCount } from "../../../../lib/session/store";
import { getQuestionById } from "../../../../quiz/index";

/**
 * How many people have answered the open question (roadmap S-04, PRD FR-005).
 *
 * **This route writes nothing, and that is the single most important thing about it.**
 * `src/pages/api/quiz/answer.ts` explains why: during `question-open`, the session
 * document's `updatedAt` *is* the moment the question opened, and it is the upper bound
 * the speed clamp measures every award against. The warning there names "a live
 * participation count, say" as exactly the change that would silently shorten it — a
 * host-side write mid-question would move `updatedAt` forward and inflate every award
 * after it, with nothing anywhere to report that scoring had changed. So this handler
 * touches neither `writeSession` nor `applyHostAction`, and the ban is asserted by
 * `participation.test.ts` against this file's own source rather than left as a comment.
 *
 * **Gated by the host secret, unlike `/api/quiz/state`.** That route is open on the
 * stated ground that it returns only what is already broadcast to every subscriber, so
 * guarding it would protect nothing. Neither half of that reasoning holds here: an
 * answered count is not broadcast — it is the number FR-005 keeps off the wire while
 * answering is open — and an endpoint built to be *polled* is the cheapest way for
 * anyone to run up commands against a budget already near three-quarters of its
 * ceiling.
 *
 * **It calls `readAnsweredCount`, never `readQuestionTallies`.** The distribution is not
 * withheld here by this handler choosing what to serialize; it is unreachable from this
 * code path, because the function it would have to call is not the one it calls and the
 * shape it would travel in does not exist. See the note on those two functions in
 * `store.ts`.
 *
 * Two billed commands: one `HGET` and one `HLEN`.
 */

/** Polish, because the host view renders these directly. */
const MESSAGES = {
  badQuestion: "Nieznane pytanie.",
  storeFailed: "Nie udało się odczytać liczby odpowiedzi.",
} as const;

/**
 * Every response is `no-store`. This one is polled every couple of seconds, and a
 * cached count is a projector that has quietly stopped moving — indistinguishable, from
 * the back of a room, from a count that is genuinely not rising.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  /**
   * The header is the only way in for a `GET`. `extractSecret` falls back to a form
   * body, which a `GET` does not have — the read throws, the helper catches it, and the
   * result is `null`, which fails the check below. That is the correct outcome and not
   * a gap worth a separate code path.
   */
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) {
    // The status comes from the outcome rather than being retyped beside it: every other
    // host route reaches this through `toResponse`, and a hardcoded 401 here is a second
    // copy that can drift from the first. `json` rather than `toResponse` only because
    // this route's every reply must carry `Cache-Control: no-store`.
    const refusal = unauthorized();
    return json(refusal.status, refusal.body);
  }

  /**
   * **The absent case fails toward the safe end** (`lessons.md`, "Absent untrusted input
   * must fail toward the safe end, not the favourable one"). A missing, empty or unknown
   * `questionId` is a refusal — never a fallback to whatever the session currently has
   * open, and never a `0`, which on the projector is the specific claim "nobody in this
   * room has answered". Parsed explicitly rather than coerced, so `null`, `""` and a
   * repeated parameter all take the same path as garbage.
   */
  const raw = url.searchParams.get("questionId");
  const questionId = typeof raw === "string" && raw.length > 0 ? raw : null;

  if (questionId === null || getQuestionById(questionId) === undefined) {
    return json(400, { error: MESSAGES.badQuestion });
  }

  /**
   * **Why the client names the question rather than this route reading it.** It saves a
   * `readSession` on every tick — the difference between two billed commands and three,
   * multiplied by a poll — and the host page already holds the authoritative snapshot,
   * so it is not guessing. The response echoes `questionId` back so a page whose
   * question changed mid-flight discards the reply instead of painting a stale count
   * under a new prompt.
   */
  /**
   * **Issued together, and deliberately NOT folded into one `EVAL`.**
   *
   * `READ_PLAYER_BY_ID` and `READ_ANSWER` in `store.ts` combine their reads into a script
   * because a round trip is the expense there. Here the opposite holds: Upstash bills the
   * `EVAL` *and* every call inside it, so a script would turn two billed commands into
   * three — a 50% rise on the one path this slice intends to poll. `Promise.all` buys the
   * single-round-trip latency without buying the extra command. Stated because "two
   * billed commands" reads like an invitation to combine them, and combining them is the
   * one change that would make the number wrong.
   */
  const [answered, playerCount] = await Promise.all([
    readAnsweredCount(questionId),
    /**
     * The denominator, so the panel's `answered / joined` needs no second request and the
     * join count stops needing a manual refresh while a question is open. `null` when the
     * store could not answer — distinct from `0`, so the page keeps the number it has.
     */
    readPlayerCount(),
  ]);

  if (answered === null) {
    // `null` is "the store could not say", never "nobody answered" — the whole reason
    // that function returns it. Reported as a failure so the page takes its staleness
    // path and holds the last number, rather than receiving a 200 it would have to
    // decode a second flavour of absence out of.
    console.error("Participation read failed for question:", questionId);
    return json(503, { error: MESSAGES.storeFailed });
  }

  return json(200, { questionId, answered, playerCount });
};
