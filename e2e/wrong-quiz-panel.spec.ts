import { expect, test } from "@playwright/test";

import {
  authenticateHostWithoutUI,
  HOST_PANEL_PATH,
  hostSecret,
  OTHER_QUIZ_SLUG,
  OTHER_QUIZ_TITLE,
  purgeSession,
  readSessionState,
  waitForHostPanelReady,
} from "./support/host-session";

/**
 * Risk: `context/foundation/test-plan.md` §2 Risk #1, rendered half — in the form the
 *       multiple-quizzes change created and impl-review F2 found: **a host panel that offers
 *       live flow verbs for a session belonging to a different quiz.**
 *
 * The panel had no mismatch handling at all. With quiz B running and a host on quiz A's panel,
 * `advance` and `reveal` were enabled — `reveal` even ringed as the next step — and pressing
 * one applied to quiz B's live session from a screen showing none of it, while the projector
 * read "Za chwilę pojawi się kolejne pytanie." to a room that would never get one.
 *
 * This is the spec that would have caught it. It needs **two committed quizzes**, which is why
 * it did not exist until F10 shipped the second one.
 *
 * Locators are role-based throughout, per `E2E-RULES.md` rule 2 — never `[data-action]`, which
 * is how the panel wires its blanket click handler rather than anything the host sees.
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

test("a panel whose quiz is not the running one offers no verb, and says which quiz is", async ({
  page,
  request,
  baseURL,
}) => {
  // Setup — quiz B is running. Started out of band so this spec is about the *other* panel.
  const started = await request.post("/api/quiz/host/start", {
    headers: { "x-livequiz-host-secret": hostSecret, Origin: baseURL ?? "" },
    form: { quizId: OTHER_QUIZ_SLUG },
  });
  expect(started.ok()).toBe(true);
  await expect
    .poll(async () => (await readSessionState(request)).state?.phase)
    .toBe("lobby");

  // Action — the host opens quiz A's panel instead.
  await authenticateHostWithoutUI(page, hostSecret);
  await page.goto(HOST_PANEL_PATH);
  await waitForHostPanelReady(page);

  // Assertion — the stage says which quiz is running, and does NOT promise a question.
  await expect(page.getByText("Ta sesja prowadzi inny quiz.")).toBeVisible();
  await expect(
    page.getByText("Za chwilę pojawi się kolejne pytanie."),
  ).toHaveCount(0);

  // The way out points at the other quiz's *panel*, not at the phone view.
  await expect(
    page.getByRole("link", { name: new RegExp(OTHER_QUIZ_TITLE) }),
  ).toHaveAttribute("href", `/quiz/host/${OTHER_QUIZ_SLUG}`);

  // THE ONE THAT MATTERS: no flow verb is live, so this panel cannot move quiz B's session.
  // `start` included — the route would answer its own 409, and the panel pre-empts it.
  for (const name of ["start", "dalej", "pokaż ranking"]) {
    const verb = page.getByRole("button", { name, exact: true });
    await expect(
      verb,
      `${name} must be dark on a wrong-quiz panel`,
    ).toBeDisabled();
    await expect(verb).toHaveAttribute("title", /inny quiz/);
  }

  // And the store is untouched by the visit.
  await expect
    .poll(async () => (await readSessionState(request)).state?.phase)
    .toBe("lobby");
});

test("the panel of the quiz that IS running is unaffected", async ({
  page,
  request,
  baseURL,
}) => {
  await request.post("/api/quiz/host/start", {
    headers: { "x-livequiz-host-secret": hostSecret, Origin: baseURL ?? "" },
    form: { quizId: OTHER_QUIZ_SLUG },
  });
  await expect
    .poll(async () => (await readSessionState(request)).state?.phase)
    .toBe("lobby");

  await authenticateHostWithoutUI(page, hostSecret);
  await page.goto(`/quiz/host/${OTHER_QUIZ_SLUG}`);
  await waitForHostPanelReady(page);

  // The near miss: without this, the assertions above are satisfied by a panel that shows the
  // mismatch screen for every session, running quiz included.
  await expect(page.getByText("Ta sesja prowadzi inny quiz.")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "dalej", exact: true }),
  ).toBeEnabled();
});
