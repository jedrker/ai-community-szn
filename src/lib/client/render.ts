import type { StandingsRow } from "../session/standings";
import type { PublicQuestion } from "../../quiz/public";

/**
 * The DOM helpers both views share (roadmap S-02).
 *
 * No framework was installed — see `session.ts` for why — so hand-written DOM updates
 * are the cost of that decision. This module is where it is paid once instead of per
 * view. It is deliberately small: three helpers and a question renderer, not the
 * beginnings of a framework.
 *
 * `PublicQuestion` is a **type-only** import. Value-importing anything from `src/quiz/`
 * would ship all fourteen questions' `correctOptionIds`, `acceptedAnswers` and
 * `correctValue` in the attendee bundle — the exact leak the public projection exists to
 * prevent. `boundary.test.ts` enforces it. The projection itself reaches the page as
 * data through `define:vars`.
 */

/**
 * Polish, because it renders directly.
 *
 * Worded for the *gap between two questions*, which is the case that reaches here during a
 * live session. A caller whose absent question means something else — the host view with no
 * session at all, where the fix is an action the host has to take — passes its own
 * `missingText` instead, because "za chwilę" is a promise nothing is going to keep there.
 */
const MISSING_QUESTION_TEXT = "Za chwilę pojawi się kolejne pytanie.";

/**
 * Looks up an element by id and throws if it is absent.
 *
 * Throwing is right here: a missing id is a typo in the page this script was written
 * for, so it is broken on every load rather than intermittently. Failing loudly in
 * development beats a view that silently stops updating one field on stage.
 */
export function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

export function setText(id: string, value: unknown): void {
  el(id).textContent = String(value);
}

/** Toggles a section with the `hidden` attribute, which needs no CSS to work. */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  node.hidden = hidden;
}

export type QuestionClassNames = {
  readonly prompt?: string;
  readonly list?: string;
  readonly option?: string;
  /** Appended to an option this device has selected, in either answerable or revealed mode. */
  readonly optionSelected?: string;
  /** Appended to a correct option in revealed mode. */
  readonly optionCorrect?: string;
  /** Appended to an option this device selected that turned out to be wrong. */
  readonly optionWrong?: string;
};

/**
 * How the options behave.
 *
 * - `static` — text, no interaction. The lobby, and any kind this slice does not answer.
 * - `answerable` — real tap targets. Buttons, not list items: a phone gets a proper
 *   target and keyboard focus works without reinventing either.
 * - `revealed` — the correct option marked, and this device's own selection marked
 *   beside it. Still not interactive; the answer is already locked.
 */
export type QuestionMode = "static" | "answerable" | "revealed";

export type RenderQuestionOptions = QuestionClassNames & {
  readonly mode?: QuestionMode;
  /**
   * What the prompt says when there is no question. Defaults to the between-questions
   * wording; see the note on `MISSING_QUESTION_TEXT` for when a caller should override it.
   */
  readonly missingText?: string;
  /** What this device has picked so far. */
  readonly selectedOptionIds?: readonly string[];
  /** From `state.revealedOptionIds`. `null` outside a reveal; `[]` means nothing to mark. */
  readonly correctOptionIds?: readonly string[] | null;
  /**
   * Receives the **new complete selection**, not the option that was tapped.
   *
   * Single-choice replaces, multiple-choice toggles — and doing that here rather than
   * in the view means the two kinds' behaviour lives in one place, next to the
   * rendering that has to agree with it. The caller stores what it is handed and
   * re-renders; this module holds no state of its own, which is what keeps an
   * out-of-order snapshot harmless.
   */
  readonly onSelect?: (selectedOptionIds: string[]) => void;
};

/** Single-choice replaces the selection; multiple-choice toggles within it. */
function nextSelection(
  kind: PublicQuestion["kind"],
  selected: readonly string[],
  optionId: string
): string[] {
  if (kind !== "multiple-choice") return [optionId];

  return selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId];
}

