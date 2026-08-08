// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderQuestion } from "./render";
import type { PublicQuestion } from "../../quiz/public";

/**
 * The option renderer (roadmap S-02, extended into controls by S-03).
 *
 * **This is the first test in the project that needs a DOM**, which is why
 * `happy-dom` was added as a devDependency and selected per file by the docblock
 * above — the suite's default environment is still `node`, so nothing else pays for it.
 *
 * What is under test is the behaviour the two choice kinds differ in (replace vs
 * toggle), the reveal marking, and the `textContent` rule. The selection itself is
 * caller state: this module holds none, which is what keeps a replayed snapshot
 * harmless.
 */

const single: PublicQuestion = {
  id: "single",
  kind: "single-choice",
  prompt: "Co oznacza skrót LLM?",
  scored: true,
  options: [
    { id: "a", text: "Large Language Model" },
    { id: "b", text: "Long Learning Machine" },
    { id: "c", text: "Layered Logic Module" },
  ],
};

const multi: PublicQuestion = { ...single, id: "multi", kind: "multiple-choice" };

let container: HTMLElement;

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
});

function options(): HTMLElement[] {
  return [...container.querySelectorAll("li")];
}

function buttons(): HTMLButtonElement[] {
  return [...container.querySelectorAll("button")];
}

describe("static mode", () => {
  it("renders the prompt and every option as text", () => {
    renderQuestion(container, single);

    expect(container.querySelector("p")?.textContent).toBe(single.prompt);
    expect(options().map((item) => item.textContent)).toEqual([
      "Large Language Model",
      "Long Learning Machine",
      "Layered Logic Module",
    ]);
  });

  it("renders no controls, so nothing tappable does nothing", () => {
    renderQuestion(container, single);

    expect(buttons()).toHaveLength(0);
  });

  it("keeps the option id hook on every item", () => {
    renderQuestion(container, single);

    // The order is shuffled per question by `publicQuiz`, so anything mapping a
    // selection back must go through ids and never through indices.
    expect(options().map((item) => item.dataset.optionId)).toEqual(["a", "b", "c"]);
  });

  it("marks a locked selection without saying anything about correctness", () => {
    renderQuestion(container, single, {
      mode: "static",
      selectedOptionIds: ["b"],
      optionSelected: "picked",
      optionCorrect: "right",
    });

    expect(options()[1]!.className).toContain("picked");
    expect(container.innerHTML).not.toContain("right");
  });

  it("renders a placeholder rather than an error for an unknown question", () => {
    renderQuestion(container, undefined);

    expect(container.querySelector("p")?.textContent).toBeTruthy();
    expect(options()).toHaveLength(0);
  });
});

