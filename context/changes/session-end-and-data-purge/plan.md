# Session End and Data Purge Implementation Plan

## Overview

Roadmap **F-03**. Make a live session explicitly endable, and make the PRD's retention guardrail —
"no attendee's display name or submitted answer remains in operator-accessible storage after the
session that collected it has ended" — hold across every surface that storage actually means, not
just the one everybody thinks of.

The deletion is trivial and always was: the archived F-02 plan says so outright — "One key means TTL
is one property and F-03's purge is one `DEL`." Three things make this a slice rather than a
one-liner.

**The data does not exist yet.** `SessionState` (`src/lib/session/state.ts:31-46`) carries `version`,
`phase`, `currentQuestionId`, `startedAt`, `updatedAt` — flow only. Display names arrive in S-02,
answers and scores in S-03, standings in S-07. So the real deliverable is a contract those slices are
bound by, enforced by a test, written while they are still unwritten and therefore still cheap to
bind.

**There are three storage surfaces, not one.** Redis holds the session document. Ably receives the
entire state on every host action (`src/lib/session/realtime.ts:116`) and retains published messages
by a vendor default nobody here has measured. Vercel's log stream carries whatever the code emits and
is covered by neither the store TTL nor `vercel rollback`. Closing only the first one satisfies the
guardrail on paper.

**The purge is this project's first irreversible action.** `start`, `advance` and `reveal` are all
safe on a double-tap by construction — that idempotence is load-bearing on stage. `end` is not, and
the roadmap names its failure mode precisely: "a purge firing on a session the host did not mean to
end, wiping a live leaderboard mid-segment."

## Current State Analysis

**What exists (all delivered by F-02, archived at
`context/archive/2026-08-06-session-state-and-realtime-spine/`):**

- One key, `SESSION_KEY = "livequiz:session"` (`src/lib/session/store.ts:18`), holding one JSON
  document. Nothing outside `store.ts` constructs a Redis client or knows the key name.
- `SESSION_TTL_SECONDS = 4 * 60 * 60` (`store.ts:29`), re-armed inside the same Lua `EVAL` as every
  accepted write (`store.ts:89`). The docstring's rationale is explicit and worth preserving: long
  enough that a stalled host or a sponsor slot cannot expire the room, short enough that an abandoned
  session — the realistic stage outcome — purges itself the same evening.
- Two Lua scripts, `COMPARE_AND_SET` and `CREATE_IF_ABSENT`, each a single `EVAL`. `store.test.ts`
  asserts the single-`eval` property, and that assertion exists specifically to stop someone moving
  the logic into TypeScript.
- Three phases: `lobby`, `question-open`, `question-revealed` (`state.ts:27`), with a `superRefine`
  enforcing that `lobby` has no open question and every other phase does (`state.ts:62-76`).
- Three host verbs behind `LIVEQUIZ_HOST_SECRET` — `start`, `advance`, `reveal` — sharing
  `applyHostAction` (`host.ts:103`), which reads, computes, compare-and-set writes, then publishes.
- A closed log vocabulary of eight events (`log.ts:20-36`) whose docstring states that F-03 extends
  *this* list rather than inventing a second one.
- A dev-only harness at `/quiz/spine-check`, gated by `LIVEQUIZ_HARNESS` and 404ing in production
  (`src/lib/session/harness.ts:18`).
- A probe script precedent: `scripts/probe-spine-config.ts`, explicitly "a probe, not shipped
  behaviour. Nothing under `src/` may import it."

**What is missing:**

- No way to end a session. The only exit is the 4-hour TTL.
- No second lifetime. There is one TTL for every situation.
- No namespace discipline. `SESSION_KEY` is a lone constant; nothing stops S-02 writing
  `livequiz:players` — or `players` — outside anything that could purge it.
- No measurement of Ably retention. The word "Ably" does not appear in any retention discussion in
  the PRD, the roadmap, or F-02's plan.
- The no-names-in-logs rule is a docstring (`log.ts:57-62`) with an open index signature
  (`log.ts:52`) underneath it, so passing `{ displayName }` type-checks today.

**Constraints discovered:**

- `log.ts:52` declares `[key: string]: unknown` on `LogFields`. That index signature is what makes
  the documented rule unenforceable.
- `state.ts`'s `superRefine` currently reads "phase is not lobby ⇒ question is non-null". A fourth
  phase that has no open question breaks that shape and must be handled explicitly, not by accident.
- `parseSessionState` runs on the way *out* as well as in (`store.ts:270`), so a state the schema
  rejects can never be written — including a malformed `ended` document.
- Astro's origin check rejects any host POST reading `request.formData()` unless `Origin` matches
  (F-02 spine contract). `curl` verification needs `-H "Origin: <base-url>"` or a 403 reads as a
  broken endpoint.

### Key Discoveries:

- **The purge target is a namespace, not a key.** `store.ts:17`'s own comment — "The only key. F-03's
  explicit purge is `DEL` on this" — was written when the session was one document. It stays true
  only if F-03 makes it true for the keys that do not exist yet.
