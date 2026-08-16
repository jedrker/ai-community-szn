import { z } from "zod";

import { getQuestionById, getQuizById } from "../../quiz/index";
import { standingsSchema, type Standings } from "./standings";

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
   * The leaderboard is on the large screen (roadmap S-07, FR-014).
   *
   * A host-controlled beat between questions rather than an automatic one after each —
   * FR-014 was revised during shaping to hand the pacing to the host, so this phase is
   * entered only by the host asking for it, and only from `question-revealed`.
   *
   * **It keeps `currentQuestionId`, and is deliberately NOT in `QUESTIONLESS_PHASES`
   * below.** That looks wrong at first read: no question is being answered while the
   * board is up. But a questionless phase carries `currentQuestionId: null`, and
   * `advance.ts` documents what that means — `nextQuestionId(null)` returns question 1,
   * so advancing from the board would REOPEN the quiz from the start, on stage, halfway
   * through the segment. `ended` needs an explicit guard in `advance.ts` for exactly this
   * reason. Keeping the id means the standings phase needs no such guard: advance reads
   * the question the room just finished and opens the one after it.
   *
   * So the id here means "the question we have just been through", not "the question
   * that is open". The schema clause below enforces that it is present; this comment is
   * not what makes it true.
   */
  "standings",
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

/**
 * The phases a leaderboard may appear in (roadmap S-07, widened by S-10).
 *
 * Two, and they are not symmetric — read `standings`' own note below before adding a
 * third. `standings` *requires* a board, because there the board is the whole phase;
 * `ended` merely *permits* one, because the closing screen must still be reachable when
 * the store could not answer. Both halves are separate `superRefine` clauses further
 * down.
 *
 * Stated as a set for the reason `QUESTIONLESS_PHASES` is: the inverted form
 * (`phase !== "standings"`) was correct while one phase carried a board, and a second
 * one must not have to be remembered in a condition written for the first.
 */
const BOARD_PHASES: readonly SessionPhase[] = ["standings", "ended"];

/**
 * What `quizId` says when the document predates the field (multiple-quizzes).
 *
 * **The obvious default is the bug.** Defaulting to a real quiz id — "the one we run",
 * "the first in the registry" — makes an in-flight document *assert* an identity it
 * never had, which is exactly the silent mis-scoring this whole change exists to
 * prevent. So the default is a sentinel that means "written before quizzes had
 * identity" and nothing else.
 *
 * It carries an underscore, which `QUESTION_ID` in `src/quiz/schema.ts` refuses, so no
 * committed quiz can ever collide with it — the sentinel is unforgeable rather than
 * merely unlikely.
 *
 * The `superRefine` clause below exempts it from the must-resolve rule and only from
 * that: a session running across the deploy still parses, so the host can advance,
 * reveal and close normally. What it cannot do is *start* a quiz — `start.ts` refuses,
 * and `bun run quiz:reset` is the documented way out (runbook step 4). That is failure
 * toward the conservative end, which is the posture `lessons.md` asks for.
 */
