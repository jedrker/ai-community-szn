/**
 * Proves the purge actually empties the namespace (roadmap F-03, Phase 4).
 *
 * This is a probe, not shipped behaviour. Nothing under `src/` may import it.
 *
 * ## Why a mock cannot do this job
 *
 * `store.test.ts` asserts that `purgeSession` issues one `DEL` over
 * `registeredKeys()`. That is worth asserting, and it is not the same claim as "the
 * store is empty afterwards". The risk this slice exists to close is a key that
 * nobody registered — and a mocked client cannot know about a key it was never told
 * about. Only the real store can answer that.
 *
 * `keys.test.ts` catches the likely version of that mistake cheaply, on every commit,
 * by scanning source for namespaced literals. It cannot catch a name assembled at
 * runtime. This script is the other half: expensive, credential-gated, run by hand,
 * and able to see whatever is actually there.
 *
 * ## The decoy, and why its survival is a PASS
 *
 * The script seeds a key that is deliberately NOT in the registry. A registry-based
 * purge cannot reach it, and that is the correct, designed behaviour — so the decoy
 * surviving is reported, not failed. Making it a failure would be dishonest about
 * what the gate does; hiding it would be worse. The script fails only when a
 * *registered* key survives, because that is the purge not doing its job.
 *
 * Run: bun scripts/check-purge-residue.ts
 */

import { Redis } from "@upstash/redis";

import {
  registeredKeys,
  SESSION_KEY,
  SESSION_NAMESPACE,
} from "../src/lib/session/keys";

/**
 * Imported from the registry, not mirrored (corrected 2026-08-07, during S-02).
 *
 * This block previously hardcoded `["livequiz:session"]` with a docstring giving two
 * reasons, **both of which were false**:
 *
 * - *"those modules read `import.meta.env`, which is unpopulated under bare `bun`"* —
 *   `keys.ts` reads nothing and imports nothing; it is deliberately a leaf so
 *   `store.ts` can import it without a cycle. `rehearse-room.ts` has imported from it
 *   under bare `bun` since F-04.
 * - *"kept in sync by the assertion below"* — there was no such assertion.
 *
 * The consequence was not theoretical. S-02 added two registered keys holding attendee
 * display names. A mirrored list would have purged one key of three, left both name
 * hashes in the store, and **reported a fully green run** — because the script seeds
 * only what it knows about, so the keys it had never heard of could not show up as
 * residue either. A probe that cannot fail is worse than no probe, and this one exists
 * precisely to catch data surviving a purge.
 *
 * Importing means the script tracks the registry forever, with no sync step to forget.
 */
const NAMESPACE = SESSION_NAMESPACE;

/**
 * Registered keys this script expects the purge to remove — whatever the registry says
 * today. Seeded as plain strings even where production stores a hash: this probe tests
 * whether `DEL` reaches a key, and `DEL` does not care about the value type.
 */
const EXPECTED_REGISTERED = registeredKeys();

/** Deliberately unregistered. See the module docstring. */
const DECOY_UNREGISTERED = `${NAMESPACE}decoy:unregistered`;

const SEED_TTL_SECONDS = 300;

type Finding = { ok: boolean; label: string; detail: string };

const findings: Finding[] = [];
const notes: string[] = [];

