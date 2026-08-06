import type { APIRoute } from "astro";

import {
  authorizeHost,
  extractSecret,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { publishSnapshot } from "../../../../lib/session/realtime";
import { createSession } from "../../../../lib/session/store";

/**
 * Starts the session.
 *
 * **It opens the lobby, not the first question.** PRD FR-002 keeps an explicit
 * start precisely because "the deliberate start is what lets the host gather the
 * room before the first question", and the drafted quiz's opening two questions
 * — a word cloud and "Czy wszyscy są gotowi?" — are written for that beat. The
 * first `advance` opens question 1.
 *
 * Idempotent, and not by a check-then-write here: `createSession` is a
 * create-if-absent Lua script, so two host devices racing — or one host
 * double-tapping — cannot reset a session that is already running.
 */
export const POST: APIRoute = async ({ request }) => {
  const secret = await extractSecret(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  const result = await createSession(Date.now());

  if (result.outcome === "unconfigured") {
    return toResponse({
      status: 503,
      body: { error: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe." },
    });
  }

  if (result.outcome === "invalid") {
    console.error("Session document invalid on start:", result.problems.join("; "));
    return toResponse({
      status: 409,
      body: { error: "Stan sesji jest nieprawidłowy. Sprawdź definicję quizu." },
    });
  }

  if (result.outcome === "failed") {
    console.error("Session start failed:", result.reason);
    return toResponse({
      status: 503,
      body: { error: "Nie udało się rozpocząć sesji. Spróbuj ponownie." },
    });
  }

  // Publish in both cases. On `exists` this is a re-broadcast of the current
  // state, which is exactly what a host wants after a device reconnects — and it
  // is harmless, because clients drop anything not newer than what they hold.
  const published = await publishSnapshot(result.state);

  if (published.outcome !== "ok") {
    return toResponse({
      status: 502,
      body: {
        state: result.state,
        applied: true,
        error:
          "Sesja istnieje, ale stan nie dotarł do urządzeń. Powtórz akcję, aby rozgłosić go ponownie.",
      },
    });
  }

  // Branch the whole outcome, not just `body` — a ternary inside the object
  // widens `body` into a union the discriminated type will not narrow.
  if (result.outcome === "created") {
    return toResponse({ status: 200, body: { state: result.state, applied: true } });
  }

  return toResponse({
    status: 200,
    body: { state: result.state, applied: false, note: "already-started" },
  });
};
