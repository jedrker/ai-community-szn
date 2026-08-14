/**
 * The device's half of answering (roadmap S-03, PRD FR-004/FR-019).
 *
 * Owns the per-question clock and the two requests, so `index.astro`'s script stays one
 * state machine rather than growing a second one beside it.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/`, and may not read
 * `import.meta.env` (`boundary.test.ts`). The storage key arrives through `define:vars`,
 * exactly as `PLAYER_STORAGE_KEY` does for `player.ts`.
 *
 * Nothing here throws — `player.ts`'s posture, and for the same reason: Safari in
 * private mode throws on a storage write, storage can be disabled outright, and a phone
 * on a venue network loses requests. None of that may take the view down mid-question.
 */

export type SubmitOutcome =
  | { outcome: "accepted" }
  /**
   * The server refused **finally**, with a Polish message the view renders directly.
   * Kept apart from `failed` because the two mean opposite things to an attendee: this
   * one is an answer about their answer, the other is "we do not know".
   *
   * **`409` only.** Both of its causes are genuinely final: the answer is already
   * recorded, or the question has closed. The caller locks the question on this, so
   * anything that is *not* final must not arrive here — see `invalid`.
   */
  | { outcome: "rejected"; error: string }
  /**
   * The submission was malformed and **nothing was written** — a validation refusal
   * (`4xx` that is not `409`), which S-06 made reachable for the first time.
   *
   * Split out because the caller treats `rejected` as final and takes the control
   * away. The numeric gate on the input is deliberately loose ("contains a digit"),
   * so an attendee typing `50-60` or `12 tys` gets a 400 — and folded into `rejected`
   * that told them their answer was saved, disabled the field, and left them unable to
   * answer a question they had never answered. The message is worth showing; the lock
   * is not.
   */
  | { outcome: "invalid"; error: string }
  | { outcome: "failed" };

export type OwnResult = {
  readonly answered: boolean;
  readonly correct: boolean | null;
  readonly awarded: number | null;
  /**
   * What this device typed, for a free-text question; `null` for every other kind
   * (roadmap S-05).
   *
   * Comes from the server rather than from memory because memory does not survive a
   * reload, and an attendee who answered and then reloaded should still see their own
   * words beside the accepted answer at reveal.
   */
  readonly text: string | null;
  /**
   * What this device guessed, for a number question; `null` for every other kind
   * (roadmap S-06).
   *
   * From the server for the same reason `text` is — memory does not survive a reload —
   * and it is load-bearing rather than decorative here: for this kind `correct` is
   * exact-hit-only, so the reveal copy cannot tell a near miss from a zero without
   * both this and the award.
   */
  readonly value: number | null;
  readonly total: number;
  /**
   * Where this device stands in the room — **only during the standings phase**, and
   * `null` on every other branch (roadmap S-07, FR-014).
   *
   * A competition rank, so a tie shares a number and this agrees with the position the
   * published board shows for the same player. The denominator is not here: the device
   * already holds `playerCount` on the snapshot, so sending it again would be a second
   * copy of a number that could then disagree with the first.
   *
   * `null` also covers "the store could not say" reaching the client as a failed fetch —
   * the view must render neither a `0` nor a `1` from an absent rank, both of which are
   * claims about where the attendee stands.
   */
  readonly rank: number | null;
};

/**
 * What is being submitted, discriminated so "a selection *and* typed text" is not a
 * representable call.
 *
 * The `number` arm carries the **raw string**, not a parsed number: the server is the
 * only parser (`src/lib/session/guess.ts`), and a client-side one would either
 * duplicate it or cross the boundary `boundary.test.ts` enforces. Two parsers that
 * disagree is a scoring dispute on stage.
 */
export type AnswerPayload =
  | { readonly kind: "choice"; readonly optionIds: readonly string[] }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "number"; readonly value: string }
  /**
   * One word for a word-cloud question (roadmap S-08, FR-012).
   *
   * Its own arm rather than reusing `text`, even though both carry a raw string the server
   * trims: the two are bound, validated and refused by different rules — 24 characters and
   * no whitespace here, 80 and anything there — and they arrive at the route under
   * different field names. A shared arm would make the route's branch depend on the
   * question kind it looked up rather than on what the device actually sent.
   */
  | { readonly kind: "word"; readonly word: string };

/**
 * What this device knows about one question, across reloads.
 *
 * `at` is the first-paint timestamp. `submitted` records that an answer for this
 * question was accepted — it lives here rather than in a second storage key because the
 * two have exactly the same lifetime and the same reason to be cleared, and a second
 * key would be a second thing to register, plumb through `define:vars`, and forget.
 *
 * `text` is what this device typed — the free-text answer, or the **raw** numeric guess
 * (roadmap S-06), which is the same thing from this module's point of view: a string
 * the attendee typed into a field that has to look the same after a reload. It is here
 * for the same reason and with the same lifetime. **Without it the locked field is
 * empty after a reload**:
 * the view holds the typed value in memory only, and the server will not serve it back
 * until the reveal, so an attendee who reloads sees a disabled empty box above
 * "Odpowiedź zapisana". `clearSeen` wipes it on the `ended` transition, so it does not
 * outlive the session on the device.
 */