export const PRE_IDENTITY_QUIZ_ID = "__pre_identity__";

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
    /**
     * Which quiz this session is running (multiple-quizzes).
     *
     * **A third category of field, beside the decoration and transition fields the
     * directory's `CLAUDE.md` describes.** `playerCount` is decoration —
     * `applyHostAction` overwrites it on every action. The four reveal/board fields are
     * *part of* a transition — one owner sets them, every other constructor nulls them.
     * This is neither: it is **session identity**, written once by `createSession` and
     * copied unchanged by every constructor thereafter. Nothing may overwrite it and
     * nothing may null it; a session that changed quiz mid-flight would re-scope every
     * question id the room has already answered.
     *
     * **Defaulted rather than required, for the reason `playerCount`'s note states** — a
     * document written before this shipped must still parse, or the host's next action
     * 409s mid-segment. But the default is a *sentinel*, never a real quiz id: see
     * `PRE_IDENTITY_QUIZ_ID` above for why the obvious default is the bug. The output
     * type is still `string`, so every constructor must set it.
     *
     * **It becomes publicly readable**, through the deliberately open
     * `GET /api/quiz/state` and both `POST /api/quiz/join` success paths. That is within
     * the retention contract and it is said here rather than inherited: a slug is quiz
     * content, authored in source and printed on the projector, not attendee data. It
     * says nothing about who played.
     */
    quizId: z.string().default(PRE_IDENTITY_QUIZ_ID),
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
     * deliberately open. A count carries nothing about who played.
     *
     * **This note used to end "Names live in the players hash; a device knows only its
     * own." S-07 made that false** and the sentence is corrected here rather than deleted,
     * because a reader checking the retention guardrail should meet the reversal where the
     * old claim was. The `standings` field below publishes up to `STANDINGS_SIZE` display
     * names; everything else about who played still lives in the players hash.
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
    /**
     * The leaderboard the room is looking at (roadmap S-07, FR-014).
     *
     * **Fifth field in the comparison above, and on `revealedOptionIds`' side of it** —
     * part of a transition, not decoration on one. Injected in `applyHostAction` beside
     * `playerCount`, where a reader who pattern-matched on "aggregate fact about the room"
     * would put it, it would carry one beat's board into the next question and leave it on
     * 150 phones while that question is being answered. The `superRefine` clauses below are
     * the enforcement.
     *
     * **Two constructors set it now, not one** (roadmap S-10). It used to be
     * `src/pages/api/quiz/host/standings.ts` alone; `endedSessionState` below is the second,
     * because the closing beat lands the segment on the same board rather than on a bare
     * sentence. Everything else still nulls it, and the two that set it are the two phases
     * in `BOARD_PHASES` — one field, two owners, and no third without a clause to match.
     *
     * **This is the first snapshot field in the project to carry attendee display names,
     * and that is a decision rather than an oversight.** S-02 kept every name off the wire
     * and left the choice to this slice; the retention guardrail's Deviation 2 and
     * `leaderboard-contract.md` record what was chosen and why. The bound is what makes it
     * defensible: at most `STANDINGS_SIZE` names.
     *
     * **Be precise about the exposure, because the obvious answer is wrong.** The planning
     * for this slice reasoned only about Ably's ~2-minute connection-recovery window, and
     * that is *not* the binding surface. `GET /api/quiz/state` is deliberately
     * unauthenticated and returns this whole document — its own docstring justifies that
     * with "it returns exactly what is already broadcast", which was written when the
     * document held only a count. So these five names are readable by anyone holding the
     * attendee URL for **as long as the host leaves the board up**, since the field
     * survives on the document until the next host action. That is longer than two minutes
     * and it is a decision rather than an accident: the board is on a projector in front of
     * the room, the PRD already accepts both an open token endpoint and an unprotected host
     * view, and the alternative — stripping this field from the state route — would leave a
     * device on the connection-limit polling fallback looking at a standings phase with no
     * board in it.
     *
     * Everything else about who played stays where it was — in the players hash,
     * which `end` re-arms and `purge` deletes. (Named there rather than spelled here: the
     * registry in `keys.ts` owns every namespaced name, and `keys.test.ts` scans this file
     * for one, comments included.)
     *
     * A row carries no player id. See the note in `standings.ts` for why that is a
     * security property and not a saving.
     *
     * Unlike the three fields above, this one is required to be **non-null in its own
     * phase**. They decorate a reveal that is meaningful without them — a missing bar chart
     * beside a visible answer key. Here the board *is* the phase, so a null one is a blank
     * projector with nothing for the host to say about it; the standings route refuses the
     * transition on a failed read rather than publishing one.
     *
     * **That requirement does NOT extend to `ended`, and the asymmetry is the decision**
     * (roadmap S-10). `end` is what moves every key onto the short lifetime, so it may never
     * be refused over a board it could not read — a host who cannot close because an
     * `HGETALL` blipped is stuck in front of a room with the retention guardrail unserved.
     * A closing screen with no board falls back to the plain closing copy; a standings phase
     * with no board is a blank projector nobody asked for.
     *
     * **The exposure changes shape here, and it is accepted rather than mitigated.** In the
     * `standings` phase these names are readable for as long as the host leaves the board up;
     * on the terminal document they are readable for `ENDED_TTL_SECONDS` — bounded by a TTL
     * rather than by the host's attention, and again through the deliberately open
     * `GET /api/quiz/state`. The bound is unchanged at `STANDINGS_SIZE` names, and the same
     * names reached the same devices during the beat minutes earlier. See the PRD's retention
     * guardrail (Deviation 2) and this slice's contract.
     *
     * `.default(null)` for the same load-bearing reason as its four siblings: a session
     * document written before this ships must still parse, or the host's next action 409s
     * mid-segment.
     */
    standings: standingsSchema.nullable().default(null),
  })
  .superRefine((state, ctx) => {
    /**
     * The session's quiz must exist, and the open question must belong to *it*
     * (multiple-quizzes).
     *
     * Its own clause, in the house pattern — one clause per field, `path: ["quizId"]`,
     * a Polish message naming the field — so the failure says which fact is wrong
     * rather than pointing at `currentQuestionId` for a problem that is not its.
     *
     * **The second half is what makes `getQuestionById`'s registry-wide search safe.**
     * Question ids are globally unique, so a stored id always resolves *somewhere*; the
     * clause below is what stops it resolving into a quiz this session is not running.
     * Without it a mid-session quiz switch would score answers against another quiz's
     * question and every screen would look correct.
     *
     * The sentinel is exempt and only from the first half: a document written before
     * this field existed has no identity to check, and refusing it here would be the
     * mid-segment 409 the default exists to prevent. Its `currentQuestionId` is still
     * checked by the clause below, exactly as it was before this field existed.
     */
    const preIdentity = state.quizId === PRE_IDENTITY_QUIZ_ID;
    const runningQuiz = preIdentity ? undefined : getQuizById(state.quizId);

    if (!preIdentity && runningQuiz === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["quizId"],
        message:
          `Sesja wskazuje na quiz "${state.quizId}", którego nie ma w rejestrze. ` +
          "Prawdopodobnie quiz został usunięty w trakcie trwającej sesji.",
      });
    }

    if (
      runningQuiz !== undefined &&
      state.currentQuestionId !== null &&
      !runningQuiz.questions.some(
        (question) => question.id === state.currentQuestionId,
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["quizId"],
        message:
          `Sesja prowadzi quiz "${state.quizId}", ale otwarte pytanie ` +
          `"${state.currentQuestionId}" należy do innego quizu.`,
      });
    }

    // A question id is only ever assigned server-side from the quiz definition,
    // so an unknown one means the definition changed under a live session —
    // a deploy mid-segment. Catch it at the boundary rather than broadcasting a
    // question id that no device can render.
    if (
      state.currentQuestionId !== null &&
      !getQuestionById(state.currentQuestionId)
    ) {
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
    if (
      state.phase !== "question-revealed" &&
      state.revealedOptionIds !== null
    ) {
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
    if (
      state.phase !== "question-revealed" &&
      state.revealedDistribution !== null
    ) {
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
    if (
      state.phase !== "question-revealed" &&
      state.revealedAnswerText !== null
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["revealedAnswerText"],
        message: `W fazie "${state.phase}" nie można ujawniać poprawnej odpowiedzi tekstowej.`,
      });
    }

    // The same shape of invariant as the three above, and its own clause for the same
    // reason: each field's failure should name itself. A board outside its own phases is
    // last beat's leaderboard sitting on 150 phones under the next question — visible,
    // plausible, and wrong. Two phases may carry one as of S-10; see `BOARD_PHASES`.
    if (!BOARD_PHASES.includes(state.phase) && state.standings !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["standings"],
        message: `W fazie "${state.phase}" nie można pokazywać rankingu.`,
      });
    }

    // The half its three siblings do not have. For them a null payload is a reveal with
    // something missing; here it is the whole screen missing, so the phase is not allowed
    // to exist without a board. This is what makes the standings route's "refuse the
    // transition when the store cannot answer" structural rather than a habit of that one
    // handler.
    //
    // **`standings` only, never `ended`** — deliberately narrower than the clause above,
    // which now spans both. Widening this one to match would make a failed board read at
    // the close un-closeable, which is the one thing `end` may never be. See the field's
    // note.
    if (state.phase === "standings" && state.standings === null) {
      ctx.addIssue({
        code: "custom",
        path: ["standings"],
        message: 'Faza "standings" wymaga rankingu.',
      });
    }
  });

