# Session End and Data Purge — Plan Brief

> Full plan: `context/changes/session-end-and-data-purge/plan.md`
> Roadmap item: F-03 in `context/foundation/roadmap.md`

## What & Why

The PRD carries a guardrail that nothing has yet been built to satisfy: "No attendee's display name
or submitted answer remains in operator-accessible storage after the session that collected it has
ended." Today a session has no ending at all — the only exit is a 4-hour TTL — and nobody has checked
what the *other* two storage surfaces retain. This slice gives the host a deliberate way to end a
session and a way to wipe one immediately, and turns the guardrail into a contract the next three
slices break the build by ignoring.

## Starting Point

F-02 shipped a working spine: one Redis key holding one JSON document, a 4-hour TTL re-armed inside
the same Lua `EVAL` as every write, three host verbs (`start`/`advance`/`reveal`) behind a shared
secret, snapshot-per-publish over Ably, and a dev-only harness. The purge mechanic itself is already
trivial — the archived plan says "One key means TTL is one property and F-03's purge is one `DEL`."

What is missing is everything around it. There is no end verb. There is one lifetime for every
situation. There is no namespace discipline, so nothing stops S-02 writing a key the purge cannot
reach. Ably's retention has never been measured, though it receives the entire session state on every
host action. And the no-names-in-logs rule is a docstring sitting above an open index signature.

## Desired End State

A host can close the segment on purpose, and can wipe the room's data immediately if they want to.
Ten minutes after an ordinary end — or four hours after an abandoned one — nothing about who played
remains in Redis. Nothing identifying was ever retained by Ably. Writing a display name into a log
line is a type error. And a future slice that invents an unregistered key fails `bun run test`.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| End semantics | `end` freezes into a terminal phase and re-arms every key to ~10 min; a separate `purge` deletes now | The guardrail holds even if the host walks off stage without pressing anything — the roadmap's stated realistic outcome — while the short window lets a reload still show the final leaderboard |
| Lifetimes | 4h active (unchanged), ~10 min after end | The active value's rationale is documented and still correct; changing it would be churn |
| Purge guard | Host secret + a version-confirmation value, and `end` refused while a question is open | Every other host verb is safe *because* a replay is a no-op; `end` is this project's first irreversible action, so it must be safe because a replay is *refused* |
| Ably retention | Probe it, configure the channel for ephemerality, record the finding | Both prior foundations were burned by confident vendor docs that were wrong, and only a probe caught it |
| Future-slice contract | A registered key namespace enforced by a test | This project's gates have only held when a test enforced them — F-02's post-mortem found a documented gate that was dead code |
| Log surface | Close `LogFields` so a name field is a compile error | S-02's most natural implementation logs a join by name, into a stream no TTL covers |
| Verification | A residue check run against the real Upstash database | The risk is a key created outside the registry, which a mocked store cannot know about |
| Client storage | Out of scope | S-09 introduces same-device resume and owns its own lifecycle; deciding it here plans against an unwritten design |

## Scope

**In scope:** an `ended` phase; `end` and `purge` host routes; a key registry with an enforcement
test; a second TTL; the Ably retention probe and channel configuration; a closed log field set; a
real-store residue check; harness controls; a retention contract for S-02/S-03/S-07; PRD, runbook,
risk register, roadmap and `CLAUDE.md` updates.

**Out of scope:** the attendee-facing closing screen (S-02 owns the attendee view); client-storage
lifecycle (S-09); players, answers, scores, standings; any change to the 4-hour active TTL; rate
limiting; a second host secret; CI.

## Architecture / Approach

Three storage surfaces, closed three different ways. **Redis** gets a declared `livequiz:` namespace
that every future key must be registered in, so `end` can re-arm all of them and `purge` can delete
all of them — each in a single Lua `EVAL`, because N separate round trips over Upstash's HTTP
interface can partially fail and report success. **Ably** gets a channel rule set from measurement
rather than documentation. **Logs** get a closed TypeScript field set, so the existing docstring rule
becomes a compile error.

Both verbs share one ordering: write, publish, and — for `purge` — then delete. `purge` is `end` plus
a `DEL`, not a parallel path. Writing before publishing is what guarantees the broadcast carries a
strictly higher version, which matters because the client drops any snapshot not newer than what it
holds; a purge that republished the session at its existing version would be discarded by every
device, and the failure would look like a dead network rather than a bug.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Probe Ably retention | Measured retention window, channel configured, findings artifact | Human-only dashboard step; the floor may not reduce to zero |
| 2. Registry, lifetime, log constraint | `keys.ts` + enforcement test, `ENDED_TTL_SECONDS`, closed `LogFields` | Removing the index signature may break existing call sites |
| 3. `ended` phase and the two verbs | Fourth phase with its own invariant, `end` and `purge` routes with guards | The guards *are* the safety story; each is one condition from useless |
| 4. Prove the namespace is empty | Real-store residue check, harness controls, verification artifact | Needs real credentials; must refuse to run against a live room |
| 5. Contract and documents | `retention-contract.md`, runbook, risk register, roadmap, `CLAUDE.md` | A contract that duplicates the plan can disagree with it |

**Prerequisites:** F-02 (done). Ably dashboard access for the Phase 1 channel rule. Upstash
credentials for the Phase 4 residue check.
**Estimated effort:** ~2–3 sessions. Phases 2 and 3 are the bulk; Phase 1 is short but gated on a
human step; Phase 5 is documentation.

## Open Risks & Assumptions

- **The Ably retention floor may not be zero.** If persistence cannot be fully disabled, the residual
  window becomes a recorded risk rather than a closed surface — and it would strengthen the case for
  keeping display names off the channel entirely, which is an S-02 design constraint this slice would
  then have to hand forward.
- **The registry test catches literals, not concatenation.** A textual gate has a known hole; the
  real-store residue check is what covers the rest, and it needs credentials so nothing catches this
  automatically. There is no CI.
- **The ten-minute window is data deliberately retained.** For those minutes the guardrail is
  satisfied by a TTL rather than by a deletion — and on the PRD's literal wording ("after the session
  that collected it has ended") that is a deviation, not a satisfaction. Phase 5 records it in
  `prd.md` as an accepted, reasoned deviation rather than rewording the guardrail to match.
- **A rollback during the ten-minute window strands the document.** Old code cannot parse
  `phase: "ended"`, so `/api/quiz/state` returns 409 until the key expires. Bounded, but real.
- **The closing screen is only half-delivered here.** F-03 ships the terminal state and proves it
  reaches a device via the harness; the screen an attendee sees is S-02's.

## Success Criteria (Summary)

- A host can end a session deliberately, cannot end one mid-question, and cannot end one by replaying
  a request.
- After a purge — verified against the real store, not a mock — the `livequiz:` namespace is empty.
- A future slice that invents an unregistered key, or logs a display name, fails before it ships.