describe("answerable mode", () => {
  it("renders a real button per option, typed so it cannot submit a form", () => {
    renderQuestion(container, single, { mode: "answerable" });

    expect(buttons()).toHaveLength(3);
    expect(buttons().every((button) => button.type === "button")).toBe(true);
  });

  it("sets option text with textContent, never as markup", () => {
    // S-08 will feed this attendee-supplied strings; a renderer that interpolated
    // markup is the one it would feed.
    const nasty: PublicQuestion = {
      ...single,
      options: [{ id: "a", text: "<img src=x onerror=alert(1)>" }],
    };

    renderQuestion(container, nasty, { mode: "answerable" });

    expect(container.querySelector("img")).toBeNull();
    expect(buttons()[0]!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("single-choice replaces the selection", () => {
    const onSelect = vi.fn();
    renderQuestion(container, single, {
      mode: "answerable",
      selectedOptionIds: ["a"],
      onSelect,
    });

    buttons()[2]!.click();

    expect(onSelect).toHaveBeenCalledWith(["c"]);
  });

  it("single-choice re-tapping the same option keeps it selected", () => {
    const onSelect = vi.fn();
    renderQuestion(container, single, {
      mode: "answerable",
      selectedOptionIds: ["a"],
      onSelect,
    });

    buttons()[0]!.click();

    // Not a toggle: an attendee cannot end up with nothing selected by tapping their
    // own answer twice while the clock runs.
    expect(onSelect).toHaveBeenCalledWith(["a"]);
  });

  it("multiple-choice adds to the selection", () => {
    const onSelect = vi.fn();
    renderQuestion(container, multi, {
      mode: "answerable",
      selectedOptionIds: ["a"],
      onSelect,
    });

    buttons()[1]!.click();

    expect(onSelect).toHaveBeenCalledWith(["a", "b"]);
  });

  it("multiple-choice removes an already-selected option", () => {
    const onSelect = vi.fn();
    renderQuestion(container, multi, {
      mode: "answerable",
      selectedOptionIds: ["a", "b"],
      onSelect,
    });

    buttons()[0]!.click();

    expect(onSelect).toHaveBeenCalledWith(["b"]);
  });

  it("reports the whole new selection, not the option that was tapped", () => {
    // The caller stores what it is handed and re-renders. This module keeps no state,
    // which is what makes an out-of-order snapshot harmless.
    const onSelect = vi.fn();
    renderQuestion(container, multi, { mode: "answerable", selectedOptionIds: [], onSelect });

    buttons()[2]!.click();

    expect(onSelect).toHaveBeenCalledWith(["c"]);
  });

  it("marks the selection for a screen reader and for a stylesheet", () => {
    renderQuestion(container, single, {
      mode: "answerable",
      selectedOptionIds: ["b"],
      optionSelected: "picked",
    });

    expect(buttons().map((button) => button.getAttribute("aria-pressed"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(buttons()[1]!.className).toContain("picked");
  });
});

describe("revealed mode", () => {
  it("marks the correct option", () => {
    renderQuestion(container, single, {
      mode: "revealed",
      correctOptionIds: ["a"],
      optionCorrect: "right",
    });

    expect(options()[0]!.className).toContain("right");
    expect(options()[0]!.dataset.correct).toBe("true");
    expect(options()[1]!.dataset.correct).toBeUndefined();
  });

  it("marks this device's wrong pick beside the correct one", () => {
    renderQuestion(container, single, {
      mode: "revealed",
      correctOptionIds: ["a"],
      selectedOptionIds: ["c"],
      optionCorrect: "right",
      optionWrong: "wrong",
    });

    expect(options()[0]!.className).toContain("right");
    expect(options()[2]!.className).toContain("wrong");
    expect(options()[2]!.dataset.selected).toBe("true");
  });

  it("does not mark a correct pick as wrong", () => {
    renderQuestion(container, single, {
      mode: "revealed",
      correctOptionIds: ["a"],
      selectedOptionIds: ["a"],
      optionCorrect: "right",
      optionWrong: "wrong",
    });

    expect(options()[0]!.className).toContain("right");
    expect(options()[0]!.className).not.toContain("wrong");
  });

  it("marks nothing when there is nothing to mark — the unscored case", () => {
    // An empty array is what an unscored question and a non-choice kind both produce.
    // It must render as "nothing to highlight", not as an error.
    renderQuestion(container, single, {
      mode: "revealed",
      correctOptionIds: [],
      optionCorrect: "right",
    });

    expect(container.innerHTML).not.toContain("right");
    expect(options()).toHaveLength(3);
  });

  it("renders no controls — the answer is already locked", () => {
    renderQuestion(container, single, { mode: "revealed", correctOptionIds: ["a"] });

    expect(buttons()).toHaveLength(0);
  });

  it("shows a device that never answered the correct answer and no selection", () => {
    renderQuestion(container, single, {
      mode: "revealed",
      correctOptionIds: ["a"],
      selectedOptionIds: [],
      optionCorrect: "right",
    });

    expect(options()[0]!.className).toContain("right");
    expect(options().some((item) => item.dataset.selected === "true")).toBe(false);
  });
});
