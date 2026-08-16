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
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (result.outcome === "invalid") {
    console.error(
      "Stored session state is invalid:",
      result.problems.join("; "),
    );
    return new Response(
      JSON.stringify({ error: "Stan sesji jest nieprawidłowy." }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  if (result.outcome === "failed") {
    console.error("Session read failed:", result.reason);
    return new Response(
      JSON.stringify({ error: "Nie udało się odczytać stanu sesji." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
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
   * session) plus one per host refresh.
   *
   * **This endpoint IS now called on a timer, and the figures matter.** The
   * connection-limit change added a fallback loop in `src/lib/client/session.ts`: a device
   * whose Ably channel is unavailable re-fetches here every ~6 s so it can keep playing
   * over HTTP. Two commands per tick, `GET` plus the `HLEN` above. The expected case —
   * ~20 devices refused above Ably's 200-connection ceiling — is ~7k commands a segment;
   * the worst case, Ably unreachable for a whole 220-device room, is ~66k. Against a 500k
   * monthly free tier and the runbook's 200k-per-run tripwire, both are inside the
   * budget. It is bounded on three sides: only while the channel is down, only while the
   * tab is visible, and never once the session is over — `ended` or purged.
   *
   * Those figures are an upper bound, not an estimate: the loop also doubles its interval to
   * a 20 s ceiling while polls keep failing, so the case that would spend the most — an
   * endpoint that is down rather than slow — is the case that spends least.
   *
   * **The host panel now polls here too, in the lobby only.** Same two commands a tick, one
   * device, ~10 s — a floor over the loop's own 2.5 s, because a room fills over minutes —
   * ending at `start`. A ten-minute lobby is ~120 commands, which is noise beside the figures
   * above. It exists because `state.playerCount` cannot move on a join, so
   * the lobby's figure was frozen between host actions; the same reasoning that put the live
   * `HLEN` here in the first place, applied to a timer instead of a button.
   *
   * So the tripwire is still a polling detector — it now has two known, bounded loops to
   * subtract before an anomaly means anything. The other is `/quiz/host`'s participation
   * counter.
   *
   * `null` means "could not find out" — distinct from `0`, so a caller keeps the
   * number it already had rather than rendering an empty room.
   */
  const playerCount = result.state === null ? null : await readPlayerCount();

  // No session yet is a normal state, not a 404 — the harness and S-02 both
  // render "waiting for the host" from it.
  return new Response(JSON.stringify({ state: result.state, playerCount }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
};
