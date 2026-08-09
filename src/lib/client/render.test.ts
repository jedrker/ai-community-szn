// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderDistribution, renderQuestion } from "./render";
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

/**
 * The distribution bars (roadmap S-04, FR-005).
 *
 * Read from the back of a room, so what is under test is what the numbers *say* —
 * order, counts, shares, and which option is marked — rather than that elements exist.
 */
describe("renderDistribution", () => {
  const rows = (): HTMLElement[] => Array.from(container.querySelectorAll("li"));
  const fillWidths = (): string[] =>
    Array.from(container.querySelectorAll("li div div")).map(
      (node) => (node as HTMLElement).style.width
    );

  it("draws one bar per option, in definition order, with counts and shares", () => {
    renderDistribution(container, single, {
      distribution: { answered: 10, options: { a: 5, b: 3, c: 2 } },
      correctOptionIds: ["a"],
    });

    expect(rows()).toHaveLength(3);
    // Definition order, not sorted by count: the bars sit under a question whose options
    // the room is reading in that order, and re-ordering them makes the two disagree.
    expect(rows().map((row) => row.dataset.optionId)).toEqual(["a", "b", "c"]);
    expect(rows().map((row) => row.textContent)).toEqual([
      "Large Language Model5 · 50%",
      "Long Learning Machine3 · 30%",
      "Layered Logic Module2 · 20%",
    ]);
    expect(fillWidths()).toEqual(["50%", "30%", "20%"]);
  });

  it("marks the correct option in the DOM as well as by class", () => {
    renderDistribution(container, single, {
      distribution: { answered: 4, options: { a: 4 } },
      correctOptionIds: ["a"],
      rowCorrect: "right",
    });

    // Both, so the marking survives a stylesheet that fails to load on a venue network.
    expect(rows()[0]!.dataset.correct).toBe("true");
    expect(rows()[0]!.className).toContain("right");
    expect(rows()[1]!.dataset.correct).toBeUndefined();
  });

  it("shows an option nobody picked as zero rather than dropping its row", () => {
    renderDistribution(container, single, {
      distribution: { answered: 4, options: { a: 4 } },
      correctOptionIds: ["a"],
    });

    // A missing row would leave the bars unreadable against the question on screen.
    expect(rows()).toHaveLength(3);
    expect(rows()[1]!.textContent).toContain("0 · 0%");
  });

  /**
   * **The shares sum past 100% and that is correct.** The denominator counts people, not
   * selections, so someone who picked two options is in two bars. Normalizing would
   * misreport what share of the room chose each option, which is the question the
   * display answers — asserted here because it reads as a bug and would otherwise be
   * "fixed".
   */
  it("renders multiple-choice shares unnormalized, against answered", () => {
    renderDistribution(container, multi, {
      distribution: { answered: 10, options: { a: 8, b: 7, c: 1 } },
      correctOptionIds: ["a", "b"],
    });

    expect(rows().map((row) => row.textContent)).toEqual([
      "Large Language Model8 · 80%",
      "Long Learning Machine7 · 70%",
      "Layered Logic Module1 · 10%",
    ]);
    // 160%, deliberately.
    expect(fillWidths()).toEqual(["80%", "70%", "10%"]);
  });

  it("renders no bars and no NaN when nobody has answered", () => {
    renderDistribution(container, single, {
      distribution: { answered: 0, options: {} },
      correctOptionIds: ["a"],
      empty: "muted",
    });

    // Dividing by zero would put "NaN%" on a projector. A sentence is what a room can
    // read; a screen of empty bars with no explanation reads as broken.
    expect(rows()).toHaveLength(0);
    expect(container.textContent).not.toContain("NaN");
    expect(container.textContent).toContain("Nikt jeszcze nie odpowiedział");
  });

  /**
   * `null` is what `reveal.ts` publishes when the tally read failed, and it must render
   * as nothing at all — never as a set of zeroed bars, which on a projector is the claim
   * that nobody answered.
   */
  it("renders nothing at all for a null distribution", () => {
    renderDistribution(container, single, { distribution: null, correctOptionIds: ["a"] });

    expect(container.children).toHaveLength(0);
  });

  it("renders nothing for a kind with no options", () => {
    const text: PublicQuestion = { id: "t", kind: "text", prompt: "Coś", scored: true };

    renderDistribution(container, text, { distribution: { answered: 3, options: {} } });

    expect(container.children).toHaveLength(0);
  });

  it("never interprets option text as markup", () => {
    const hostile: PublicQuestion = {
      ...single,
      options: [{ id: "a", text: "<img src=x onerror=alert(1)>" }],
    };

    renderDistribution(container, hostile, { distribution: { answered: 1, options: { a: 1 } } });

    // S-08 will feed this module attendee-supplied strings. `textContent`, never
    // `innerHTML` — the same rule `renderQuestion` follows, asserted the same way.
    expect(container.querySelector("img")).toBeNull();
    expect(rows()[0]!.textContent).toContain("<img");
  });

  it("clears whatever was there before", () => {
    container.append(document.createElement("p"));

    renderDistribution(container, single, { distribution: { answered: 2, options: { a: 2 } } });

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
