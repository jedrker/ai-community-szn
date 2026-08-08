# Join and Follow Host (S-02) Implementation Plan

## Overview

An attendee opens `/quiz` on their phone, claims an unused display name, and from that moment sees
whatever question the host has open — appearing on their screen as the host starts the session and
advances through it. The host drives the segment from `/quiz/host`, a real production view that
replaces the dev-only harness for the flow verbs.

This is the first slice where the F-02 spine meets real devices and the first that writes real
attendee data. It also resolves **Open Roadmap Question 2** — how the interactive views get their
client behaviour — a decision that binds S-03 through S-08.

Deliberately excludes answering. A room that is connected and following the host is already a
demonstrable, testable state, and separating it keeps the north star (S-03) tractable.

## Current State Analysis

**The spine is complete and reusable as-is.** F-02 delivered authoritative state in Upstash Redis
behind a Lua version guard, snapshot fan-out over Ably, a subscribe-only token endpoint, and a
state-prime endpoint. F-03 added `end`/`purge` plus the key registry and the closed log vocabulary.
F-04 measured fan-out at **p95 111–592 ms across seven N=150 runs** from `fra1` against a 1000 ms
budget, with zero lost snapshots.

What does not exist:

- **No production UI at all.** The only page under `src/pages/quiz/` is `spine-check.astro`, which
  404s unless `LIVEQUIZ_HARNESS` is set and ships `LIVEQUIZ_HOST_SECRET` to the browser — acceptable
  *only* because it cannot exist in production (`src/lib/session/harness.ts`).
- **No players.** `SessionState` carries `version`, `phase`, `currentQuestionId`, `startedAt`,
  `updatedAt` and nothing else (`src/lib/session/state.ts:50`). The spine contract's scope boundary
  says so explicitly: "no players, no answers, no scores. Adding players is S-02's."
- **No client-side module layer.** `spine-check.astro` inlines its whole client in one `<script>`.
  Nothing is shared, and nothing is reusable by a second view.
- **No answer to Open Roadmap Question 2.** No UI-framework integration is installed, and
  `tech-stack.md` records the registry card's own gotcha that Astro is content-first and explicitly
  "not a SPA".

Two measurement debts land here by construction: **paint time is not in F-04's p95** (arrival was
measured at the client library, not at a painted phone screen), and the **30-second join target
(FR-002) has never been measured** — F-04 connected its pool before `start` rather than timing the
join as a user-visible step.

One inherited diagnostic: the store's command counter read **513 → 4102** across seven rehearsal
runs against roughly **60** the code accounts for. Two orders of magnitude unexplained, far below the
200K polling tripwire. Worth settling before this slice adds the first real attendee writes, because
afterwards the two causes cannot be separated.

## Desired End State

A host opens `/quiz/host`, pastes the host secret once, and clicks **start**. The large screen shows
the lobby with a join count. Attendees open `/quiz` on their phones, type a name, and are in — or are
told the name is taken and asked for another. The host clicks **advance**; every joined phone shows
question 1 within a second. Advancing again moves the room to question 2. A phone that reloads
re-renders the current question immediately rather than waiting for the host's next action.

Verified by: `bun run test` (unit + gate suites), `bun run type-check` (0 errors), a two-device manual
run against a preview deployment, and an extended `scripts/rehearse-room.ts` run that drives 150
concurrent name claims against production and reports zero duplicate names plus the join-burst
distribution.

### Key Discoveries

- **`applyHostAction` already centralises the whole host write path** — secret check, version bump,
  compare-and-set, publish, and the five-outcome Polish error mapping (`src/lib/session/host.ts:144`).
  The new host view calls the existing routes; no new host-action machinery is needed.
- **`store.test.ts:226` asserts `COMPARE_AND_SET` is exactly one `eval` call.** That test exists to
  stop the version guard being moved into TypeScript. It constrains where the join count can be
  computed — see Critical Implementation Details.
- **`keys.test.ts` scans `src/lib/session/*.ts`, `src/pages/api/quiz/**` and `src/pages/quiz/*.astro`**
  (`src/lib/session/keys.test.ts:78`) — but not a new client directory. This slice creates one.
- **`normalizePolish` already folds case, spacing and Polish diacritics correctly**, including the
  `ł` trap that a bare NFD pass gets wrong (`src/quiz/normalize.ts:20`). It is the right fold for the
  name-uniqueness key and needs no second implementation.
- **`correctOptionIds`, `acceptedAnswers` and `correctValue` all live in the same object the views
  read** (`src/quiz/index.ts:49`), so anything reaching the browser needs a deliberate allowlist
  projection.
- **Astro rejects a cross-origin POST that reads `formData()` with a 403 before the handler runs**
  (F-02 trap). Same-origin `fetch` satisfies it automatically; `curl` needs `-H "Origin: <base-url>"`.
- **`redisMock` in `store.test.ts` exposes only `get` and `eval`.** Adding an `HLEN` read means
  extending that mock.

## What We're NOT Doing

- **No answering, scoring, or reveal handling.** S-03. The attendee view renders a question; it has no
  submit path. `reveal` stays available on the host view because it is an existing flow verb, but
  nothing about the revealed state changes on a phone beyond the phase label.
- **No leaderboard, no standings, no word cloud.** S-07, S-08.
- **No participation count or answer distribution on the large screen.** S-04. The *join* count in the
  lobby is not that — it counts players, not answers, and FR-005's cheat-sheet reasoning does not
  apply to it.
- **No per-device player cap.** S-09 (FR-018).
- **No score-intact resume and no reconnect survival.** S-09 (FR-009). This slice does implement the
  narrow half of resume that its own end state depends on: a device that reloads is recognised by the
  player id it stored and goes straight back to the follow view. That is not S-09's scope creeping in
  — without it, a reloading attendee re-enters their name, is rejected because they hold it
  themselves, and is locked out for the rest of the segment. S-09 owns resume *with a score to
  restore*, resume across the spine's own reconnects, and the flood guard.
- **No name moderation or blocklist.** Length and character limits only, consistent with the PRD's
  recorded decision to accept unmoderated content on the projector.
- **No changes to `spine-check.astro`** beyond one docstring line pointing at the real views. It stays
  as the only surface exercising `end`/`purge` with their confirmation flow, which the runbook and the
  rehearsal recovery path both lean on.
- **No UI-framework integration.** No `@astrojs/preact`, no Alpine, and `@astrojs/tailwind` stays
  unreferenced.
- **No throttling of `/api/quiz/token` or `/api/quiz/join`.** The token endpoint's open-and-unthrottled
  posture is an accepted risk with a tripwire in `infrastructure.md`; joining inherits the same
  reasoning, and an IP-keyed limit was already rejected because a venue network puts many attendees
  behind one address.
