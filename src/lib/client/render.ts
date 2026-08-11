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

/** Polish, because it renders directly. */
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
  prompt.textContent = question ? question.prompt : MISSING_QUESTION_TEXT;
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
