import { Redis } from "@upstash/redis";

import { SESSION_KEY } from "./keys";
import { logSessionEvent } from "./log";
import { initialSessionState, parseSessionState, type SessionState } from "./state";

/**
 * The authoritative session store (roadmap F-02).
 *
 * One session, one key, one JSON document — PRD §Non-Goals settles that there is
 * never more than one session, one quiz, one room. Nothing outside this file
 * constructs a Redis client or knows the key name.
 *
 * The transport does not hold truth. Ably carries snapshots; this is where they
 * come from.
 */

/**
 * Re-exported so every importer since F-02 keeps working unchanged. The name is
 * now declared in `keys.ts` alongside every other namespaced name — see that
 * module for why the registry exists and what `keys.test.ts` enforces about it.
 */
export { SESSION_KEY };

/**
 * Four hours, re-armed on every accepted write.
 *
 * Long enough that a ~15-minute segment cannot expire under a host who stalls,
 * pauses for a sponsor slot, or sets up early; short enough that an abandoned
 * session — the realistic stage outcome, since a host may never click "end" —
 * purges itself the same evening. That is what makes the PRD's retention
 * guardrail hold by default rather than depending on F-03 shipping.
 */
export const SESSION_TTL_SECONDS = 4 * 60 * 60;

/**
 * Ten minutes, armed by `end` in place of the four-hour lifetime.
 *
 * The window exists for one reason: a device that reloads just after the host
 * closes the segment should still find the final standings rather than an empty
 * screen. Ten minutes covers a reload, a photo of the leaderboard, and the walk
 * back to a seat.
 *
 * It is also, deliberately, data retained after a session has ended — which on a
 * strict reading of the PRD's retention guardrail is a deviation rather than a
 * satisfaction. That is a considered tradeoff, recorded as such in `prd.md`, and
 * it is why `purge` exists as an immediate escape hatch for a host who wants the
 * room's data gone now rather than in ten minutes.
 */
export const ENDED_TTL_SECONDS = 10 * 60;

export type ReadResult =
  | { outcome: "ok"; state: SessionState | null }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "invalid"; problems: string[] }
  | { outcome: "failed"; reason: string };

export type WriteResult =
  | { outcome: "applied"; state: SessionState }
  | { outcome: "stale"; version: number }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

export type CreateResult =
  | { outcome: "created"; state: SessionState }
  | { outcome: "exists"; state: SessionState }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "invalid"; problems: string[] }
  | { outcome: "failed"; reason: string };

/**
 * THE VERSION GUARD — this must stay a single `EVAL`.
 *
 * Upstash speaks HTTP request/response, so a `GET`, a mutation in JavaScript and
 * a `SET` are three round trips with no isolation between them. Two host actions
 * arriving within the same few milliseconds would both read version n and both
 * write n+1, and one would be silently lost — the room stays a question behind
 * while the host believes it advanced. Doing the comparison here instead means
 * the store serializes it.
 *
 * The TTL re-arm is inside the same script for the same reason: a separate
 * `EXPIRE` is another round trip that can fail on its own and leave the session
 * immortal, which would quietly break the retention guardrail.
 *
 * If you are about to move this logic into TypeScript because it would be easier
 * to read: `store.test.ts` asserts this is one `eval` call, and that test exists
 * to stop exactly that change. See the plan's Critical Implementation Details.
 *
 * KEYS[1] = session key
 * ARGV[1] = expected version
 * ARGV[2] = next state as JSON
 * ARGV[3] = ttl seconds
 * Returns { 1, storedVersion } when applied, { 0, currentVersion } when rejected,
 * and { -1, 0 } when there is no session to write over.
 */
const COMPARE_AND_SET = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return { -1, 0 }
end

local current = cjson.decode(raw)
local expected = tonumber(ARGV[1])

if tonumber(current.version) ~= expected then
  return { 0, tonumber(current.version) }
end

local next = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return { 1, tonumber(next.version) }
`;

/**
 * Create-if-absent, atomically, so a host who taps start twice — or two hosts on
 * two devices — cannot reset a session that is already running. Phase 3's `start`
 * verb is idempotent because of this script, not because of a check-then-write in
 * the route.
 *
 * KEYS[1] = session key
 * ARGV[1] = initial state as JSON
 * ARGV[2] = ttl seconds
 * Returns { 1, json } when it created the session, { 0, json } when one existed.
 */
const CREATE_IF_ABSENT = `
local raw = redis.call('GET', KEYS[1])
if raw then
  return { 0, raw }
end

redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return { 1, ARGV[1] }
`;

/**
 * Read credentials from `import.meta.env`, per the project's convention
 * (`src/lib/newsletter.ts`, CLAUDE.md) — deliberately not `Redis.fromEnv()`,
 * which reads `process.env` and would work under bare `bun` while returning
 * nothing inside the Astro build.
 *
 * The names are `KV_REST_API_*` because that is what the Vercel Marketplace
 * integration actually injects — verified by `scripts/probe-spine-config.ts`,
 * *not* the `UPSTASH_REDIS_REST_*` pair the documentation predicts. Both are
 * accepted here so a differently-provisioned environment still works, but the
 * observed pair is checked first.
 */
function credentials(): { url: string; token: string } | null {
  // An env var set to the empty string is "absent", not "present but blank" —
  // both Vercel's store and a pulled `.env` can produce one. `??` alone would
  // treat "" as a value and never reach the fallback pair.
  const read = (name: string): string | undefined => {
    const value = import.meta.env[name];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  };

  const url = read("KV_REST_API_URL") ?? read("UPSTASH_REDIS_REST_URL");
  const token = read("KV_REST_API_TOKEN") ?? read("UPSTASH_REDIS_REST_TOKEN");

  if (!url || !token) return null;
  return { url, token };
}

/**
 * Built per call rather than once at module scope. The client is a thin HTTP
 * wrapper with no connection to pool, and this keeps the module importable — by
 * `vitest`, and by anything that reads the exported constants — without
 * configuration present.
 */
function client(): Redis | null {
  const config = credentials();
  if (!config) return null;
  return new Redis({ url: config.url, token: config.token });
}

const UNCONFIGURED_REASON =
  "KV_REST_API_URL and KV_REST_API_TOKEN must both be set to run a session";

function unconfigured(): { outcome: "unconfigured"; reason: string } {
  // Warn rather than throw — the `src/lib/slack.ts` posture. The caller decides
  // what the host sees; a request path must never take a config error as a crash.
  logSessionEvent("session.unconfigured", { reason: UNCONFIGURED_REASON });
  return { outcome: "unconfigured", reason: UNCONFIGURED_REASON };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The store holds JSON strings, but `@upstash/redis` deserializes them for you —
 * `automaticDeserialization` defaults to `true`. Depending on that default
 * silently would mean every read failing as "invalid state" if it ever changed, or
 * if a future client were constructed with it off. Accept either shape instead,
 * matching what `createSession` already does with the value its Lua script
 * returns.
 */
function asDocument(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    // Leave it as a string — the schema parse below reports it properly rather
    // than this function inventing an error message.
    return raw;
  }
}

/** The current session, or `ok` with `null` when none exists. */
export async function readSession(): Promise<ReadResult> {
  const redis = client();
  if (!redis) return unconfigured();

  let raw: unknown;
  try {
    raw = await redis.get(SESSION_KEY);
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  if (raw === null || raw === undefined) return { outcome: "ok", state: null };

  const parsed = parseSessionState(asDocument(raw));
  if (!parsed.ok) {
    logSessionEvent("session.read.invalid", { reason: parsed.problems.join("; ") });
    return { outcome: "invalid", problems: parsed.problems };
  }

  return { outcome: "ok", state: parsed.state };
}

/**
 * Creates the lobby document if no session exists, and returns the existing one
 * if it does. Never overwrites — resetting a live session is not something a
 * double-tapped start button should be able to do.
 */
export async function createSession(now: number): Promise<CreateResult> {
  const redis = client();
  if (!redis) return unconfigured();

  const initial = initialSessionState(now);

  let result: [number, unknown] | null;
  try {
    result = await redis.eval<[string, string], [number, unknown]>(
      CREATE_IF_ABSENT,
      [SESSION_KEY],
      [JSON.stringify(initial), String(SESSION_TTL_SECONDS)]
    );
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const created = Number(result?.[0]) === 1;
  const parsed = parseSessionState(asDocument(result?.[1]));

  if (!parsed.ok) {
    logSessionEvent("session.read.invalid", { reason: parsed.problems.join("; ") });
    return { outcome: "invalid", problems: parsed.problems };
  }

  if (created) {
    logSessionEvent("session.created", {
      version: parsed.state.version,
      phase: parsed.state.phase,
    });
    return { outcome: "created", state: parsed.state };
  }

  return { outcome: "exists", state: parsed.state };
}

/**
 * Compare-and-set. `next` must already carry `expectedVersion + 1` — the version
 * is the caller's statement of what it believes it is replacing, and the store's
 * job is only to agree or refuse.
 *
 * A `stale` result is not an error. The realistic cause is a host double-tapping
 * on stage, where the second tap is a no-op and the room is already where they
 * wanted it. Phase 3 renders it as "already applied", never as plain success.
 */
export async function writeSession(
  expectedVersion: number,
  next: SessionState
): Promise<WriteResult> {
  const redis = client();
  if (!redis) return unconfigured();

  // Validate on the way out as well as on the way in: this is the last point at
  // which a state that breaks its own invariants can be stopped from becoming
  // the thing 150 devices render.
  const validated = parseSessionState(next);
  if (!validated.ok) {
    return { outcome: "failed", reason: validated.problems.join("; ") };
  }

  if (next.version !== expectedVersion + 1) {
    return {
      outcome: "failed",
      reason: `next.version must be expectedVersion + 1 (got ${next.version}, expected ${expectedVersion + 1})`,
    };
  }

  let result: [number, number] | null;
  try {
    result = await redis.eval<[string, string, string], [number, number]>(
      COMPARE_AND_SET,
      [SESSION_KEY],
      [String(expectedVersion), JSON.stringify(next), String(SESSION_TTL_SECONDS)]
    );
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const status = Number(result?.[0]);

  if (status === -1) {
    return { outcome: "failed", reason: "no session exists to update" };
  }

  if (status === 0) {
    const current = Number(result?.[1]);
    logSessionEvent("session.action.stale", { version: current });
    return { outcome: "stale", version: current };
  }

  logSessionEvent("session.action.applied", {
    version: next.version,
    phase: next.phase,
    questionId: next.currentQuestionId,
  });
  return { outcome: "applied", state: next };
}