- **No CI.** Open Roadmap Question 3 remains out of scope.

## Implementation Approach

Four decisions carry the slice.

**1. Vanilla TypeScript client modules, no framework.** Astro `<script>` tags import shared modules
from a new `src/lib/client/` directory; server→client handoff uses `define:vars`. This is the answer
to Open Roadmap Question 2. It is already proven end-to-end — `spine-check.astro` implements the whole
spine-contract client rule in a plain `<script>` today — and it keeps the client bundle to essentially
the Ably SDK, which matters because the 30-second join target is unmeasured and the venue network is
the one link nobody controls. The accepted cost: S-07's leaderboard and S-08's continuously-updating
word cloud will be hand-written DOM updates with no diffing. Recorded so a later slice can reverse the
decision knowingly rather than discover it.

**2. Names never enter a published snapshot.** Retention rule 3 says anything published to Ably is
readable for ~120 s by anything holding a subscribe token, and `/api/quiz/token` is deliberately open.
S-02 does not need names on the wire — the attendee view renders the host's question, not the room. So
`SessionState` gains exactly one field, `playerCount`, which is a count and not attendee data. Names
live in Redis under registered keys; a device knows only its own. This means the PRD's recorded
deviation stops growing, and it hands S-07 an explicit choice rather than a fait accompli.

**3. The name claim is one Lua `EVAL`.** F-02's delivery lesson: read-modify-write over Upstash's HTTP
interface is three round trips with no isolation, so a JS-level guard passes every mocked test and
fails on stage. The claim script reads the session document, checks the phase allows joining, checks
whether the folded name is taken, writes both player hashes, and arms both TTLs — all inside one
script, so the phase check cannot race the claim either.

**4. The host secret is typed, not shipped.** `/quiz/host` renders a secret field; the value is held in
`sessionStorage` and sent as the `x-livequiz-host-secret` header. The page stays as unprotected as the
PRD wants while the write path stays guarded, and the secret never appears in the HTML or the bundle.

## Critical Implementation Details

**The join count must be read outside the version guard.** `HLEN` on the players hash gives the
count, but embedding it inside `COMPARE_AND_SET` would mean `cjson.decode`/`encode` round-tripping the
state document in Lua — and `currentQuestionId` is `null` in two of the four phases, which is exactly
the value that round trip handles worst. `store.test.ts` also asserts that script is a single `eval`.
So the count is read in TypeScript before `next` is computed and embedded in it. **A stale count is
acceptable and a stale version is not** — the count is informational, so a join landing between the
read and the write means the number is short by one until the next host action, which changes nothing
about correctness. Keep that distinction explicit in the code comments; it is the kind of asymmetry a
later reader will try to "fix" in the wrong direction.

**`playerCount` must carry a zod default, not be required.** `parseSessionState` runs on every read,
including on documents written by the previous deploy. A required field would make a mid-segment deploy
turn every existing session document into `outcome: "invalid"` — a 409 on the host's next action, on
stage. `.default(0)` keeps the output type non-optional while accepting a document that predates the
field.

**Joining must be allowed after the session has started, and refused once it has ended.** The drafted
quiz's Q2 is literally the last-chance-to-join beat ("Poczekajcie, jeszcze ktoś dołącza!"), so
`lobby`, `question-open` and `question-revealed` all permit a claim. `ended` does not — and neither
does "no session document", which is the ordinary state before the host clicks start. This is the same
shape of trap F-03 hit: a fourth phase must not inherit a rule written for three.

**The localStorage player id is attendee data on a device no purge reaches.** State it rather than let
it be discovered: the PRD guardrail says *operator-accessible* storage, and the attendee's own phone is
not that, so the guardrail holds. But the id is declared in `keys.ts` alongside `SESSION_CHANNEL` for
the same reason that name is — the invariant is "one module owns every namespaced name", and an
invariant with an exemption list is one that rots.

**Client modules must not value-import `src/quiz/index.ts`.** Doing so would ship all 14
`correctOptionIds`, `acceptedAnswers` and `correctValue` entries in the attendee bundle — the exact
leak the public projection exists to prevent — and would pull `zod` into the client for nothing.
`import type` is erased and therefore fine. This needs a gate, not a comment.

**User experience spec.** The host view is read from the back of a venue room: the phase, the current
question prompt and the join count must be legible at distance, which in practice means very large
type and high contrast rather than the site's ordinary body scale. The attendee view is read on a
phone held at arm's length in a dark room. Both are Polish. On the attendee side, the name field must
keep focus and its typed value after a rejected claim — a retry loop inside the flow that the
30-second target covers is the one place a lost input costs the most.

## Phase 0: Settle the command-counter anomaly

### Overview

Read the Upstash command counter twice with nothing running, so the unexplained 513 → 4102 delta is
attributed before this slice makes attribution impossible. The change notes are explicit that after
S-02 writes, attendee writes and the unexplained baseline cannot be separated.

This phase writes no code. It is sequenced first because its value expires the moment Phase 1 ships.

### Changes Required

#### 1. Idle-baseline readings

**File**: `context/changes/join-and-follow-host/command-counter-diagnostic.md` (new)

**Intent**: Record two readings of the Upstash monthly command counter taken with no rehearsal, no
local `bun run dev` against the real store, and no host action in between — plus the wall-clock gap.
Interpret: a flat figure means something outside the application accounted for the delta (console
health checks, integration metrics) and the tripwire's calibration is the only casualty; a rising
figure means something is issuing commands unprompted, which is a finding larger than this slice.

**Contract**: A short table — reading, timestamp, elapsed, delta — and a one-paragraph verdict naming
which of the two candidate explanations the data supports, or that it supports neither. Also state
whether the 200K tripwire in `docs/runbook-live-session.md` needs recalibrating now that attendee
writes are about to exist.

**Human step**: the Upstash console reading cannot be taken by an agent. Note that in the file.

### Success Criteria

#### Manual Verification

_No automated verification in this phase — it is two console readings and a verdict._

- Two counter readings recorded with at least a few hours between them, taken with nothing running
- The diagnostic file states a verdict rather than only the numbers
- If the idle figure rises, the finding is raised before Phase 1 starts rather than filed

**Implementation Note**: Pause here for confirmation before Phase 1. If the idle counter rises, that
changes what this slice may assume about store cost and is worth discussing before writing any store
code.

---

## Phase 1: The player store

### Overview

Everything server-side that makes a name claim atomic and countable: two registered keys, name
validation and folding, the claim `EVAL`, and the `playerCount` field on the session document.

### Changes Required

#### 1. Two new registered keys

