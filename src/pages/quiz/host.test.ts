import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The host page's poll loop, guarded structurally (roadmap S-04, extended by S-08).
 *
 * ## Why this file scans source instead of running the loop
 *
 * `host.astro`'s `<script>` block is not importable — nothing in the project loads it, and
 * there is no harness for an Astro page's inline script. So the loop's *behaviour* is verified
 * manually, per the plan's Phase 4 manual rows, and what can be protected here is the
 * **structure that behaviour depends on**.
 *
 * That distinction is the honest one and it is worth stating plainly rather than letting a
 * green file imply more: nothing below proves the poll fires at the right moment, stops at
 * the right moment, or paints the right numbers. What it proves is that there is still
 * exactly one timer, one predicate and one fetch site — the properties whose loss produced
 * the bugs `host.astro`'s own docstrings record.
 *
 * `participation.test.ts` and `boundary.test.ts` take the same approach for the same reason,
 * including stripping comments first so the file can explain its own rules without tripping
 * them.
 */

const SOURCE = readFileSync(fileURLToPath(new URL("./host.astro", import.meta.url)), "utf8");

/**
 * Comments stripped, for the reason `participation.test.ts` gives: a rule whose reason is not
 * written next to it is a rule someone deletes, and a scan over raw source would force this
 * page to choose between explaining itself and passing.
 */
const CODE = SOURCE.replace(/<!--[\s\S]*?-->/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/.*$/gm, "");

function occurrences(needle: string): number {
  return CODE.split(needle).length - 1;
}

describe("the scan can see the code it is checking", () => {
  /**
   * The closing button's half of the non-vacuity check (roadmap S-10). Its guards are
   * scanned below and every one of those assertions would pass on an empty string.
   */
  it("still has the closing button's code left after comments are stripped", () => {
    expect(CODE).toContain("function syncEndButton");
    expect(CODE).toContain("endButton.addEventListener");
  });

  /**
   * Without this, a stripper that over-matched would empty the source and turn every
   * assertion below green by vacuity — the failure mode `keys.test.ts` guards with its own
   * non-empty-registry check.
   */
  /**
   * The flow verbs' half. Every assertion in "flow verbs are offered only where they
   * apply" reads one of these two, and an empty match makes all of them vacuously true.
   */
  it("still has the control table's code left after comments are stripped", () => {
    expect(CODE).toContain("function syncControls");
    expect(CODE).toContain("CONTROL_RULES");
  });

  it("still has the loop's code left after comments are stripped", () => {
    expect(CODE).toContain("function runPoll");
    expect(CODE).toContain("function schedulePoll");
    expect(CODE).toContain("function pollTargetFor");
  });
});

/**
 * THE ONE-LOOP PROPERTY.
 *
 * `host.astro`'s `polling` flag exists because a tick armed from `render` while a fetch was
 * open held several requests at once — worst exactly when the venue network was worst. S-08
 * added a second panel with its own endpoint and deliberately did **not** add a second timer:
 * two loops mean two backoffs, two in-flight flags, and two chances to leave a timer running
 * for a panel that is no longer on screen.
 */
