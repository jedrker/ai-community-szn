import { expect, test } from "@playwright/test";

import {
  ATTENDEE_PATH,
  authenticateHostWithoutUI,
  HOST_PANEL_PATH,
  hostSecret,
  purgeSession,
  readSessionState,
  waitForHostPanelReady,
} from "./support/host-session";

/**
 * Risk: `context/foundation/test-plan.md` §2 Risk #1, rendered half — plus the
 *       multiple-quizzes plan's Testing Strategy, which named this spec explicitly:
 *       "open a host panel by slug, start, join from `/quiz/<slug>`, and confirm the verb
 *       the phase allows".
 *
 * What it covers that `seed.spec.ts` does not: the **slug-bearing addresses working together**.
 * The seed proves the panel's verbs move with the phase; it never leaves the panel, so nothing
 * in the suite showed that the address the projector's QR encodes actually admits an attendee
 * into the session that panel started. Those are two different routes resolving the same quiz
 * out of the registry, and either could 404 on its own.
 *
 * It asserts the business outcome on both sides — the phone is in the game, and the panel's
 * next step has moved — never that a request returned 200.
 */

/** See `seed.spec.ts` for why the teardown is gated rather than unconditional. */
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
  if (!clearedToCreate) return;
  clearedToCreate = false;

  await purgeSession(request, hostSecret, baseURL ?? "");
});

test("a phone joins through the quiz's own address into the session that panel started", async ({
  page,
  context,
  request,
}) => {
  // Setup — the host opens this quiz's panel and starts it. Authenticated out of band.
  await authenticateHostWithoutUI(page, hostSecret);
  await page.goto(HOST_PANEL_PATH);
  // The verbs are enabled in the server-rendered markup, so a click before the inline
  // script attaches is silently lost. See `waitForHostPanelReady`.
  await waitForHostPanelReady(page);

  const start = page.getByRole("button", { name: "start", exact: true });
  const advance = page.getByRole("button", { name: "dalej", exact: true });

  await expect(start).toBeEnabled();
  await start.click();
  // Wait on the panel, not the request: the lobby being open is what the attendee needs.
  await expect(advance).toBeEnabled();

  // Action — a separate device opens the slug-bearing attendee address and claims a name.
  // A unique name per run, because `livequiz:players` is keyed by the folded name and a
  // collision is a refused claim rather than a fresh one.
  const phone = await context.newPage();
  await phone.goto(ATTENDEE_PATH);

  const displayName = `Gość ${Date.now()}`;
  await phone.getByRole("textbox").first().fill(displayName);
  await phone.getByRole("button", { name: /doł/i }).click();

  // Assertion — the phone is in the lobby of the running session, which is the outcome the
  // whole address change exists to preserve.
  await expect(phone.getByText(/Jesteś w grze/)).toBeVisible();

  // And the store agrees the join landed in this session rather than anywhere else.
  await expect
    .poll(async () => (await readSessionState(request)).playerCount)
    .toBe(1);

  await phone.close();
});
