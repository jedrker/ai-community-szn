# Session State and Realtime Fan-out Spine — Implementation Plan

## Overview

Stand up the spine every remaining LiveQuiz slice rides on: one live session's state held
server-authoritatively in Upstash Redis under a short, self-re-arming TTL, and a host state change
fanned out over Ably to every connected device inside one second — with the browser receiving a
short-lived, subscribe-only token from this project's own endpoint and never a provider key.

This is roadmap item **F-02**. It closes the last part of PRD Open Question 7 in code (the vendor
choice was already decided in the roadmap) and unblocks S-02, F-03 and F-04.

## Current State Analysis

The project has no server-held state and no realtime transport of any kind.

- **No vendor packages.** `package.json`'s `dependencies` block has neither `ably` nor
  `@upstash/redis`. The set is Astro, Tailwind, Resend, glightbox, zod.
- **The serverless surface already exists.** `astro.config.ts` sets `output: "server"` with
  `@astrojs/vercel`, and two POST handlers already run on demand (`src/pages/api/`). Adding stateful
  on-demand routes needs no serving-model change — PRD Open Question 1 settled this.
- **No persistence that works.** `src/lib/newsletter.ts` is backed by Resend Audiences precisely
  because the previous file-backed store could never succeed on a read-only serverless filesystem.
  There is no database and no writable disk (CLAUDE.md states this as a rule).
- **The quiz data contract is done.** `src/quiz/index.ts` exports `quiz`, `getQuestionById` and the
  question types, parsed once at module scope and deliberately free of `astro:` specifiers so it
  resolves inside a serverless function and a bare `vitest run`
  (`src/quiz/portability.test.ts` enforces this). This slice consumes it and must never import
  `definition.ts`.
- **The error posture is fixed by precedent.** `src/lib/slack.ts:1-21` is the pattern CLAUDE.md and the
  roadmap both name: missing configuration warns and no-ops, failures are caught and logged with
  context, nothing throws into a request path. `src/pages/api/newsletter-signup.ts:20-30` shows the
  route-level half: catch, `console.error` with context, return a Polish message and a `503`.
- **Tests have an established shape.** `src/lib/newsletter.test.ts:1-11` mocks the vendor module with
  `vi.mock` and imports the module under test afterwards; `vi.stubEnv` supplies `import.meta.env`
  values. There is no `vitest.config.*` — the default resolution is what runs.
- **The region is live.** `vercel.json` declares `regions: ["fra1"]` and is committed on `main`, so
  production functions run in Frankfurt. The transatlantic penalty F-01 was sequenced to remove is
  gone.
- **Logging is a delivered requirement, not a nicety.** F-01 verified empirically that `vercel logs`
  streams what functions *emit*, not an access log: ~100 requests to on-demand routes produced zero
  output. `docs/runbook-live-session.md` §Before the session states that F-02 onward must instrument
  session start, join, answer submission and purge deliberately, "or the host will spend the session
  watching an empty terminal. Treat that as a requirement on those slices, not a nicety."

## Desired End State

A host action issued against a deployed preview moves authoritative state in Redis and appears in a
real browser on a second device in under a second, and the terminal tailing `vercel logs` shows a
structured line for every session mutation.

Concretely, when this plan is complete:

- `src/lib/session/` exposes a typed, Zod-validated session state and the only sanctioned way to read
  or mutate it. Every mutation is a compare-and-set against a version, executes atomically in the
  store, and re-arms the key's TTL.
- `GET /api/quiz/token` returns an Ably token request scoped to the session channel with
  `subscribe` capability only. It never returns the API key, and with configuration missing it fails
  clearly rather than throwing.
- `GET /api/quiz/state` returns the current snapshot, so a device that connects or reloads between two
  host actions renders current state immediately instead of waiting for the next one.
- `POST /api/quiz/host/{start,advance,reveal}` require the host secret, mutate state through the
  session module, publish the full new snapshot, and on any store or transport failure return a Polish
  error the host can read on stage while logging the cause.
- A harness at `/quiz/spine-check`, reachable only when an explicit env flag is set, drives those
  endpoints from one screen and renders arriving snapshots with a client-measured delta on another.
- `context/changes/session-state-and-realtime-spine/latency-probe.md` records the observed
  host-action-to-browser delta **with the function region it was measured in**, as F-04's input.

**Verification**: `bun run test`, `bun run type-check` and `bun run build` all pass; the harness on a
preview deployment shows a sub-second delta on a second device; `vercel logs` shows one structured
line per host action.

### Key Discoveries:

- **`src/lib/slack.ts:1-21`** is the error posture the roadmap explicitly mandates for the token
  endpoint. Copy its shape, but see the Critical Implementation Details note — a *host action* must
  not no-op quietly the way a missing Slack webhook does.
- **`src/quiz/index.ts:49`** (`export const quiz`) parses the quiz once at module scope, so a serverless function pays it on
  cold start only. Session state stores question *ids*, not question copies — the definition is
  already available in-process.
- **`src/lib/newsletter.test.ts:1-11`** — `vi.mock` the vendor module, then `await import` the module
  under test. This is the only mocking pattern in the repo; follow it rather than introducing
  dependency injection.
