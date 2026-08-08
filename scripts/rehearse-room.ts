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
 * `src/lib/session/harness.ts` intact) and it *is* the room (N Ably subscribers).
 * Because the click instant and every arrival instant are read from the same clock,
 * clock skew is structurally absent rather than corrected for. That resolves the open
 * question `latency-probe.md` handed this slice: **one process, one clock.**
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
 * Run: bun scripts/rehearse-room.ts --base=https://<production-url> [--clients=150]
 *        [--kill-after-start=<n>]   fault injection — see `killAfterStart`
 *        [--purge-stale]            clear a session left by an interrupted run
 *
 * ## The join stage (roadmap S-02, Phase 5)
 *
 * Between `start` and the flow verbs, all N devices claim a name at once. That burst is
 * the only place the name claim's atomicity is *tested* rather than asserted: the Lua
 * `EVAL` exists so two attendees cannot end up holding one name, and a mocked test has
 * nothing to race against. See `runJoinBurst` and `auditPlayerStore`.
 */

import { Realtime } from "ably";
import { Redis } from "@upstash/redis";

import {
  PLAYER_IDS_KEY,
  PLAYERS_KEY,
  SESSION_CHANNEL,
  SESSION_KEY,
} from "../src/lib/session/keys";
import { SNAPSHOT_EVENT } from "../src/lib/session/realtime";

/**
 * Mirrored from `src/lib/session/host.ts` — not a namespaced name, so not in the
 * registry. Kept local rather than imported because `host.ts` reads `import.meta.env`,
 * which is unpopulated under bare `bun`.
 */
const HOST_SECRET_HEADER = "x-livequiz-host-secret";

type HostVerb = "start" | "advance" | "reveal" | "purge";

type Config = {
  baseUrl: string;
  hostSecret: string;
  redisUrl: string;
  redisToken: string;
  clients: number;
  /**
   * How many connected devices to kill after the warm-up (0 = none).
   *
   * Fault injection, because every clean run leaves the miss-accounting path
   * unexecuted: 150/150 received proves the happy path and says nothing about
   * whether a device that goes away is *reported* or silently excluded from the
   * denominator. A phone locking its screen mid-segment is the ordinary case, so
   * the path this exercises is the one most likely to run at a real event.
   */
  killAfterStart: number;
  /**
   * Clear a pre-existing session instead of refusing (default: refuse).
   *
   * The recovery path for a run that was killed. Opt-in, because the pre-flight refusal
   * is not a nuisance check — it is the only thing standing between this script and a
   * real session, since there is no rehearsal-only key to distinguish them.
   */
  purgeStale: boolean;
};

/**
 * The PRD guardrail, in milliseconds: "every attendee's screen reflects the host's
 * current question or reveal within 1 second of the host acting".
 */
const BUDGET_MS = 1000;

/**
 * How long a client is given to reach `connected` and attach.
 *
 * Generous, because 150 clients joining at once is a burst against a deliberately
 * unthrottled token endpoint and queueing there is part of what is being measured — a
 * tight timeout would convert legitimate slow joins into "never connected" and blame
 * the platform for the harness's impatience.
 */
const CONNECT_TIMEOUT_MS = 30_000;

/**
 * How long arrivals for one action are waited for before the remaining clients are
 * called misses. Five times the budget: anything that has not landed by then has failed
 * the guardrail so thoroughly that its exact figure would not change the verdict.
 */
const ARRIVAL_TIMEOUT_MS = 5_000;

/** Default room size — the PRD guardrail's number. See `change.md`. */
const DEFAULT_CLIENTS = 150;

/**
 * Deadline on the two host-side HTTP calls.
 *
 * Generous against the slowest cold start observed (~2 s) and still far short of a
 * hang. The failure this bounds is not a slow figure but a stranded session: without a
 * deadline, a request that never returns skips teardown entirely.
 */
const HOST_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Below this many arrivals, the reported tail is labelled `max*` rather than `p95`.
 *
 * Nearest rank puts the 95th percentile at `ceil(0.95n)`, which equals `n` for all
 * n <= 20 — so a five-client run's "p95" is its single slowest sample. Calling that a
 * percentile is how a smoke test's figure ends up in a table beside room-scale ones.
 */