- **Ably is unaudited storage.** `realtime.ts:116` publishes the whole `SessionState` on every host
  action, and F-02's Migration Notes already record that `vercel rollback` "does not revert anything
  already held in Upstash or Ably" — the retention consequence of that sentence was never followed
  through.
- **The runbook actively invites a log-privacy breach.** `docs/runbook-live-session.md` has the host
  watch the stream all segment and F-02's plan lists "join" among the events that must log
  deliberately. S-02's most natural implementation logs a join by display name, into a stream with
  ~1-hour retention that no TTL covers.
- **`state.test.ts`, `store.test.ts`, `host.test.ts` and `routes.test.ts` all exist**, so every phase
  here has a test file to extend rather than create.
- **`src/lib/session/portability.test.ts` is the enforcement pattern to copy** — it reads its own
  directory off disk and asserts a textual property with a failure message that explains the rule.
  The key-registry test is the same shape.
- **Probe artifacts are a project convention.** `region-probe.md` (F-01) and `latency-probe.md`
  (F-02) record method and findings next to the change. The Ably probe produces a third.

## Desired End State

A host can end a session deliberately, and can wipe it immediately if they want to. Ten minutes after
an ordinary end — or four hours after an abandoned one — nothing about who played remains in Redis.
Nothing identifying is retained by Ably beyond the floor measured and recorded in
`ably-retention-probe.md`. Nothing identifying can be written to a log line without a type error. And
a future slice that invents an unregistered key fails `bun run test`.

The Ably clause is deliberately conditional, because Phase 1 may find a floor it cannot reduce to
zero. If it does, that is not a footnote — it becomes a constraint on what S-02 is allowed to publish,
and Phase 1's criteria require it to land in the retention contract rather than only in a risk
register nobody reads while writing a join flow.

**Verified by:** the residue check in Phase 4, run against the real Upstash database, showing an
empty `livequiz:` namespace after a session that seeded it; the Ably probe artifact from Phase 1
showing the measured retention window; and `bun run test` failing on a deliberately unregistered key.

## What We're NOT Doing

- **No attendee-facing closing screen.** F-03 delivers the terminal `ended` snapshot, its invariants,
  and proof it reaches a device. The screen an attendee sees is S-02's — no attendee view exists, and
  Open Roadmap Question 2 (how interactive views get client behaviour) is still S-02's to answer. The
  harness renders `ended` as evidence, not as product.
- **No client-storage lifecycle.** Explicitly excluded by decision. S-09 introduces same-device
  resume and owns what it puts in the browser and when that is cleared.
- **No players, answers, scores or standings.** S-02, S-03 and S-07. This slice says where they must
  live and how they must die, and writes none of them.
- **No change to the 4-hour active TTL.** Its rationale is documented and still correct; changing it
  would be churn.
- **No throttling or rate-limiting of any endpoint.** The open token endpoint is a separately
  recorded and accepted risk (`infrastructure.md` risk register, F-02 impl review).
- **No second host secret.** Considered and rejected: the PRD already accepts that whoever holds the
  control URL controls the session, so a second secret would defend a boundary the product does not
  claim.
- **No CI.** Open Roadmap Question 3, out of scope roadmap-wide.
- **No presence, and no authoritative state in the browser.** F-02's spine contract binds this slice
  unchanged.
- **No Vercel Pro upgrade.** Deferred by user decision in F-01.

## Implementation Approach

Five phases, ordered so the one thing that can only be learned by asking a vendor is learned first,
and so the contract exists before the verb that depends on it.

**Phase 1 probes Ably.** F-01's central lesson, repeated by F-02, is that confident vendor
documentation is not evidence — two `infrastructure.md` claims were wrong and only a probe caught
them. If the channel turns out to retain snapshots irreducibly, that reshapes what S-02 is allowed to
put in one, and it is far cheaper to learn that now than after S-02 ships names onto the channel.

**Phase 2 builds the registry and the second lifetime**, with no new verb attached, so the namespace
discipline and the log constraint can be tested in isolation and so Phase 3 has something to purge.

**Phase 3 adds the `ended` phase and the two verbs.** `end` is a compare-and-set like every other
host action, differing only in that it also re-arms every registered key to the short lifetime.
`purge` is unconditional deletion of the namespace. Both take a confirmation value; `end`
additionally refuses to fire while a question is open.

**Phase 4 proves the namespace is empty** against the real store rather than a mock, because the
whole risk is a key a mock cannot know about.

**Phase 5 writes the contract down** where S-02, S-03 and S-07 will read it, and updates the
operational documents that now describe a session with an ending.

## Critical Implementation Details

**State sequencing — `end` must re-arm every key in one `EVAL`, and `purge` must delete them in
one.** This is F-02's version-guard reasoning applied to a second operation. Upstash speaks HTTP
request/response, so N separate `EXPIRE` calls are N round trips that can partially fail: a `purge`
that deletes three of four keys leaves attendee data behind with a success response on the wire, and
an `end` that re-arms three of four leaves one key on the 4-hour lifetime — silently breaking the
guardrail in the direction nobody checks.

