# E2E Testing Rules

Read this **and** `e2e/seed.spec.ts` before writing or generating any browser-level
test in this project. The seed is the exemplar; this file is the constraint set. Rules
1–7 are the general block; §8 is what is specific to this repository.

## The rules

1. Use `getByRole`, `getByLabel`, `getByText` as primary locators. Fall back to
   `getByTestId` only when accessibility attributes are ambiguous.
2. Never use CSS selectors, XPath, or DOM structure for locating elements — and in this
   project, never `[data-action]` either: those attributes are how `host.astro` wires
   its blanket click handler, so asserting on them tests the wiring rather than what
   the host sees.
3. Each test must be independently runnable — no shared state between tests. Own
   setup, own action, own assertion, own cleanup, correct in any order.
   **Independent, but not concurrent**, and the distinction is this app's: there is one
   session in the `livequiz:` namespace, so two specs that start one are two hosts in
   the same room. `playwright.config.ts` runs serially for that reason and records the
   measurement. Write every spec as if it ran alone — never rely on a neighbour's
   session, and never lean on the serial setting to skip your own cleanup.
4. Use unique identifiers (a `Date.now()` suffix) for any test data the app stores under
   a user-authored name — attendee display names above all, since `livequiz:players` is
   keyed by the folded name and a collision is a refused claim, not a fresh one.
5. Authenticate out of band, never through the UI. The host secret goes into
   `sessionStorage` via `authenticateHostWithoutUI` (`e2e/support/host-session.ts`) —
   this project's `storageState`. A spec that types it into `#host-menu` depends on the
   dialog it is not testing.
6. Never use `page.waitForTimeout()`. Wait for a condition: `toBeVisible()`,
   `toBeEnabled()`, `waitForURL()`, `waitForResponse()`. This project's views settle on
   an Ably snapshot or a fetch, both of which web-first assertions already wait for.
7. Assert the business outcome, not the implementation. The control question for every
   assertion: *would this fail if the `test-plan.md` risk came true?* If not, it is
   decorative. Prove it by breaking the behaviour and watching this named test go red —
   test-plan §1's fourth rule applies to this layer too.

## 8. Project specifics

- **Scope.** This layer exists for the rendered half of §2 Risk #1 only — the half
  test-plan §7 records as uncovered because `host/[slug].test.ts` and `[slug].test.ts` scan
  source text. Everything else stays with Vitest. Do not add a spec per page; add one
  per named risk, and say which risk in the file header.
- **The store is real.** Specs drive the Upstash namespace from `.env`. Every spec that
  can create a session must (a) refuse to run when one is already live, and (b) purge in
  `afterEach` **only what its own precondition cleared it to create**. This rule used to end
  "`purgeSession` is a no-op when there is nothing to purge, so calling it unconditionally is
  correct" — which is true in the case that never happens and false in the one that matters.
  **Playwright runs `afterEach` even when `beforeEach` fails**, so an unconditional purge fires
  *after* the precondition has refused to touch a live room, reads that room's version, and
  deletes it with the real host secret. Gate the teardown on a flag set after the precondition
  passes; `seed.spec.ts`'s `clearedToCreate` is the pattern.
- **Real vs mocked.** Routing, the API routes, Redis and Ably stay real — that is where
  the integration risk this layer exists for actually lives. Mock only an expensive or
  non-deterministic *external* call, and mock it where the server makes it (Resend and
  Slack are server-side; `page.route()` will not see them).
- **No value imports from `src/`.** A spec is client-side code and follows
  `src/lib/client/boundary.test.ts`'s reasoning: `import type` is fine, a value import
  is not. Wire constants (header names, storage keys) are mirrored in
  `e2e/support/host-session.ts` and fail loudly when they drift.
- **`toBeEnabled()` on a host verb does NOT mean the panel is listening.** The flow verbs are
  rendered by the server with no `disabled` attribute, so a web-first assertion on their enabled
  state is satisfied by **static HTML** — before the inline script exists and before it has
  attached a listener. A click in that window is silently dropped and the spec fails five seconds
  later on a state that never changed, reading exactly like a broken app.

  Normally that window is microseconds. It becomes seconds whenever Vite re-optimizes the dep
  graph — a fresh clone, a `bun install`, a deleted `node_modules/.vite`, an added import, or an
  interleaved `bun run build` — because the panel's module import answers **504 Outdated Optimize
  Dep** once and retries. So the first spec to run against a fresh dev server is the one that
  loses, deterministically. Diagnosed during the multiple-quizzes impl review (F11), where it was
  mistaken for a regression twice and cost two false bisects; the tell is a `pageerror` reading
  "Failed to fetch dynamically imported module" with none of your assertions in the stack.

  **So call `waitForHostPanelReady(page)` after `goto` and before the first click.** It waits for
  the connection status the script writes over the server's `połączenie: —` — state, not a
  timeout. Verified by removing it and watching the first spec fail on a cold cache.
- **Run it.** `bun run e2e` (bun loads `.env`; `npx playwright test` does not, and the
  specs then skip themselves into a green run that tested nothing). Single spec:
  `bun run e2e e2e/seed.spec.ts`.
- **Not per edit, not pre-commit.** test-plan §5's local gates stay lint, format,
  scoped Vitest and typecheck. This layer starts a server and a browser; it belongs in
  CI (§3 Phase 4) or in a deliberate local run.
- **A failing spec is a debugging job.** Do not let an auto-heal tool rewrite an
  assertion. A drifted selector may be re-found through review; a changed business
  behaviour that "heals" is the regression this layer exists to catch.

## The five agent anti-patterns to review against

Every generated spec is reviewed against these before it is kept, and a finding is
re-prompted **by name** — never "fix this test":

1. **Hallucinated assertion** — asserts something the app never does, or something that
   holds regardless of the risk.
2. **Brittle selector** — CSS, XPath, `nth`, DOM structure, or an implementation
   attribute.
3. **Shared state** — depends on another test, on run order, or on residue.
4. **Wait-for-time** — `waitForTimeout`, arbitrary sleeps, retry loops around time.
5. **No cleanup** — leaves a session, a player or a key behind.

Full text: `.claude/skills/10x-e2e/references/e2e-anti-patterns.md`.
