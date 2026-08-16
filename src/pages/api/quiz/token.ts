import type { APIRoute } from "astro";

import { logSessionEvent } from "../../../lib/session/log";
import { createTokenRequest } from "../../../lib/session/realtime";

/**
 * Mints a short-lived, subscribe-only Ably token request for a browser.
 *
 * On demand — no `prerender` export, per the project's rendering convention.
 *
 * Deliberately open, with no host secret: the token it hands out can only
 * subscribe, so an attendee holding one cannot publish a forged snapshot. That is
 * what makes it safe to leave unauthenticated, and it is the whole reason the
 * browser never sees `ABLY_API_KEY` (infrastructure.md §Getting Started step 3).
 *
 * **Accepted risk — do not "fix" this with a throttle without reading first.**
 * Open and unthrottled means the provider's 200-peak-connection free ceiling can
 * be exhausted deliberately, locking real attendees out mid-session. Recorded in
 * `infrastructure.md`'s risk register (F-02 impl review, 2026-08-06) with a
 * tripwire, and accepted on the same reasoning as the PRD's unprotected host
 * view: the room is trusted for the length of one session. An IP-keyed limit was
 * rejected because a venue network puts many attendees behind one address, so it
 * would block legitimate joins and threaten the 30-second join target — the
 * tension FR-018 already names for the per-device player cap.
 */
export const GET: APIRoute = async () => {
  const result = await createTokenRequest();

  if (result.outcome === "unconfigured") {
    console.warn("Ably token requested but ABLY_API_KEY is not set");
    return new Response(
      JSON.stringify({ error: "Realtime nie jest skonfigurowane." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  if (result.outcome === "failed") {
    console.error("Ably token request failed:", result.reason);
    return new Response(
      JSON.stringify({
        error: "Nie udało się uzyskać tokenu. Spróbuj ponownie.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  // The only evidence this hop ran. Without it a join burst is invisible in the
  // stream — see `session.token.issued` in `log.ts` for why that mattered.
  logSessionEvent("session.token.issued");

  return new Response(JSON.stringify(result.tokenRequest), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // A token request is single-use and short-lived; a cached one is useless
      // at best and confusing at worst.
      "Cache-Control": "no-store",
    },
  });
};
