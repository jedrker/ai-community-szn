# Five Agent E2E Anti-Patterns

Review every agent-generated E2E test against this checklist. Each anti-pattern
has the same root cause: the agent optimizes for "test passes now," not "test is
stable tomorrow." That is a fundamental trait of LLM code generation, not a flaw
of a specific tool.

## 1. Hallucinated assertion

Syntactically valid, semantically empty. The test creates a deck, adds a card,
reloads — and then asserts that the page title contains "Dashboard." It passes,
but it never checks that the card survived the reload. A false sense of safety.

**Control question:** would this assertion fail if the `test-plan.md` risk
materialized? If not, it's naive.

**Fix:** assert the actual business outcome (after reload, the deck heading and
card content are still visible).

## 2. Brittle selector

`page.locator('div.card-container > div:nth-child(3) > button')` instead of
`page.getByRole('button', { name: 'Delete' })`. The first breaks on any layout
change even when the user flow is unchanged.

**Fix:** `getByRole` / `getByLabel` / `getByText` — the same strategy the seed
test uses. The agent sees roles and names in accessibility snapshots, not CSS
classes.

## 3. Shared state between tests

Test "edit card" assumes test "add card" already ran. Playwright runs tests in
parallel, in random order → flaky. Passes once, then fails randomly.

**Fix:** each test does its own setup, action, assertion, and cleanup in one
self-contained block.

## 4. `waitForTimeout` instead of waiting for state

The agent doesn't know how long your backend takes, so it inserts
`await page.waitForTimeout(3000)`. Passes on your laptop, flakes in CI where the
server responds slower — a false failure unrelated to the risk.

**Fix:** `await page.waitForResponse('**/api/decks')` or
`await expect(element).toBeVisible()`. Web-first assertions auto-retry until the
condition is met.

## 5. No cleanup

The agent creates test data (deck, cards) but never tears it down. First run
works; second run hits a `unique constraint violation` because the record
already exists.

**Fix:** unique identifiers (e.g. timestamp suffix) plus cleanup per test /
`afterEach`. Or teardown-before-setup: each test first deletes data it may have
created in a previous run, guaranteeing a clean start even after a crash.

## Re-prompt discipline

Same discipline as for unit tests, lifted to E2E: **never say
"fix this test."** Name the specific anti-pattern, explain why it doesn't protect
the risk (or why it produces false failures), and give the target pattern. Three
elements per re-prompt: *what's wrong*, *why it doesn't protect the risk*, *what
replaces it*.

### Target-pattern re-prompt examples

Hallucinated assertion:

```text
The final assertion checks the page title instead of verifying that
flashcard data survived the reload. This test will pass even when
Risk #1 materializes (data loss after refresh) — the title stays
"Dashboard" regardless.

Replace it with assertions on the actual business outcome:
deck heading and card content must be visible after page.reload().
The test must fail if the data is lost.
```

Brittle selector:

```text
This test uses CSS selectors (page.locator('.btn-primary'),
page.locator('div.card-container > div:nth-child(3) > button')).
These break on any layout refactor without the risk actually
changing — producing false failures that erode trust in the suite.

Replace all locators with getByRole, getByLabel, or getByText —
the same locator strategy used in seed.spec.ts. The agent sees
roles and names in accessibility snapshots, not CSS classes.
```

Hardcoded wait:

```text
This test uses waitForTimeout(3000) after saving. It passes locally
where the backend responds in 200ms, but will flake in CI where
response times vary — a false failure unrelated to the risk.

Replace with waitForResponse('**/api/cards') or
expect(locator).toBeVisible(). Playwright's web-first assertions
auto-retry until the condition is met.
```
