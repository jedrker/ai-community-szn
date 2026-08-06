<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Session State and Realtime Fan-out Spine

- **Plan**: `context/changes/session-state-and-realtime-spine/plan.md`
- **Scope**: All 4 phases (full plan review)
- **Date**: 2026-08-06
- **Verdict**: NEEDS ATTENTION → APPROVED after triage (3 fixed, 1 accepted with tripwire, 1 fixed)
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING → PASS (F1 fixed, F2 accepted with tripwire) |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING → PASS on coverage (F3 fixed); 3 manual items still open by decision |

## Automated criteria (all re-run at review time)

| Check | Result |
|---|---|
| `bun run test` | 151 passed, 11 files |
| `bun run type-check` | 0 errors |
| `bun run build` | Complete |
| One zod copy | 1 |
| No `astro:` imports under `src/lib/session/` | 0 |
| No `prerender` export under `src/pages/api/quiz/` | 0 |
| `ABLY_API_KEY` env reads | 1 (`realtime.ts`) |
| `bun scripts/probe-spine-config.ts` | exit 0, 9/9 |

Diff scope matches the plan's file list exactly — 28 files, no unplanned source files.

## Findings

### F1 — A rejected host secret is logged as `session.action.stale`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/host.ts:87`
- **Detail**: `authorizeHost` emits `logSessionEvent("session.action.stale", { reason: "host secret rejected" })`
  when the secret does not match. That event means something else entirely everywhere else in the
  system, and `docs/runbook-live-session.md` — written in this same change — tells the host that
  `session.action.stale` means "two actions raced; the second was a no-op → nothing [to do], unless you
  did not double-tap". So a host watching the stream during a live segment sees a benign race where the
  truth may be someone trying to drive their session with a wrong secret. The one event the host is told
  to ignore is the one an intrusion attempt produces. It also makes a repeated brute-force attempt
  indistinguishable from a fumbled double-tap.
- **Fix**: Add `session.auth.rejected` to the closed set in `log.ts`, emit it from `authorizeHost`, and
  add a row to the runbook's event table saying it means an unauthorized host action was attempted and
  is worth investigating if the host was not the one clicking.
  - Strength: Restores the runbook's table as a true mapping, and gives the only security-relevant event
    in the system its own name. Two-line change plus one doc row.
  - Tradeoff: One more event name in a set the plan described as closed — though it is a *deliberate*
    extension, which is exactly how the plan says the vocabulary should grow.
  - Confidence: HIGH — the miswiring is plain in the code and the runbook text contradicts it directly.
  - Blind spot: None significant.
- **Decision**: FIXED — `session.auth.rejected` added to the closed set, emitted from `authorizeHost`, runbook row added, plus a test asserting the event is not `session.action.stale` and carries no secret material. Confirmed live.

### F2 — The open token endpoint makes Ably's 200-connection ceiling trivially exhaustible

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/quiz/token.ts:16`
- **Detail**: `GET /api/quiz/token` is deliberately unauthenticated — correctly, since the token it mints
  can only subscribe. But it is also unthrottled and now live in production. `infrastructure.md` records
  Ably's free tier at **200 peak connections** against a 150-attendee room, and rates breaching it
  L-likelihood / **H-impact**. Anyone who can reach the endpoint can mint unlimited tokens and hold open
  connections until the ceiling is reached, at which point real attendees cannot connect. The failure
  lands mid-session, in front of the room, which is the blast radius the PRD names as the thing to avoid.
  This is not a data-loss risk — the subscribe-only capability holds — it is an availability one, and it
  was not considered in the plan.
- **Fix A ⭐ Recommended**: Record it as an accepted risk with a tripwire, and do nothing in code yet.
  - Strength: Honest about the actual threat model — a Szczecin community meetup with a link on a screen
    is not a target, and the PRD already accepts an unprotected host view on the same reasoning. Costs
    nothing and puts the risk where the next reader will find it (`infrastructure.md`'s register, whose
    200-connection row this sharpens).
  - Tradeoff: A hostile or merely curious attendee with the link can still deny the session. No
    detection exists — the host would see attendees failing to join and have no way to attribute it.
  - Confidence: MEDIUM — the threat model judgement is sound, but "nobody would bother" is an assumption
    about people in the room, not a control.
  - Blind spot: Ably may itself throttle token requests per key; not verified.
- **Fix B**: Throttle the endpoint — a short-TTL counter in the store keyed by IP, refusing beyond N
  tokens per window.
  - Strength: Turns a trivial exhaustion into an inconvenient one, using a store already in place.
  - Tradeoff: A venue network puts many attendees behind one address, so an IP-keyed limit risks blocking
    legitimate joins — the exact tension FR-018 already flags for the per-device player cap. Getting the
    threshold wrong breaks the 30-second join target it is meant to protect.
  - Confidence: LOW — no data on venue NAT behaviour, and S-09 owns this class of problem.
  - Blind spot: Whether the limit interacts badly with reconnect storms after a network blip.
- **Decision**: ACCEPTED AS RISK via Fix A — recorded in `infrastructure.md`'s register with a tripwire (attendees failing to connect while the host works; Ably peak connections above expected attendance), in `token.ts` as a do-not-"fix"-without-reading note, and in the runbook's During-the-session section. No code change.

### F3 — No route file is covered by a test, and `reveal.ts` carries real branching

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/pages/api/quiz/host/reveal.ts:43`
- **Detail**: No test imports any file under `src/pages/api/quiz/` — verified by grep. The libraries
  beneath them are well covered (151 tests), and the plan only asked for `realtime.test.ts`, so this is
  not drift. But `reveal.ts` is not a thin adapter: it inspects `applied === false && state.phase ===
  "lobby"` to convert a store-level no-op into a `409`, which is genuine logic that exists in exactly one
  place and was verified exactly once, by hand, against a dev server. `start.ts` similarly branches on
  `created` vs `exists`. A refactor of `applyHostAction`'s outcome shape would break these silently.
