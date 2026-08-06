import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractHostFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { endedSessionState } from "../../../../lib/session/state";
import { endSession, readSession } from "../../../../lib/session/store";

/**
 * Ends the session (roadmap F-03).
 *
 * The session document survives on `ENDED_TTL_SECONDS` — about ten minutes — rather
 * than being deleted, so a device that reloads right after the closing beat still
 * finds the final standings. `purge` is the immediate path when that window is not
 * wanted.
 *
 * **This is the project's first irreversible host action, and it is guarded
 * differently from the other three because of it.** `start`, `advance` and `reveal`
 * are safe on stage precisely because a double-tap is a harmless no-op. `end` cannot
 * borrow that safety — a second `end` is not what hurts, an *accidental first* one
 * is. So it carries two guards the flow verbs do not:
 *
 * 1. **A confirmation version.** The caller must name the version it believes it is
 *    ending, which it can only know by having read current state. A replayed, stale
 *    or blind request is refused rather than applied.
 * 2. **A phase guard.** Refused while a question is open, so it cannot fire
 *    mid-question. A host who genuinely needs to abandon a session at that moment
 *    has `purge`, which deliberately has no phase guard.
 */
export const POST: APIRoute = async ({ request }) => {
  const { secret, confirmVersion } = await extractHostFields(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  // Read before acting so the guards can produce real rejections. `applyHostAction`
  // reads again, which is a second round trip on a once-per-session verb — bought
  // deliberately, because the alternative is teaching the shared helper a rejection
  // vocabulary that only this route and `purge` would ever use.
  const current = await readSession();

  if (current.outcome === "unconfigured") {
    return toResponse({
      status: 503,
      body: { error: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe." },
    });
  }

  if (current.outcome === "invalid") {
    return toResponse({
      status: 409,
      body: { error: "Stan sesji jest nieprawidłowy. Sprawdź definicję quizu." },
    });
  }

  if (current.outcome === "failed") {
    console.error("Session read failed before end:", current.reason);
    return toResponse({
      status: 503,
      body: { error: "Nie udało się odczytać stanu sesji. Spróbuj ponownie." },
    });
  }

  if (current.state === null) {
    return toResponse({
      status: 409,
      body: { error: "Sesja nie została jeszcze rozpoczęta." },
    });
  }

  if (current.state.phase === "ended") {
    // Already where the host wanted it. A no-op, reported as one — the same posture
    // `reveal` takes toward an already-revealed question.
    return toResponse({
      status: 200,
      body: { state: current.state, applied: false, note: "already-ended" },
    });
  }

  if (current.state.phase === "question-open") {
    return toResponse({
      status: 409,
      body: {
        error:
          "Pytanie jest wciąż otwarte. Pokaż wyniki, zanim zakończysz sesję — " +
          "albo użyj natychmiastowego usunięcia danych, jeśli musisz przerwać teraz.",
      },
    });
  }

  if (confirmVersion === null) {
    return toResponse({
      status: 409,
      body: {
        error: `Zakończenie sesji wymaga potwierdzenia. Podaj aktualną wersję sesji (${current.state.version}).`,
      },
    });
  }

  if (confirmVersion !== current.state.version) {
    return toResponse({
      status: 409,
      body: {
        error:
          `Potwierdzenie nie zgadza się ze stanem sesji (podano ${confirmVersion}, ` +
          `aktualna wersja to ${current.state.version}). Odśwież widok i spróbuj ponownie.`,
      },
    });
  }

  // `confirmVersion` is passed through, not merely checked above. `applyHostAction`
  // performs its own read, so without this the write would be guarded by that later
  // read rather than by the version the host actually confirmed — and anything that
  // moved the session in between would be ended unconfirmed.
  const outcome = await applyHostAction(
    (state, now) => endedSessionState(state, now),
    Date.now(),
    endSession,
    confirmVersion
  );

  return toResponse(outcome);
};
