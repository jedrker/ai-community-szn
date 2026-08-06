/**
 * Probe for the LiveQuiz session spine's configuration and vendor capabilities
 * (roadmap F-02, Phase 1).
 *
 * This is a probe, not shipped behaviour. Nothing under `src/` may import it.
 *
 * It exists because F-01 taught this project that confident documentation is not
 * evidence: two `infrastructure.md` claims about the platform were wrong when written
 * and only a probe caught them. So rather than trusting docs about which variables the
 * Vercel Marketplace integration injects, or whether Lua scripting is reachable over
 * Upstash's HTTP interface, this asks.
 *
 * The EVAL check is the load-bearing one. All of Phase 2 assumes a compare-and-set can
 * execute atomically inside the store; if it cannot, that is a design decision to retake
 * (advisory lock, or a version key plus SETNX) — not something to discover halfway
 * through writing the store module.
 *
 * Run: bun scripts/probe-spine-config.ts
 */

import { Redis } from "@upstash/redis";
import Ably from "ably";

/** Both name pairs @upstash/redis accepts, in the order it prefers them. */
const UPSTASH_NAME_PAIRS = [
  { url: "UPSTASH_REDIS_REST_URL", token: "UPSTASH_REDIS_REST_TOKEN" },
  { url: "KV_REST_API_URL", token: "KV_REST_API_TOKEN" },
] as const;

/** A throwaway key. Short TTL so a failed run leaves nothing behind for long. */
const PROBE_KEY = "livequiz:probe:spine-config";
const PROBE_TTL_SECONDS = 60;

type Finding = { ok: boolean; label: string; detail: string };

const findings: Finding[] = [];