Note the asymmetry when writing the scripts: `DEL` accepts a key list, but `EXPIRE` takes exactly one
key (`EXPIRE key seconds [NX|XX|GT|LT]`). So the purge script is a single `DEL` over `KEYS`, while
the end script loops over `KEYS` calling `EXPIRE` per key. Both are still one `EVAL` and one round
trip, which is the property that matters — the loop costs nothing, because the round trip is the
expense, not the Redis command count inside it.

`store.test.ts` already asserts the single-`eval` property for the existing scripts; extend that
assertion to these rather than writing a new kind of test.

**Timing & lifecycle — both verbs write, then publish, then (for purge) delete.** `end` writes before
it publishes, matching `applyHostAction`'s existing order (`host.ts:137-159`), because a device that
receives `ended` and then re-fetches `/api/quiz/state` must not read a pre-end document. **`purge`
does the same thing and then deletes** — it is `end` plus a `DEL`, not a parallel path.

That third step is what the obvious design gets wrong. Publishing without writing first means
synthesizing a terminal document that was never stored, and the client's ordering rule is
unforgiving: `spine-check.astro` drops any snapshot where `state.version <= current.version`. So a
purge that republishes the session at its existing version is silently discarded by every device and
the closing screen never changes — the failure looks like a dead network, not a bug. Writing the
ended document first is what guarantees the published snapshot carries a strictly higher version and
is therefore actually applied.

The cost is one extra store round trip on the least latency-sensitive verb in the system, and the
benefit is one ordering to reason about instead of two opposite ones.

**The `ended` phase breaks the existing invariant's shape.** `state.ts:70-76` currently encodes
"phase is not lobby ⇒ question is non-null". `ended` has no open question, so the refinement must
become an explicit two-set rule — `lobby` and `ended` require null, `question-open` and
`question-revealed` require non-null — rather than an inverted check that a fourth phase silently
falls through.

**Debug & observability — the log constraint is a type change, not a comment.** Removing
`[key: string]: unknown` from `LogFields` (`log.ts:52`) is what turns the documented rule into a
compile error. Every existing call site must still type-check afterwards; if one needs a field the
closed set lacks, add that field deliberately rather than restoring the index signature.

## Phase 1: Probe and close the Ably retention surface

### Overview

Measure what the session channel actually retains, configure it to retain nothing, re-measure, and
record the result as an artifact. Nothing in `src/` changes in this phase.

### Changes Required:

#### 1. Retention probe script

**File**: `scripts/probe-ably-retention.ts`

**Intent**: Answer, by measurement rather than by documentation, how long a published snapshot
remains retrievable from the session channel and whether persistence is enabled on it. This is the
one input that could invalidate a decision already taken (that snapshots may carry display names from
S-02 onward), so it runs before anything is built on that decision.

**Contract**: A standalone script run with `bun scripts/probe-ably-retention.ts`, following
`scripts/probe-spine-config.ts` exactly: reads credentials from `process.env` (not `import.meta.env`
— there is no Vite pipeline under bare `bun`), prints one `ok`/`FAIL` line per finding, exits
non-zero on failure, and is importable by nothing under `src/`. It publishes a tagged throwaway
message to `SESSION_CHANNEL`, then reads channel history immediately and again after a delay, and
reports the channel's configured persistence. It must publish a probe-marked payload, never a
realistic `SessionState`, so a probe run against production cannot be mistaken for a host action by
any connected device.

#### 2. Channel configuration

**File**: (Ably dashboard — no repository file)

**Intent**: Set the channel rule for `livequiz:*` so snapshots are not persisted beyond whatever
minimum the platform enforces for connection recovery.

**Contract**: A namespace rule covering `livequiz:*` with message persistence disabled. **This is a
human-only step** — it is a vendor dashboard action, like F-01's plan decision. The plan does not
assume an agent can complete it; the phase's success criteria treat it as a checkpoint requiring
confirmation.

#### 3. Findings artifact

**File**: `context/changes/session-end-and-data-purge/ably-retention-probe.md`

**Intent**: Record the measured retention window before and after configuration, so a future reader
knows the guardrail's status on this surface without re-running anything — and so a vendor default
that changes later is visible as a change.

**Contract**: Same shape as `context/archive/2026-08-05-deployment-target-readiness/region-probe.md`:
method, raw observations, and a stated conclusion. Must record the date and the measured retention
figure explicitly, and must state plainly if the floor could not be reduced to zero.

### Success Criteria:

#### Automated Verification:

- The probe runs clean against the configured project: `bun scripts/probe-ably-retention.ts`
- Type checking passes: `bun run type-check`
- Existing suite still passes: `bun run test`

#### Manual Verification:

- The channel rule for `livequiz:*` is confirmed in the Ably dashboard with persistence disabled
- Two probe runs at different waits are recorded in the artifact with both figures, narrowing the
  retention window to a bounded range rather than an upper bound
  (reworded 2026-08-06: originally "a second run after the configuration change shows a shorter
  window". Persistence turned out to be off already, so there was no configuration change to measure
  across and no improvement to show — the runs narrow the window instead)
