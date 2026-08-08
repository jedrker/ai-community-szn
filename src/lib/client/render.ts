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
};

/**
 * Renders one question into a container: the prompt, plus the option list for the two
 * choice kinds.
 *
 * **The options are static text, not controls.** The answer path is S-03's. Rendering
 * something tappable that does nothing would look broken on stage, and would be read by
 * the room as the quiz having failed rather than as a feature not shipped yet.
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
  classNames: QuestionClassNames = {}
): void {
  container.replaceChildren();

  const prompt = document.createElement("p");
  if (classNames.prompt) prompt.className = classNames.prompt;
  prompt.textContent = question ? question.prompt : MISSING_QUESTION_TEXT;
  container.append(prompt);

  if (!question?.options?.length) return;

  const list = document.createElement("ul");
  if (classNames.list) list.className = classNames.list;

  for (const option of question.options) {
    const item = document.createElement("li");
    if (classNames.option) item.className = classNames.option;
    item.textContent = option.text;
    // A hook for a later slice to find its own options by id without re-deriving the
    // order, which `publicQuiz` deliberately shuffles.
    item.dataset.optionId = option.id;
    list.append(item);
  }

  container.append(list);
}