function record(ok: boolean, label: string, detail: string): void {
  findings.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — ${detail}`);
}

/**
 * Read from `process.env`, not `import.meta.env`: this script runs under bare `bun`
 * with no Astro/Vite pipeline, so `import.meta.env` is not populated here. The shipped
 * modules in `src/lib/session/` read `import.meta.env` per the project's convention —
 * a deliberate difference, not an inconsistency.
 */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function resolveUpstashCredentials(): { url: string; token: string } | null {
  const present = UPSTASH_NAME_PAIRS.filter(
    (pair) => env(pair.url) && env(pair.token)
  );

  for (const pair of UPSTASH_NAME_PAIRS) {
    const has = Boolean(env(pair.url) && env(pair.token));
    record(
      has,
      `env ${pair.url} / ${pair.token}`,
      has ? "present" : "absent"
    );
  }

  if (present.length === 0) {
    console.log(
      "\n  → Neither name pair is set. Provision Upstash via the Vercel Marketplace,\n" +
        "    then pull the values locally (`vercel env pull`) or export them by hand.\n" +
        "    Record in .env.example whichever pair the integration actually injected."
    );
    return null;
  }

  if (present.length > 1) {
    console.log(
      "\n  → Both name pairs are set. Harmless for the client, but ambiguous for a reader:\n" +
        "    keep one and delete the other so there is a single source of truth."
    );
  }

  const chosen = present[0]!;
  console.log(`\n  Using ${chosen.url} / ${chosen.token}.\n`);
  return { url: env(chosen.url)!, token: env(chosen.token)! };
}

async function probeRoundTrip(redis: Redis): Promise<void> {
  const written = `probe-${Date.now()}`;

  await redis.set(PROBE_KEY, written, { ex: PROBE_TTL_SECONDS });
  const read = await redis.get<string>(PROBE_KEY);
  record(
    read === written,
    "SET / GET round trip",
    read === written ? `read back ${read}` : `wrote ${written}, read ${String(read)}`
  );

  const ttl = await redis.ttl(PROBE_KEY);
  record(
    ttl > 0 && ttl <= PROBE_TTL_SECONDS,
    "TTL is set and counting down",
    `ttl=${ttl}s (expected 0 < ttl <= ${PROBE_TTL_SECONDS})`
  );
}

/**
 * The capability Phase 2's whole design rests on: a compare-and-set that increments a
 * version and re-arms the TTL, all in one round trip. This mirrors the real script's
 * shape closely enough to prove the mechanism — guard matches, guard rejects, TTL
 * survives — without being the real script.
 */
async function probeEval(redis: Redis): Promise<void> {
  const script = `
    local current = redis.call('GET', KEYS[1])
    local currentVersion = 0
    if current then currentVersion = tonumber(current) end
    if currentVersion ~= tonumber(ARGV[1]) then
      return { 0, currentVersion }
    end
    local nextVersion = currentVersion + 1
    redis.call('SET', KEYS[1], nextVersion, 'EX', tonumber(ARGV[2]))
    return { 1, nextVersion }
  `;

  const evalKey = `${PROBE_KEY}:version`;

  try {
    await redis.del(evalKey);

    const applied = await redis.eval<[string, string], [number, number]>(
      script,
      [evalKey],
      ["0", String(PROBE_TTL_SECONDS)]
    );
    record(
      Number(applied?.[0]) === 1 && Number(applied?.[1]) === 1,
      "EVAL compare-and-set applies a matching write",
      `returned [${String(applied?.[0])}, ${String(applied?.[1])}] (expected [1, 1])`
    );

    const rejected = await redis.eval<[string, string], [number, number]>(
      script,
      [evalKey],
      ["0", String(PROBE_TTL_SECONDS)]
    );
    record(
      Number(rejected?.[0]) === 0 && Number(rejected?.[1]) === 1,
      "EVAL compare-and-set rejects a stale write",
      `returned [${String(rejected?.[0])}, ${String(rejected?.[1])}] (expected [0, 1])`
    );

    const evalTtl = await redis.ttl(evalKey);
    record(
      evalTtl > 0,
      "EVAL set the TTL in the same round trip",
      `ttl=${evalTtl}s`
    );

    await redis.del(evalKey);
  } catch (err) {
    record(
      false,
      "EVAL (Lua scripting over the HTTP interface)",
      err instanceof Error ? err.message : String(err)
    );
    console.log(
      "\n  → This is the blocking one. Phase 2's atomic version guard assumes EVAL works\n" +
        "    here. If it genuinely does not, STOP and retake that design decision\n" +
        "    (advisory lock, or a version key plus SETNX) before writing the store module."
    );
  }
}

async function probeAbly(): Promise<void> {
  const apiKey = env("ABLY_API_KEY");
  record(Boolean(apiKey), "env ABLY_API_KEY", apiKey ? "present" : "absent");
  if (!apiKey) return;

  try {
    const rest = new Ably.Rest({ key: apiKey });
    const tokenRequest = await rest.auth.createTokenRequest({
      capability: { "livequiz:session": ["subscribe"] },
    });
    const looksRight =
      typeof tokenRequest.keyName === "string" && typeof tokenRequest.mac === "string";
    record(
      looksRight,
      "Ably mints a subscribe-only token request",
      looksRight
        ? `keyName=${tokenRequest.keyName}, capability=${tokenRequest.capability ?? "(default)"}`
        : "response did not look like a token request"
    );
  } catch (err) {
    record(
      false,
      "Ably token request",
      err instanceof Error ? err.message : String(err)
    );
  }
}

function probeHostSecret(): void {
  const secret = env("LIVEQUIZ_HOST_SECRET");
  record(
    Boolean(secret && secret.length >= 16),
    "env LIVEQUIZ_HOST_SECRET",
    secret ? `present, ${secret.length} chars (want >= 16)` : "absent"
  );
}

async function main(): Promise<void> {
  console.log("\nProbing the LiveQuiz session spine configuration (F-02 Phase 1).\n");

  const credentials = resolveUpstashCredentials();

  if (credentials) {
    const redis = new Redis({ url: credentials.url, token: credentials.token });
    try {
      await probeRoundTrip(redis);
      await probeEval(redis);
    } catch (err) {
      record(
        false,
        "Upstash reachability",
        err instanceof Error ? err.message : String(err)
      );
    } finally {
      await redis.del(PROBE_KEY).catch(() => {
        /* best effort — the TTL cleans up regardless */
      });
    }
  }

  await probeAbly();
  probeHostSecret();

  const failed = findings.filter((finding) => !finding.ok);
  console.log(
    `\n${findings.length - failed.length}/${findings.length} checks passed.\n`
  );

  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const finding of failed) console.log(`  - ${finding.label}`);
    console.log("");
    process.exit(1);
  }

  console.log(
    "All checks passed. Record the variable pair above in .env.example, then Phase 2\n" +
      "can rely on EVAL being available.\n"
  );
}

main().catch((err) => {
  console.error("\nProbe crashed:", err);
  process.exit(1);
});