- If the retention floor cannot be reduced to zero, the residual window is written into
  `infrastructure.md`'s risk register with an owner, rather than left in the artifact only
- If the floor is non-zero, the resulting constraint on what S-02 may publish is carried into Phase
  5's retention contract — the risk register records the exposure, the contract is what a slice
  author actually reads before designing a payload
- The Desired End State's Ably clause is reconciled against the measured figure, so the plan does not
  close claiming an outcome the probe contradicted

**Implementation Note**: This phase contains a human-only dashboard step. Pause here for confirmation
that the channel rule is in place before proceeding.

---

## Phase 2: Key registry, second lifetime, and the log constraint

### Overview

Define the namespace every future slice must write through, add the post-end lifetime, and make the
no-names-in-logs rule a compile error. No new endpoint, no new verb.

### Changes Required:

#### 1. The key registry

**File**: `src/lib/session/keys.ts` (new)

**Intent**: Make "every piece of session data lives somewhere the purge can reach" a property of the
code rather than of everyone's memory. Every key a slice needs is declared here with its purpose, and
the purge operates on the declared set.

**Contract**: Exports a namespace prefix constant, a registry of declared keys (today: the session
document alone, which `store.ts` re-exports as `SESSION_KEY` so existing importers do not change),
and an accessor returning every registered key name. The registry entry carries the key's name and a
one-line note on what it holds. Adding a key means adding a registry entry — there is no other
sanctioned path. This module must not import `store.ts` (which imports it), and must not import any
`astro:` specifier, per `portability.test.ts`.

#### 2. Registry enforcement test

**File**: `src/lib/session/keys.test.ts` (new)

**Intent**: Fail the suite when a future slice creates a key outside the registry, since that key
would survive both the TTL re-arm and the purge and would be discovered only after a real event.

**Contract**: Reads the source of `src/lib/session/*.ts` and `src/pages/api/quiz/**/*.ts` off disk —
the `portability.test.ts` pattern — and asserts that no string literal beginning with the namespace
prefix appears outside `keys.ts` itself. The failure message must name the offending file and line
and explain the rule, matching `portability.test.ts`'s message style. It must also assert the
registry is non-empty, so a refactor that empties it does not turn the test green by vacuity.

**The gate must prove it can fail, in the suite rather than by hand.** Alongside the scan over real
source, add a fixture — a small string of source text containing an unregistered namespaced literal —
and assert the detector reports it. Without that, a detector whose regex silently stopped matching
would pass forever and look like compliance.

Same principle for the log constraint: a `// @ts-expect-error` line over a `logSessionEvent` call
passing a `displayName` field turns "you cannot log a name" into something `astro check` verifies, and
inverts helpfully — if someone reopens the field set, the suppression becomes an unused-directive
error and the test fails loudly.

Known limitation to state in the docstring rather than hide: this catches literals, not names built
by concatenation. That is a deliberate cost of a textual gate, and the Phase 4 residue check is what
covers the rest.

#### 3. The post-end lifetime

**File**: `src/lib/session/store.ts`

**Intent**: Introduce the short lifetime an ended session runs on, without touching the active one.

**Contract**: A new exported `ENDED_TTL_SECONDS` of 10 minutes, sitting beside `SESSION_TTL_SECONDS`
with a docstring giving its reasoning — long enough for a device to reload and still show the final
standings, short enough that the retention guardrail is satisfied within the same coffee break. The
existing `SESSION_TTL_SECONDS` and its docstring are unchanged.

#### 4. Closing the log field set

**File**: `src/lib/session/log.ts`

**Intent**: Turn the documented rule — callers must not pass display names, because logs outlive the
store TTL — into something the compiler rejects.

**Contract**: Remove the `[key: string]: unknown` index signature from `LogFields`, leaving only the
declared fields. Every existing call site must continue to type-check; where one genuinely needs a
field the closed set lacks, add that field explicitly. The docstring gains one line stating that the
closed set *is* the enforcement and that widening it back is the failure mode.

Also extend `SESSION_EVENTS` with `session.ended` and `session.purged`. Phase 3 emits them; declaring
them here keeps the vocabulary in the one place `log.ts:20-36` says it belongs.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including the new registry test: `bun run test`
- Type checking passes with the index signature removed: `bun run type-check`
- The registry test's fixture case proves the detector fires on an unregistered namespaced literal:
  `bun run test`
- The `@ts-expect-error` case proves a `displayName` field on `logSessionEvent` is rejected, and
  reports an unused directive if the field set is reopened: `bun run type-check`

#### Manual Verification:

- The registry docstring states its textual-gate limitation rather than implying completeness
- `SESSION_KEY` still resolves for existing importers, so no call site outside `store.ts` changed

---

## Phase 3: The `ended` phase, and the end and purge verbs

### Overview

Add a fourth phase with its own invariant, then the two host actions that use it — one deliberate and
reversible-ish, one deliberate and final.

### Changes Required:

#### 1. The `ended` phase

**File**: `src/lib/session/state.ts`

