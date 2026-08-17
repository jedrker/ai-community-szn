import { expect, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Session helpers shared by every host-side spec.
 *
 * These exist so a spec never drives setup or cleanup **through the UI**. Typing the
 * host secret into `#host-menu` would make every test depend on the dialog it is not
 * testing, and closing a session by clicking `zakończ sesję` would make cleanup
 * depend on the arming flow. Both go through the API instead — the E2E equivalent of
 * `storageState` (see `e2e/E2E-RULES.md` §5).
 *
 * Mirrors, not copies: the string constants below are the wire contract of
 * `src/lib/session/host.ts` and `src/pages/quiz/host/[slug].astro`. They are spelled
 * here because a browser-level spec may not value-import from `src/lib/session/` or
 * `src/quiz/` (`src/lib/client/boundary.test.ts`'s rule and `E2E-RULES.md` §5, same
 * reasoning: a spec is client-side code). If either drifts from the app, the seed spec
 * fails on the next run — loudly, not silently.
 */
const HOST_SECRET_HEADER = "x-livequiz-host-secret";
const SECRET_STORAGE_KEY = "quiz-host-secret";

/**
 * The quiz these specs drive (multiple-quizzes).
 *
 * A host panel now lives at `/quiz/host/<slug>`, so a spec has to name one — and it is
 * spelled here, once, rather than in each spec: a registry rearrangement is then one
 * edit, and no spec is quietly pointed at a different quiz than its sibling.
 *
 * A mirror of `src/quiz/definitions/`, like the two constants above, and it fails the
 * same way — an unknown slug 404s and every locator below it misses, loudly. **Which**
 * quiz is irrelevant to these specs: they assert which verb the panel offers in which
 * phase, and that is a property of the session, not of the questions.
 */
export const QUIZ_SLUG = "summer-tour-szczecin";

/** Where a host panel lives, assembled once from the slug above. */
export const HOST_PANEL_PATH = `/quiz/host/${QUIZ_SLUG}`;

/** Where the room lands — the address the projector's QR encodes. */
export const ATTENDEE_PATH = `/quiz/${QUIZ_SLUG}`;

/**
 * That quiz's four-digit join code, mirrored for the same reason `QUIZ_SLUG` is: a spec may
 * not value-import from `src/quiz/`. Drift shows up as `/q/<code>` rendering the "nie znamy
 * tego kodu" page instead of redirecting, which the code-route spec asserts against.
 */
export const QUIZ_CODE = "1001";

/** The short address, assembled once from the code above. */
export const SHORT_JOIN_PATH = `/q/${QUIZ_CODE}`;

/**
 * A **second** committed quiz, for the specs about two quizzes at once (impl-review F2/F10).
 *
 * The wrong-quiz refusals — the panel that will not drive another quiz's session, and `start`'s
 * 409 — are unreachable with one quiz in the registry, so they are the half of this change that
 * had no browser coverage until a second quiz shipped. Mirrored like the constants above.
 */
export const OTHER_QUIZ_SLUG = "jesienny-meetup-ai";
export const OTHER_QUIZ_TITLE = "Jesienny meetup: AI w praktyce";
export const OTHER_HOST_PANEL_PATH = `/quiz/host/${OTHER_QUIZ_SLUG}`;

/** `bun` loads `.env`; `npx` does not. See `playwright.config.ts`. */
export const hostSecret = process.env.LIVEQUIZ_HOST_SECRET ?? "";

/**
 * Waits until the host panel's inline script has attached, before the first click.
 *
 * **Why a click can otherwise be dropped, deterministically** (impl-review F11). The flow
 * verbs are rendered by the server with **no `disabled` attribute**, so
 * `expect(start).toBeEnabled()` is satisfied by static HTML — before the inline script exists
 * and before it has attached a single listener. Playwright then clicks a button that nothing is
 * listening to, the click is lost, and the spec fails five seconds later on a state that never
 * changed. It reads exactly like a broken app.
 *
 * That window is normally microseconds. It becomes seconds whenever Vite re-optimizes the dep
 * graph — a fresh clone, a `bun install`, a deleted `node_modules/.vite`, an added import, or an
 * interleaved `bun run build` — because the panel's module import 504s once and retries. So the
 * first spec to run against a fresh dev server is the one that loses.
 *
 * The condition is the connection status: the server renders `połączenie: —` and only the
 * script replaces it. Waiting on that is waiting for **state**, per `E2E-RULES.md` rule 6 —
 * never a `waitForTimeout`, which would trade a real wait for a guessed one.
 */
export async function waitForHostPanelReady(page: Page): Promise<void> {
  await expect(page.getByText("połączenie:", { exact: false })).not.toHaveText(
    /połączenie:\s*—/,
    { timeout: 15_000 },
  );
}

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
