/**
 * Clears the live session so the next `start` opens a fresh room.
 *
 * This is an operational tool, not shipped behaviour. Nothing under `src/` may import it.
 *
 * ## Why it exists
 *
 * `start` is create-if-absent: without a purge, the next run of a session picks up the
 * previous one, its players and its phase. So a reset between runs is mandatory rather
 * than tidy. F-03 shipped `end` and `purge` as routes but deliberately kept both
 * irreversible verbs off the host view and on the harness page — and the harness cannot
 * exist in production (`src/lib/session/harness.ts`), because it renders the host secret
 * into HTML. The terminal is therefore the only path to a reset in production, and this
 * script is that path spelled out as one command.
 *
 * ## Why not `rehearse-room.ts --purge-stale`
 *
 * That flag is a *recovery* for a rehearsal blocked by residue, not a reset: it purges,
 * then drives a full measured rehearsal against production with a pool of Ably
 * subscribers, then purges again. Correct for taking a latency figure, wildly
 * disproportionate for emptying three keys. `--clients=0` does not shrink it either —
 * each measured action then reports "no device received …" and the run exits non-zero.
 *
 * ## Why the verification is a scan, not `check-purge-residue.ts`
 *
 * `check-purge-residue.ts` answers a different question: it *seeds* the namespace and
 * proves a purge reaches everything registered. It requires an empty namespace to start,
 * so it can only ever run after a reset, and passing it says nothing about what this
 * reset left behind. The check that belongs here is the direct one — SCAN `livequiz:*`
 * and report whatever is still standing. An unregistered survivor is reported and fails
 * the run, because outside the seeded-decoy setting there is no benign reason for one.
 *
 * Run: bun scripts/reset-quiz.ts [--base=https://<production-url>]
 *
 * Needs `LIVEQUIZ_HOST_SECRET` and the Upstash credentials in the environment; `bun`
 * loads `.env` on its own. The base URL defaults to `LIVEQUIZ_BASE_URL`.
 */

import { Redis } from "@upstash/redis";

import { registeredKeys, SESSION_NAMESPACE } from "../src/lib/session/keys";

/**
 * Mirrored from `src/lib/session/host.ts` — not a namespaced name, so not in the
 * registry. Kept local rather than imported because `host.ts` reads `import.meta.env`,
 * which is unpopulated under bare `bun`.
 */
const HOST_SECRET_HEADER = "x-livequiz-host-secret";

const REQUEST_TIMEOUT_MS = 15_000;

type Config = {
  baseUrl: string;
  hostSecret: string;
  redisUrl: string;
  redisToken: string;
};

type Finding = { ok: boolean; label: string; detail: string };

const findings: Finding[] = [];

