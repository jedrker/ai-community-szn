import type { Question } from "../../quiz/schema";

/**
 * When a question stops accepting answers (roadmap S-11, FR-020).
 *
 * **The deadline is derived, never stored.** During `question-open` the session
 * document's `updatedAt` *is* the moment the question opened — the advance that opened
 * it was the last write, and only host actions write the document — so the deadline is
 * arithmetic over two values every party already holds: that timestamp and the
 * question's own `timeLimitSeconds`. Nothing is added to `SessionState`, no key in the
 * session namespace exists for it, and nothing new travels on the wire.
 *
 * (That sentence avoids spelling the namespace prefix on purpose: `keys.test.ts` scans
 * this directory for namespaced literals and does not exempt comments, which is the
 * right call for a guard whose job is to catch a key created outside the registry.)
 *
 * That is also why there is no host override. Extending a deadline mid-question would
 * mean writing the session document while a question is open, which moves `updatedAt`
 * forward and silently inflates every award after it — the constraint
 * `src/pages/api/quiz/answer.ts` and both polled host routes are built around.
 *
 * **This module owns the cutoff; `scoring.ts` owns the reward, and they measure from
 * different clocks on purpose.** The cutoff runs from the server's shared open time, so
 * one clock is true for the whole room and the projector cannot disagree with a phone.
 * The speed weight runs from each device's own first paint (FR-019), so a slow
 * connection costs no points. Merging them would break one guarantee or the other:
 * a shared reward clock punishes slow connections, and a per-device cutoff means no two
 * phones close at the same moment.
 *
 * It lives here rather than in `src/quiz/` for the reason `scoring.ts` does — it is a
 * session rule that *reads* the definition, not part of the definition — and because
 * the grace below is an enforcement detail, not something an author writes.
 */

/**
 * How long past the visible zero a submission is still accepted.
 *
 * **The visible clock and the enforced clock differ, and only the server knows by how
 * much.** A phone's countdown empties at `updatedAt + limit`; the refusal fires this
 * much later. The gap exists because a tap at 0.3 s remaining on a venue network is an
 * answer the attendee watched themselves send, and the PRD calls losing a submitted
 * answer the most expensive requirement it has.
 *
 * **It must never reach a client.** A phone that knew about the grace would show a
 * clock that lies in the generous direction, and the honest reading of a countdown is
 * "send now or don't". `public.ts` records the same rule at the field that does travel.
 *
 * Two seconds because it covers a round trip on a bad connection without being long
 * enough to argue about from the stage.
 */
export const SUBMISSION_GRACE_MS = 2_000;

/**
 * The moment this question's countdown reaches zero, or `null` if it has none.
 *
 * `null` means "never expires" and is the honest answer for the two unscored
 * questions: the schema refuses a limit on them because their pacing is the host's.
 * A caller must treat `null` as *no deadline*, never as *a deadline of now*.
 *
 * This is the **visible** zero. The enforced cutoff is `SUBMISSION_GRACE_MS` later —
 * use `isSubmissionExpired` for that decision rather than comparing against this.
 */
export function deadlineAt(openedAt: number, question: Question): number | null {
  if (question.timeLimitSeconds === undefined) return null;
  if (!Number.isFinite(openedAt) || openedAt <= 0) return null;

  return openedAt + question.timeLimitSeconds * 1_000;
}

/**
 * Whether a submission arriving `now` is too late to count.
 *
 * **Both arguments must come from the server.** `openedAt` is the session document's
 * `updatedAt` and `now` is the route's own clock; the attendee's `elapsedMs` must never
 * enter this. That field is attacker-controlled by design — `clampElapsed` documents
 * the accepted risk — and a cutoff a phone can opt out of is not a cutoff.
 *
 * **A degenerate clock fails toward acceptance, which is the opposite direction from
 * `clampElapsed`, and deliberately so.** There the unknown case is one device's claim
 * about itself, so the safe end is the stingy one. Here the unknown case is the
 * server's own clock or a document we could not reason about, and the stingy end would
 * refuse *every answer in the room* for the rest of the question — a silent, total
 * outage with nothing on screen to explain it. Accepting a late answer is recoverable;
 * refusing a whole room is not.
 */
export function isSubmissionExpired(now: number, openedAt: number, question: Question): boolean {
  const deadline = deadlineAt(openedAt, question);
  if (deadline === null) return false;
  if (!Number.isFinite(now)) return false;

  return now > deadline + SUBMISSION_GRACE_MS;
}