const MIN_TAIL_SAMPLES = 21;

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

  const rawClients = arg("clients");
  const clients = rawClients === undefined ? DEFAULT_CLIENTS : Number(rawClients);
  const clientsValid = Number.isInteger(clients) && clients >= 0;

  record(
    clientsValid,
    "simulated device count",
    clientsValid
      ? `${clients}${rawClients === undefined ? " (default)" : ""}`
      : `"${rawClients}" is not a non-negative integer`
  );

  if (clientsValid && clients > 150) {
    note(
      "device count",
      `${clients} — the provider's free ceiling is 200 peak connections, so this run ` +
        "leaves little headroom and will report a shortfall if anything else is holding " +
        "connections"
    );
  }

  const rawKill = arg("kill-after-start");
  const killAfterStart = rawKill === undefined ? 0 : Number(rawKill);
  const killValid =
    Number.isInteger(killAfterStart) && killAfterStart >= 0 && killAfterStart <= clients;

  if (rawKill !== undefined) {
    record(
      killValid,
      "fault injection: clients killed after start",
      killValid
        ? `${killAfterStart} of ${clients} — expect them as misses, not as a shifted p95`
        : `"${rawKill}" is not an integer in 0..${clients}`
    );
  }

  if (!baseUrl || !hostSecret || !redisUrl || !redisToken || !clientsValid || !killValid) {
    console.log(
      "\n  → Pull credentials locally (`vercel env pull`) or export them by hand, and\n" +
        "    name the target: bun scripts/rehearse-room.ts --base=https://<production-url>\n\n" +
        "    The target is production on purpose (change.md): preview URLs on this project\n" +
        "    return 302 to Vercel SSO for anonymous visitors, so simulated attendee devices\n" +
        "    cannot reach one.\n"
    );
    return null;
  }

  const purgeStale = process.argv.includes("--purge-stale");
  if (purgeStale) {
    record(
      true,
      "--purge-stale",
      "a pre-existing session will be purged rather than refused — only pass this when " +
        "you know no real session is running"
    );
  }

  return { baseUrl, hostSecret, redisUrl, redisToken, clients, killAfterStart, purgeStale };
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
async function preflight(config: Config, redis: Redis): Promise<boolean> {
  const existing = await redis.get(SESSION_KEY);

  if (existing === null) {
    record(true, "no live session — safe to rehearse", `${SESSION_KEY} is absent`);
    return true;
  }

  let phase = "unreadable";
  try {
    const doc = typeof existing === "string" ? JSON.parse(existing) : existing;
    phase = String((doc as { phase?: unknown })?.phase ?? "unknown");
  } catch {
    /* leave it as unreadable — the refusal does not depend on parsing it */
  }

  // The recovery path. An interrupted run *does* strand a session: `finally` covers a
  // thrown error but not a kill, and signals cannot be caught here — measured on bun
  // 1.3.14, `process.on` never fires for SIGINT/SIGTERM/SIGHUP/SIGUSR2, so a handler
  // would be dead code that made interrupts *look* safe. The stranded document then
  // holds the four-hour `SESSION_TTL_SECONDS` and refuses every later run for a reason
  // unrelated to a real session. This flag is the deliberate, opt-in way out; refusal
  // stays the default precisely because the gate is also the isolation mechanism.
  if (config.purgeStale) {
    note(
      "stale session cleared",
      `--purge-stale was passed and a session in phase "${phase}" existed — purging it ` +
        "before rehearsing. This is only correct because you know no real session is running"
    );
    await teardown(config);

    if ((await redis.get(SESSION_KEY)) !== null) {
      console.log(
        " FAIL  --purge-stale did not clear the session\n\n" +
          "  → The purge route reported success or failure above. Clear it by hand before\n" +
          "    rehearsing; this script will not drive a namespace it could not empty.\n"
      );
      return false;
    }

    record(true, "stale session purged — safe to rehearse", `${SESSION_KEY} is absent`);
    return true;
  }

  console.log(
    ` FAIL  a session already exists (phase: ${phase})\n\n` +
      "  → This script drives host actions against the live namespace and purges it\n" +
      "    afterwards. Refusing to run while ANY session document exists, including a\n" +
      "    lobby waiting for a room and an ended session still inside its retention\n" +
      "    window.\n\n" +
      "    Wait for the TTL, or purge deliberately through the host route first.\n\n" +
      "    If this is residue from a run you interrupted — a kill cannot be caught, so an\n" +
      "    interrupted run leaves the session behind — re-run with --purge-stale.\n"
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
  /**
   * The count the route embedded in the published snapshot (roadmap S-02 §5).
   *
   * Carried so the run can check the injection end to end against the real store: the
   * count is read outside the version guard and written onto the state on its way out,
   * and nothing in the mocked suite can prove that the number the room receives is the
   * number the store holds.
   */
  playerCount: number | null;
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
      // A stalled request would otherwise hang the run forever with 150 Ably
      // connections held against a 200-connection ceiling, never reaching teardown.
      // The catch below already treats a failed request as a first-class outcome, so
      // a deadline is all that was missing.
      signal: AbortSignal.timeout(HOST_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    return {
      verb,
      status: 0,
      applied: null,
      note: null,
      version: null,
      playerCount: null,
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
    state?: { version?: unknown; playerCount?: unknown };
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
    playerCount:
      typeof payload.state?.playerCount === "number" ? payload.state.playerCount : null,
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
      // Teardown depends on this read, so a stall here would strand a live session on
      // production rather than merely delaying a figure.
      signal: AbortSignal.timeout(HOST_REQUEST_TIMEOUT_MS),
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

  // 502 means the keys *were* deleted and only the closing broadcast failed
  // (`src/pages/api/quiz/host/purge.ts`). Failing the check on that reports residue left
  // behind when the opposite happened, and exits non-zero on a successful teardown.
  if (outcome.status === 502) {
    record(true, "teardown: purge", `${describeOutcome(outcome)} — keys removed`);
    note(
      "teardown broadcast",
      "the purge deleted every registered key but its closing publish failed, so a " +
        "client still holding the old snapshot will not see the session close. Harmless " +
        "for a rehearsal; on a live session it means the room's screens go stale rather " +
        "than closing"
    );
    return;
  }

  record(
    outcome.status === 200,
    "teardown: purge",
    describeOutcome(outcome)
  );
}

/**
 * One simulated attendee device.
 *
 * `heldVersion` and the drop below are not bookkeeping — they are the client rule from
 * `spine-contract.md`, applied exactly as a real device applies it: *take a snapshot
 * only if its version is strictly greater than the one held*. Without it a republish
 * (which `start` performs on an existing session, and which a host retrying a failed
 * publish performs deliberately) would be counted as a fresh arrival and would flatter
 * every figure downstream of it.
 */
type Device = {
  index: number;
  client: Realtime | null;
  /** Reached `connected` and attached to the channel. */
  connected: boolean;
  /** Why it did not, when it did not. Distinct from "connected but never received". */
  failure: string | null;
  heldVersion: number;
  /** version → the instant it arrived, on this process's clock. */
  arrivals: Map<number, number>;
  droppedNotNewer: number;
  /**
   * Killed deliberately by `--kill-after-start`.
   *
   * Tracked separately from a plain miss on purpose: an injected fault and a real
   * failure must not read the same in the output, or the flag would train whoever
   * runs this to shrug at exactly the number they should be alarmed by.
   */
  killed: boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Stands up one client the way a phone does: `authUrl` pointed at the project's own
 * token endpoint, so the run exercises that endpoint under a join burst rather than
 * short-circuiting it with an API key this process happens to have.
 */
async function connectDevice(config: Config, index: number): Promise<Device> {
  const device: Device = {
    index,
    client: null,
    connected: false,
    failure: null,
    heldVersion: 0,
    arrivals: new Map(),
    droppedNotNewer: 0,
    killed: false,
  };

  try {
    const client = new Realtime({ authUrl: `${config.baseUrl}/api/quiz/token` });
    device.client = client;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`did not connect within ${CONNECT_TIMEOUT_MS} ms`)),
        CONNECT_TIMEOUT_MS
      );
      client.connection.once("connected", () => {
        clearTimeout(timer);
        resolve();
      });
      client.connection.once("failed", (change) => {
        clearTimeout(timer);
        reject(new Error(change.reason?.message ?? "connection failed"));
      });
    });

    const channel = client.channels.get(SESSION_CHANNEL);
    await channel.subscribe(SNAPSHOT_EVENT, (message) => {
      // Read the clock first, before any parsing, so the figure is arrival time and
      // not arrival time plus this handler.
      const at = performance.now();
      const version = (message.data as { version?: unknown } | null)?.version;
      if (typeof version !== "number") return;

      if (version <= device.heldVersion) {
        device.droppedNotNewer += 1;
        return;
      }

      device.heldVersion = version;
      device.arrivals.set(version, at);
    });

    device.connected = true;
  } catch (err) {
    device.failure = err instanceof Error ? err.message : String(err);
    // Close it, or Ably keeps re-fetching `authUrl` and re-attempting the socket for
    // the rest of the run. In a partially failed pool — the case this harness exists to
    // report — those retries consume peak connections and token requests *while the
    // figures are being taken*, perturbing two of the things being measured.
    device.client?.close();
  }

  return device;
}

