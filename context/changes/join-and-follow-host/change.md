---
change_id: join-and-follow-host
title: Join and follow host
status: impl_reviewed
created: 2026-08-07
updated: 2026-08-08
archived_at: null
---

## Notes

Roadmap item **S-02**. Prerequisites S-01 and F-02 are both `done`, so nothing blocks planning. What
follows is the baggage this slice inherits — carried here so the plan does not have to rediscover it
from the archive.

### The open decision this slice owns

**How do the host and attendee views get their client behaviour?** Open Roadmap Question 2, and the
roadmap assigns ownership to `/10x-plan` on this slice. No UI-framework integration is installed
(no React / Svelte / Vue) and `tech-stack.md` records that the framework is content-first and
explicitly "not a SPA". The answer shapes every view after this one — S-03 (answer + reveal), S-04
(large-screen distribution), S-07 (leaderboard), S-08 (a word cloud that updates continuously rather
than on host action). Decided 2026-08-07 that the plan researches this and returns a recommendation
rather than the choice being made up front.

Note `@astrojs/tailwind@6.0.2` is installed but deliberately unreferenced (CLAUDE.md) — do not take
its presence as precedent for adding integrations casually.

### The name claim must be atomic in the store

F-02 recorded this as one of three failure modes not to rediscover live: with ~150 devices joining in
the same few seconds, resolving a display-name claim with a read-then-write pair hands two attendees
the same name and the leaderboard stops being unambiguous — the guarantee FR-008 exists to provide.

F-02's delivery lesson sharpens it: **read-modify-write over Upstash's HTTP interface is three round
trips with no isolation, so the compare-and-set must live in a Lua `EVAL`.** A JS-level guard passes
every mocked test and drops a host action on stage. `src/lib/session/store.ts` already holds the
version guard as a single `EVAL` and `store.test.ts` asserts it stays one call — follow that shape.

### Retention contract is required reading before any key or snapshot field

**This is the first slice that writes real attendee names.** Read
`context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` before adding any
`livequiz:` key or any field to a published snapshot. Three mechanisms bind:

- Every namespaced name is declared in `src/lib/session/keys.ts` and nowhere else; `keys.test.ts`
  fails the suite on a literal elsewhere. A key created outside the registry is reached by neither
  `end` nor `purge` and sits holding attendee data with nothing to say so.
- `LogFields` is a closed type. Never pass a display name or an answer to `logSessionEvent` — logs are
  retained ~1 hour, covered by no TTL, no purge and no rollback.
- **Ably retains a published snapshot for ~120s and that floor cannot be configured away** (measured,
  not assumed). From this slice on, the snapshot carries names, so it is retrievable for ~2 minutes by
  anything holding a subscribe token — and `GET /api/quiz/token` is deliberately open and unthrottled
  (accepted risk with a tripwire in `infrastructure.md`). If the ~2-minute window is judged
  unacceptable once real names are involved, **the remedy is this slice's to take: publish opaque
  player ids and keep names off the channel.**

  > **Corrected 2026-08-07 during planning.** The sentence "From this slice on, the snapshot carries
  > names" was an expectation, not a fact, and the plan decided against it. `SessionState` gains only
  > `playerCount` — a count, not attendee data — so **no display name is ever published** and the
  > ~120s window does not apply to one. Names live in `livequiz:players`; a device knows only its own.
  > That is the remedy above, taken in its stronger form: rather than publishing opaque ids, this slice
  > publishes nothing per-player at all, which also avoids the O(N²) fan-out a publish-on-join design
  > would have caused. **S-07 still owns the open half** — a leaderboard needs names on 150 screens,
  > and how they get there is that slice's decision, now made deliberately rather than inherited. The
  > original text is left above rather than edited, so the expectation and its reversal stay visible.

### Resolve the command-counter anomaly before adding writes

The state store's command counter read **513 → 4102** across seven rehearsal runs, against roughly
**60** that the code accounts for (minting a token touches no store key; a host action is one `get`
plus one `EVAL`). Two orders of magnitude unexplained, far below the 200K polling tripwire but
unexplained all the same — see `context/archive/2026-08-06-room-scale-rehearsal-harness/rehearsal-report.md`.

**Worth settling before this slice lands**, because S-02 adds the first real attendee writes to that
store and afterwards the two causes cannot be separated. The diagnostic is cheap: read the counter
twice with nothing running.

### Measurement context this slice inherits

- F-04 measured fan-out at **p95 111–592 ms across seven N=150 runs** from `fra1` against a 1000 ms
  budget — but **arrival is measured at the client library, not at a painted phone screen. Rendering
  cost is this slice's, and it is not in that figure.**
- The 30-second join target (FR-002) is **not yet measured**. F-04 drove host actions and fan-out; a
  150-device join burst against a venue network is a different question, and the harness connects its
  pool before `start` rather than timing the join as a user-visible step.
- `scripts/rehearse-room.ts` is structured so an answer path can be added after S-03 and the run
  repeated. If this slice makes joining measurable, extending the harness is the cheaper option than
  writing a second one.
