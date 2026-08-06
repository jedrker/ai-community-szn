/**
 * The gate on the dev-only spine harness (roadmap F-02, Phase 4).
 *
 * One place decides whether the harness exists, so the check cannot drift between
 * the page and anything else that needs it.
 *
 * **Why an explicit env flag and not a build-mode check.** A Vercel preview is
 * built in production mode, so `import.meta.env.PROD` is `true` there and would
 * not distinguish a preview from production. `LIVEQUIZ_HARNESS` is set in Preview
 * and local development only — verified via `vercel env ls` — so production has
 * no value and the page 404s. Preview additionally sits behind Vercel
 * Authentication (F-01), giving the harness two independent covers there and none
 * in production.
 *
 * This matters more than it looks: the harness sends the host secret from the
 * browser. That is acceptable *only* because it never runs in production.
 */
export function isHarnessEnabled(): boolean {
  const value = import.meta.env.LIVEQUIZ_HARNESS;
  return typeof value === "string" && value.length > 0 && value !== "0" && value !== "false";
}
