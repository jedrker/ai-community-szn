import {
  normalizeAnswer,
  type MultipleChoiceQuestion,
  type NumberQuestion,
  type SingleChoiceQuestion,
  type TextQuestion,
} from "../../quiz/index";

/**
 * The project's first domain rule: what a correct answer is, and what a timely one
 * is worth (roadmap S-03, PRD FR-010 and FR-019).
 *
 * Pure — no store access, no `import.meta.env`, no route. That is what makes the rule
 * testable on its own, and it is also the seam S-05 (text) and S-06 (number) extend:
 * they add a *correctness* function beside `scoreChoiceAnswer` and reuse
 * `speedWeight` unchanged. **Both have now taken that seam** — see `scoreTextAnswer`
 * and `scoreNumberAnswer`; S-08's word cloud is unscored and takes none of it. The
 * timing rule is global and applies to every scored answer regardless of kind, so it
 * is exported separately rather than buried inside the choice scorer — a second
 * implementation of the curve would be a second thing to get wrong.
 *
 * **Deliberately not in `src/quiz/`.** CLAUDE.md records that `points` is the only
 * scoring field the definition carries and that scoring rules belong to the slices
 * that need them. `src/quiz/` stays a data contract; this is the rule that reads it.
 */

/** The two kinds `scoreChoiceAnswer` handles. Number and word-cloud are S-06/S-08. */
export type ChoiceQuestion = SingleChoiceQuestion | MultipleChoiceQuestion;

/**
 * The longest free-text answer the system accepts (roadmap S-05).
 *
 * A domain bound rather than a route detail, which is why it lives here beside
 * `SPEED_WINDOW_MS` rather than in the handler. **It has three readers and they must
 * not drift**: `answerRecordSchema`'s `.max()`, the route's visible refusal, and the
 * input's `maxlength`.
 *
 * The third reader carries a plumbing constraint worth stating at the constant rather
 * than only at the call site: `index.astro`'s `<script>` block may not value-import
 * from `src/lib/session/` (`boundary.test.ts`), so this reaches the input the way
 * `PLAYER_STORAGE_KEY` does — imported in frontmatter, passed down via `define:vars`.
 *
 * 80 is a judgement call, comfortably above the longest accepted variant in the
 * drafted quiz. Enforced in one place, it stays cheap to change.
 */
export const MAX_TEXT_ANSWER_LENGTH = 80;

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
export function speedWeight(
  elapsedMs: number,
  windowMs: number = SPEED_WINDOW_MS,
): number {
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
  windowMs: number = SPEED_WINDOW_MS,
): ChoiceScore {
  if (question.points === null) return { correct: false, awarded: 0 };

  const selected = new Set(selectedOptionIds);
  const correctIds = question.correctOptionIds;

  const correct =
    selected.size === correctIds.length &&
    correctIds.every((id) => selected.has(id));

  if (!correct) return { correct: false, awarded: 0 };

  // Rounded to the nearest integer. With POINTS = 1000 this lands in 500–1000, so
  // two attendees tie only if their clocks agreed to the millisecond-ish — which is
  // what FR-019 was added for.
  return {
    correct: true,
    awarded: Math.round(question.points * speedWeight(elapsedMs, windowMs)),
  };
}

/**
 * Free-text correctness (FR-011), weighted by the same speed curve.
 *
 * Correct when the folded answer equals any folded accepted variant. **Both sides are
 * folded** — folding only the input would make a variant the author capitalised
 * unmatchable, which is the kind of bug that looks like a wrong answer on stage.
 *
 * `normalizeAnswer`, never `normalizePolish`: the latter is the display-name claim
 * key and must not acquire a second job. See `src/quiz/normalize.ts`.
 *
 * **An unscored question yields `{ correct: false, awarded: 0 }`**, exactly as
 * `scoreChoiceAnswer` does and for the same reason — it has no correct answer to
 * match, and the view tells a warm-up apart from a wrong answer via
 * `PublicQuestion.scored`, never via `awarded === 0`.
 *
 * `speedWeight` is reused, not reimplemented. A second copy of the curve would be a
 * second thing to get wrong, which is why it is exported separately at all.
 */
export function scoreTextAnswer(
  question: TextQuestion,
  answerText: string,
  elapsedMs: number,
  windowMs: number = SPEED_WINDOW_MS,
): ChoiceScore {
  if (question.points === null) return { correct: false, awarded: 0 };

  const folded = normalizeAnswer(answerText);

  // An answer that folds to nothing matches nothing — including an accepted variant
  // that somehow folded to nothing too. The schema forbids an empty variant, so this
  // is the belt to that braces: whitespace is not an answer.
  if (folded.length === 0) return { correct: false, awarded: 0 };

  const correct = question.acceptedAnswers.some(
    (variant) => normalizeAnswer(variant) === folded,
  );

  if (!correct) return { correct: false, awarded: 0 };

  return {
    correct: true,
    awarded: Math.round(question.points * speedWeight(elapsedMs, windowMs)),
  };
}

/**
 * The relative-error bands (FR-013), highest closeness first.
 *
 * **The one place the thresholds exist.** The plan, the tests and the CLAUDE.md note
 * all quote these five rows; three copies of a threshold is how one of them ends up
 * different. `maxRelativeError` is inclusive at its upper edge, and the terminal
 * `Infinity` row is what makes the lookup total rather than a fall-through nobody
 * reads.
 *
 * **Banded, not linear, and not per-question tunable.** A host has to be able to state
 * the whole rule from the stage in one sentence — the same test that made S-05 reject
 * fuzzy text matching. And a linear curve with a generous tolerance hands most of a
 * question's points to a shrug, which flattens the leaderboard: the roadmap names that
 * as this slice's risk.
 */
