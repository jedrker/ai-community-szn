import type { APIRoute } from "astro";

import {
  applyHostAction,
  authorizeHost,
  extractHostFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { logSessionEvent } from "../../../../lib/session/log";
import { endedSessionState } from "../../../../lib/session/state";
import {
  endSession,
  readSession,
  readStandings,
} from "../../../../lib/session/store";

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
 *
 * ## The closing beat carries the leaderboard (roadmap S-10, FR-006)
 *
 * The terminal snapshot now lands the segment on the winner rather than on a bare
 * sentence, so the board is read here and passed to `endedSessionState`.
 *
 * **Read inside the transition, for the reason `reveal.ts` and the standings route read
 * theirs there**: a read placed beside `playerCount` in `applyHostAction` would attach a
 * board to *every* host action, including the `advance` that opens the next question.
 *
 * **A failed read ends the session anyway, and that is the departure from
 * `standings.ts`.** That route refuses its transition when the store cannot answer,
 * because there the board *is* the beat and completing would put a blank screen in front
 * of the room — and refusing costs nothing, since the beat is optional. Refusing here
 * would cost the close itself, which is what moves every key onto the short lifetime and
 * is the mechanism the whole retention guardrail rests on. So the room gets the plain
 * closing screen, the failure is logged, and the session ends. The schema permits a
 * boardless `ended` for exactly this.
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
      body: {
        error: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe.",
      },
    });
  }

  if (current.outcome === "invalid") {
    return toResponse({
      status: 409,
      body: {
        error: "Stan sesji jest nieprawidłowy. Sprawdź definicję quizu.",
      },
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
    async (state, now) => {
      const standings = await readStandings();

      if (standings === null) {
        // Logged, not surfaced: the host is closing the session and there is nothing for
        // them to do about it. The reason names the close so this line cannot be mistaken
        // for a failed `pokaż ranking` in a stream a host is grepping mid-event.
        logSessionEvent("session.standings.failed", {
          reason:
            "standings read failed while ending — closing without a board",
        });
      }

      return endedSessionState(state, now, standings);
    },
    Date.now(),
    endSession,
    confirmVersion,
  );

  // No `session.ended` line here, deliberately: `endSession` already emits one, and it
  // now carries the board's `rowCount`. One line per mutation is a property the runbook
  // tells a host to read the stream by, and two would break it at the one moment they are
  // checking the session really closed.
  return toResponse(outcome);
};
