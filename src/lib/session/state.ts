import { z } from "zod";

import { getQuestionById, quiz } from "../../quiz/index";

/**
 * What one live session *is* (roadmap F-02).
 *
 * Flow only. No players, no answers, no scores — S-02 adds players, S-03 adds
 * answers and scoring, and each of those owns its own state. Keeping this
 * document small is what keeps the snapshot broadcast cheap, since every host
 * action publishes the whole thing.
 *
 * `zod` is imported directly, not through `astro:content`: this module is read by
 * a serverless function and by `vitest`, and `astro:` specifiers resolve in
 * neither. `portability.test.ts` in this directory enforces it, for the same
 * reason `src/quiz/portability.test.ts` does. See CLAUDE.md.
 */

/**
 * The host's position in the segment.
 *
 * `lobby` is a real phase rather than an absence of one: PRD FR-002 keeps an
 * explicit start precisely so the host can gather the room before the first
 * question, and the drafted quiz's opening two questions are written for that
 * beat. A session that jumped straight to question 1 on start would remove it.
 */
export const SESSION_PHASES = [
  "lobby",
  "question-open",
  "question-revealed",
  /**
   * The segment is over (roadmap F-03).
   *
   * A real phase rather than the absence of a session, because a device must be able
   * to tell "the quiz has finished" from "the quiz has not started" — otherwise the
   * closing beat is indistinguishable from a broken screen, at the exact moment the
   * segment is meant to land.
   *
   * A session in this phase is living on `ENDED_TTL_SECONDS`, not the four-hour
   * lifetime, so this state is short-lived by construction.
   */
  "ended",
] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

/** The phases that have no open question. Everything else must have one. */
const QUESTIONLESS_PHASES: readonly SessionPhase[] = ["lobby", "ended"];