**Intent**: Give a finished session a state distinguishable from a session that never started, so a
device can tell "the quiz is over" from "the quiz has not begun" — which is the difference between a
closing beat and a broken screen.

**Contract**: `"ended"` joins `SESSION_PHASES`. The `superRefine` becomes an explicit two-set rule:
`lobby` and `ended` require `currentQuestionId === null`; `question-open` and `question-revealed`
require it non-null. Polish message for the `ended` case, consistent with the existing ones. A helper
computing the ended document from a current state belongs here alongside `nextQuestionId`, so
`state.ts` stays the single place that knows what a legal transition looks like.

Note the consequence and accept it: ending clears `currentQuestionId`, so the terminal snapshot does
not name the last question. The closing screen is about the session, not the question.

#### 2. End and purge in the store

**File**: `src/lib/session/store.ts`

**Intent**: Two store operations — one that writes the ended document and moves every registered key
onto the short lifetime, one that removes every registered key outright.

**Contract**: `endSession(expectedVersion, next)` mirrors `writeSession`'s signature and result
union, and is a single Lua `EVAL` that performs the same version comparison, sets the ended document
with `ENDED_TTL_SECONDS`, and re-arms every *other* registered key to the same lifetime — keys are
passed as `KEYS`, not interpolated into the script body. `purgeSession()` is a single `EVAL`
performing `DEL` over the full registered key list, returning how many keys existed so the caller can
distinguish "purged something" from "there was nothing there". Both follow the existing outcome-union
convention (`applied` / `stale` / `unconfigured` / `failed`) and both emit their log event.

Sharing the version-guard prologue between `COMPARE_AND_SET` and the end script by string
concatenation is acceptable and preferable to a second hand-maintained copy of the comparison.

#### 3. The end route

**File**: `src/pages/api/quiz/host/end.ts` (new)

**Intent**: Let the host close the segment deliberately, while making it structurally hard to close
one by accident.

**Contract**: `export const POST: APIRoute`, guarded by `authorizeHost`/`extractSecret` like the other
three verbs, returning `toResponse` shapes. Two additional guards on top of the secret:

- **A confirmation value.** The request must carry the session `version` the caller believes it is
  ending; a mismatch is refused with a Polish message naming the actual version. This deliberately
  makes `end` non-idempotent in the safe direction — every other host verb is safe *because* a
  replayed request is a no-op, and `end` must be safe because a replayed request is *refused*.
- **A phase guard.** `end` is refused while `phase === "question-open"`, with a Polish message
  telling the host to reveal first. Permitted from `lobby` and `question-revealed`. Ending an
  already-ended session is a no-op reporting the existing state, matching how `reveal` treats an
  already-revealed question.

Ordering is write-then-publish, matching `applyHostAction`.

#### 4. The purge route

**File**: `src/pages/api/quiz/host/purge.ts` (new)

**Intent**: The escape hatch — the host who wants the room's data gone now rather than in ten minutes,
and the clean teardown F-04 needs between rehearsal runs.

**Contract**: `export const POST: APIRoute`, same authorization. Requires the same version
confirmation when a session exists. When no session exists, it still runs — residue from a partially
failed earlier run is exactly what it is for — and reports that nothing was there rather than
erroring.

**Ordering is write, publish, delete.** Purge is `end` plus a `DEL`, so it reuses `end`'s path rather
than defining a second one: it writes the ended document (which bumps the version), publishes that
snapshot, then removes every registered key. Writing first is not ceremony — it is what makes the
published snapshot strictly newer than what devices hold, and therefore what makes it applied rather
than dropped. See Critical Implementation Details.

Two deliberate asymmetries with `end`, both of which must be stated in the route's docstring so a
future reader does not "restore consistency" by removing them:

- **No phase guard.** `end` refuses to fire from `question-open`; `purge` accepts every phase. That
  is the point — purge is the escape hatch for exactly the mid-question abandonment `end` refuses
  (a session going wrong, a room being evacuated), and adding a symmetric guard would remove the only
  exit.
- **A publish failure does not abort the delete.** The retention guardrail outranks the closing
  screen. The response reports which half succeeded.

If the intermediate write is rejected as stale, the purge is refused rather than forced — a stale
version means someone else is driving the session, which is precisely when a wipe should not proceed
unattended.

#### 5. Route tests

**File**: `src/pages/api/quiz/host/routes.test.ts`

**Intent**: Cover the guards, since they are the whole safety story and each is one condition away
from being useless.

**Contract**: Extend the existing suite. Cases that must be present: wrong secret rejected for both
verbs; missing confirmation rejected; stale confirmation rejected with the current version reported;
`end` refused from `question-open`; `end` accepted from `lobby` and from `question-revealed`;
`end` on an already-ended session reported as a no-op; `purge` with no session reported as nothing to
purge; `purge` accepted from `question-open` (the guard asymmetry is deliberate and must be pinned by
a test, or a future reader will "fix" it); `end` writing before publishing; `purge` writing, then
publishing, then deleting — and specifically that **the snapshot it publishes carries a version
strictly greater than the one it read**, which is the assertion that catches the silently-dropped
broadcast.

### Success Criteria:

#### Automated Verification:

- Unit and route tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `store.test.ts`'s single-`eval` assertion covers the two new scripts
- A build succeeds with the new phase in the schema: `bun run build`

#### Manual Verification:

- Against a running dev server, `end` from `question-open` is refused and the message names the
  reason; after `reveal`, the same call succeeds (remember `-H "Origin: <base-url>"` on `curl`)
- After `end`, the session key's remaining TTL is observably ~10 minutes, not ~4 hours
- After `purge`, `GET /api/quiz/state` reports no session
- A replayed `end` request — the same body sent twice — is refused the second time rather than
  silently re-ending

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 4: Prove the namespace is empty

### Overview

A check that runs against the real store, because the risk this slice exists to close is a key that a
mock cannot know about.

### Changes Required:

#### 1. Residue check script

**File**: `scripts/check-purge-residue.ts` (new)

**Intent**: Demonstrate, against the real Upstash database, that after a purge nothing remains under
the namespace — including keys the registry does not know about.

**Contract**: Same conventions as `scripts/probe-spine-config.ts` (bare `bun`, `process.env`,
`ok`/`FAIL` lines, non-zero exit, unimportable from `src/`). It seeds the namespace with at least one
decoy key that is deliberately *not* in the registry, exercises the real purge path, then `SCAN`s the
namespace and reports everything still present. A surviving decoy is a **reported finding, not a
failure** — it is the expected and correct outcome of a registry-based purge, and the script's value
is making that boundary visible rather than pretending the gate is total. The script fails only when
a *registered* key survives.

**It must refuse to run whenever a session document exists at all** — not "unless the phase looks
harmless". `lobby` in particular is the trap: `start` opens the lobby rather than question 1, so
`lobby` is exactly the state a host creates in the minutes before a segment, and a permissive guard
would let a destructive script seed decoys into and then wipe the session the host just started. That
is this slice's own named failure mode, reintroduced by the check meant to prevent it. `ended` is no
safer within its ten-minute window, where someone may still be reading the final standings.

The guard is therefore: any session document present ⇒ refuse, and say which phase it found.

#### 2. Harness controls for the terminal state

**File**: `src/pages/quiz/spine-check.astro`

**Intent**: Make the terminal state observable end to end from a browser — the evidence that `ended`
reaches a device, which is the half of the closing-screen outcome F-03 can actually deliver.

**Contract**: Two buttons alongside the existing `start`/`advance`/`reveal`, wired the same way, each
sending the version confirmation read from the harness's current snapshot. The device pane renders
the `ended` phase distinguishably from "no session". Visually separated from the flow verbs so a
mis-click is unlikely. Still gated by `isHarnessEnabled()`; still never present in production.

#### 3. Findings artifact

**File**: `context/changes/session-end-and-data-purge/purge-verification.md`

**Intent**: Record that the check was run against the real store, with its output, so the guardrail's
status is evidenced rather than asserted.

**Contract**: Date, which database it ran against, the raw output, and an explicit statement of what
was proven and what was not — specifically that the unregistered decoy survived by design.

### Success Criteria:

#### Automated Verification:

- The residue check passes against the real store: `bun scripts/check-purge-residue.ts`
- Type checking passes: `bun run type-check`
- Full suite passes: `bun run test`

#### Manual Verification:

- The harness on a preview deployment shows a second device reaching the `ended` phase after `end`
- After `purge` from the harness, the second device distinguishes a purged session from a
  disconnection
- `purge-verification.md` records the real-store run, including the surviving decoy and why it is
  expected
- `/quiz/spine-check` still 404s on production

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: The retention contract and the operational documents

### Overview

Write down what S-02, S-03 and S-07 are bound by, and update the documents that now describe a
session with an ending.

### Changes Required:

#### 1. The retention contract

**File**: `context/changes/session-end-and-data-purge/retention-contract.md` (new)

**Intent**: Give the next three slices one short document stating what they must do and must not do
about attendee data — the role F-02's `spine-contract.md` played, and for the same reason: the plan
is where the reasoning lives, and a second copy that can disagree with it is worse than no copy.

**Contract**: Deliberately under a page, following `spine-contract.md`'s shape. Must state: every key
is declared in `keys.ts` and there is no other path; display names and answers may not appear in
`logSessionEvent` fields, and the closed field set is why; the Ably retention position as measured in
Phase 1, with whatever residual window remains; `end` re-arms and `purge` deletes, and the ten-minute
window is deliberate rather than an oversight; and a pointer to the plan sections rather than a
restatement of them.

#### 2. Runbook

**File**: `docs/runbook-live-session.md`

**Intent**: The host now has a way to end a session and a way to wipe one, and both belong in the
checklist rather than in a plan nobody opens on event day.

**Contract**: Extend §After the session with ending the session and the ten-minute window, and with
when to reach for `purge` instead. Add `session.ended` and `session.purged` to the during-session
event table with what each means and what to do. Update the status note, which currently says the
spine has `start`/`advance`/`reveal`. Keep the existing warning that `vercel rollback` does not undo
session state — it is now more relevant, not less.

