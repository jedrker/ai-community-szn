import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the browser-level layer (`/10x-e2e`).
 *
 * Scope, stated so it is not mistaken for a second test suite: this covers the
 * *rendered* half of test-plan §2 Risk #1 — the half §7 records as uncovered — and
 * nothing else. Unit and integration coverage stays with Vitest (`bun run test`);
 * see `context/foundation/test-plan.md` §3 for which layer owns which risk.
 *
 * **`.env` is loaded here, explicitly, and that is not redundant.** `bun run e2e`
 * spawns the Playwright CLI as a *node* child, and bun's `.env` values do not cross
 * that boundary — measured, not assumed: `bun -e` sees `LIVEQUIZ_HOST_SECRET`,
 * `node -e` under the same shell sees nothing. Without this call every spec skips
 * itself on the absent secret, which reads as a green run that tested nothing.
 *
 * `webServer` reuses an already-running `bun run dev` locally so an open dev server
 * is not fought over; in CI it always starts its own.
 */
try {
  // Node ≥20.12; the project's floor is 22.12. Absent `.env` is not an error here —
  // the specs report the missing secret themselves.
  process.loadEnvFile(".env");
} catch {
  // No .env on disk (CI supplies real environment variables instead).
}

const PORT = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  /**
   * **Serial, and this is not a performance setting — it is the app's shape.**
   *
   * There is exactly one session in the `livequiz:` namespace, so two host specs
   * running at once are two hosts driving the same room. Measured, not assumed: with
   * `fullyParallel` and two specs, three consecutive runs gave 1 failed / 1 failed /
   * 2 failed — one worker's `start` returning the *other* worker's session (create is
   * idempotent by design), and `purge` 409ing on a version that moved under it.
   *
   * Each spec is still written to be independently runnable — own precondition, own
   * cleanup, any order. What it cannot be is concurrent with another spec that starts
   * a session. Do not raise `workers` to "speed up CI"; make the store per-worker
   * first, or the failures come back as flake nobody can reproduce singly.
   */
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // One browser, deliberately. The risk is a phase-to-verb decision rendered into a
  // panel the host drives from one laptop — a second engine would multiply run time
  // without touching the failure scenario. Add one when a risk names it.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  use: {
    baseURL,
    /**
     * A failing E2E test is a debugging job; give it something to debug.
     *
     * **A trace records request headers, and these specs send `x-livequiz-host-secret` on
     * every host call.** Retries are on only in CI, so today the trace is written to a
     * gitignored `test-results/` on one developer's machine and goes no further. The moment
     * CI uploads it as a build artifact — the standard pattern, and what test-plan §3
     * Phase 4 is about — that artifact carries the production host write credential.
     *
     * Whoever wires CI owns this decision: scrub the header, restrict artifact visibility,
     * or turn tracing off there. It is recorded at the line rather than in a review file
     * because this is where somebody will be looking when they set `retries`.
     */
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `bun run dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
