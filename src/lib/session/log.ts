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
   * A join was refused. `rejection` carries the *class* — and it is a union rather than
   * a string precisely so the submitted name cannot be put there, for the reason above.
   * It rode on the free-text `reason` until the full-plan review; that made the rule a
   * comment when this file's whole premise is that the type enforces it.
   *
   * Distinct from `session.player.joined` rather than a field on it, because a host
   * watching the stream during the lobby is asking "is the room getting in?", and a
   * burst of refusals is the answer that needs to stand out.
   */
  "session.join.rejected",
  /**
   * An answer was recorded (roadmap S-03).
   *
   * Carries `questionId` and nothing else. **Never the selected options** — an answer
   * is attendee data under CLAUDE.md's rule, and logs are retained ~1 hour covered by
   * no TTL, no `purge` and no rollback, so a line here outlives the session document
   * that the whole retention guardrail is built around. `questionId` is already in the
   * vocabulary and says nothing about a person; there is no field an option id would
   * fit in, and that closure is the enforcement.
   *
   * One line per attendee per question — 150 × 14 in a real event, which makes these
   * the densest lines the stream will carry. F-04 measured ~10–15% loss under a burst,
   * so treat any count of them as a floor.
   */
  "session.answer.accepted",
  /**
   * A submission was refused, with the class in `rejection`.
   *
   * Distinct from `session.answer.accepted` rather than a field on it, for the reason
   * the join events are split: a host watching the stream during a question is asking
   * "are the answers landing?", and a burst of refusals is the answer that has to
   * stand out.
   */
  "session.answer.rejected",
  /**
   * The leaderboard reached the room (roadmap S-07).
   *
   * Carries `playerCount` and `rowCount` — two aggregates, and nothing else. **Never a name
   * and never a total** — the board this event reports on is the first thing in this project
   * to put display names on the wire, and a log stream is the one surface no TTL, no `purge`
   * and no rollback reaches. There is no field either would fit in, and that closure is the
   * enforcement.
   *
   * Host-paced, so a segment writes a handful of these — unlike the answer and join
   * events, this one is cheap enough to read line by line.
   */
  "session.standings.shown",
  /**
   * The board could not be read, so the beat did not happen (roadmap S-07).
   *
   * Its own event rather than `session.action.stale`, which means a version race — a
   * benign one the runbook tells the host to ignore. This is neither benign nor a race:
   * the host tapped, the room did not move, and the reason is that the store did not
   * answer. Folding it into the event nobody looks at would hide the one failure of this
   * beat that a host can do something about.
   */
  "session.standings.failed",
  /**
   * The board reached the room, but without its rank arrows (this change).
   *
   * **Distinct from `session.standings.failed` because the outcomes are opposite.** That
   * one means the beat did not happen; this one means it did, and lost an ornament on the
   * way. Folding them together would put the room's most visible failure and its least
   * visible one behind the same string, and a host grepping mid-segment would have to read
   * the reason to tell "the projector did not move" from "the projector moved fine".
   *
   * It is also the only evidence this degradation leaves. The board looks entirely correct
   * without arrows — a session's first board legitimately has none — so nothing on any
   * screen distinguishes a baseline that could not be read from one that had nothing to
   * say.
   *
   * Carries `reason` and nothing else: the arrows are about positions, and there is no
   * count here that would not be a fact about who was on the board.
   */
  "session.standings.degraded",
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
  /**
   * How many rows a published leaderboard carried (roadmap S-07).
   *
   * The same shape as `playerCount` above and added for the same reason it is safe: a count
   * of lines, never a line. **There is deliberately no field for a name or a total**, so the
   * one thing this event must not say is not merely undocumented, it is unspellable — which
   * is the whole premise of this type. A board shorter than `STANDINGS_SIZE` is the signal
   * worth having: it means the room was smaller than the board, or records were dropped.
   */
  rowCount?: number;
  /**
   * Why a join was refused — **a closed set, not a string** (roadmap S-02).
   *
   * This rode on `reason` until the full-plan review, which is a free-text field, so
   * `{ reason: submittedName }` compiled fine and only a comment stood between a log
   * stream and an attendee's display name. That is precisely the arrangement this whole
   * type exists to reject: the closure *is* the enforcement, not a note beside one.
   * `reason` stays free-text because genuine failure detail (a store error message) has
   * nowhere else to go — which is exactly why a rejection class must not share it.
   *
   * Extend the union when a new refusal class appears. Never widen it to `string`.
   */
  rejection?:
    | "taken"
    | "invalid"
    | "closed"
    | "no-session"
    | "unknown-player"
    /** S-03: the question closed, or a different one is open, before the answer landed. */
    | "not-open"
    /** S-03: this player already answered this question. FR-004 makes the first final. */
    | "already-answered"
    /**
     * S-11: the question's time limit ran out before the answer landed (FR-020).
     *
     * Its own class rather than folded into `not-open`, because the two say different
     * things about the session: `not-open` means the host moved on, this one means the
     * host has not and the clock did. A host reading a burst of these while the
     * projector still shows the question is reading a room that ran out of time, which
     * is a pacing signal rather than a fault.
     *
     * The class only — never the elapsed time or the deadline. A per-submission
     * timestamp in a stream retained ~1 hour, covered by no TTL and no purge, is a
     * handle on when one phone acted.
     */
    | "expired"
    /**
     * S-09: the claiming device has already registered its allowance (FR-018).
     *
     * The class, never the device id — which would be a stable handle on one phone in a
     * stream retained ~1 hour and covered by no TTL, no purge and no rollback. A count
     * of these lines is what a host actually needs: a burst says someone is farming, and
     * a steady trickle says the cap is landing on honest shared handsets.
     */
    | "capped"
    /**
     * S-09: the claim carried no device id at all.
     *
     * Worth its own class rather than folding into `invalid`, because the two mean
     * different things about who is calling. This one is either a page cached from
     * before the guard shipped — recoverable by reloading, which is what the message
     * says — or a caller that is not our client, since `device.ts` always sends a value.
     */
    | "no-device";
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
export function logSessionEvent(
  event: SessionEvent,
  fields: LogFields = {},
): void {
  try {
    console.log(`${LOG_PREFIX} ${JSON.stringify({ event, ...fields })}`);
  } catch {
    // A field that cannot be serialized (a cycle, a BigInt) must not take a host
    // action down with it. Fall back to the event name, which is the part the
    // host actually greps for.
    console.log(
      `${LOG_PREFIX} ${JSON.stringify({ event, note: "fields unserializable" })}`,
    );
  }
}
