/**
 * Room-scale rehearsal harness (roadmap F-04).
 *
 * This is a probe, not shipped behaviour. Nothing under `src/` may import it.
 *
 * ## What it measures, and why a mock cannot do the job
 *
 * The PRD's binding guardrail is "every attendee's screen reflects the host's current
 * question or reveal **within 1 second of the host acting**". That number has never
 * been taken. `latency-probe.md` (F-02) fixed the *method* — anchored at the host's
 * click, not at the HTTP response, because anchoring at the response excludes the
 * endpoint round trip, the store `EVAL` and the Ably publish, which is most of the
 * server-side budget — and left the Measurements table `_pending_`.
 *
 * A mock cannot answer this. The question is how long a real snapshot takes to travel
 * from a real click, through a real function in a real region, through a real provider,
 * to a real subscriber. Every one of those is the thing under test; replacing any of
 * them with a stub measures the stub.
 *
 * ## Why one process holds both roles
 *
 * This script *is* the host (it holds `LIVEQUIZ_HOST_SECRET` locally, never in a
 * browser — which is what keeps the "the harness never runs in production" invariant in
 * `src/lib/session/harness.ts` intact) and it *is* the room (N Ably subscribers, from
 * Phase 2). Because the click instant and every arrival instant are read from the same
 * clock, clock skew is structurally absent rather than corrected for. That resolves the
 * open question `latency-probe.md` handed this slice: **one process, one clock.**
 *
 * The honest cost, which belongs in any report of these figures: one machine on one
 * network is a **lower bound** on what a room of phones will see, not a simulation of
 * it. If the figure fails the 1 s budget, real devices are worse; if it passes, that is
 * not proof the venue network passes.
 *
 * ## Isolation
 *
 * No rehearsal-only namespace and no rehearsal-only channel — the run uses the real
 * ones, which is the only way the number describes the real thing. Safety comes from
 * the pre-flight refusal proven in `scripts/check-purge-residue.ts`: any existing
 * session document at all means abort. Teardown is the shipped `purge` route.
 *
 * Run: bun scripts/rehearse-room.ts --base=https://<production-url>
 */

import { Redis } from "@upstash/redis";

import { SESSION_CHANNEL, SESSION_KEY } from "../src/lib/session/keys";
import { SNAPSHOT_EVENT } from "../src/lib/session/realtime";

/**
 * Mirrored from `src/lib/session/keys.ts` and `realtime.ts` rather than used straight
 * from the import, following `scripts/check-purge-residue.ts`: scripts run under bare
 * `bun`, where `import.meta.env` is unpopulated, so a script that depends on a `src/`
 * module depends on that module never acquiring an env-reading import. The mirror is
 * what this script runs on; the assertion below is what stops it drifting.
 *
 * The assertion is the one thing in here worth asserting at all. If the registry
 * renames the key or the channel, a script running on a stale mirror would subscribe to
 * a dead channel and report a comfortable zero arrivals — a silent pass that reads as a
 * measurement. It must fail loudly instead.
 */
const NAMESPACE = "livequiz:";
const MIRRORED_SESSION_KEY = `${NAMESPACE}session`;
const MIRRORED_SESSION_CHANNEL = `${NAMESPACE}session`;
const MIRRORED_SNAPSHOT_EVENT = "snapshot";

/** Mirrored from `src/lib/session/host.ts`. Not a namespaced name, so not in the registry. */
const HOST_SECRET_HEADER = "x-livequiz-host-secret";

type HostVerb = "start" | "advance" | "reveal" | "purge";

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

/**
 * Fails the run before anything is touched if the mirrored constants have drifted from
 * the registry. See the mirror's docstring for why silence here would be worse than a
 * crash.
 */
function assertMirrorsMatchRegistry(): void {
  const drifted: string[] = [];

  if (MIRRORED_SESSION_KEY !== SESSION_KEY) {
    drifted.push(`session key: script has "${MIRRORED_SESSION_KEY}", keys.ts has "${SESSION_KEY}"`);
  }
  if (MIRRORED_SESSION_CHANNEL !== SESSION_CHANNEL) {
    drifted.push(
      `channel: script has "${MIRRORED_SESSION_CHANNEL}", keys.ts has "${SESSION_CHANNEL}"`
    );
  }
  if (MIRRORED_SNAPSHOT_EVENT !== SNAPSHOT_EVENT) {
    drifted.push(
      `snapshot event: script has "${MIRRORED_SNAPSHOT_EVENT}", realtime.ts has "${SNAPSHOT_EVENT}"`
    );
  }

  if (drifted.length > 0) {
    console.error(
      "\nThe harness's mirrored constants no longer match the registry:\n" +
        drifted.map((entry) => `  - ${entry}`).join("\n") +
        "\n\nRefusing to run. A stale mirror measures the wrong channel and reports zero\n" +
        "arrivals, which looks like a fan-out failure rather than a broken script.\n"
    );
    process.exit(1);
  }
}

