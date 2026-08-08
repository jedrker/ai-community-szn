import { Redis } from "@upstash/redis";

import {
  answerField,
  answerRecordSchema,
  parseAnswerRecord,
  type AnswerRecord,
} from "./answers";
import {
  ANSWERS_KEY,
  PLAYER_IDS_KEY,
  PLAYERS_KEY,
  registeredKeys,
  SCORES_KEY,
  SESSION_KEY,
} from "./keys";
import { logSessionEvent } from "./log";
import { parsePlayerRecord, type PlayerRecord } from "./players";
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
const VERSION_GUARD = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return { -1, 0 }
end

local current = cjson.decode(raw)
local expected = tonumber(ARGV[1])

if tonumber(current.version) ~= expected then
  return { 0, tonumber(current.version) }
end
`;

const COMPARE_AND_SET =
  VERSION_GUARD +
  `
local next = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
return { 1, tonumber(next.version) }
`;

/**
 * End: the same guard, plus every other registered key moved onto the short
 * lifetime (roadmap F-03).
 *
 * The loop is not an oversight. `DEL` accepts a key list but **`EXPIRE` takes
 * exactly one key**, so re-arming N keys means N `EXPIRE` calls — which is fine,
 * because they happen inside one `EVAL` and therefore one round trip. The round
 * trip is the expense, not the command count inside it. Doing this as N separate
 * `EXPIRE` requests from TypeScript is what would be wrong: any one of them can
 * fail on its own and leave a key holding attendee data on the four-hour
 * lifetime, with a success response already on the wire.
 *
 * `EXISTS` before `EXPIRE` so a key that was never written does not make the
 * count misleading; `EXPIRE` on a missing key is harmless but silent.
 *
 * KEYS[1] = session key, KEYS[2..n] = the other registered keys
 * ARGV[1] = expected version, ARGV[2] = ended state JSON, ARGV[3] = ended ttl
 */
const COMPARE_AND_END =
  VERSION_GUARD +
  `
local next = cjson.decode(ARGV[2])
redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))

for i = 2, #KEYS do
  if redis.call('EXISTS', KEYS[i]) == 1 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[3]))
  end
end

return { 1, tonumber(next.version) }
`;

/**
 * Purge: remove every registered key, in one call (roadmap F-03).
 *
 * `DEL` does take a key list, so this is a single command over `unpack(KEYS)`
 * rather than a loop. It returns how many keys actually existed, which is what
 * lets the caller distinguish "purged a live session" from "there was nothing
 * there" — the second is a normal outcome for residue cleanup, not an error.
 *
 * Deliberately unguarded by version: `purge` is the escape hatch, and the
 * confirmation check that protects it lives at the route, where it can produce a
 * proper rejection rather than a silent no-op.
 */
const PURGE_ALL = `
return redis.call('DEL', unpack(KEYS))
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
 * THE NAME CLAIM — this must stay a single `EVAL`, for the same reason the version
 * guard must (roadmap S-02, and F-02's delivery lesson).
 *
 * ~150 devices claim names within the same few seconds. Resolving that with a
 * `HEXISTS` in one round trip and an `HSET` in another hands two attendees the same
 * name whenever the gap between them catches another claim — and the leaderboard stops
 * being unambiguous, which is the single guarantee FR-008 exists to provide. A
 * JavaScript guard passes every mocked test in this repository and fails in the room.
 *
 * The phase check is inside the script for the same reason and not for tidiness: read
 * outside, it would be a check against a session that could end before the claim
 * lands.
 *
 * Joining is allowed in `lobby`, `question-open` and `question-revealed`. The drafted
 * quiz's Q2 is literally the last-chance-to-join beat, so latecomers are the design,
 * not an edge case. `ended` is refused — and stated as its own branch rather than
 * folded into a truthy check, because `ended` and `lobby` are the two phases that both
 * carry a null `currentQuestionId` and mean opposite things (F-03's lesson).
 *
 * Both TTLs are armed here, in the same script, for the reason the other scripts
 * document: a separate `EXPIRE` is another round trip that can fail on its own and
 * leave a key holding attendee data on no lifetime at all.
 *
 * **The session document is returned, not just consulted.** The script has to `GET`
 * it to check the phase, and a joining device needs exactly that document to render
 * the host's current question. Reading it here and again from TypeScript would double
 * the store cost of the one path that scales with room size — ~300 commands per
 * 150-device room instead of ~150 — and the second read could only be *staler* than
 * the claim it accompanies. Returning it also means the state a device receives is
 * provably the state its claim was checked against.
 *
 * KEYS[1] = session doc, KEYS[2] = players hash, KEYS[3] = player-ids hash
 * ARGV[1] = folded name, ARGV[2] = record JSON, ARGV[3] = player id, ARGV[4] = ttl
 * Returns { 1, playerCount, sessionJson } on a claim, { 0, 0, sessionJson } when the
 * name is taken, { -1, 0, false } when there is no session, and
 * { -2, 0, sessionJson } when the session has ended.
 */
const CLAIM_PLAYER = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return { -1, 0, false }
end

if cjson.decode(raw).phase == 'ended' then
  return { -2, 0, raw }
end

if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then
  return { 0, 0, raw }
end

redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[3], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))

