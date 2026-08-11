<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Connection-limit degradation

- **Plan**: `context/changes/connection-limit-degradation/plan.md`
- **Scope**: Phase 1 and Phase 2 of 2 (full plan)
- **Date**: 2026-08-10
- **Verdict**: REJECTED at review; **all 9 findings triaged and fixed** (2026-08-10) — 8 fixed as
  proposed or adapted, 1 sub-item consciously declined (F7 item 4). Re-verified after triage:
  `bun run test` 890 tests, `bun run type-check` 0 errors.
- **Findings**: 2 critical, 4 warnings, 3 observations, plus 1 incidental found during triage

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria all pass, verified during review: `bun run test` — 29 files, 874 tests;
`bun run type-check` — 0 errors, 0 warnings. `boundary.test.ts` clean: `session.ts` imports
only `ably` plus `import type`, reads no env, and the endpoint path is a literal.

Scope Discipline verified against `git show --stat` for both commits: all six "What We're NOT
Doing" boundaries hold — no participant cap, no token throttle, no scoring change, no change
to `/api/quiz/state`'s response shape, `infrastructure.md` untouched, no Ably plan change.

## Findings

### F1 — The fallback fetch has no timeout, so one hung socket freezes the device behind a reassuring banner

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/client/session.ts:388-391 (`refresh`), consumed at :336
- **Detail**: `refresh()` calls `fetch("/api/quiz/state")` with no `AbortSignal`. A venue-network
  socket that hangs rather than fails leaves `inFlight` true forever: `arm()` returns early at
  :303, `tick()` returns early at :323, and the `visibilitychange` re-arm at :458-460 is blocked
  by the same flag. `failures` never increments, so the device is never demoted to `lost` either.
  It sits on the amber "odświeżamy co kilka sekund" banner — which has become a lie — with a
  frozen question underneath. This is the failure mode `src/lib/client/answer.ts:251-259` names
  and guards with `REQUEST_TIMEOUT_MS = 10_000` + `AbortSignal.timeout` on both of its requests;
  the new loop is the one client path where that established rule was not applied, and it is the
  path most exposed to a bad network.
- **Fix A ⭐ Recommended**: Add `signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)` inside `refresh()`,
  reusing `answer.ts`'s constant value, sized below `POLL_BASE_MS * POLL_FAILURES_BEFORE_LOST`.
  - Strength: One edit covers every caller — the poll, the prime, and the host's manual refresh
    button, all of which have the same hang exposure. Matches the existing pattern exactly.
  - Tradeoff: Changes behaviour for two callers the review did not flag; a slow-but-alive prime
    now fails at 10 s instead of hanging, which is the intended behaviour but is a change.
  - Confidence: HIGH — identical construction already in this repo, two call sites.
  - Blind spot: 10 s against a 6 s interval means a hung tick can overlap the next arm; the
    `inFlight` guard handles it, but the effective interval stretches during a hang.
- **Fix B**: Wrap only the poll's call, leaving `refresh()` untouched.
  - Strength: Blast radius limited to the new loop.
  - Tradeoff: Two ways to fetch the same endpoint, and the prime keeps the hang bug.
  - Confidence: MEDIUM — needs a wrapper the poll owns, which the poll currently does not have.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `REQUEST_TIMEOUT_MS = 10_000` declared in `session.ts` (restated
  rather than imported, so the transport does not depend on a feature module) and applied as
  `AbortSignal.timeout` in `refresh()`, covering the poll, the prime and the host's refresh button.

