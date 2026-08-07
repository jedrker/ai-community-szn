# Join and Follow Host (S-02) — Plan Brief

> Full plan: `context/changes/join-and-follow-host/plan.md`

## What & Why

An attendee opens `/quiz` on their phone, claims an unused display name, and from that moment sees
whatever question the host has open. The host drives the segment from `/quiz/host`. This is the first
slice where the F-02 spine meets real devices and the first that writes real attendee data — and it
resolves **Open Roadmap Question 2**, the roadmap's most consequential unstated decision, which binds
S-03 through S-08.

## Starting Point

The spine is complete: authoritative state in Upstash Redis behind a Lua version guard, snapshot
fan-out over Ably measured at **p95 111–592 ms across seven N=150 runs** against a 1000 ms budget, an
open subscribe-only token endpoint, and `end`/`purge` with a key registry. What does not exist: any
production UI (the only page is a dev-only harness that ships the host secret to the browser), any
notion of a player (`SessionState` is five flow fields), any client module layer, and any answer to
how the interactive views get their behaviour — no UI framework is installed and `tech-stack.md`
records that the stack is "not a SPA".

## Desired End State

The host clicks start; the large screen shows the lobby with a join count and the attendee URL.
Attendees join by name — or are told the name is taken and asked for another. The host advances;
every joined phone shows the question within a second. A phone that reloads re-renders the current
question immediately. Nothing is answerable yet; that is S-03.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Client interactivity (Open Q2) | Vanilla TS modules in `src/lib/client/`, no framework | Already proven end-to-end in the harness page, and keeps the bundle to essentially the Ably SDK for an unmeasured 30-second join target on a venue network | Plan |
| Host view authorisation | Host types the secret, held in `sessionStorage`, sent as a header | The page stays as unprotected as the PRD wants while the write path stays guarded, and the secret never enters the HTML or the bundle | Plan |
| Names in published snapshots | Never — the snapshot gains only `playerCount` | S-02 does not need names on the wire, so the PRD's recorded ~120 s Ably deviation stops growing and S-07 inherits an explicit choice rather than a fait accompli | Retention contract → Plan |
| Player identity | Opaque server-generated id, stored in `localStorage` and **read back on load** | A reloading attendee holds their own name, so without a read-back they are rejected by their own claim and locked out for the segment (plan review F1) | Plan |
| Name uniqueness | Claim on the `normalizePolish` fold, display as typed | `Anna`/`anna`/`ANNA` on one leaderboard is exactly the ambiguity FR-008 exists to prevent; reuses the existing fold rather than inventing a second | Plan |
| Quiz payload to the browser | All 14 questions, allowlist-sanitised, embedded at page render | Removes a round trip from the path the 1-second guardrail measures — and paint cost is the half of that budget F-04 did not measure | Plan |
| Join count delivery | Read at host-action time, embedded in the snapshot, plus an explicit refresh | Publishing on join is the O(N²) fan-out the spine contract forbids; polling is the pattern the command-counter tripwire exists to catch | Spine contract → Plan |
| Routes | `/quiz`, `/quiz/host` | Shortest thing to type from the back of a room, and keeps every session route under the prefix `keys.test.ts` already scans | Plan |
| Name moderation | Length and character limits only | Consistent with the PRD's recorded decision to accept unmoderated content on the projector | PRD → Plan |
| Command-counter anomaly | Diagnosed in Phase 0, before any attendee write | After S-02 writes, attendee writes and the unexplained 513→4102 baseline cannot be separated | Change notes → Plan |
| Measurement scope | Harness extended to time the 150-device join burst; paint time stays manual | Proves the Lua claim under real concurrency — the one failure mode a mocked test cannot catch | Plan |
| `spine-check.astro` | Kept unchanged but for a docstring | It is the only surface exercising `end`/`purge` with their confirmation flow, which the runbook and rehearsal recovery both lean on | Plan |

## Scope

**In scope:** the atomic name claim; two registered player keys plus a reverse index; `playerCount`
on the session document; `POST /api/quiz/join`; a sanitised public quiz projection; shared client
modules and two gates enforcing their boundary; the `/quiz` and `/quiz/host` views; a join-burst
measurement; and the documentation of what was decided.

