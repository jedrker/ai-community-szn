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
  /**
   * The host closed the segment. The session document survives on the short
   * `ENDED_TTL_SECONDS` lifetime rather than the four-hour one, so this line is
   * the start of a ten-minute clock, not the end of the data.
   */
  "session.ended",
  /**
   * Every registered key was deleted. This is the only event in the vocabulary
   * that reports something irreversible, which is why it is distinct from
   * `session.ended` rather than folded into it — a host reading the stream needs
   * to be able to tell "the segment is over" from "the room's data is gone".
   */
  "session.purged",
  /**
   * A subscribe-only token was minted for a device (F-04, criterion 2.4).
   *
   * Exists because the token endpoint was the one hop with no evidence it ran.
   * `vercel logs` prints a request line only for invocations that *emit*
   * something, and `token.ts` spoke only on its failure paths — so a rehearsal
   * where 150 devices each fetched a token produced zero token lines, and a
   * rehearsal where none of them did would have looked identical.
   *
   * One line per joining device, so a room of 150 writes 150 of these. That is
   * the point: counting them is how the join burst is observed. It carries no
   * fields — there is nothing about *which* device to say, and the endpoint is
   * unauthenticated anyway, so there is nothing it could truthfully claim.
   */
  "session.token.issued",
  /**
   * An attendee claimed a name (roadmap S-02).
   *
   * Carries the resulting `playerCount` and nothing else. **Never the name** — that is
   * not a convention here, it is a compile error, because `LogFields` has no field a
   * name would fit in. Logs are retained ~1 hour and are covered by no TTL, no
   * `purge` and no `vercel rollback`, so anything written here outlives the session
   * document by design.
   *
   * One line per joining device, so a room of 150 writes 150 of these — the same
   * property that makes `session.token.issued` the instrument for counting the join
   * burst. Note F-04 measured ~10–15% line loss under a burst of this size, so treat
   * the count as a floor rather than a tally.
   */
  "session.player.joined",
  /**
   * A join was refused. `reason` carries the *class* — "taken", "invalid", "closed",
   * "no-session" — and never the submitted name, for the reason above.
   *
   * Distinct from `session.player.joined` rather than a field on it, because a host
   * watching the stream during the lobby is asking "is the room getting in?", and a
   * burst of refusals is the answer that needs to stand out.
   */
  "session.join.rejected",
] as const;

export type SessionEvent = (typeof SESSION_EVENTS)[number];

/** Grep for this to see the whole session in a log stream. */
export const LOG_PREFIX = "[livequiz]";

/**
 * **A closed set, and the closure is the enforcement.**
 *
 * This carried an `[key: string]: unknown` index signature until F-03. With it,
 * the "never log a display name" rule below was a comment — `{ displayName }`
 * type-checked fine, and the first slice to log a join by name would have shipped
 * without a murmur from the compiler. Removing it makes that a type error.
 *
 * So: widening this back — by restoring the index signature, by adding a
 * catch-all field, or by casting at a call site — silently reopens the surface
 * this closes. If a slice needs a field that is not here, add *that field*, and
 * think about whether it can carry attendee data before you do.
 *
 * `keys.test.ts` guards the store's namespace the same way. This is the log's
 * equivalent, enforced by the type system rather than by a test.
 */
type LogFields = {
  /** The session version the event concerns, when it has one. */
  version?: number;
  phase?: string;
  questionId?: string | null;
  /** Milliseconds the operation took, when measured. */
  ms?: number;
  /** Failure detail. Never a credential — see the redaction note below. */
  reason?: string;
  /** How many registered keys a purge removed. A count, never their contents. */
  keysRemoved?: number;
  /**
   * How many attendees have joined. A count, never who they are (roadmap S-02).
   *
   * This is the shape every future attendee-related field should copy: an aggregate
   * that says something useful about the room without saying anything about a person
   * in it. If a field you want to add cannot be written that way, it probably should
   * not be written at all.
   */
  playerCount?: number;
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