export const CLOSENESS_BANDS = [
  { maxRelativeError: 0, closeness: 1 },
  { maxRelativeError: 0.05, closeness: 0.8 },
  { maxRelativeError: 0.1, closeness: 0.6 },
  { maxRelativeError: 0.25, closeness: 0.3 },
  { maxRelativeError: Number.POSITIVE_INFINITY, closeness: 0 },
] as const;

/**
 * Slack on the band comparisons, so a guess engineered to sit exactly on an edge does
 * not fall through it by floating-point luck.
 *
 * `|63.65 - 67| / 67` is not exactly `0.05` in binary, and which side it lands on
 * depends on the order of the arithmetic. The epsilon makes the edge fall consistently
 * on the generous side; it is many orders of magnitude larger than the representation
 * error at these magnitudes and many smaller than the gap between two bands, so it can
 * only ever decide an exact-edge case.
 */
const BAND_EPSILON = 1e-9;

/**
 * How much of a scored number question a guess is worth, in `[0, 1]` (FR-013).
 *
 * Relative error — `|guess − correctValue| / |correctValue|` — so the rule behaves
 * identically whether the true answer is 67 or 10,000. That magnitude-independence is
 * the PRD's whole resolution of the "30 off is catastrophic on one and a bullseye on
 * the other" objection, and it is why there is no per-question tolerance knob.
 *
 * `Math.abs` on the denominator so a future negative true value does not invert the
 * rule. A `correctValue` of zero has no relative error to speak of and yields 0 rather
 * than dividing; the schema refuses one at build time, so this is the floor under an
 * author's typo, not the guard.
 */
export function closeness(guess: number, correctValue: number): number {
  if (!Number.isFinite(guess) || !Number.isFinite(correctValue)) return 0;
  if (correctValue === 0) return 0;

  const relativeError = Math.abs(guess - correctValue) / Math.abs(correctValue);
  const band = CLOSENESS_BANDS.find(
    (row) => relativeError <= row.maxRelativeError + BAND_EPSILON,
  );

  // The terminal row matches everything finite, so this is unreachable — but `find`
  // is typed as possibly-undefined and a fabricated `1` here would be catastrophic.
  return band?.closeness ?? 0;
}

/**
 * Numeric closeness (FR-013), weighted by the same speed curve.
 *
 * **The first partial-credit answer in the system**, and the consequence is in the
 * return value: `correct` is true *only* on an exact hit, so a guess that earned 800
 * of 1000 points comes back `{ correct: false, awarded: 800 }`. No consumer may read
 * that flag as "scored nothing" — the reveal copy for this kind branches on question
 * kind and on the two numbers, never on the flag alone.
 *
 * **An unscored question yields `{ correct: false, awarded: 0 }`**, exactly as both
 * siblings do and for the same reason.
 *
 * A non-finite `guess` yields nothing. The route refuses those before they reach here
 * (one parser, server-side), so this is the defensive floor rather than the guard —
 * but `Math.round(1000 * NaN)` is `NaN` and it would be stored as an integer.
 *
 * `speedWeight` is reused, not reimplemented — that reuse is why it is exported on its
 * own at all, and `scoring.test.ts` asserts a number and a choice answer at equal
 * closeness and elapsed receive the identical award.
 */
export function scoreNumberAnswer(
  question: NumberQuestion,
  guess: number,
  elapsedMs: number,
  windowMs: number = SPEED_WINDOW_MS,
): ChoiceScore {
  if (question.points === null) return { correct: false, awarded: 0 };
  if (!Number.isFinite(guess)) return { correct: false, awarded: 0 };

  // A zero or non-finite `correctValue` is a question the rule cannot score, so it
  // claims nothing either: `{ correct: true, awarded: 0 }` for a guess of 0 against a
  // `correctValue` of 0 would be exactly the fabricated flag both siblings refuse to
  // produce. The schema refuses both at build time; this is the floor under a typo.
  if (!Number.isFinite(question.correctValue) || question.correctValue === 0) {
    return { correct: false, awarded: 0 };
  }

  const fraction = closeness(guess, question.correctValue);

  return {
    // **Strict, while the band above it is generous — and the asymmetry is deliberate.**
    // `closeness` carries `BAND_EPSILON` so a guess engineered onto an edge does not
    // fall through by floating-point luck; `correct` carries none, because it is a
    // claim about what the attendee typed, not about arithmetic. The gap between them
    // is a guess within 1e-9 relative error that is not equal: full award, `correct:
    // false`, and the reveal reads "Blisko!". That needs ~10 significant digits of
    // agreement, so no keypad reaches it — but the two lines disagree about "exact"
    // and this is the one saying so.
    correct: guess === question.correctValue,
    awarded: Math.round(
      question.points * fraction * speedWeight(elapsedMs, windowMs),
    ),
  };
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
export function clampElapsed(
  clientElapsedMs: number,
  serverElapsedMs: number,
): number {
  // A nonsense window leaves no defensible range to clamp into — most plausibly clock
  // skew between the instance that handled the advance and the one handling this
  // answer. Fail to the *floor* weight, not to zero: zero is a full award, and this
  // branch and the one below it are both "the input made no sense", so they must fail
  // in the same direction. (They did not, once: this returned 0 and handed full points
  // to a negative window.)
  if (!Number.isFinite(serverElapsedMs) || serverElapsedMs < 0)
    return SPEED_WINDOW_MS;

  // A claim that is not a number at all (a failed parse, an absent field) is treated
  // as the slowest answer the window allows rather than the fastest. Garbage should
  // not be rewarded, and there is no reading of a missing timestamp that means "fast".
  if (!Number.isFinite(clientElapsedMs)) return serverElapsedMs;

  return Math.min(Math.max(0, clientElapsedMs), serverElapsedMs);
}