type SeenEntry = { at: number; submitted?: boolean; text?: string };

type SeenMap = Record<string, SeenEntry>;

function readSeen(storageKey: string): SeenMap {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const map: SeenMap = {};
    for (const [questionId, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A bare number is the shape this store held before it carried `submitted`. Read
      // it rather than discarding it: a device mid-question when the deploy lands would
      // otherwise restart its clock and be handed full speed weight.
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        map[questionId] = { at: value };
        continue;
      }

      if (typeof value === "object" && value !== null) {
        const entry = value as { at?: unknown; submitted?: unknown; text?: unknown };
        if (typeof entry.at === "number" && Number.isFinite(entry.at) && entry.at > 0) {
          map[questionId] = {
            at: entry.at,
            submitted: entry.submitted === true,
            // Absent on every entry written before this shipped, and on every choice
            // answer — both read back as `undefined`, which is the same as "nothing to
            // restore".
            ...(typeof entry.text === "string" ? { text: entry.text } : {}),
          };
        }
      }
    }
    return map;
  } catch {
    return {};
  }
}

function writeSeen(storageKey: string, map: SeenMap): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(map));
  } catch {
    // Private mode, quota, disabled storage. Whatever the caller computed for this page
    // load is still correct; only surviving a reload is lost.
  }
}

/**
 * The first moment this device painted this question, in epoch milliseconds.
 *
 * **This is the reload fix, and it is the whole reason the value is persisted.** FR-019
 * measures the speed component from when the question became visible on *this* device.
 * Held only in memory, that timestamp is regenerated by a reload — and a reload during a
 * fifteen-minute segment is near-certain — so reloading mid-question would hand out full
 * speed weight, to anyone who did it deliberately and to anyone who did it by accident.
 *
 * Reads back an existing value rather than overwriting it. Called on every paint of the
 * question, so it must be idempotent.
 *
 * **The residual is accepted and named**: a device that clears storage, and an attendee
 * who joins after the question opened, both start their clock now. FR-019 says the clock
 * is the device's, and a latecomer genuinely did just see the question.
 *
 * Unavailable storage degrades to "the clock starts now" — the same silent-failure
 * posture `writePlayer` takes, because a storage quirk must not stop an attendee
 * answering.
 */
export function markSeen(storageKey: string, questionId: string, now = Date.now()): number {
  const seen = readSeen(storageKey);
  const existing = seen[questionId];
  if (existing) return existing.at;

  seen[questionId] = { at: now };
  writeSeen(storageKey, seen);

  return now;
}

/**
 * Records that this device's answer to this question was accepted.
 *
 * **Persisted for the same reason the paint time is: a reload otherwise loses it.** The
 * view decides from this whether to render the reveal panel and whether to spend a
 * result fetch at all, so an attendee who answered and then reloaded would watch the
 * reveal be told nothing about themselves — no verdict, no award, and no running total,
 * all of which the server is holding and would happily serve.
 *
 * Keeps the fan-in gate intact: a device that genuinely stayed silent still has no entry
 * here, so it still issues no request.
 */
export function markSubmitted(
  storageKey: string,
  questionId: string,
  options: { text?: string; now?: number } = {}
): void {
  const seen = readSeen(storageKey);
  const existing = seen[questionId];
  const now = options.now ?? Date.now();

  seen[questionId] = {
    at: existing?.at ?? now,
    submitted: true,
    // Only for a free-text answer. A choice answer passes nothing and the key stays
    // absent, so the record does not grow a field it has no use for.
    ...(options.text === undefined ? {} : { text: options.text }),
  };
  writeSeen(storageKey, seen);
}

/** Whether this device already has an accepted answer for this question. */
export function hasSubmitted(storageKey: string, questionId: string): boolean {
  return readSeen(storageKey)[questionId]?.submitted === true;
}

/**
 * The free-text answer this device sent for this question, or `null`.
 *
 * `null` for a choice answer, for a question this device never answered, and for an
 * answer submitted before this was persisted — the view treats all three the same way:
 * there is nothing to put back in the field.
 */
export function submittedText(storageKey: string, questionId: string): string | null {
  return readSeen(storageKey)[questionId]?.text ?? null;
}

/**
 * Forgets every recorded paint time.
 *
 * **Question ids are stable across sessions**, so without this the map outlives the
 * session that wrote it: a host who purges and restarts mid-event, or an attendee
 * returning on the same phone to the next meetup, would have `markSeen` hand back a
 * timestamp from hours or weeks ago. The elapsed time is then enormous, the server
 * clamps it to the whole window, and every correct answer is worth the 0.5 floor —
 * silently, with nothing on either screen to say why.
 *
 * Called wherever `clearPlayer` is (a device whose id no longer resolves) and on the
 * `ended` transition, which is the one moment every still-watching device agrees the
 * session is over. Silent on failure, like the rest of this module.
 */