export const sessionStateSchema = z
  .object({
    /**
     * Monotonic, starting at 1. This single field carries the design: it rejects
     * lost concurrent writes in the store, orders snapshots at the client,
     * reconciles the state fetch against the subscription, and makes a failed
     * publish safely retryable.
     */
    version: z.number().int().positive(),
    phase: z.enum(SESSION_PHASES),
    /** A question id from the quiz definition, or null in the lobby. */
    currentQuestionId: z.string().nullable(),
    /** Epoch milliseconds. */
    startedAt: z.number().int().positive(),
    updatedAt: z.number().int().positive(),
    /**
     * How many attendees have joined (roadmap S-02).
     *
     * **A count, and deliberately nothing more.** Every host action publishes this
     * whole document to Ably, which retains it for ~120s irreducibly (measured — see
     * the retention contract), so a display name added here would be readable for two
     * minutes by anything holding a subscribe token, and `/api/quiz/token` is
     * deliberately open. A count carries nothing about who played. Names live in the
     * players hash; a device knows only its own.
     *
     * **Defaulted rather than required, and that is load-bearing.** A session running
     * when this ships holds a document written before the field existed. Required, it
     * would fail `parseSessionState` on the next read — a 409 on the host's next
     * action, on stage. The default makes the old document parse; the output type is
     * still `number`, so every constructor must set it.
     *
     * Freshness is the caller's job, not the schema's: `applyHostAction` overwrites
     * this on the way out. See the note there for why a stale count is acceptable
     * where a stale version is not.
     */
    playerCount: z.number().int().nonnegative().default(0),
    /**
     * The correct option ids for the question being revealed (roadmap S-03, FR-016).
     *
     * **This is the field that looks like `playerCount` above and behaves in the
     * opposite way. Read this before editing either.**
     *
     * `playerCount` is decoration on a transition: a stale value costs nothing, so it
     * is overwritten in `applyHostAction` for every action and the three state
     * constructors merely copy it. `revealedOptionIds` is *part of* the transition —
     * it is the payload of revealing — so it is set by `reveal.ts` and cleared by
     * every other transition. Injecting it in `applyHostAction` would carry the
     * previous question's answer into the next question and show it to the room.
     *
     * It rides the snapshot rather than being fetched because the correct answer is
     * quiz content, not attendee data: 150 devices already receive this document, and
     * a phone whose per-device result fetch fails still sees the right answer
     * highlighted. The award and the running total are per-player and cannot travel
     * here — same reasoning as `playerCount`'s note about Ably's ~120s retention.
     *
     * `.default(null)` for the same load-bearing reason `playerCount` carries
     * `.default(0)`: a session document written before this ships must still parse, or
     * the host's next action 409s mid-segment.
     */
    revealedOptionIds: z.array(z.string()).nullable().default(null),
    /**
     * What the room chose, published once the question is over (roadmap S-04, FR-005).
     *
     * **The third field in the "read this before editing either" comparison above, and
     * it sits on `revealedOptionIds`' side of it, not `playerCount`'s.** Like the answer
     * key, it is *part of* the transition rather than decoration on it: it is set by
     * `reveal.ts` alone and is null in every other phase. Injecting it in
     * `applyHostAction` beside `playerCount` — which is where a reader who pattern-matched
     * on "aggregate number about the room" would naturally put it — would carry the
     * previous question's distribution into the next question and publish it to 150
     * devices while that question is being answered. FR-005 was revised during shaping
     * precisely to stop that, and on screen it would look entirely correct.
     *
     * The `superRefine` clause below is the enforcement; this comment is not.
     *
     * `answered` counts people and `options` counts choices, so **on a multiple-choice
     * question the option counts sum past `answered`, and that is correct** — someone who
     * picked two options is in two of them. Anything rendering this divides by
     * `answered` and does not normalize.
     *
     * Aggregate, so it carries nothing about who played and needs none of the care
     * `playerCount`'s note describes around Ably's ~120s retention floor. It reaches
     * attendee phones on the snapshot even though nothing renders it there — a field on
     * the wire with no consumer until a later slice wants one.
     *
     * `.default(null)` for the same load-bearing reason the two fields above carry
     * defaults: a session document written before this ships must still parse, or the
     * host's next action 409s mid-segment.
     */
    revealedDistribution: z
      .object({
        answered: z.number().int().nonnegative(),
        options: z.record(z.string(), z.number().int().nonnegative()),
      })
      .nullable()
      .default(null),
    /**
     * The accepted answer for the free-text question being revealed (roadmap S-05,
     * FR-016).
     *
     * **Fourth field in the comparison above, and on `revealedOptionIds`' side of it.**
     * It is *part of* the reveal transition, so `reveal.ts` sets it and every other
     * constructor nulls it. Injected in `applyHostAction` beside `playerCount`, it would
     * carry one question's answer into the next and publish it to the room while that
     * question is still being answered. The `superRefine` clause below is the
     * enforcement; this comment is not.
     *
     * A *second* reveal field rather than a generalisation of `revealedOptionIds` into a
     * union type: that rewrite was considered and rejected because it would rewrite a
     * field S-03 had just hardened, break session documents in flight, and touch three
     * test files for no user-visible gain. **S-06 reuses this one for numbers** —
     * formatting the correct value into it — rather than adding a fifth.
     *
     * It rides the snapshot for the reason `revealedOptionIds` does: the accepted answer
     * is quiz content about a question the host has already closed, so it carries nothing
     * about who played and needs none of the care `playerCount`'s note describes around
     * Ably's ~120s retention floor. What an attendee *typed* is per-player and travels on
     * `/api/quiz/result` instead — never here.
     *
     * Carries the **first** accepted variant, not all of them: a list on screen reads as
     * though several different answers were expected.
     *
     * `.default(null)` for the same load-bearing reason the three fields above carry
     * defaults: a session document written before this ships must still parse, or the
     * host's next action 409s mid-segment.
     */
    revealedAnswerText: z.string().nullable().default(null),
  })
  .superRefine((state, ctx) => {
    // A question id is only ever assigned server-side from the quiz definition,
    // so an unknown one means the definition changed under a live session —
    // a deploy mid-segment. Catch it at the boundary rather than broadcasting a
    // question id that no device can render.
    if (state.currentQuestionId !== null && !getQuestionById(state.currentQuestionId)) {
      ctx.addIssue({
        code: "custom",
        path: ["currentQuestionId"],
        message:
          `Sesja wskazuje na pytanie "${state.currentQuestionId}", którego nie ma w definicji quizu. ` +
          "Prawdopodobnie quiz został zmieniony w trakcie trwającej sesji.",
      });
    }

    // Stated as two explicit sets rather than "lobby vs everything else". The
    // inverted form worked while `lobby` was the only questionless phase, and would
    // have silently demanded an open question from `ended` — a fourth phase must not
    // fall through a rule written for three.
    const questionless = QUESTIONLESS_PHASES.includes(state.phase);

    if (questionless && state.currentQuestionId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["currentQuestionId"],
        message: `W fazie "${state.phase}" żadne pytanie nie może być otwarte.`,
      });
    }

    if (!questionless && state.currentQuestionId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["currentQuestionId"],
        message: `Faza "${state.phase}" wymaga otwartego pytania.`,
      });
    }

    // The invariant that stops a revealed answer outliving its question. A non-null
    // value in `question-open` is the previous question's answer key, published to
    // every device in the room while that question is still being answered.
    if (state.phase !== "question-revealed" && state.revealedOptionIds !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["revealedOptionIds"],
        message: `W fazie "${state.phase}" nie można ujawniać poprawnych odpowiedzi.`,
      });
    }

    // The same invariant for the distribution, and stated as its own clause rather than
    // folded into the one above so that each field's failure names itself. A
    // distribution published while a question is open is a cheat sheet on the projector
    // for anyone who glances up — the leak FR-005 was revised to prevent. This clause,
    // not the comment on the field, is what makes "set only by reveal.ts" true.
    if (state.phase !== "question-revealed" && state.revealedDistribution !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["revealedDistribution"],
        message: `W fazie "${state.phase}" nie można pokazywać rozkładu odpowiedzi.`,
      });
    }

    // And again for the text answer, as its own clause for the same reason: each field's
    // failure should name itself. A non-null value here outside the reveal is the
    // accepted answer to a question the room is still typing into — the free-text
    // equivalent of publishing the answer key early.
    if (state.phase !== "question-revealed" && state.revealedAnswerText !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["revealedAnswerText"],
        message: `W fazie "${state.phase}" nie można ujawniać poprawnej odpowiedzi tekstowej.`,
      });
    }
  });

