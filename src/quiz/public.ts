import { quizzes } from "./index";
import type { Question, Quiz } from "./schema";

/**
 * The quiz as a browser is allowed to see it (roadmap S-02).
 *
 * The quiz object holds `correctOptionIds`, `acceptedAnswers` and `correctValue`
 * alongside the prompts. Handing it to a phone would put every answer in the page
 * source of a view whose whole purpose is to ask the questions.
 *
 * **Built by allowlist, never by deletion.** Picking the fields that may travel means
 * a field added to `schema.ts` later is invisible here by default. Deleting the known
 * answer fields would mean the opposite: the next answer-bearing field ships to 150
 * devices until someone remembers this file. The two read almost identically and fail
 * in opposite directions, which is why this note exists.
 *
 * `points` is deliberately absent too. It is not an answer, but what an attendee is
 * told about scoring is S-03's decision, and there is no reason for this slice to make
 * it by accident.
 *
 * **S-03 took that decision, in its narrowest form: `scored`, a boolean.** Whether a
 * question is worth anything travels; how much it is worth does not. See the field.
 */

export type PublicOption = {
  readonly id: string;
  readonly text: string;
};

/**
 * `kind` travels because the view renders differently per question type, and it
 * reveals nothing: an attendee can see they are looking at a multiple-choice question
 * by looking at it.
 */
export type PublicQuestion = {
  readonly id: string;
  readonly kind: Question["kind"];
  readonly prompt: string;
  /**
   * Whether this question is worth points at all (`points !== null`, FR-017).
   *
   * **Without it the attendee view cannot deliver FR-017's warm-up copy at all.** The
   * result payload for an unscored question is `{ correct: false, awarded: 0 }` —
   * byte-identical to a wrong answer on a scored one — so a view inferring "warm-up"
   * from `awarded === 0` would tell every latecomer who answered the drafted Q2, the
   * beat that exists to gather the room, that they got it wrong.
   *
   * A boolean, not the value: `points` stays in `FORBIDDEN_KEYS` and the point value
   * still does not travel.
   */
  readonly scored: boolean;
  /**
   * How long this question accepts answers, in seconds (S-11) — present exactly when
   * `scored` is true, because the schema requires a limit on a scored question and
   * refuses one on an unscored question.
   *
   * **This one travels because the room is meant to see it.** Every other value the
   * allowlist above holds back is something an attendee could use to answer; a
   * countdown is the opposite — it is only useful if it is on screen, and both the
   * phone and the projector compute their clock from this plus the snapshot's
   * `updatedAt`. `points` stays forbidden, so how much a question is worth still does
   * not travel with how long it lasts.
   *
   * What deliberately does *not* travel is the server's grace window: the enforced
   * cutoff sits a couple of seconds past the visible zero so an answer already in
   * flight is not lost, and a client that knew the grace would show a clock that lies
   * in the generous direction. See `src/lib/session/deadline.ts`.
   */
  readonly timeLimitSeconds?: number;
  /** Present for the two choice kinds; absent for text, number and word-cloud. */
  readonly options?: readonly PublicOption[];
};

export type PublicQuiz = {
  /**
   * The quiz's slug (multiple-quizzes).
   *
   * It travels because the phone needs something to compare against the session
   * snapshot's `quizId` — a device left on the wrong quiz is otherwise indistinguishable
   * from a device waiting in the lobby.
   */
  readonly id: string;
  /** Shown in the lobby, and named in the message a phone on the wrong quiz sees. */
  readonly title: string;
  /**
   * **`code` deliberately does not travel.** It is a routing concern — how an attendee
   * *arrives* — and nothing on a phone needs it once the phone is here.
   */
  readonly questions: readonly PublicQuestion[];
};

/**
 * A tiny deterministic hash (FNV-1a, 32-bit), used to seed the option shuffle below.
 *
 * Not a security primitive and not required to be one — it decides a display order,
 * and the thing it defends against is an attendee noticing that the first option keeps
 * being right, not an attendee reverse-engineering a seed. It is here rather than
 * `Math.random` because the order must be **identical on every device and on the
 * server**: the host's large screen and 150 phones have to agree about which option is
 * which, and a per-render random order would put them out of step.
 */
/**
 * Mixed into every seed so the permutation set can be re-rolled without touching a
 * single question id.
 *
 * The generator is uniform — measured at 25.0/24.9/25.0/24.9% across four positions
 * over 20,000 seeds — but uniform does not mean every *draw* is well spread, and 14
 * questions is a small sample. The first value tried put the correct answer at index 2
 * or 3 in all eight single-choice questions: a 0.4% draw, and one an attendee could
 * notice as "never the first two". Salt `2` spreads them evenly, two per position.
 *
 * **`public.test.ts` asserts that spread, so this is enforced rather than hoped for.**
 * If a future question is added and the draw goes bad, that test fails and the fix is
 * to bump this number until it passes. That is a legitimate use of a magic constant:
 * the property is checked, the knob is documented, and the alternative is hand-editing
 * option order forever.
 */
const SHUFFLE_SALT = "2";

function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Order-preserving-per-question shuffle, seeded by the question id.
 *
 * **Why this exists.** The drafted quiz has its correct answer first in six of eight
 * single-choice questions, and at indices 0 and 1 in the only scored multi-answer one.
 * An attendee who always tapped the first option would score most of the segment. That
 * bias is invisible when reading `definition.ts` — nobody spots positional correlation
 * in a list of four — so fixing the instance by hand would just be waiting for the next
 * question set to reintroduce it. Shuffling here fixes the class: any quiz authored the
 * same way is safe automatically, and the author owes no ordering discipline.
 *
 * A Lehmer generator seeded from the id, so the permutation is stable for a given
 * question and different across questions. Deterministic means the order survives a
 * reload, agrees between the phone and the projector, and can be recomputed anywhere.
 *
 * **S-04 must render distributions from the projection, not from the definition.** The raw
 * definition's order is no longer what the room saw, and a distribution chart drawn in
 * definition order would mislabel every bar.
 */
