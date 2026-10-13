/**
 * The Upstash credential names this project accepts, in the order they are tried.
 *
 * **`aicommunity_KV_REST_API_*` comes first because that is what production injects.**
 * The Vercel Marketplace store was recreated on 2026-10-12, and Vercel now requires a
 * custom prefix when a store is connected to a project, so the integration writes
 * `aicommunity_KV_REST_API_URL` and friends rather than the bare names. First in line
 * also means a stale unprefixed pair left behind in the dashboard cannot win over it.
 *
 * The unprefixed `KV_REST_API_*` pair stays for local `.env` files written before the
 * prefix, and `UPSTASH_REDIS_REST_*` for an environment provisioned outside Vercel.
 *
 * Shared by `store.ts` (which reads `import.meta.env`) and the `scripts/` that run under
 * bare `bun` (which read `process.env`), so the list cannot drift between them.
 */
export const KV_CREDENTIAL_PAIRS = [
  {
    url: "aicommunity_KV_REST_API_URL",
    token: "aicommunity_KV_REST_API_TOKEN",
  },
  { url: "KV_REST_API_URL", token: "KV_REST_API_TOKEN" },
  { url: "UPSTASH_REDIS_REST_URL", token: "UPSTASH_REDIS_REST_TOKEN" },
] as const;

/**
 * The first pair whose URL **and** token are both present, or `null` when none is.
 *
 * Chosen as a pair rather than name by name, so a URL from one store can never be
 * matched with a token from another. `read` must treat an empty string as absent —
 * Vercel's store and a pulled `.env` can both produce one.
 */
export function pickKvCredentials(
  read: (name: string) => string | undefined,
): { url: string; token: string } | null {
  for (const pair of KV_CREDENTIAL_PAIRS) {
    const url = read(pair.url);
    const token = read(pair.token);
    if (url && token) return { url, token };
  }
  return null;
}