describe("there is exactly one poll loop", () => {
  it("arms a timer from exactly one place", () => {
    expect(occurrences("setTimeout")).toBe(1);
  });

  /**
   * **Matched by shape, not by name**, and the first version of this test was the weak kind
   * `lessons.md` warns about: it asserted `let pollTimer` appeared once, which stays true when
   * someone declares `let cloudTimer` beside it. Verified by adding exactly that and watching
   * the test pass. Counting *any* timer-ish declaration is what the assertion always meant.
   */
  it("holds exactly one timer handle, one in-flight flag and one interval", () => {
    // A second of any of these is the shape a second loop takes.
    expect(CODE.match(/\blet\s+\w*[Tt]imer\b/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\blet\s+polling\b/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\blet\s+\w*[Dd]elay\b/g) ?? []).toHaveLength(1);
  });

  it("clears the timer from exactly one place", () => {
    expect(occurrences("clearTimeout")).toBe(1);
  });

  /**
   * **The polled request is bounded** (impl review F1). Without a timeout a stall leaves
   * `polling` true, so no tick re-arms, and `pollFailed` never runs, so no staleness marker
   * appears — a frozen panel that looks live, which is the one thing the marker exists to
   * prevent. `src/lib/client/answer.ts` bounds both of its calls for the reason its docstring
   * states; this loop had none.
   */
  it("bounds the polled request with a timeout", () => {
    expect(CODE).toContain("AbortSignal.timeout(POLL_TIMEOUT_MS)");
  });

  /**
   * The two panels are fed by two endpoints and **one** fetch call site: the URL comes off the
   * target rather than being written at the call. A second `fetch` for the cloud would be a
   * second request path with its own error handling, and the 401 branch — which is about the
   * log noise an unprotected page can generate — would then exist in two versions that could
   * disagree.
   */
  it("issues the polled request from exactly one fetch site", () => {
    // `fire` and `refresh` have their own fetches for host *actions*; those are not polled.
    // The polled one is the only one that reads a target's url.
    expect(occurrences("fetch(target.url")).toBe(1);
    expect(CODE).not.toContain("/api/quiz/host/words?");
    expect(CODE).not.toContain("/api/quiz/host/participation?");
  });
});

/**
 * THE SINGLE PREDICATE.
 *
 * `host.astro` states it as a rule: one predicate governs both the panel and the poll, because
 * two conditions would let the poll run for a question whose panel is not rendered — a data
 * path with no affordance, which is the mirror of `lessons.md`'s first rule and fails just as
 * quietly. The panels ask `pollTargetFor`; nothing re-derives the condition.
 */
