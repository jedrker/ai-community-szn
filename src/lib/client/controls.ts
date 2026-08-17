/**
 * The host panel's phase-to-verb decision, as pure logic that can actually be tested
 * (test-plan rollout phase 1, Risks #1 and #2).
 *
 * **This module exists for the reason `countdown.ts` does.** The rule it owns lived inline
 * in the host page's `<script>` block (`src/pages/quiz/host/[slug].astro`), and an Astro
 * inline script has no
 * harness — so the only guard available over "which button is live in which phase" was a
 * source-text scan of the table's own literal. A scan for an expression that exists today
 * certifies whatever is there, defects included (`lessons.md`), and the property that
 * actually matters is not textual: *the panel must never offer a verb the route refuses.*
 * That is a statement about the routes, and it cannot be checked by reading this file's
 * source. It can be checked by running this function, which is what `controls.test.ts` does.
 *
 * **The table is private on purpose.** `host/[slug].test.ts` used to assert that `CONTROL_RULES`
 * was read from exactly one place; exporting a function instead of the table makes a second
 * reader unrepresentable rather than merely forbidden, which is why that guard is retired
 * here rather than re-expressed.
 *
 * May not value-import from `src/quiz/` or `src/lib/session/` (`boundary.test.ts`), and does
 * not: `SessionPhase` and `PublicQuestion` arrive as `import type`, erased at build.
 */

import type { PublicQuestion } from "../../quiz/public";
import type { SessionPhase } from "../session/state";

/**
 * The five verbs the host can reach. `end` is one of them **since this extraction** — its
 * phase rule used to sit inline in `syncEndButton`, which meant the panel's phase rules
 * were two mechanisms and only one of them was ever stated in a table.
 *
 * Its *arming* state is deliberately still on the page: the two-tap confirmation is about a
 * mis-click, not about legality, and it needs the DOM and the session version. What moved is
 * only the question this module answers for the other four — may the host press it here.
 */
export type FlowAction = "start" | "advance" | "reveal" | "standings" | "end";

/**
 * The key the decision is read under when there is no session yet — before the first
 * `start`, and after a purge or an expiry. A real key rather than a null branch, so the
 * table answers every state the view can be in and no phase falls through to "whatever was
 * on screen before".
 */
export const NO_SESSION = "none";

export type ControlPhase = SessionPhase | typeof NO_SESSION;

export type Decision = {
  /** The verbs that are live. Everything else on the bar is dark. */
  readonly allow: readonly FlowAction[];
  /** The single verb ringed as the step the session is waiting for, if any. */
  readonly next: FlowAction | null;
  /**
   * Why a verb the host might reach for is not live, keyed by action. Every action absent
   * from `allow` carries one, so a dark button is never silent about itself.
   */
  readonly why: Partial<Record<FlowAction, string>>;
};

type PhaseRule = Decision;

type ControlRule = PhaseRule & {
  /**
   * The same row, read instead once the current question is the **last** one.
   *
   * **A second dimension of the table rather than a condition beside a button**, for the
   * reason the table exists at all: `advance` is a no-op past the last question
   * (`advance.ts` returns null when `nextQuestionId` does), so the panel was ringing `dalej`
   * as the next step and answering the tap with "nic do zrobienia". The phase alone cannot
   * see that — `question-revealed` on question 3 and on question 14 are the same phase and
   * want opposite bars.
   *
   * **`end` is not subject to it.** The four flow verbs collapse to nothing on the last
   * `question-revealed`; the closing verb stays allowed there, because that is exactly the
   * beat where it becomes the only step left and takes the next-step ring. Collapsing all
   * five uniformly would disable the one control the host needs on the final question.
   */
  readonly whenLast?: PhaseRule;
};

const ALREADY_RUNNING = "Sesja już trwa.";
const NOT_STARTED = "Sesja nie została jeszcze rozpoczęta.";
const ALREADY_ENDED = "Sesja została zakończona.";
const NEEDS_REVEAL = "Ranking można pokazać dopiero po ujawnieniu odpowiedzi.";
const NO_MORE_QUESTIONS = "To było ostatnie pytanie — zakończ sesję.";
const FINAL_BOARD_ON_END = "Końcowe wyniki pokaże zakończenie sesji.";
const REVEAL_ALREADY_SHOWN =
  "Odpowiedź jest już pokazana — przejdź do następnego pytania.";
