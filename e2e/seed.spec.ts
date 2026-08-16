import { expect, test } from "@playwright/test";

import {
  authenticateHostWithoutUI,
  hostSecret,
  purgeSession,
  readSessionState,
} from "./support/host-session";

/**
 * SEED — the exemplar every generated E2E spec in this project is modelled on.
 *
 * Risk:  `context/foundation/test-plan.md` §2 Risk #1 — "the host panel offers a flow
 *        verb the current phase refuses, or withholds the one it accepts — the host
 *        presses a dead button in front of a live room."
 * Half:  the **rendered** half. §7 records it as covered by nothing: `host.test.ts`
 *        scans the page's source text, so it certifies that `CONTROL_RULES` is
 *        *written*, never that the browser ends up with the right button enabled.
 * Rules: `e2e/E2E-RULES.md`. Anything this file demonstrates, generated specs inherit.
 *
 * Four patterns to copy, in the order they appear below:
 *   1. role-based locators — `getByRole('button', { name: 'start' })`, never a class,
 *      an id or `[data-action]`. The panel's `data-action` attributes are how the app
 *      wires its handler; asserting on them would test the wiring, not the host's view.
 *   2. one full cycle in one test — setup, action, assertion, cleanup. Nothing here
 *      depends on another spec having run, so any order is safe. Not any *concurrency*:
 *      one store holds one session, so the suite runs serially — see the config.
 *   3. wait for state, never for time — every assertion below is web-first and
 *      auto-retries. There is no `waitForTimeout` in this file and none belongs in one
 *      modelled on it.
 *   4. a name that binds the test to the risk — read the title and you know which
 *      failure scenario goes uncaught if this file is deleted.
 *
 * Unique test data (rules §4) has no user-authored value to attach to on this flow —
 * the host names nothing. Where a flow *does* carry one (an attendee display name),
 * suffix it with `Date.now()`; do not read its absence here as permission to collide.
 *
 * Store hazard, stated once: these specs drive the real Upstash namespace from `.env`.
 * The precondition below refuses to run against a session that is already live, and
 * `afterEach` purges what the test created. Keep both in anything modelled on this.
 */

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
});

test.afterEach(async ({ request, baseURL }) => {
  if (hostSecret === "") return;
  await purgeSession(request, hostSecret, baseURL ?? "");
});

test("host panel offers only 'start' before a session, and only 'dalej' once the lobby opens", async ({
  page,
  request,
}) => {
  // Setup — authenticate out of band, never through `#host-menu`.
  await authenticateHostWithoutUI(page, hostSecret);
  await page.goto("/quiz/host");

  const start = page.getByRole("button", { name: "start", exact: true });
  const advance = page.getByRole("button", { name: "dalej", exact: true });
  const reveal = page.getByRole("button", { name: "pokaż odpowiedź" });
  const standings = page.getByRole("button", { name: "pokaż ranking" });

  // With no session the panel must offer exactly one step, and refuse the other three.
  await expect(start).toBeEnabled();
  await expect(advance).toBeDisabled();
  await expect(reveal).toBeDisabled();
  await expect(standings).toBeDisabled();

  // Action — the one verb the phase accepts. `start` opens the lobby, not question 1.
  await start.click();

  // Assertion — the business outcome the host sees: the offered step moved with the
  // phase. Waiting on the *panel*, not on the request: what the risk is about is what
  // ends up enabled on screen, and a 200 that never reaches the DOM is the failure.
  await expect(advance).toBeEnabled();
  await expect(start).toBeDisabled();
  await expect(reveal).toBeDisabled();
  await expect(standings).toBeDisabled();

  // A disabled verb explains itself rather than sitting dark and mute — the panel is
  // the interaction, the route's 409 is only the backstop.
  await expect(start).toHaveAttribute("title", "Sesja już trwa.");

  // The store agrees with the screen. Cleanup runs in `afterEach`, unconditionally,
  // so a failure above still leaves the namespace empty for the next test.
  const { state } = await readSessionState(request);
  expect(state?.phase).toBe("lobby");
});
