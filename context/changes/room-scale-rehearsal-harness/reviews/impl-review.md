<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Room-scale rehearsal harness

- **Plan**: `context/changes/room-scale-rehearsal-harness/plan.md`
- **Scope**: Phases 1–3 of 3 (all complete — 22/22 Progress items `[x]`)
- **Date**: 2026-08-07
- **Verdict**: REJECTED
- **Findings**: 1 critical, 6 warnings, 3 observations

> The verdict is driven by documentation accuracy, not by broken code. The harness works, every gate
> is green, and production is clean. F1 is three documents — one of them a foundation risk register —
> asserting a measured mechanism that re-testing during this review did not reproduce.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | FAIL |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria re-run during review: `bun run type-check` → 0 errors; `bun run test` → 249 passed
(14 files); `bun scripts/check-purge-residue.ts` → 6/6, namespace empty. All pass.

## Findings

### F1 — The log-tail failure mechanism is asserted as measured, and does not reproduce

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `context/changes/room-scale-rehearsal-harness/rehearsal-report.md:80-126`, `context/foundation/infrastructure.md:276`, `docs/runbook-live-session.md:113-130`, `context/changes/room-scale-rehearsal-harness/plan.md:248-258`
- **Detail**: All four documents state that a ~150-device join burst **kills** the `vercel logs` stream
  permanently, on the evidence of one N=150 run that delivered 1 token line of ~150 and then went
  silent. `infrastructure.md` carries it as an H/H risk row headed "Measured on production, not
  inferred". Three controlled tests run during this review contradict the mechanism:

  | Test | Result |
  | --- | --- |
  | 150 concurrent requests to a route that emits nothing (`/api/quiz/state`) | 0 lines, **tail alive** — request volume alone is not the cause |
  | 150 concurrent requests to `/api/quiz/token` (150 log lines) | **127 of 150** lines delivered, **tail alive** |
  | Full N=150 rehearsal, fresh tail | **135 of 150** token lines + 13 host lines, **tail alive** |

  What the evidence supports: the stream **drops roughly 10–15% of lines under a burst**, and it can
  stop delivering silently for reasons not identified. What it does not support: that the join burst is
  the cause, that the death is permanent, or that the effect is reproducible at all. The single
  observation was generalised into a mechanism and written into a foundation document that future
  slices will plan against.

  Two consequences worth separating. The **operational advice survives** — prove the stream is alive
  after the room joins, re-attach if it is dead — because it is correct whatever the cause. The
  **explanation does not**, and the H/H severity was assigned to the unsupported version.

  This also disposes of a CRITICAL raised by the safety sub-agent — that the new `session.token.issued`
  line lets an unauthenticated caller silence the project's only observability channel. Its premise was
  the same unreproduced mechanism; 150 token requests in a burst left the tail working. Downgraded: the
  real residual is line loss and noise (127 junk lines can bury one real error), which belongs in the
  corrected text rather than as a finding of its own.
- **Fix A ⭐ Recommended**: Rewrite the claim in all four places to what the tests support — burst line
  loss of ~10–15%, plus an unexplained silent-stall observed twice — and re-grade the
  `infrastructure.md` row from H/H to reflect an unidentified intermittent fault. Keep the operational
  instructions unchanged.
  - Strength: The runbook advice is already correct and independently useful; only the causal claim and
    the severity are wrong. Preserves the genuinely valuable discovery (silence is not proof of health)
    without a mechanism the evidence cannot carry.
  - Tradeoff: The finding reads as less crisp, which is the honest state of it.
  - Confidence: HIGH — three tests, all on production, all pointing the same way.
  - Blind spot: The stall was real and is now unexplained; nothing here says what caused it, so the
    corrected text has to live with an open question rather than close it.