/**
 * The join burst. All at once rather than staggered, because that is the shape of a
 * real room: 150 phones open the page when the host puts the QR code on screen.
 *
 * A connection failure is a first-class result, not an error to swallow — "only 120 of
 * 150 connected" is the most important thing this harness can return, and averaging
 * latency over the 120 that made it while saying nothing about the 30 that did not
 * would report a healthy number for a broken room.
 */
async function connectPool(config: Config): Promise<Device[]> {
  if (config.clients === 0) {
    note("device pool", "0 clients — driving the session only, nothing will be measured");
    return [];
  }

  const startedAt = performance.now();
  const devices = await Promise.all(
    Array.from({ length: config.clients }, (_, index) => connectDevice(config, index))
  );
  const elapsed = Math.round(performance.now() - startedAt);

  const connected = devices.filter((device) => device.connected);
  record(
    connected.length === config.clients,
    "device pool connected",
    `${connected.length}/${config.clients} in ${elapsed} ms`
  );

  const failures = devices.filter((device) => !device.connected);
  if (failures.length > 0) {
    // Grouped by reason: 30 identical messages is one fact, and printing it 30 times
    // buries the one client that failed differently.
    const byReason = new Map<string, number>();
    for (const device of failures) {
      const reason = device.failure ?? "unknown";
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    for (const [reason, count] of byReason) {
      note("connection failure", `${count}× ${reason}`);
    }
    note(
      "where to look first",
      "if there are no provider-side errors here, suspect this machine before the " +
        "platform — file descriptors and one network path are the plausible bottleneck"
    );
  }

  return devices;
}

async function closePool(devices: Device[]): Promise<void> {
  for (const device of devices) device.client?.close();
  // Give the sockets a moment to close before the process exits, so the provider's
  // peak-connection count settles before the next run starts.
  if (devices.length > 0) await sleep(250);
}

/**
 * Kills the first N connected devices after the warm-up, simulating phones that
 * lock or drop off the venue network mid-segment.
 *
 * They stay `connected: true` deliberately. They *were* connected and they are
 * part of the room, so leaving them in the denominator is what makes the loss
 * visible as `received 147/150`; flipping the flag would shrink the denominator
 * and report a perfect run over a room that lost three devices — the silent
 * exclusion this whole flag exists to rule out.
 */
function killDevices(config: Config, devices: Device[]): void {
  if (config.killAfterStart === 0) return;

  const victims = devices.filter((device) => device.connected).slice(0, config.killAfterStart);
  for (const device of victims) {
    device.client?.close();
    device.killed = true;
  }

  note(
    "fault injection",
    `killed ${victims.length} connected device(s) after the warm-up — they must appear as ` +
      "misses below, and the p95 of the remainder must stay comparable to a clean run"
  );
}

/* ------------------------------------------------------------------------- *
 * The join burst (roadmap S-02, Phase 5)
 *
 * The one failure a green suite cannot catch. `store.test.ts` asserts the claim is a
 * single `EVAL` with three keys — that it *is* one round trip — but a mocked test can
 * never observe the race the script exists to prevent, because there is nothing to
 * race against. Only N real requests arriving at one real store can.
 * ------------------------------------------------------------------------- */

/**
 * The name device `index` claims.
 *
 * Polish diacritics on purpose. `ł` and `ó` are exactly where a naive NFD fold breaks
 * (`normalize.ts`), so a rehearsal using ASCII names would exercise the uniqueness key
 * without exercising the fold that produces it.
 */
function rehearsalName(index: number): string {
  return `Gość ${index + 1}`;
}

/**
 * The same name a scanner would consider different and the fold must not: uppercased,
 * diacritics stripped, and an extra internal space.
 *
 * Three folds at once — case, diacritics, whitespace collapsing — because they are
 * three separate lines in `validateDisplayName` and any one of them regressing alone
 * would let a duplicate through.
 */
function collisionName(index: number): string {
  return `GOSC  ${index + 1}`;
}

type JoinResult = {
  index: number;
  status: number;
  ms: number;
  playerId: string | null;
  displayName: string | null;
  error: string | null;
};

/**
 * One claim, the way a phone makes it.
 *
 * The `Origin` header is required for the same reason `hostAction` sets it: Astro
 * refuses a cross-origin POST that reads `formData()` with a 403 *before* the handler
 * runs, so without it every claim in the burst would fail for a reason that has nothing
 * to do with the store.
 */
async function joinOnce(config: Config, index: number, displayName: string): Promise<JoinResult> {
  const form = new FormData();
  form.set("displayName", displayName);

  const startedAt = performance.now();

  try {
    const response = await fetch(`${config.baseUrl}/api/quiz/join`, {
      method: "POST",
      headers: { Origin: config.baseUrl },
      body: form,
      signal: AbortSignal.timeout(HOST_REQUEST_TIMEOUT_MS),
    });
    const ms = performance.now() - startedAt;
    const body = (await response.json().catch(() => ({}))) as {
      player?: { id?: unknown; displayName?: unknown };
      error?: unknown;
    };

    return {
      index,
      status: response.status,
      ms,
      playerId: typeof body.player?.id === "string" ? body.player.id : null,
      displayName:
        typeof body.player?.displayName === "string" ? body.player.displayName : null,
      error: typeof body.error === "string" ? body.error : null,
    };
  } catch (err) {
    return {
      index,
      status: 0,
      ms: performance.now() - startedAt,
      playerId: null,
      displayName: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function reportDistribution(label: string, samples: number[]): void {
  if (samples.length === 0) {
    note(label, "no samples");
    return;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const tail = sorted.length >= MIN_TAIL_SAMPLES ? "p95" : "max*";

  console.log(
    `  ··    ${label} — min ${Math.round(sorted[0]!)} ms   ` +
      `median ${Math.round(percentile(sorted, 0.5))} ms   ` +
      `${tail} ${Math.round(percentile(sorted, 0.95))} ms   ` +
      `max ${Math.round(sorted[sorted.length - 1]!)} ms   n=${sorted.length}`
  );
}

/**
 * Reads the two player hashes back and asks the question FR-008 exists to answer:
 * **can two devices believe they hold the same name?**
 *
 * Checking the players hash alone cannot answer it. Its field *is* the folded name, so
 * a duplicate is structurally impossible there — a lost race would show up as one hash
 * entry silently overwritten by the other, and `HLEN` would look perfectly healthy.
 *
 * The reverse index is what makes the failure visible. It is keyed by player id, so two
 * ids that both claimed the same folded name both survive in it, and grouping by value
 * surfaces exactly the pair. That is also why a mismatch between the accepted-claim
 * count and `HLEN(players)` is checked separately: it is the same fault seen from the
 * other side.
 */
async function auditPlayerStore(redis: Redis, accepted: number): Promise<void> {
  const players = (await redis.hgetall(PLAYERS_KEY)) ?? {};
  const reverse = (await redis.hgetall(PLAYER_IDS_KEY)) ?? {};

  const playerCount = Object.keys(players).length;
  const idCount = Object.keys(reverse).length;

  record(
    playerCount === accepted,
    "every accepted claim is in the players hash",
    `${accepted} claim(s) accepted, ${playerCount} name(s) stored` +
      (playerCount === accepted
        ? ""
        : " — a shortfall means one claim overwrote another, which is the lost race")
  );

  const idsByName = new Map<string, string[]>();
  for (const [id, folded] of Object.entries(reverse)) {
    const key = String(folded);
    idsByName.set(key, [...(idsByName.get(key) ?? []), id]);
  }

  const duplicates = [...idsByName.entries()].filter(([, ids]) => ids.length > 1);

  record(
    duplicates.length === 0,
    "no two players hold the same folded name",
    duplicates.length === 0
      ? `${idCount} player id(s) map to ${idsByName.size} distinct folded name(s)`
      : duplicates
          .map(([name, ids]) => `"${name}" held by ${ids.length} ids`)
          .join("; ") +
          " — THIS IS THE FAILURE THE CLAIM SCRIPT EXISTS TO PREVENT. Stop and read " +
          "the Phase 5 implementation note before patching anything."
  );
}

/**
 * All N devices claim a name at once, then a few claim a name that differs from an
 * already-taken one only by case, diacritics and spacing.
 *
 * Returns the number of accepted claims, which the caller checks against the count the
 * next host action embeds in its published snapshot.
 */
async function runJoinBurst(config: Config, redis: Redis): Promise<number> {
  if (config.clients === 0) {
    note("join burst", "0 clients — skipped");
    return 0;
  }

  const startedAt = performance.now();
  const results = await Promise.all(
    Array.from({ length: config.clients }, (_, index) =>
      joinOnce(config, index, rehearsalName(index))
    )
  );
  const wallClockMs = performance.now() - startedAt;

  const accepted = results.filter((result) => result.status === 200);
  const rejected = results.filter((result) => result.status !== 200);

  record(
    accepted.length === config.clients,
    "join burst accepted every claim",
    `${accepted.length}/${config.clients} in ${Math.round(wallClockMs)} ms wall clock`
  );

  reportDistribution("join round trip", results.map((result) => result.ms));

  if (rejected.length > 0) {
    const byReason = new Map<string, number>();
    for (const result of rejected) {
      const reason = `${result.status} ${result.error ?? "no detail"}`;
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }
    for (const [reason, count] of byReason) note("join rejected", `${count}× ${reason}`);
  }

  // Every accepted claim must have come back with a distinct player id. Two devices
  // handed the same id would be one device as far as every later slice is concerned.
  const ids = new Set(accepted.map((result) => result.playerId));
  record(
    ids.size === accepted.length && !ids.has(null),
    "every accepted claim got a distinct player id",
    `${ids.size} distinct id(s) across ${accepted.length} acceptance(s)`
  );

  /**
   * The collision probe. Deliberately run *after* the burst rather than inside it: the
   * burst's own names are distinct by construction, so it tests concurrency and not the
   * fold, and mixing the two would leave a fold regression indistinguishable from a
   * race.
   */
  const probeCount = Math.min(5, accepted.length);
  if (probeCount > 0) {
    const probes = await Promise.all(
      accepted
        .slice(0, probeCount)
        .map((result) => joinOnce(config, result.index, collisionName(result.index)))
    );

    const allRejected = probes.every((probe) => probe.status === 409);
    record(
      allRejected,
      "collision probe rejected 100% of the time",
      allRejected
        ? `${probes.length}/${probes.length} variants refused as taken ` +
            `(e.g. "${collisionName(accepted[0]!.index)}" vs "${rehearsalName(accepted[0]!.index)}")`
        : probes
            .map((probe) => `${probe.status} for "${collisionName(probe.index)}"`)
            .join("; ") +
            " — a variant that is not refused means the fold is not being applied, and " +
            "two people can appear on the leaderboard under the same name"
    );
  }

  await auditPlayerStore(redis, accepted.length);

  const target = 30_000;
  record(
    wallClockMs < target,
    "join burst inside the 30 s target",
    `${Math.round(wallClockMs)} ms against ${target} ms (PRD FR-002)`
  );
  note(
    "what this figure is not",
    "the claim round trip from one process on one network — not a phone painting a " +
      "screen, and not a venue network. FR-002 is informed by this, not proven by it"
  );

  return accepted.length;
}

/** Waits until every connected device holds `version`, or the timeout expires. */
async function awaitArrivals(devices: Device[], version: number): Promise<void> {
  const deadline = performance.now() + ARRIVAL_TIMEOUT_MS;
  // Killed devices are excluded from the *wait* but not from the counts below:
  // waiting on a device we deliberately closed would burn the full timeout on
  // every action and prove nothing. If one arrives anyway, it is still counted.
  const connected = devices.filter((device) => device.connected && !device.killed);

  while (performance.now() < deadline) {
    if (connected.every((device) => device.arrivals.has(version))) return;
    // In-process polling of local state. Note that no device polls
    // `/api/quiz/state` — the design is push, and a harness that polled would
    // measure a different system than the one being shipped.
    await sleep(10);
  }
}

/** Nearest-rank, on an already-sorted ascending array. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1] ?? Number.NaN;
}

type Measurement = {
  label: string;
  outcome: ActionOutcome;
  /** Discarded figures are still taken and still printed — just not counted. */
  discarded: boolean;
  /** End-to-end deltas in ms, click → snapshot arrival, ascending. */
  deltas: number[];
  received: number;
  connected: number;
};

/**
 * Fires one host action and collects what the room saw.
 *
 * The end-to-end anchor is `outcome.clickedAt`, taken inside `hostAction` *before* the
 * request leaves. Arrivals can and do land before the HTTP response returns, which is
 * why each device records arrivals keyed by version as they happen rather than being
 * asked for one after the fact.
 */
async function measureAction(
  config: Config,
  verb: HostVerb,
  devices: Device[],
  options: { discarded?: boolean; label?: string } = {}
): Promise<Measurement> {
  const discarded = options.discarded ?? false;
  const label = options.label ?? verb;
  const outcome = await hostAction(config, verb);

  const applied = outcome.status === 200 && outcome.applied === true;
  record(applied, `host action: ${label}`, describeOutcome(outcome));

  if (outcome.region && outcome.region !== "fra1") {
    note(
      "function region",
      `${outcome.region} — not fra1. A figure from this deployment measures the wrong ` +
        "region and must not be recorded as the baseline (roadmap F-04)"
    );
  }

  const connected = devices.filter((device) => device.connected);
  const deltas: number[] = [];

  // An action the store declined published nothing, so there is no version to wait for
  // and no arrival to measure. Counting it would report fan-out for a snapshot that
  // never went out.
  if (applied && outcome.version !== null) {
    await awaitArrivals(devices, outcome.version);

    for (const device of connected) {
      const at = device.arrivals.get(outcome.version);
      if (at !== undefined) deltas.push(at - outcome.clickedAt);
    }
  }

  deltas.sort((a, b) => a - b);

  return {
    label,
    outcome,
    discarded,
    deltas,
    received: deltas.length,
    connected: connected.length,
  };
}

function reportMeasurement(measurement: Measurement, total: number): void {
  const { deltas, outcome } = measurement;
  const prefix = measurement.discarded ? "  [discarded] " : "  ";
  const version = outcome.version === null ? "—" : `v${outcome.version}`;

  if (deltas.length === 0) {
    console.log(
      `${prefix}${measurement.label.padEnd(9)} ${version.padEnd(4)} ` +
        `no arrivals — ${measurement.connected}/${total} connected, 0 received`
    );
    return;
  }

  const p95 = Math.round(percentile(deltas, 0.95));
  const median = Math.round(percentile(deltas, 0.5));
  const max = Math.round(deltas[deltas.length - 1] ?? Number.NaN);

  // Nearest rank puts p95 at `ceil(0.95n)`, which is `n` for every n <= 20 — so below
  // that the "p95" is literally the max, and printing both as if they were two figures
  // invites a small smoke run's number into a table of room-scale ones. Label it for
  // what it is instead.
  const tailLabel = deltas.length >= MIN_TAIL_SAMPLES ? "p95" : "max*";

  console.log(
    `${prefix}${measurement.label.padEnd(9)} ${version.padEnd(4)} ` +
      `e2e ${tailLabel} ${String(p95).padStart(5)} ms   median ${String(median).padStart(5)} ms   ` +
      `max ${String(max).padStart(5)} ms   rtt ${String(Math.round(outcome.roundTripMs)).padStart(5)} ms   ` +
      `received ${measurement.received}/${measurement.connected} connected of ${total}` +
      `   n=${deltas.length}`
  );
}

/**
 * The run: connect, warm up, measure, report.
 *
 * **The ordering is the design.** Clients connect *before* `start`, so the lobby
 * snapshot reaches them over the channel they are already subscribed to. That gives the
 * barrier the plan asks for — every client is connected and holding the lobby snapshot
 * before the first measured action — without a single `/api/quiz/state` fetch per
 * device. `start` doubles as the warm-up: it is the first action, so it pays the
 * function's cold start, which is not fan-out cost. Its figures are taken and printed
 * but explicitly discarded, because a silently dropped sample is indistinguishable from
 * a flattering one.
 */
async function runRehearsal(
  config: Config,
  devices: Device[],
  redis: Redis
): Promise<boolean> {
  const warmUp = await measureAction(config, "start", devices, {
    discarded: true,
    label: "start",
  });

  if (devices.length > 0) {
    const holding = devices.filter(
      (device) => device.connected && warmUp.outcome.version !== null &&
        device.arrivals.has(warmUp.outcome.version)
    ).length;
    record(
      holding === warmUp.connected && warmUp.connected > 0,
      "barrier: every connected device holds the lobby snapshot",
      `${holding}/${warmUp.connected} connected device(s)`
    );
  }

  /**
   * The join stage sits here on purpose: after `start`, because a claim against no
   * session is refused, and before the flow verbs, because the count only reaches the
   * room on a host action — so the first `advance` below is what carries it, and its
   * snapshot is where the injection can be checked end to end.
   */
  console.log("\nJoin burst:\n");
  const accepted = await runJoinBurst(config, redis);

  killDevices(config, devices);

  const measurements: Measurement[] = [warmUp];

  // Two questions' worth of the real rhythm: open, reveal, open, reveal.
  for (const verb of ["advance", "reveal", "advance", "reveal"] as const) {
    measurements.push(await measureAction(config, verb, devices));
  }

  /**
   * The count the room actually received, against the count the store actually holds.
   *
   * This is the only place §5's injection is tested against reality. `host.test.ts`
   * pins that the published count differs from the one on `current`, but a mock cannot
   * show that the number reaching 150 devices is the number in the hash — and the
   * failure mode there is silent: the type system cannot see a count that is read fresh
   * and then discarded.
   */
  if (accepted > 0) {
    const published = measurements
      .map((measurement) => measurement.outcome.playerCount)
      .filter((count): count is number => count !== null);
    const last = published[published.length - 1];

    record(
      last === accepted,
      "the published snapshot carries the real join count",
      last === undefined
        ? "no action published a count"
        : `${last} in the last published snapshot, ${accepted} accepted claim(s)`
    );
  }

  console.log("\nPer-action figures (end to end = click → snapshot arrival, one clock):\n");
  for (const measurement of measurements) reportMeasurement(measurement, config.clients);

  const counted = measurements.filter((measurement) => !measurement.discarded);
  const withArrivals = counted.filter((measurement) => measurement.deltas.length > 0);

  /**
   * An action that reached nobody must fail the run, not vanish from the statistic.
   *
   * `worstP95` below is a max over `withArrivals`, so without this an action with zero
   * arrivals contributes nothing and nothing else objects: a run where `advance`
   * reached no device and the other three actions were fine would print `Verdict: PASS`
   * and exit 0. The all-actions-empty case was already caught; this is the per-action
   * case, which is the one that would actually happen.
   */
  for (const measurement of counted) {
    if (measurement.deltas.length > 0) continue;
    // An action the store declined published nothing, so there was never a snapshot to
    // wait for — that is reported as a note below, not as a lost broadcast.
    if (measurement.outcome.note !== null || measurement.outcome.applied !== true) continue;

    record(
      false,
      `no device received ${measurement.label}`,
      `${measurement.connected} device(s) were connected and none received the ` +
        `published version — this is a total fan-out failure for one action, and it is ` +
        `excluded from the p95 by construction`
    );
  }

  const stale = counted.filter((measurement) => measurement.outcome.note !== null);
  for (const measurement of stale) {
    note(
      `${measurement.label} was not a measured action`,
      `the store reported "${measurement.outcome.note}" — nothing was published, so it ` +
        "contributes no figures"
    );
  }

  // The check that makes the fault injection worth having. Eyeballing "received
  // 147/150" would pass a run in which the killed devices were quietly dropped
  // from the denominator instead; this asserts the arithmetic.
  const killed = devices.filter((device) => device.killed);
  if (killed.length > 0) {
    const perAction = counted.map((measurement) => {
      // A killed device can still deliver a message buffered before `close()` took
      // effect, and `awaitArrivals` counts it when it does. So the expected miss floor
      // is the killed count *minus* however many of them actually arrived — otherwise
      // one late message fails the run with a message accusing the code of shrinking
      // the denominator, which is the opposite of what happened.
      const lateArrivals =
        measurement.outcome.version === null
          ? 0
          : killed.filter((device) => device.arrivals.has(measurement.outcome.version!)).length;

      return {
        label: measurement.label,
        missing: measurement.connected - measurement.received,
        expected: killed.length - lateArrivals,
        lateArrivals,
      };
    });

    const allAccounted = perAction.every((entry) => entry.missing >= entry.expected);
    const totalLate = perAction.reduce((sum, entry) => sum + entry.lateArrivals, 0);

    record(
      allAccounted,
      "killed devices are reported as misses",
      allAccounted
        ? `${killed.length} killed; every measured action reports at least that many ` +
            `missing out of ${counted[0]?.connected ?? 0} still counted as connected` +
            (totalLate > 0
              ? ` (${totalLate} buffered arrival(s) from killed devices counted, and ` +
                "subtracted from the expected floor)"
              : "")
        : `${killed.length} killed, but some action reported fewer misses than expected — ` +
            perAction
              .map((entry) => `${entry.label}: ${entry.missing} missing vs ${entry.expected} expected`)
              .join(", ") +
            ". They are being excluded from the denominator rather than counted as lost."
    );
  }

  const droppedNotNewer = devices.reduce((sum, device) => sum + device.droppedNotNewer, 0);
  if (droppedNotNewer > 0) {
    note(
      "snapshots dropped by the client rule",
      `${droppedNotNewer} — not newer than the version already held, exactly as a real ` +
        "device drops them"
    );
  }

  if (config.clients === 0) {
    console.log("\nVerdict: not measured — the run had no simulated devices.\n");
    return true;
  }

  if (withArrivals.length === 0) {
    console.log(
      `\nVerdict: FAILED — no measured action reached a single device. ` +
        "Nothing here is a latency figure; find out why before reading anything else.\n"
    );
    return false;
  }

  const worstP95 = Math.max(
    ...withArrivals.map((measurement) => percentile(measurement.deltas, 0.95))
  );
  const passed = worstP95 < BUDGET_MS;
  const smallestSample = Math.min(...withArrivals.map((m) => m.deltas.length));
  const tailName = smallestSample >= MIN_TAIL_SAMPLES ? "p95" : "slowest arrival";

  console.log(
    `\nVerdict: ${passed ? "PASS" : "FAIL"} — worst end-to-end ${tailName} across measured ` +
      `actions is ${Math.round(worstP95)} ms against a ${BUDGET_MS} ms budget.\n\n` +
      "  This is a LOWER BOUND. One process on one network is not a room of phones:\n" +
      "  if it fails here, real devices are worse; if it passes, that is not proof the\n" +
      "  venue network passes.\n\n" +
      "  ONE RUN IS NOT A BASELINE. Run-to-run spread has been measured at over 5x on\n" +
      "  this figure, so a single number recorded from a single run will be wrong within\n" +
      "  hours. Record a range across several runs — see rehearsal-report.md.\n"
  );

  return passed;
}

async function main(): Promise<void> {
  console.log("\nRoom-scale rehearsal harness (F-04).\n");

  const config = resolveConfig();
  if (!config) process.exit(1);

  console.log(`\n  Target: ${config.baseUrl}\n`);

  const redis = new Redis({ url: config.redisUrl, token: config.redisToken });

  if (!(await preflight(config, redis))) process.exit(1);

  const devices = await connectPool(config);
  let verdict = false;

  try {
    verdict = await runRehearsal(config, devices, redis);
  } finally {
    // Always, including after a thrown request. A rehearsal that leaves state behind
    // blocks the next one on a pre-flight refusal that means nothing.
    // `closePool` gets its own `finally` so a thrown teardown cannot strand 150 sockets.
    try {
      await teardown(config);
    } finally {
      await closePool(devices);
    }
  }

  const failed = findings.filter((finding) => !finding.ok);
  console.log(`${findings.length - failed.length}/${findings.length} checks passed.\n`);

  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const finding of failed) console.log(`  - ${finding.label}`);
    console.log("");
  }

  if (failed.length > 0 || !verdict) process.exit(1);

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