- **`src/quiz/portability.test.ts`** exists because `astro:content` resolves in neither vitest nor a
  serverless function. `src/lib/session/` has the same constraint and the same reason to keep
  `astro:` specifiers out of it.
- **Preview deployments are SSO-protected** (F-01, `region-probe.md`): anonymous requests get a `302`
  to Vercel SSO. Verifying the harness needs a logged-in browser; an anonymous `curl` only ever sees
  the redirect.
- **`@astrojs/tailwind@6.0.2` is installed but unreferenced** (CLAUDE.md). Do not touch it here; it is
  a separate cleanup.

## What We're NOT Doing

- **No join flow, no display names, no name-collision handling.** S-02 owns all of it, including the
  atomic claim the roadmap flags as its top risk. This slice ships no players.
- **No answering, no scoring, no leaderboard.** S-03 and S-07. The session state carries flow only.
- **No explicit end-and-purge endpoint.** F-03. This slice's TTL is what makes the retention guardrail
  hold in the meantime.
- **No 150-device load test.** F-04. One device, one figure, recorded with its region.
- **No real host or attendee UI, and no UI-framework integration.** No React/Svelte/Vue is installed
  here. The harness uses a plain `<script>` in an `.astro` file. Open Roadmap Question 2 stays open
  and stays S-02's.
- **No Ably presence.** `infrastructure.md` names the O(N²) join storm; the design broadcasts from
  authoritative state instead.
- **No CI.** Open Roadmap Question 3, out of scope roadmap-wide.
- **No Vercel Pro upgrade.** Deferred by user decision in F-01; the accepted risks and their tripwire
  stand unchanged.
- **No fix to the newsletter endpoint's known issues.** Unrelated; `health-check.md` owns them.

## Implementation Approach

Four phases, ordered so each one is independently verifiable and so the two things that can only be
learned by probing are learned first.

**Phase 1 provisions and probes.** Vendors get added and configured, and then a throwaway probe
confirms two things documentation cannot be trusted for: which environment variable names the Vercel
Marketplace integration actually injected, and that a round trip from `fra1` works. F-01's central
lesson was that two confident `infrastructure.md` claims were wrong and only a probe caught them.

**Phase 2 builds the store layer** with no transport in it, so its atomicity can be unit-tested in
isolation. The session is a single JSON document under one key, mutated by a compare-and-set on a
monotonic `version`. One key means TTL is one property and F-03's purge is one `DEL`.

**Phase 3 adds the transport.** Every publish carries the entire new snapshot plus its version.
Clients replace their state wholesale and ignore anything not newer than what they hold. This is what
structurally removes the divergence guardrail's failure mode: a device that missed a message is
correct again on the next one, and a reconnecting device needs no replay.

**Phase 4 proves it moves.** A gated harness drives the real endpoints from a real browser, and the
resulting number is written down with the region it was measured in.

## Critical Implementation Details

**State sequencing — the version guard must run inside the store, not in JavaScript.** Upstash's
interface is HTTP request/response: a `GET`, a mutation in JS, then a `SET` is three round trips with
no isolation, so two host actions arriving within the same few milliseconds will both read version *n*
and both write version *n+1* — losing one. The compare-and-set, the version bump and the TTL re-arm
must therefore execute as a single `EVAL` (Upstash supports `EVAL` over its REST interface), returning
the stored version so the caller can tell a rejected write from an accepted one. A JS-side guard looks
correct in review and in every unit test, and drops a host action on stage.

**Timing & lifecycle — TTL re-arms on write, so an idle host cannot expire the room.** Every accepted
mutation resets the key to its full 4-hour lifetime inside the same `EVAL`. A separate `EXPIRE` call
is a second round trip that can fail on its own and leave the session immortal.

**Debug & observability — the log line is a deliverable.** `vercel logs` shows only what the function
emits, and successful renders are silent (F-01, verified). Every session mutation and every publish
emits exactly one structured single-line JSON record with a stable prefix, so the host can grep the
stream during a live segment. This is what `docs/runbook-live-session.md` §Before the session already
promises the host will exist.

---

## Phase 1: Provision and probe the two vendors

### Overview

Add the two dependencies, document the configuration set, provision Upstash and Ably, and then verify
by probe — not by documentation — that the credentials the platform injected are the ones the code
reads and that a round trip from Frankfurt works.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the Redis HTTP client and the Ably SDK. Upstash's client is chosen over any TCP Redis
driver specifically because it speaks HTTP, so a serverless function needs no persistent connection —
one of the three reasons the roadmap recorded for the store decision.

**Contract**: `@upstash/redis` and `ably` in `dependencies` (both are needed at runtime in the
serverless function, not just at build). Install with `bun add`, never npm or yarn. Do not touch the
`@astrojs/vercel`, `zod`, `vite` or `typescript` ranges — each is pinned for a documented reason in
CLAUDE.md, and `ably` must not be allowed to pull a second `zod`.

#### 2. Configuration surface

**File**: `.env.example`

**Intent**: Document every new variable the spine reads, so the required set stays discoverable in the
one place the project already uses for it.

