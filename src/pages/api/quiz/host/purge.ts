import type { APIRoute } from "astro";

import {
  authorizeHost,
  extractHostFields,
  toResponse,
  unauthorized,
} from "../../../../lib/session/host";
import { publishSnapshot } from "../../../../lib/session/realtime";
import { endedSessionState } from "../../../../lib/session/state";
import { endSession, purgeSession, readSession } from "../../../../lib/session/store";

/**
 * Removes the room's data now (roadmap F-03).
 *
 * `purge` is `end` plus a delete, not a parallel path: **write, publish, then
 * delete.** The ordering is the interesting part and it is easy to get wrong in a way
 * that looks fine.
 *
 * Publishing without writing first would mean broadcasting a terminal document that
 * was never stored — and the client rule is unforgiving. Devices drop any snapshot
 * whose version is not strictly greater than the one they hold, so republishing the
 * session at its existing version is *silently discarded by every device*: the
 * closing screen never changes and the failure looks like a dead network rather than
 * a bug. Writing first is what guarantees the published snapshot carries a higher
 * version and is therefore actually applied.
 *
 * Two deliberate asymmetries with `end`, both of which must survive future tidying:
 *
 * - **No phase guard.** `end` refuses while a question is open; `purge` accepts every
 *   phase. That is the point — this is the escape hatch for exactly the mid-question
 *   abandonment `end` refuses (a session going wrong, a room being evacuated). Adding
 *   a symmetric guard here would remove the only exit.
 * - **A publish failure does not abort the delete.** The retention guardrail outranks
 *   the closing screen. The response says which half succeeded.
 */
export const POST: APIRoute = async ({ request }) => {
  const { secret, confirmVersion } = await extractHostFields(request);
  if (!authorizeHost(secret).ok) return toResponse(unauthorized());

  const current = await readSession();

  if (current.outcome === "unconfigured") {
    return toResponse({
      status: 503,
      body: { error: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe." },
    });
  }

  if (current.outcome === "failed") {
    console.error("Session read failed before purge:", current.reason);
    return toResponse({
      status: 503,
      body: { error: "Nie udało się odczytać stanu sesji. Spróbuj ponownie." },
    });
  }

  /**
   * No readable session — either nothing was ever started, or a previous run left
   * residue behind an unparseable document. Purge anyway: cleaning up residue is
   * precisely what this verb is for, and refusing here would leave the one case that
   * most needs it unreachable. No confirmation is demanded because there is no
   * version to confirm against.
   */
  if (current.outcome === "invalid" || current.state === null) {
    const purged = await purgeSession();

    if (purged.outcome !== "purged") {
      console.error("Purge failed:", purged.reason);
      return toResponse({
        status: 503,
        body: { error: "Nie udało się usunąć danych sesji. Spróbuj ponownie." },
      });
    }

    return new Response(
      JSON.stringify({
        purged: true,
        keysRemoved: purged.keysRemoved,
        note: purged.keysRemoved === 0 ? "nothing-to-purge" : "residue-removed",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  if (confirmVersion === null) {
    return toResponse({
      status: 409,
      body: {
        error: `Usunięcie danych wymaga potwierdzenia. Podaj aktualną wersję sesji (${current.state.version}).`,
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

  // 1. Write the terminal document. This bumps the version, which is what makes the
  //    broadcast below newer than anything a device already holds.
  const ended =
    current.state.phase === "ended"
      ? null
      : endedSessionState(current.state, Date.now());

  let terminal = current.state;

  if (ended !== null) {
    const written = await endSession(current.state.version, ended);

    if (written.outcome === "stale") {
      // Someone else is driving the session. A wipe should not proceed unattended
      // when the state moved under us — refuse rather than force.
      return toResponse({
        status: 409,
        body: {
          error:
            "Stan sesji zmienił się w trakcie. Nic nie zostało usunięte — " +
            "odśwież widok i spróbuj ponownie.",
        },
      });
    }

    if (written.outcome !== "applied") {
      console.error("Purge could not write the terminal state:", written.reason);
      return toResponse({
        status: 503,
        body: { error: "Nie udało się zakończyć sesji przed usunięciem danych." },
      });
    }

    terminal = written.state;
  }

  // 2. Broadcast it, so connected devices land on the ended screen before the state
  //    disappears underneath them.
  const published = await publishSnapshot(terminal);

  // 3. Delete regardless of whether the broadcast landed.
  const purged = await purgeSession();

  if (purged.outcome !== "purged") {
    console.error("Purge failed after the terminal write:", purged.reason);
    return toResponse({
      status: 503,
      body: {
        error:
          "Sesja została zakończona, ale danych nie udało się usunąć. " +
          "Spróbuj ponownie — dane wygasną same w ciągu kilku minut.",
      },
    });
  }

  if (published.outcome !== "ok") {
    return new Response(
      JSON.stringify({
        purged: true,
        keysRemoved: purged.keysRemoved,
        error:
          "Dane zostały usunięte, ale informacja o zakończeniu nie dotarła do urządzeń.",
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ purged: true, keysRemoved: purged.keysRemoved, state: terminal }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