function record(ok: boolean, label: string, detail: string): void {
  findings.push({ ok, label, detail });
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} — ${detail}`);
}

function note(label: string, detail: string): void {
  notes.push(`${label} — ${detail}`);
  console.log(`  ··    ${label} — ${detail}`);
}

/** See `scripts/probe-spine-config.ts` for why this is `process.env`. */
function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function credentials(): { url: string; token: string } | null {
  const url = env("KV_REST_API_URL") ?? env("UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN") ?? env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) return null;
  return { url, token };
}

async function scanNamespace(redis: Redis): Promise<string[]> {
  const found: string[] = [];
  let cursor = "0";

  do {
    const [next, keys] = await redis.scan(cursor, {
      match: `${NAMESPACE}*`,
      count: 100,
    });
    cursor = String(next);
    found.push(...keys);
  } while (cursor !== "0");

  return found;
}

async function main(): Promise<void> {
  console.log(
    "\nChecking that a purge leaves nothing behind (F-03 Phase 4).\n",
  );

  const config = credentials();
  record(Boolean(config), "Upstash credentials", config ? "present" : "absent");

  if (!config) {
    console.log(
      "\n  → Pull them locally (`vercel env pull`) or export them by hand.\n",
    );
    process.exit(1);
  }

  const redis = new Redis({ url: config.url, token: config.token });

  /**
   * **The safety gate. Any session document at all means refuse.**
   *
   * Not "unless the phase looks harmless": `start` opens the *lobby*, so `lobby` is
   * exactly the state a host creates in the minutes before a segment — the one moment
   * when seeding decoys into the store and then wiping it would be catastrophic. And
   * an `ended` session is live data too, inside its ten-minute window, which someone
   * may still be reading the final standings from.
   */
  const existing = await redis.get(SESSION_KEY);

  if (existing !== null) {
    let phase = "unreadable";
    try {
      const doc =
        typeof existing === "string" ? JSON.parse(existing) : existing;
      phase = String((doc as { phase?: unknown })?.phase ?? "unknown");
    } catch {
      /* leave it as unreadable — the refusal does not depend on parsing it */
    }

    console.log(
      ` FAIL  a session already exists (phase: ${phase})\n\n` +
        "  → This script seeds and then deletes keys in the live namespace. Refusing to\n" +
        "    run while ANY session document exists, including a lobby waiting for a room\n" +
        "    and an ended session still inside its retention window.\n\n" +
        "    Wait for the TTL, or purge deliberately through the host route first.\n",
    );
    process.exit(1);
  }

  record(true, "no live session — safe to seed", `${SESSION_KEY} is absent`);

  // Seed: every registered key, plus the unregistered decoy.
  const seeded = [...EXPECTED_REGISTERED, DECOY_UNREGISTERED];
  for (const key of seeded) {
    const value =
      key === SESSION_KEY
        ? JSON.stringify({
            version: 1,
            phase: "lobby",
            currentQuestionId: null,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            playerCount: 0,
          })
        : "residue-check-placeholder";
    await redis.set(key, value, { ex: SEED_TTL_SECONDS });
  }

  const afterSeed = await scanNamespace(redis);
  record(
    seeded.every((key) => afterSeed.includes(key)),
    "seeded the namespace",
    `${afterSeed.length} key(s): ${afterSeed.join(", ")}`,
  );

  // Purge exactly as `purgeSession` does — one DEL over the registered set.
  const removed = await redis.eval<[], number>(
    "return redis.call('DEL', unpack(KEYS))",
    EXPECTED_REGISTERED,
    [],
  );
  record(
    Number(removed) === EXPECTED_REGISTERED.length,
    "purge removed every registered key",
    `removed ${removed} of ${EXPECTED_REGISTERED.length}`,
  );

  const afterPurge = await scanNamespace(redis);
  const registeredSurvivors = afterPurge.filter((key) =>
    EXPECTED_REGISTERED.includes(key),
  );
  const otherSurvivors = afterPurge.filter(
    (key) => !EXPECTED_REGISTERED.includes(key),
  );

  record(
    registeredSurvivors.length === 0,
    "no registered key survives the purge",
    registeredSurvivors.length === 0
      ? "namespace holds none of the registered keys"
      : `SURVIVED: ${registeredSurvivors.join(", ")}`,
  );

  const decoySurvived = otherSurvivors.includes(DECOY_UNREGISTERED);
  note(
    "unregistered decoy",
    decoySurvived
      ? `${DECOY_UNREGISTERED} SURVIVED — expected, and the whole point: a ` +
          "registry-based purge cannot reach what the registry does not know about"
      : `${DECOY_UNREGISTERED} did not survive — unexpected; the purge reached further ` +
          "than the registry, which is worth understanding before trusting it",
  );

  const unexplained = otherSurvivors.filter(
    (key) => key !== DECOY_UNREGISTERED,
  );
  if (unexplained.length > 0) {
    note(
      "unexplained residue",
      `${unexplained.join(", ")} — not seeded by this run and not registered. Someone ` +
        "wrote a key outside keys.ts, which is exactly the leak this slice exists to close",
    );
  }

  // Clean up after ourselves, decoy included. Leaving it would make the next run's
  // "unexplained residue" report a lie.
  await redis.del(DECOY_UNREGISTERED);
  const finalScan = await scanNamespace(redis);
  record(
    finalScan.length === 0,
    "the namespace is empty when this script exits",
    finalScan.length === 0 ? "clean" : `still present: ${finalScan.join(", ")}`,
  );

  const failed = findings.filter((finding) => !finding.ok);
  console.log(
    `\n${findings.length - failed.length}/${findings.length} checks passed.`,
  );

  if (notes.length > 0) {
    console.log("\nNotes (reported, not failed):");
    for (const entry of notes) console.log(`  - ${entry}`);
  }

  console.log("");

  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const finding of failed) console.log(`  - ${finding.label}`);
    console.log("");
    process.exit(1);
  }

  console.log(
    "Record this run in\n" +
      "context/changes/session-end-and-data-purge/purge-verification.md.\n",
  );
}

main().catch((err) => {
  console.error("\nResidue check crashed:", err);
  process.exit(1);
});