### F2 — Polling never stops after a purge, contradicting a bound this change wrote into state.ts

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/client/session.ts:441-444
- **Detail**: `shouldPoll` tests `current?.phase !== "ended"`. When the session document is gone —
  exactly what `purge` produces, and what TTL expiry after `end` produces — `current` is `null`,
  so the expression reads `undefined !== "ended"` → true and the loop keeps polling. The Ably SDK
  on a lost device keeps emitting `disconnected`/`connecting` transitions for as long as the tab
  is open, and each one calls `poll.arm()` at :510, so it is re-armed indefinitely. Meanwhile the
  attendee view renders the `null` state as "To już koniec. Dzięki za grę!" — the screen says the
  session is over while the device spends 2 Redis commands every 6 s. This directly falsifies the
  budget text this change added at `src/pages/api/quiz/state.ts:78-79` ("bounded on three sides:
  … and never after the session reaches `ended`") and the same claim at `session.ts:436-438`. The
  worst case is not the documented 66k — it is unbounded in wall-clock time for any phone left
  open after a purge.
- **Fix**: Latch terminally: once a snapshot has been seen and the state then becomes `null`, or
  reaches `phase: "ended"`, stop for good. A plain `current !== null` test is the wrong direction —
  it would refuse to poll before the first prime, which is the case the loop exists for.
- **Decision**: FIXED — `sawSession`/`sessionOver` latch set in `apply`, and `shouldPoll` now reads
  `!sessionOver`. **Accepted cost, confirmed with the user:** a host who purges and restarts
  mid-event leaves a *degraded* device latched on "To już koniec" until the attendee reloads; a
  device with a working channel picks the new session up from the next snapshot. Chosen over
  unbounded spend after every session on every phone left open. Documented at the declaration.

### F3 — close() restarts the loop it just cancelled, and no view calls it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/client/session.ts:342-348, :486-514, :531-539
- **Detail**: Two independent mechanisms defeat the cancel. (a) `stop()` clears the timer but not
  `inFlight`, and `tick`'s `finally` calls `arm()` unconditionally — so a `stop()` during an open
  fetch is undone when that fetch settles. From the `connected` branch this is harmless because
  `shouldPoll` then returns false; from `close()` it is not, because `close()` changes nothing
  `shouldPoll` reads. (b) `close()` calls `realtime?.close()` *before* `poll.stop()` and never
  detaches the `connection.on` listener, so Ably's own `closing`/`closed` transitions — both
  mapped to `lost` by `classifyConnection` — reach the handler and call `poll.arm()` after the
  stop. Setting `realtime = null` does not detach the listener. A third consequence: `report()`
  has no closed-guard, so a closed client's last act is telling the view it lost its connection.
  This is all latent today — `grep` finds no caller of `client.close()` anywhere in `src/`, which
  is the other half of the finding: a documented cancel with no caller and no test, while the same
  page's older participation loop does register `pagehide` (`host.astro:796`) with a docstring
  about exactly why a timer must not outlive the page.
- **Fix A ⭐ Recommended**: Give the poll a terminal `stopped` flag checked in `arm()`, `tick()` and
  `report()`, detach the connection listener before `realtime.close()`, and then call `client.close()`
  from a `pagehide` handler in both views.
  - Strength: Makes the mechanism true and used, and brings the new loop in line with the
    convention the older loop on the same page already follows.
  - Tradeoff: Turns two latent bugs into code paths that now really run, so it needs the manual
    two-device check repeated.
  - Confidence: HIGH — the `pagehide` pattern is already in `host.astro`.
  - Blind spot: bfcache restore — `host.astro:798` notes a restored page does not re-run the
    script, so a `pagehide`-closed client would need the same `pageshow` treatment.
  - **As applied**: the cancel was fixed as described, but the page-lifecycle half was resolved
    differently and deliberately. `close()` is not called from the views; instead `session.ts`
    registers its own `pagehide` → `poll.stop()` and `pageshow` → `poll.arm()` beside the
    `visibilitychange` handler it already owned. `stop` rather than `close` because a `pagehide`
    may be a bfcache suspension, and disposing would leave a restored page with a permanently
    dead loop and no symptom — which is exactly the blind spot above. The Ably connection is left
    alone, since reopening one on `pageshow` is a bigger mechanism than the leak it would fix.
    Net effect: the real-world need (no timer outliving the page) is met, and `close()` is now
    correct for whoever calls it first.
- **Fix B**: Delete the cancel claim: document the client as page-lifetime and strip the misleading
  docstring at :534-536.
  - Strength: Smallest edit; nothing pretends to work that does not.
  - Tradeoff: Leaves `close()` in the public API in a broken state for the next caller to find.
  - Confidence: MEDIUM — depends on nobody adding a caller later, which is not enforceable.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A, with the page-lifecycle half adapted (see "As applied" above).
  `FallbackPoll` gained `dispose()` — terminal, unlike the resumable `stop()` — checked in `arm`
  and `tick`; a `closed` flag now short-circuits `report()`; `close()` sets that flag, detaches the
  connection listener via `connection.off` before `Realtime.close()`, then disposes the poll and
  removes all three lifecycle listeners.

### F4 — Transport health is gated on connection state only, so a channel failure looks healthy

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Architecture
- **Location**: src/lib/client/session.ts:441-444, :521-523; src/pages/quiz/host.astro:821
- **Detail**: Nothing observes *channel* state. If the connection reaches `connected` but
  `await channel.subscribe(...)` rejects — attach failure, a channel-level auth refusal, a channel
  that goes `suspended` after attach — then `transportStatus === "connected"`, so `shouldPoll` is
  false and the fallback never arms; the host's line reads `połączenie: connected` in neutral grey;
  and no snapshot ever arrives. A frozen screen with a healthy-looking label and no polling is
  strictly worse than the `lost` case this change was written to fix, and it is the one state
  `session.ts:44-67` says must be distinguishable. The rejection is also swallowed: `host.astro:821`
  is `void client.start()`, and the attendee's `resume()` path awaits `enterSession` with no catch,
  while `claim()`'s catch writes to `#join-error` — an element inside the already-hidden `#join`
  section, so the attendee sees nothing.
- **Fix A ⭐ Recommended**: Treat channel state as part of transport health — subscribe to
  `channel.on` for `suspended`/`failed`/`detached` and fold it into `transportStatus` — and give
  `start()`'s rejection an explicit handler in both views.
  - Strength: Closes the one hole where the change's own premise (a device can tell healthy from
    not) fails, and the fallback then covers channel failures too.
  - Tradeoff: Widens what `ConnectionStatus` means; `classifyConnection` currently takes a single
    state string and would need a second input.
  - Confidence: MEDIUM — the Ably channel-state API is documented but unexercised in this repo.
  - Blind spot: Whether a `suspended` channel recovers on its own often enough that polling
    alongside it would double-fetch.
