/**
 * Structured session logging (roadmap F-02).
 *
 * This is a deliverable, not a nicety. F-01 verified that `vercel logs` streams
 * what functions *emit* — not an access log: ~100 requests to on-demand routes
 * produced zero stream output. So a quiet stream is the normal state, and the
 * host tailing it during a live segment sees nothing unless this code speaks.
 * `docs/runbook-live-session.md` §Before the session already promises them these
 * lines exist.
 *
 * One line, one JSON object, one stable prefix — so the host can grep a terminal
 * mid-session without reading JSON by eye.
 */

/**
 * The closed vocabulary. S-02, S-03 and F-03 extend *this* list rather than
 * inventing their own names, so a host greps one prefix and gets every session
 * event regardless of which slice emitted it.
 */
export const SESSION_EVENTS = [
  "session.created",
  "session.action.applied",
  "session.action.stale",
  "session.publish.ok",
  "session.publish.failed",
  /**
   * A host action was attempted with a wrong or missing secret. Kept distinct from
   * `session.action.stale` deliberately: stale is a benign race the runbook tells
   * the host to ignore, and folding an unauthorized attempt into it would hide the
   * only security-relevant signal this system emits behind the one event nobody
   * looks at.
   */
  "session.auth.rejected",
  "session.read.invalid",
  "session.unconfigured",
] as const;

export type SessionEvent = (typeof SESSION_EVENTS)[number];

/** Grep for this to see the whole session in a log stream. */
export const LOG_PREFIX = "[livequiz]";

type LogFields = {
  /** The session version the event concerns, when it has one. */
  version?: number;
  phase?: string;
  questionId?: string | null;
  /** Milliseconds the operation took, when measured. */
  ms?: number;
  /** Failure detail. Never a credential — see the redaction note below. */
  reason?: string;
  [key: string]: unknown;
};

/**
 * Emits one line. Never throws and never awaits: logging must not be able to
 * fail a host action, and a host action must not wait on it.
 *
 * Callers must not pass credentials or attendee display names in `fields`.
 * Names are attendee data under the PRD's retention guardrail, and a log stream
 * is not covered by the store's TTL — anything written here outlives the session
 * document by design.
 */
export function logSessionEvent(event: SessionEvent, fields: LogFields = {}): void {
  try {
    console.log(`${LOG_PREFIX} ${JSON.stringify({ event, ...fields })}`);
  } catch {
    // A field that cannot be serialized (a cycle, a BigInt) must not take a host
    // action down with it. Fall back to the event name, which is the part the
    // host actually greps for.
    console.log(`${LOG_PREFIX} ${JSON.stringify({ event, note: "fields unserializable" })}`);
  }
}
