import type { APIRoute } from "astro";

import { authorizeHost, extractSecret, unauthorized } from "../../../../lib/session/host";
import { readPlayerCount, readWordCloud } from "../../../../lib/session/store";
import { getQuestionById } from "../../../../quiz/index";

/**
 * The word cloud, for the large screen (roadmap S-08, PRD FR-012/FR-015).
 *
 * **This is why the cloud is not a snapshot field, which is the decision the whole slice
 * rests on.** Every other aggregate in this project reaches the room by riding the
 * published `SessionState` — but each of those is attached to a *host action*, and a cloud
 * that fills as the room types has none. Publishing per submission is the O(N²) fan-out
 * `spine-contract.md` forbids: Ably's allowance bills one broadcast to 150 clients as 150
 * messages against a 100/second ceiling, so 150 attendees answering inside a few seconds
 * would exceed it and start disconnecting the room. So the projector polls, on its own
 * device, and nothing about the word cloud ever touches the channel.
 *
 * **This route writes nothing, and that is load-bearing rather than incidental** — the same
 * rule `participation.ts` carries, for the same reason it spells out: during
 * `question-open` the session document's `updatedAt` *is* the moment the question opened,
 * and it is the upper bound the speed clamp measures every award against. A host-side write
 * here would move it forward and inflate every award after it, with nothing anywhere to
 * report that scoring had changed. The ban is asserted by `words.test.ts` against this
 * file's own source rather than left as a comment.
 *
 * **Gated by the host secret, unlike `/api/quiz/state`.** That route is open on the stated
 * ground that it returns only what is already broadcast, so guarding it would protect
 * nothing. Neither half holds here: this is not broadcast, and an endpoint built to be
 * *polled* is the cheapest way for anyone to run up commands against a budget the runbook
 * already watches.
 *
 * Two billed commands: one `HGETALL` (which carries the `answered` count with it) and one
 * `HLEN`. Deliberately **not** folded into one `EVAL` — Upstash bills the script *and* every
 * call inside it, so a script would make two commands three on the one path this slice
 * polls. `participation.ts` records the same reasoning at length.
 *
 * **The words are unmoderated by explicit decision** (PRD §Non-Goals). Nothing here filters
 * content, and nothing should be added that does — but `renderWordCloud` builds every chip
 * with `textContent`, so attendee-typed *markup* is inert. Content is accepted; markup is
 * not.
 */

/** Polish, because the host view renders these directly. */
const MESSAGES = {
  badQuestion: "Nieznane pytanie.",
  notWordCloud: "To pytanie nie jest chmurą słów.",
  storeFailed: "Nie udało się odczytać chmury słów.",
} as const;

/**
 * Every response is `no-store`. This one is polled every couple of seconds, and a cached
 * cloud is a projector that has quietly stopped filling — indistinguishable, from the back
 * of a room, from a room that has stopped answering.
 */
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const GET: APIRoute = async ({ request, url }) => {
  /**
   * The header is the only way in for a `GET`. `extractSecret` falls back to a form body,
   * which a `GET` does not have — the read throws, the helper catches it, and the result is
   * `null`, which fails the check below. `participation.ts` records that this is the correct
   * outcome rather than a gap worth its own code path.
   */
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) {
    // Status from the outcome rather than retyped beside it, so it cannot drift from the
    // other host routes. `json` rather than `toResponse` only because every reply here must
    // carry `Cache-Control: no-store`.
    const refusal = unauthorized();
    return json(refusal.status, refusal.body);
  }

  /**
   * **The absent case fails toward the safe end** (`lessons.md`). A missing, empty or
   * unknown `questionId` is a refusal — never a fallback to whatever the session currently
   * has open, and never an empty cloud, which on the projector is the specific claim
   * "nobody in this room wrote a word". Parsed explicitly rather than coerced, so `null`,
   * `""` and a repeated parameter all take the same path as garbage.
   */
  const raw = url.searchParams.get("questionId");
  const questionId = typeof raw === "string" && raw.length > 0 ? raw : null;

  if (questionId === null) {
    return json(400, { error: MESSAGES.badQuestion });
  }

  const question = getQuestionById(questionId);
  if (question === undefined) {
    return json(400, { error: MESSAGES.badQuestion });
  }

  /**
   * **A question of another kind is refused, not answered with an empty cloud.**
   *
   * There is no cloud for a choice question, and every word field is scoped by question id,
   * so the honest reply would be an empty one — which is exactly the value that means
   * "nobody has written anything" for a question where that claim is meaningful. Refusing
   * keeps the two apart, and it means a client cannot render a cloud panel under a question
   * that has none.
   */
  if (question.kind !== "word-cloud") {
    return json(400, { error: MESSAGES.notWordCloud });
  }

  /**
   * **Issued together, and deliberately NOT folded into one `EVAL`** — see the module
   * docstring for the billing reason. `Promise.all` buys the single-round-trip latency
   * without buying the extra command.
   */
  const [cloud, playerCount] = await Promise.all([
    readWordCloud(questionId),
    /**
     * The denominator for the cloud panel's `Odpowiedzi N / M` line, so the beat needs no second
     * request and the join count stops needing a manual refresh while the question is open —
     * `participation.ts`'s reasoning. `null` when the store could not answer, which is
     * distinct from `0`, so the page keeps the number it has.
     *
     * That line was missing from the first implementation of the panel while this call and the
     * `answered` field below were both already in place — a data path with no affordance, caught
     * in implementation review (F4). If a later change removes the line again, remove this call
     * with it rather than leaving a billed command feeding nothing.
     */
    readPlayerCount(),
  ]);

  if (cloud === null) {
    // `null` is "the store could not say", never "nobody wrote a word" — the whole reason
    // that function returns it. Reported as a failure so the page takes its staleness path
    // and holds the cloud it has, rather than receiving a 200 it would have to decode a
    // second flavour of absence out of.
    console.error("Word cloud read failed for question:", questionId);
    return json(503, { error: MESSAGES.storeFailed });
  }

  /**
   * `questionId` is echoed back so a page whose question changed mid-flight discards the
   * reply instead of painting one question's cloud under another's prompt. The host is free
   * to advance at any moment, and the stale cloud would look entirely plausible.
   */
  return json(200, {
    questionId,
    answered: cloud.answered,
    playerCount,
    words: cloud.words,
    // How many distinct words exist, which may exceed the number returned. The panel says so
    // rather than presenting the top of the list as the whole room.
    distinct: cloud.distinct,
  });
};
