// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countdownText,
  renderCountdown,
  renderDistribution,
  renderQuestion,
  renderStandings,
  renderWordCloud,
  standingsPositionText,
  wordCloudCountText,
  wordEchoText,
} from "./render";
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

  /**
   * The host view with no session at all is not the gap between two questions, and the
   * default wording ("Za chwilę pojawi się kolejne pytanie.") promises something nothing is
   * going to deliver there — the host has to type a secret and press `start`. The override
   * is what lets one renderer serve both without either view owning a copy of the other's
   * placeholder.
   */
  it("lets the caller replace the placeholder text", () => {
    renderQuestion(container, undefined, { missingText: "Wpisz sekret hosta." });

    expect(container.querySelector("p")?.textContent).toBe("Wpisz sekret hosta.");
  });

  it("ignores the override when there is a question to show", () => {
    renderQuestion(container, single, { missingText: "Wpisz sekret hosta." });

    expect(container.querySelector("p")?.textContent).toBe(single.prompt);
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

/**
 * The leaderboard (roadmap S-07, FR-014).
 *
 * The rendering half of the no-divergence guardrail. Everything asserted here is about
 * the renderer NOT making decisions: it does not sort, it does not number, and it does
 * not decide who is on the board.
 */
describe("renderStandings", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  function rows(): string[] {
    return [...container.querySelectorAll("li")].map((node) => node.textContent ?? "");
  }

  /**
   * THE GUARDRAIL. The board arrives ordered from the server and is painted as received —
   * the fixture is deliberately NOT in points order, so a renderer that sorted would
   * produce the tidier sequence and fail here.
   */
  it("paints rows in the order given and never sorts them", () => {
    // **Deliberately NOT in points order.** A published board always is, so this input is
    // synthetic — and that is the only fixture that can catch a sort. Written in
    // descending order (as the first version of this test was), a points sort is a no-op
    // and the test passes against a renderer that sorts, which is the failure
    // `lessons.md` describes: the assertion was right and the fixture could not reach the
    // branch it named. Verified by adding a sort and watching this fail.
    renderStandings(container, [
      { rank: 3, displayName: "Celina", points: 10 },
      { rank: 1, displayName: "Ala", points: 30 },
      { rank: 1, displayName: "Bartek", points: 30 },
    ]);

    // No separators between the spans: the visual spacing is CSS `gap`, so the
    // concatenated text is what the DOM actually holds.
    expect(rows()).toEqual(["3.Celina10", "1.Ala30", "1.Bartek30"]);
  });

  /**
   * The rank comes from the row, not from the loop index. They differ exactly when two
   * players tie — so the fixture ties, and the expected sequence is one an index could
   * not produce.
   */
  it("takes the rank from the row, so a tie shows the same number twice", () => {
    renderStandings(container, [
      { rank: 1, displayName: "Ala", points: 50 },
      { rank: 1, displayName: "Bartek", points: 50 },
      { rank: 3, displayName: "Celina", points: 10 },
    ]);

    expect([...container.querySelectorAll("li span:first-child")].map((n) => n.textContent)).toEqual(
      ["1.", "1.", "3."]
    );
  });

  it("marks this device's own row, in the DOM as well as by class", () => {
    renderStandings(
      container,
      [
        { rank: 1, displayName: "Ala", points: 30 },
        { rank: 2, displayName: "Bartek", points: 10 },
      ],
      { ownDisplayName: "Bartek", rowOwn: "is-me" }
    );

    const own = container.querySelectorAll("li[data-own='true']");
    expect(own).toHaveLength(1);
    expect(own[0]?.textContent).toContain("Bartek");
    expect(own[0]?.className).toContain("is-me");
  });

  /**
   * Exact equality, not a fold. `normalizePolish` lives in `src/quiz/` and a value import
   * from there into a client module is refused by `boundary.test.ts` — so this is what the
   * highlight can actually do, and the test pins it rather than leaving the limit implied.
   * Safe in practice because the stored name is the one the server returned, byte for byte.
   */
  it("does not match a differently-cased name", () => {
    renderStandings(container, [{ rank: 1, displayName: "Ala", points: 30 }], {
      ownDisplayName: "ALA",
    });

    expect(container.querySelectorAll("li[data-own='true']")).toHaveLength(0);
  });

  it("marks nothing when the viewer is not a player", () => {
    renderStandings(container, [{ rank: 1, displayName: "Ala", points: 30 }], {
      ownDisplayName: null,
    });

    expect(container.querySelectorAll("li[data-own='true']")).toHaveLength(0);
  });

  it("renders a short board without padding it", () => {
    renderStandings(container, [{ rank: 1, displayName: "Ala", points: 30 }]);

    expect(rows()).toHaveLength(1);
  });

  it("says so in a sentence when nobody has scored, rather than drawing an empty frame", () => {
    renderStandings(container, []);

    expect(container.querySelectorAll("li")).toHaveLength(0);
    expect(container.textContent).toContain("Jeszcze nikt");
  });

  /**
   * A display name is attendee-typed text going onto a projector. The PRD accepts
   * unmoderated *content* and says nothing about accepting unmoderated markup.
   */
  it("writes a name as text, never as markup", () => {
    renderStandings(container, [
      { rank: 1, displayName: "<img src=x onerror=alert(1)>", points: 30 },
    ]);

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("replaces a previous board rather than appending to it", () => {
    renderStandings(container, [{ rank: 1, displayName: "Ala", points: 30 }]);
    renderStandings(container, [{ rank: 1, displayName: "Bartek", points: 40 }]);

    expect(rows()).toHaveLength(1);
    expect(container.textContent).toContain("Bartek");
  });
});

/**
 * The own-position line (roadmap S-07).
 *
 * Extracted from the attendee page precisely so this branch is reachable by a test: the
 * page itself has no harness, and the rule it enforces is one `lessons.md` has an entry
 * about.
 */
describe("standingsPositionText", () => {
  it("states the position out of the room", () => {
    expect(standingsPositionText(7, 42)).toBe("Twoja pozycja: 7 z 42");
  });

  /**
   * THE RULE. Asserted on the absence of any digit rather than on the exact sentence, so
   * a future rewording cannot quietly turn a missing rank into `0` or `1` — the two values
   * every plausible coercion of `null` produces, each a confident claim about where this
   * attendee stands.
   */
  it("says nothing numeric when the rank could not be fetched", () => {
    const text = standingsPositionText(null, 42);

    expect(text).not.toMatch(/\d/);
    expect(text).toContain("Nie udało się");
  });

  it("drops the denominator rather than inventing one", () => {
    expect(standingsPositionText(7, null)).toBe("Twoja pozycja: 7");
  });

  /**
   * THE COLLAPSE F2 WAS (impl review). An absent rank means two different things, and
   * before the `pending` flag the in-flight one rendered as the failure — so a phone whose
   * connection flapped mid-beat was told its position could not be fetched while the
   * request was still open.
   */
  it("says it is still checking while a request for this beat is open", () => {
    expect(standingsPositionText(null, 42, true)).toBe("Sprawdzamy Twoją pozycję…");
  });

  it("still reports a real failure once nothing is in flight", () => {
    expect(standingsPositionText(null, 42, false)).toContain("Nie udało się");
  });

  /** A rank that arrived wins over a stale pending flag rather than hiding behind it. */
  it("shows an arrived rank even if pending was left set", () => {
    expect(standingsPositionText(7, 42, true)).toBe("Twoja pozycja: 7 z 42");
  });

  /** Rank 1 is a real position and must not be confused with the absent case. */
  it("reports first place as a position, not as a failure", () => {
    expect(standingsPositionText(1, 42)).toBe("Twoja pozycja: 1 z 42");
  });
});

/**
 * The word cloud (roadmap S-08, FR-012/FR-015).
 *
 * The one renderer in this module whose input is entirely attendee-authored, and the call
 * site the `textContent` notes elsewhere in the file were written for. What is under test is
 * what the projector shows: which words, in what order, at what relative size — and that
 * markup stays inert.
 */
describe("renderWordCloud", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
  });

  function chips(): HTMLElement[] {
    return [...container.querySelectorAll("li")];
  }

  function sizes(): number[] {
    return chips().map((chip) => Number.parseFloat(chip.style.fontSize));
  }

  /**
   * THE ORDER GUARD. The server has already ordered the cloud and dropped its tail, so a
   * renderer that sorted would be re-ranking an incomplete list.
   *
   * **The fixture is deliberately NOT in count order.** Written descending — as a published
   * cloud always is — a count sort is a no-op and this passes against a renderer that sorts,
   * which is precisely the failure `lessons.md` describes and the one S-07 shipped. Verified
   * by adding a sort and watching this fail.
   */
  it("paints words in the order given and never sorts them", () => {
    renderWordCloud(container, [
      { word: "rzadkie", count: 1 },
      { word: "czeste", count: 9 },
      { word: "srednie", count: 4 },
    ]);

    expect(chips().map((chip) => chip.textContent)).toEqual(["rzadkie", "czeste", "srednie"]);
  });

  it("marks each chip in the DOM as well as rendering it", () => {
    renderWordCloud(container, [{ word: "robot", count: 3 }]);

    // Survives a stylesheet that failed to load on a venue network — the rule
    // `renderDistribution` follows for `data-correct`.
    expect(chips()[0]!.dataset.word).toBe("robot");
    expect(chips()[0]!.dataset.count).toBe("3");
  });

  /**
   * **The rule this module's docstrings were written for.** A word cloud is attendee-typed
   * text going straight onto a projector, unmoderated by explicit decision — so content is
   * accepted and markup must be inert.
   */
  it("writes a word as text, never as markup", () => {
    renderWordCloud(container, [
      { word: "<img src=x onerror=alert(1)>", count: 2 },
      { word: "<b>pogrubione</b>", count: 1 },
    ]);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(chips()[0]!.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  describe("the size scale", () => {
    it("gives the largest count the ceiling and the smallest the floor", () => {
      renderWordCloud(
        container,
        [
          { word: "duze", count: 10 },
          { word: "srednie", count: 5 },
          { word: "male", count: 1 },
        ],
        { minRem: 2, maxRem: 6 }
      );

      const [large, middle, small] = sizes();
      expect(large).toBe(6);
      expect(small).toBe(2);
      // Between the two, and strictly — a scale that collapsed would still satisfy the ends.
      expect(middle).toBeGreaterThan(small!);
      expect(middle).toBeLessThan(large!);
    });

    it("scales relative to the largest count present, not to an absolute", () => {
      // Three votes is the top of this room, so it gets the ceiling — a cloud of ten words
      // must not look like ten identical chips waiting for a hundred more votes.
      renderWordCloud(container, [{ word: "szczyt", count: 3 }, { word: "dol", count: 1 }], {
        minRem: 2,
        maxRem: 6,
      });

      expect(sizes()[0]).toBe(6);
    });

    /**
     * **The all-equal cloud takes the CEILING, not the floor**, and the direction is the
     * decision. This is the opening beat — the first word, written once, on an otherwise
     * empty screen — and at the floor the first thing the room sees looks like a failed
     * render. It also covers the `max === min` division, so nothing divides by zero.
     */
    it("gives every word the ceiling when all counts are equal", () => {
      renderWordCloud(
        container,
        [
          { word: "a", count: 1 },
          { word: "b", count: 1 },
          { word: "c", count: 1 },
        ],
        { minRem: 2, maxRem: 6 }
      );

      expect(sizes()).toEqual([6, 6, 6]);
    });

    it("gives a single word the ceiling", () => {
      renderWordCloud(container, [{ word: "pierwsze", count: 1 }], { minRem: 2, maxRem: 6 });

      expect(sizes()).toEqual([6]);
    });

    it("produces no NaN size for any of the degenerate cases", () => {
      // Dividing by `max - min` is the one arithmetic hazard here, and `NaN` would reach the
      // projector as an unstyled chip rather than as an error.
      for (const fixture of [
        [{ word: "a", count: 0 }],
        [
          { word: "a", count: 0 },
          { word: "b", count: 0 },
        ],
        [{ word: "a", count: 7 }],
      ]) {
        renderWordCloud(container, fixture);
        expect(sizes().every((size) => Number.isFinite(size))).toBe(true);
      }
    });
  });

  it("says so in a sentence when nobody has written a word", () => {
    renderWordCloud(container, []);

    // The state every word-cloud question is in for its first seconds. An empty frame on a
    // projector reads as broken; a sentence reads as waiting.
    expect(chips()).toHaveLength(0);
    expect(container.textContent).toContain("Jeszcze nikt nie napisał");
  });

  it("says the same for a cloud that has not been fetched yet", () => {
    renderWordCloud(container, undefined);

    expect(container.textContent).toContain("Jeszcze nikt nie napisał");
  });

  it("replaces the previous cloud rather than appending to it", () => {
    renderWordCloud(container, [{ word: "pierwsze", count: 1 }]);
    renderWordCloud(container, [{ word: "drugie", count: 1 }]);

    // Polled every ~2.5s, so an appending renderer would grow without bound on screen.
    expect(chips()).toHaveLength(1);
    expect(container.textContent).toContain("drugie");
  });

  it("clears the empty sentence once words arrive", () => {
    renderWordCloud(container, []);
    renderWordCloud(container, [{ word: "robot", count: 1 }]);

    expect(container.querySelectorAll("p")).toHaveLength(0);
    expect(chips()).toHaveLength(1);
  });
});

/**
 * The count line under the cloud (roadmap S-08).
 *
 * Extracted for the reason `standingsPositionText` is: it has a branch, and the page has no
 * harness to reach it from.
 */
describe("wordCloudCountText", () => {
  /**
   * THE HONEST BRANCH. `readWordCloud` drops everything past `WORD_CLOUD_SIZE`, and a line
   * that always said "N słów" would present the top of the list as the whole room — a silent
   * cap, which is the one thing a truncation must not be.
   */
  it("names both numbers when words were dropped", () => {
    expect(wordCloudCountText(30, 47)).toBe("30 z 47 słów");
  });

  it("names one number when nothing was dropped", () => {
    expect(wordCloudCountText(12, 12)).toBe("12 słów");
  });

  it("does not claim a truncation that did not happen", () => {
    // Defensive against a caller that passed the two the wrong way round: the line must not
    // read "12 z 5", which would be a claim about the room that is simply false.
    expect(wordCloudCountText(12, 5)).toBe("12 słów");
  });

  it("reports an empty cloud without inventing a second number", () => {
    expect(wordCloudCountText(0, 0)).toBe("0 słów");
  });
});

/**
 * The attendee's own word at the reveal (roadmap S-08).
 *
 * Extracted from the page for the reason `standingsPositionText` was: the absent branch is
 * what the function exists for, and the page has no harness.
 */
describe("wordEchoText", () => {
  it("echoes the word this device sent", () => {
    expect(wordEchoText("Halucynacja")).toBe("Twoje słowo: Halucynacja");
  });

  it("echoes it exactly as typed, not folded", () => {
    // The projector shows the folded form; the phone shows what its owner actually wrote, so
    // the two are allowed to differ in case and the attendee can see why.
    expect(wordEchoText("SkyNet")).toBe("Twoje słowo: SkyNet");
  });

  /**
   * THE ABSENT BRANCH. Reachable from a phone that cleared storage. It must produce nothing
   * at all — not "Twoje słowo: " with a hole in it, and not a placeholder claiming the
   * attendee wrote nothing, which is the one wrong thing this line could say at the moment
   * they are looking for their word on the screen.
   */
  it("says nothing at all when the word is not in storage", () => {
    expect(wordEchoText(null)).toBe("");
  });

  it("says nothing for an empty stored word either", () => {
    // `validateWord` refuses an empty word, so this is unreachable through the route — and
    // handled anyway, because a truncated storage read would otherwise render a bare label.
    expect(wordEchoText("")).toBe("");
  });
});

/**
 * The countdown (roadmap S-11, FR-020).
 *
 * Pure functions over a remaining-milliseconds figure — the page owns the clock, this owns
 * what the room reads. Extracted for the reason `standingsPositionText` was: every branch
 * here is worth a test and the page has no harness to reach it from.
 */
describe("countdownText", () => {
  it("renders whole seconds", () => {
    expect(countdownText(12_000)).toBe("12 s");
  });

  /**
   * ROUNDS UP, AND THIS IS THE ONE THAT MATTERS.
   *
   * With `Math.floor`, the display reads "0 s" for the whole final second while the field
   * is still accepting answers — so an attendee typing then believes they are already too
   * late and gives up an answer they could have sent. Rounding up means zero appears
   * exactly when the window closes.
   */
  it("rounds a part-second up, so zero appears only when the window is actually closed", () => {
    expect(countdownText(1)).toBe("1 s");
    expect(countdownText(999)).toBe("1 s");
    expect(countdownText(1_001)).toBe("2 s");
  });

  it("floors at zero rather than counting into negatives", () => {
    // Reachable on a phone that was asleep past the deadline.
    expect(countdownText(0)).toBe("0 s");
    expect(countdownText(-5_000)).toBe("0 s");
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("renders 0 s rather than %s", (_label, value) => {
    // The remaining time is computed from a snapshot timestamp and a definition value, so a
    // missing question reaches here as NaN. "NaN s" on 150 phones is worse than an empty
    // clock.
    expect(countdownText(value)).not.toContain("NaN");
    expect(countdownText(value)).not.toContain("Infinity");
  });
});

describe("renderCountdown", () => {
  let node: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="countdown">
        <span data-countdown-text></span>
        <div><div data-countdown-bar style="width: 100%"></div></div>
      </div>`;
    node = document.getElementById("countdown")!;
  });

  const label = (): string => node.querySelector("[data-countdown-text]")!.textContent ?? "";
  const width = (): string =>
    (node.querySelector("[data-countdown-bar]") as HTMLElement).style.width;

  it("paints the seconds and the fraction of the budget left together", () => {
    renderCountdown(node, 12_500, 25_000);

    expect(label()).toBe("13 s");
    expect(width()).toBe("50%");
  });

  /**
   * The two must never disagree. A bar a third full beside "0 s" reads as a broken page at
   * the exact moment an attendee is deciding whether to hurry.
   */
  it("empties the bar when the text reaches zero", () => {
    renderCountdown(node, 0, 25_000);

    expect(label()).toBe("0 s");
    expect(width()).toBe("0%");
  });

  it("clamps a negative remainder rather than producing a negative width", () => {
    renderCountdown(node, -9_000, 25_000);

    expect(label()).toBe("0 s");
    expect(width()).toBe("0%");
  });

  /**
   * A remainder larger than the whole budget is impossible on a correct clock, so it means
   * the device is running behind the server. Before impl review F6 the bar clamped and the
   * text did not, so this rendered "40 s" beside a full bar — two readings of one number,
   * disagreeing, on the screen an attendee is using to decide whether to hurry.
   */
  it("clamps a remainder larger than the budget, in the text as well as the bar", () => {
    renderCountdown(node, 40_000, 25_000);

    expect(width()).toBe("100%");
    expect(label()).toBe("25 s");
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
  ])("produces no NaN width for a %s budget", (_label, limitMs) => {
    renderCountdown(node, 5_000, limitMs);

    expect(width()).not.toContain("NaN");
    expect(width()).toBe("0%");
  });

  it("writes text, never markup", () => {
    // The module's escaping rule. Nothing attendee-typed reaches here, but an exception
    // would be the precedent that matters.
    renderCountdown(node, 5_000, 25_000);

    expect(node.querySelector("[data-countdown-text]")!.innerHTML).not.toContain("<");
  });

  it("leaves the bar alone when there is none to paint", () => {
    // A caller could hand this a bare element; it must not throw on the way past.
    document.body.innerHTML = `<div id="bare"><span data-countdown-text></span></div>`;
    const bare = document.getElementById("bare")!;

    expect(() => renderCountdown(bare, 5_000, 25_000)).not.toThrow();
    expect(bare.querySelector("[data-countdown-text]")!.textContent).toBe("5 s");
  });
});
