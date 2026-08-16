import { logSessionEvent } from "./log";
import { publishSnapshot } from "./realtime";
import {
  readPlayerCount,
  readSession,
  writeSession,
  type WriteResult,
} from "./store";
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
  /**
   * Refused, **and the running session is worth showing anyway** (multiple-quizzes).
   *
   * `start` uses it for "you asked for quiz B while quiz A is running": nothing was
   * written, so `applied` is false, but the host panel applying this state is how the
   * host sees *which* session is in the way rather than only being told there is one.
   * The 502 above is the other state-bearing refusal and it is the opposite case —
   * committed but unbroadcast.
   */
  | {
      status: 409;
      body: { state: SessionState; applied: false; error: string };
    }
  /**
   * `400` is the request's fault rather than the session's, and it is the one status
   * here that says so: `start` uses it when nothing named which quiz to run. The 409s
   * beside it all mean "the session is not in a state where this can happen".
   */
  | { status: 400 | 401 | 409 | 503; body: { error: string } };

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

/**
 * Reads the secret **and** the confirmation version in a single body read
 * (roadmap F-03).
 *
 * `extractSecret` consumes `request.formData()` when no header is present, and a
 * request body can only be read once — so a destructive route that called it and
 * then tried to read the version would find an empty body. The three flow verbs
 * keep using `extractSecret`; `end` and `purge` use this.
 *
 * `confirmVersion` is the caller's statement of which session it believes it is
 * ending. It is the whole safety mechanism: `start`, `advance` and `reveal` are
 * safe on stage precisely *because* a replayed request is a harmless no-op, and
 * `end` has to be safe for the opposite reason — a replayed request must be
 * refused. That inversion only works if the caller has to name a version it could
 * only have learned by reading current state.
 */
export async function extractHostFields(
  request: Request,
): Promise<{ secret: string | null; confirmVersion: number | null }> {
  const header = request.headers.get(HOST_SECRET_HEADER);

  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    // No form body — a header-only caller. Not an error by itself; a missing
    // confirmation is reported by the route as a 409, not swallowed here.
    form = null;
  }

  const field = form?.get("secret");
  const secret = header ?? (typeof field === "string" ? field : null);

  const rawVersion = form?.get("version");
  const parsed = typeof rawVersion === "string" ? Number(rawVersion) : NaN;
  const confirmVersion = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  return { secret, confirmVersion };
}

/**
 * Reads the secret **and** the quiz being started, in a single body read
 * (multiple-quizzes).
 *
 * Shaped like `extractHostFields` above and for exactly the same reason:
 * `extractSecret` consumes `request.formData()` when no header is present, and a
 * request body can only be read once — so calling it and then reading the form would
 * find an empty body and start whatever the fallback happened to be.
 *
 * **There is no fallback.** An absent field returns `null` and `start.ts` refuses,
 * rather than defaulting to "the first quiz" or "the one we usually run": deciding what
 * "said nothing" means before deciding what "lied" means is the rule
 * (`lessons.md`), and here the conservative end is refusing to start anything.
 */
export async function extractStartFields(
  request: Request,
): Promise<{ secret: string | null; quizId: string | null }> {
  const header = request.headers.get(HOST_SECRET_HEADER);

  let form: FormData | null = null;
  try {
    form = await request.formData();
  } catch {
    // No form body — a header-only caller. Not an error by itself; the missing quiz is
    // reported by the route, not swallowed here.
    form = null;
  }

  const field = form?.get("secret");
  const secret = header ?? (typeof field === "string" ? field : null);

  const rawQuizId = form?.get("quizId");
  // Explicitly `typeof === "string"` and non-empty rather than a bare coercion: `null`,
  // `""` and a `File` all have to mean "said nothing", and `String(null)` does not.
  const quizId =
    typeof rawQuizId === "string" && rawQuizId.length > 0 ? rawQuizId : null;

  return { secret, quizId };
}