export type SessionState = z.infer<typeof sessionStateSchema>;

/**
 * The lobby document a session begins life as.
 *
 * `quizId` is taken rather than derived, because this is the **only** moment a
 * session's identity is decided (multiple-quizzes). Every constructor after this one
 * copies it; nothing recomputes it. A default here — "the first registry quiz", say —
 * would put the choice in two places and let the wrong one win silently.
 */
export function initialSessionState(now: number, quizId: string): SessionState {
  return {
    version: 1,
    phase: "lobby",
    quizId,
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
    // And the board, for the same reason again — a lobby has no standings to show, and
    // the schema refuses one here anyway.
    standings: null,
  };
}

/**
 * Where advancing goes next, **within the session's own quiz** (multiple-quizzes).
 *
 * Three outcomes rather than a nullable string, and the split is the point.
 * `end-of-quiz` is the documented no-op — a host who taps advance once more at the end
 * has not done anything wrong, and an error on stage would read as a fault. `unresolved`
 * is a different fact entirely: the session names a quiz that is not in the registry, or
 * an open question that belongs to some *other* quiz. Returning `null` for both, as this
 * used to, let the second arrive at `advance.ts` as a silent 200 — the room stays put,
 * the host taps again, and nothing anywhere says the document and the registry disagree.
 *
 * The `quizId` clause in `sessionStateSchema` above is what makes `unresolved`
 * unreachable through a parsed document. This function does not absorb it as well:
 * a guard and the state it guards against should not both be invisible.
 */
