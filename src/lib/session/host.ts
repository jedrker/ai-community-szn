import { logSessionEvent } from "./log";
import { publishSnapshot } from "./realtime";
import { readSession, writeSession } from "./store";
import { type SessionState } from "./state";

/**
 * The shared body of a host action (roadmap F-02).
 *
 * `start`, `advance` and `reveal` differ only in how they compute the next state
 * from the current one. Everything else — the secret check, the version bump, the
 * write, the publish, and what the host is told when any of it fails — lives here
 * so the three routes cannot drift apart.
 */

export const HOST_SECRET_HEADER = "x-livequiz-host-secret";

/** Polish, because the control view renders these directly. */
const MESSAGES = {
  unauthorized: "Brak uprawnień hosta.",
  unconfigured: "Sesja nie jest skonfigurowana. Sprawdź zmienne środowiskowe.",
  noSession: "Sesja nie została jeszcze rozpoczęta.",
  storeFailed: "Nie udało się zapisać stanu sesji. Spróbuj ponownie.",
  invalidState: "Stan sesji jest nieprawidłowy. Sprawdź definicję quizu.",
  publishFailed:
    "Stan został zapisany, ale nie dotarł do urządzeń. Powtórz akcję, aby rozgłosić go ponownie.",
} as const;

export type HostActionOutcome =
  /** The write landed and the snapshot went out. */
  | { status: 200; body: { state: SessionState; applied: true } }
  /**
   * The guard rejected the write because someone else already moved the session.
   * Deliberately not an error and deliberately not plain success: the realistic
   * cause is a host double-tapping on stage, where the room is already where they
   * wanted it — but reporting success would make them lose count of where it is.
   */
  | { status: 200; body: { state: SessionState; applied: false; note: string } }
  /**
   * The store accepted the write but the broadcast failed. The state is
   * committed, so this is retryable: republishing the same snapshot is a no-op
   * for any device that already has it.
   */
  | { status: 502; body: { state: SessionState; applied: true; error: string } }
  | { status: 401 | 409 | 503; body: { error: string } };

/**
 * Constant-time-ish comparison. Not a serious side-channel defence — the threat
 * model here is an attendee reading the network tab, not a timing attacker — but
 * comparing lengths first and avoiding early return costs nothing.
 */
function secretMatches(provided: string | null): boolean {
  const expected = import.meta.env.LIVEQUIZ_HOST_SECRET;
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (provided === null || provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) {
    mismatch |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Reads the secret from a header or a form field. The header is what the harness
 * and any real host view should use; the form field exists because the project's
 * API convention is `request.formData()` and a plain HTML form cannot set
 * headers.
 */
export async function extractSecret(request: Request): Promise<string | null> {
  const header = request.headers.get(HOST_SECRET_HEADER);
  if (header) return header;

  try {
    const form = await request.formData();
    const field = form.get("secret");
    return typeof field === "string" ? field : null;
  } catch {
    return null;
  }
}

export function authorizeHost(secret: string | null): { ok: boolean } {
  if (secretMatches(secret)) return { ok: true };

  // Logged so a host tailing the stream sees rejected attempts. No secret
  // material in the log line.
  logSessionEvent("session.action.stale", { reason: "host secret rejected" });
  return { ok: false };
}

export function unauthorized(): HostActionOutcome {
  return { status: 401, body: { error: MESSAGES.unauthorized } };
}

/**
 * Computes the next state, writes it under the version guard, and publishes the
 * result.
 *
 * `advance` returning the current state unchanged is how "past the last
 * question" is expressed — a no-op, not an error. A host who taps advance once
 * more at the end has not done anything wrong.
 */
export async function applyHostAction(
  nextFrom: (current: SessionState, now: number) => SessionState | null,
  now: number
): Promise<HostActionOutcome> {
  const current = await readSession();

  if (current.outcome === "unconfigured") {
    return { status: 503, body: { error: MESSAGES.unconfigured } };
  }
  if (current.outcome === "invalid") {
    return { status: 409, body: { error: MESSAGES.invalidState } };
  }
  if (current.outcome === "failed") {
    console.error("Session read failed:", current.reason);
    return { status: 503, body: { error: MESSAGES.storeFailed } };
  }
  if (current.state === null) {
    return { status: 409, body: { error: MESSAGES.noSession } };
  }

  const next = nextFrom(current.state, now);

  if (next === null) {
    // Nothing to do — report the unchanged state rather than inventing an error.
    return {
      status: 200,
      body: {
        state: current.state,
        applied: false,
        note: "no-op",
      },
    };
  }

  const written = await writeSession(current.state.version, next);

  if (written.outcome === "unconfigured") {
    return { status: 503, body: { error: MESSAGES.unconfigured } };
  }
  if (written.outcome === "failed") {
    console.error("Session write failed:", written.reason);
    return { status: 503, body: { error: MESSAGES.storeFailed } };
  }
  if (written.outcome === "stale") {
    // Someone else moved the session between our read and our write. Re-read so
    // the host sees where the room actually is.
    const fresh = await readSession();
    const state =
      fresh.outcome === "ok" && fresh.state !== null ? fresh.state : current.state;

    return {
      status: 200,
      body: { state, applied: false, note: "already-applied" },
    };
  }

  const published = await publishSnapshot(written.state);

  if (published.outcome !== "ok") {
    // The state IS committed — say so, and say the broadcast is what failed.
    // Reporting a plain error here would invite the host to retry believing
    // nothing happened, when in fact the next retry is only a re-broadcast.
    return {
      status: 502,
      body: {
        state: written.state,
        applied: true,
        error: MESSAGES.publishFailed,
      },
    };
  }

  return { status: 200, body: { state: written.state, applied: true } };
}

/** One JSON shape for every host route. */
export function toResponse(outcome: HostActionOutcome): Response {
  return new Response(JSON.stringify(outcome.body), {
    status: outcome.status,
    headers: { "Content-Type": "application/json" },
  });
}