function record(ok: boolean, label: string, detail: string): void {
  findings.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — ${detail}`);
}

function note(label: string, detail: string): void {
  console.log(`  ··    ${label} — ${detail}`);
}

/** See `scripts/probe-spine-config.ts` for why this is `process.env`. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

/** `--name=value` from argv. */
function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((entry) => entry.startsWith(prefix));
  return found?.slice(prefix.length) || undefined;
}

function resolveConfig(): Config | null {
  const rawBase = arg("base") ?? env("LIVEQUIZ_BASE_URL");
  const hostSecret = env("LIVEQUIZ_HOST_SECRET");
  const redisUrl = env("KV_REST_API_URL") ?? env("UPSTASH_REDIS_REST_URL");
  const redisToken = env("KV_REST_API_TOKEN") ?? env("UPSTASH_REDIS_REST_TOKEN");

  let baseUrl: string | undefined;
  if (rawBase) {
    try {
      baseUrl = new URL(rawBase).origin;
    } catch {
      baseUrl = undefined;
    }
  }

  record(
    Boolean(baseUrl),
    "target base URL",
    baseUrl ?? (rawBase ? `"${rawBase}" is not a URL` : "absent")
  );
  record(Boolean(hostSecret), "env LIVEQUIZ_HOST_SECRET", hostSecret ? "present" : "absent");
  record(
    Boolean(redisUrl && redisToken),
    "Upstash credentials",
    redisUrl && redisToken ? "present" : "absent"
  );

  if (!baseUrl || !hostSecret || !redisUrl || !redisToken) {
    console.log(
      "\n  → Pull credentials locally (`vercel env pull`) or export them by hand, and\n" +
        "    name the target: bun scripts/reset-quiz.ts --base=https://<production-url>\n"
    );
    return null;
  }

  return { baseUrl, hostSecret, redisUrl, redisToken };
}

/** The confirmation version `purge` demands whenever a readable session exists. */
async function readVersion(
  config: Config
): Promise<{ version: number | null; phase: string | null; error: string | null }> {
  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/state`, {
      headers: { "Cache-Control": "no-store" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json()) as {
      state?: { version?: unknown; phase?: unknown } | null;
    };
    return {
      version: typeof body.state?.version === "number" ? body.state.version : null,
      phase: typeof body.state?.phase === "string" ? body.state.phase : null,
      error: null,
    };
  } catch (err) {
    return {
      version: null,
      phase: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function purge(config: Config, version: number | null): Promise<boolean> {
  // No version means no readable session. `purge` accepts that and reports
  // "nothing-to-purge" or "residue-removed" — which is also how a document left
  // unparseable by an interrupted run gets cleaned up.
  let form: FormData | undefined;
  if (version !== null) {
    form = new FormData();
    form.set("version", String(version));
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/quiz/host/purge`, {
      method: "POST",
      // `Origin` is what satisfies Astro's cross-site form check; without it the
      // request is refused at 403 before the handler runs.
      headers: {
        [HOST_SECRET_HEADER]: config.hostSecret,
        Origin: config.baseUrl,
      },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    record(false, "purge", err instanceof Error ? err.message : String(err));
    return false;
  }

  let body: { keysRemoved?: unknown; note?: unknown; error?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    /* a non-JSON body is reported through the status below */
  }

  const removed = typeof body.keysRemoved === "number" ? body.keysRemoved : null;
  const detail =
    `${response.status}` +
    (removed !== null ? `, ${removed} key(s) removed` : "") +
    (typeof body.note === "string" ? ` (${body.note})` : "") +
    (typeof body.error === "string" ? ` — ${body.error}` : "");

  if (response.status === 409) {
    record(
      false,
      "purge",
      `${detail}. Nothing was deleted — the session moved between the read and the ` +
        "write, which means someone else is driving it. Re-run rather than forcing"
    );
    return false;
  }

  // 502 means the keys *were* deleted and only the closing broadcast failed
  // (`src/pages/api/quiz/host/purge.ts`). Treating it as a failure would report a
  // reset that did not happen when the opposite is true.
  if (response.status === 502) {
    record(true, "purge", `${detail} — keys removed`);
    note(
      "closing broadcast",
      "the data is gone but the closing snapshot never reached the room, so a device " +
        "still holding the old snapshot shows a stale screen until it reloads"
    );
    return true;
  }

  record(response.status === 200, "purge", detail);
  return response.status === 200;
}

async function scanNamespace(redis: Redis): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";

  do {
    const [next, keys] = await redis.scan(cursor, {
      match: `${SESSION_NAMESPACE}*`,
      count: 100,
    });
    cursor = String(next);
    found.push(...keys);
  } while (cursor !== "0");

  return found;
}

async function main(): Promise<void> {
  console.log("\nResetting the LiveQuiz session.\n");

  const config = resolveConfig();
  if (!config) process.exit(1);

  console.log(`\n  Target: ${config.baseUrl}\n`);

  const state = await readVersion(config);

  if (state.error) {
    record(false, "read the current session", state.error);
    console.log(
      "\n  → The confirmation version could not be read, so the purge was not attempted.\n"
    );
    process.exit(1);
  }

  record(
    true,
    "read the current session",
    state.version === null
      ? "no readable session — purging any residue anyway"
      : `version ${state.version}, phase "${state.phase ?? "unknown"}"`
  );

  const purged = await purge(config, state.version);

  const redis = new Redis({ url: config.redisUrl, token: config.redisToken });
  const survivors = await scanNamespace(redis);
  const registered = new Set(registeredKeys());
  const registeredSurvivors = survivors.filter((key) => registered.has(key));
  const unregisteredSurvivors = survivors.filter((key) => !registered.has(key));

  record(
    survivors.length === 0,
    "namespace is empty",
    survivors.length === 0
      ? `nothing matches ${SESSION_NAMESPACE}*`
      : `${survivors.length} key(s) survived: ${survivors.join(", ")}`
  );

  if (registeredSurvivors.length > 0) {
    note(
      "registered keys survived",
      "the purge reported on them but they are still there — this is the purge not " +
        "doing its job, not a gap in the registry"
    );
  }

  if (unregisteredSurvivors.length > 0) {
    note(
      "unregistered keys survived",
      `${unregisteredSurvivors.join(", ")} — outside the registry, so no purge and no ` +
        "TTL re-arm reaches them. Add them to src/lib/session/keys.ts or delete them by hand"
    );
  }

  const failed = findings.filter((finding) => !finding.ok);
  console.log(`\n${findings.length - failed.length}/${findings.length} checks passed.\n`);

  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const finding of failed) console.log(`  - ${finding.label}`);
    console.log("");
    process.exit(1);
  }

  console.log(
    "The room is clear. Two things do NOT reset with it:\n\n" +
      "  - Attendee phones still hold their playerId in localStorage. On reload they\n" +
      "    call /api/quiz/join with it, get a 404, clear it and show the name form —\n" +
      "    so reload them, and treat it as the check that this path works.\n" +
      "  - The host tab keeps its secret in sessionStorage, so it is not re-entered.\n"
  );

  if (!purged) process.exit(1);
}

main().catch((err) => {
  console.error("\nReset crashed:", err);
  process.exit(1);
});