- **Fix B**: Catch the `subscribe` rejection only, and force the status off `connected` when it
  fires.
  - Strength: A few lines; removes the worst case (permanent silence with a green label) without
    a new state model.
  - Tradeoff: Does not cover a channel that fails *after* a successful attach.
  - Confidence: HIGH — a plain try/catch around an existing await.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix B. `channel.subscribe` is wrapped; on rejection the status is forced
  to `lost` with `detail: "channel-failed"`, the cause is classified from the error's `code` if it
  carries one, the fallback is armed, and the views are told. Deliberately not rethrown — the
  failure is handled, so a resolving `start()` is the honest description.
  **Follow-up left open, by choice:** a channel that fails *after* a successful attach is still
  invisible; that needs `channel.on` state subscription folded into `transportStatus` (Fix A) and
  is a separate change. The swallowed-rejection half is therefore only partly addressed — `void
  client.start()` in `host.astro:821` still hides any other `start()` rejection.

### F5 — Progress step 2.4 is marked done but the wiring it names has no test

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/connection-limit-degradation/plan.md (Progress row 2.4); src/lib/client/session.test.ts:5
- **Detail**: Row 2.4 claims `session.test.ts` "asserts timer cancellation on `connected`, on
  `close()`, and on `ended`". The test file imports only `classifyConnection` and
  `createFallbackPoll` — `createSessionClient` is never constructed in any test. Cancellation is
  asserted at the `poll.stop()` seam and against a hand-written `shouldPoll` stub, so the real
  `shouldPoll` composition at :441-444 — the only place `fallbackPolling` and `phase: "ended"`
  actually bind to the loop — has zero coverage. That is precisely why F2 and F3 are invisible to
  a green suite. Also uncovered: `report()` and the `degraded` status string (no test ever observes
  it reaching `onConnection`), `apply`'s version-guard suppression (the plan asked for it
  explicitly), `refresh`'s `!response.ok` throw, and the `errorReason` precedence added in Phase 1.
