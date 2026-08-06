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
export const SESSION_PHASES = ["lobby", "question-open", "question-revealed"] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];

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

    if (state.phase === "lobby" && state.currentQuestionId !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["currentQuestionId"],
        message: 'W fazie "lobby" żadne pytanie nie może być otwarte.',
      });
    }

    if (state.phase !== "lobby" && state.currentQuestionId === null) {
      ctx.addIssue({
        code: "custom",
        path: ["currentQuestionId"],
        message: `Faza "${state.phase}" wymaga otwartego pytania.`,
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
