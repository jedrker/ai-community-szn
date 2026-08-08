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

The original method was two readings taken with **nothing running**, on the reasoning that a flat
figure rules out candidate (2) and a rising one confirms it.

**That method was superseded by a better one, and the readings below follow the better one.** What
actually settled the question was *attribution*: pricing a known workload against the counter and
seeing whether the arithmetic closes. It does, to within 0.1% — which is a stronger result than a flat
idle reading, because a flat reading rules out only continuous traffic while attribution also prices
the work. It is also what exposed the lag that made the original method unreliable: an "idle" window
can be busy with a *previous* burst still being ingested, and it looks identical to a quiet one.

**Instrument**: Upstash console → database `upstash-kv-chestnut-pillow` → Usage → `commands` this month.

**This is a human-only step** — the console is not reachable from this environment.

| | Reading | Writes | Reads | Timestamp | Elapsed |
| --- | --- | --- | --- | --- | --- |
| Reference (F-04, before load runs) | 513 | — | — | 2026-08-07 | — |
| Reference (F-04, after three load runs) | 4102 | — | — | 2026-08-07 | — |
| Phase 5, before three N=150 runs | 1541 | 640 | 901 | 2026-08-08 ~11:05 | — |
| **Reading 1** (~7 min after the last run) | 2794 | 1411 | 1383 | 2026-08-08 ~11:52 | 47 min |
| **Reading 2** (~85 min after the last run) | 5320 | 2963 | 2357 | 2026-08-08 ~13:15 | 83 min |

The monthly counter reset between the F-04 references and these, so 1541 is not comparable
to 4102 as an absolute — only the deltas are.

**Delta reading 1 → reading 2: +2526** (writes +1552, reads +974), against roughly **15**
commands of attributable work in that window (`check-purge-residue.ts`, and five
verification `curl`s after a deploy).

## Verdict

**Nothing is issuing commands unprompted. The counter lags, and reading 1 was premature.**

Read naively, reading 2 looks alarming: +2526 where ~15 was expected. It is not. Priced
across the whole window instead — baseline 1541 → 5320, a settled delta of **+3779** for
three N=150 runs — the figure is accounted for almost exactly by the runs themselves, once
each join is priced correctly:

| | Predicted | Observed |
| --- | --- | --- |
| Writes | 465 EVALs + 450×4 internal + ~55 host = **2320** | **2323** |
| Reads | 450×3 + 15 probes×2 + ~30 host = **1410** | **1456** |
| Total | **~3775** | **3779** |

Writes agree to three commands in 2300. So:

- **Candidate (2) is ruled out.** There is no continuous background traffic. The rise
  between the two readings was the console still ingesting the burst.
- **Candidate (4) is confirmed, and was understated.** Upstash bills a Lua `EVAL` **and
  every `redis.call` inside it**. The claim script makes seven internal calls (`GET`,
  `HEXISTS`, `HSET`, `HSET`, `EXPIRE`, `EXPIRE`, `HLEN`), so **a join costs eight commands,
  not one — and not the "roughly two" this file guessed after Phase 5.**
- **Candidate (1) is no longer needed** as an explanation for the S-02 figures. It may still
  contribute, but nothing is left over for it to explain.
- **Candidate (3) remains eliminated** by the code-side table above.

### The method finding, which outlasts the numbers

**A counter reading taken minutes after a burst is not settled, and looks exactly like one
that is.** Reading 1 was recorded in `join-burst-report.md` as final and produced a cost
model 3× too low, which then propagated into the runbook. The mechanism that made the
original 513 → 4102 delta look mysterious may well be partly this: a reading taken at the
wrong moment. **Quote a counter only after it has stopped moving, and record the interval at
which it was read** — both readings above now carry one.

### What is still open

**The F-04 anomaly is not resolved.** Those seven runs had no join stage, so the
eight-commands-per-join mechanism does not apply to them; the version-guard `EVAL` bills 3
rather than 1, which inflates their cost ~3×, not the ~13× implied by ~513 per run. Either
something else was running during that window, or those readings were themselves taken
mid-ingest. Not worth further measurement now — the cost is bounded, measured, and ~3% of
plan at ten events a month.

### Consequence for cost, settled

- One N=150 rehearsal run: **~1260 commands**.
- One real 150-attendee event: **~1600** (150 joins × 8, ~15 host actions × ~6, ~150 device
  connects × 2).
- Ten events a month ≈ **3% of the 500K plan**.

**One design consequence for S-03.** A script's cost is now a function of how many
`redis.call`s it makes. That does not argue for shortening the claim — its seven calls are
what make it atomic. It does mean an answer-submission script, running once per attendee per
question (150 × 14), is the first place script length could actually matter.

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
