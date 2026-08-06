# Purge verification — F-03 Phase 4

**Date:** 2026-08-06
**Script:** `scripts/check-purge-residue.ts`
**Store:** the live Upstash database provisioned for this project via the Vercel Marketplace
(Vercel resource `upstash-kv-chestnut-pillow`), reached with the `KV_REST_API_*` pair
**Question:** after a purge, is the `livequiz:` namespace actually empty — or does it merely
*intend* to be?

## Why this exists rather than a unit test

`store.test.ts` already asserts that `purgeSession` issues exactly one `DEL` over
`registeredKeys()`. That is a claim about the call, not about the store. The risk this slice
exists to close is a key nobody registered, and a mocked Redis client cannot know about a key
it was never told about — the mock would report success identically whether or not anything
was left behind.

So the gates are deliberately split:

| Gate | Runs | Catches | Misses |
| --- | --- | --- | --- |
| `keys.test.ts` | every commit, no credentials | a namespaced string literal outside `keys.ts` | names assembled at runtime |
| `check-purge-residue.ts` | by hand, needs credentials | anything actually sitting in the namespace | nothing, but only when someone runs it |

Neither is sufficient. There is no CI here, so the second one is run deliberately or not at all.

## Method

1. Refuse if any session document exists (see the safety gate below).
2. Seed every registered key, plus one deliberately **unregistered** decoy
   (`livequiz:decoy:unregistered`).
3. Run the same `DEL unpack(KEYS)` over the registered set that `purgeSession` runs.
4. `SCAN livequiz:*` and classify what remains: registered survivors (a failure), the decoy (a
   reported note), anything else (unexplained residue).
5. Delete the decoy so the next run's "unexplained residue" report stays truthful.

## Results — 2026-08-06

```
  ok   Upstash credentials — present
  ok   no live session — safe to seed — livequiz:session is absent
  ok   seeded the namespace — 2 key(s): livequiz:decoy:unregistered, livequiz:session
  ok   purge removed every registered key — removed 1 of 1
  ok   no registered key survives the purge — namespace holds none of the registered keys
  ··    unregistered decoy — livequiz:decoy:unregistered SURVIVED — expected, and the whole
        point: a registry-based purge cannot reach what the registry does not know about
  ok   the namespace is empty when this script exits — clean

6/6 checks passed.  (exit code 0)
```

## What this proves, and what it does not

**Proven.** Every registered key is removed by the real purge against the real store, and the
namespace scans empty afterwards. Combined with the Phase 3 live run — where `end` moved the
document to a 581-second TTL and `purge` left `GET /api/quiz/state` returning `{"state":null}`
— the Redis surface of the retention guardrail holds in practice, not only in tests.

**Not proven, by design.** The unregistered decoy survived. A registry-based purge cannot reach
what the registry does not know about, and that is the designed behaviour rather than a defect —
which is why the script reports it as a note and fails only on a *registered* survivor. Pretending
otherwise would make the gate look total when it is not.

The residual exposure is therefore: a future slice that writes a key without declaring it in
`keys.ts` **and** builds the name at runtime so `keys.test.ts` cannot see the literal. Both
mistakes at once. `retention-contract.md` (Phase 5) is what tells S-02, S-03 and S-07 not to make
the first one.

## Fan-out to a second device — 2026-08-06

A subscriber was run against the local dev server using the same path a real device takes: a
subscribe-only token from `GET /api/quiz/token`, the `livequiz:session` channel, and the client's
higher-version-wins rule. Two scenarios, because the two purge paths differ in exactly the way
the plan review flagged.

**Scenario A — ordinary close (`end`, then `purge`):**

```
[APPLY] v1 phase=lobby        [APPLY] v3 phase=question-revealed
[APPLY] v2 phase=question-open [APPLY] v4 phase=ended
[DROP]  v4 (not newer than v4)
```

The device reaches `ended` and stays there. The trailing `DROP` is the purge re-publishing the
already-ended document at its existing version — correctly discarded, and harmless, because the
device is already showing the terminal state. Nothing is lost.

**Scenario B — abandonment (`purge` straight from an open question, which `end` refuses):**

```
[APPLY] v1 phase=lobby
[APPLY] v2 phase=question-open
[APPLY] v3 phase=ended          ← purge wrote the terminal doc, bumping 2 → 3
summary: applied=3 dropped=0
```

**This is the scenario the write-then-publish-then-delete ordering exists for.** The plan
originally specified publish-then-delete; the review caught that a purge broadcasting the session
at its *existing* version would be dropped by every device. Scenario B is that case: had purge
published at v2, the device would have discarded it and sat showing an open question indefinitely
while the underlying data was already deleted — a failure that looks exactly like a dead network.
Writing first is what makes v3 strictly newer and therefore actually applied.

**On criterion 4.5** — the device distinguishes a purged session from a disconnection because it
receives the `ended` snapshot *before* the delete, and its connection state stays `connected`. It
does not receive a separate "purged" signal, and cannot: after the delete there is no state left
to broadcast. The terminal phase is the signal.

## The safety gate, and why it is stricter than the plan first said

The plan originally had the script refuse only when a session's phase was neither `lobby` nor
`ended`. The plan review caught that as backwards: `start` opens the **lobby**, so `lobby` is
precisely the state a host creates in the minutes before a segment — the one moment when seeding
decoys into the live store and then wiping it would be worst. `ended` is live data too, inside its
ten-minute window, which someone may still be reading the final standings from.

The gate is now "any session document present ⇒ refuse", and it was verified by seeding a lobby
session and re-running:

```
 FAIL  a session already exists (phase: lobby)
 → refusing to run while ANY session document exists
 exit code 1
```

## Harness gate on production — 2026-08-06

```
https://ai-community-szn.vercel.app/quiz/spine-check  -> 404
https://ai-community-szn.vercel.app/api/quiz/state    -> 200
https://ai-community-szn.vercel.app/                  -> 200
```

The harness stays unreachable in production while the site and the session endpoint work.

Caveat worth stating: this measures the **currently deployed** build, which predates Phase 3 and
Phase 4. The gate itself (`isHarnessEnabled`, keyed on `LIVEQUIZ_HARNESS` being unset in
Production) is F-02's and is untouched by this change, so the result carries — but it should be
re-checked after this work reaches `main`, because the harness now carries two destructive buttons
rather than three harmless ones. That re-check belongs to whoever merges.

## Reproducing

```bash
bun scripts/check-purge-residue.ts     # exits 1 if a session exists, or if a registered key survives
```

Requires `KV_REST_API_URL` / `KV_REST_API_TOKEN` (or the `UPSTASH_REDIS_REST_*` pair). It writes to
the live namespace, so read the safety gate above before running it anywhere near an event.