return { 1, redis.call('HLEN', KEYS[2]), raw }
`;

/**
 * Look a player up by the id their device stored.
 *
 * **Read-only, and an `EVAL` for the round trip rather than for any guard** — worth
 * saying, because every other script in this file is an `EVAL` because it needs
 * atomicity, and a reader who assumes the same of this one will be looking for an
 * invariant that isn't here. Two `HGET`s in one trip; nothing is being protected.
 *
 * Returns the session document alongside the record, for the reason `CLAIM_PLAYER`
 * does: a returning device needs both, and fetching the session separately would
 * double the cost of the reload path.
 *
 * KEYS[1] = player-ids hash, KEYS[2] = players hash, KEYS[3] = session doc
 * ARGV[1] = player id
 * Returns { recordJson, sessionJson }, or { false, sessionJson } when the id is
 * unknown. `sessionJson` is itself `false` when no session exists.
 */
const READ_PLAYER_BY_ID = `
local session = redis.call('GET', KEYS[3])
if not session then
  session = false
end

local key = redis.call('HGET', KEYS[1], ARGV[1])
if not key then
  return { false, session }
end

return { redis.call('HGET', KEYS[2], key), session }
`;

/**
 * THE SUBMISSION — one answer per player per question, recorded and scored
 * indivisibly (roadmap S-03, PRD FR-004/FR-010).
 *
 * Same shape as `CLAIM_PLAYER` and for the same reasons: the phase check is inside the
 * script because a check read outside it is a check against a session that can advance
 * before the write lands, and both TTLs are armed inside it because a separate `EXPIRE`
 * is another round trip that can fail on its own and leave attendee data on no lifetime
 * at all. `end` re-arms only keys that exist when the host ends, so between the first
 * answer and the next host action these two keys are covered by nothing else.
 *
 * **`HSETNX` is what makes the first answer final** (FR-004: no changes before the
 * reveal). The lock and the write are one operation, so there is no window a second
 * submission can slip through — which a `HEXISTS` followed by an `HSET` would have,
 * and which two fast taps on one phone would find.
 *
 * **The question-id check is not redundant with the phase check.** A phone that submits
 * as the host advances is still in `question-open`; without comparing ids, its answer
 * would be recorded against the question that just opened, scored with an elapsed time
 * measured on the previous one.
 *
 * **Seven commands are billed per submission**: this `EVAL` plus six `redis.call`s on
 * the accepted path (`GET`, `HEXISTS`, `HSETNX`, `HINCRBY`, 2× `EXPIRE`). Upstash bills
 * the script *and* every call inside it (`command-counter-diagnostic.md`), and this is
 * the first path in the project that runs once per attendee per question — 150 × 14 of
 * them in a real event. That number is stated here because Phase 5 prices it: an edit
 * that adds a call is an edit to the event's cost, and should know it is being watched.
 *
 * KEYS[1] = session doc, KEYS[2] = answers hash, KEYS[3] = scores hash,
 * KEYS[4] = player-ids hash
 * ARGV[1] = answer field, ARGV[2] = record JSON, ARGV[3] = player id,
 * ARGV[4] = question id, ARGV[5] = awarded, ARGV[6] = ttl
 * Returns { 1, total }  accepted
 *         { 0, 0 }      already answered this question
 *         { -1, 0 }     no session
 *         { -2, 0 }     question not open, or a different question is open
 *         { -3, 0 }     unknown player id
 */
const SUBMIT_ANSWER = `
local raw = redis.call('GET', KEYS[1])
if not raw then
  return { -1, 0 }
end