**Contract**: Four additions — the Upstash REST URL and REST token, `ABLY_API_KEY`, and
`LIVEQUIZ_HOST_SECRET`. Plus `LIVEQUIZ_HARNESS` (Phase 4's gate), documented as intentionally unset in
production. Use placeholder values in the existing style. The exact Upstash variable *names* are
confirmed by the probe below before being written here.

#### 3. Provisioning (human-gated)

**File**: none — platform actions

**Intent**: Create the Upstash database in the EU region matching `fra1` and the Ably app, then set
every variable in Vercel's per-environment store. An agent cannot complete this: Marketplace
provisioning is an interactive dashboard flow and `vercel env add` needs an authenticated CLI. F-01
hit the same wall with `vercel login`.

**Contract**: An Upstash Redis database provisioned via the Vercel Marketplace, region EU (Frankfurt
if offered, to match the function region). An Ably app with an API key whose capabilities cover
publish and subscribe on the session channel. `ABLY_API_KEY`, `LIVEQUIZ_HOST_SECRET` (a generated
random string) and the Upstash pair present in Production and Preview; `LIVEQUIZ_HARNESS` set in
Preview only. Record in the plan's Progress notes which environment each variable landed in.

#### 4. Configuration probe

**File**: `scripts/probe-spine-config.ts`

**Intent**: Establish empirically which environment variable names the Marketplace integration
injected, and that both vendors answer from a deployed function in `fra1`. `infrastructure.md`'s own
§Unknown Unknowns notes that first-party Vercel KV no longer exists and that guidance naming it is out
of date — the injected names are exactly the sort of claim F-01 proved worth probing.

**Contract**: A script run through `bun` that reads the environment, reports which of the candidate
Upstash names are present, performs a `SET`/`GET`/`TTL` round trip on a throwaway key with a short
TTL, and requests an Ably token. It prints findings and exits non-zero on failure. It is a probe, not
shipped behaviour: it must not be imported by anything under `src/`. Whatever it learns about the
variable names is what gets written into `.env.example` and read by Phase 2.

**It must also execute a trivial `EVAL`** — a script that compare-and-sets a version on a throwaway key
and returns the stored value — because Lua scripting over Upstash's REST interface is the single claim
all of Phase 2 rests on, and this phase exists to test exactly that class of claim rather than inherit
it. Probing `SET`/`GET` and not `EVAL` would confirm the easy half and assume the load-bearing half. If
the `EVAL` fails or is restricted on the provisioned tier, **stop and reopen Phase 2's approach before
writing any of it** — the alternative would be an advisory lock or a version-key-plus-`SETNX` scheme,
and that is a design decision, not an implementation detail.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `bun install`
- Exactly one copy of zod remains: `find node_modules -type d -name zod` prints one line
- Types pass: `bun run type-check`
- Existing suite still passes: `bun run test`
- Build still passes, quiz gate included: `bun run build`
- Probe round-trips both vendors and confirms `EVAL` executes:
  `bun scripts/probe-spine-config.ts`

#### Manual Verification:

- Upstash database exists in an EU region and is linked to the Vercel project
- Every new variable is present in Vercel's Production and Preview stores, and `LIVEQUIZ_HARNESS` is
  present in Preview only
- The variable names in `.env.example` match what the probe actually found, not what documentation
  predicted

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: The session state module

### Overview

Build the store layer with no transport in it: a Zod-validated session document, one key, and a
compare-and-set write that is atomic in the store and re-arms the TTL. Plus the structured logger the
runbook requires.

### Changes Required:

#### 1. Session state shape

**File**: `src/lib/session/state.ts`

**Intent**: Define what one live session *is* — flow only, no players and no scores — as a Zod schema
so a malformed document read back from the store is caught at the boundary rather than rendered.
Modelled on `src/quiz/schema.ts`'s posture: the schema is the contract, and it validates on the way
in.

**Contract**: A `sessionStateSchema` and its inferred `SessionState` type. Fields: `version` (a
monotonic integer, starting at 1), `phase` (a discriminated set covering at minimum
`lobby` / `question-open` / `question-revealed`), `currentQuestionId` (a quiz question id or null),
`startedAt` and `updatedAt` as epoch milliseconds. Question ids are validated against
`getQuestionById` from `src/quiz/index.ts` on write, so state can never point at a question that does
not exist. Import `zod` directly; no `astro:` specifiers anywhere in this directory — the
`src/quiz/portability.test.ts` constraint applies here for the same reason.

#### 2. Store client

**File**: `src/lib/session/store.ts`

**Intent**: Own the single Redis client and the single key, and expose read plus compare-and-set write
as the only ways to touch session state. Nothing outside this file constructs a client or knows the
key name.

**Contract**: Construct `Redis` explicitly from `import.meta.env` values rather than using
`Redis.fromEnv()` — the project reads secrets through `import.meta.env` by convention (CLAUDE.md), and
`fromEnv()` reads `process.env` and hard-codes names the probe may have disproven. Exports: a
`readSession()` returning `SessionState | null`, a `writeSession(expectedVersion, next)` returning a
discriminated result (`applied` with the stored state, or `stale` with the current version), and a
`createSession()` for the initial document. Missing configuration produces a clear, typed failure —
callers must be able to distinguish "not configured" from "conflict" from "transport failed", because
Phase 3 renders three different outcomes from them.

The compare-and-set, version increment and TTL re-arm execute in a single Lua `EVAL`, not as separate
JS steps — see Critical Implementation Details. TTL is 4 hours, re-armed on every accepted write. This
is the one place in the plan where a snippet is warranted, because the atomicity of the whole design
rests on this call being one round trip:

```
-- KEYS[1] = session key, ARGV[1] = expected version, ARGV[2] = next state JSON, ARGV[3] = ttl seconds
-- Returns the stored version on success, or the current version when the guard rejects.
```

#### 3. Structured logging

**File**: `src/lib/session/log.ts`

**Intent**: Emit one greppable single-line JSON record per session event, because `vercel logs` carries
only what the function emits and the runbook already promises the host these lines will be there.

**Contract**: A `logSessionEvent(event, fields)` writing one `console.log` line of JSON with a stable
prefix, an event name, and the session version. It never throws and never awaits. Event names are a
closed set defined here so S-02, S-03 and F-03 extend the same vocabulary rather than inventing one.

**As shipped, the set is eight** — the five this plan first named (`session.created`,
`session.action.applied`, `session.action.stale`, `session.publish.ok`, `session.publish.failed`) plus
three the implementation needed: `session.read.invalid` and `session.unconfigured` for the two failure
modes `store.ts` distinguishes, and `session.auth.rejected`, added in impl-review triage because folding
an unauthorized host action into `session.action.stale` hid the only security-relevant signal behind the
one event the runbook tells the host to ignore. `log.ts` is the source of truth; extend it there.

#### 4. Tests

**File**: `src/lib/session/store.test.ts`, `src/lib/session/state.test.ts`

**Intent**: Prove the guard and the schema, and prove the guard's *rejection* path specifically —
a stale write silently succeeding is the failure this design exists to prevent, and it is invisible
without a test that asserts it.

**Contract**: Follow `src/lib/newsletter.test.ts:1-11` — `vi.mock` the `@upstash/redis` module, then
`await import` the module under test, with `vi.stubEnv` supplying configuration. Cover: a fresh
session is created at version 1; a write with the expected version is applied and bumps the version; a
write with a stale version returns `stale` and does not mutate; missing configuration is reported as
such rather than throwing; a document that fails the schema on read is reported rather than returned;
state cannot be written pointing at an unknown question id. Assert that the write path issues a single
`eval` call — the test that would catch someone "simplifying" the Lua back into JS.

### Success Criteria:

#### Automated Verification:

- New and existing tests pass: `bun run test`
- Types pass: `bun run type-check`
- Build passes: `bun run build`
- No `astro:` *import* under the new directory (comments may name the constraint, and
  `portability.test.ts` must contain the string it searches for):
  `grep -rnE "(from|import)[[:space:]]*\(?[[:space:]]*['\"]astro:" src/lib/session/` finds nothing.
  `src/lib/session/portability.test.ts` is the enforcing check.

#### Manual Verification:

- Against the real Upstash database, two concurrent writes at the same expected version produce one
  `applied` and one `stale` — not two successes
- The key's TTL is observably re-armed after a write, not decaying from creation
- A session event line appears in `vercel logs` in the expected structured form

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 3: The Ably spine and host actions

### Overview

Add the transport: a token endpoint that hands the browser subscribe-only access, a publish helper
that broadcasts the whole versioned snapshot, and the three host endpoints that mutate state behind
the shared secret.

### Changes Required:

#### 1. Realtime module

**File**: `src/lib/session/realtime.ts`

**Intent**: Own the Ably server client, the channel name, and the two things the server does with the
transport: mint a scoped token request, and publish a snapshot.

**Contract**: A single channel name for the session, defined here and nowhere else. Exports a
`createTokenRequest()` returning an Ably token request scoped to that channel with `subscribe`
capability only — no publish, so a client cannot forge state even with a valid token — and a
`publishSnapshot(state)` publishing the full `SessionState`. Uses Ably's REST client, not Realtime: a
serverless function must not open a persistent connection. Missing configuration is a typed failure,
matching `store.ts`. No presence, ever — `infrastructure.md` records the O(N²) join storm.

#### 2. Token endpoint

**File**: `src/pages/api/quiz/token.ts`

**Intent**: Give the browser a short-lived credential from our own server, so `ABLY_API_KEY` never
leaves it. This is the specific requirement in F-02's stated outcome and in `infrastructure.md`
§Getting Started step 3.

**Contract**: `export const GET: APIRoute`, on demand (no `prerender` export, per the project's
rendering convention). Returns the token request as JSON. Missing configuration returns a Polish error
and a `503` with the cause logged — the `src/pages/api/newsletter-signup.ts:20-30` shape. Open to
anyone, deliberately: the token it mints can only subscribe.

#### 3. Host action endpoints

**File**: `src/pages/api/quiz/host/start.ts`, `advance.ts`, `reveal.ts`

**Intent**: The host's three verbs. Each reads current state, computes the next one, writes it through
the version guard, and publishes the accepted snapshot.

**Contract**: `export const POST: APIRoute` each, on demand, reading `await request.formData()` per the
project's API convention. Every one requires `LIVEQUIZ_HOST_SECRET`, compared against a value on the
request; a mismatch returns `401` with a Polish message and logs the attempt.

`start` creates the session at version 1 in `lobby` and is idempotent — called against an existing
session it returns that session rather than resetting it. It deliberately does **not** open the first
question: PRD FR-002 keeps the explicit start precisely because "the deliberate start is what lets the
host gather the room before the first question", and the drafted quiz's opening two questions are
written for that beat. `advance` moves to the next question in `quiz.questions` order — from `lobby`
that means question 1 — and is a no-op past the last one. `reveal` moves the current question to
revealed and rejects when no question is open. Responses carry the new state and its version so the
harness can render without a second read.

**When the version guard rejects.** A `stale` result is not an error and must not be reported as one:
the realistic trigger is a host double-tapping `advance` on stage, where the second tap is a no-op and
the room is already where the host wanted it. The endpoint re-reads current state and returns it with a
status distinguishable from an applied write, which the harness renders as "already applied" rather
than as a failure. It also emits the "rejected as stale" log event. What it must never do is return
plain success — the host would count two advances and lose track of where the room is.

Failure behaviour, decided for this slice: **fail loud to the host, log, never throw.** A store or
publish failure returns a Polish error the control view displays and a `503`, with the cause logged —
not the quiet warn-and-no-op that `src/lib/slack.ts` uses for a missing webhook. See Critical
Implementation Details: a silently dropped host action leaves the room on the previous question while
the host believes they advanced, which is worse on stage than an error message. A publish that fails
after an accepted write is reported as such and is retryable, because the state is already committed
and republishing the same snapshot is idempotent by version.

#### 4. State read endpoint

**File**: `src/pages/api/quiz/state.ts`

**Intent**: Let a device that just connected — or just reloaded — render current state without waiting
for the host's next action. The snapshot-per-publish rule makes a device that *missed* a message
self-correcting, but it does nothing for a device that was not yet listening, and between two host
actions that wait is unbounded.

**Contract**: `export const GET: APIRoute`, on demand, returning the current `SessionState` as JSON, or
a null-state response when no session exists (not a `404` — "no session yet" is a normal state the
harness and S-02 both render). Reads through `readSession()`; no secret required, since the same data
is already broadcast to every subscriber. Store failure returns a Polish error and a `503` with the
cause logged, matching the token endpoint.

Clients hold one rule for both sources: apply whichever of the fetched snapshot and the subscribed
snapshot carries the higher `version`, and ignore anything not newer than what is already held. That
rule is what makes the fetch and the subscription safe to race, and it is the same rule the transport
side already relies on. Cost is one request per device per *connect* — not per host action, so this is
not the broadcast-a-nudge design rejected under Performance Considerations.

#### 5. Tests

**File**: `src/lib/session/realtime.test.ts`

**Intent**: Prove the token is subscribe-only and the publish carries the whole snapshot — the two
properties the guardrails depend on and the two most likely to regress silently.

**Contract**: `vi.mock` the `ably` module. Assert the token request's capability grants `subscribe`
and not `publish` on the session channel; assert `publishSnapshot` sends the complete state object
including `version`; assert missing configuration is a typed failure rather than a throw.

### Success Criteria:

#### Automated Verification:

- All tests pass: `bun run test`
- Types pass: `bun run type-check`
- Build passes: `bun run build`
- No route under the new API directory *exports* `prerender` (comments may name the convention):
  `grep -rnE "^[[:space:]]*export[[:space:]]+const[[:space:]]+prerender" src/pages/api/quiz/` finds nothing
- `ABLY_API_KEY` is *read* only in `src/lib/session/realtime.ts` (comments and
  `vi.stubEnv` in tests may name it):
  `grep -rnE "(import\.meta|process)\.env\.ABLY_API_KEY" src/` returns exactly one line

#### Manual Verification:

- `GET /api/quiz/token` on a preview returns a token request, and the response body contains no API
  key
- `GET /api/quiz/state` returns the current snapshot mid-session, and a null-state response before any
  session exists
- A host action without the secret is rejected with `401`
- A host action with the secret mutates state in Upstash and the change is observable on the Ably
  channel
- `start` leaves the session in `lobby` with no question open; the first `advance` opens question 1
- A double-fired `advance` moves the room exactly one question, and the second call reports
  "already applied" rather than success or an error
- With the Upstash credentials deliberately broken, a host action returns a readable Polish error and
  a logged cause — it does not hang, and it does not report success

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 4: Dev-only harness and the fan-out proof

### Overview

Drive the real endpoints from a real browser on a second device, measure the host-action-to-render
delta, and write the number down with the region it was measured in. Then record the contract S-02
consumes.

### Changes Required:

#### 1. Harness gate

**File**: `src/lib/session/harness.ts`

**Intent**: One place that decides whether the harness exists, so the check cannot drift between the
page and any endpoint that needs it.

**Contract**: An `isHarnessEnabled()` reading `LIVEQUIZ_HARNESS` from `import.meta.env`. Gating on an
explicit env flag rather than a build-mode check is deliberate: a Vercel preview is built in
production mode, so `import.meta.env.PROD` would not distinguish them. Preview additionally sits
behind Vercel Authentication (F-01), so the harness has two independent covers there and none in
production.

#### 2. Harness page

**File**: `src/pages/quiz/spine-check.astro`

**Intent**: A throwaway two-pane view — host controls on one side, a live snapshot readout on the
other — that exercises the spine end to end from a browser. It is the proof that F-02's outcome holds,
and it gives F-04 something to point simulated devices at.

**Contract**: On demand (no `prerender`). Returns `404` when the harness is disabled — not a redirect
and not an error page, so a probe cannot distinguish it from a route that was never deployed. Client
behaviour is a plain `<script>` in the `.astro` file using the Ably SDK with `authUrl` pointed at
`/api/quiz/token`; **no UI-framework integration is installed and none may be added here.** This is a
preliminary answer to Open Roadmap Question 2 for a throwaway surface only — S-02 still owns the real
decision, and this file is expected to be deleted or superseded there.

On load the readout fetches `/api/quiz/state` once, then subscribes; from then on it applies whichever
snapshot carries the higher `version` and discards anything not newer. Fetching before subscribing is
what makes a reload render immediately rather than waiting for the host's next action.

It renders the received `version`, `phase` and `currentQuestionId` plus the propagation delta. **The
headline delta is measured from the host's click**, taken in the host pane before the fetch begins —
not from the action's completion. The guardrail is "within 1 second of the host acting", so a figure
started at the response would exclude the endpoint round trip, the store `EVAL` and the publish, which
is most of the server-side budget; it would read comfortably under budget while the real number
might not be. Report the completion-to-arrival delta as a secondary figure, since the split between
server time and fan-out time is the useful diagnostic if the headline number disappoints. The two
panes are separate devices, so the host pane's timestamp travels with the action and comes back on the
snapshot rather than being compared across unsynchronised clocks.

The host pane sends the secret with each action — acceptable only because the harness never runs in
production.

**Astro's origin check applies to these POSTs.** Discovered in Phase 3: a POST that reads
`request.formData()` is rejected with `403 Cross-site POST form submissions are forbidden` before the
handler runs unless the `Origin` header matches. The harness's same-origin `fetch` satisfies this
automatically, so it needs no special handling — but it is effectively a second layer of host
protection, and anyone testing these routes with `curl` must pass `-H "Origin: <base-url>"` or they
will read a 403 as a broken endpoint.

#### 3. Latency record

**File**: `context/changes/session-state-and-realtime-spine/latency-probe.md`

**Intent**: Write down what was actually measured, with its region, so F-04 has a baseline it can
trust and F-01's upgrade tripwire has a real number behind it.

**Contract**: Method, date, the deployment probed, the function region confirmed via
`x-vercel-id` (`<edge>::<function-region>::<id>`), the observed deltas across several actions, and the
client device and network. State explicitly **which instant each figure starts from** — the headline
figure starts at the host's click, per the guardrail's wording, with completion-to-arrival recorded
separately. A number whose reference point is unstated is the same trap as a number whose region is
unstated: F-04 builds its baseline on this and F-01's upgrade tripwire is calibrated against it, and the
roadmap is explicit that a pre-`fra1` figure "must not be recorded as the baseline."

#### 4. Spine contract for downstream slices

**File**: `context/changes/session-state-and-realtime-spine/spine-contract.md`

**Intent**: Record what S-02, S-03, F-03 and F-04 may rely on and what they must not, so the next
slice extends this design rather than working around it.

**Contract**: Deliberately short — it is a pointer, not a second copy of the plan, which is not going
anywhere. Three non-reliances stated as rules: **no Ably presence** (the O(N²) join storm), **no
authoritative state in the browser** (the transport carries messages, it is not the truth), and **no
read-then-write on the store** (the version guard is the only sanctioned mutation path). Then links
into the relevant plan.md sections for the key layout, TTL behaviour, channel name, broadcast rule and
log vocabulary rather than restating any of them. If it grows past a page, it is drifting into being a
duplicate that can disagree with the plan.

#### 5. Runbook update

**File**: `docs/runbook-live-session.md`

**Intent**: The runbook currently carries a status note saying LiveQuiz does not exist yet and that
"the session" means the existing site. Part of that is now false, and the log-tailing step can finally
name what the host should expect to see.

**Contract**: Replace the status note with the current state — the spine exists, the live loop does
not — and add the structured log event names to §During the session so a host tailing the stream knows
what a healthy line looks like. Do not overstate: no attendee can join yet.

### Success Criteria:

#### Automated Verification:

- All tests pass: `bun run test`
- Types pass: `bun run type-check`
- Build passes: `bun run build`
- The harness page is gated, not merely unlinked: `grep -n "isHarnessEnabled" src/pages/quiz/spine-check.astro`
  finds the guard

#### Manual Verification:

- On a preview deployment with `LIVEQUIZ_HARNESS` set, a host action on one screen renders on a second
  device — a phone on a real network — in under one second **measured from the host's click**,
  repeatedly
- With `LIVEQUIZ_HARNESS` unset, `/quiz/spine-check` returns `404`
- A browser reload on the attendee pane renders current state immediately via the state fetch, with no
  replay and no divergence, without waiting for the next host action
- `latency-probe.md` records the region confirmed from `x-vercel-id`, not assumed, and names the
  instant each figure starts from
- `vercel logs` shows one structured line per host action during the run
- Every existing page still works: event archive, speaker directory, both signup forms

**Implementation Note**: This is the final phase. After manual confirmation, the change is ready for
`/10x-impl-review`.

---

## Testing Strategy

### Unit Tests:

- The version guard applies a matching write and rejects a stale one without mutating
- The write path issues exactly one store call — the regression test for someone moving the guard into
  JavaScript
- TTL is re-armed on an accepted write
- Session state cannot be written pointing at a question id absent from the quiz definition
- A malformed document read back from the store is reported, not returned
- Missing configuration is a typed, distinguishable failure in both `store.ts` and `realtime.ts`
- The minted token grants `subscribe` and not `publish`
- A published snapshot carries the complete state including `version`
- `start` produces a `lobby` state with no question open, and is idempotent against an existing session
- A `stale` write result is surfaced as "already applied", never as plain success

### Integration Tests:

None automated. There is no CI (Open Roadmap Question 3) and both dependencies are external vendors, so
the integration path here is the Phase 4 manual run against a preview deployment plus the Phase 1
probe script. Stated explicitly so the gap is a recorded decision rather than an omission — F-04 is
where the spine gets driven at scale.

### Manual Testing Steps:

1. Run the Phase 1 probe and confirm both vendors answer and the variable names match `.env.example`.
2. Against the real store, fire two writes at the same expected version and confirm one `applied`, one
   `stale`.
3. On a preview with the harness enabled, open the host pane on a laptop and the readout on a phone;
   run start, advance several times, and reveal; record each delta from the click.
   Double-tap `advance` once and confirm the room moves exactly one question.
4. Break the Upstash credentials in Preview and confirm a host action returns a readable Polish error
   with a logged cause, rather than hanging or reporting success.
5. Reload the phone mid-session and confirm it resumes on current state.
6. Confirm `/quiz/spine-check` is `404` with `LIVEQUIZ_HARNESS` unset.
7. Walk the existing site — event archive, an event page, speaker directory, both forms — and confirm
   nothing regressed.

## Performance Considerations

The binding budget is the one-second guardrail, and the design spends it in three places: the store
round trip, the publish, and Ably's fan-out. Functions run in `fra1` and the Upstash database is
provisioned in the EU, so both server hops are intra-region.

Two design choices are performance decisions rather than style ones. **One `EVAL` per host action**
means a mutation is one store round trip, not three. **Snapshot-per-publish** costs more bytes than a
delta but avoids the alternative that scales badly: broadcasting a nudge and having 150 devices each
fetch state would multiply store operations per host action by the room size — the polling-shaped cost
F-04's spend-alert unknown exists to catch.

Volume stays inside both free tiers: a 14-question session is on the order of 10–15K Ably messages and
15–25K store operations, against 6M messages/month and 500K commands/month. The binding ceiling is
technical, not financial — Ably's 200 peak connections against a 150-person room (Open Roadmap
Question 5).

