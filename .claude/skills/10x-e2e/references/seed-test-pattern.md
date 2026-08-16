# Seed Test Pattern

The seed test (`seed.spec.ts`) is the primary E2E quality lever. It is not an
empty ritual: it's the example every generated test is modeled on. If the seed
uses `getByRole`, generated tests do too. If the seed has
`page.waitForTimeout(2000)`, every generated test inherits that anti-pattern.
**What you show is what you get.**

## The four patterns a good seed demonstrates

- **Role-based locators.** `getByRole('button', { name: 'Add card' })` is robust
  against CSS class changes, DOM structure changes, and component refactors —
  and it matches exactly what the agent sees in accessibility snapshots.
  Playwright: "Prefer user-facing attributes to XPath or CSS selectors." A seed
  using `page.locator('.btn-primary')` teaches the agent to reproduce brittle
  selectors.
- **Test independence.** Agents happily generate tests where test B assumes test
  A created a deck. Playwright runs in parallel, in random order. "Each test
  should be completely isolated from another test and should run independently."
  The seed must show a full cycle — setup, action, assertion, cleanup — in one
  test.
- **Wait for state, not time.** "Never wait for timeout in production. Tests that
  wait for time are inherently flaky." Use `expect(locator).toBeVisible()`,
  `page.waitForURL()`, or `page.waitForResponse()` — a concrete application
  state instead of an arbitrary duration.
- **Risk-tied assertions.** The test name should bind it unambiguously to a risk
  from `context/foundation/test-plan.md`: `test('flashcard data persists after
  page reload', ...)`, not `test('test 1', ...)`.

## Exemplar

```typescript
// seed.spec.ts
import { test, expect } from '@playwright/test';

test('created deck persists after page reload', async ({ page }) => {
  const deckName = `Test Deck ${Date.now()}`;
  await page.goto('/');

  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByRole('textbox', { name: 'Deck name' }).fill(deckName);
  await page.getByRole('button', { name: 'Create' }).click();

  await expect(page.getByRole('heading', { name: deckName })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: deckName })).toBeVisible();

  // Cleanup
  await page.getByRole('button', { name: 'Delete deck' }).click();
  await page.getByRole('button', { name: 'Confirm' }).click();
});
```

Note `Date.now()` in the deck name — a unique identifier so parallel runs and
re-runs don't collide (see anti-pattern #5, "no cleanup", in
`e2e-anti-patterns.md`).

The seed test and the E2E rules are the two strongest quality levers in E2E.
Without them the agent produces tests that pass today but break on the first
refactor or block the parallel-run pipeline.