local session = cjson.decode(raw)
if session.phase ~= 'question-open' or session.currentQuestionId ~= ARGV[4] then
  return { -2, 0 }
end

if redis.call('HEXISTS', KEYS[4], ARGV[3]) == 0 then
  return { -3, 0 }
end

if redis.call('HSETNX', KEYS[2], ARGV[1], ARGV[2]) == 0 then
  return { 0, 0 }
end

local total = redis.call('HINCRBY', KEYS[3], ARGV[3], tonumber(ARGV[5]))
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[6]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))

return { 1, total }
`;

/**
 * One device's own result for one question, plus the session document to gate it
 * against.
 *
 * **Read-only, and an `EVAL` for the round trip rather than for any guard** — the same
 * note `READ_PLAYER_BY_ID` carries, and worth repeating because every *other* script in
 * this file is an `EVAL` because it needs atomicity. Nothing here is being protected; a
 * reader looking for the invariant will not find one.
 *
 * The session document comes back because the caller has to refuse anything but
 * `question-revealed` before it hands a correctness verdict to a phone — served while
 * the question is open, this endpoint is a cheat sheet anyone can `curl`. Reading the
 * document separately would be a second round trip on the fan-in path, 150 devices wide.
 *
 * Four commands billed: this `EVAL` plus `GET`, `HGET`, `HGET`.
 *
 * KEYS[1] = session doc, KEYS[2] = answers hash, KEYS[3] = scores hash
 * ARGV[1] = answer field, ARGV[2] = player id
 * Returns { sessionJson, answerJson, total }, each `false` when absent.
 */
const READ_ANSWER = `
local session = redis.call('GET', KEYS[1])
if not session then
  session = false
end

local answer = redis.call('HGET', KEYS[2], ARGV[1])
if not answer then
  answer = false
end

local total = redis.call('HGET', KEYS[3], ARGV[2])
if not total then
  total = false
end

return { session, answer, total }
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

/**
 * Ends the session (roadmap F-03).
 *
 * Same contract as `writeSession` — same guard, same outcome union, same
 * caller-states-the-version discipline — with one addition: every other
 * registered key is moved onto `ENDED_TTL_SECONDS` in the same `EVAL`, so the
 * whole namespace expires together rather than the document expiring while the
 * data beside it sits on the four-hour lifetime.
 *
 * This is deliberately a *shortened* lifetime, not a deletion. A device that
 * reloads in the minutes after the host closes the segment should still find the
 * final standings. `purgeSession` is the immediate path for a host who wants the
 * room's data gone now.
 */