**Out of scope:** answering, scoring and reveal handling (S-03); leaderboard and word cloud (S-07,
S-08); participation count and answer distribution (S-04); score-intact resume, reconnect survival and
the per-device player cap (S-09 — but recognising a reloading device *is* in scope, see below); any
name blocklist; any UI-framework integration; any throttling; CI.

## Architecture / Approach

```
phone → /quiz (on-demand page, embeds sanitised quiz + channel names via define:vars)
          │  POST /api/quiz/join ── one Lua EVAL ── livequiz:players (folded name → record)
          │                          reads session doc, checks phase,                │
          │                          claims, arms both TTLs               livequiz:player-ids
          │                                                                (id → folded name)
          └─ GET /api/quiz/state (prime) → Ably subscribe → apply higher version, drop older

host  → /quiz/host (secret typed, sessionStorage, x-livequiz-host-secret header)
          └─ existing /api/quiz/host/{start,advance,reveal}
               applyHostAction: read state + HLEN → compute next → version guard → publish
```

Joining publishes nothing. The count reaches the room at the host's next action.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 0. Counter diagnostic | Two idle readings and a verdict on the 513→4102 delta | Human-only step; needs real elapsed time between reads |
| 1. Player store | Registered keys, name validation and fold, the atomic claim, `playerCount` | The claim must stay one `EVAL`; a JS guard passes every mocked test and fails on stage |
| 2. Join API + projection | `POST /api/quiz/join`, allowlisted public quiz, two log events | A field added to `schema.ts` later leaking answers into the browser |
| 3. Client runtime | `src/lib/client/` modules plus the boundary and registry gates | A client module value-importing the quiz would ship all 14 answers silently |
| 4. The two views | `/quiz` and `/quiz/host`, Polish, phone- and room-legible | Paint time is unmeasured and is the missing half of the 1-second budget |
| 5. Join burst | 150 concurrent claims measured against production; duplicate check | A duplicate name invalidates the slice rather than needing a patch |
| 6. Record decisions | CLAUDE.md, runbook, `join-contract.md`, roadmap and PRD corrections | The PRD currently asserts something this slice makes untrue |

**Prerequisites:** S-01 and F-02 are `done`. Phase 0 needs Upstash console access; Phase 4's manual
verification needs a preview deployment and two devices; Phase 5 needs production plus
`LIVEQUIZ_HOST_SECRET` and the Redis credentials the harness already reads.

**Estimated effort:** ~4–6 sessions across seven phases, with Phase 0 and Phase 5 gated on human
steps that cannot be compressed.

## Open Risks & Assumptions

- **Paint time stays unmeasured.** Instrumenting it was considered and deliberately left out; the
  fan-out budget therefore has a known unquantified component, carried forward to S-08.
- **The 30-second join target is informed, not proven.** One process on one network is a lower bound,
  not a venue simulation — F-04's stated limit applies unchanged.
- **The command-counter anomaly may not resolve.** If the idle reading is flat, the delta is
  attributed to something outside the application and the tripwire's calibration is the only casualty;
  if it rises, that is a finding larger than this slice and Phase 1 should not start on top of it.
- **The no-framework decision gets more expensive per slice.** S-07's leaderboard and S-08's
  continuously-updating word cloud are hand-written DOM. Recorded so a later slice can reverse it
  knowingly.
- **Names still have to reach S-07 somehow.** This slice keeps them off the wire; it does not decide
  how a leaderboard gets them.
- **The S-09 boundary is now a line rather than a wall.** Recognising a reloading device landed here
  because the end state depends on it; S-09 keeps score-intact resume, reconnect survival and the
  flood guard. Worth restating in `join-contract.md` so S-09's author is not surprised.

## Success Criteria (Summary)

- An attendee goes from opening `/quiz` to being in the session with a name of their own, and a name
  already taken is rejected with the field intact rather than silently accepted
- Every joined phone shows the host's current question within a second of the host acting, and a
  reloaded phone renders it without waiting for the next action
- 150 concurrent claims produce 150 players and zero duplicate names against the real store