/** Joins the base option class with whatever state classes apply. */
function optionClassName(parts: readonly (string | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(" ");
}

/**
 * Renders one question into a container: the prompt, plus the option list for the two
 * choice kinds.
 *
 * **The options became controls in S-03.** They were deliberately static text until the
 * answer path existed — something tappable that does nothing reads from row three as a
 * broken quiz rather than as a feature not shipped yet. `mode` is what decides now, and
 * `static` remains the default so the host view and any unanswerable kind are unchanged.
 *
 * An **unknown question id renders the placeholder rather than an error**. It means the
 * quiz definition changed under a live session — `sessionStateSchema` already refuses
 * that document server-side, so a phone reaching this branch is in the narrow window
 * around a mid-segment deploy. Surviving it quietly is worth more to the room than being
 * correct about it loudly.
 *
 * Built with `createElement` and `textContent`, never `innerHTML`: option text comes
 * from the definition today, but a renderer that interpolates markup is one S-08's word
 * cloud would happily feed attendee-supplied strings.
 */
export function renderQuestion(
  container: HTMLElement,
  question: PublicQuestion | undefined,
  options: RenderQuestionOptions = {}
): void {
  container.replaceChildren();

  const mode = options.mode ?? "static";
  const selected = options.selectedOptionIds ?? [];
  const correct = options.correctOptionIds ?? null;

  const prompt = document.createElement("p");
  if (options.prompt) prompt.className = options.prompt;
  prompt.textContent = question
    ? question.prompt
    : (options.missingText ?? MISSING_QUESTION_TEXT);
  container.append(prompt);

  if (!question?.options?.length) return;

  const list = document.createElement("ul");
  if (options.list) list.className = options.list;

  for (const option of question.options) {
    const item = document.createElement("li");
    const isSelected = selected.includes(option.id);
    const isCorrect = correct !== null && correct.includes(option.id);

    // The hook a later slice needs to find its own options by id without re-deriving
    // the order, which `publicQuiz` deliberately shuffles. It stays on the `li` in
    // every mode so a test or a future view can address an option the same way.
    item.dataset.optionId = option.id;

    if (mode === "answerable") {
      const button = document.createElement("button");
      // Explicitly `button`: inside the form-less section it would default to
      // `submit`, and a submit button in a page that later grows a form reloads it.
      button.type = "button";
      button.className = optionClassName([
        options.option,
        isSelected ? options.optionSelected : undefined,
      ]);
      // `textContent`, never `innerHTML` — S-08 will feed this attendee-supplied
      // strings, and a renderer that interpolates markup is the one it would feed.
      button.textContent = option.text;
      button.dataset.optionId = option.id;
      button.setAttribute("aria-pressed", String(isSelected));

      button.addEventListener("click", () => {
        options.onSelect?.(nextSelection(question.kind, selected, option.id));
      });

      item.append(button);
    } else {
      // `static` also carries the selection, which is what a locked answer looks like:
      // the attendee has submitted, the options no longer respond, and the one they
      // picked is still shown as theirs. Correctness is absent by construction here —
      // there is nothing to be correct against until the host reveals.
      item.className = optionClassName([
        options.option,
        mode === "revealed" && isCorrect ? options.optionCorrect : undefined,
        mode === "revealed" && isSelected && !isCorrect ? options.optionWrong : undefined,
        isSelected && (mode === "static" || isCorrect) ? options.optionSelected : undefined,
      ]);
      item.textContent = option.text;

      // Marked in the DOM as well as by class, so "which did I pick" survives a
      // stylesheet that fails to load on a venue network.
      if (isSelected) item.dataset.selected = "true";
      if (mode === "revealed" && isCorrect) item.dataset.correct = "true";
    }

    list.append(item);
  }

  container.append(list);
}

/**
 * What the room chose (roadmap S-04, PRD FR-005).
 *
 * Shape of `state.revealedDistribution`: how many people answered, and how many chose
 * each option. Kept in this module rather than inline in `host.astro` for the reason
 * the module exists — hand-written DOM is the accepted cost of having no framework, and
 * it is paid once.
 */
export type Distribution = {
  readonly answered: number;
  readonly options: Readonly<Record<string, number>>;
};

export type RenderDistributionOptions = DistributionClassNames & {
  /**
   * From `state.revealedDistribution`. `null` is what a failed tally read publishes, and
   * it renders nothing at all — see the note on the function.
   */
  readonly distribution?: Distribution | null;
  /** From `state.revealedOptionIds`. `null` or `[]` means nothing to mark. */
  readonly correctOptionIds?: readonly string[] | null;
};

export type DistributionClassNames = {
  readonly list?: string;
  readonly row?: string;
  /** Appended to the row of an option that was correct. */
  readonly rowCorrect?: string;
  readonly label?: string;
  readonly count?: string;
  /** The track the filled bar sits in. */
  readonly bar?: string;
  /** The filled portion, whose inline width carries the share. */
  readonly barFill?: string;
  readonly empty?: string;
};

/** Polish, because it renders directly. */
const NO_ANSWERS_TEXT = "Nikt jeszcze nie odpowiedział.";

/**
 * Renders one bar per option: its text, its absolute count, its share of the room, and
 * whether it was the right answer.
 *
 * **Shares are computed against `answered` — people, not selections — and are never
 * normalized to 100%.** On the two multiple-choice questions they will therefore sum
 * past 100%, because someone who picked two options is counted in two bars. Stated here
 * because it reads as a bug: normalizing would misreport what share of the room chose
 * each option, which is the question the display exists to answer.
 *
 * **An `answered` of zero draws no bars at all — it says so in a sentence instead.** The
 * plan called for every bar at zero width; a row of empty bars turned out to read, on a
 * projector, as a broken render rather than as a room that has not answered yet, and the
 * difference matters most in the seconds right after a question opens. Nothing divides by
 * zero on either route; this is about which of the two an audience can interpret.
 *
 * Built with `createElement` and `textContent`, never `innerHTML`, and a correct option
 * is marked with `data-correct` as well as by class, so both survive a stylesheet that
 * fails to load on a venue network. Both rules are `renderQuestion`'s and are followed
 * here for the same reasons.
 */
export function renderDistribution(
  container: HTMLElement,
  question: PublicQuestion | undefined,
  options: RenderDistributionOptions = {}
): void {
  container.replaceChildren();

  // One options bag, matching `renderQuestion` — not four positional parameters. Two of
  // them were nullable and adjacent, so a call site could transpose the distribution and
  // the correct ids and still type-check.
  const distribution = options.distribution ?? null;
  const correctOptionIds = options.correctOptionIds ?? null;
  const classNames = options;

  // No question, no options, or no distribution — the last being what a failed tally
  // read publishes. Rendering nothing is the point: zeroed bars would claim the room
  // did not answer, which is the specific wrong message `reveal.ts` sends `null` to
  // avoid.
  if (!question?.options?.length || distribution === null) return;

  const { answered } = distribution;

  if (answered === 0) {
    const empty = document.createElement("p");
    if (classNames.empty) empty.className = classNames.empty;
    empty.textContent = NO_ANSWERS_TEXT;
    container.append(empty);
    return;
  }

  const list = document.createElement("ul");
  if (classNames.list) list.className = classNames.list;

  for (const option of question.options) {
    // A missing key is zero: an option nobody picked is a fact about the room, and
    // dropping its row would leave the bars unreadable against the question on screen.
    const count = distribution.options[option.id] ?? 0;
    const share = Math.round((count / answered) * 100);
    const isCorrect = correctOptionIds !== null && correctOptionIds.includes(option.id);

    const row = document.createElement("li");
    row.className = optionClassName([
      classNames.row,
      isCorrect ? classNames.rowCorrect : undefined,
    ]);
    // Addressable by id, like `renderQuestion`'s options, and marked in the DOM rather
    // than by class alone.
    row.dataset.optionId = option.id;
    if (isCorrect) row.dataset.correct = "true";

    const label = document.createElement("span");
    if (classNames.label) label.className = classNames.label;
    label.textContent = option.text;

    const figures = document.createElement("span");
    if (classNames.count) figures.className = classNames.count;
    // Both numbers, because neither answers the other's question: the share is what the
    // room compares, and the count is what makes it trustworthy.
    figures.textContent = `${count} · ${share}%`;

    const bar = document.createElement("div");
    if (classNames.bar) bar.className = classNames.bar;

    const fill = document.createElement("div");
    if (classNames.barFill) fill.className = classNames.barFill;
    fill.style.width = `${share}%`;

    bar.append(fill);
    row.append(label, figures, bar);
    list.append(row);
  }

  container.append(list);
}

/**
 * One published row of the leaderboard (roadmap S-07, FR-014).
 *
 * A **type-only** import from `src/lib/session/standings`, like `PublicQuestion` above and
 * for the same reason: `import type` is erased, so `boundary.test.ts` allows it, while a
 * value import would drag `zod` and the server SDKs into a bundle that has to survive a
 * venue network.
 *
 * Note what a row does *not* carry: a player id. See the note in `standings.ts` — the
 * five most impersonation-worthy attendees in the room are exactly the ones on this list.
 */
export type { StandingsRow };

export type StandingsClassNames = {
  readonly list?: string;
  readonly row?: string;
  /** Appended to the row belonging to this device. */
  readonly rowOwn?: string;
  readonly rank?: string;
  readonly name?: string;
  readonly points?: string;
  readonly empty?: string;
};

export type RenderStandingsOptions = StandingsClassNames & {
  /**
   * This device's own display name, for the highlight. `null` on the host view, which
   * belongs to no player.
   *
   * Matched by **exact string equality**, which works because the name in a device's
   * `localStorage` is the one the server returned, and because names are unique by fold
   * (FR-008) so no two rows can both match. Folding here is not an option anyway:
   * `normalizePolish` lives in `src/quiz/` and a value import from there is refused.
   */
  readonly ownDisplayName?: string | null;
};

/** Polish, because it renders directly. */
const NO_STANDINGS_TEXT = "Jeszcze nikt nie zdobył punktów.";

/**
 * Renders the leaderboard: position, name, points.
 *
 * **Rows are rendered in the order given and never sorted here.** That is the whole
 * mechanism behind the PRD's no-divergence guardrail: the server orders the board once,
 * publishes it, and every device paints the same sequence. A sort in this function — even
 * one that agreed today — would put 150 devices back in the business of independently
 * deciding who is winning.
 *
 * The rank is taken from the row rather than from the loop index. They differ exactly when
 * two players tie, which is the case the whole competition-ranking rule exists for: an
 * index would number a tied pair 1 and 2, contradicting the number each of them gets from
 * their own device.
 *
 * `createElement` and `textContent`, never `innerHTML` — a display name is attendee-typed
 * text going onto a projector, and the PRD accepts unmoderated *content* while accepting
 * nothing about unmoderated markup.
 */
export function renderStandings(
  container: HTMLElement,
  rows: readonly StandingsRow[] | undefined,
  options: RenderStandingsOptions = {}
): void {
  container.replaceChildren();

  const classNames = options;
  const own = options.ownDisplayName ?? null;

  // An empty board is a real state — a room where nobody has scored yet — and it says so
  // in a sentence rather than drawing an empty frame, the same choice `renderDistribution`
  // makes for a question nobody has answered.
  if (!rows || rows.length === 0) {
    const empty = document.createElement("p");
    if (classNames.empty) empty.className = classNames.empty;
    empty.textContent = NO_STANDINGS_TEXT;
    container.append(empty);
    return;
  }

  const list = document.createElement("ol");
  if (classNames.list) list.className = classNames.list;

  for (const entry of rows) {
    const isOwn = own !== null && entry.displayName === own;

    const row = document.createElement("li");
    row.className = optionClassName([classNames.row, isOwn ? classNames.rowOwn : undefined]);
    // Marked in the DOM as well as by class, so the highlight survives a stylesheet that
    // failed to load on a venue network — `renderDistribution`'s rule for `data-correct`.
    if (isOwn) row.dataset.own = "true";

    const rank = document.createElement("span");
    if (classNames.rank) rank.className = classNames.rank;
    // From the row, not from the index — see the function note.
    rank.textContent = `${entry.rank}.`;

    const name = document.createElement("span");
    if (classNames.name) name.className = classNames.name;
    name.textContent = entry.displayName;

    const points = document.createElement("span");
    if (classNames.points) points.className = classNames.points;
    points.textContent = String(entry.points);

    row.append(rank, name, points);
    list.append(row);
  }

  container.append(list);
}

/** Polish, because it renders directly. */
const POSITION_UNAVAILABLE_TEXT = "Nie udało się pobrać Twojej pozycji.";
const POSITION_PENDING_TEXT = "Sprawdzamy Twoją pozycję…";

/**
 * The attendee's own line under the board (roadmap S-07, FR-014).
 *
 * A function rather than three lines inline in the page, because the branch it guards is
 * the one worth a test: **an absent rank must never become a number.** `null` reaches
 * here from a failed fetch and from a 503, and any arithmetic over it — `rank ?? 0`,
 * `rank ?? 1`, a falsy check — renders as a specific, confident claim about where this
 * attendee stands. `lessons.md`: the absent case fails toward the safe end, not the
 * favourable one.
 *
 * An absent `playerCount` drops the denominator rather than guessing one. A position with
 * no "of N" is still true; a position out of a made-up total is not.
 */
export function standingsPositionText(
  rank: number | null,
  playerCount: number | null,
  /**
   * Whether a request for this beat is still open (impl review F2).
   *
   * **Checked before the absent-rank branch, and that order is the fix.** An absent rank
   * means two different things — "the fetch failed" and "the fetch has not come back yet" —
   * and without this flag the second rendered as the first, so a device whose connection
   * flapped mid-beat was told its position could not be fetched while the request was still
   * running. Waiting is not failing.
   */
  pending = false
): string {
  if (pending && rank === null) return POSITION_PENDING_TEXT;
  if (rank === null) return POSITION_UNAVAILABLE_TEXT;
  if (playerCount === null) return `Twoja pozycja: ${rank}`;
  return `Twoja pozycja: ${rank} z ${playerCount}`;
}

/**
 * One word and how many people wrote it (roadmap S-08, FR-015).
 *
 * Structurally identical to the store's `WordCount`, and deliberately declared here rather
 * than imported: `readWordCloud`'s type lives in `src/lib/session/store.ts`, and even a
 * type-only import from that module would pull this file's dependency graph toward the
 * server SDKs the moment someone dropped the `type` keyword. `StandingsRow` is imported
 * because `standings.ts` is a pure leaf; `store.ts` is not.
 */
export type WordCount = {
  readonly word: string;
  readonly count: number;
};

export type WordCloudClassNames = {
  readonly list?: string;
  /** Applied to every chip. The type size is set inline, not by class — see the function. */
  readonly chip?: string;
  readonly empty?: string;
};

export type RenderWordCloudOptions = WordCloudClassNames & {
  /**
   * The type size range, in `rem`, the smallest and largest counts map onto.
   *
   * Defaulted rather than required so the two numbers live in one place, and overridable
   * because only the page knows what its projector was measured for.
   */
  readonly minRem?: number;
  readonly maxRem?: number;
};

/** Polish, because it renders directly. */
const NO_WORDS_TEXT = "Jeszcze nikt nie napisał słowa.";

const DEFAULT_MIN_REM = 1.5;
const DEFAULT_MAX_REM = 5;

/**
 * The word cloud on the large screen (roadmap S-08, PRD FR-012/FR-015).
 *
 * **Paints the order given and never sorts** — `renderStandings`' rule, and it matters more
 * here: the server has already dropped everything past `WORD_CLOUD_SIZE`, so a renderer that
 * re-ordered would be re-ranking a list whose tail is missing. Its test fixture is
 * deliberately *not* in count order, because a sorted fixture makes a sorting renderer pass.
 *
 * **`createElement` and `textContent`, never `innerHTML`.** This is the call site the two
 * notes in this module were written for: a word cloud is attendee-typed text going straight
 * onto a projector, unmoderated by explicit decision (PRD §Non-Goals). The PRD accepts
 * unmoderated *content*; it accepts nothing about unmoderated markup, and this is the line
 * that keeps those two apart.
 *
 * **Size scales by count relative to the largest count present, not to an absolute.** A
 * cloud of ten words where the top word has three votes should look like a cloud, not like
 * ten identical small chips waiting for a hundred more. The consequence, stated because it
 * looks like a bug: the biggest word is always at `maxRem`, so the cloud's *shape* is
 * meaningful and its absolute sizes are not.
 *
 * **When every count is equal the whole cloud takes the ceiling**, not the floor. That is
 * the opening beat — one word, written once, on an otherwise empty screen — and the floor
 * would make the first thing the room sees look like a rendering failure. It also covers the
 * degenerate `max === min` division, so nothing here divides by zero.
 */
export function renderWordCloud(
  container: HTMLElement,
  words: readonly WordCount[] | undefined,
  options: RenderWordCloudOptions = {}
): void {
  container.replaceChildren();

  const classNames = options;
  const minRem = options.minRem ?? DEFAULT_MIN_REM;
  const maxRem = options.maxRem ?? DEFAULT_MAX_REM;

  // An empty cloud is a real state — the seconds after a question opens — and it says so in
  // a sentence rather than drawing an empty frame, the choice `renderDistribution` and
  // `renderStandings` both make. `undefined` reaches here before the first poll answers.
  if (!words || words.length === 0) {
    const empty = document.createElement("p");
    if (classNames.empty) empty.className = classNames.empty;
    empty.textContent = NO_WORDS_TEXT;
    container.append(empty);
    return;
  }

  // From the whole list rather than from `words[0]`, so the scale does not depend on the
  // caller having sorted — this function's contract is that it does not care about order.
  const counts = words.map((entry) => entry.count);
  const max = Math.max(...counts);
  const min = Math.min(...counts);

  const list = document.createElement("ul");
  if (classNames.list) list.className = classNames.list;

  for (const entry of words) {
    const chip = document.createElement("li");
    if (classNames.chip) chip.className = classNames.chip;

    // Marked in the DOM as well as rendered, so what was drawn survives a stylesheet that
    // failed to load on a venue network — `renderDistribution`'s `data-correct` rule.
    chip.dataset.word = entry.word;
    chip.dataset.count = String(entry.count);

    // `max === min` covers both the all-equal cloud and the single-word one. Everything
    // takes the ceiling; see the function note for why that direction.
    const share = max === min ? 1 : (entry.count - min) / (max - min);
    chip.style.fontSize = `${(minRem + share * (maxRem - minRem)).toFixed(2)}rem`;

    chip.textContent = entry.word;
    list.append(chip);
  }

  container.append(list);
}

/**
 * The line under the cloud saying how much of the room is on screen (roadmap S-08).
 *
 * A function rather than a template inline in the page, for the reason `standingsPositionText`
 * is one: it has a branch worth a test and the page has no harness to reach it from.
 *
 * **The branch is the honest one.** `readWordCloud` drops everything past `WORD_CLOUD_SIZE`,
 * and a panel that always said "N słów" would present the top of the list as the whole room —
 * a silent cap, which is the one thing a truncation must not be. When nothing was dropped the
 * second number is noise, so it is left out.
 */
export function wordCloudCountText(shown: number, distinct: number): string {
  if (distinct > shown) return `${shown} z ${distinct} słów`;
  return `${shown} słów`;
}

/**
 * The attendee's own word, echoed back at the reveal (roadmap S-08, FR-012).
 *
 * A function rather than a template inline in the page, for the reason `standingsPositionText`
 * is one: the absent branch is the whole point and the page has no harness to reach it from.
 *
 * **The word comes from this device's own storage, so `null` is reachable** — a phone that
 * cleared storage, or one whose answer predates the value being persisted. Returning an empty
 * string rather than a sentence with a hole in it is what keeps that honest: the panel's other
 * two lines already say the word is on the screen, so the echo simply has nothing to add.
 *
 * Never a placeholder like "(brak)" or the empty quotes a template would produce — the
 * attendee did write a word, and telling them otherwise at the moment they are looking for it
 * on the projector is the one wrong thing this line could say.
 */
export function wordEchoText(word: string | null): string {
  if (word === null || word.length === 0) return "";
  return `Twoje słowo: ${word}`;
}

/**
 * How much time is left, as the room reads it (roadmap S-11, FR-020).
 *
 * **Whole seconds, rounded UP, and floored at zero.** Up because a bar reading "0 s"
 * while the field still accepts an answer is the one thing a countdown must not do:
 * `Math.floor` shows zero for the whole final second, so an attendee typing then believes
 * they are already too late. Rounding up means the display reaches zero exactly when the
 * window does.
 *
 * A function rather than a template inline in the page, for the reason
 * `standingsPositionText` is one: every branch here is worth a test and the page has no
 * harness to reach it from.
 *
 * Degenerate input renders `0 s` rather than `NaN s`. The remaining time is computed from
 * a snapshot timestamp and a definition value, so a missing question or a document
 * written before the field shipped both reach here as `NaN` — and `NaN s` on 150 phones
 * is worse than a clock that reads empty.
 */
export function countdownText(remainingMs: number): string {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "0 s";
  return `${Math.ceil(remainingMs / 1_000)} s`;
}

/**
 * Paints the countdown: the seconds text, plus the fraction of the budget still unspent
 * as a percentage width for a bar.
 *
 * **Text and geometry together in one helper**, because the two must never disagree — a
 * bar that is a third full beside "0 s" reads as a broken page at the exact moment an
 * attendee is deciding whether to hurry.
 *
 * `textContent`, never `innerHTML`: the module's escaping rule. Nothing attendee-typed
 * reaches this one, but the rule is the file's and an exception here would be the
 * precedent that matters.
 *
 * A degenerate `limitMs` yields a width of `0%` rather than a division by zero, matching
 * `countdownText`'s posture on the same inputs.
 */
export function renderCountdown(node: HTMLElement, remainingMs: number, limitMs: number): void {
  /**
   * **Clamped into `[0, limitMs]` once, and the text uses the same clamped value as the
   * bar** (impl review F6). The remainder mixes a server timestamp with the device's own
   * clock, so a phone several minutes behind computes a remainder *larger than the whole
   * budget* — which is impossible on a correct clock, and used to render as "325 s" beside
   * a bar the same code had already clamped to full. Two readings of one number disagreeing
   * on screen is the failure this helper exists to prevent.
   *
   * The opposite skew — a phone running fast — is deliberately **not** treated as
   * unreliable, because it cannot be distinguished from a question that has genuinely been
   * open a long time: both are a large negative remainder. Refusing to trust it would
   * un-lock every legitimate latecomer, which is worse than the case it would fix. A fast
   * clock costing its owner one question stays the accepted risk, bounded by the server
   * being the only thing that actually decides.
   */
  const usable = Number.isFinite(limitMs) && limitMs > 0 ? limitMs : 0;
  const left = Number.isFinite(remainingMs) ? Math.max(0, Math.min(remainingMs, usable)) : 0;

  // The label is a child rather than the node itself, because the node also holds the
  // bar — writing `textContent` on the container would delete it.
  const label = node.querySelector<HTMLElement>("[data-countdown-text]");
  if (label) label.textContent = countdownText(left);

  const bar = node.querySelector<HTMLElement>("[data-countdown-bar]");
  if (!bar) return;

  const fraction = usable === 0 ? 0 : left / usable;

  bar.style.width = `${Math.round(fraction * 100)}%`;
}
