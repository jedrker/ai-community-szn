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

const SOURCE = readFileSync(
  fileURLToPath(new URL("./host.astro", import.meta.url)),
  "utf8",
);

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
  /**
   * **This assertion used to read `occurrences("setTimeout") === 1`, and S-11 had to change
   * it — which is the case `lessons.md` describes.**
   *
   * That form asserted a *shape*: "this file contains one timer". The property it was written
   * to protect is narrower and is about cost — one loop that *fetches*, so there is one
   * backoff, one in-flight flag, and one thing able to spend commands for a panel nobody is
   * looking at. S-11 added a countdown: a timer that touches no endpoint, has no backoff, and
   * cannot appear in the runbook's command tripwire because it issues no request. Under the
   * old form the only way to add it was to weaken the guard to `=== 2`, which protects nothing.
   *
   * So the count is scoped to the loop's own machinery instead. `schedulePoll` and `runPoll`
   * *are* the poll; a second timer inside either is a second loop, and that is what fails here.
   */
  it("arms the polled tick from exactly one place", () => {
    const scheduler =
      /function schedulePoll\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    const runner = /function runPoll\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: both bodies must actually have been found, or the count below is zero
    // against zero and the guard applauds an empty string.
    expect(scheduler).toContain("pollDelay");
    expect(runner).toContain("fetch(target.url");

    expect((scheduler + runner).split("setTimeout").length - 1).toBe(1);
  });

  /**
   * **The property, stated directly: exactly one timer arms a fetch.**
   *
   * Every `setTimeout` callback in the file is classified by what it can reach. A second
   * *fetching* timer fails; a second painting timer does not. That is the distinction a raw
   * count cannot make, and it is the one that matters — two fetching loops mean two backoffs
   * and two chances to leave requests firing for a panel that is off screen.
   */
  it("has exactly one timer whose callback can fetch", () => {
    const callbacks = [
      ...CODE.matchAll(/setTimeout\(\(\) => \{([\s\S]*?)\}, /g),
    ].map((m) => m[1]!);

    // Non-vacuity: if the pattern stops matching, fail rather than pass on an empty list.
    expect(callbacks.length).toBeGreaterThan(0);

    const fetching = callbacks.filter(
      (body) => body.includes("runPoll") || body.includes("fetch("),
    );
    expect(fetching).toHaveLength(1);
  });

  /**
   * **Matched by shape, not by name**, and the first version of this test was the weak kind
   * `lessons.md` warns about: it asserted `let pollTimer` appeared once, which stays true when
   * someone declares `let cloudTimer` beside it. Verified by adding exactly that and watching
   * the test pass. Counting *any* timer-ish declaration is what the assertion always meant.
   *
   * S-11 raised the handle count to two while the countdown was inline, then an
   * implementation review sent that state machine to `countdown.ts` — so the number is back
   * to one, and the name is pinned so "one" cannot be satisfied by some other timer.
   * `polling` and the delay stay at one each, because they belong to the fetching loop alone.
   */
  it("holds exactly one timer handle, one in-flight flag and one delay", () => {
    // S-11 briefly made this two, when the countdown was inline. Extracting that state
    // machine into `countdown.ts` — after a review found it outliving a purged session —
    // returned this page to one timer, which is the number the property always wanted.
    expect(CODE.match(/\blet\s+\w*[Tt]imer\b/g) ?? []).toHaveLength(1);
    expect(CODE).toContain("let pollTimer");

    expect(CODE.match(/\blet\s+polling\b/g) ?? []).toHaveLength(1);
    expect(CODE.match(/\blet\s+\w*[Dd]elay\b/g) ?? []).toHaveLength(1);
  });

  it("clears the polled timer from exactly one place", () => {
    // One `clearTimeout` in the file, inside the function that owns the poll — so the loop
    // cannot be cancelled from a branch with no business doing it. The countdown's own
    // cancellation lives in `countdown.ts` and is tested there.
    expect(occurrences("clearTimeout")).toBe(1);

    const stopPolling =
      /function stopPolling\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    expect(stopPolling.split("clearTimeout").length - 1).toBe(1);
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
 * THE COUNTDOWN'S OWN RULE (roadmap S-11, FR-020).
 *
 * It spends no commands, so the poll's bounding — the timeout, the backoff, the in-flight
 * flag — does not apply to it and asserting those here would be cargo. What does apply is
 * that it must not outlive its question: a clock left running under the next prompt shows
 * the room a number belonging to a question that has gone, and because it repaints on its
 * own it would keep looking live while doing it.
 */
describe("the countdown cannot outlive its question", () => {
  /**
   * **This assertion used to scope itself to `renderCountdownPanel`'s body, and that is
   * exactly how it missed a live bug.**
   *
   * The panel renderer cleared at its own top, which looked correct in isolation — but it
   * is called near the *end* of `render`, and the `state === null` branch returns long
   * before reaching it. A purge or a TTL expiry therefore left the clock ticking over the
   * "brak sesji" screen, and the renderer's own null handling was dead code. The guard
   * passed throughout, because it never looked at the call site.
   *
   * So it now asserts the property where the property lives: the clear happens at the top
   * of `render`, ahead of every branch, so no early return can skip it.
   */
  it("clears at the top of render, ahead of every branch", () => {
    const renderAt = CODE.indexOf("function render(): void");
    expect(renderAt).toBeGreaterThan(-1);

    const clearAt = CODE.indexOf("stopCountdown();", renderAt);
    const firstBranch = CODE.indexOf("if (state === null)", renderAt);

    expect(clearAt).toBeGreaterThan(renderAt);
    expect(firstBranch).toBeGreaterThan(-1);
    expect(clearAt).toBeLessThan(firstBranch);
  });

  it("arms from the panel renderer without clearing there, so the two cannot drift", () => {
    const panel =
      /function renderCountdownPanel\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: the body must have been found.
    expect(panel).toContain("state.phase");
    // Arm-only. A clear here would re-create the split that hid the bug above.
    expect(panel).not.toContain("stopCountdown()");
    expect(panel).toContain("countdown.start(");
  });

  it("stops wherever the poll stops", () => {
    // The two lifecycle exits. A countdown left armed at `pagehide` is the "timer that
    // outlives the page" case that handler exists for.
    const visibility = CODE.slice(
      CODE.indexOf('addEventListener("visibilitychange"'),
      CODE.indexOf('addEventListener("pagehide"'),
    );
    expect(visibility).toContain("stopCountdown()");

    const pagehide = CODE.slice(CODE.indexOf('addEventListener("pagehide"'));
    expect(pagehide.slice(0, 300)).toContain("stopCountdown()");
  });

  /**
   * **Keyed on the limit's presence, never on a phase or kind list.** The schema decides
   * which questions carry a clock — required when scored, refused when not — and a list here
   * would be a second copy of that rule, able to fall behind it. Both views apply the same
   * reasoning to the standings board's visibility.
   */
  it("keys on the limit rather than re-deciding which kinds have a clock", () => {
    const panel =
      /function renderCountdownPanel\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(panel).toContain("timeLimitSeconds === undefined");
    expect(panel).not.toContain('kind === "word-cloud"');
    expect(panel).not.toContain("scored");
  });

  it("reads the remainder from the snapshot, not from a local clock", () => {
    // `updatedAt + limit` is the same arithmetic every phone does from the same two values,
    // which is what stops the projector drifting from the room. A countdown seeded from when
    // this page happened to paint would disagree with all 150 of them.
    const panel =
      /function renderCountdownPanel\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(panel).toContain("countdown.start(state.updatedAt");
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
    /**
     * **Scoped to what the poll re-derives, which now needs saying out loud (S-11).**
     *
     * The countdown reads the phase too — it shows a clock only while a question is open —
     * and that is not the drift this guards against. The rule is that nothing re-derives the
     * *poll's* condition, so a panel and its poll cannot disagree about whether to run. The
     * countdown fetches nothing and has no panel-versus-poll pair to fall out of step.
     *
     * So the countdown's renderer is excluded by name rather than the assertion being
     * loosened, and the kind test below still covers the whole file: the countdown must key
     * on the limit's presence, never on a kind.
     */
    const withoutCountdown = elsewhere.replace(
      /function renderCountdownPanel\([\s\S]*?\n {6}}/,
      "",
    );

    // Non-vacuity: the exclusion must have removed something, or it is hiding nothing and
    // the assertion below is weaker than it reads.
    expect(withoutCountdown.length).toBeLessThan(elsewhere.length);

    expect(withoutCountdown).not.toContain('phase !== "question-open"');
    expect(elsewhere).not.toContain('kind === "single-choice"');
  });
});

/**
 * THE LOBBY'S JOIN COUNT.
 *
 * A join publishes nothing — that is the spine contract, not an oversight — so the snapshot's
 * `playerCount` only moves on a host action. In the lobby that is the phase where the host acts
 * least and the number changes most, so the figure sat frozen until somebody pressed `odśwież`.
 * The fix is a third target on the **same** loop; what these guard is that it stayed one loop,
 * and that a target with no panel of its own cannot write into the two that have one.
 */
describe("the lobby's join count refreshes on the one loop", () => {
  it("gives the lobby a target rather than a loop of its own", () => {
    const predicate =
      /function pollTargetFor[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: the body must have been found.
    expect(predicate).toContain("PollTarget");
    expect(predicate).toContain('state.phase === "lobby"');
    expect(predicate).toContain('url: "/api/quiz/state"');

    /**
     * The endpoint is named once, so the lobby cannot grow a fetch beside the loop's. The
     * `odśwież` button reaches the same route through `client.refresh()` and does not spell
     * it here — a second literal would be a second request path with its own error handling.
     *
     * The *phase* is deliberately not counted: `applyShell` names the lobby too, and that is
     * a layout rule with no poll to drift from — the same exclusion the countdown gets above.
     */
    expect(occurrences('"/api/quiz/state"')).toBe(1);
  });

  /**
   * **The discard guard is about a question, so a target with no question must be exempt.**
   * `/api/quiz/state` returns no `questionId`, and in the lobby `currentQuestionId` is `null`
   * — so the unconditional form dropped every lobby reply on the floor, silently, leaving the
   * count exactly as frozen as before while the requests went out.
   */
  it("exempts the lobby from the stale-question discard", () => {
    const runner =
      /async function runPoll\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(runner).toContain("fetch(target.url");
    expect(runner).toContain('target.kind !== "lobby" &&');
  });

  /**
   * **The slower lobby tick is a floor on the one delay, not a second delay.**
   *
   * A second interval variable would be a second backoff, which is most of what a second loop
   * is — so the guard above ("one timer handle, one in-flight flag and one delay") is what
   * forces this shape, and `Math.max` is what keeps the backoff working on top of the floor.
   */
  it("slows the lobby with a floor rather than a second delay", () => {
    const scheduler =
      /function schedulePoll\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(scheduler).toContain("LOBBY_POLL_MS");
    // The backoff must survive the floor: pinned at the floor, a failing lobby tick would
    // keep its fast interval exactly when the page is least able to pay for it.
    expect(scheduler).toContain("Math.max(pollDelay,");
    expect(CODE).toContain("const LOBBY_POLL_MS");
  });

  /**
   * The lobby target feeds no panel, so a failed tick has no "(nieaktualne)" to set. The
   * `else` this replaced would have marked the *participation* count stale for a question
   * that is not open — a marker beside a number nobody is polling, which is the one thing
   * `pollFailed`'s own docstring says it must not do.
   */
  it("marks only a panel that asked as stale", () => {
    const failed = /function pollFailed\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(failed).toContain("pollDelay");
    expect(failed).toContain('else if (kind === "participation")');
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
    expect(CODE).not.toContain(
      "if (pollTargetFor(client.current())) schedulePoll()",
    );
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
      /if \(Array\.isArray\(payload\.words\)\) \{[\s\S]*?\n {12}\}/.exec(
        CODE,
      )?.[0] ?? "";

    expect(branch).toContain("cloudWords = payload.words");
    expect(branch).toContain("cloudStale = false");

    /**
     * **Scoped to the words handler, not counted across the file**, and the first version of
     * this assertion got that wrong: it required exactly one `cloudStale = false` in the whole
     * page and failed on correct code, because `resetPanels` legitimately clears it too. What
     * matters is that the words handler clears it *only* inside the branch above — so this looks
     * at what follows that branch, which is where moving the line puts it.
     */
    const afterBranch = CODE.slice(
      CODE.indexOf(branch) + branch.length,
      CODE.indexOf("} else {"),
    );
    expect(afterBranch).not.toContain("cloudStale = false");
  });

  it("records the final read from the phase the request was issued in", () => {
    expect(CODE).toContain("const issuedInPhase");
    expect(CODE).toContain('issuedInPhase === "question-revealed"');
    // Recorded while the question is open, the loop would end on the first tick and the cloud
    // would freeze while the room was still writing into it.
    expect(CODE).not.toContain(
      'client.current()?.phase === "question-revealed"',
    );
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
    // The trailing semicolon is what separates the calls from the declaration. Three of the
    // four are the sites above; the fourth is the reveal's arming tap, which changes the
    // button's label and so must repaint the bar through the same function rather than
    // writing `textContent` itself — a second writer of that label is how the armed state
    // and the word-cloud rename come apart.
    expect(occurrences("syncControls();")).toBe(4);

    const fireBody =
      /async function fire\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
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

  /**
   * THE REVEAL VERB'S NAME ON A QUESTION WITH NO ANSWER.
   *
   * A word-cloud question is unscored and has no correct answer, so `pokaż odpowiedź` names a
   * beat that cannot happen — while the button still does the necessary work of closing
   * submissions and freezing the cloud. The fix is the label, and the two ways to get it wrong
   * are both silent: renaming it from a fresh `kind === "word-cloud"` test (a second kind
   * predicate, free to drift from `pollTargetFor`), or "fixing" it by dropping `reveal` from
   * the `question-open` row, which leaves the cloud with no way to close.
   */
  it("renames the reveal verb from the single predicate, and gates nothing on it", () => {
    expect(sync).toContain('pollTargetFor(state)?.kind === "words"');
    // The name still comes from that predicate and from nothing else. What sits between it
    // and `textContent` now is the armed label, which is a state of the same button rather
    // than a second opinion about what it is called — see the confirmation block below.
    expect(sync).toContain(
      "const name = revealCloses ? REVEAL_LABEL_CLOSES : REVEAL_LABEL",
    );
    expect(sync).toContain(
      "button.textContent = revealArmed ? REVEAL_CONFIRM_LABEL : name",
    );

    // The rename must not have become a phase rule: `reveal` stays offered while the cloud
    // is open, because closing it is the only way on to the standings beat.
    expect(table).toContain('allow: ["advance", "reveal"]');
    // …and the label lives outside the table, which states legality and nothing else.
    expect(table).not.toContain("revealCloses");
  });

  /**
   * THE STANDINGS VERB ONCE THE BOARD IS ALREADY UP.
   *
   * It stays enabled in the `standings` phase, and that is the recovery path its own 502
   * names: "Kliknij ponownie, aby rozgłosić go jeszcze raz", by which point the session is
   * already in that phase. Disabling it points that instruction at a dark button and leaves
   * `dalej` — which abandons the beat — as the only way on (impl review F5).
   *
   * So the fix for "why is this still clickable" is the **name and the hint**, never the
   * gate. Pinned here because the tidy-looking change is to drop `standings` from that row.
   */
  it("renames the standings verb rather than gating it once the board is up", () => {
    expect(sync).toContain('const standingsAgain = phase === "standings"');
    expect(sync).toContain(
      "button.textContent = standingsAgain ? STANDINGS_LABEL_AGAIN : STANDINGS_LABEL",
    );

    // The gate is untouched: the phase still offers the verb, which is what makes the retry
    // reachable at all.
    expect(table).toContain('allow: ["advance", "standings"]');
    // And the naming stays out of the table, exactly as the reveal's does.
    expect(table).not.toContain("standingsAgain");
    expect(table).not.toContain("STANDINGS_LABEL");
  });

  /**
   * **An enabled button's hint and a dark button's reason are different statements**, and a
   * button must never carry both — one asks "why can I not press this", the other "why would
   * I press this here". Resolved into one `title` rather than by two writes, so the second
   * cannot overwrite the first depending on which branch ran last.
   */
  it("carries one title, sourced by whether the button is live", () => {
    expect(sync).toContain("const title = allowed ? hint : reason");
    expect(occurrences("button.title = ")).toBe(1);
    // The only live verb with a hint: everything else says what it does in its own name.
    expect(sync).toContain("STANDINGS_AGAIN_HINT");
  });

  /**
   * **The one `applied: false` that did something.** Without its own branch, a successful
   * re-broadcast is reported by the generic note as "nic do zrobienia (koniec pytań?)" — the
   * retry that just worked, described as the interaction that does nothing.
   */
  it("reports a re-broadcast as an outcome of its own", () => {
    const fireBody =
      /async function fire\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(fireBody.length).toBeGreaterThan(0);
    expect(fireBody).toContain('payload.note === "republished"');
    expect(fireBody.indexOf('payload.note === "republished"')).toBeLessThan(
      fireBody.indexOf('payload.note === "no-op"'),
    );
  });

  /**
   * THE LAST QUESTION.
   *
   * `advance` is a no-op past the last question — `advance.ts` returns null when
   * `nextQuestionId` does — so the panel was ringing `dalej` as the next step and answering
   * the tap with "nic do zrobienia. Stan bez zmian.", which is the exact interaction this
   * table exists to remove. The phase cannot see it: `question-revealed` on question 3 and
   * on question 14 are the same phase and want opposite bars.
   *
   * So the rule is a second dimension **of the table**, not a condition beside a button —
   * the property below — and the position it reads comes from the published question order
   * this page already holds, never from a new field on the wire.
   */
  it("answers the last question from the table rather than beside a button", () => {
    expect(table).toContain("whenLast:");
    expect(sync).toContain("atLastQuestion(state)");
    expect(sync).toContain("base.whenLast");

    // Nothing else re-decides where the end of the quiz is. `atLastQuestion` is the one
    // reading, and `syncEndButton` asks it rather than counting questions again.
    expect(occurrences("config.questions.length - 1")).toBe(1);
  });

  /**
   * **The last `question-revealed` offers no flow verb at all**, so the ring has nowhere to
   * sit on the lower line — which is why `syncEndButton` takes it. Exactly one filled pill
   * still: the row that empties the bar is the row that sets `next: null`.
   */
  it("hands the next-step ring to the closing button when the bar empties", () => {
    const endSync =
      /function syncEndButton[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    expect(endSync.length).toBeGreaterThan(0);

    expect(endSync).toContain("endButton.dataset.next");
    expect(endSync).toContain("atLastQuestion(state)");
    // Never on a button the phase has already put out of reach.
    expect(endSync).toContain("!endButton.disabled");
  });
});

/**
 * The rail's visibility.
 *
 * The rail is on screen exactly when one of its three blocks is, and the rule is derived from
 * those blocks rather than written as a phase list — because the word-cloud reveal keeps its
 * counters while every other reveal has nothing, so a phase would answer the wrong question.
 *
 * Same honesty as the header: neither assertion below proves the rail actually disappears.
 * That is what the plan's manual rows are for. What these protect are the two structural
 * properties the rule rests on, both of which are invisible in a passing session and silent
 * when broken.
 */
describe("the rail follows its contents", () => {
  /**
   * **One writer.** `applyShell` used to hide the rail on `ended` while nothing hid it
   * anywhere else — a region shown by one branch and hidden by another, which that function's
   * own docstring warns against. A second `setHidden(railBox` is how it comes back.
   */
  it("writes the rail's visibility from exactly one place", () => {
    expect(occurrences("setHidden(railBox")).toBe(1);
    expect(CODE).toContain("function syncRail");
  });

  /**
   * **Applied at all three sites.** `render`'s ordinary tail and its sessionless early return,
   * each after the panels they read have settled — and `stopCountdown`, which is the one place
   * a rail block is hidden without passing through `render` (`visibilitychange` and `pagehide`
   * both call it directly). Missing it in the early return leaves an empty rail beside "brak
   * sesji" after a purge or a TTL expiry; missing it in `stopCountdown` leaves one behind a
   * backgrounded tab.
   */
  it("re-applies the rule everywhere a block could go dark without a render", () => {
    // The trailing semicolon separates the calls from the declaration, as above.
    expect(occurrences("syncRail();")).toBe(3);

    const stopBody =
      /function stopCountdown\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
    expect(stopBody.length).toBeGreaterThan(0);
    expect(stopBody).toContain("syncRail()");
  });
});

/**
 * THE EARLY REVEAL'S SECOND TAP.
 *
 * The reveal is the flow verb that cannot be undone: `answer.ts` accepts only in
 * `question-open`, so the tap that shows the answer is the tap that cuts off everyone still
 * typing. The guard is a confirmation, and — like the closing button's — none of it can be
 * executed by a test, so what is pinned here is the structure.
 *
 * The two ways to get it wrong are opposite and both silent: no confirmation at all, and a
 * confirmation on every reveal, which the host learns to double-tap through and which
 * therefore stops being read at the one moment it means something.
 */
describe("the reveal cannot cut the room off by accident", () => {
  const handler =
    /actionButtons\(\)\.forEach\([\s\S]*?\n {6}\}\);/.exec(CODE)?.[0] ?? "";
  const needs =
    /function revealNeedsConfirm[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";
  const sync = /function syncControls[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

  it("finds the handler and the predicate it is checking", () => {
    // An empty match would make every assertion below vacuously true.
    expect(handler.length).toBeGreaterThan(0);
    expect(needs.length).toBeGreaterThan(0);
  });

  /**
   * **The first tap only arms.** The early return is the whole mechanism; without it the
   * first tap closes the question, which is the state this guard exists to make deliberate.
   */
  it("returns after arming rather than firing on the first tap", () => {
    expect(handler).toContain("revealArmed = true");
    expect(handler.indexOf("revealArmed = true")).toBeLessThan(
      handler.indexOf("void fire(action)"),
    );
  });

  /**
   * **Only the reveal is gated.** `dalej` is the host's recovery lever and `pokaż ranking`
   * re-broadcasts; a confirmation on either would be a beat spent on an action with an undo.
   */
  it("gates the reveal alone, leaving the other verbs on one tap", () => {
    expect(handler).toContain('action === "reveal"');
    expect(handler).not.toContain('action === "advance"');
    expect(handler).not.toContain('action === "standings"');
  });

  /**
   * **The clock is asked, never recomputed.** The deadline arithmetic exists once, in the
   * countdown the panel already drives; a second copy here would be free to disagree with
   * the number on the projector about whether time is up.
   */
  it("reads the running clock rather than recomputing the deadline", () => {
    expect(needs).toContain("countdown.isRunning()");
    expect(needs).not.toContain("timeLimitSeconds");
    expect(needs).not.toContain("updatedAt");
  });

  /**
   * **No phase test beside the button.** `CONTROL_RULES` offers `reveal` in exactly one
   * phase, and the clock is armed in that phase and no other — a condition here would be the
   * second phase rule the table exists to prevent.
   */
  it("states no phase rule of its own", () => {
    expect(needs).not.toContain("phase");
    expect(handler).not.toContain("phase");
  });

  /**
   * **A room that has finished answering waives it**, so the confirmation is not something
   * the host meets on all fourteen questions. A stale count does not waive it: `answeredStale`
   * means the figure describes some earlier moment, and dropping the guard on it would drop it
   * exactly when the page is least able to justify doing so.
   */
  it("waives the confirmation only on a fresh count that covers the room", () => {
    const everyone =
      /function everyoneAnswered[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(everyone.length).toBeGreaterThan(0);
    expect(everyone).toContain("!answeredStale");
    expect(everyone).toContain("answered >= total");
    // An empty room is not a full house — `0 >= 0` would read as one.
    expect(everyone).toContain("total > 0");
    expect(needs).toContain("everyoneAnswered(state)");
  });

  /**
   * **An arm does not survive the session moving under it**, and it does not survive the
   * button going out of reach — `syncEndButton`'s two rules, applied to the other one-way
   * verb so the bar has one confirmation idiom rather than two.
   */
  it("disarms when the session moves or the button goes dark", () => {
    expect(sync).toContain("state?.version !== revealArmedVersion");
    expect(sync).toContain("if (!allowed && revealArmed) disarmReveal()");
  });

  /**
   * **Disarmed before the request, not after it.** A reveal that failed has already outlived
   * the state the host confirmed against, so it has to be meant a second time.
   */
  it("disarms ahead of the request", () => {
    expect(handler).toContain("disarmReveal();");
    expect(handler.indexOf("disarmReveal();")).toBeLessThan(
      handler.indexOf("void fire(action)"),
    );
  });

  /**
   * **One place clears the arming**, so the label, the version and the flag cannot be reset
   * in three different combinations.
   */
  it("clears the arming from one function", () => {
    expect(occurrences("revealArmedVersion = null")).toBe(1);
    // Two: the declaration's initial value, and `disarmReveal`. A third would be a second
    // reset — the shape that leaves the flag cleared while the version still holds an arm.
    expect(occurrences("revealArmed = false")).toBe(2);
    expect(CODE).toContain("function disarmReveal()");
  });

  /**
   * **It adds no timer.** An arming that expired on its own would be a second clock on this
   * page, and this file's central guard is that exactly one timer here can reach a `fetch`.
   * The arm is cleared by the session moving, not by waiting.
   */
  it("arms without a clock of its own", () => {
    expect(needs).not.toContain("setTimeout");
    expect(handler).not.toContain("setTimeout");
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
  const handler =
    /endButton\.addEventListener\([\s\S]*?\n {6}\}\);/.exec(CODE)?.[0] ?? "";
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
    expect(handler.indexOf("if (!endArmed)")).toBeLessThan(
      handler.indexOf('fire("end"'),
    );
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
    const fireBody =
      /async function fire\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(fireBody.length).toBeGreaterThan(0);
    expect(fireBody).toContain("syncEndButton()");
  });

  /**
   * **ONE BUTTON, MOVED — never one per place.**
   *
   * The closing verb now has two homes: `#host-menu` for most of the session, `#end-slot-bar`
   * on the last question. The cheap way to build that is a second copy hidden in the other
   * place, and it is wrong in a way nothing on screen would show: the arming label, the phase
   * rule and the two-tap confirmation would each have two writers, and the copy that fell
   * behind is the one that fires unarmed or fires in a phase `end` refuses.
   *
   * The markup is what this can see, so the markup is what it pins. `id="end-slot-bar"` and
   * `id="end-slot-menu"` do not match `id="end"` — the closing quote is the difference.
   */
  it("authors exactly one closing button, in the menu", () => {
    expect(occurrences('id="end"')).toBe(1);
    expect(CODE).toContain('id="end-slot-menu"');
    expect(CODE).toContain('id="end-slot-bar"');

    // Authored inside the menu's slot: the bar's slot is the empty one, and the script is
    // what fills it. Source order is the only reading a scan has of "which slot holds it".
    expect(CODE.indexOf('id="end-slot-menu"')).toBeLessThan(
      CODE.indexOf('id="end"'),
    );
    expect(CODE).toContain('<div id="end-slot-bar" class="contents"></div>');
  });

  /**
   * **`syncEndButton` is the only mover**, for the reason it is the only writer of the phase
   * rule: where a one-way control is and whether it works are one statement about one button.
   * A second `append(endButton)` — from `render`, from `applyShell`, from a menu handler — is
   * how it ends up on the bar in a beat nobody meant to offer it in.
   */
  it("moves the button from exactly one place", () => {
    expect(occurrences("append(endButton)")).toBe(1);
    expect(sync).toContain("home.append(endButton)");
    // Idempotent: a render that changes nothing must not reparent the element the host may be
    // mid-tap on.
    expect(sync).toContain("endButton.parentElement !== home");
  });

  /**
   * **The placement reads `atLastQuestion` and the phase, and nothing else.**
   *
   * `last` is the same reading the next-step ring uses, so the ring can only ever light on the
   * bar. The `ended` exclusion is part of the rule rather than a tidy-up: after the close the
   * bar carries a sentence, and a dead red pill beside it is the "nothing works" row that
   * sentence exists to replace.
   *
   * And never `hidden`: the button has to be somewhere while it is away from the bar, so a
   * hidden button on the bar is a button in no place at all.
   */
  it("places the button on the last question only, and never by hiding it", () => {
    expect(sync).toContain("const last = atLastQuestion(state)");
    expect(sync).toContain(
      'const home = last && phase !== "ended" ? endSlotBar : endSlotMenu',
    );
    expect(CODE).not.toContain("setHidden(endButton");
    expect(CODE).not.toContain("endButton.hidden");
  });

  /**
   * **THE ROW GOES WITH THE BUTTON**, and from the same reading that placed it.
   *
   * `#end-row` held itself open with a `min-h` so the bar's height never moved, which bought a
   * constant bar at the price of a band of empty asphalt above the flow verbs for thirteen
   * questions out of fourteen — read, correctly, as the docked message row that is now a
   * floating toast. Reserved emptiness is on screen all session; the bar growing once at the
   * close is on screen for a moment.
   *
   * The property that matters is the same one the rail has: **one writer, derived from what the
   * region contains** rather than from a phase list that can fall behind. A second
   * `setHidden(endRow` — from `render`, from `applyShell` — is how the row and the button it
   * exists for come apart.
   */
  it("shows the bar's row exactly when the button is in it", () => {
    expect(occurrences("setHidden(endRow")).toBe(1);
    expect(sync).toContain("setHidden(endRow, home !== endSlotBar)");

    // Hidden in the markup too, not only by script: the row paints before the first snapshot
    // arrives, and an empty band on first paint is the thing this removes.
    expect(CODE).toContain('id="end-row"');
    expect(/id="end-row"[\s\S]{0,40}hidden/.test(CODE)).toBe(true);

    // …and never by holding a height open instead. `min-h` on this row is the state it was in.
    const row = /id="end-row"[\s\S]*?>/.exec(CODE)?.[0] ?? "";
    expect(row.length).toBeGreaterThan(0);
    expect(row).not.toContain("min-h");
  });

  /**
   * **The menu is a route to the button, not a bypass of its phase rule.** A host who has to
   * abandon a session mid-quiz can reach the verb; what they meet in a phase `end` would refuse
   * is the same disabled pill they would have met on the bar. Opening the menu must not touch
   * `disabled`.
   */
  it("does not let the menu re-enable what the phase rule refused", () => {
    const opener =
      /function openHostMenu\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(opener.length).toBeGreaterThan(0);
    expect(opener).not.toContain("endButton");
    expect(occurrences("endButton.disabled =")).toBe(1);
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
    expect(CODE).toContain(
      "if (state.currentQuestionId !== panelQuestionId) resetPanels(",
    );
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

/**
 * THE TOAST'S RULES.
 *
 * The bubble was persistent and is now transient, which moves one thing out of this page and
 * pins two things in it. The state machine went to `src/lib/client/toast.ts`, where it can be
 * driven by fake timers — here, where the scan cannot execute anything, what is protectable is
 * that this page did not grow its own copy.
 */
describe("the message toast dismisses itself from one place", () => {
  /**
   * **No inline dismissal timer.** The one-loop guards above already pin this file to a single
   * timer handle and a single `clearTimeout`, both the poll's — so a hide written inline would
   * fail them, and the tempting fix would be to weaken the count. The clock belongs to the
   * module, and this asserts the page reaches for it.
   */
  it("arms the hide through the tested module", () => {
    expect(CODE).toContain('from "../../lib/client/toast"');
    expect(CODE).toContain("createAutoHide(");
    expect(CODE).toContain("messageHide.show(MESSAGE_HIDE_MS[register])");
  });

  /**
   * **`say` stays the bubble's only writer, hide included.** The hide reaches the element
   * through the callback `say`'s clock was built with; a second `setHidden(messageBubble` — a
   * teardown handler blanking it directly, say — is a second writer, and the two would drift
   * on which registers survive what.
   */
  it("keeps every write to the bubble inside say", () => {
    const say = /function say\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: the body must actually have been found.
    expect(say).toContain("EDGE_COLOURS[register]");

    // Two inside `say` (the reveal and the empty-text hide), one in the hide callback.
    expect(occurrences("setHidden(messageBubble")).toBe(3);
    expect(say.split("setHidden(messageBubble").length - 1).toBe(2);
  });

  /**
   * **The register's colour is swapped, not rebuilt.** It rides the bubble's own left border
   * now, and the bubble carries its layout in the markup — so a `className =` here would be a
   * second copy of that layout, kept in step by hand. `classList` has nothing to drift.
   */
  it("swaps the edge colour without rewriting the bubble's classes", () => {
    const say = /function say\([\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(say).toContain(
      "messageBubble.classList.remove(...Object.values(EDGE_COLOURS))",
    );
    expect(say).toContain(
      "messageBubble.classList.add(EDGE_COLOURS[register])",
    );
    expect(CODE).not.toContain("messageBubble.className");
  });

  /**
   * All four registers expire — the decision the user took over step 5's persistent bubble.
   * A register missing from the table is a message that would fall back to the default and
   * quietly get the wrong patience, so the table is asserted whole.
   */
  it("gives every register a duration", () => {
    const table = /const MESSAGE_HIDE_MS[\s\S]*?\n {6}};/.exec(CODE)?.[0] ?? "";

    expect(table).toContain("ok:");
    expect(table).toContain("pending:");
    expect(table).toContain("attention:");
    expect(table).toContain("refused:");
  });
});

/**
 * The host secret is typed off the projector, behind the join QR.
 *
 * The field is unchanged — same id, same `sessionStorage` key, same `input` handler. What
 * moved is where it sits, and the two things that keeps working are worth pinning: the field
 * must actually be inside the dialog (a stray copy left on the control bar puts a password box
 * back in front of the room), and every route that needs it must go through the one opener (a
 * `focus()` on a field inside a closed `<dialog>` is a no-op, which is a 401 the host cannot
 * act on and nothing on screen to say why).
 */
describe("the host secret is typed behind the menu", () => {
  const menu = /<dialog[\s\S]*?<\/dialog>/.exec(CODE)?.[0] ?? "";

  it("finds the dialog it is checking", () => {
    expect(menu).toContain('id="host-menu"');
  });

  it("keeps the secret field inside it, and nowhere else", () => {
    expect(menu).toContain('id="secret"');
    expect(occurrences('id="secret"')).toBe(1);
  });

  /**
   * The session version is a debugging figure the room cannot act on, so it is behind the menu
   * too. Nothing depends on the element: the closing confirmation reads `state.version` in the
   * script, which is what makes moving the display a presentation change and not a change to
   * what `end` is armed at — asserted here so a later "the version should be visible again"
   * cannot quietly become "the version should be *read from the DOM* again".
   */
  it("keeps the session version inside it, with no reader outside the script", () => {
    expect(menu).toContain('id="version"');
    expect(occurrences('id="version"')).toBe(1);
    expect(CODE).toContain("endArmedVersion ?? state.version");
    expect(CODE).not.toContain('el("version").textContent');
  });

  /**
   * `odśwież` is in the menu beside the version it refreshes. Unlike the closing button it has
   * no slot and no second home — it is a fallback for a count that S-11 taught to climb on its
   * own, so there is no beat that wants it back on the bar. What matters is that it is authored
   * once: two `odśwież` buttons would be two things to disable for the length of a request, and
   * `allButtons` holds one named reference.
   */
  it("keeps the refresh button inside it, authored once", () => {
    expect(menu).toContain('id="refresh"');
    expect(occurrences('id="refresh"')).toBe(1);
    expect(CODE).toContain("[...actionButtons(), refresh, endButton]");
  });

  /**
   * Every button in the menu says what pressing it does. These are the controls the host has
   * built no habit around — opened twice a session, one of them irreversible — so the sentence
   * is part of the control, not decoration. Counted rather than read: what a scan can protect
   * is that a button added later does not arrive bare.
   */
  it("gives every button in it a description", () => {
    const buttons = menu.match(/<button\b/g) ?? [];
    const notes = menu.match(/text-\[22px\]/g) ?? [];

    expect(buttons).toHaveLength(3);
    expect(notes).toHaveLength(buttons.length);
  });

  /**
   * The closing button's sentence hides when the button leaves for the bar, decided by the
   * statement that decided the move — a second reading of `home` is how an explanation ends up
   * on screen with no control under it, or a control on the bar with its explanation stranded.
   */
  it("hides the closing sentence from the move that took its button away", () => {
    const sync =
      /function syncEndButton\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    // Non-vacuity: the body must actually have been found.
    expect(sync).toContain("home.append(endButton)");

    expect(sync).toContain("setHidden(endNote, home !== endSlotMenu)");
    expect(occurrences("setHidden(endNote")).toBe(1);
  });

  it("opens the menu from exactly one place", () => {
    expect(occurrences(".showModal()")).toBe(1);
    expect(CODE).toContain("function openHostMenu()");
  });

  /**
   * Focusing the field is what `openHostMenu` exists to do *after* opening, so a `focus()`
   * anywhere else is a caller that skipped the open — the 401 branch being the one that used
   * to do exactly that, back when the field was on the bar.
   */
  it("reaches the field's focus only through the opener", () => {
    const opener =
      /function openHostMenu\(\)[\s\S]*?\n {6}}/.exec(CODE)?.[0] ?? "";

    expect(opener).toContain("secretField.focus()");
    expect(occurrences("secretField.focus()")).toBe(1);
    expect(occurrences("secretField.select()")).toBe(1);
  });

  /**
   * The QR is the only visible way in, so it must not be swept up by anything that drives the
   * flow verbs: no `data-action` (the blanket click handler), and not in `allButtons` (which
   * disables its members for the length of every request).
   */
  it("leaves the QR button out of the action machinery", () => {
    // Anchored on the id rather than on the first `<button` in the file, so the match cannot
    // start at some earlier button and swallow the markup in between.
    const opener =
      /<button\s+id="host-menu-open"[\s\S]*?>/.exec(CODE)?.[0] ?? "";

    expect(opener).toContain('aria-label="Menu prowadzącego"');
    expect(opener).toContain('type="button"');
    expect(opener).not.toContain("data-action");
    expect(CODE).toContain("[...actionButtons(), refresh, endButton]");
  });
});

/**
 * The connection report is a lamp with the sentence one hover away.
 *
 * What is protectable by a scan is that the lamp cannot go stale or ambiguous: every status
 * has a colour, the swap does not rebuild the element's layout, and the tooltip stays CSS-only
 * — a listener here would be a second thing on this page reacting to pointer state, and a
 * timer here would be a third clock in a file whose whole guard set is about having one.
 */
describe("the connection status is a lamp, not a sentence", () => {
  const table =
    /const CONNECTION_COLOURS[\s\S]*?\n {6}};/.exec(CODE)?.[0] ?? "";

  /**
   * Every `ConnectionStatus` in `session.ts`. A missing row is a lamp holding the previous
   * status's colour — the one failure mode a colour-only report cannot survive, because there
   * are no words on screen to contradict it.
   */
  it("answers every connection status", () => {
    expect(table).toContain("Record<ConnectionStatus, string>");
    expect(table).toContain("connecting:");
    expect(table).toContain("connected:");
    expect(table).toContain("degraded:");
    expect(table).toContain("lost:");
  });

  /**
   * The unlit class the markup opens with is not in the table, so it has to be named in the
   * removal — two `bg-` utilities on one element resolve by stylesheet order, which is not a
   * thing this page gets to decide.
   */
  it("clears the unlit colour along with the lit ones", () => {
    const remove =
      /connection-dot"\)\.classList\.remove\([\s\S]*?\)/.exec(CODE)?.[0] ?? "";

    expect(remove).toContain("CONNECTION_UNLIT");
  });

  /**
   * Same rule as the toast's marker: the lamp's size, shape and focus ring live in the markup,
   * so a `className =` here would be a hand-maintained second copy of them.
   */
  it("swaps the colour without rewriting the lamp's classes", () => {
    expect(CODE).toContain(
      'el("connection-dot").classList.add(CONNECTION_COLOURS[status])',
    );
    expect(CODE).not.toContain('connection-dot").className');
    expect(CODE).not.toContain('el("connection").className');
  });

  /**
   * The tooltip is `group-hover` / `group-focus-within` in the markup and nothing else. A
   * `mouseenter` handler would put pointer state into a script whose only other state machine
   * is the poll, and the reveal has to work with no JS having run at all.
   */
  it("reveals the tooltip from CSS rather than from a listener", () => {
    expect(CODE).toContain("group-hover:opacity-100");
    expect(CODE).toContain("group-focus-within:opacity-100");
    expect(CODE).not.toContain("mouseenter");
    expect(CODE).not.toContain("mouseover");
  });

  /**
   * The lamp sits in the shell's bottom-right corner, so the bubble has to open leftwards and
   * upwards. Anchored `left-0` it would grow off the right edge of a page that is `h-dvh` with
   * `overflow-hidden` and therefore cannot be scrolled to reach it — the sentence would be
   * unreadable exactly when it is worth reading.
   */
  it("opens the tooltip away from the edges it is parked against", () => {
    const tooltip = /<p\n\s+id="connection"[\s\S]*?>/.exec(SOURCE)?.[0] ?? "";

    expect(tooltip).toContain("absolute");
    expect(tooltip).toContain("bottom-full");
    expect(tooltip).toContain("right-0");
  });

  /**
   * `opacity`, not `hidden`: `role="status"` on a `display: none` element announces nothing,
   * and the sentence is the only form of this report available to a host who cannot use the
   * colour. `setHidden(` on it would also make it a second writer to an element `onConnection`
   * already owns.
   */
  it("keeps the sentence in the accessibility tree while it is invisible", () => {
    expect(CODE).toContain('id="connection"');
    expect(CODE).toContain('aria-live="polite"');
    expect(CODE).not.toContain('setHidden(el("connection")');
  });
});

/**
 * The chip on the control bar names the question's kind while a question is open.
 *
 * `pytanie otwarte` is the right phase word and reads as the wrong thing: on a multiple-choice
 * question a host glancing at the bar takes it for "this is an open-ended question". So the one
 * ambiguous phase names the kind instead. What a scan can hold is that the table stays a table —
 * a lookup, not a sixth place deciding something about kinds — and that the four other phases
 * keep their phase word.
 */
describe("the phase chip names the kind while a question is open", () => {
  const kinds = /const KIND_LABELS[\s\S]*?\n {6}};/.exec(CODE)?.[0] ?? "";
  const phases = /const PHASE_LABELS[\s\S]*?\n {6}};/.exec(CODE)?.[0] ?? "";

  /**
   * Every kind answered, typed off `PublicQuestion` so a sixth one is a build failure rather
   * than a chip that silently falls back to the phase word.
   */
  it("answers every question kind", () => {
    expect(kinds).toContain('Record<PublicQuestion["kind"], string>');
    expect(kinds).toContain('"single-choice":');
    expect(kinds).toContain('"multiple-choice":');
    expect(kinds).toContain("text:");
    expect(kinds).toContain("number:");
    expect(kinds).toContain('"word-cloud":');
  });

  /**
   * A table spells nouns; it decides nothing. That is what keeps it clear of the rule
   * `pollTargetFor` owns — the guard above fails a second `kind === …` predicate, and this
   * asserts the chip did not become one.
   */
  it("reads the label from the table rather than testing kinds", () => {
    expect(CODE).toContain("KIND_LABELS[question.kind]");
    expect(occurrences("KIND_LABELS[")).toBe(1);
  });

  /**
   * Only `question-open` swaps. `question-revealed` is about the beat rather than the kind, and
   * the other three have no question to name — a chip reading `wielokrotny wybór` over a
   * leaderboard would be naming a question the room has stopped looking at.
   */
  it("swaps in exactly one phase, and writes the chip from one place", () => {
    expect(CODE).toContain('state.phase === "question-open" && question');
    expect(occurrences('setText(\n          "phase"')).toBe(1);
    expect(occurrences('setText("phase"')).toBe(1); // the sessionless "brak sesji" branch
    expect(phases).toContain('"question-revealed": "odpowiedź ujawniona"');
  });
});
