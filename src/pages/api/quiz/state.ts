import type { APIRoute } from "astro";

import { readPlayerCount, readSession } from "../../../lib/session/store";

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

  /**
   * The join count, read live and returned **beside** the document rather than inside
   * it (roadmap S-02, found in the Phase 4 two-device run).
   *
   * `state.playerCount` is only ever written by `applyHostAction`, so the document
   * carries the count as of the last host action and nothing else can move it. That is
   * the right design for the *published* snapshot — no join may publish, or 150 joins
   * fan out to 150 subscribers — but it made the host's refresh button a lie: it
   * re-read a document whose count could not have changed, so the lobby appeared empty
   * however many people had joined, until the host advanced.
   *
   * So the freshness lives here instead. The document is returned untouched — its
   * `playerCount` is still the last published one, and overwriting it would let a
   * client apply a count under a version that never carried it — and the live figure
   * travels as a sibling field the caller may use or ignore.
   *
   * Costs one `HLEN` per state fetch, which is once per device per *connect* (~150 a
   * session) plus one per host refresh. Paced by connects and by the host, not by a
   * timer: still nothing like the polling shape the command-counter tripwire watches
   * for.
   *
   * `null` means "could not find out" — distinct from `0`, so a caller keeps the
   * number it already had rather than rendering an empty room.
   */
  const playerCount = result.state === null ? null : await readPlayerCount();

  // No session yet is a normal state, not a 404 — the harness and S-02 both
  // render "waiting for the host" from it.
  return new Response(JSON.stringify({ state: result.state, playerCount }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