- **Fix B**: Investigate the stall until the mechanism is known, then write the true one.
  - Strength: Would replace a wrong claim with a right one instead of a vaguer one.
  - Tradeoff: Open-ended platform debugging against a tool with no visibility into its own delivery;
    could take far longer than the finding is worth, and F-04 is otherwise done.
  - Confidence: MEDIUM — the fault did not reproduce in three attempts, so it may be rare and slow to
    catch.
  - Blind spot: Whether the stall is even client-side (CLI) or server-side is unknown.
- **Decision**: PENDING

### F2 — A single action reaching zero devices passes the verdict

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `scripts/rehearse-room.ts:887-889`
- **Detail**: `worstP95` is `Math.max` over `withArrivals` — measurements with zero arrivals are
  excluded from the verdict statistic. `reportMeasurement` prints "no arrivals" but never calls
  `record()`, so nothing fails. A run where `advance` reached nobody and the other three actions were
  fine exits **0 with `Verdict: PASS`**. The all-actions-empty case is caught; the per-action case is
  the one that would happen in practice, and it is the exact failure this harness exists to surface.
- **Fix**: `record(false, …)` for any counted measurement with `deltas.length === 0`, so it fails the
  run instead of being dropped from the statistic.
- **Decision**: PENDING

### F3 — No signal handler: Ctrl-C leaves a live session on production for four hours

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/rehearse-room.ts:920-927`
- **Detail**: `teardown` runs in a `finally`, which covers a thrown error but not SIGINT/SIGTERM.
  Someone watching a 150-connection production run is precisely the person who presses Ctrl-C. The
  result is a session document on the four-hour `SESSION_TTL_SECONDS`, which then makes every
  subsequent run's pre-flight refuse for a reason unrelated to a real session — the outcome the
  teardown docstring claims to prevent. Verified: no `process.on` anywhere in `scripts/`.
- **Fix**: `process.on("SIGINT")` and `process.on("SIGTERM")` → `teardown` → `closePool` → exit.
- **Decision**: PENDING

### F4 — Host fetches have no timeout, so a stalled request hangs the run with 150 sockets open

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/rehearse-room.ts:363`, `scripts/rehearse-room.ts:434`
- **Detail**: `CONNECT_TIMEOUT_MS` and `ARRIVAL_TIMEOUT_MS` are carefully reasoned, but neither
  `fetch` carries an `AbortSignal`. A production request that never returns hangs the process
  indefinitely, holding 150 Ably connections against the 200-connection ceiling and never reaching
  teardown. The catch blocks already treat a failed fetch as a first-class outcome, so the handling
  exists — only the deadline is missing.
- **Fix**: `signal: AbortSignal.timeout(15_000)` on both fetches.
- **Decision**: PENDING

### F5 — A client that fails to connect stays open and keeps retrying during the measurement

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `scripts/rehearse-room.ts:582-584`
- **Detail**: The `catch` records `device.failure` but never calls `client.close()`. The client is left
  in `connecting`/`disconnected`, where Ably keeps re-fetching `authUrl` and re-attempting the socket
  until `closePool` at the end of the run. So in a partially failed pool — the case this harness exists
  to report — the failed clients keep consuming peak connections and token requests *while the figures
  are being taken*, perturbing two of the things being measured. Every run so far was 150/150, so this
  path has never executed.
- **Fix**: `device.client?.close()` inside the `catch` before returning the device.
- **Decision**: PENDING

### F6 — The recorded baseline is one figure from a population that spans 111–536 ms

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `context/changes/room-scale-rehearsal-harness/rehearsal-report.md:152-167`, `context/archive/2026-08-06-session-state-and-realtime-spine/latency-probe.md:71-85`
- **Detail**: Two compounding problems with the single recorded number. First, a **fourth** N=150 run
  during this review measured **p95 536 ms** — worse than the 356 ms recorded as "the worst of three",
  so the baseline was stale within hours of being written. Across four runs the worst-case p95 spans
  111 → 536 ms, nearly 5×, which is a statement about run-to-run variance that a single figure cannot
  carry. Second, `percentile` is correct nearest-rank, but `ceil(0.95n) = n` for every n ≤ 20, so the
  N=1 and N=5 smoke runs print `p95` and `max` as the same sample with no note saying so — and those
  rows sit in the same table as the N=150 rows.
