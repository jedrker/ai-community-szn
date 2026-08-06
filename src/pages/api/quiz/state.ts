import type { APIRoute } from "astro";

import { readSession } from "../../../lib/session/store";

/**
 * The current session snapshot.
 *
 * On demand — no `prerender` export.
 *
 * Why this exists: publishing whole snapshots makes a device that *missed* a
 * message self-correcting, but does nothing for a device that was not yet
 * listening. Between two host actions that wait is unbounded, so a browser that
 * just connected — or just reloaded, which during a 15-minute segment is
 * near-certain — would sit on an empty screen. A client fetches this once on
 * connect, then subscribes, and applies whichever source carries the higher
 * `version`.
 *
 * Costs one request per device per *connect*, not per host action. That is the
 * distinction from the broadcast-a-nudge design the plan rejected, where every
 * host action would send 150 devices back to the store at once.
 *
 * Open, with no host secret: this returns exactly what is already broadcast to
 * every subscriber, so guarding it would protect nothing.
 */
export const GET: APIRoute = async () => {
  const result = await readSession();

  if (result.outcome === "unconfigured") {
    console.warn("Session state requested but the store is not configured");
    return new Response(
      JSON.stringify({ error: "Sesja nie jest skonfigurowana." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (result.outcome === "invalid") {
    console.error("Stored session state is invalid:", result.problems.join("; "));
    return new Response(
      JSON.stringify({ error: "Stan sesji jest nieprawidłowy." }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  if (result.outcome === "failed") {
    console.error("Session read failed:", result.reason);
    return new Response(
      JSON.stringify({ error: "Nie udało się odczytać stanu sesji." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  // No session yet is a normal state, not a 404 — the harness and S-02 both
  // render "waiting for the host" from it.
  return new Response(JSON.stringify({ state: result.state }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
