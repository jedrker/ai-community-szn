import type { APIRoute } from "astro";

import { logSessionEvent } from "../../../lib/session/log";
import { newPlayerId, validateDisplayName } from "../../../lib/session/players";
import { claimPlayer, readPlayerById } from "../../../lib/session/store";

/**
 * Joins the session (roadmap S-02, PRD FR-007/FR-008).
 *
 * On demand — no `prerender` export, per the project's rendering convention.
 *
 * Two shapes, one route:
 *
 * - `displayName` — a fresh claim. The name is validated, folded, and claimed
 *   atomically, or refused because someone already holds it.
 * - `playerId` — a device coming back. A reload during a fifteen-minute segment is
 *   near-certain, and a returning attendee holds their own name: sent back to the
 *   form, they would be refused by their own claim and locked out for the rest of the
 *   session. So the id they stored is how they are recognised.
 *
 * One route rather than two because a returning device and a joining device want the
 * same thing — to be in, with the current state — and the client asks the question
 * once either way.
 *
 * **Deliberately open, with no host secret**, on the same reasoning as
 * `/api/quiz/token`: the room is trusted for the length of one session, there are no
 * accounts, and an IP-keyed throttle was rejected during planning because a venue
 * network puts many attendees behind one address (the tension FR-018 already names).
 *
 * **Publishes nothing.** 150 joins broadcasting 150 snapshots to 150 subscribers is
 * the O(N²) fan-out the spine contract forbids. The count reaches the room on the
 * host's next action, carried by `applyHostAction`.
 */

/** Polish, because the join form renders these directly. */
const MESSAGES = {
  missing: "Podaj swoją nazwę.",
  taken: "Ta nazwa jest już zajęta. Wybierz inną.",
  notStarted: "Sesja jeszcze się nie rozpoczęła. Poczekaj na prowadzącego.",
  ended: "Sesja została już zakończona.",
  unknownPlayer: "Nie rozpoznajemy tego urządzenia. Dołącz ponownie.",
  /**
   * **Not a prompt to try another name.** `taken` above is; this is final for this
   * device, and copy that invited a retry would send an attendee through three more
   * refusals before they learned the reason.
   */
  capped: "Z tego urządzenia dołączyło już zbyt wielu graczy.",
  /**
   * Recoverable in one tap, which is the whole reason an absent device id is refused
   * rather than let through — see the guard below.
   */
  noDevice: "Odśwież stronę i spróbuj ponownie.",
  unconfigured: "Sesja nie jest skonfigurowana.",
  failed: "Nie udało się dołączyć. Spróbuj ponownie.",
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
  const rawName = form.get("displayName");

  // A returning device first. Checked before the name so a reload never turns into a
  // second claim — which would fail as `taken` against the attendee's own name.
  if (typeof playerId === "string" && playerId.length > 0) {
    // One round trip: the lookup returns the session document alongside the record,
    // because a returning device needs both and the script has both in hand.
    const lookup = await readPlayerById(playerId);

    if (lookup.outcome === "found" && lookup.player) {
      return json(200, {
        player: { id: lookup.player.id, displayName: lookup.player.displayName },
        state: lookup.state,
        resumed: true,
      });
    }

    // **503, not 404, and the difference is the whole point.** The store could not
    // answer, so this says nothing about whether the id is good. A 404 here would tell
    // the device its identity is dead; it would clear the id it is still holding a name
    // under, re-enter that name, be refused as `taken`, and be locked out for the rest
    // of the segment. The client retries or waits on a 503 and keeps the id.
    if (lookup.outcome === "failed") {
      console.error("Player lookup failed for a resuming device");
      return json(503, { error: MESSAGES.failed });
    }

    // Genuinely no such player. Not an error the attendee did anything to cause: the
    // ordinary path here is a device holding an id from a purged or expired session.
    // The client clears its storage and shows the form. 404 rather than 200-with-null
    // so the client cannot mistake it for a successful resume.
    logSessionEvent("session.join.rejected", { rejection: "unknown-player" });
    return json(404, { error: MESSAGES.unknownPlayer });
  }

  if (typeof rawName !== "string") {
    logSessionEvent("session.join.rejected", { rejection: "invalid" });
    return json(400, { error: MESSAGES.missing });
  }

  const validated = validateDisplayName(rawName);
  if (!validated.ok) {
    // The *class*, never the submitted name — logs outlive the session document.
    logSessionEvent("session.join.rejected", { rejection: "invalid" });
    return json(400, { error: validated.error });
  }

  /**
   * THE DEVICE ID, AND WHY AN ABSENT ONE IS REFUSED (roadmap S-09, FR-018).
   *
   * Read only on this path. The resuming branch above never sees it — see the route
   * docstring for why that exemption is the guard's most important property.
   *
   * An absent id is refused rather than treated as un-counted, and the alternatives are
   * both worse. Letting it through is the cap's bypass: anything that omits one field
   * claims freely. Bucketing every id-less device into one shared counter is worse still
   * — a handful of private-mode attendees would consume the whole room's allowance and
   * refuse everyone behind them.
   *
   * Refusing is safe here because our own client always sends one: `device.ts` mints an
   * id in memory when storage is unavailable, so even a private tab has a value. An
   * absent field therefore means a caller that is not our client — which is the farming
   * case — or a page cached from before this shipped, and the message tells that
   * attendee to reload.
   */
  const deviceId = form.get("deviceId");
  if (typeof deviceId !== "string" || deviceId.length === 0) {
    return json(400, { error: MESSAGES.noDevice });
  }

  const record = {
    id: newPlayerId(),
    displayName: validated.displayName,
    joinedAt: Date.now(),
  };

  const claim = await claimPlayer(validated.key, record, deviceId);

  if (claim.outcome === "capped") {
    return json(409, { error: MESSAGES.capped });
  }

  if (claim.outcome === "taken") {
    logSessionEvent("session.join.rejected", { rejection: "taken" });
    return json(409, { error: MESSAGES.taken });
  }

  // "Not started yet" and "already over" are different things for an attendee to read,
  // and they are the two phases that both carry a null question (F-03's lesson). One
  // shared message would leave a latecomer waiting for a session that had finished.
  if (claim.outcome === "no-session") {
    logSessionEvent("session.join.rejected", { rejection: "no-session" });
    return json(409, { error: MESSAGES.notStarted });
  }

  if (claim.outcome === "closed") {
    logSessionEvent("session.join.rejected", { rejection: "closed" });
    return json(409, { error: MESSAGES.ended });
  }

  if (claim.outcome === "unconfigured") {
    console.warn("Join attempted but the store is not configured");
    return json(503, { error: MESSAGES.unconfigured });
  }

  if (claim.outcome === "failed") {
    console.error("Join failed:", claim.reason);
    return json(503, { error: MESSAGES.failed });
  }

  // The count, never the name. `LogFields` is a closed type precisely so the second
  // option is a compile error rather than a discipline. Emitted here rather than in
  // `claimPlayer` so the whole join event family lives at one layer.
  logSessionEvent("session.player.joined", { playerCount: claim.playerCount });

  // The state travels out of the claim script itself, so a joining device renders the
  // host's current question from this response with no second round trip inside the
  // thirty seconds PRD FR-002 gives it — and the state it gets is the one the claim
  // was checked against, not a later read that could disagree with it.
  return json(200, {
    player: { id: record.id, displayName: record.displayName },
    state: claim.state,
    playerCount: claim.playerCount,
  });
};