const STANDINGS_ALREADY_SHOWN =
  "Ranking jest już pokazany — przejdź do następnego pytania.";

/**
 * The closing verb's own refusals. Nothing renders them today — the button carries no
 * `title` — but they are stated here rather than left blank so that `end` answers the same
 * question every other verb does, and so a phase can never be added with the closing button
 * silently dark and nothing to say why.
 *
 * `lobby` is the one refusal the *route* would not give: a session nobody has played is
 * closed from the terminal, not by the one control on this page that cannot be undone.
 */
const END_NOTHING_PLAYED =
  "Nikt jeszcze nie odpowiadał — nie ma czego podsumować.";
const END_NEEDS_REVEAL = "Najpierw pokaż odpowiedź, potem zakończ sesję.";

/**
 * WHICH VERB IS OFFERED IN WHICH PHASE, AND WHICH ONE IS THE NEXT STEP.
 *
 * S-07 wrote the principle on the standings button alone: *disabled everywhere else rather
 * than relying on the route's 409 — the refusal is the backstop, not the interaction*.
 * `start`, `advance` and `reveal` never got it, so the host could tap `pokaż odpowiedź` in
 * the lobby and be answered by an error. This table extends the rule to all five verbs and
 * adds `next`, the one button highlighted as the step the session is waiting for.
 *
 * `allow` is a **subset** of route legality (`src/pages/api/quiz/host/*`), never an equality —
 * three rows offer less than the route accepts, and each is deliberate. Two more look
 * inconsistent and are not:
 *
 * - **`advance` stays offered while a question is open.** It is the host's only lever on
 *   stage: if something appears on the projector that should not be there, the way out is to
 *   advance past it. It is simply not the *next* step there.
 * - **`standings` is offered in the `standings` phase too**, where the route treats it as a
 *   no-op that re-broadcasts. That is the recovery path its own 502 asks for — "Ranking jest
 *   zapisany, ale nie dotarł do urządzeń. Kliknij ponownie…" — and the state is already
 *   `standings` by the time the host reads it, so gating it out of that phase took away the
 *   retry the message names.
 * - **`start` is offered only with no session.** The route is create-if-absent and
 *   idempotent, so tapping it mid-quiz does nothing; an enabled button that does nothing is
 *   the thing this table exists to remove.
 *
 * The three places the panel withholds a verb the route would act on are pinned by name in
 * `controls.test.ts`'s `MATERIAL_WITHHOLDINGS`, so one can be added or removed only on
 * purpose.
 */
const CONTROL_RULES: Record<ControlPhase, ControlRule> = {
  [NO_SESSION]: {
    allow: ["start"],
    next: "start",
    why: {
      advance: NOT_STARTED,
      reveal: NOT_STARTED,
      standings: NOT_STARTED,
      end: NOT_STARTED,
    },
  },
  lobby: {
    allow: ["advance"],
    next: "advance",
    why: {
      start: ALREADY_RUNNING,
      reveal: "Żadne pytanie nie jest otwarte — nie ma czego pokazać.",
      standings: NEEDS_REVEAL,
      end: END_NOTHING_PLAYED,
    },
  },
  "question-open": {
    allow: ["advance", "reveal"],
    next: "reveal",
    why: {
      start: ALREADY_RUNNING,
      standings: NEEDS_REVEAL,
      end: END_NEEDS_REVEAL,
    },
    // The lever is gone on the last question — there is nothing to advance *to* — but the
    // reveal is still the step the room is waiting for.
    whenLast: {
      allow: ["reveal"],
      next: "reveal",
      why: {
        start: ALREADY_RUNNING,
        advance: NO_MORE_QUESTIONS,
        standings: NEEDS_REVEAL,
        end: END_NEEDS_REVEAL,
      },
    },
  },
  "question-revealed": {
    allow: ["advance", "standings", "end"],
    next: "advance",
    why: { start: ALREADY_RUNNING, reveal: REVEAL_ALREADY_SHOWN },
    /**
     * The last question's `question-revealed` offers no *flow* verb at all: `dalej` does
     * nothing, and the closing beat publishes the final board itself (S-10), so a separate
     * `pokaż ranking` is a board the room is about to be shown again. The one way on is
     * `zakończ sesję i pokaż wyniki` — which is why `end` survives the collapse and takes
     * `next` here.
     */
    whenLast: {
      allow: ["end"],
      next: "end",
      why: {
        start: ALREADY_RUNNING,
        advance: NO_MORE_QUESTIONS,
        reveal: REVEAL_ALREADY_SHOWN,
        standings: FINAL_BOARD_ON_END,
      },
    },
  },
  standings: {
    allow: ["advance", "standings", "end"],
    next: "advance",
    why: { start: ALREADY_RUNNING, reveal: STANDINGS_ALREADY_SHOWN },
    /**
     * Unreachable going forward — the row above no longer offers `pokaż ranking` on the last
     * question, so nothing can enter this phase there. Written anyway: a session that was
     * already standing on the last question's board when this shipped still renders through
     * this table, and the fallback row would offer it a `dalej` that does nothing.
     */
    whenLast: {
      allow: ["end"],
      next: "end",
      why: {
        start: ALREADY_RUNNING,
        advance: NO_MORE_QUESTIONS,
        reveal: STANDINGS_ALREADY_SHOWN,
        standings: FINAL_BOARD_ON_END,
      },
    },
  },
  ended: {
    allow: [],
    next: null,
    why: {
      start: ALREADY_ENDED,
      advance: ALREADY_ENDED,
      reveal: ALREADY_ENDED,
      standings: ALREADY_ENDED,
      end: ALREADY_ENDED,
    },
  },
};

