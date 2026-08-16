import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The attendee page's countdown, guarded structurally (roadmap S-11, FR-020).
 *
 * ## Why this file scans source instead of running the countdown
 *
 * `index.astro`'s `<script>` block is not importable — nothing in the project loads it, and
 * an Astro page's inline script has no harness. So the countdown's *behaviour* is verified
 * manually, per the plan's Phase 3 manual rows, and what can be protected here is the
 * **structure that behaviour depends on**. `host.test.ts` says the same thing about the same
 * limitation, and this file follows its shape deliberately: the phone now carries a timer of
 * its own, and the property that timer needs is the one the host page has been guarding since
 * S-04.
 *
 * Be plain about what a green file here does *not* prove: nothing below shows the clock
 * counts down, reads the right remainder, or locks the controls at zero. What it proves is
 * that there is exactly one timer, that it is cleared from exactly one place, and that the
 * clearing sits where every branch passes through it.
 *
 * Comments are stripped first, for the reason `host.test.ts` and `participation.test.ts` give:
 * a rule whose reason is not written next to it is a rule someone deletes, and a scan over raw
 * source would force the page to choose between explaining itself and passing.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("./index.astro", import.meta.url)),
  "utf8",
);

const CODE = SOURCE.replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

function occurrences(needle: string): number {
  return CODE.split(needle).length - 1;
}

/**
 * "`first` appears before `second`", asserted so that an absent needle cannot satisfy it.
 *
 * `indexOf(a) < indexOf(b)` is **vacuously true when `a` is missing** — `-1` is less than
 * everything. The ordering assertion below already had a presence guard beside it, so it did
 * catch a deletion; what it lacked was any reason the two lines have to stay together, and
 * the tidy-looking edit is to drop the one that reads redundant.
 *
 * **Duplicated from `host.test.ts` rather than shared.** These two files import nothing from
 * each other today, and a `src/pages/quiz/test-helpers.ts` existing only for ten lines would
 * be the larger cost — the same reasoning `normalize.ts` records for its two folds.
 */
function expectOrder(haystack: string, first: string, second: string): void {
  expect(
    haystack,
    `missing, so the order below cannot mean anything: ${first}`,
  ).toContain(first);
  expect(
    haystack,
    `missing, so the order below cannot mean anything: ${second}`,
  ).toContain(second);
  expect(
    haystack.indexOf(first),
    `expected "${first}" to come before "${second}"`,
  ).toBeLessThan(haystack.indexOf(second));
}

describe("the scan can see the code it is checking", () => {
  /**
   * Without this, a stripper that over-matched would empty the source and turn every
   * assertion below green by vacuity — the failure `keys.test.ts` guards with its own
   * non-empty-registry check, and the one S-08 shipped four times in a single change.
   */
  it("still has the countdown's wiring left after comments are stripped", () => {
    expect(CODE).toContain("createCountdown({");
    expect(CODE).toContain("function stopCountdown");
    expect(CODE).toContain("function startCountdown");
  });

  it("still has the state machine's code left after comments are stripped", () => {
    expect(CODE).toContain("function render()");
    expect(CODE).toContain("function renderOpen(");
  });
});

/**
 * THE PAGE OWNS NO TIMER.
 *
 * **This block used to count `setTimeout` and timer handles in this file. It counts zero of
 * them now, and that is a stronger property than the one it replaced.** The countdown's
 * state machine moved to `src/lib/client/countdown.ts` after an implementation review found
 * a recursion in the inline version — a defect a source scan could not see, because a scan
 * cannot execute a timer. `countdown.test.ts` drives arm / tick / crossing / stop with fake
 * timers; what is left here is wiring, and the assertion worth making about wiring is that
 * it stays wiring.
 */
describe("the page owns no timer of its own", () => {
  it("arms nothing directly", () => {
    // A `setTimeout` reappearing here is the countdown crawling back into the page, where
    // nothing can execute it.
    expect(occurrences("setTimeout")).toBe(0);
    expect(occurrences("clearTimeout")).toBe(0);
    expect(CODE.match(/\blet\s+\w*[Tt]imer\b/g) ?? []).toHaveLength(0);
  });

  it("uses no interval either", () => {
    expect(CODE).not.toContain("setInterval");
  });

  it("holds exactly one countdown, built once", () => {
    expect(occurrences("createCountdown(")).toBe(1);
  });
});

/**
 * THE CLEARING SITE.
 *
 * `stopCountdown` is called at the top of `render()` so that every branch — reveal,
 * standings, lobby, `ended`, a lost connection — passes through it, and only the
 * `question-open` path arms a clock again. Placed anywhere else, clearing becomes a rule each
 * new branch has to remember, which is precisely how a timer outlives its beat.
 */