- **Fix**: Add a small route-level test file exercising the three host routes' branching against a mocked
  `applyHostAction` / `createSession` — reveal-from-lobby → 409, reveal-when-revealed → no-op 200,
  start-when-existing → `already-started`, advance-past-last → no-op.
  - Strength: Pins the one layer where a contract change would fail silently; the mocking pattern is
    already established in `host.test.ts`.
  - Tradeoff: Astro `APIRoute` handlers need a `Request` constructed by hand — mildly awkward, though
    `host.test.ts` already does exactly that for `extractSecret`.
  - Confidence: HIGH — the pattern exists in this repo and the surface is four small branches.
  - Blind spot: None significant.
- **Decision**: FIXED — `src/pages/api/quiz/host/routes.test.ts` added (17 tests). Verified non-vacuous: mutating reveal.ts's lobby branch makes the guarding test fail.

### F4 — Shipped log vocabulary is a superset of the plan's stated closed set

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/session/log.ts:21-27`
- **Detail**: The plan named five events (created, applied, stale, publish ok, publish failed). The
  implementation ships seven, adding `session.read.invalid` and `session.unconfigured`. Both are useful
  and both are wired to real conditions the plan describes elsewhere — but the plan text still says five,
  and `spine-contract.md` points at `log.ts` as the closed set without noting the divergence.
- **Fix**: Update the plan's Phase 2 §3 sentence to list the seven shipped events, so the next reader
  isn't comparing against a stale list.
- **Decision**: FIXED — plan Phase 2 §3 and `spine-contract.md` now name the eight shipped events and point at `log.ts` as the source of truth.

### F5 — `readSession` depends on an unstated Upstash client default

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: `src/lib/session/store.ts:169`
- **Detail**: `readSession` passes `redis.get(SESSION_KEY)`'s result straight to `parseSessionState`,
  which expects an object. That works because `@upstash/redis` has `automaticDeserialization: true` by
  default — verified working in production, but nowhere stated. Constructing the client with that option
  disabled, or a future default change, would make every read return a string and fail as `invalid`
  rather than as a clear configuration error. `createSession` already handles both shapes
  (`typeof result?.[1] === "string" ? JSON.parse(...)`), so the codebase is inconsistent about which
  assumption it makes.
- **Fix**: Accept both shapes in `readSession` the way `createSession` already does, or state the
  dependency in a comment next to the client construction.
- **Decision**: FIXED — `asDocument()` accepts a string or an object; both `readSession` and `createSession` now use it, removing the inconsistency. Two tests cover the string and the not-JSON cases.

## Success criteria status

All automated criteria across all four phases pass (table above). Manual criteria: 35 of 38 met.

Outstanding, and documented in the plan rather than rubber-stamped:

- **4.5 / 4.7** — two-device fan-out and reload. Preview deployed, not yet run.
- **4.8** — `latency-probe.md`'s measurement table is `_pending_`; method and reference points are fixed.
- **3.12** — skipped by explicit decision; covered by unit tests instead of a live credential change.

No manual item is marked `[x]` without evidence in the diff or captured output. The three open items are
annotated in place with why they are open, which is the right posture — but F-02's headline outcome
("reaches every connected device within a second") remains the unverified part of this change.