/**
 * The decision for one phase and one question position.
 *
 * `atLast` is a second dimension rather than a phase of its own — see `whenLast`. The
 * runtime fallback to the sessionless row is deliberate despite the `Record` making it
 * unreachable to a type-checker: this is called with a phase off the wire, and a document
 * written by a future deploy must leave the panel refusing rather than offering everything.
 */
export function verbsFor(phase: ControlPhase, atLast: boolean): Decision {
  const base = CONTROL_RULES[phase] ?? CONTROL_RULES[NO_SESSION];
  return (atLast ? base.whenLast : undefined) ?? base;
}

/**
 * Whether the session has run out of questions — the client's reading of `nextQuestionId`
 * (`src/lib/session/state.ts`), which is what decides whether `advance` does anything at all.
 *
 * **From the published order the page already holds**, the same list the top strip's
 * `pytanie N z M` counter counts through, so the panel and the route cannot disagree about
 * where the end is. A field on the snapshot would be a second copy of a fact the definition
 * already states.
 *
 * `false` with no current question: that is the lobby, where question 1 is still ahead — and
 * `ended`, whose row offers nothing either way. `false` for an id that is not in the list, so
 * a snapshot naming a question this build does not have cannot read as the end of the quiz.
 */
export function atLastQuestion(
  questions: readonly PublicQuestion[],
  currentQuestionId: string | null,
): boolean {
  if (currentQuestionId === null) return false;

  const at = questions.findIndex(
    (candidate) => candidate.id === currentQuestionId,
  );
  return at >= 0 && at === questions.length - 1;
}

export type PollTarget = {
  readonly kind: "participation" | "words" | "lobby";
  readonly questionId: string | null;
  readonly url: string;
};

/**
 * What `pollTargetFor` needs off the snapshot, and nothing more.
 *
 * **`phase` is the exhaustive union, not `string`**, so the two halves of this module fail the
 * same way. A renamed or dropped `SessionPhase` member breaks `CONTROL_RULES` and the test's
 * `ROUTE_OUTCOMES` at `astro check` — deliberately — while a stringly-typed `phase` would leave
 * `pollTargetFor` comparing against a literal that no longer exists. The panels and the poll would
 * both go quiet on a green build, which is precisely the "data path with no affordance" failure
 * this function's own docblock says it exists to prevent.
 */
export type PollState = {
  readonly phase: ControlPhase;
  readonly currentQuestionId: string | null;
};

/**
 * **ONE predicate governs both the panels and the poll**, and it is written once (extended by
 * roadmap S-08 from a boolean to a target).
 *
 * Two conditions would mean the poll runs for a question whose panel is not rendered —
 * feeding nothing, from an endpoint that can only ever return zero. A data path with no
 * affordance is the mirror of `lessons.md`'s first rule, and it fails just as quietly:
 * nothing is wrong on screen, and the command counter climbs.
 *
 * **One loop serves all three endpoints**, chosen here by phase and then by question kind. A
 * second timer was the alternative and it is the failure `host.astro` guards hardest against:
 * two loops mean two backoffs, two in-flight flags, and two chances to leave a timer running
 * for a panel that is no longer on screen.
 *
 * Returns `null` when nothing should be polled, which is also what hides both panels.
 */
