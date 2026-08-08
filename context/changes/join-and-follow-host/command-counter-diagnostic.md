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

| | Reading | Writes | Reads | Timestamp | Elapsed since previous |
| --- | --- | --- | --- | --- | --- |
| Reference (F-04, before load runs) | 513 | — | — | 2026-08-07 | — |
| Reference (F-04, after three load runs) | 4102 | — | — | 2026-08-07 | — |
| Phase 5, before three N=150 runs | 1541 | 640 | 901 | 2026-08-08 ~11:05 | — |
| **Reading 1** (= Phase 5 after-run reading) | 2794 | 1411 | 1383 | 2026-08-08 ~11:20 | — |
| **Reading 2** | _pending_ | | | _pending_ | _pending_ |

Note the monthly counter reset between the F-04 references and these — 1541 is not
comparable to 4102 as an absolute, only the *deltas* are.

**Idle delta**: _pending reading 2_

## Verdict

_Pending reading 2._

**What reading 2 can and cannot still settle.** Candidate (2) — something issuing commands
continuously — is fully answerable, and that is the candidate that would be a finding
larger than this slice. It needs only an idle window, which is available now: reading 1 was
taken immediately after the Phase 5 runs finished and the namespace was purged, so any rise
by reading 2 is unprompted traffic by definition.

Candidate (1) is now only partly answerable. Phase 5 measured a **live** delta of +1253
commands against a code accounting of ~510, with the excess almost entirely in reads
(~12× predicted) — see `join-burst-report.md`. That is consistent with (1), and it also
raises a fourth candidate the F-04 report did not name:

4. **A Lua `EVAL` is billed as more than one command.** ~155 claims per Phase 5 run against
   ~161 excess reads per run is close to one-read-per-claim, which would be the script's
   opening `GET`. Not confirmed — `HEXISTS` and `HLEN` in the same script are evidently not
   billed the same way, or the figure would be near 465, and ~100 excess *writes* per run
   remain unexplained either way.

The probe that would settle (4) costs two console readings and one HTTP request: read the
counter, issue exactly one join, read it again. Cheaper and more informative than the
original idle diagnostic, and it is the version worth keeping if only one is ever run.

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

**And then it moved again, past the point of doing any work — recorded rather than glossed.** The
whole slice reached production before reading 2 was taken: Phase 4 deployed the views and Phase 5
drove three N=150 rehearsals against the live store. So the *sequencing* intent of this phase was not
met. Plan step **0.3** ("raise the finding before Phase 1 starts") was struck on 2026-08-08 as
unachievable rather than ticked, because ticking it would claim something that did not happen.

What survives is worth stating plainly, because it is easy to read the above as "Phase 0 failed and
was abandoned":

- **The question that would have been a real finding is still fully answerable.** Reading 1 was taken
  immediately after the Phase 5 runs finished and the namespace was purged. Any rise by reading 2,
  with nothing running, is unprompted traffic by definition — and *that* is candidate (2), the one
  worth chasing.
- **What was lost is the clean attribution of the historical 513 → 4102 delta**, which needed a
  pre-attendee-write baseline. That is gone and will not come back.
- **What was gained instead was not planned but is more useful:** Phase 5 measured live cost against a
  stated prediction, which is a stronger instrument than an idle reading and produced candidate (4).

## Consequence for the tripwire

Independent of which explanation the readings support, the 200K tripwire recorded in
`docs/runbook-live-session.md` is **uncalibrated**, and the rehearsal report says so itself: the
threshold was derived from F-02's estimate of 15–25K store operations per *real* session, and a real
session includes answer submissions that no slice has built yet. The rehearsal exercised host actions
and fan-out only, so its command cost was never comparable to the estimate the threshold came from.

S-02 changes the shape of the denominator for the first time — roughly one `EVAL` per attendee at join
(~150) plus one `HLEN` per host action (~15). Phase 5 takes the first counter delta with attendee
writes in the system, and that is the reading against which the threshold should actually be set.

**Completed in Phase 5.** Measured cost is **~420 commands per full rehearsal run** (not the
~170 the code predicts), plus ~150 for attendee connects now that `/api/quiz/state` also
issues an `HLEN`. A real event therefore costs on the order of **500–600 commands**.

Two corrections follow, and both belong in the runbook:

- **The plan ceiling is 500K per month, not 200K.** A reader of the runbook alone would
  infer the tripwire *is* the limit, which is wrong by 2.5×.
- **The tripwire needs no numeric change, but it needs its purpose stated.** At 200K it
  sits roughly 350× above a real session. It is not a capacity guard and must not be
  described as one — anything approaching it could only have been produced by something
  looping, which is precisely what it exists to catch. Recording it as "40% of the limit"
  would invite someone to raise it as usage grows, defeating it.
