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

const SOURCE = readFileSync(fileURLToPath(new URL("./index.astro", import.meta.url)), "utf8");

const CODE = SOURCE.replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

function occurrences(needle: string): number {
  return CODE.split(needle).length - 1;
}

describe("the scan can see the code it is checking", () => {
  /**
   * Without this, a stripper that over-matched would empty the source and turn every
   * assertion below green by vacuity — the failure `keys.test.ts` guards with its own
   * non-empty-registry check, and the one S-08 shipped four times in a single change.
   */
  it("still has the countdown's code left after comments are stripped", () => {
    expect(CODE).toContain("function stopCountdown");
    expect(CODE).toContain("function startCountdown");
    expect(CODE).toContain("function paintCountdown");
  });

  it("still has the state machine's code left after comments are stripped", () => {
    expect(CODE).toContain("function render()");
    expect(CODE).toContain("function renderOpen(");
  });
});

/**
 * THE ONE-TIMER PROPERTY, on the phone.
 *
 * The host page's version of this exists because a tick armed from `render` while a fetch was
 * open held several requests at once. The phone's timer fetches nothing, so the stake is
 * different and narrower: a clock left running for a question that has left the screen keeps
 * repainting a stale remainder, and — because reaching zero calls `render()` — an orphaned one
 * can take the controls away from the *next* question.
 *
 * Matched by shape rather than by name, which is the correction `lessons.md` records against
 * the first version of the host page's guard: it asserted `let pollTimer` appeared once, and
 * that stayed true the moment someone declared `let cloudTimer` beside it.
 */
describe("there is exactly one countdown timer", () => {
  it("arms a timer from exactly one place", () => {
    expect(occurrences("setTimeout")).toBe(1);
  });

  it("holds exactly one timer handle", () => {
    // A second of these is the shape a second clock takes.
    expect(CODE.match(/\blet\s+\w*[Tt]imer\b/g) ?? []).toHaveLength(1);
  });

  it("clears the timer from exactly one place", () => {
    expect(occurrences("clearTimeout")).toBe(1);
  });

  /**
   * **No `setInterval`.** Both of this project's other timers are self-re-arming `setTimeout`
   * chains, and the countdown is a third — an interval cannot be re-aimed at the next whole
   * second, and it keeps firing after the thing it was painting is gone.
   */
  it("uses no interval", () => {
    expect(CODE).not.toContain("setInterval");
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
  it("clears from exactly one call site", () => {
    expect(occurrences("stopCountdown()")).toBe(2); // the definition plus its one call
  });

  it("clears before the state machine branches", () => {
    const renderAt = CODE.indexOf("function render()");
    const clearAt = CODE.indexOf("stopCountdown();", renderAt);
    const firstBranchAt = CODE.indexOf('connection === "lost"', renderAt);

    expect(renderAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(renderAt);
    // Ahead of the first branch, so no early return can skip it.
    expect(clearAt).toBeLessThan(firstBranchAt);
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

  it("does not lock a timed-out device out of the next question", () => {
    // `timeUp` is derived on every render and reset by `stopCountdown`. A version that
    // persisted it would carry one question's expiry into the next.
    expect(CODE).toContain("timeUp = false");
  });
});