export type NextQuestion =
  | { outcome: "next"; questionId: string }
  | { outcome: "end-of-quiz" }
  | { outcome: "unresolved"; reason: string };

export function nextQuestionId(
  quizId: string,
  currentQuestionId: string | null,
): NextQuestion {
  const quiz = getQuizById(quizId);
  if (quiz === undefined) {
    return {
      outcome: "unresolved",
      reason: `quiz "${quizId}" is not in the registry`,
    };
  }

  // From the lobby: the first question of *this* quiz. A quiz with no questions cannot
  // be committed (`quizSchema` requires at least one), so this is end-of-quiz only in
  // the sense that there is nowhere to go.
  if (currentQuestionId === null) {
    const first = quiz.questions[0];
    return first === undefined
      ? { outcome: "end-of-quiz" }
      : { outcome: "next", questionId: first.id };
  }

  const index = quiz.questions.findIndex(
    (question) => question.id === currentQuestionId,
  );
  if (index === -1) {
    return {
      outcome: "unresolved",
      reason: `question "${currentQuestionId}" does not belong to quiz "${quizId}"`,
    };
  }

  const next = quiz.questions[index + 1];
  return next === undefined
    ? { outcome: "end-of-quiz" }
    : { outcome: "next", questionId: next.id };
}

/**
 * The terminal document (roadmap F-03, extended by S-10).
 *
 * Clears `currentQuestionId`, which is a consequence worth stating: the closing
 * snapshot does not name the last question. That is deliberate — the ended screen is
 * about the session, not about whatever happened to be on screen when it stopped.
 *
 * **`standings` is the one thing it now carries rather than clears** (roadmap S-10,
 * FR-006). The closing beat lands the segment on the winner instead of on a bare
 * sentence, so `end.ts` reads the board inside its transition and passes it here.
 *
 * **Optional, defaulting to `null`, and that default is the failure path rather than a
 * convenience.** A board read that could not answer must still end the session — the
 * close is what moves every key onto the short lifetime — so the caller passes nothing
 * and the room gets the plain closing screen. The schema permits a boardless `ended`
 * for exactly this; see the `standings` field's note.
 */
export function endedSessionState(
  current: SessionState,
  now: number,
  standings: Standings | null = null,
): SessionState {
  return {
    version: current.version + 1,
    phase: "ended",
    // Copied, never recomputed — a session's identity is decided once, at creation. It
    // survives the close because the terminal document is still *this* session's, and
    // the reload window F-03 chose has to be able to say which quiz it was.
    quizId: current.quizId,
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
    /**
     * **NOT cleared like the three above — this is what S-10 decided** (FR-006).
     *
     * It is the board this transition was handed, not the one `current` happened to be
     * showing: ending from a `standings` beat must not freeze the room on a leaderboard
     * computed before the last answers landed. `end.ts` reads a fresh one, and `null`
     * from a failed read is a plain closing screen rather than a refused close.
     */
    standings,
  };
}

/** Parses a document read back from the store. Never throws. */
export function parseSessionState(
  raw: unknown,
): { ok: true; state: SessionState } | { ok: false; problems: string[] } {
  const result = sessionStateSchema.safeParse(raw);
  if (result.success) return { ok: true, state: result.data };

  return {
    ok: false,
    problems: result.error.issues.map((issue) => issue.message),
  };
}
