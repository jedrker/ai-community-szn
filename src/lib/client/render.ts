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