function resolveConfig(): Config | null {
  const rawBase = arg("base") ?? env("LIVEQUIZ_BASE_URL");
  const hostSecret = env("LIVEQUIZ_HOST_SECRET");
  const redisUrl = env("KV_REST_API_URL") ?? env("UPSTASH_REDIS_REST_URL");
  const redisToken = env("KV_REST_API_TOKEN") ?? env("UPSTASH_REDIS_REST_TOKEN");

  let baseUrl: string | undefined;
  if (rawBase) {
    try {
      const parsed = new URL(rawBase);
      baseUrl = parsed.origin;
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
        "    name the target: bun scripts/rehearse-room.ts --base=https://<production-url>\n\n" +
        "    The target is production on purpose (change.md): preview URLs on this project\n" +
        "    return 302 to Vercel SSO for anonymous visitors, so simulated attendee devices\n" +
        "    cannot reach one.\n"
    );
    return null;
  }

  return { baseUrl, hostSecret, redisUrl, redisToken };
}

/**
 * **The safety gate. Any session document at all means refuse.**
 *
 * Same reasoning as `check-purge-residue.ts`, and it is not "unless the phase looks
 * harmless": `start` opens the *lobby*, so `lobby` is exactly the state a host creates
 * in the minutes before a segment — and this script drives host actions and then purges
 * the namespace. An `ended` session is live data too, inside its ten-minute window.
 *
 * This is also the whole isolation mechanism. There is no rehearsal-only key to check
 * against, so "nothing is here" is what stands in for "this rehearsal cannot collide
 * with a real session".
 */
async function preflight(redis: Redis): Promise<boolean> {
  const existing = await redis.get(MIRRORED_SESSION_KEY);

  if (existing === null) {
    record(true, "no live session — safe to rehearse", `${MIRRORED_SESSION_KEY} is absent`);
    return true;
  }

  let phase = "unreadable";
  try {
    const doc = typeof existing === "string" ? JSON.parse(existing) : existing;
    phase = String((doc as { phase?: unknown })?.phase ?? "unknown");
  } catch {
    /* leave it as unreadable — the refusal does not depend on parsing it */
  }

  console.log(
    ` FAIL  a session already exists (phase: ${phase})\n\n` +
      "  → This script drives host actions against the live namespace and purges it\n" +
      "    afterwards. Refusing to run while ANY session document exists, including a\n" +
      "    lobby waiting for a room and an ended session still inside its retention\n" +
      "    window.\n\n" +
      "    Wait for the TTL, or purge deliberately through the host route first.\n"
  );
  return false;
}

/**
 * The `<edge>::<function-region>::<id>` segment of `x-vercel-id`.
 *
 * Read from the response during the run rather than from `vercel.json`, because the
 * region key only takes effect for builds made after it landed: a figure taken from an
 * older deployment measures `iad1` and the roadmap is explicit that it must not be
 * recorded as the baseline.
 */
function functionRegion(vercelId: string | null): string | null {
  if (!vercelId) return null;
  const segments = vercelId.split("::").filter((segment) => segment.length > 0);
  return segments.length >= 3 ? (segments[1] ?? null) : null;
}

type ActionOutcome = {
  verb: HostVerb;
  status: number;
  /**
   * `null` when the route reports neither — `purge` answers with `purged`, not
   * `applied`. Kept as a tri-state rather than defaulted to `false`, because
   * "the route did not say" and "the route said no" are different facts.
   */
  applied: boolean | null;
  /**
   * `already-applied` / `no-op` / `already-started`. Surfaced rather than flattened:
   * an action the store declined is not a measured action, and counting it as one
   * would report fan-out for a snapshot that was never published.
   */
  note: string | null;
  version: number | null;
  vercelId: string | null;
  region: string | null;
  roundTripMs: number;
  /** The clock instant the request left, for the end-to-end anchor (Phase 2). */
  clickedAt: number;
  error: string | null;
};

/**
 * Calls a host route the way a real host does.
 *
 * Two things are load-bearing:
 *
 * - **The `Origin` header.** Astro rejects a POST it would read `request.formData()`
 *   from with `403 Cross-site POST form submissions are forbidden` *before the handler
 *   runs*, unless `Origin` matches. A same-origin browser `fetch` satisfies this for
 *   free; a Node caller does not, and a missing header reads as a broken endpoint
 *   rather than as a rejected origin (`spine-contract.md` §Two traps).
 * - **The secret in the header, not the body.** `extractSecret` prefers the header and
 *   then does not consume the body — which is what leaves the body free to carry
 *   `purge`'s confirmation version.
 */