- **Fix**: Correct row 2.4 to say what is actually asserted, and add coverage for the wiring —
  construct a client with an injected/stubbed transport, or extract `shouldPoll` as a pure
  predicate and test it directly.
- **Decision**: FIXED — row 2.4 rewritten to describe what is actually asserted, and both hidden
  conjunctions extracted as pure exported functions with their own tests: `shouldFallbackPoll`
  (opt-in default, healthy-channel, `connecting`-counts-as-unhealthy, session-over) and
  `advanceLifecycle` (absent-session is not finished, purge ends it, `ended` ends it, stickiness).
  10 new cases; `session.test.ts` is at 43. Still uncovered and accepted for now: `report()`'s
  status composition, `apply`'s version-guard suppression, `refresh`'s throw path, and the
  `errorReason` precedence.

### F6 — The "mid-flight" test never holds a request open, so it cannot catch F3

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/client/session.test.ts:384-400, harness at :190-214
- **Detail**: The test named "stops re-arming once the session has ended mid-flight", whose comment
  says "the session ending while a fetch is open … the `finally` must not schedule another tick",
  sets `ended = true` *after* `advanceTimersByTimeAsync` has already resolved the fetch and run the
  `finally`. `refresh` is `Promise.resolve()`, so no request is ever pending across an assertion
  anywhere in the file. What it actually exercises is the fire-time guard at :332 — a real and
  worthwhile branch, but not the one it names. This is `context/foundation/lessons.md`'s "Prove the
  fixture reaches the branch the test names", applied to a timing default rather than a
  destructuring default, and the concrete cost is that F3(a) cannot be caught by a suite whose own
  docstring says its subject is whether the loop outlives its purpose "after `close`".
- **Fix**: Add a harness mode with a deferred, manually resolved `refresh`; assert that `stop()`
  during a pending fetch leaves `isArmed()` false after it settles, and rename the existing test to
  the guard it really covers.
- **Decision**: FIXED — the harness gained a `deferred` mode with a `settleInFlight()` control, and
  three tests now run with a request genuinely open across assertions: `dispose` during an open
  request stays dead afterwards, `stop` during one is resumable, and the `finally` does not re-arm
  when `shouldPoll` flips mid-request. The mislabelled test was renamed to "declines to fire a tick
  scheduled before the session ended", which is the fire-time guard it actually covers.
  **Verified by breaking the code**: reverting `dispose()` to `stop()` semantics fails the first of
  the three, so the fixture demonstrably reaches the branch it names.

### Incidental — stale docstring claiming three connection states

- **Severity**: 📋 OBSERVATION (found during triage, not in the original report)
- **Dimension**: Pattern Consistency
- **Location**: src/lib/client/session.ts, above `ConnectionStatus`
- **Detail**: The Phase 2 edit *inserted* the new "Four states" docstring instead of replacing the
  old one, leaving two consecutive blocks with the first asserting "Three states, and the third is
  the point" directly above a four-member union.
- **Decision**: FIXED — stale block removed.

### F7 — The loop diverges from the host loop it was modelled on

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/client/session.ts:298-348 vs src/pages/quiz/host.astro:517-534, :545-549, :792-796
- **Detail**: Four divergences from the loop the plan named as the template. (1) Visibility is
  checked only at arm time, so a tick already scheduled fires while hidden; the host loop actively
  cancels on `hidden`. (2) No `pagehide` handler. (3) No backoff — the host loop doubles up to
  `POLL_MAX_MS`; the fallback stays flat at ~6 s however many times it fails. (4) Every failure
  kind is collapsed into one counter: a 503 (store unconfigured), a 409 (invalid stored state), a
  network drop and a JSON parse error are indistinguishable, where `answer.ts` splits
  `failed`/`rejected`/`invalid` deliberately and the host loop has a dedicated 401 branch. A
  permanently misconfigured store therefore gets the same 6 s cadence from every refused device for
  the whole segment, and nothing on the host's screen says the cause is server-side.
