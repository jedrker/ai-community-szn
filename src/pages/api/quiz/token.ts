import type { APIRoute } from "astro";

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
 */
export const GET: APIRoute = async () => {
  const result = await createTokenRequest();

  if (result.outcome === "unconfigured") {
    console.warn("Ably token requested but ABLY_API_KEY is not set");
    return new Response(
      JSON.stringify({ error: "Realtime nie jest skonfigurowane." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

  if (result.outcome === "failed") {
    console.error("Ably token request failed:", result.reason);
    return new Response(
      JSON.stringify({ error: "Nie udało się uzyskać tokenu. Spróbuj ponownie." }),
      { status: 503, headers: { "Content-Type": "application/json" } }
    );
  }

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