export function authorizeHost(secret: string | null): { ok: boolean } {
  if (secretMatches(secret)) return { ok: true };

  // Logged so a host tailing the stream sees rejected attempts. No secret
  // material in the log line — neither the expected value nor what was offered.
  logSessionEvent("session.auth.rejected", {
    reason: "host secret did not match",
  });
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
 *
 * **`nextFrom` may be async** (roadmap S-04). It became so for exactly one caller:
 * `reveal.ts` needs to read the question's tallies to build the revealed state, and the
 * alternative was reading them *here*, beside `playerCount` — which would attach a
 * distribution to every action, including the `advance` that opens the next question.
 * Widening this signature keeps that read where it belongs, in the one transition the
 * distribution is part of. The shared body below is unchanged and still applies to
 * every verb; `start.ts` and `advance.ts` stayed synchronous and needed no edit.
 */
export async function applyHostAction(
  nextFrom: (
    current: SessionState,
    now: number,
  ) => SessionState | null | Promise<SessionState | null>,
  now: number,
  /**
   * How the computed state is committed. Defaults to the ordinary
   * compare-and-set; `end` passes `endSession`, which applies the same guard and
   * additionally moves the whole namespace onto the short lifetime.
   *
   * Injected rather than branched on a flag so the error mapping below — five
   * outcomes, each with its own Polish message and status — exists once for every
   * verb that writes.
   */
  write: (
    expectedVersion: number,
    next: SessionState,
  ) => Promise<WriteResult> = writeSession,
  /**
   * The version the *caller* already validated against, when it validated one.
   *
   * Without this, a route that checks a confirmation and then calls this helper
   * has performed a read-then-write across two round trips: the check ran against
   * the route's read, and the write below would run against this function's own,
   * later read. Anything that moved the session in between would be committed
   * without ever having been confirmed — the guard would appear to hold while
   * authorizing a state the host never saw.
   *
   * That is the exact pattern the spine contract's rule 3 forbids ("No
   * read-then-write on the store"), and it is why `end` passes its confirmed
   * version through rather than trusting the re-read.
   *
   * Omitted by the three flow verbs, which have nothing to confirm — a replayed
   * `advance` is a harmless no-op by design.
   */
  expectedVersion?: number,
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

  // The session moved between the caller's check and this read. Refuse rather
  // than commit something the caller never confirmed — reported as `stale`,
  // which the host already reads as "already applied, you are not where you
  // thought you were", so this needs no new vocabulary at the control view.
  if (
    expectedVersion !== undefined &&
    expectedVersion !== current.state.version
  ) {
    logSessionEvent("session.action.stale", { version: current.state.version });
    return {
      status: 200,
      body: { state: current.state, applied: false, note: "already-applied" },
    };
  }

  // Awaited, so a `nextFrom` that throws or rejects propagates to the route rather than
  // being committed as a pending Promise — which is what an un-awaited call would have
  // spread into the state literal, silently.
  const computed = await nextFrom(current.state, now);

  /**
   * THE ONE PLACE THE JOIN COUNT IS INJECTED (roadmap S-02).
   *
   * Three separate constructors build a full state literal — `advance.ts`,
   * `reveal.ts`, and `endedSessionState` — and each of them copies
   * `current.playerCount`. Copying is correct *because* of this line. Without it the
   * count is read fresh on every action and then thrown away, so the number on the
   * host's large screen never moves: a failure the type system cannot see, and one
   * that a test asserting "the field is present" would sail straight past.
   *
   * **Outside the version guard, deliberately.** `COMPARE_AND_SET` must stay a single
   * `EVAL` (`store.test.ts` asserts it), and computing the count inside it would mean
   * `cjson` round-tripping a document whose `currentQuestionId` is null in two of the
   * four phases. So the count is read here and can be a beat old.
   *
   * That asymmetry is the point and should not be "fixed": a stale *count* means the
   * host sees 148 where the room holds 149 until the next action, which costs nothing.
   * A stale *version* means a lost host action, which costs the segment. One of these
   * needs the store to serialize it; the other does not.
   *
   * `null` from the read means the store could not answer — keep whatever the document
   * already held rather than publishing a zero, which on a large screen reads as the
   * room having left.
   *
   * Read only when there is something to write. A no-op — advance past the last
   * question, reveal with nothing open — must not spend a store command to decorate a
   * state it is not going to commit.
   */
  const next =
    computed === null
      ? null
      : {
          ...computed,
          playerCount: (await readPlayerCount()) ?? current.state.playerCount,
        };

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

  const written = await write(current.state.version, next);

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
      fresh.outcome === "ok" && fresh.state !== null
        ? fresh.state
        : current.state;

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
