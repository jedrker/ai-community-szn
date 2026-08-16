import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Session helpers shared by every host-side spec.
 *
 * These exist so a spec never drives setup or cleanup **through the UI**. Typing the
 * host secret into `#host-menu` would make every test depend on the dialog it is not
 * testing, and closing a session by clicking `zakończ sesję` would make cleanup
 * depend on the arming flow. Both go through the API instead — the E2E equivalent of
 * `storageState` (see `e2e/E2E-RULES.md` §5).
 *
 * Mirrors, not copies: the two string constants below are the wire contract of
 * `src/lib/session/host.ts` and `src/pages/quiz/host.astro`. They are spelled here
 * because a browser-level spec may not value-import from `src/lib/session/`
 * (`src/lib/client/boundary.test.ts`'s rule, and the same reasoning: a spec is
 * client-side code). If either drifts from the app, the seed spec fails on the next
 * run — loudly, not silently.
 */
const HOST_SECRET_HEADER = "x-livequiz-host-secret";
const SECRET_STORAGE_KEY = "quiz-host-secret";

/** `bun` loads `.env`; `npx` does not. See `playwright.config.ts`. */
export const hostSecret = process.env.LIVEQUIZ_HOST_SECRET ?? "";

export type SessionSnapshot = {
  state: { phase: string; version: number } | null;
  playerCount: number | null;
};

/** Reads the live session without touching the page under test. */
export async function readSessionState(
  request: APIRequestContext,
): Promise<SessionSnapshot> {
  const response = await request.get("/api/quiz/state");
  return (await response.json()) as SessionSnapshot;
}

/**
 * Puts the host secret where the page expects to find it, before the page's own
 * script runs. `sessionStorage`, not `localStorage` — that is where `host.astro`
 * keeps it, and the spec must not teach a storage the app does not use.
 */
export async function authenticateHostWithoutUI(
  page: Page,
  secret: string,
): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.sessionStorage.setItem(key, value);
    },
    [SECRET_STORAGE_KEY, secret] as const,
  );
}

/**
 * Cleanup. Deletes whatever session this spec created, so the next test — and the
 * next run — starts from the same baseline.
 *
 * `purge` demands the version of the session it is deleting (`extractHostFields`),
 * so this reads state first. With no session it is a documented no-op, which is why
 * it is safe to call unconditionally from `afterEach`.
 */
export async function purgeSession(
  request: APIRequestContext,
  secret: string,
  baseURL: string,
): Promise<void> {
  const { state } = await readSessionState(request);
  const form: Record<string, string> = {};
  if (state !== null) form.version = String(state.version);

  const response = await request.post("/api/quiz/host/purge", {
    headers: {
      [HOST_SECRET_HEADER]: secret,
      /**
       * Astro's CSRF check refuses a form POST whose `Origin` does not match the
       * host, and Playwright's API context sends none — so without this line the
       * purge is a 403 and the cleanup silently does nothing. It cost one run:
       * the session left standing tripped the *next* run's precondition, which is
       * exactly the shared-state failure the precondition exists to catch.
       */
      Origin: baseURL,
    },
    form,
  });

  // Cleanup that fails quietly is cleanup that does not exist. Fail the run instead.
  if (!response.ok()) {
    throw new Error(
      `purge failed (${response.status()}): ${await response.text()}`,
    );
  }
}