#### 3. The PRD guardrail

**File**: `context/foundation/prd.md`

**Intent**: Record the ten-minute window as an accepted, reasoned deviation from the retention
guardrail's own wording — because it is one, and because `prd.md` is where anyone auditing retention
will look first.

**Contract**: The guardrail reads "No attendee's display name or submitted answer remains in
operator-accessible storage **after the session that collected it has ended**." The delivered design
retains that data for ten minutes after a session has ended, deliberately, so a device that reloads
can still show the final standings. Annotate the guardrail in the style of the PRD's existing
Socratic resolutions: the counter-argument (a strict reading makes this a violation), the resolution
(a bounded window with an immediate-purge escape hatch is worth the guardrail's spirit more than its
letter), and the accepted cost. Do not silently reword the guardrail to match what was built — the
value of the entry is that the gap is visible.

If Phase 1 found a non-zero Ably retention floor, that belongs here too: it is a second, involuntary
deviation from the same sentence, and the PRD is where the two should be read together.

#### 4. Risk register and infrastructure

**File**: `context/foundation/infrastructure.md`

**Intent**: Record the Ably retention finding where the other vendor-surface risks live.

**Contract**: A risk-register row for the retention surface, stating the measured window, the
mitigation applied, and — since it is a dashboard setting outside the repository — that it can be
undone without a commit, with an owner. If Phase 1 found the floor cannot reach zero, the residual
window is the risk; if it reached zero, the risk is regression.

#### 5. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Reflect delivery and close the item's recorded unknown.

**Contract**: F-03 status to `done`; the F-03 unknown about whether an explicit end must purge is
answered by what shipped (both, with different timings); the Backlog Handoff row updated. Note in
F-04's entry that it now has a sanctioned teardown path.

#### 6. Project guide

**File**: `CLAUDE.md`

**Intent**: The two rules a future agent is most likely to break — inventing a key outside the
registry, and logging a display name — belong where agents actually read.

**Contract**: Two or three sentences in the LiveQuiz area of the project guide. Rules and their
reasons only; no restatement of the implementation.

### Success Criteria:

#### Automated Verification:

- Full suite passes: `bun run test`
- Type checking passes: `bun run type-check`
- Build succeeds: `bun run build`

#### Manual Verification:

- `retention-contract.md` fits on a page and points at the plan rather than duplicating it
- The runbook's status note no longer describes a spine without an ending
- `prd.md` carries the ten-minute window as a visible, reasoned deviation rather than a reworded
  guardrail
- A reader of `CLAUDE.md` alone would not invent an unregistered key

---

## Testing Strategy

### Unit Tests:

- `keys.test.ts` — the registry is non-empty; no namespaced literal exists outside `keys.ts`
- `state.test.ts` — `ended` requires a null question; `question-open` and `question-revealed` still
  require a non-null one; the ended-document helper produces a state the schema accepts
- `store.test.ts` — `endSession` re-arms to `ENDED_TTL_SECONDS`; `endSession` rejects a stale version
  exactly as `writeSession` does; `purgeSession` issues one `eval` over the full key list; both are a
  single `eval` call
- `log.test.ts` (if present, else the type-check) — the closed field set rejects an added name field

### Integration Tests:

- `routes.test.ts` — the full guard matrix from Phase 3, plus the orderings: `end` writes before
  publishing, `purge` writes then publishes then deletes, and the version it publishes is strictly
  greater than the version it read

### Manual Testing Steps:

1. Start a session, advance to a question, attempt `end` — confirm refusal naming the open question
2. `reveal`, then `end` with the correct version — confirm success and a terminal snapshot on a
   second device
3. Replay the identical `end` request — confirm refusal rather than silent re-ending
4. Inspect the key's remaining TTL — confirm ~10 minutes
5. `purge` — confirm the second device leaves the ended state distinguishably, and
   `GET /api/quiz/state` reports no session
6. Run the residue check against the real store and read its output, including the surviving decoy
7. Confirm `/quiz/spine-check` 404s on production

## Performance Considerations

Negligible and worth stating only to rule it out. `end` is one `EVAL` and one publish, identical in
cost to `advance`. `purge` is one `EVAL` and one publish. Neither is on the per-answer path, and
neither runs more than once per session. The residue check's `SCAN` runs from a script against a
store that is by definition not serving a live room.

The one thing that would change this is a future slice putting a key per attendee in the registry:
150 keys in one `DEL` is still one round trip, but the `KEYS` list grows, and a per-attendee key
design should be questioned on the fan-out budget long before it is questioned here.

## Migration Notes

No data migration. The `ended` phase is additive, and no stored document can carry it before this
ships, so no existing state becomes unparseable.

One deployment ordering note that matters: a document written by the new code with
`phase: "ended"` is **rejected by the old schema** (`parseSessionState` would fail it, and
`readSession` returns `invalid`). So a rollback taken while an ended session is still within its
ten-minute window leaves the old code unable to read that document — `GET /api/quiz/state` returns
409 until the key expires. This is bounded by design (ten minutes, not four hours) and is exactly the
class of thing F-02's Migration Notes warned about: `vercel rollback` reverts code, never store
contents.