export function pollTargetFor(
  questions: readonly PublicQuestion[],
  state: PollState | null,
): PollTarget | null {
  if (state === null) return null;

  /**
   * THE LOBBY'S JOIN COUNT — the third target, and the one with no panel of its own.
   *
   * A join publishes nothing: 150 joins fanning out to 150 subscribers is the O(N²) shape
   * the spine contract forbids, so `playerCount` on the snapshot only ever moves on a host
   * action. In every other phase that is invisible, because the host acts often and the
   * participation poll carries a live count of its own while a question is open — but the
   * lobby is exactly the phase where the host acts *last* and the number changes *most*, so
   * the figure beside `dołączyło` sat frozen at whatever it was when `start` landed until
   * somebody pressed `odśwież`.
   *
   * So the lobby polls the same open endpoint the refresh button uses, through the same one
   * loop. `/api/quiz/state` needs no secret — it returns exactly what is broadcast anyway —
   * so this target cannot reach the 401 branch in `runPoll`.
   */
  if (state.phase === "lobby") {
    return { kind: "lobby", questionId: null, url: "/api/quiz/state" };
  }

  const questionId = state.currentQuestionId;
  if (questionId === null) return null;

  const kind = questions.find((candidate) => candidate.id === questionId)?.kind;
  const query = `?questionId=${encodeURIComponent(questionId)}`;

  /**
   * The word cloud runs in **both** `question-open` and `question-revealed`, unlike the
   * participation count. FR-005 keeps the distribution off the screen until the reveal
   * because it is a cheat sheet while answering is open; the cloud has no correct answer to
   * leak (FR-005's own scope note says so), so the only reason to stop is that there is
   * nothing left to read — which is what `cloudFinalReadFor` decides, not this.
   */
  if (kind === "word-cloud") {
    if (
      state.phase !== "question-open" &&
      state.phase !== "question-revealed"
    ) {
      return null;
    }
    return { kind: "words", questionId, url: `/api/quiz/host/words${query}` };
  }

  /**
   * The count runs while the question is open, for **every kind that takes an answer**.
   *
   * The phase half is S-04's and unchanged: FR-005 keeps the distribution off the screen until
   * the reveal, and the count's panel goes with the question.
   *
   * **The kind half used to be `single-choice` or `multiple-choice`, and that was a scope seam
   * mistaken for a rule.** The free-text slice excluded "S-04's participation count or answer
   * distribution" in one clause, and the reasoning it gave was about the *distribution* — a
   * text answer has no bars, which is still true. The count travelled with it by accident. It
   * was never a limit on what could be counted: `SUBMIT_ANSWER` bumps `answered:<questionId>`
   * for every accepted answer, before it touches an option field at all, and
   * `/api/quiz/host/participation` reads only that. So this line was withholding a figure the
   * store had already been keeping — on the questions where the host most needs it, since a
   * typed answer takes longer than a tap and there is nothing else to judge the moment by.
   *
   * The bars stay away on their own: `reveal.ts` builds `revealedDistribution` only for the
   * choice kinds, and `host.astro` hides that panel on `distribution === null` rather than on a
   * kind of its own. **Do not answer a future "text questions must not show bars" with a kind
   * test here** — that would be the second condition this predicate exists to prevent.
   *
   * `word-cloud` never reaches this line (it returned above), so the only exclusion left is
   * the one that has to stay: a question with **no kind at all**, which is a question this
   * build does not have. That is not a kind test — it is the "fail toward nothing" the
   * predicate gives an unknown phase, and it stopped being implied the moment the kind list
   * went away. A host tab that outlived a deploy must poll no endpoint rather than the wrong
   * one; without this it would poll `participation` for an id the route answers with a 400,
   * every 2.5 s, for as long as the tab is open. `controls.test.ts` caught exactly this.
   */
  if (state.phase !== "question-open") return null;
  if (kind === undefined) return null;

  return {
    kind: "participation",
    questionId,
    url: `/api/quiz/host/participation${query}`,
  };
}
