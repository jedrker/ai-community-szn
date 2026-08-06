<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Session State and Realtime Fan-out Spine

- **Plan**: `context/changes/session-state-and-realtime-spine/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-06
- **Verdict**: REVISE → SOUND after triage (all 7 findings fixed)
- **Findings**: 2 critical, 3 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | FAIL → PASS (fixed) |
| Lean Execution | WARNING → PASS (fixed) |
| Architectural Fitness | PASS |
| Blind Spots | WARNING → PASS (fixed) |
| Plan Completeness | WARNING → PASS (fixed) |

## Grounding

8/8 existing paths ✓, 4/4 new paths correctly absent, 5/5 symbols ✓, brief↔plan ✓,
Progress contract ✓ (one `## Progress`, 4/4 phases matched, no stray checkboxes outside it).
`docs/reference/contract-surfaces.md` absent — surface check skipped.

## Findings

### F1 — Nothing can read current state, so a connecting device sees an empty screen

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §2 (store), Phase 3 §2–3 (routes), Phase 4 criterion 4.7
- **Detail**: `readSession()` is exported (plan.md:281) but no route exposes it — the only endpoints
  are the token route and the three host verbs. The design's answer to a missed message ("the next
  snapshot corrects it") only covers devices already listening. A browser connecting or reloading
  between two host actions receives nothing until the host acts again. This makes criterion 4.7
  unachievable as written, and lands on S-02, where FR-007's attendee joins mid-session and must see
  the current question within a 30-second target.
- **Fix A ⭐ Recommended**: Add `GET /api/quiz/state` returning the current snapshot
  - Strength: One authoritative read path used on connect and reconnect, reusing `readSession()` which
    Phase 2 already builds and tests; S-02 inherits it. One request per device per *connect*, not per
    host action — unlike the rejected broadcast-a-nudge design.
  - Tradeoff: One more route; a device now has two state sources and must apply the version rule
    across both.
  - Confidence: HIGH — the version field makes merging well-defined: take whichever is newer.
  - Blind spot: Whether S-02 wants the same endpoint to also carry the question payload is unsettled.
- **Fix B**: Enable Ably channel rewind so a subscriber gets the last message on attach
  - Strength: No new endpoint; the transport replays the most recent snapshot.
  - Tradeoff: Couples correctness to a channel option easy to lose in a config change.
  - Confidence: MEDIUM — rewind's behaviour with REST publishes and token-authed attach is unverified.
  - Blind spot: A rewound snapshot could outlive the store document it describes (4-hour TTL).
- **Decision**: FIXED via Fix A — `GET /api/quiz/state` added as Phase 3 §4; harness fetches before subscribing; criteria 3.7 and 4.7 updated

### F2 — Phase 1's probe skips `EVAL`, the one capability all of Phase 2 rests on

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4 (`scripts/probe-spine-config.ts`)
- **Detail**: The probe round-trips `SET`/`GET`/`TTL` and requests an Ably token, but never executes
  `EVAL` — yet the whole atomicity argument and all of Phase 2 assume Lua scripting is available over
  Upstash's REST interface via `@upstash/redis`. This is the plan's own methodology failing on its most
  load-bearing claim: Phase 1 exists because F-01 proved two confident `infrastructure.md` claims
  wrong. If `EVAL` is unavailable or free-tier-restricted, that is a Phase 2 redesign discovered in
  Phase 2 rather than in the phase built to discover it.
- **Fix**: Extend the probe to run a trivial `EVAL` (compare-and-set a version on a throwaway key,
  return it) and add it to Phase 1's automated criteria. A failure reopens Phase 2's approach before
  any of it is written.
- **Decision**: FIXED — probe now executes a compare-and-set `EVAL`; failure reopens Phase 2 before it is written (criterion 1.6)

