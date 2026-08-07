import type { APIRoute } from "astro";

import { logSessionEvent } from "../../../lib/session/log";
import { newPlayerId, validateDisplayName } from "../../../lib/session/players";
import { claimPlayer, readPlayerById, readSession } from "../../../lib/session/store";

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
    const existing = await readPlayerById(playerId);

    if (existing) {
      const current = await readSession();
      return json(200, {
        player: { id: existing.id, displayName: existing.displayName },
        state: current.outcome === "ok" ? current.state : null,
        resumed: true,
      });
    }

    // Not an error the attendee did anything to cause: the ordinary path here is a
    // device holding an id from a purged or expired session. The client clears its
    // storage and shows the form. 404 rather than 200-with-null so the client cannot
    // mistake it for a successful resume.
    logSessionEvent("session.join.rejected", { reason: "unknown-player" });
    return json(404, { error: MESSAGES.unknownPlayer });
  }

  if (typeof rawName !== "string") {
    logSessionEvent("session.join.rejected", { reason: "invalid" });
    return json(400, { error: MESSAGES.missing });
  }

  const validated = validateDisplayName(rawName);
  if (!validated.ok) {
    // The *class*, never the submitted name — logs outlive the session document.
    logSessionEvent("session.join.rejected", { reason: "invalid" });
    return json(400, { error: validated.error });
  }

  const record = {
    id: newPlayerId(),
    displayName: validated.displayName,
    joinedAt: Date.now(),
  };

  const claim = await claimPlayer(validated.key, record);

  if (claim.outcome === "taken") {
    logSessionEvent("session.join.rejected", { reason: "taken" });
    return json(409, { error: MESSAGES.taken });
  }

  // "Not started yet" and "already over" are different things for an attendee to read,
  // and they are the two phases that both carry a null question (F-03's lesson). One
  // shared message would leave a latecomer waiting for a session that had finished.
  if (claim.outcome === "no-session") {
    logSessionEvent("session.join.rejected", { reason: "no-session" });
    return json(409, { error: MESSAGES.notStarted });
  }

  if (claim.outcome === "closed") {
    logSessionEvent("session.join.rejected", { reason: "closed" });
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

  // The state travels with the claim so a joining device renders the host's current
  // question from this response, with no second round trip inside the thirty seconds
  // PRD FR-002 gives it.
  const current = await readSession();

  return json(200, {
    player: { id: record.id, displayName: record.displayName },
    state: current.outcome === "ok" ? current.state : null,
    playerCount: claim.playerCount,
  });
};