The remedy is to delete the key directly from the Upstash console or CLI — available to the same
person doing the rollback, and immediate. `purge` is not an option, because the rolled-back code no
longer has the route. Waiting out the ten-minute TTL is the fallback if nobody has store access at
that moment; it is not the first answer.

## References

- Roadmap item: `context/foundation/roadmap.md` (F-03, and F-04's teardown dependency)
- PRD: `context/foundation/prd.md` (Success Criteria guardrail on retention, Access Control Changes,
  Non-Goals)
- Predecessor and its lessons: `context/archive/2026-08-06-session-state-and-realtime-spine/`
- Binding constraints: `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md`
- Probe artifact precedent: `context/archive/2026-08-05-deployment-target-readiness/region-probe.md`
- Store and its Lua discipline: `src/lib/session/store.ts:50-112`
- Enforcement-test pattern to copy: `src/lib/session/portability.test.ts`
- Mocking pattern to copy: `src/lib/session/store.test.ts:1-25`
- Error posture to copy: `src/lib/slack.ts`
- Log vocabulary: `src/lib/session/log.ts:20-36`
- Operational contract: `docs/runbook-live-session.md`
- Risk register: `context/foundation/infrastructure.md` §Risk Register

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Probe and close the Ably retention surface

#### Automated

- [x] 1.1 The probe runs clean against the configured project: `bun scripts/probe-ably-retention.ts` — 025bd1e
- [x] 1.2 Type checking passes: `bun run type-check` — 025bd1e
- [x] 1.3 Existing suite still passes: `bun run test` — 025bd1e

#### Manual

- [ ] 1.4 The channel rule for `livequiz:*` is confirmed in the Ably dashboard with persistence disabled
- [ ] 1.5 Two probe runs at different waits are recorded with both figures, narrowing the window to a bounded range
- [ ] 1.6 Any irreducible residual window is recorded in `infrastructure.md`'s risk register with an owner
- [ ] 1.7 A non-zero floor is carried into Phase 5's retention contract as a constraint on what S-02 may publish
- [ ] 1.8 The Desired End State's Ably clause is reconciled against the measured figure

### Phase 2: Key registry, second lifetime, and the log constraint

#### Automated

- [x] 2.1 Unit tests pass, including the new registry test: `bun run test` — 10c281e
- [x] 2.2 Type checking passes with the index signature removed: `bun run type-check` — 10c281e
- [x] 2.3 The registry test's fixture case proves the detector fires on an unregistered namespaced literal: `bun run test` — 10c281e
- [x] 2.4 The `@ts-expect-error` case proves a `displayName` field on `logSessionEvent` is rejected: `bun run type-check` — 10c281e

#### Manual

- [x] 2.5 The registry docstring states its textual-gate limitation rather than implying completeness — 10c281e
- [x] 2.6 `SESSION_KEY` still resolves for existing importers, so no call site outside `store.ts` changed — 10c281e

### Phase 3: The `ended` phase, and the end and purge verbs

#### Automated

- [x] 3.1 Unit and route tests pass: `bun run test` — e957151
- [x] 3.2 Type checking passes: `bun run type-check` — e957151
- [x] 3.3 `store.test.ts`'s single-`eval` assertion covers the two new scripts — e957151
- [x] 3.4 A build succeeds with the new phase in the schema: `bun run build` — e957151

#### Manual

- [x] 3.5 `end` from `question-open` is refused with a message naming the reason; after `reveal` it succeeds — e957151
- [x] 3.6 After `end`, the session key's remaining TTL is observably ~10 minutes, not ~4 hours — e957151
- [x] 3.7 After `purge`, `GET /api/quiz/state` reports no session — e957151
- [x] 3.8 A replayed `end` request is refused the second time rather than silently re-ending — e957151

### Phase 4: Prove the namespace is empty

#### Automated

- [x] 4.1 The residue check passes against the real store: `bun scripts/check-purge-residue.ts`
- [x] 4.2 Type checking passes: `bun run type-check`
- [x] 4.3 Full suite passes: `bun run test`

#### Manual

- [x] 4.4 A second device reaches the `ended` phase after `end` on a preview deployment
- [x] 4.5 After `purge`, the second device distinguishes a purged session from a disconnection
- [x] 4.6 `purge-verification.md` records the real-store run, including the surviving decoy and why
- [x] 4.7 `/quiz/spine-check` still 404s on production

### Phase 5: The retention contract and the operational documents

#### Automated

- [ ] 5.1 Full suite passes: `bun run test`
- [ ] 5.2 Type checking passes: `bun run type-check`
- [ ] 5.3 Build succeeds: `bun run build`

#### Manual

- [ ] 5.4 `retention-contract.md` fits on a page and points at the plan rather than duplicating it
- [ ] 5.5 The runbook's status note no longer describes a spine without an ending
- [ ] 5.6 `prd.md` carries the ten-minute window as a visible, reasoned deviation
- [ ] 5.7 A reader of `CLAUDE.md` alone would not invent an unregistered key