async function hostAction(
  config: Config,
  verb: HostVerb,
  form?: FormData
): Promise<ActionOutcome> {
  const headers: Record<string, string> = {
    [HOST_SECRET_HEADER]: config.hostSecret,
    Origin: config.baseUrl,
  };

  /**
   * The anchor. The guardrail is "within 1 second of the host **acting**", so the
   * clock starts here — before the request — not when the response lands.
   */
  const clickedAt = performance.now();

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/quiz/host/${verb}`, {
      method: "POST",
      headers,
      body: form,
    });
  } catch (err) {
    return {
      verb,
      status: 0,
      applied: null,
      note: null,
      version: null,
      vercelId: null,
      region: null,
      roundTripMs: performance.now() - clickedAt,
      clickedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const roundTripMs = performance.now() - clickedAt;
  const vercelId = response.headers.get("x-vercel-id");

  let body: unknown = null;
  let error: string | null = null;
  try {
    body = await response.json();
  } catch {
    error = "response body was not JSON";
  }

  const payload = (body ?? {}) as {
    state?: { version?: unknown };
    applied?: unknown;
    note?: unknown;
    error?: unknown;
    purged?: unknown;
  };

  const version =
    typeof payload.state?.version === "number" ? payload.state.version : null;

  return {
    verb,
    status: response.status,
    applied: typeof payload.applied === "boolean" ? payload.applied : null,
    note: typeof payload.note === "string" ? payload.note : null,
    version,
    vercelId,
    region: functionRegion(vercelId),
    roundTripMs,
    clickedAt,
    error: error ?? (typeof payload.error === "string" ? payload.error : null),
  };
}

function describeOutcome(outcome: ActionOutcome): string {
  const parts = [`${outcome.status}`, `${Math.round(outcome.roundTripMs)} ms`];
  if (outcome.version !== null) parts.push(`version ${outcome.version}`);
  if (outcome.applied !== null) parts.push(`applied ${outcome.applied}`);
  if (outcome.note) parts.push(`note ${outcome.note}`);
  if (outcome.region) parts.push(`region ${outcome.region}`);
  if (outcome.error) parts.push(`error ${outcome.error}`);
  return parts.join(", ");
}

/** The session as the server reports it. Used to learn `purge`'s confirmation version. */
async function readState(
  config: Config
): Promise<{ version: number | null; error: string | null }> {
  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/state`, {
      headers: { "Cache-Control": "no-store" },
    });
    const body = (await response.json()) as { state?: { version?: unknown } | null };
    const version =
      typeof body.state?.version === "number" ? body.state.version : null;
    return { version, error: null };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Purges the namespace, including when the run failed partway — otherwise a crashed
 * rehearsal leaves a session document behind, and the next run's pre-flight refuses for
 * a reason that has nothing to do with a real session.
 *
 * `purge` demands the session's current version as confirmation, which the caller can
 * only know by having read state. That inversion is deliberate on the route's side
 * (`host.ts` §`extractHostFields`) and the read here is the price of it — so a 409 means
 * the session moved under us, and the honest response is to report it, not to re-read
 * and retry until it sticks.
 */
async function teardown(config: Config): Promise<void> {
  const state = await readState(config);

  if (state.error) {
    record(false, "teardown: read state before purge", state.error);
    return;
  }

  const form = new FormData();
  if (state.version !== null) form.set("version", String(state.version));

  // No version means no session — `purge` accepts that and reports "nothing to purge",
  // which is also how residue left by a crashed run is cleaned up.
  const outcome = await hostAction(
    config,
    "purge",
    state.version !== null ? form : undefined
  );

  if (outcome.status === 409) {
    record(
      false,
      "teardown: purge",
      `409 — the session moved during the run (${outcome.error ?? "no detail"}). ` +
        "Nothing was deleted; re-run the purge by hand rather than retrying blind"
    );
    return;
  }

  record(
    outcome.status === 200,
    "teardown: purge",
    describeOutcome(outcome)
  );
}

/** The three flow verbs, in the order a host presses them. No body — the secret is a header. */
async function driveFlow(config: Config): Promise<void> {
  for (const verb of ["start", "advance", "reveal"] as const) {
    const outcome = await hostAction(config, verb);

    record(
      outcome.status === 200 && outcome.applied === true,
      `host action: ${verb}`,
      describeOutcome(outcome)
    );

    if (outcome.region && outcome.region !== "fra1") {
      note(
        "function region",
        `${outcome.region} — not fra1. A figure from this deployment measures the wrong ` +
          "region and must not be recorded as the baseline (roadmap F-04)"
      );
    }
  }
}

async function main(): Promise<void> {
  console.log("\nRoom-scale rehearsal harness (F-04).\n");

  assertMirrorsMatchRegistry();

  const config = resolveConfig();
  if (!config) process.exit(1);

  console.log(`\n  Target: ${config.baseUrl}\n`);

  const redis = new Redis({ url: config.redisUrl, token: config.redisToken });

  if (!(await preflight(redis))) process.exit(1);

  try {
    await driveFlow(config);
  } finally {
    // Always, including after a thrown request. A rehearsal that leaves state behind
    // blocks the next one on a pre-flight refusal that means nothing.
    await teardown(config);
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
    "Confirm the namespace is empty: bun scripts/check-purge-residue.ts\n\n" +
      "To confirm the Origin header is what satisfies Astro's origin check, omit it —\n" +
      "this is refused before the handler runs, so nothing is deleted:\n\n" +
      '  curl -si -X POST -H "' +
      HOST_SECRET_HEADER +
      ': $LIVEQUIZ_HOST_SECRET" \\\n' +
      "    -F version=999999 <base-url>/api/quiz/host/purge\n\n" +
      "  → expect 403 Cross-site POST form submissions are forbidden\n"
  );
}

main().catch((err) => {
  console.error("\nRehearsal crashed:", err);
  process.exit(1);
});
