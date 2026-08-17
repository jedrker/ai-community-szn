import { expect, test } from "@playwright/test";

import {
  ATTENDEE_PATH,
  hostSecret,
  QUIZ_CODE,
  SHORT_JOIN_PATH,
} from "./support/host-session";

/**
 * Risk: the multiple-quizzes plan's Testing Strategy — "E2E: `/q/<code>` lands on the quiz".
 *
 * The short address exists because `/quiz/<slug>` is fine to *scan* and miserable to *type* in
 * a dark room against FR-002's thirty-second join. Its whole value is that four digits read off
 * the projector reach the right quiz, and that is a **routing** fact: the code is resolved
 * through the registry on the server, so nothing in the Vitest suite can see it.
 *
 * **Creates no session**, so it needs neither the live-room precondition nor a purge: both
 * routes under test read only committed source. That is the reason this file looks unlike
 * `seed.spec.ts` — see `E2E-RULES.md` §8 on the store being real for the specs that do.
 */

test.beforeEach(() => {
  test.skip(
    hostSecret === "",
    "LIVEQUIZ_HOST_SECRET is absent — run with `bun run e2e` so .env is loaded.",
  );
});

test("typing the four-digit code lands on that quiz's attendee page", async ({
  page,
}) => {
  await page.goto(SHORT_JOIN_PATH);

  // The business outcome: one step, and it ends on the quiz — not on a chooser, not on a 404.
  await page.waitForURL(`**${ATTENDEE_PATH}`);
  // Proven by what the page *is*, not only by its address: the join form is what an attendee
  // arriving here needs to see.
  await expect(page.getByRole("button", { name: /doł/i })).toBeVisible();
});

test("an unknown code says so and offers a way on, rather than a blank 404", async ({
  page,
}) => {
  // A code that cannot be committed: the schema requires exactly four digits, so no quiz can
  // ever claim this one. Derived from the real code's shape rather than typed at random, so it
  // stays a near-miss if the committed code changes.
  const unknown = `${QUIZ_CODE}0`;

  await page.goto(`/q/${unknown}`);

  await expect(page.getByText(/Nie znamy tego kodu/)).toBeVisible();
  // The recovery path, which is the whole reason this is a page and not the framework's 404.
  await expect(
    page.getByRole("link", { name: /trwającego quizu/ }),
  ).toHaveAttribute("href", "/quiz");
});