### F3 — Host endpoints have no specified behaviour when the version guard rejects

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §3, plan.md:388-396
- **Detail**: The store returns `applied` / `stale` and Phase 2 tests the rejection path, but Phase 3's
  route contract describes only success, `401`, and store/transport failure. What an endpoint does with
  `stale` is unspecified, and both plausible guesses are wrong differently: treating it as success
  tells the host the room advanced when it didn't (the failure fail-loud exists to prevent), while a
  raw conflict error alarms a host who merely double-tapped. A stage double-tap is the realistic
  trigger, and F-04 produces concurrent writes deliberately.
- **Fix**: Specify it in Phase 3: on `stale`, re-read and return current state with a distinct
  non-error status the harness renders as "already applied", plus the existing stale log event. Add a
  manual criterion that a double-fired `advance` moves the room exactly one question.
- **Decision**: FIXED — Phase 3 specifies the `stale` outcome as "already applied", never plain success; criterion 3.11 added

### F4 — Latency is measured from the wrong instant, understating the binding guardrail

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 4 §2 (plan.md:483), criterion 4.5, `latency-probe.md`
- **Detail**: The harness displays the delta between the host action's *completion* and the snapshot's
  arrival. The PRD guardrail is "within 1 second of the host acting" — from the click. Measuring from
  completion excludes the endpoint round trip, the store `EVAL` and the publish, i.e. most of the
  server-side budget. The figure would be smaller than the guardrail it claims to verify, and it feeds
  F-04's baseline and F-01's Pro-upgrade tripwire. Same class of error F-01 warned about with the
  region: a figure recorded against the wrong reference is worse than no figure.
- **Fix**: Timestamp at the host's click, before the fetch, and report that delta as the headline
  figure; keep completion-to-arrival as a secondary number separating server time from fan-out. Update
  criterion 4.5 and the `latency-probe.md` contract to name which instant the headline starts from.
- **Decision**: FIXED — headline delta now measured from the host's click; completion-to-arrival kept as a secondary figure; criteria 4.5 and 4.8 updated

### F5 — The `start` verb is underspecified, and nothing creates a session

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Phase 2 §2 (`createSession`), Phase 3 §3 (plan.md:388-396)
- **Detail**: Two gaps in one place. `createSession()` is exported but no route calls it — Phase 3 says
  every verb "reads current state", which on a fresh deploy is `null`. And `advance`/`reveal` get
  explicit behaviour while `start` gets none, leaving open whether it lands in `lobby` or opens
  question 1. Not cosmetic: PRD FR-002 keeps the explicit start because "the deliberate start is what
  lets the host gather the room before the first question", and the drafted quiz's first two questions
  are written for that beat.
- **Fix**: Specify that `start` creates the session at version 1 in `lobby` (idempotent if one exists)
  and that the first `advance` opens question 1, citing FR-002 for the lobby beat.
- **Decision**: FIXED — `start` creates the session in `lobby`, idempotent, citing FR-002; first `advance` opens question 1; criterion 3.10 added

### F6 — Four documents for one foundation slice

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 4 §4 (`spine-contract.md`)
- **Detail**: `spine-contract.md` restates the key name, TTL behaviour, channel name, broadcast rule,
  log vocabulary and Lua rationale — all already in plan.md, which is not going anywhere. Its one
  genuine job (telling S-02 what not to rely on) is three bullets.
- **Fix**: Fold into `change.md`'s scope-boundary section, or keep it cut down to the three
  non-reliances plus links back into plan.md.
- **Decision**: FIXED — `spine-contract.md` cut to the three non-reliances plus links into plan.md

### F7 — Two cited line references drift

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis, Key Discoveries
- **Detail**: `src/quiz/index.ts:47` — `export const quiz` is at line 49. `package.json:20-30` spans
  `@tailwindcss/typography` to `@types/node`, not the dependency block cited. Verified correct:
  `src/lib/slack.ts:1-21`, `newsletter-signup.ts:20-30`, `newsletter.test.ts:1-11`.
- **Fix**: Correct the two references, or cite symbol names, which don't drift.
- **Decision**: FIXED — `index.ts:47`→`:49`; `package.json` line range replaced with the named dependencies block
