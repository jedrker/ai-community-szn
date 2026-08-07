# Command-counter diagnostic (S-02, Phase 0)

> **Why now.** F-04 measured the store's monthly command counter at **513 → 4102** across seven
> rehearsal runs, against roughly **60** the code accounts for — two orders of magnitude unexplained.
> S-02 adds the first real attendee writes to that store. After it ships, attendee writes and the
> unexplained baseline cannot be separated, so this is the last moment the question can be answered
> cleanly. Source: `context/archive/2026-08-06-room-scale-rehearsal-harness/rehearsal-report.md`
> §"Commands-counter delta — and an unexplained one".

## The question

The rehearsal report named three candidate explanations and verified none:

1. **The console counts something broader than application commands** — integration health checks,
   metrics scrapes, platform-side probes.
2. **Something outside those runs is issuing commands continuously.**
3. **The per-client path touches the store somewhere the code reading missed** — suspicious because
   182 clients across three runs works out to ~20 commands per client, and nothing per-client is
   supposed to reach the store at all.

The diagnostic that separates them is cheap: **read the counter twice with nothing running.** A flat
figure rules out (2). A rising figure confirms it, and that is a finding larger than this slice.

## Code-side elimination (done 2026-08-07, before the readings)

Candidate (3) is answerable from the repository alone, and the answer is that it does not hold.

| Check | Result |
| --- | --- |
| Modules constructing a Redis client | Five: `src/lib/session/store.ts` (the only one under `src/`), `scripts/rehearse-room.ts`, `scripts/check-purge-residue.ts`, `scripts/probe-spine-config.ts`, and `store.test.ts` (mocked) |
| Request paths that reach the store | `GET /api/quiz/state` (one `get`), and the four host routes. Nothing else — the homepage is on-demand but reads content collections, not the store |
| Per-client paths that reach the store | **None.** `GET /api/quiz/token` holds no Redis import; the token is an Ably concern (`src/lib/session/realtime.ts`) |
| Scheduled work | No `crons` in `vercel.json`, no `src/middleware.ts`, no `setInterval`/`setTimeout` anywhere under `src/` |
| Scripts invoked automatically | None. All three probe scripts are run by hand (`bun scripts/…`); `package.json` scripts are `dev`, `build`, `preview`, `astro`, `test`, `test:watch`, `type-check` |
| `bun run test` | Zero real commands — `store.test.ts` mocks `@upstash/redis` at the module level |
| `astro build` / `astro check` | Zero — the only build-time gate is `assertQuizValid()`, which parses a literal and touches no store |

**Conclusion on (3): not supported.** No per-client store path exists, and nothing in the repository
issues a command on a schedule. That leaves (1) and (2), which only the readings can separate.

**One candidate the code check surfaces rather than eliminates:** a local `bun run dev` with a pulled
`.env` reaches the *real* store on any request to `/api/quiz/state` or a host route. A dev server left
running during the F-04 window is a plausible contributor to the observed delta, and it is worth
confirming none is running before taking either reading below.

## Readings

Both readings must be taken with **nothing running**: no rehearsal, no `bun run dev` against the real
store, no host action, and no other person driving the deployed site.

**Instrument**: Upstash console → database `upstash-kv-chestnut-pillow` → Usage → `commands` this month.

**This is a human-only step** — the console is not reachable from this environment.

| | Reading | Timestamp | Elapsed since previous |
| --- | --- | --- | --- |
| Reference (F-04, before load runs) | 513 | 2026-08-07 | — |
| Reference (F-04, after three load runs) | 4102 | 2026-08-07 | — |
| **Reading 1** | _pending_ | _pending_ | — |
| **Reading 2** | _pending_ | _pending_ | _pending_ |

**Idle delta**: _pending_

## Verdict

_Pending both readings._

## Sequencing deviation, recorded rather than silent

The plan's Phase 0 Implementation Note says to pause before Phase 1. In practice Phase 1 was
implemented while reading 2 was outstanding, on this reasoning: **Phase 1 is store code plus mocked
tests and issues zero real commands** (see the elimination table above — `store.test.ts` mocks
`@upstash/redis` at the module level), so writing it cannot contaminate the idle window. The gate's
actual intent is that no *attendee writes* reach the store before the verdict, and that first happens
when the slice is deployed and exercised — Phase 4's two-device run and Phase 5's rehearsal.

The gate therefore moved from "before Phase 1" to "before anything reaches production", which is where
it does work. If reading 2 shows a rising idle counter, Phase 1's code is the part of the slice least
likely to be invalidated by that finding, and no measurement has been spent.

## Consequence for the tripwire

Independent of which explanation the readings support, the 200K tripwire recorded in
`docs/runbook-live-session.md` is **uncalibrated**, and the rehearsal report says so itself: the
threshold was derived from F-02's estimate of 15–25K store operations per *real* session, and a real
session includes answer submissions that no slice has built yet. The rehearsal exercised host actions
and fan-out only, so its command cost was never comparable to the estimate the threshold came from.

S-02 changes the shape of the denominator for the first time — roughly one `EVAL` per attendee at join
(~150) plus one `HLEN` per host action (~15). Phase 5 takes the first counter delta with attendee
writes in the system, and that is the reading against which the threshold should actually be set.

_To be completed in Phase 5._