- **Fix A ⭐ Recommended**: Record the baseline as a range with its n and run count (e.g. "p95
  111–536 ms across four N=150 runs; worst 536 ms against a 1000 ms budget") and print n on each
  harness row, suppressing the `p95` label below ~20 samples.
  - Strength: The guardrail verdict does not change — 536 ms is still comfortably inside 1000 ms — so
    honesty here costs nothing and makes the next run's figure interpretable instead of alarming.
  - Tradeoff: A range is a weaker headline than a number, and F-01's tripwire wants a number to compare
    against.
  - Confidence: HIGH — four runs, all recorded, all from `fra1`.
  - Blind spot: Why run-to-run variance is 5× is not investigated; local network conditions are the
    obvious suspect and were not controlled.
- **Fix B**: Take several more runs and record a median-of-worst-p95 as the baseline.
  - Strength: A single defensible figure, which is what the tripwire and the runbook want.
  - Tradeoff: More production load for a number whose verdict is not in doubt.
  - Confidence: MEDIUM — depends on the variance being stationary, which four runs cannot establish.
  - Blind spot: Does not address the n ≤ 20 labelling problem, which needs the code fix either way.
- **Decision**: PENDING

### F7 — The mirrored-constants rationale is contradicted by the imports two lines above it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `scripts/rehearse-room.ts:48-66`, `scripts/rehearse-room.ts:148-174`
- **Detail**: The docstring justifies mirroring `livequiz:session` and `snapshot` locally "rather than
  used straight from the import" on the grounds that a script must not depend on a `src/` module that
  might later acquire an env-reading import. But lines 48–49 import `SESSION_KEY`, `SESSION_CHANNEL`
  and `SNAPSHOT_EVENT` from exactly those modules in order to assert the mirror matches — so the
  dependency is already taken and the stated protection does not hold. Net effect: ~40 lines of mirror
  plus drift assertion buy nothing, and line 63 puts a `livequiz:` literal in a file
  `keys.test.ts` cannot see (its scan covers `src/lib/session`, `src/pages/api/quiz`, `src/pages/quiz`).
  `check-purge-residue.ts` is cited as precedent, but there the mirror is load-bearing because that
  script imports nothing from `src/`.
- **Fix A ⭐ Recommended**: Use the imported constants directly and delete the mirror plus
  `assertMirrorsMatchRegistry`.
  - Strength: Removes the contradiction and the ungoverned literal at once, and the import is already
    proven to work — the script runs today with it.
  - Tradeoff: Loses the loud drift failure, which was a genuinely good idea; but a rename now breaks
    the import at type-check time instead, which is earlier.
  - Confidence: HIGH — the imports are already present and `bun run type-check` is green.
  - Blind spot: Whether any `src/lib/session` module might later gain an `import.meta.env` read at
    module scope, which is the risk the docstring was guarding against.
- **Fix B**: Keep the mirror and extend `keys.test.ts`'s scan to `scripts/` so the literal is governed.
  - Strength: Preserves the drift assertion and closes the registry hole for every future script.
  - Tradeoff: Leaves the self-contradicting rationale in place unless it is also rewritten, and widens
    a test whose scope was deliberately chosen.
  - Confidence: MEDIUM — the scan change is easy; whether the mirror is worth keeping is the open part.
  - Blind spot: Other scripts may already hold namespaced literals that the widened scan would fail on.
- **Decision**: PENDING

### F8 — A 502 from purge is recorded as a failed teardown though the data was deleted

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/rehearse-room.ts:486-490`
- **Detail**: `src/pages/api/quiz/host/purge.ts:161-171` returns 502 when the keys were removed but the
  closing broadcast failed. The harness treats any non-200 as a failed check, so a successful purge
  with a failed publish exits 1 and reads as residue left behind — the opposite of what happened.
- **Fix**: Treat 502 from `purge` as success-with-a-note, matching the route's documented meaning.
- **Decision**: PENDING

### F9 — The killed-device assertion and `awaitArrivals` state opposite intents

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/rehearse-room.ts:678-683`, `scripts/rehearse-room.ts:851`
- **Detail**: `awaitArrivals` says a killed device that arrives anyway "is still counted"; the
  accounting check requires `missing >= killed.length`. One buffered message from a closed socket would
  therefore fail the run with a message accusing the code of shrinking the denominator — the opposite
  of the truth. Unlikely, since `close()` transitions locally before the next publish, but the two
  comments cannot both be the intent.
- **Fix**: Count arrivals from killed devices explicitly and subtract them from the expected miss floor.
- **Decision**: PENDING

### F10 — Report status is stale, and the tripwire it promises has no operational home

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/room-scale-rehearsal-harness/rehearsal-report.md:3`, `context/changes/room-scale-rehearsal-harness/rehearsal-report.md:49-51`
- **Detail**: Two loose ends. The header still reads "Status: prerequisite recorded, load run pending"
  while the same file carries the completed load run. And the commands-counter tripwire that replaced
  the spend alert says it "is only as reliable as the runbook entry that carries it" — but
  `docs/runbook-live-session.md` has no commands-counter, Upstash-usage or spend entry at all, so the
  substituted tripwire has no home. That matters more than the stale header: it is the one control
  standing in for the spend alert the roadmap required.
- **Fix**: Update the header, and add a commands-counter line to the runbook's rehearsal section
  (read the Upstash counter before and after; investigate above ~200K for one run).
- **Decision**: PENDING

## Notes carried but not raised as findings

- **Barrier reported, not enforced.** The Phase 2 contract said "all clients connected and holding the
  lobby snapshot **before any measured action**". The code computes `holding`, records it, and proceeds
  regardless. It is partially enforced by sequencing (`awaitArrivals` blocks on the start version) and a
  failed finding forces exit 1, so a broken barrier cannot silently pass — but the docstring's claim
  that the ordering "gives the barrier the plan asks for" overstates it.
- **Exit code is a superset of the contract.** The plan said "exit code reflects the verdict"; the code
  exits non-zero on the verdict **or** any failed finding. Defensible — a failed teardown should not
  exit 0 — and undocumented as a deviation.
- **`log.ts`, `token.ts`, `log.test.ts` appear in no "Changes Required" entry.** Both additions are
  documented as amendments in the Phase 2 note, so they are traceable, but a reviewer reading only
  Changes Required would find three unexplained `src/` files.
- **`infrastructure.md` is outside the plan's file list**, and is the right target for what it carries;
  see F1 for the content problem rather than the scope one.
- **`latency-probe.md`'s added status banner** sits outside the three areas its authorized exception
  named (Measurements, Result, the F-04 limitation paragraph). Non-destructive — the original framing is
  kept verbatim below it.
- **Every "What We're NOT Doing" boundary holds**: no key added to `keys.ts`, no rehearsal-only
  namespace or channel, `LIVEQUIZ_HARNESS` untouched and `/quiz/spine-check` still 404 in production,
  no CI automation, no answer-loss measurement claimed.
- **Secrets handling is clean.** Every output path was traced: `"present"`/`"absent"` only, base URL
  normalised through `new URL().origin` so userinfo cannot leak, the closing curl hint is a literal
  string not an interpolation, and Ably receives `authUrl` rather than a key.
- **`LogFields` and the key registry are intact.** The new event carries no fields, `log.test.ts`
  asserts the emitted object is exactly `{event}` — a stronger guard than the other events get — and the
  `@ts-expect-error` closed-type tripwire is untouched.