export function clearSeen(storageKey: string): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Same reasoning as `markSeen`: a storage quirk must not reach the attendee.
  }
}

/**
 * How long either request is given before it is abandoned.
 *
 * Bounds the in-flight guard below, and matches `scripts/rehearse-room.ts`, which sets a
 * deadline on every call for the same reason: a request that never returns is worse than
 * one that fails, because nothing downstream can tell the difference between the two.
 * Generous against a venue network and still well short of a host advance.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Questions with a submission currently in flight.
 *
 * **The guard is not defensive tidiness.** Two fast taps on a phone against a closing
 * question is the ordinary thing to do, and the second request would come back
 * `already-answered` — telling the attendee their own accepted answer was refused. The
 * join button carries the same guard for the same reason.
 *
 * **Keyed by question, not module-wide.** A single flag makes one slow request block the
 * *next* question too: every tap there returns instantly, and the view shows a network
 * error that is not one. The set plus the deadline above bound that to the question it
 * belongs to. (`session.ts` keeps its mutable state in a closure; a module-level `Set`
 * is the smaller version of the same idea, and this module has no factory to hang one
 * off.)
 */
const inFlight = new Set<string>();

/**
 * Submits one answer.
 *
 * The response deliberately carries no verdict, so there is nothing to return but
 * whether it landed.
 *
 * The payload is sent **raw** — the text arm ships what the attendee typed, untrimmed
 * and unfolded. The server is the only thing that parses, bounds and folds it, which is
 * what keeps one implementation of each of those rules. `boundary.test.ts` would fail a
 * client-side copy anyway, since the fold lives under `src/quiz/`.
 */
export async function submitAnswer(
  playerId: string,
  questionId: string,
  payload: AnswerPayload,
  elapsedMs: number
): Promise<SubmitOutcome> {
  if (inFlight.has(questionId)) return { outcome: "failed" };
  inFlight.add(questionId);

  const body = new FormData();
  body.set("playerId", playerId);
  body.set("questionId", questionId);
  body.set("elapsedMs", String(Math.round(elapsedMs)));

  if (payload.kind === "text") {
    body.set("text", payload.text);
  } else if (payload.kind === "number") {
    // Raw, exactly as typed — commas, spaces and all. `parseGuess` on the server owns
    // every decision about what that string means.
    body.set("value", payload.value);
  } else if (payload.kind === "word") {
    // Raw, like the two above: `validateWord` on the server trims it, bounds it, checks the
    // character set and folds it. One implementation of each of those rules, and the fold
    // could not live here anyway — it is under `src/lib/session/`, which
    // `boundary.test.ts` refuses to let a client module value-import.
    body.set("word", payload.word);
  } else {
    // Repeated field, so a multiple-choice answer needs no encoding scheme.
    for (const id of payload.optionIds) body.append("optionIds", id);
  }

  try {
    const response = await fetch("/api/quiz/answer", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.ok) return { outcome: "accepted" };

    /**
     * **A 5xx is "we could not say", never "your answer was refused."**
     *
     * The route answers `503` with a Polish message when the store is unconfigured
     * or unreachable, and in both cases nothing was written. Reading the body first
     * and trusting the message would report a store failure as a refusal — and the
     * caller treats a refusal as final, so the attendee would be told their answer
     * was saved, lose the control, and have no way back. That is the same
     * `failed`-vs-`rejected` conflation `LookupResult` documents on the server.
     */
    if (response.status >= 500) return { outcome: "failed" };

    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    if (!payload.error) return { outcome: "failed" };

    // **Only a 409 is final.** It means the answer is already recorded or the question
    // has closed — the two cases where taking the control away is correct. Every other
    // 4xx wrote nothing, so the attendee must keep the field and be able to try again.
    return response.status === 409
      ? { outcome: "rejected", error: payload.error }
      : { outcome: "invalid", error: payload.error };
  } catch {
    // Includes the timeout above: an abandoned request is a failure, not a refusal, so
    // the attendee keeps the control and can try again.
    return { outcome: "failed" };
  } finally {
    inFlight.delete(questionId);
  }
}

/**
 * Fetches this device's own result for a revealed question.
 *
 * Returns `null` on any failure, and the view must degrade to the correct answer it
 * already has from the snapshot rather than showing an error. That split — correctness
 * in the broadcast, the award per device — is the reason the design carries the ids in
 * the snapshot at all, so a failure here should cost the attendee their score line and
 * nothing else.
 */
export async function fetchResult(playerId: string, questionId: string): Promise<OwnResult | null> {
  const body = new FormData();
  body.set("playerId", playerId);
  body.set("questionId", questionId);

  try {
    const response = await fetch("/api/quiz/result", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const result = (await response.json().catch(() => null)) as OwnResult | null;
    if (result === null || typeof result.answered !== "boolean") return null;

    return result;
  } catch {
    return null;
  }
}