function shuffleOptions<T>(options: readonly T[], seed: number): T[] {
  const shuffled = [...options];

  // Constrained to [1, 0x7ffffffe]: a Lehmer generator is a fixed point at 0, and the
  // modulus itself is out of range. `seedFrom` returns a full uint32, which is wider.
  let state = (seed % 0x7ffffffe) + 1;

  const nextRandom = (): number => {
    // Plain multiplication, NOT `Math.imul` — `imul` returns a *signed* 32-bit result,
    // so it goes negative for most states here, and `% 0x7fffffff` of a negative is
    // negative. That produced negative indices below and left holes in the array,
    // which showed up as options rendering as `undefined`. The product tops out at
    // 2^31 * 48271 < 2^47, comfortably inside the 2^53 a double represents exactly,
    // so ordinary arithmetic is both correct and exact.
    state = (state * 48271) % 0x7fffffff;
    return state / 0x7fffffff;
  };

  // Fisher-Yates, walked from the end.
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return shuffled;
}

function toPublicQuestion(question: Question): PublicQuestion {
  const base = {
    id: question.id,
    kind: question.kind,
    prompt: question.prompt,
    // Whether, never how much. `points` itself remains forbidden.
    scored: question.points !== null,
    // Spread rather than assigned, so an unscored question has no `timeLimitSeconds`
    // key at all instead of one holding `undefined`. The two serialize identically and
    // differ under `in` and `Object.keys`, which is what a view checking for a clock
    // would reach for.
    ...(question.timeLimitSeconds === undefined
      ? {}
      : { timeLimitSeconds: question.timeLimitSeconds }),
  } as const;

  // The only kinds with anything more to show. `text`, `number` and `word-cloud` are
  // answered into an empty field, so the prompt is the whole of what a device needs —
  // and `acceptedAnswers` / `correctValue` therefore never come near this function.
  if (
    question.kind === "single-choice" ||
    question.kind === "multiple-choice"
  ) {
    const projected = question.options.map((option) => ({
      id: option.id,
      text: option.text,
    }));
    return {
      ...base,
      options: shuffleOptions(
        projected,
        seedFrom(`${question.id}:${SHUFFLE_SALT}`),
      ),
    };
  }

  return base;
}

/**
 * The projection, over any quiz.
 *
 * Parameterised for the reason `forbiddenAnswerValues` is: the shuffle's *properties* —
 * no positional tell, a different permutation per question, the same one every time —
 * are only observable across a large set of questions, and the committed quiz is a small
 * one that is meant to change. Tests measure the distribution over generated questions
 * and keep the real quiz for conformance.
 *
 * Production has exactly one caller, `publicQuizzes` below, which computes once at
 * module scope so a serverless function pays for it on cold start rather than per
 * request — the same reasoning as `quizzes` itself in `index.ts`.
 */
export function projectQuiz(source: Quiz): PublicQuiz {
  return {
    id: source.id,
    title: source.title,
    questions: source.questions.map(toPublicQuestion),
  };
}

/**
 * Every quiz's projection, in registry order — projected once at module scope, not per
 * request, for the reason `quizzes` itself is parsed once.
 *
 * The registry is small and every entry is committed source, so all of them are
 * projected eagerly rather than memoized per slug: a lazy cache would buy nothing on a
 * cold start and would add a second place where a projection could be stale.
 */
export const publicQuizzes: readonly PublicQuiz[] = quizzes.map(projectQuiz);

/** One quiz's projection by slug, or `undefined` for a slug not in the registry. */
export function getPublicQuizById(id: string): PublicQuiz | undefined {
  return publicQuizzes.find((quiz) => quiz.id === id);
}

/**
 * The public shape of one question, or `undefined` if the id is unknown.
 *
 * Searches the whole registry, quiz-agnostic for exactly the reason `getQuestionById`
 * is: the build gate makes question ids globally unique.
 */
export function getPublicQuestionById(id: string): PublicQuestion | undefined {
  for (const quiz of publicQuizzes) {
    const question = quiz.questions.find((candidate) => candidate.id === id);
    if (question !== undefined) return question;
  }
  return undefined;
}

/**
 * Answer values that must not appear in the projection at all.
 *
 * **Deliberately excludes `correctOptionIds`.** Those are option ids, and the options
 * themselves have to travel — an attendee cannot pick an answer that was never sent.
 * So the correct option's id *is* present in the projection, necessarily, and a test
 * that asserted otherwise would be asserting the feature away.
 *
 * What must hold for choice questions instead is that nothing in the projection says
 * *which* id is the right one: no answer-bearing key, and no positional tell. Those
 * are checked separately in `public.test.ts`.
 *
 * Reaching into the real definitions rather than a fixture is the point — a fixture
 * keeps passing after someone adds a new answer-bearing field to a real quiz. It
 * defaults to the **whole registry** for the same reason: a value that is an answer in
 * one quiz must not appear in any projection.
 */
export function forbiddenAnswerValues(
  sources: readonly Quiz[] = quizzes,
): string[] {
  const values: string[] = [];

  for (const source of sources) {
    for (const question of source.questions) {
      if (question.kind === "text") {
        values.push(...question.acceptedAnswers);
      }
      if (question.kind === "number") {
        values.push(String(question.correctValue));
      }
    }
  }

  return values;
}

/** Keys that may never appear anywhere in the serialized projection. */
export const FORBIDDEN_KEYS = [
  "correctOptionIds",
  "acceptedAnswers",
  "correctValue",
  "points",
] as const;
