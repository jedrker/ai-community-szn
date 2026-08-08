import type { MultipleChoiceQuestion, SingleChoiceQuestion } from "../../quiz/index";

/**
 * The project's first domain rule: what a correct answer is, and what a timely one
 * is worth (roadmap S-03, PRD FR-010 and FR-019).
 *
 * Pure — no store access, no `import.meta.env`, no route. That is what makes the rule
 * testable on its own, and it is also the seam S-05 (text) and S-06 (number) extend:
 * they add a *correctness* function beside `scoreChoiceAnswer` and reuse
 * `speedWeight` unchanged. The timing rule is global and applies to every scored
 * answer regardless of kind, so it is exported separately rather than buried inside
 * the choice scorer — a second implementation of the curve would be a second thing to
 * get wrong.
 *
 * **Deliberately not in `src/quiz/`.** CLAUDE.md records that `points` is the only
 * scoring field the definition carries and that scoring rules belong to the slices
 * that need them. `src/quiz/` stays a data contract; this is the rule that reads it.
 */

/** The two kinds this slice scores. Text, number and word-cloud are S-05/S-06/S-08. */
export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion;

/**
 * How long an answer keeps decaying before it is worth the floor.
 *
 * Twenty seconds, and the floor is half — so an answer at 20s is still worth 500 of
 * the 1000 a question carries. Knowing beats guessing fast: the *entire* spread
 * between the fastest correct answer and the slowest is 2×, while the spread between
 * a correct answer and a wrong one is infinite. That 2× ceiling is also what bounds
 * the forged-timing risk `clampElapsed` documents below — a device that lies about
 * its clock doubles one question's award, it does not invent a score.
 */
export const SPEED_WINDOW_MS = 20_000;

/** The floor of the weight, and the fraction that decays. */
const WEIGHT_FLOOR = 0.5;

export type ChoiceScore = {
  readonly correct: boolean;
  readonly awarded: number;
};

/**
 * The speed component (FR-019), in `[0.5, 1]`.
 *
 * ```
 * weight = 0.5 + 0.5 * (1 - min(1, max(0, elapsedMs) / windowMs))
 * ```
 *
 * Linear rather than exponential because an attendee has to be able to feel the rule
 * without being told it: answering in half the window is worth three quarters, and
 * that is explainable from the stage in one sentence.
 *
 * Exported on its own because S-06's relative-error curve multiplies this same weight
 * against a partial-credit base.
 */
export function speedWeight(elapsedMs: number, windowMs: number = SPEED_WINDOW_MS): number {
  // A non-finite elapsed (NaN from a bad parse) would poison the award silently.
  // Treat it as the slowest possible answer rather than as zero: the floor is the
  // safe direction to fail in.
  if (!Number.isFinite(elapsedMs)) return WEIGHT_FLOOR;
  if (windowMs <= 0) return WEIGHT_FLOOR;

  const bounded = Math.min(1, Math.max(0, elapsedMs) / windowMs);
  return WEIGHT_FLOOR + WEIGHT_FLOOR * (1 - bounded);
}

/**
 * All-or-nothing correctness (FR-010), weighted by speed.
 *
 * Every id in `correctOptionIds` must be selected and nothing outside it — a superset
 * fails as surely as a subset, which is what "all-or-nothing" means and what stops
 * an attendee from selecting every option on a multiple-choice question.
 *
 * **An unscored question (`points === null`) yields `{ correct: false, awarded: 0 }`.**
 * It has no correct answer to match, and the attendee is told at reveal that it was a
 * warm-up — so a fabricated `correct: true` would be a lie the reveal copy would then
 * have to work around. The view distinguishes the two cases from `question.scored`
 * (`src/quiz/public.ts`), never from `awarded === 0`.
 */
export function scoreChoiceAnswer(
  question: ChoiceQuestion,
  selectedOptionIds: readonly string[],
  elapsedMs: number,
  windowMs: number = SPEED_WINDOW_MS
): ChoiceScore {
  if (question.points === null) return { correct: false, awarded: 0 };

  const selected = new Set(selectedOptionIds);
  const correctIds = question.correctOptionIds;

  const correct =
    selected.size === correctIds.length && correctIds.every((id) => selected.has(id));

  if (!correct) return { correct: false, awarded: 0 };

  // Rounded to the nearest integer. With POINTS = 1000 this lands in 500–1000, so
  // two attendees tie only if their clocks agreed to the millisecond-ish — which is
  // what FR-019 was added for.
  return { correct: true, awarded: Math.round(question.points * speedWeight(elapsedMs, windowMs)) };
}

/**
 * Reconciles what the device says with what the server can see.
 *
 * The clock is the attendee's by design (FR-019 measures from when the question
 * became visible on *that* device, not from the host's advance — a phone that got the
 * snapshot late genuinely saw the question late). The server cannot reproduce that
 * number, so it can only bound it: negatives become zero, and anything longer than
 * the question has actually been open is capped at that.
 *
 * **A device claiming `0` is undetectable, and that is an accepted risk rather than a
 * defended one.** The PRD's model is no accounts, one room, trust the people in it;
 * there is no client this project controls and no signature it could check. What
 * bounds the damage is the 2× ceiling in `speedWeight`: the best a forged timestamp
 * buys is the difference between a fast correct answer and a slow one, on a question
 * the forger still had to answer correctly.
 *
 * `serverElapsedMs` is derived from the session document's `updatedAt`, which during
 * `question-open` is the moment the question opened because only host actions write
 * it. That reasoning is restated at the call site, where it can stop holding.
 */
export function clampElapsed(clientElapsedMs: number, serverElapsedMs: number): number {
  // A nonsense window leaves no defensible range to clamp into — most plausibly clock
  // skew between the instance that handled the advance and the one handling this
  // answer. Fail to the *floor* weight, not to zero: zero is a full award, and this
  // branch and the one below it are both "the input made no sense", so they must fail
  // in the same direction. (They did not, once: this returned 0 and handed full points
  // to a negative window.)
  if (!Number.isFinite(serverElapsedMs) || serverElapsedMs < 0) return SPEED_WINDOW_MS;

  // A claim that is not a number at all (a failed parse, an absent field) is treated
  // as the slowest answer the window allows rather than the fastest. Garbage should
  // not be rewarded, and there is no reading of a missing timestamp that means "fast".
  if (!Number.isFinite(clientElapsedMs)) return serverElapsedMs;

  return Math.min(Math.max(0, clientElapsedMs), serverElapsedMs);
}