export async function endSession(
  expectedVersion: number,
  next: SessionState
): Promise<WriteResult> {
  const redis = client();
  if (!redis) return unconfigured();

  const validated = parseSessionState(next);
  if (!validated.ok) {
    return { outcome: "failed", reason: validated.problems.join("; ") };
  }

  if (next.phase !== "ended") {
    return { outcome: "failed", reason: `endSession requires phase "ended", got "${next.phase}"` };
  }

  if (next.version !== expectedVersion + 1) {
    return {
      outcome: "failed",
      reason: `next.version must be expectedVersion + 1 (got ${next.version}, expected ${expectedVersion + 1})`,
    };
  }

  // Session key first — the script re-arms KEYS[2..n], and treats KEYS[1] as the
  // document it is writing.
  const keys = [SESSION_KEY, ...registeredKeys().filter((key) => key !== SESSION_KEY)];

  let result: [number, number] | null;
  try {
    result = await redis.eval<[string, string, string], [number, number]>(
      COMPARE_AND_END,
      keys,
      [String(expectedVersion), JSON.stringify(next), String(ENDED_TTL_SECONDS)]
    );
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const status = Number(result?.[0]);

  if (status === -1) {
    return { outcome: "failed", reason: "no session exists to end" };
  }

  if (status === 0) {
    const current = Number(result?.[1]);
    logSessionEvent("session.action.stale", { version: current });
    return { outcome: "stale", version: current };
  }

  logSessionEvent("session.ended", { version: next.version, phase: next.phase });
  return { outcome: "applied", state: next };
}

/**
 * Every outcome that had the session document in hand carries it out.
 *
 * `state` is the document the claim was actually checked against — not a later read of
 * it — so a device can never be told "you are in" alongside a state that contradicts
 * the check that let it in. It is `null` only where there genuinely was no session.
 */
export type ClaimResult =
  | { outcome: "claimed"; playerCount: number; state: SessionState | null }
  | { outcome: "taken"; state: SessionState | null }
  | { outcome: "no-session" }
  | { outcome: "closed"; state: SessionState | null }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * Claims a display name for a device (roadmap S-02, PRD FR-007/FR-008).
 *
 * `key` is the folded form from `validateDisplayName` — the uniqueness key — and
 * `record.displayName` is what the attendee typed. The caller is responsible for the
 * fold; this function is responsible for the claim being indivisible.
 *
 * `taken` is not an error. It is the ordinary outcome of two people in a room of 150
 * picking the same first name, and the route renders it as a prompt for a different
 * one rather than as a failure.
 *
 * Publishes nothing. 150 joins publishing 150 snapshots to 150 subscribers is the
 * O(N²) fan-out the spine contract forbids — the count reaches the room on the host's
 * next action instead.
 */
export async function claimPlayer(key: string, record: PlayerRecord): Promise<ClaimResult> {
  const redis = client();
  if (!redis) return unconfigured();

  let result: [number, number, unknown] | null;
  try {
    result = await redis.eval<[string, string, string, string], [number, number, unknown]>(
      CLAIM_PLAYER,
      [SESSION_KEY, PLAYERS_KEY, PLAYER_IDS_KEY],
      [key, JSON.stringify(record), record.id, String(SESSION_TTL_SECONDS)]
    );
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const status = Number(result?.[0]);

  /**
   * The document the script checked, parsed through the same schema every other read
   * goes through. A document that fails to parse becomes `null` rather than an error:
   * the claim itself already succeeded or failed on its own terms, and refusing a
   * joining attendee because the *state* was unreadable would turn a rendering problem
   * into a lockout. The client re-primes from `/api/quiz/state` in that case.
   */
  const state = ((): SessionState | null => {
    const raw = result?.[2];
    if (raw === null || raw === undefined || raw === false) return null;
    const parsed = parseSessionState(asDocument(raw));
    if (!parsed.ok) {
      logSessionEvent("session.read.invalid", { reason: parsed.problems.join("; ") });
      return null;
    }
    return parsed.state;
  })();

  if (status === -1) return { outcome: "no-session" };
  if (status === -2) return { outcome: "closed", state };
  if (status === 0) return { outcome: "taken", state };

  const playerCount = Number(result?.[1]) || 0;

  // Deliberately NOT logged here. The six `session.join.rejected` lines live at the
  // route, and an event family split across two layers means a second caller of this
  // function would inherit success logging for free and no rejection logging at all.
  // `join.ts` emits `session.player.joined` beside them.
  return { outcome: "claimed", playerCount, state };
}

/**
 * How many players have joined.
 *
 * Read by `applyHostAction` on every host action — roughly fifteen times a session,
 * paced by the host rather than by attendees, which is what keeps it away from the
 * polling shape the command-counter tripwire exists to catch.
 *
 * Returns `null` rather than `0` on any failure, so the caller can tell "nobody has
 * joined" from "I could not find out" and keep the previous number instead of
 * publishing a zero that would read, on a large screen, as the room having left.
 */
export async function readPlayerCount(): Promise<number | null> {
  const redis = client();
  if (!redis) return null;

  try {
    const count = await redis.hlen(PLAYERS_KEY);
    return Number(count) || 0;
  } catch {
    return null;
  }
}

/**
 * What a lookup by player id found — and, crucially, whether it could look at all.
 *
 * **`not-found` and `failed` must stay distinguishable, and this used to be one shape.**
 * A `null` player meant both "no such id" and "the store threw", the route answered 404
 * to both, and the client concluded from any non-OK that its stored id was dead and
 * cleared it. One blip on an Upstash call during a reload therefore destroyed the
 * device's identity — and the attendee then re-typed the name they were still holding,
 * was refused as `taken`, and was locked out for the rest of the segment. That is the
 * exact failure the whole resume path exists to prevent, reached through the error
 * handler instead of through the front door.
 *
 * The earlier conflation was defended as deliberate — both cases *do* need the same
 * fallback screen — and that part was right. What it missed is that the two cases need
 * opposite things done to `localStorage`: `not-found` must clear it, `failed` must not.
 */
export type LookupResult = {
  readonly outcome: "found" | "not-found" | "failed";
  readonly player: PlayerRecord | null;
  readonly state: SessionState | null;
};

/**
 * The player behind an id a device is presenting.
 *
 * Read-only, and an `EVAL` for the round trip rather than for any guard — it does a
 * `HGET` on the reverse index then a `HGET` on the players hash, so a returning device
 * costs one round trip instead of two. Nothing here is protecting an invariant.
 */
export async function readPlayerById(id: string): Promise<LookupResult> {
  const redis = client();
  if (!redis) return { outcome: "failed", player: null, state: null };

  let result: [unknown, unknown] | null;
  try {
    result = await redis.eval<[string], [unknown, unknown]>(
      READ_PLAYER_BY_ID,
      [PLAYER_IDS_KEY, PLAYERS_KEY, SESSION_KEY],
      [id]
    );
  } catch (err) {
    console.error("Player lookup failed:", describe(err));
    return { outcome: "failed", player: null, state: null };
  }

  const rawPlayer = result?.[0];
  const rawState = result?.[1];

  const player =
    rawPlayer === null || rawPlayer === undefined || rawPlayer === false
      ? null
      : parsePlayerRecord(asDocument(rawPlayer));

  const state = ((): SessionState | null => {
    if (rawState === null || rawState === undefined || rawState === false) return null;
    const parsed = parseSessionState(asDocument(rawState));
    return parsed.ok ? parsed.state : null;
  })();

  return { outcome: player ? "found" : "not-found", player, state };
}

/**
 * What happened to a submitted answer.
 *
 * `already-answered` and `not-open` are ordinary outcomes rather than errors — the
 * first is a double tap or a reload-and-resubmit, the second is a phone that answered
 * as the host advanced — and the route renders each as its own Polish message. They
 * are separate members for the same reason `LookupResult` splits `not-found` from
 * `failed`: the device does different things with them, and the one thing it must
 * never do is conclude from a store blip that its answer was rejected on the merits.
 */
export type SubmitResult =
  | { outcome: "accepted"; total: number }
  | { outcome: "already-answered" }
  | { outcome: "not-open" }
  | { outcome: "no-session" }
  | { outcome: "unknown-player" }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * Records a scored answer and advances the player's running total (roadmap S-03).
 *
 * The record arrives already scored: the route computes correctness and the award from
 * the raw definition before calling, so the Lua stays six calls long. That is not a
 * read-then-write across the two — the route's read decides the *award*, and the
 * script's own read decides whether the award counts at all.
 *
 * Publishes nothing, for the reason joining publishes nothing: 150 submissions fanning
 * out to 150 subscribers is the O(N²) shape the spine contract forbids. The room learns
 * nothing from a submission; the device learns its own result at reveal.
 *
 * Logs nothing either — `answer.ts` emits the accepted and rejected events beside the
 * six rejection branches it already owns, so the event family stays in one layer
 * (`claimPlayer`'s precedent).
 */
export async function submitAnswer(record: AnswerRecord): Promise<SubmitResult> {
  const redis = client();
  if (!redis) return unconfigured();

  /**
   * Validated on the way in, as `writeSession` validates the state on its way out, and
   * for the same reason: this is the last point at which a record that breaks its own
   * shape can be stopped from becoming a stored value.
   *
   * The failure it prevents is quiet. `readOwnResult` parses what it reads, so a record
   * that does not satisfy the schema comes back as `null` — and the result route reports
   * `answered: false` to a device that watched its answer land. A refusal here is
   * visible; that is not.
   */
  const validated = answerRecordSchema.safeParse(record);
  if (!validated.success) {
    return {
      outcome: "failed",
      reason: validated.error.issues.map((issue) => issue.message).join("; "),
    };
  }

  let result: [number, number] | null;
  try {
    result = await redis.eval<[string, string, string, string, string, string], [number, number]>(
      SUBMIT_ANSWER,
      [SESSION_KEY, ANSWERS_KEY, SCORES_KEY, PLAYER_IDS_KEY],
      [
        answerField(record.questionId, record.playerId),
        JSON.stringify(record),
        record.playerId,
        record.questionId,
        String(record.awarded),
        String(SESSION_TTL_SECONDS),
      ]
    );
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const status = Number(result?.[0]);

  if (status === -1) return { outcome: "no-session" };
  if (status === -2) return { outcome: "not-open" };
  if (status === -3) return { outcome: "unknown-player" };
  if (status === 0) return { outcome: "already-answered" };

  // **Explicit, not a fall-through.** A `null` or malformed reply makes `status` `NaN`,
  // which fails every comparison above — and reaching a bare `return accepted` from
  // there would report an answer the store never wrote as recorded. The other scripts
  // in this file fall through to a *refusal*, which is harmless; here the fall-through
  // direction is the unsafe one, so this branch names its condition.
  if (status === 1) return { outcome: "accepted", total: Number(result?.[1]) || 0 };

  return { outcome: "failed", reason: `unexpected submit status: ${String(result?.[0])}` };
}

/**
 * One device's own result, and whether the store could answer at all.
 *
 * **`answer: null` under `outcome: "ok"` means "this device did not answer"; `failed`
 * means "the store could not say".** The same split `LookupResult` documents, for the
 * same reason: conflating them makes a transient blip look, on the phone, like proof
 * that an answer the attendee watched land was never recorded.
 *
 * `state` is carried out so the caller can apply the phase gate against the document
 * the totals were read alongside, rather than against a second, later read.
 */
export type OwnResult =
  | {
      outcome: "ok";
      state: SessionState | null;
      answer: AnswerRecord | null;
      total: number;
    }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * Reads back what this player answered to this question, plus their running total.
 *
 * One round trip for all three values. Called by ~150 devices within a second of each
 * reveal — a fan-in shape this project has not had before, which is why the caller
 * gates it on "I answered" and "this question is scored" rather than issuing it
 * unconditionally.
 */
export async function readOwnResult(playerId: string, questionId: string): Promise<OwnResult> {
  const redis = client();
  if (!redis) return unconfigured();

  let result: [unknown, unknown, unknown] | null;
  try {
    result = await redis.eval<[string, string], [unknown, unknown, unknown]>(
      READ_ANSWER,
      [SESSION_KEY, ANSWERS_KEY, SCORES_KEY],
      [answerField(questionId, playerId), playerId]
    );
  } catch (err) {
    console.error("Result lookup failed:", describe(err));
    return { outcome: "failed", reason: describe(err) };
  }

  const [rawState, rawAnswer, rawTotal] = [result?.[0], result?.[1], result?.[2]];

  const state = ((): SessionState | null => {
    if (rawState === null || rawState === undefined || rawState === false) return null;
    const parsed = parseSessionState(asDocument(rawState));
    if (!parsed.ok) {
      logSessionEvent("session.read.invalid", { reason: parsed.problems.join("; ") });
      return null;
    }
    return parsed.state;
  })();

  const answer =
    rawAnswer === null || rawAnswer === undefined || rawAnswer === false
      ? null
      : parseAnswerRecord(asDocument(rawAnswer));

  // A missing total is zero, not an error: a device that answered nothing correctly
  // has never touched the scores hash. `HINCRBY` only ever writes integers, so a
  // non-numeric value here would be corruption, and zero is the safe reading of it.
  const total = Number(rawTotal) || 0;

  return { outcome: "ok", state, answer, total };
}

export type PurgeResult =
  | { outcome: "purged"; keysRemoved: number }
  | { outcome: "unconfigured"; reason: string }
  | { outcome: "failed"; reason: string };

/**
 * Removes every registered key (roadmap F-03).
 *
 * `keysRemoved === 0` is a normal outcome, not a failure: purging when nothing is
 * there is exactly what residue cleanup looks like, and reporting it as an error
 * would train a host to ignore the one verb whose errors matter.
 *
 * One `EVAL` because a partial purge is the failure mode that matters here —
 * deleting three of four keys and returning success leaves attendee data behind
 * with nothing on the wire to say so.
 */
export async function purgeSession(): Promise<PurgeResult> {
  const redis = client();
  if (!redis) return unconfigured();

  const keys = registeredKeys();

  // Guard against a registry emptied by a bad refactor: `DEL` with no keys is a
  // Lua error, and `keys.test.ts` asserts the registry is non-empty for the same
  // reason. Fail loudly rather than reporting a vacuous success.
  if (keys.length === 0) {
    return { outcome: "failed", reason: "the key registry is empty — nothing would be purged" };
  }

  let removed: unknown;
  try {
    removed = await redis.eval<[], number>(PURGE_ALL, keys, []);
  } catch (err) {
    return { outcome: "failed", reason: describe(err) };
  }

  const keysRemoved = Number(removed) || 0;
  logSessionEvent("session.purged", { keysRemoved });
  return { outcome: "purged", keysRemoved };
}