## Migration Notes

No data migration. There is no existing session state to move and nothing in the existing site reads
or writes any of this.

Two rollback caveats, both from `infrastructure.md` §Operational Story and both worth knowing before
the first live use: `vercel rollback` reverts code only — it does not revert environment variables, and
it does not revert anything already held in Upstash or Ably. A code rollback therefore leaves a live
session document in place; the TTL is what removes it. This is the same property F-03's risk note
warns about from the other direction, and it is why the TTL is short.

## References

- Roadmap item: `context/foundation/roadmap.md` (F-02, and Open Roadmap Questions 1, 2, 3, 5)
- PRD: `context/foundation/prd.md` (Success Criteria guardrails, Open Question 7)
- Infrastructure decision: `context/foundation/infrastructure.md` (§Getting Started 3–4, §Risk Register)
- Predecessor and its lessons: `context/archive/2026-08-05-deployment-target-readiness/`
- Region evidence: `context/archive/2026-08-05-deployment-target-readiness/region-probe.md`
- Error posture to copy: `src/lib/slack.ts:1-21`
- Route error shape to copy: `src/pages/api/newsletter-signup.ts:20-30`
- Mocking pattern to copy: `src/lib/newsletter.test.ts:1-11`
- Quiz read contract: `src/quiz/index.ts`
- Portability constraint precedent: `src/quiz/portability.test.ts`
- Operational contract: `docs/runbook-live-session.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Provision and probe the two vendors

#### Automated

- [x] 1.1 Dependencies install cleanly: `bun install` — 08cceae
- [x] 1.2 Exactly one copy of zod remains: `find node_modules -type d -name zod` prints one line — 08cceae
- [x] 1.3 Types pass: `bun run type-check` — 08cceae
- [x] 1.4 Existing suite still passes: `bun run test` — 08cceae
- [x] 1.5 Build still passes, quiz gate included: `bun run build` — 08cceae
- [x] 1.6 Probe round-trips both vendors and confirms `EVAL` executes: `bun scripts/probe-spine-config.ts` — 32b1ed7

#### Manual

- [x] 1.7 Upstash database exists in an EU region and is linked to the Vercel project — 32b1ed7
- [x] 1.8 Every new variable present in Production and Preview; `LIVEQUIZ_HARNESS` in Preview only — 32b1ed7
- [x] 1.9 `.env.example` variable names match what the probe found, not what docs predicted — 32b1ed7

### Phase 2: The session state module

#### Automated

- [x] 2.1 New and existing tests pass: `bun run test` — dd32352
- [x] 2.2 Types pass: `bun run type-check` — dd32352
- [x] 2.3 Build passes: `bun run build` — dd32352
- [x] 2.4 No `astro:` import under the new directory (import-scoped grep + portability.test.ts) — dd32352

#### Manual

- [x] 2.5 Two concurrent writes at the same version produce one `applied` and one `stale` — dd32352
- [x] 2.6 The key's TTL is observably re-armed after a write — dd32352
- [x] 2.7 A session event line appears in `vercel logs` in the expected structured form (closed on production: 4 of 5 lines captured; the missed one is a stream-capture gap on the first invocation, not a behaviour gap — see runbook) — 25b7ca8

### Phase 3: The Ably spine and host actions

#### Automated

- [x] 3.1 All tests pass: `bun run test` — 3a2eb84
- [x] 3.2 Types pass: `bun run type-check` — 3a2eb84
- [x] 3.3 Build passes: `bun run build` — 3a2eb84
- [x] 3.4 No route under `src/pages/api/quiz/` exports `prerender` (export-scoped grep) — 3a2eb84
- [x] 3.5 `ABLY_API_KEY` is read only in `src/lib/session/realtime.ts` (env-read-scoped grep: 1 line) — 3a2eb84

#### Manual

- [x] 3.6 `GET /api/quiz/token` returns a token request containing no API key — 3a2eb84
- [x] 3.7 `GET /api/quiz/state` returns the current snapshot mid-session, and null-state before one exists — 3a2eb84
- [x] 3.8 A host action without the secret is rejected with `401` — 3a2eb84
- [x] 3.9 A host action with the secret mutates Upstash and is observable on the Ably channel (closed on production: versions climbed 1→2→3 in the store and `session.publish.ok` confirms each snapshot reached Ably) — 25b7ca8
- [x] 3.10 `start` leaves the session in `lobby`; the first `advance` opens question 1 — 3a2eb84
- [x] 3.11 A double-fired `advance` moves the room one question and reports "already applied" — 3a2eb84
- [x] 3.12 With Upstash credentials broken, a host action returns a readable Polish error and logs the cause — **SKIPPED by decision 2026-08-06.** Live confirmation would mean removing `KV_REST_API_TOKEN` from Preview, redeploying and restoring it; the path is covered by unit tests instead (`store.test.ts`: a transport failure returns `failed` rather than throwing; `host.test.ts`: it surfaces as 503 with a Polish message). Not verified against a live broken credential.

### Phase 4: Dev-only harness and the fan-out proof

#### Automated

- [x] 4.1 All tests pass: `bun run test` — 2320862
- [x] 4.2 Types pass: `bun run type-check` — 2320862
- [x] 4.3 Build passes: `bun run build` — 2320862
- [x] 4.4 The harness page is gated: `grep -n "isHarnessEnabled" src/pages/quiz/spine-check.astro` — 2320862

#### Manual

- [ ] 4.5 A host action renders on a second device on a real network in under one second measured from the click, repeatedly — **OUTSTANDING at close-out (2026-08-06).** Needs the harness on two devices; the preview is deployed and ready. Everything upstream is verified on production (atomic store write, `session.publish.ok`, structured logs); the unmeasured part is the last hop to a real device.
- [x] 4.6 With `LIVEQUIZ_HARNESS` unset, `/quiz/spine-check` returns `404` (confirmed on production, not just locally) — 25b7ca8
- [ ] 4.7 A browser reload renders current state immediately via the state fetch, with no replay and no divergence — **OUTSTANDING at close-out (2026-08-06).** Needs the harness on two devices; the preview is deployed and ready. Everything upstream is verified on production (atomic store write, `session.publish.ok`, structured logs); the unmeasured part is the last hop to a real device.
- [ ] 4.8 `latency-probe.md` records the region from `x-vercel-id` and names the instant each figure starts from — **partially done.** Method, reference points and the cross-device clock limitation are written; the measurement table is still `_pending_`. Deliberately not filled with an approximation: a figure recorded against the wrong reference is worse than no figure (plan review F4), and F-04 builds its baseline on this one.
- [x] 4.9 `vercel logs` shows one structured line per host action during the run (verified on production) — 25b7ca8
- [x] 4.10 Every existing page still works: event archive, speaker directory, both signup forms (verified on production) — 25b7ca8