- **Fix**: Add the `hidden` cancel and a `pagehide` handler (cheap, matches the sibling loop), and
  decide explicitly whether backoff and failure-kind naming are wanted or deliberately declined —
  a declined convention is fine, an unnoticed one is not.
- **Decision**: FIXED for (1), (2) and (3); (4) consciously declined.
  - A new `pause()` was added — clears the timer and touches nothing else — and is what both the
    `hidden` and `pagehide` handlers now call. `stop()` would have been wrong for either: it drops
    `degraded`, painting a red "connection lost" on a screen nobody is looking at and flashing it
    again on return. This also corrects the `pagehide` handler added under F3, which used `stop`.
  - Backoff added: `POLL_MAX_MS = 20_000`, doubling from the base, reset on the first success —
    the same two numbers as the sibling loop. The playability cost is documented at the constant
    and is tolerable only because demotion to `lost` has already told the attendee the truth
    before the interval lengthens. `state.ts`'s budget note now records that the figures are an
    upper bound for this reason.
  - (4) failure-kind naming is **declined**: the state endpoint's failures are all "try again"
    from this loop's point of view, and there is no per-kind action it could take. Recorded here
    so the divergence from `answer.ts` is a decision rather than an oversight.
  - Three new timing tests: the interval lengthens after a failure and resets on success, the
    backoff caps at the ceiling, and `pause` keeps the status where `stop` drops it.

### F8 — ConnectionInfo.detail breaks its own stated invariant on the failed-prime path

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/client/session.ts:89-93, :475-479; rendered at src/pages/quiz/host.astro:403-413
- **Detail**: `detail` is documented as "Ably's own state name, verbatim … a raw transport word
  rather than something translated or folded", and `session.test.ts:68-71` pins that. The
  failed-prime branch passes `describe(err)` into the same field, so the host footer can read
  `połączenie: Failed to fetch` or `połączenie: state fetch returned 503`. No data-safety issue,
  but a typed field with a stated invariant is carrying two different things and the host has no
  way to tell them apart.
- **Fix**: Either add a separate field for a non-transport detail, or widen the documented
  invariant and drop the test that pins it.
- **Decision**: FIXED by widening the contract. `detail` is now documented as a short technical
  description for display only, never to be parsed, with all three producers named: Ably's state
  name, `channel-failed` (added under F4), and a failed prime's error text. The test that pinned
  the old wording now says it pins the *classifier's* output rather than an invariant on the field.

### F9 — Plan contract said `detail` would name the fallback; the implementation composes in the view instead

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/client/session.ts:428-432; src/pages/quiz/host.astro:410-412
- **Detail**: The Phase 2 contract said each transition reports "with `cause` carried forward … and
  `detail` naming the fallback". In the code `info` is passed through untouched and the host view
  prepends "tryb zapasowy —". The on-screen result is equivalent, but a future third view gets the
  raw Ably state name and must compose the wording itself. Related documented-and-justified extras
  beyond the plan, all noted rather than flagged: the `connected` cause-suppression guard, the
  `errorReason` fallback, the fire-time `shouldPoll` re-check, `ConnectionInfo.code`, and the
  extraction of `createFallbackPoll` itself.
- **Fix**: Record the composition decision in the plan as an addendum so the next view's author
  finds it.
- **Decision**: FIXED — `plan.md` gained an "Addenda" section with seven entries covering this and
  every other decision taken during implementation and triage: the `createFallbackPoll` extraction,
  the status-not-detail composition rule, `detail` as a display string, the sticky latch and its
  reload cost, the `pause`/`stop`/`dispose` distinction, the declined failure-kind naming, and the
  post-attach channel gap left as follow-up.