export type SessionState = z.infer<typeof sessionStateSchema>;

/** The lobby document a session begins life as. */
export function initialSessionState(now: number): SessionState {
  return {
    version: 1,
    phase: "lobby",
    currentQuestionId: null,
    startedAt: now,
    updatedAt: now,
    // A new session has no players by construction — `createSession` is
    // create-if-absent, so reaching here means nothing existed to hold them.
    playerCount: 0,
    // Nothing is revealed in the lobby, and unlike `playerCount` this is NOT
    // overwritten downstream — every constructor but `reveal.ts` owns its own null.
    revealedOptionIds: null,
    // Same posture, same reason: owned here, not injected downstream.
    revealedDistribution: null,
    revealedAnswerText: null,
  };
}

/**
 * The next question after `currentQuestionId`, or the first one from the lobby.
 * Returns `null` past the last question, which callers treat as a no-op rather
 * than an error — a host who taps advance once more at the end has not done
 * anything wrong.
 */
export function nextQuestionId(currentQuestionId: string | null): string | null {
  if (currentQuestionId === null) {
    return quiz.questions[0]?.id ?? null;
  }

  const index = quiz.questions.findIndex((question) => question.id === currentQuestionId);
  if (index === -1) return null;

  return quiz.questions[index + 1]?.id ?? null;
}

/**
 * The terminal document (roadmap F-03).
 *
 * Clears `currentQuestionId`, which is a consequence worth stating: the closing
 * snapshot does not name the last question. That is deliberate — the ended screen is
 * about the session, not about whatever happened to be on screen when it stopped.
 */
export function endedSessionState(current: SessionState, now: number): SessionState {
  return {
    version: current.version + 1,
    phase: "ended",
    currentQuestionId: null,
    startedAt: current.startedAt,
    updatedAt: now,
    // Carried, not recomputed. Every transition does this and every one of them is
    // then overwritten by `applyHostAction` with a freshly-read count — see the note
    // there. Copying is correct *because* it is overwritten; a constructor that tried
    // to be clever here would be the only one out of step.
    playerCount: current.playerCount,
    // Cleared, not carried — the ending snapshot is about the session, not about
    // whichever question happened to be revealed when the host closed it. The
    // schema refuses a non-null value outside `question-revealed` anyway.
    revealedOptionIds: null,
    // Cleared for the same reason, and it matters slightly more: the closing screen
    // showing the last question's bars would make the segment look like it ended
    // mid-question.
    revealedDistribution: null,
    revealedAnswerText: null,
  };
}

/** Parses a document read back from the store. Never throws. */
export function parseSessionState(
  raw: unknown
): { ok: true; state: SessionState } | { ok: false; problems: string[] } {
  const result = sessionStateSchema.safeParse(raw);
  if (result.success) return { ok: true, state: result.data };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => issue.message),
  };
}