describe("the countdown cannot outlive its question", () => {
  it("stops wherever the page stops, as the host view does", () => {
    // Counting call sites was the previous form of this test, and it failed the moment the
    // lifecycle handlers arrived — measuring an occurrence count rather than the property.
    // What matters is the two exits: a hidden tab and a page going away.
    const visibility = CODE.slice(
      CODE.indexOf('addEventListener("visibilitychange"'),
      CODE.indexOf('addEventListener("pagehide"'),
    );
    expect(visibility).toContain("stopCountdown()");

    const pagehide = CODE.slice(CODE.indexOf('addEventListener("pagehide"'));
    expect(pagehide.slice(0, 200)).toContain("stopCountdown");
  });

  it("clears before the state machine branches", () => {
    const renderAt = CODE.indexOf("function render()");
    expect(renderAt, "render() itself is missing").toBeGreaterThan(-1);

    // Ahead of the first branch, so no early return can skip it. Scoped to what follows
    // `render`'s opening, so a `stopCountdown()` earlier in the file cannot stand in for it —
    // and the clear's *absence* is what this is really about: S-11's F1 shipped without it.
    expectOrder(
      CODE.slice(renderAt),
      "stopCountdown();",
      'connection === "lost"',
    );
  });

  it("arms the clock from the open-question path only", () => {
    expect(occurrences("startCountdown(")).toBe(2); // the definition plus its one call

    const openAt = CODE.indexOf("function renderOpen(");
    const armAt = CODE.indexOf("startCountdown(question, openedAt)", openAt);

    expect(armAt).toBeGreaterThan(openAt);
  });
});

/**
 * THE THING THAT MUST NOT BE MARKED SUBMITTED.
 *
 * An expired submission recorded nothing, so `markSubmitted` on that path would make
 * `hasSubmitted` true — which decides whether a result panel appears at the reveal and
 * whether the note reads "Odpowiedź zapisana". Both would then describe an answer the store
 * has never seen. The route's own test covers the refusal; this covers the page not
 * mislabelling it.
 */
describe("an expired answer is never recorded as submitted", () => {
  it("has an expired branch that does not mark the question", () => {
    const branchAt = CODE.indexOf('outcome.outcome === "expired"');
    expect(branchAt).toBeGreaterThan(-1);

    // The branch runs to its `return`; nothing in it may call `markSubmitted`.
    const branch = CODE.slice(branchAt, CODE.indexOf("return;", branchAt));
    expect(branch).not.toContain("markSubmitted");
  });

  it("still marks the question on the two outcomes that did record an answer", () => {
    // The counterpart, so the assertion above cannot be satisfied by deleting the calls
    // altogether: accepted and rejected both mean the store holds an answer.
    expect(occurrences("markSubmitted(config.seenStorageKey")).toBe(2);
  });

  /**
   * THE RECURSION GUARD, and it has now been rewritten twice for the same reason.
   *
   * Version one read `expect(CODE).toContain("timeUp = false")` — the exact statement that
   * caused the defect — while claiming to protect against a device being locked out of the
   * next question. It certified the crash. Version two asserted that the paint path never
   * called `render`, which was true and useful, but still described code shape.
   *
   * The property is now enforced by construction and tested for real: `countdown.start`
   * *returns* whether the window is closed and never invokes `onExpire`, so the caller —
   * running inside a render — cannot be re-entered. `countdown.test.ts` proves it by
   * executing it, including a callback that hostilely re-enters `start`. What remains worth
   * asserting here is the page's half of that contract: `onExpire` is the single way back
   * into `render`, and the closed state arrives as a value.
   */
  it("re-enters render from onExpire alone", () => {
    const wiring =
      /createCountdown\(\{[\s\S]*?\n {6}\}\);/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: the wiring must have been found.
    expect(wiring).toContain("onPaint");
    expect(wiring).toContain("onExpire");
    // The paint callback must not re-enter the state machine; only the expiry may.
    const onPaintLine = wiring.slice(
      wiring.indexOf("onPaint"),
      wiring.indexOf("onExpire"),
    );
    expect(onPaintLine).not.toContain("render()");
  });

  it("keeps startCountdown free of any path back into render", () => {
    const start =
      /function startCountdown\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(start).toContain("countdown.start(");
    expect(start).not.toContain("render()");
  });

  it("answers the closed state by return value, not by a shared flag", () => {
    // A module-level flag is what the first version used, and `stopCountdown` — the first
    // statement of `render` — reset it out from under the caller about to read it. A
    // returned value cannot be stale and cannot be cleared by anyone else.
    expect(CODE).not.toMatch(/\blet\s+timeUp\b/);
    expect(CODE).toContain("const timeUp = startCountdown(");
  });
});