describe("one predicate decides both the panels and the poll", () => {
  it("routes both panels through pollTargetFor", () => {
    expect(CODE).toContain('pollTargetFor(state)?.kind === "participation"');
    expect(CODE).toContain('pollTargetFor(state)?.kind === "words"');
  });

  /**
   * **Scoped to the predicate's own body, not counted across the file**, and the first version
   * of this test got that wrong: it asserted the condition appeared once in total and failed at
   * 2, because `pollTargetFor` legitimately names the phase twice — once for the word cloud's
   * two phases and once for the participation count's one. Counting occurrences globally
   * measured the wrong thing entirely.
   *
   * What matters is that no *other* function re-derives the phase-and-kind condition, since
   * that is how a panel and its poll drift apart.
   */
  it("keeps the phase-and-kind condition inside the predicate and nowhere else", () => {
    const predicate =
      /function pollTargetFor[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    expect(predicate).toContain('state.phase !== "question-open"');

    const elsewhere = CODE.replace(predicate, "");
    expect(elsewhere).not.toContain('phase !== "question-open"');
    expect(elsewhere).not.toContain('kind === "single-choice"');
  });
});

/**
 * THE FINAL-READ GATE (roadmap S-08).
 *
 * The word-cloud target covers `question-revealed` so the host keeps a complete cloud to talk
 * over — but no submission can arrive in that phase, so every tick after the first returns the
 * same bytes. Without the flag the loop re-arms forever on a revealed question, because the
 * panel is still on screen and the target still exists.
 *
 * **`schedulePoll` must be gated on `pollWanted`, not on `pollTargetFor`**, in both places it
 * is reached: `render` and `runPoll`'s `finally`. Missing it in the `finally` alone is enough
 * to keep the loop alive.
 */
describe("the word cloud's final read closes the loop", () => {
  it("tracks which question has had its final read", () => {
    expect(CODE).toContain("cloudFinalReadFor");
  });

  it("gates every re-arm on pollWanted rather than on the target existing", () => {
    // Two call sites: `render` and the `finally` in `runPoll`. Both must consult the gate, or
    // a revealed word-cloud question polls until the host advances.
    expect(occurrences("if (pollWanted(")).toBe(2);
    expect(CODE).not.toContain("if (pollTargetFor(client.current())) schedulePoll()");
  });

  /**
   * **Gated on the phase the request was ISSUED in, not the phase it arrived in** (impl review
   * F2). This test previously asserted `client.current()?.phase === "question-revealed"` — the
   * arrival phase — and so pinned the defect in place: a reply computed while the question was
   * open counted as final whenever the host revealed mid-flight, dropping every word submitted
   * in the interval from the cloud the host then talks over.
   *
   * Two halves, because either alone permits the bug: the flag must be derived from a value
   * captured before the fetch, and the arrival-phase form must be gone.
   */
  /**
   * **Staleness is cleared only when a cloud actually arrived** (impl review F6).
   *
   * Added because moving `cloudStale = false` back out of the `Array.isArray` branch broke
   * nothing in this file — the fix was real and unguarded. A 200 whose body had lost its `words`
   * array keeps the previous cloud, correctly, and would then present it as fresh: the same
   * "looks live but isn't" failure the timeout above exists to prevent, reached through the body
   * instead of through the network.
   */
  it("clears staleness only inside the branch where a cloud arrived", () => {
    const branch =
      /if \(Array\.isArray\(payload\.words\)\) \{[\s\S]*?\n {12}\}/.exec(CODE)?.[0] ?? "";

    expect(branch).toContain("cloudWords = payload.words");
    expect(branch).toContain("cloudStale = false");

    /**
     * **Scoped to the words handler, not counted across the file**, and the first version of
     * this assertion got that wrong: it required exactly one `cloudStale = false` in the whole
     * page and failed on correct code, because `resetPanels` legitimately clears it too. What
     * matters is that the words handler clears it *only* inside the branch above — so this looks
     * at what follows that branch, which is where moving the line puts it.
     */
    const afterBranch = CODE.slice(CODE.indexOf(branch) + branch.length, CODE.indexOf("} else {"));
    expect(afterBranch).not.toContain("cloudStale = false");
  });

  it("records the final read from the phase the request was issued in", () => {
    expect(CODE).toContain("const issuedInPhase");
    expect(CODE).toContain('issuedInPhase === "question-revealed"');
    // Recorded while the question is open, the loop would end on the first tick and the cloud
    // would freeze while the room was still writing into it.
    expect(CODE).not.toContain('client.current()?.phase === "question-revealed"');
  });
});

/**
 * THE NO-WRITE PROPERTY, from the page's side.
 *
 * `participation.test.ts` and `words.test.ts` assert their own routes never write. This is the
 * other half: the page must not reach for a *write* route on a polled path. During
 * `question-open` the session document's `updatedAt` is the moment the question opened and
 * bounds the speed clamp, so a write from anything that runs on a timer inflates every award
 * after it, silently.
 */
describe("nothing on the polled path writes", () => {
  it("polls only the two read endpoints", () => {
    expect(CODE).toContain("/api/quiz/host/words");
    expect(CODE).toContain("/api/quiz/host/participation");
  });

  it("reaches a host action only through the button handler", () => {
    // `fire` is the only place an action URL is built, and it is driven by a click.
    expect(occurrences("/api/quiz/host/${action}")).toBe(1);
  });
});

/**
 * THE FLOW VERBS' PHASE RULE.
 *
 * S-07 wrote the principle on the standings button alone — *disabled everywhere else rather
 * than relying on the route's 409; the refusal is the backstop, not the interaction* — and
 * `start`, `advance` and `reveal` never got it, so the host could tap `pokaż odpowiedź` in
 * the lobby and be answered by an error. `CONTROL_RULES` extends it to all four verbs.
 *
 * What this file can protect is the structure, not the behaviour: an Astro inline script has
 * no harness, so which button is dark in which phase is verified by hand. What is asserted
 * here is that the rule still exists **in one place** and is still applied at **every** site
 * that can undo it — the two properties whose loss is silent on screen.
 *
 * Every assertion below was verified in both directions.
 */
describe("flow verbs are offered only where they apply", () => {
  const sync = /function syncControls[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
  const table = /const CONTROL_RULES[\s\S]*?\n {6}};/.exec(CODE)?.[0] ?? "";

  it("finds the function and the table it is checking", () => {
    expect(sync.length).toBeGreaterThan(0);
    expect(table.length).toBeGreaterThan(0);
  });

  /**
   * **Every state the view can be in has a row.** A missing phase falls back to the
   * sessionless row, which on a projector looks like a panel that stopped responding to
   * the session.
   *
   * **Scoped to the table, not to the file**, and the first version of this got that
   * wrong: it asserted `ended:` appeared in `CODE`, which stayed true when the row was
   * renamed, because `PHASE_LABELS` carries the same key. Verified by renaming the row and
   * watching it pass — the assertion was measuring the wrong map entirely.
   */
  it("answers all five phases and the sessionless state", () => {
    expect(table).toContain("[NO_SESSION]:");
    expect(table).toContain("lobby:");
    expect(table).toContain('"question-open":');
    expect(table).toContain('"question-revealed":');
    expect(table).toContain("standings:");
    expect(table).toContain("ended:");
  });

  /**
   * **The table is read only by `syncControls`.** A second reader is a second place for the
   * rule to drift from what the routes accept — the same discipline `pollTargetFor` is held
   * to above, and for the same reason.
   */
  it("reads the table from nowhere but the sync", () => {
    expect(sync).toContain("CONTROL_RULES[");
    expect(CODE.replace(sync, "")).not.toContain("CONTROL_RULES[");
  });

  /**
   * **Enablement is derived from the table, not written per button.** The `allow` list is
   * the whole condition; a hand-written `phase === …` beside a button is how the panel and
   * the routes come apart.
   */
  it("derives every flow verb's enablement from the allow list", () => {
    expect(sync).toContain("rule.allow.includes(action)");
    expect(sync).toContain("button.disabled = !allowed");
  });

  /**
   * **Applied at all three sites.** `render`'s ordinary path, `render`'s sessionless early
   * return, and `fire`'s `finally` — which re-enables every button unconditionally, so
   * missing it there hands back a panel that offers actions the phase refuses. Missing it in
   * the early return leaves the previous session's buttons live after a purge or an expiry.
   */
  it("re-applies the rule everywhere a button could come back wrongly enabled", () => {
    // The trailing semicolon is what separates the three calls from the declaration.
    expect(occurrences("syncControls();")).toBe(3);

    const fireBody = /async function fire\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    expect(fireBody.length).toBeGreaterThan(0);
    expect(fireBody).toContain("syncControls()");
  });

  /**
   * The per-button rule it replaced. Left behind, it would be a second owner of the
   * standings button's phase condition.
   */
  it("leaves no per-button phase rule behind", () => {
    expect(CODE).not.toContain("syncStandingsButton");
  });
});

/**
 * THE CLOSING BUTTON (roadmap S-10, FR-006).
 *
 * This page's docstring used to say `end` was deliberately not here, and this slice reversed
 * that for the one verb FR-006 asks the host to trigger. What made the reversal defensible is
 * a set of guards, none of which any test can execute — an Astro inline script has no
 * harness — so what is protected here is the structure they consist of.
 *
 * Every assertion below was verified in both directions: it passes on the code as written and
 * fails when the guard it names is removed. A scan that has only ever seen correct code has
 * been written, not verified (`lessons.md`).
 */
describe("the closing button cannot fire by accident", () => {
  const handler = /endButton\.addEventListener\([\s\S]*?\n {6}\}\);/.exec(CODE)?.[0] ?? "";
  const sync = /function syncEndButton[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

  it("finds the handler and the sync it is checking", () => {
    // The two extractions above are what every assertion in this block reads. An empty
    // match would make all of them vacuously true.
    expect(handler.length).toBeGreaterThan(0);
    expect(sync.length).toBeGreaterThan(0);
  });

  /**
   * **The blanket handler must not be able to reach it.** Every flow verb is driven by one
   * `click` listener over `button[data-action]`; giving the closing button that attribute
   * would wire it into the same path — firing on a single tap, with no body, so the route's
   * confirmation would arrive absent rather than stale.
   */
  it("is not wired into the flow verbs' blanket click handler", () => {
    expect(CODE).toContain('id="end"');
    expect(CODE).not.toContain('data-action="end"');
  });

  /**
   * **Two taps, and the first one only arms.** The early return on `!endArmed` is the
   * whole mechanism; without it the first tap ends the session.
   */
  it("returns after arming rather than firing on the first tap", () => {
    expect(handler).toContain("if (!endArmed)");
    expect(handler.indexOf("if (!endArmed)")).toBeLessThan(handler.indexOf('fire("end"'));
  });

  /**
   * **The confirmed version travels with the request.** `end` reads it from the form and
   * from nowhere else, so a request without one is refused as unconfirmed — and a request
   * carrying a *freshly read* version would make the confirmation a formality that always
   * matches.
   */
  it("sends the version it was armed at, not a freshly read one", () => {
    expect(handler).toContain('body.set("version", String(version))');
    expect(handler).toContain("endArmedVersion ?? state.version");
    expect(handler).not.toContain('body.set("version", String(state.version))');
  });

  /** One call site, reached only through the handler above. */
  it("reaches the end route from exactly one place", () => {
    expect(occurrences('fire("end"')).toBe(1);
  });

  /**
   * **An arm does not survive the session moving.** Any accepted action bumps the version,
   * so an arm taken against an older one is a statement about a state the host is no longer
   * looking at — exactly the mis-click the reversal had to answer.
   */
  it("disarms when the session has moved under the armed version", () => {
    expect(sync).toContain("endArmedVersion");
    expect(sync).toContain("state?.version !== endArmedVersion");
    expect(sync).toContain("endArmed = false");
  });

  /**
   * **The phase rule wins over `fire`'s blanket re-enable**, which is why
   * `syncStandingsButton` is called in that `finally` too. Missing here, an action would
   * hand back a closing button enabled in a phase that refuses it — and still armed.
   */
  it("re-applies the phase rule after every action's blanket re-enable", () => {
    const fireBody = /async function fire\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(fireBody.length).toBeGreaterThan(0);
    expect(fireBody).toContain("syncEndButton()");
  });

  /**
   * **`purge` did not come along.** S-10 reversed the F-03 placement for `end` alone; the
   * verb that deletes with no undo and no ten-minute window stays on the harness page.
   */
  it("leaves purge off this page entirely", () => {
    expect(CODE).not.toContain('fire("purge"');
    expect(CODE).not.toContain("/api/quiz/host/purge");
  });
});

/**
 * The panel reset (roadmap S-04's rule, inherited by S-08).
 *
 * A first paint under a new prompt carrying the previous question's numbers is plausible and
 * wrong, and a stale *word* is worse than a stale count: a chip is something somebody wrote,
 * so leaving it attributes it to the question now on screen.
 */
describe("both polled panels reset together when the question changes", () => {
  it("resets through one function rather than per panel", () => {
    expect(CODE).toContain("function resetPanels");
    expect(CODE).toContain("if (state.currentQuestionId !== panelQuestionId) resetPanels(");
  });

  it("clears the cloud's state in that reset", () => {
    const reset = /function resetPanels[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(reset).toContain("cloudWords = null");
    expect(reset).toContain("cloudDistinct = 0");
    expect(reset).toContain("cloudStale = false");
    expect(reset).toContain("answered = null");
    /**
     * **And deliberately NOT `cloudFinalReadFor`.** It is keyed by question id, so it needs no
     * clearing — and clearing it here would re-open the loop for a question the host had
     * already revealed and then come back to.
     */
    expect(reset).not.toContain("cloudFinalReadFor");
  });
});
