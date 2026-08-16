import { expect, test } from "@playwright/test";

import {
  authenticateHostWithoutUI,
  hostSecret,
  purgeSession,
  readSessionState,
} from "./support/host-session";

/**
 * Risk:  `context/foundation/test-plan.md` §2 Risk #1 — "the host panel offers a flow
 *        verb the current phase refuses, or withholds the one it accepts — the host
 *        presses a dead button in front of a live room."
 * Half:  the **rendered** half, in the phase the seed stops short of. §7 records it as
 *        covered by nothing: `host.test.ts` scans the page's source text, so it certifies
 *        that `CONTROL_RULES["question-open"]` is *written* with `allow: ["advance",
 *        "reveal"]`, never that the browser ends up with those two live and the other two
 *        dark. The Response Guidance for this risk asks for a one-way implication — no
 *        offered verb the route would refuse — which is what the four assertions below say
 *        for this phase.
 * Naming: the committed quiz opens on a word cloud, so the reveal verb here is named
 *        `zamknij pytanie` rather than `pokaż odpowiedź`. That is not cosmetic and not a
 *        second phase rule: the tap closes submissions and has no answer to show, and the
 *        name is keyed on `pollTargetFor`, the page's single question-kind predicate. A
 *        panel that offers `pokaż odpowiedź` over a cloud puts a verb on the projector
 *        that lies about what it does — so the label is asserted in both directions.
 * Rules: `e2e/E2E-RULES.md`; modelled on `e2e/seed.spec.ts`.
 *
 * The phase is reached by driving the panel — `start`, then `dalej` — rather than by
 * posting to the API. The risk is about what the panel renders *after a real transition*,
 * and a faked phase would assert the renderer against a state the host never produced.
 *
 * Store hazard: this spec drives the real Upstash namespace from `.env`. The precondition
 * refuses to run against a live session, and `afterEach` purges only what the precondition
 * cleared this spec to create — see `clearedToCreate` below.
 */

/**
 * **Whether the precondition cleared this spec to create a session**, and therefore whether
 * the teardown owns anything to clean up.
 *
 * **Playwright runs `afterEach` even when `beforeEach` fails.** So a teardown guarded only on
 * the secret's presence runs *after the precondition refused to touch a live room* — and
 * `purgeSession` reads the live version and posts it with the real host secret, so the purge
 * succeeds. The guard written to protect a running session was the thing that deleted it,
 * along with its players, tallies and standings.
 *
 * Set after the precondition passes, so it means "there was no session and this spec was
 * cleared to make one" — never "this spec ran".
 */
let clearedToCreate = false;

test.beforeEach(async ({ request }) => {
  test.skip(
    hostSecret === "",
    "LIVEQUIZ_HOST_SECRET is absent — run with `bun run e2e` so .env is loaded.",
  );

  const { state } = await readSessionState(request);
  expect(
    state,
    "a session is already running — refusing to drive a live room",
  ).toBeNull();

  clearedToCreate = true;
});

test.afterEach(async ({ request, baseURL }) => {
  // Purge only what this spec was cleared to create. See `clearedToCreate`.
  if (!clearedToCreate) return;
  clearedToCreate = false;

  await purgeSession(request, hostSecret, baseURL ?? "");
});

test("host panel offers 'dalej' and the closing verb while the first question is open, and withholds 'start' and 'pokaż ranking'", async ({
  page,
  request,
}) => {
  // Setup — authenticate out of band, never through `#host-menu`.
  await authenticateHostWithoutUI(page, hostSecret);
  await page.goto("/quiz/host");

  const start = page.getByRole("button", { name: "start", exact: true });
  const advance = page.getByRole("button", { name: "dalej", exact: true });
  const standings = page.getByRole("button", { name: "pokaż ranking" });
  const closeQuestion = page.getByRole("button", {
    name: "zamknij pytanie",
    exact: true,
  });
  const showAnswer = page.getByRole("button", {
    name: "pokaż odpowiedź",
    exact: true,
  });

  // Action — two real transitions. `start` opens the lobby; `dalej` opens question 1.
  await expect(start).toBeEnabled();
  await start.click();
  await expect(advance).toBeEnabled();
  await advance.click();

  // Assertion — what the host sees once question 1 is open. Waiting on the *panel*, not
  // on the request: what the risk is about is what ends up enabled on screen, and a 200
  // that never reaches the DOM is the failure.
  await expect(closeQuestion).toBeEnabled();
  await expect(advance).toBeEnabled();
  await expect(start).toBeDisabled();
  await expect(standings).toBeDisabled();

  // The reveal verb is *named* for what it does over a word cloud — there is no answer to
  // show, only submissions to close — and the verb it must not be called is absent.
  await expect(showAnswer).toHaveCount(0);

  // A withheld verb explains itself rather than sitting dark and mute — the panel is the
  // interaction, the route's 409 is only the backstop.
  await expect(start).toHaveAttribute("title", "Sesja już trwa.");
  await expect(standings).toHaveAttribute(
    "title",
    "Ranking można pokazać dopiero po ujawnieniu odpowiedzi.",
  );

  // The store agrees with the screen: the panel above is the one the real phase produced,
  // not one the page settled into on its own. Cleanup runs in `afterEach`,
  // unconditionally, so a failure above still leaves the namespace empty for the next test.
  const { state } = await readSessionState(request);
  expect(state?.phase).toBe("question-open");
});