**File**: `src/lib/session/keys.ts`

**Intent**: Declare the two player hashes in `REGISTERED_KEYS` so `end` re-arms them to the short
lifetime and `purge` deletes them. Also declare the browser-side storage key name, alongside
`SESSION_CHANNEL`, so no namespaced literal exists outside this module.

**Contract**: Two entries appended to `REGISTERED_KEYS`, each with a `holds` description naming
exactly what attendee data it carries — `livequiz:players` (folded display name → the player record)
and `livequiz:player-ids` (opaque player id → folded display name). The reverse index is **read by
this slice**, not banked for S-09: it is how a reloading device is recognised from the id it stored,
and without it a reloading attendee is locked out under their own name. Named exports for both,
following `SESSION_KEY`'s shape. Plus a non-purgeable
`PLAYER_STORAGE_KEY` export with a docstring explaining that it names a `localStorage` entry on the
attendee's own device, which no `purge` reaches and which the guardrail's "operator-accessible"
wording does not cover.

#### 2. Name validation and folding

**File**: `src/lib/session/players.ts` (new)

**Intent**: The pure, testable half of joining — validate a submitted display name, produce its
uniqueness key, and mint a player id. No store access, no env reads, so it is trivially unit-testable
and importable from anywhere server-side.

**Contract**: Exports a `validateDisplayName(raw: string)` returning either the accepted
`{ displayName, key }` pair or a Polish rejection message; a `newPlayerId()` using `crypto.randomUUID`;
and a `PlayerRecord` type plus its zod schema (`id`, `displayName`, `joinedAt`). Validation rules:
trim, collapse internal whitespace, then reject on empty, on a length outside roughly 2–24 characters
(the leaderboard's limit, so it belongs here rather than in a view), and on characters outside Polish
letters, digits, spaces and a small set of marks. The uniqueness key is `normalizePolish(displayName)`
imported through `src/quiz/index.ts` — never a second fold, and never `definition.ts` directly.

One thing worth stating in the docstring: rejecting a name whose *folded* form collides is the whole
point (FR-008 exists so the leaderboard is unambiguous, and `Anna`/`anna`/`ANNA` on one screen is the
ambiguity), so the displayed name is what the attendee typed and the claimed name is the folded form.

#### 3. The atomic claim

**File**: `src/lib/session/store.ts`

**Intent**: Add a `claimPlayer` that claims a folded name if and only if it is free *and* the session
is in a joinable phase, writing both hashes and arming both TTLs, in one round trip.

**Contract**: `claimPlayer(key: string, record: PlayerRecord)` returning a discriminated union
mirroring the module's existing style: `{ outcome: "claimed"; playerCount: number }`,
`{ outcome: "taken" }`, `{ outcome: "no-session" }`, `{ outcome: "closed" }`, plus the existing
`unconfigured` and `failed` shapes. Also `readPlayerCount()` returning `HLEN`, used by the host
action path in §5, and `readPlayerById(id)` returning the stored record or `null` — one `EVAL` doing
`HGET` on the reverse index then `HGET` on the players hash, so a returning device costs one round
trip rather than two.

`readPlayerById` is read-only and needs no atomicity; it is an `EVAL` for the round trip, not for the
guard. Say so, or a later reader will assume it is protecting something.

The Lua is the non-obvious part and other phases depend on its return contract, so the shape is fixed
here:

```lua
-- KEYS[1] session doc, KEYS[2] players hash, KEYS[3] player-ids hash
-- ARGV[1] folded name, ARGV[2] player record JSON, ARGV[3] player id, ARGV[4] ttl
local raw = redis.call('GET', KEYS[1])
if not raw then return { -1, 0 } end                    -- no session
if cjson.decode(raw).phase == 'ended' then return { -2, 0 } end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then return { 0, 0 } end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[3], ARGV[3], ARGV[1])
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[4]))
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[4]))
return { 1, redis.call('HLEN', KEYS[2]) }
```

The TTL re-arm sits inside the same script for the reason the existing scripts document: a separate
`EXPIRE` is another round trip that can fail on its own and leave a key holding attendee data
immortal, which quietly breaks the retention guardrail.

#### 4. `playerCount` on the session document

**File**: `src/lib/session/state.ts`

**Intent**: Add the one field the host's lobby needs, defaulted so a document written before this
deploy still parses.

**Contract**: `playerCount: z.number().int().nonnegative().default(0)` on `sessionStateSchema`, set to
`0` by `initialSessionState`, and carried through by `endedSessionState`. Docstring states why it is
defaulted rather than required (a mid-segment deploy would otherwise 409 the host's next action) and
why it is safe on the wire while a display name is not.

#### 5. Embed the count at host-action time

**File**: `src/lib/session/host.ts`

**Intent**: Each accepted host action carries a fresh join count into the published snapshot, so the
count refreshes at a rate the host controls and no join publishes anything.

**Contract**: `applyHostAction` reads `readPlayerCount()` after its `readSession`, and **overwrites
the field on `nextFrom`'s result** — `{ ...next, playerCount: count }` — so there is exactly one
injection point. This matters because three separate constructors build a full state literal
(`advance.ts:36`, `reveal.ts:35`, and `endedSessionState` in `state.ts:141`); each must set
`playerCount` to satisfy the type, and each will naturally copy `current.playerCount`. Copying is
correct *because* it is overwritten here. Without the overwrite the count is read fresh and then
discarded, and the number on the host's screen never moves — a failure the type system cannot see and
no existing test would catch.

On a read failure the previous count is kept rather than the action failing — a count is not worth
losing a host action over.

`host.test.ts` pins this by asserting the published state's count differs from the count on `current`
when the store reports a new one. An assertion that merely checks the field exists would pass against
the broken version. The comment must name the
asymmetry: a stale count is acceptable, a stale version is not, and this read is deliberately outside
the version guard because `store.test.ts` asserts that script stays a single `eval`.

#### 6. Tests

**Files**: `src/lib/session/players.test.ts` (new), `src/lib/session/store.test.ts`,
`src/lib/session/state.test.ts`, `src/lib/session/host.test.ts`,
`src/lib/session/realtime.test.ts`, `src/pages/api/quiz/host/routes.test.ts`,
`scripts/check-purge-residue.ts`

**Blast radius, since it is wider than it looks**: five suites assert whole state objects with strict
`toEqual` and adding a field breaks them — `realtime.test.ts:107`, `routes.test.ts:150` and
`store.test.ts:158` are the ones easy to miss, and the last is subtle: `createSession` parses the JSON
it gets back, so the parsed result gains `playerCount: 0` while the local `lobby` fixture has no such
key. In each file the fix belongs in the **shared fixture**, not in the individual assertions.
`scripts/check-purge-residue.ts:140` seeds a lobby document for its own check and wants the field for
consistency, though the schema default means it would parse without.

**Intent**: Cover the pure validation exhaustively, and cover the claim's atomicity the only way a
mocked test can — by asserting the shape of the call rather than the outcome of a race.

**Contract**: `players.test.ts` covers accepted names, each rejection reason, whitespace collapsing,
and that names differing only by case, spacing or diacritics fold to the same key (including a
`ł`-bearing pair, which is where a naive fold breaks). `store.test.ts` gains an `hlen` entry on
`redisMock`, asserts `claimPlayer` is exactly one `eval` call with three keys, and covers each of the
five return statuses. `state.test.ts` asserts a document lacking `playerCount` still parses and
defaults to `0`. `host.test.ts` asserts the published state's count **differs from `current`'s** when
the store reports a new one (see §5 — the weaker "field is present" assertion passes against the bug),
and that a count-read failure does not fail the action.

### Success Criteria

#### Automated Verification

- Test suite passes: `bun run test`
- Type check clean: `bun run type-check`
- `keys.test.ts` still passes — no namespaced literal outside `keys.ts`
- `claimPlayer` is asserted to be a single `eval` call
- A session document without `playerCount` parses and defaults to `0`

#### Manual Verification

- Reading `keys.ts` makes clear what attendee data each new key holds, without opening this plan

**Implementation Note**: Pause for confirmation after this phase. Nothing is reachable yet, so the
review here is of the store contract other phases will build on.

---

## Phase 2: The join endpoint and the public quiz projection

### Overview

The HTTP surface a phone talks to, and the sanitised quiz payload it is allowed to hold.

### Changes Required

#### 1. Public quiz projection

**File**: `src/quiz/public.ts` (new), exported through `src/quiz/index.ts`

**Intent**: Produce the version of the quiz that may reach a browser — prompts and option text, and
nothing that reveals an answer.

**Contract**: A `publicQuiz` value and a `PublicQuestion` type built by an **explicit allowlist** of
fields per question kind (`id`, `kind`, `prompt`, and `options` as `{ id, text }` for the two choice
kinds), not by deleting keys from the real question. Allowlisting is what makes a future field added to
`schema.ts` invisible by default instead of leaked by default. Exported through `index.ts`, keeping
that module the single import site.

Note `points` is deliberately excluded: it is not an answer, but S-03 owns what an attendee is told
about scoring and there is no reason for this slice to decide it.

**File**: `src/quiz/public.test.ts` (new)

**Intent**: Fail the suite if any answer value ever reaches the projection.

**Contract**: Gathers every `correctOptionIds` entry, `acceptedAnswers` entry and `correctValue` from
the real definition, serialises `publicQuiz`, and asserts none of them appears in it — so a new
answer-bearing field added to `schema.ts` and forgotten here is caught by value, not only by key.
Plus a per-kind key assertion, and a fixture proving the detector fires (the `keys.test.ts` precedent:
a gate that silently stopped matching reads as compliance).

#### 2. The join route

**File**: `src/pages/api/quiz/join.ts` (new)

**Intent**: Claim a name for a device and hand back an opaque player id.

**Contract**: `export const POST: APIRoute`, reading `await request.formData()` per the project's
convention. Open — no host secret. Takes **either** a `displayName` (a fresh claim) **or** a
`playerId` (a device that already holds one and is coming back after a reload). Returns JSON with
Polish `error`/`message` strings, since the client renders them directly:

| Outcome | Status | Body |
| --- | --- | --- |
| Claimed | 200 | `{ player: { id, displayName }, state }` |
| Recognised (`playerId` hit) | 200 | `{ player, state, resumed: true }` |
| `playerId` miss | 404 | `{ error: … }` — the device clears its storage and falls back to the name form |
| Invalid name | 400 | `{ error: <the validation message> }` |
| Name taken | 409 | `{ error: "Ta nazwa jest już zajęta…" }` |
| No session / ended | 409 | `{ error: … }` — distinct messages, since "not started yet" and "already over" are different things for an attendee to read |
| Unconfigured / store failure | 503 | `{ error: … }` |

Returning the current `state` alongside the player means a joining device renders the host's current
question from the join response, with no second round trip inside the 30-second window.

**Does not publish.** 150 joins publishing 150 snapshots to 150 subscribers is the O(N²) fan-out the
spine contract forbids; the count reaches the room at the host's next action instead.

#### 3. Log vocabulary

**File**: `src/lib/session/log.ts`

**Intent**: Make the join burst visible in the log stream, which F-04 proved is the only way any hop
is observable at all — `vercel logs` streams what functions emit, not an access log.

**Contract**: Two entries appended to `SESSION_EVENTS`: `session.player.joined` and
`session.join.rejected`. The first carries `playerCount` only; the second carries `reason` naming the
*class* of rejection ("taken", "invalid", "closed"). **No new `LogFields` entry is needed and none may
be added for names** — `LogFields` stays closed, and the rejection reason must be a fixed class string,
never the submitted name. Add `playerCount?: number` to `LogFields` if the count field does not
already fit an existing one.

**File**: `src/lib/session/log.test.ts`

**Contract**: Assert the two new events are in the vocabulary, and keep whatever existing assertion
covers the closed field set.

### Success Criteria

#### Automated Verification

- Test suite passes: `bun run test`
- Type check clean: `bun run type-check`
- `public.test.ts` finds no answer value in the projection
- A route test covers each join outcome and asserts the join path never calls `publishSnapshot`
- A route test covers the `playerId` hit and miss paths

#### Manual Verification

- `curl -X POST -H "Origin: <base>" -F displayName=Anna <base>/api/quiz/join` claims, and a second
  identical call returns 409 (the `Origin` header is required — see the F-02 trap)
- Claiming `anna` after `Anna` is rejected; claiming before `start` is rejected with a distinct message
- Posting the returned `playerId` back returns the same player with `resumed: true`; an unknown `playerId` returns 404

**Implementation Note**: Pause for confirmation after this phase.

---

## Phase 3: The client runtime

### Overview

The shared client modules both views import, plus the two gates that keep a client module from
reaching into server-side code or shipping the quiz answers.

This is where Open Roadmap Question 2's answer becomes concrete.

### Changes Required

#### 1. Session client

**File**: `src/lib/client/session.ts` (new)

**Intent**: One implementation of the spine contract's client rule, so two views (and every view after
them) cannot drift apart on it.

**Contract**: Exports a factory taking a callback and returning a handle. It fetches `/api/quiz/state`
once, then connects `new Ably.Realtime({ authUrl: "/api/quiz/token" })` and subscribes to the snapshot
event, invoking the callback with whichever snapshot carries the higher `version` and dropping
anything not newer. Also surfaces connection state so a view can tell "waiting for the host" from
"my connection died" — three distinguishable states, which is the whole reason `ended` is a phase.

Channel name and event name come from `define:vars`, not from importing `keys.ts` — see the gate in §4
for why. Prime-then-subscribe order is load-bearing and documented in `src/pages/api/quiz/state.ts`.

#### 2. Player storage

**File**: `src/lib/client/player.ts` (new)

**Intent**: Read and write the device's player record in `localStorage`, behind a narrow interface, so
S-09's resume has one place to extend.

**Contract**: `readPlayer()` / `writePlayer(player)` / `clearPlayer()` over a `{ id, displayName }`
shape, tolerating absent, malformed and unavailable storage (Safari private mode throws on write) by
returning `null` rather than throwing — nothing here may break a join. The storage key arrives via
`define:vars` from `PLAYER_STORAGE_KEY`.

Docstring states the retention position explicitly: this is attendee data on the attendee's own
device, outside `purge`'s reach and outside the guardrail's "operator-accessible" wording.

The stored record is **read on every page load**, not only written — that read is what makes a reload
survivable, and `clearPlayer()` is what a `playerId` miss calls so a device does not carry a ghost
player across sessions. S-09 extends this to a score-intact resume; this slice establishes the
handshake.

#### 3. Rendering helpers

**File**: `src/lib/client/render.ts` (new)

**Intent**: The small DOM helpers both views need, so the hand-written-DOM cost of the no-framework
decision is paid once rather than per view.

**Contract**: A typed element lookup that throws on a missing id (`spine-check.astro`'s `el` helper,
promoted), a text setter, and a helper that renders a `PublicQuestion` into a container — prompt plus,
for choice kinds, the option list as static, non-interactive text. Non-interactive is deliberate: the
answer path is S-03's, and shipping clickable options that do nothing would look broken on stage.

#### 4. The client-boundary gate

**File**: `src/lib/client/boundary.test.ts` (new)

**Intent**: Fail the suite if a client module reaches into server-side code or into the quiz
definition. Both failures are silent: one leaks answers into a public bundle, the other pulls
`import.meta.env` reads and `zod` into a phone's download budget.

**Contract**: Follows `portability.test.ts`'s shape — read the source off disk and assert a textual
property with a failure message that explains the rule. Forbidden: any **value** import from
`src/quiz/` or from `src/lib/session/` (`import type` is erased and therefore allowed), and any
reference to `import.meta.env`. Include a fixture case proving the detector fires.

**Scanned: every `.ts` under `src/lib/client/`, *and* the `<script>` blocks of
`src/pages/quiz/*.astro`.** The pages are the surface most likely to hold the violation — Phase 4 puts
view logic in inline scripts, which is exactly where someone reaches for `import.meta.env` — and a gate
that covers only the shared modules would miss it. `keys.test.ts:38` already scans those same files for
the same reason ("frontmatter runs server-side ... a key literal there would be as real as one in a
`.ts` module").

Frontmatter is **excluded** from the scan: it runs server-side and legitimately reads env and imports
server modules. So the scan takes what is between `<script>` and `</script>`, not the whole file. Say
that in the failure message too, or the first person to hit it will delete a legitimate frontmatter
import.

`spine-check.astro` is the only page in scope when this phase runs, and it passes: its
`define:vars` block receives `hostSecret` as an already-resolved variable rather than reading
`import.meta.env` itself, and its second script imports only `ably`. So the gate needs no exemption —
worth checking rather than assuming, since an exemption added on day one is an exemption forever.

#### 5. Extend the key-registry scan

**File**: `src/lib/session/keys.test.ts`

**Intent**: Close the gap this slice opens — the scan covers `src/lib/session/`, `src/pages/api/quiz/`
and `src/pages/quiz/`, and a new directory is invisible to it.

**Contract**: Add `src/lib/client/` to `sourceFiles()`. One line, and the existing failure message
already explains the rule.

### Success Criteria

#### Automated Verification

- Test suite passes: `bun run test`
- Type check clean: `bun run type-check`
- `boundary.test.ts` fires on its fixture and passes on the real modules
- `keys.test.ts` now scans `src/lib/client/`

#### Manual Verification

- Nothing user-visible yet; review is of the module boundaries

**Implementation Note**: Pause for confirmation after this phase.

---

## Phase 4: The two views

### Overview

`/quiz` for attendees and `/quiz/host` for the host — the first production LiveQuiz UI.

### Changes Required

#### 1. The attendee view

**File**: `src/pages/quiz/index.astro` (new)

**Intent**: Claim a name, then follow the host. Polish, phone-first, and legible in a dark room.

**Contract**: On demand — **no `prerender` export**, since it must render the current session state per
request (the project's rendering convention; see CLAUDE.md's route table). Frontmatter passes
`publicQuiz`, `SESSION_CHANNEL`, `SNAPSHOT_EVENT` and `PLAYER_STORAGE_KEY` to the client via
`define:vars`, and reads no secret of any kind.

Two states in one page, toggled client-side: a name form, and the follow view. **Which one appears on
load is decided by the stored player**: if `readPlayer()` returns a record, the page posts its
`playerId` to the join route and goes straight to the follow view on a hit; on a miss it clears
storage and shows the form. A device with nothing stored shows the form immediately without a
round trip. This is the reload path and it is not optional — a reloading attendee who is sent back to
the form cannot re-claim the name they are already holding. The follow view renders
by phase — lobby ("waiting for the host"), `question-open`/`question-revealed` (the current question
from the embedded projection, looked up by `currentQuestionId`), `ended` (the segment is over), and a
distinct connection-lost state.

A sixth case: **state going `null` while a device is already in the follow view**, which is what a
purge looks like from a phone. Render it as `ended`, not as the name form — the session really is over
and sending someone back to a form they cannot complete is the F1 failure in a different costume. This
is the live path; the load path (a stored `playerId` that no longer resolves) is handled above by
falling back to the form, which is correct there because there is no session to be in. A question id absent from the projection renders a neutral placeholder
rather than an error: it means the definition changed under a live session, which
`sessionStateSchema` already guards server-side but which the client should survive gracefully.

On a rejected claim the field keeps focus and its value, and the Polish error appears beside it. On a
successful claim the player is written to storage and the state from the join response is applied
immediately, so the first render costs no extra round trip.

**The submit control must disable on first press and stay disabled until the response resolves**
(added 2026-08-08 from impl review F4). Two fast taps mint two player ids; the first claims the name
and the second comes back `taken` — so the attendee is told their own just-claimed name is
unavailable, and the device may discard the valid id the first request returned. Double-tapping a
button that has not visibly responded is the ordinary thing to do on a phone against a thirty-second
clock, so this is the expected path, not an edge case. `spine-check.astro` already does exactly this
for host actions; copy that.

Uses `BaseLayout`? **No** — the layout carries the site navbar, footer and OG metadata for a content
site, and this is a full-screen single-purpose view. Follow `spine-check.astro`'s precedent of its own
document shell, but styled with Tailwind utilities rather than an inline `<style>` block, since
Tailwind 4 is wired through the Vite plugin and available here.

#### 2. The host view

**File**: `src/pages/quiz/host.astro` (new)

**Intent**: Drive the segment from the stage, and show the room what it needs to see.

**Contract**: On demand, no `prerender`. **Reads no secret in frontmatter** — the host types it into a
field, it is held in `sessionStorage`, and every action sends it as the `x-livequiz-host-secret` header
to the existing `/api/quiz/host/*` routes. A missing or wrong secret surfaces the routes' existing
Polish 401 message rather than a bespoke one.

Shows: the current phase, the current question's prompt at large-screen scale, the join count from
`playerCount`, the version, and the attendee URL for the room to type. Controls: `start`, `advance`,
`reveal`, and an explicit refresh that re-fetches `/api/quiz/state` — the refresh is how the host
watches the lobby fill, since no join publishes anything. Buttons disable during a request, following
`spine-check.astro`'s pattern.

`end` and `purge` are **not** here. F-03 deliberately set the irreversible verbs apart, and they stay
on `spine-check.astro`, which keeps its confirmation flow.

The action-response handling must distinguish the three non-plain outcomes the host routes already
return — `applied: false` with a note (already applied / no-op), a 502 with state committed but
broadcast failed, and a 401 — because reporting any of them as plain success or plain failure is what
makes a host retry the wrong thing on stage.

#### 3. Point the harness at the real views

**File**: `src/pages/quiz/spine-check.astro`

**Intent**: Its docstring says "S-02 owns the real attendee view" as a future statement. Make it a
present one, so a reader cannot mistake its embedded-secret pattern for precedent.

**Contract**: Docstring edit only — name `/quiz` and `/quiz/host` as the production views, state that
this page survives because it is the only surface exercising `end` and `purge`, and state that its
browser-side secret is the reason it must stay behind `LIVEQUIZ_HARNESS`. No behaviour change.

### Success Criteria

#### Automated Verification

- Build succeeds: `bun run build`
- Type check clean: `bun run type-check`
- Test suite passes: `bun run test` — including `keys.test.ts` over the two new pages
- Neither new page references `LIVEQUIZ_HOST_SECRET` (grep, or an assertion in the boundary test)

#### Manual Verification

- Against a preview deployment, on two devices: host starts, phone shows the lobby; host advances,
  phone shows question 1 within a second; host advances again, phone follows
- A second phone claiming the same name is rejected and the field keeps its value and focus
- Double-tapping the join button does not report the attendee's own name as taken (impl review F4)
- A phone reloading mid-question comes back as the **same player**, without being shown the name form
  and without re-claiming, and re-renders the current question without waiting for a host action
- A phone whose stored player no longer exists (after a purge) falls back to the name form cleanly
- The host view's phase, prompt and join count are legible from across a room
- The join count increases after the host taps refresh in the lobby
- Killing the phone's connection shows the connection-lost state, distinct from lobby and from ended
- The host view with no secret entered shows the routes' Polish 401 message

**Implementation Note**: This is the first phase with anything to look at. Pause for the two-device run
before Phase 5 — a rehearsal against production is expensive to repeat.

---

## Phase 5: Measure the join burst

### Overview

Extend `scripts/rehearse-room.ts` with a join stage, so the atomic name claim is exercised by 150
concurrent claims against the real store rather than only by mocked tests — the one failure mode a
green suite cannot catch, and the roadmap's named top risk for this slice.

### Changes Required

#### 1. A join stage in the harness

**File**: `scripts/rehearse-room.ts`

**Intent**: After `start` and before the flow verbs, have all N simulated devices claim a name at once,
and report what happened.

**Contract**: Each client POSTs `/api/quiz/join` with a distinct generated name, all fired
concurrently. Reports: how many claims succeeded, the wall-clock distribution of the burst
(min/p50/p95/max, matching the existing latency reporting), how many were rejected and why, and
**whether any two players hold the same folded name** — read back from the players hash directly, since
that is the guarantee FR-008 exists to provide and the reason the claim is a Lua script.

Also add a deliberate collision probe: a small number of clients claim a name that differs from an
already-claimed one only by case and diacritics, and every one of them must be rejected.

The script already holds Redis credentials for its pre-flight check, so reading the hash back needs no
new configuration. Keep the existing pre-flight refusal and the `--purge-stale` recovery path
untouched; `purge` already covers the new keys because they are registered.

#### 2. The report

**File**: `context/changes/join-and-follow-host/join-burst-report.md` (new)

**Intent**: Record the first measurement of the join path, against FR-002's 30-second target.

**Contract**: The run's parameters (N, base URL, region, deployment id), the burst distribution, the
duplicate-name result, the collision-probe result, and the command-counter delta before and after —
which is also the first reading taken with attendee writes in the system, so it recalibrates the
tripwire Phase 0 questioned.

State the honest limits, following F-04's precedent: one process on one network is a **lower bound**,
not a venue simulation; the harness measures the claim round trip, not a phone painting a screen; and
therefore **the 30-second target is informed by this figure but not proven by it**. F-04's lesson that
"a baseline is a range or it is wrong" applies — report multiple runs, not the best one.

### Success Criteria

#### Automated Verification

- `bun run type-check` clean with the harness change
- Harness unit-testable parts (name generation, distribution maths) covered if they are non-trivial

#### Manual Verification

- An N=150 run reports 150 of 150 claims succeeded with zero duplicate folded names
- The collision probe is rejected 100% of the time
- The join burst completes well inside the 30-second target, with the distribution recorded
- At least three runs recorded, reported as a range
- Command-counter delta recorded before and after, and the 200K tripwire re-examined against it
- `scripts/check-purge-residue.ts` reports an empty namespace after teardown

**Implementation Note**: Pause for confirmation. If a duplicate name appears, stop — that is the
failure the whole design of Phase 1 exists to prevent, and it invalidates the slice rather than
needing a patch.

---

## Phase 6: Record the decisions

### Overview

The interactivity decision, the retention decision, and the new conventions have to be findable by the
five slices that build on them — and by whoever reads `CLAUDE.md` first.

### Changes Required

#### 1. Project guidance

**File**: `CLAUDE.md`

**Intent**: Three additions to the Project guide section (after the generated block's END marker).

**Contract**:
- The route table gains `/quiz` and `/quiz/host` as on-demand routes.
- A short section on the client-interactivity convention: `src/lib/client/` holds browser modules
  imported by Astro `<script>` tags, `define:vars` is the handoff, no UI framework is installed and
  none should be added, and `boundary.test.ts` is what enforces that a client module neither reads
  `import.meta.env` nor value-imports `src/quiz/` or `src/lib/session/`. Name the two failure modes it
  prevents, because the rule reads arbitrary without them.
- The LiveQuiz session-data section gains the two player keys and the rule that **names never enter a
  published snapshot** — with the reason (Ably's ~120 s floor) and the pointer to the retention
  contract.

Note the existing `src/lib/` description says "Server-side modules"; that sentence needs qualifying now
that `src/lib/client/` exists.

#### 2. Runbook

**File**: `docs/runbook-live-session.md`

**Intent**: The host's procedure changed — there is a real view now, and a secret to paste.

**Contract**: §Before the session gains: open `/quiz/host`, paste the host secret, confirm the field is
accepted by taking one throwaway action (which the existing guidance already requires for the log
stream anyway), and put `/quiz` on the large screen. §During the session gains: the join count only
refreshes on a host action or an explicit refresh — that is by design, not a bug. Also update the
command-counter tripwire figure if Phase 5 recalibrated it.

#### 3. An S-02 contract for the slices that follow

**File**: `context/changes/join-and-follow-host/join-contract.md` (new)

**Intent**: The third in the series after `spine-contract.md` and `retention-contract.md` — a pointer,
not a second copy of this plan.

**Contract**: One page. The client convention and the two gates that enforce it. The player key shapes
and the fact that the reverse index exists for S-09. That names are **not** in the snapshot, that this
was a deliberate choice, and that S-07 therefore still owns how a leaderboard gets names — with both
options named. That the join count is embedded outside the version guard and why a stale count is
acceptable. And the scope boundary: no answers, no scores, no resume, no per-device cap.

Keep it short. Both predecessors carry the warning that a contract file growing past a page has become
a duplicate that can disagree with the plan.

#### 4. Roadmap and PRD

**Files**: `context/foundation/roadmap.md`, `context/foundation/prd.md`

**Intent**: Close Open Roadmap Question 2 and record what this slice decided about the retention
deviation.

**Contract**: Roadmap Question 2 marked resolved with the decision and its one-line rationale, keeping
the original text visible per the file's own convention. S-02's Unknowns updated — the interactivity
unknown is answered, the join-measurement unknown is answered by Phase 5's figure with its stated
limits. In `prd.md`, Deviation 2's sentence "From S-02, when snapshots begin carrying display names"
is now **counterfactual** and must be corrected: snapshots do not carry display names, by this slice's
decision, so the ~2-minute window does not apply to names — and the note should say S-07 inherits the
open choice.

### Success Criteria

#### Automated Verification

- Test suite passes: `bun run test`
- Type check clean: `bun run type-check`

#### Manual Verification

- Roadmap Question 2 reads as resolved, with the decision and the accepted cost both visible
- `prd.md`'s Deviation 2 no longer asserts something untrue about snapshots
- `join-contract.md` fits on a page
- A reader of `CLAUDE.md` alone would not add a UI framework or put a name in a snapshot

---

## Testing Strategy

### Unit Tests

- **Name validation** — every accepted and rejected shape; whitespace collapsing; the folding
  equivalence classes including a `ł`-bearing pair, which is where a naive NFD fold breaks
- **The claim** — each of the five outcomes; and that it is exactly one `eval` with three keys, which
  is the assertion that stops the atomicity being refactored away
- **`playerCount`** — parses when absent (the mid-deploy case), round-trips through `end`
- **Host action** — the published snapshot carries the count; a failed count read does not fail the
  action
- **Public projection** — no answer value from the real definition appears in it, by value not only by
  key; per-kind key allowlist; detector fixture
- **Client boundary** — no `import.meta.env`, no value import from `src/quiz/` or `src/lib/session/`;
  detector fixture
- **Key registry** — the scan now covers `src/lib/client/` and both new pages

### Integration Tests

There is no integration test runner in this project and adding one is out of scope. The equivalent
coverage is: route-level tests against mocked store and realtime modules (`routes.test.ts`'s existing
pattern), plus the harness run in Phase 5 against the real store and the real provider — which is the
only place the atomicity claim is actually tested rather than asserted.

### Manual Testing Steps

1. Host opens `/quiz/host`, pastes the secret, clicks **start** — lobby appears with count 0
2. Phone opens `/quiz`, types a name, joins — sees the lobby state
3. Host clicks refresh — count reads 1
4. Second phone claims the same name in different case — rejected, field keeps focus and value
5. Second phone claims a different name — joins
6. Host clicks **advance** — both phones show question 1 within a second
7. Reload one phone mid-question — it re-renders question 1 without a host action
8. Put one phone in airplane mode — connection-lost state, distinct from lobby and from ended
9. Host advances through several questions including the word-cloud and number kinds — prompts render,
   options are non-interactive, nothing looks broken
10. Open a phone's devtools and confirm no answer value from any question is present in the page or
    bundle
11. Host clicks **advance** past question 14 — the no-op path, reported as such, nothing breaks
12. On `spine-check.astro`, `end` the session — both phones show the ended state
13. Try to join after `end` — rejected with the "already over" message, distinct from "not started"
14. `purge`, then confirm an empty namespace with `scripts/check-purge-residue.ts`

## Performance Considerations

The 1000 ms fan-out guardrail has 111–592 ms of measured p95 spent before the client library receives
a snapshot, and **paint time is not in that figure** — it is this slice's cost. Two decisions protect
it: the public quiz projection is embedded at page render so switching questions needs no network at
all, and the client bundle is essentially the Ably SDK because no framework was added. Neither is
measured as a number in this slice; Phase 5 measures the join burst instead, and paint time stays a
manual two-device observation. That is a stated gap, not an oversight — instrumenting paint time was
considered and deliberately left out of scope.

Store cost: joining adds one `EVAL` per attendee (~150 per session) and one `HLEN` per host action
(~15). Both are trivially inside the free tier, and neither is a polling pattern. The command-counter
readings in Phase 0 and Phase 5 are what keep that claim honest rather than assumed.

## Migration Notes

No data migration — session data is not retained past an event. One deploy-time concern: a session
running when this ships has a document without `playerCount`, which is why that field is defaulted
rather than required. Anyone doing that deploy should not: the host should `purge` first, per the
runbook.

Rollback: a code rollback removes the views and the join route, but **does not remove keys already
written to the store**. They are registered, so the four-hour TTL and `purge` both reach them; nothing
is orphaned. Worth remembering that rollback never reverts what is already in Ably or in the log
stream (F-03's lesson).

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-02, Open Roadmap Question 2
- Change notes and inherited baggage: `context/changes/join-and-follow-host/change.md`
- Spine contract (three non-reliances, the client rule, two traps):
  `context/archive/2026-08-06-session-state-and-realtime-spine/spine-contract.md`
- Retention contract (four rules, and the decision handed to this slice):
  `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Fan-out baseline and its stated limits:
  `context/archive/2026-08-06-room-scale-rehearsal-harness/rehearsal-report.md`
- The client pattern being promoted: `src/pages/quiz/spine-check.astro:163`
- The host write path being reused: `src/lib/session/host.ts:144`
- Gate precedents: `src/lib/session/keys.test.ts`, `src/quiz/portability.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: Settle the command-counter anomaly

#### Manual

- [ ] 0.1 Two counter readings recorded with at least a few hours between them, taken with nothing running
- [ ] 0.2 The diagnostic file states a verdict rather than only the numbers
- [x] 0.3 ~~If the idle figure rises, the finding is raised before Phase 1 starts rather than filed~~ — **struck 2026-08-08**: unachievable as written. Phase 1 shipped in `93a7900` long before reading 2 could be taken, so there is no "before Phase 1" left to raise anything in. The surviving obligation is 0.2's verdict; see `command-counter-diagnostic.md`.

### Phase 1: The player store

#### Automated

- [x] 1.1 Test suite passes: `bun run test` — 93a7900
- [x] 1.2 Type check clean: `bun run type-check` — 93a7900
- [x] 1.3 `keys.test.ts` still passes — no namespaced literal outside `keys.ts` — 93a7900
- [x] 1.4 `claimPlayer` is asserted to be a single `eval` call — 93a7900
- [x] 1.5 A session document without `playerCount` parses and defaults to `0` — 93a7900

#### Manual

- [x] 1.6 Reading `keys.ts` makes clear what attendee data each new key holds, without opening this plan — 93a7900

### Phase 2: The join endpoint and the public quiz projection

#### Automated

- [x] 2.1 Test suite passes: `bun run test` — 45ff3d8
- [x] 2.2 Type check clean: `bun run type-check` — 45ff3d8
- [x] 2.3 `public.test.ts` finds no answer value in the projection — 45ff3d8
- [x] 2.4 A route test covers each join outcome and asserts the join path never calls `publishSnapshot` — 45ff3d8
- [x] 2.7 A route test covers the `playerId` hit and miss paths — 45ff3d8

#### Manual

- [x] 2.5 `curl -X POST -H "Origin: <base>" -F displayName=Anna <base>/api/quiz/join` claims, and a second identical call returns 409 (the `Origin` header is required — see the F-02 trap) — 45ff3d8
- [x] 2.6 Claiming `anna` after `Anna` is rejected; claiming before `start` is rejected with a distinct message — 45ff3d8
- [x] 2.8 Posting the returned `playerId` back returns the same player with `resumed: true`; an unknown `playerId` returns 404 — 45ff3d8

### Phase 3: The client runtime

#### Automated

- [x] 3.1 Test suite passes: `bun run test` — 58895b5
- [x] 3.2 Type check clean: `bun run type-check` — 58895b5
- [x] 3.3 `boundary.test.ts` fires on its fixture and passes on the real modules — 58895b5
- [x] 3.4 `keys.test.ts` now scans `src/lib/client/` — 58895b5

#### Manual

- [x] 3.5 Nothing user-visible yet; review is of the module boundaries — 58895b5

### Phase 4: The two views

#### Automated

- [x] 4.1 Build succeeds: `bun run build` — 27ef48d
- [x] 4.2 Type check clean: `bun run type-check` — 27ef48d
- [x] 4.3 Test suite passes: `bun run test` — including `keys.test.ts` over the two new pages — 27ef48d
- [x] 4.4 Neither new page references `LIVEQUIZ_HOST_SECRET` (grep, or an assertion in the boundary test) — 27ef48d

#### Manual

- [x] 4.5 Against a preview deployment, on two devices: host starts, phone shows the lobby; host advances, phone shows question 1 within a second; host advances again, phone follows — 06022fb
- [x] 4.6 A second phone claiming the same name is rejected and the field keeps its value and focus — 06022fb
- [x] 4.7 A phone reloading mid-question comes back as the **same player**, without being shown the name form and without re-claiming, and re-renders the current question without waiting for a host action — 06022fb
- [x] 4.12 A phone whose stored player no longer exists (after a purge) falls back to the name form cleanly — 06022fb
- [x] 4.13 Double-tapping the join button does not report the attendee's own name as taken (impl review F4) — 06022fb
- [x] 4.8 The host view's phase, prompt and join count are legible from across a room — 06022fb
- [x] 4.9 The join count increases after the host taps refresh in the lobby — 06022fb
- [x] 4.10 Killing the phone's connection shows the connection-lost state, distinct from lobby and from ended — 06022fb
- [x] 4.11 The host view with no secret entered shows the routes' Polish 401 message — 06022fb

### Phase 5: Measure the join burst

#### Automated

- [x] 5.1 `bun run type-check` clean with the harness change — 43648d9
- [x] 5.2 Harness unit-testable parts (name generation, distribution maths) covered if they are non-trivial — 43648d9

#### Manual

- [x] 5.3 An N=150 run reports 150 of 150 claims succeeded with zero duplicate folded names — 43648d9
- [x] 5.4 The collision probe is rejected 100% of the time — 43648d9
- [x] 5.5 The join burst completes well inside the 30-second target, with the distribution recorded — 43648d9
- [x] 5.6 At least three runs recorded, reported as a range — 43648d9
- [x] 5.7 Command-counter delta recorded before and after, and the 200K tripwire re-examined against it — 43648d9
- [x] 5.8 `scripts/check-purge-residue.ts` reports an empty namespace after teardown — 43648d9

### Phase 6: Record the decisions

#### Automated

- [x] 6.1 Test suite passes: `bun run test`
- [x] 6.2 Type check clean: `bun run type-check`

#### Manual

- [x] 6.3 Roadmap Question 2 reads as resolved, with the decision and the accepted cost both visible
- [x] 6.4 `prd.md`'s Deviation 2 no longer asserts something untrue about snapshots
- [x] 6.5 `join-contract.md` fits on a page
- [x] 6.6 A reader of `CLAUDE.md` alone would not add a UI framework or put a name in a snapshot
