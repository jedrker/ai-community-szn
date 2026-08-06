<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Session End and Data Purge (F-03)

- **Plan**: `context/changes/session-end-and-data-purge/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-06
- **Verdict**: REVISE → **SOUND** after triage (8/8 findings fixed)
- **Findings**: 2 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | WARNING | PASS |
| Lean Execution | PASS | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

12/12 existing paths ✓, 6/6 new paths correctly absent ✓, 3/3 symbols ✓ (`SESSION_KEY` has no
importers outside `store.ts`/`store.test.ts`; `log.ts:52` index signature confirmed;
`store.test.ts:212-219` single-`eval` assertion confirmed). Progress format: 1 `## Progress`, 5/5
phases matched, 33/33 criteria↔checkboxes at review (36/36 after fixes), zero checkboxes outside
Progress ✓. Brief↔plan consistent ✓. No `contract-surfaces.md`, no `lessons.md` — both skipped.

## Findings

### F1 — "EXPIRE accepts a key list" is false

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Critical Implementation Details, ¶1
- **Detail**: The plan stated `DEL` and `EXPIRE` "both accept a key list". `EXPIRE` takes exactly one
  key (`EXPIRE key seconds [NX|XX|GT|LT]`). An implementer copying this writes a Lua error. The
  single-`EVAL` conclusion survives — a loop over `KEYS` is still one round trip — but the stated
  reason was wrong, in the paragraph the implementer leans on hardest.
- **Fix**: Corrected to state that `DEL` accepts a key list while `EXPIRE` takes one key, so the end
  script loops over `KEYS` — still a single `EVAL` and a single round trip, which is the property
  that matters.
- **Decision**: FIXED

### F2 — `purge`'s published snapshot has no specified version, and the client drop rule will silently discard it

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4 — The purge route
- **Detail**: Phase 3 said purge broadcasts "the terminal snapshot" without naming which document at
  what version. The client rule is strict — `spine-check.astro` drops any snapshot where
  `state.version <= current.version`. Purging an already-`ended` session republishes version n, every
  device drops it, and the closing screen never changes. Purging from `lobby` or `question-revealed`
  is worse: no ended document exists, so the implementer must synthesize one that was never written,
  which then races the delete.
- **Fix A ⭐ Recommended**: Purge writes the ended document, then publishes, then deletes.
  - Strength: Makes purge a superset of end — one ordering to reason about instead of two opposite
    ones, retiring the plan's own "easy to simplify and quietly break" warning. Version monotonicity
    holds because the document is really stored.
  - Tradeoff: Two store round trips instead of one.
  - Confidence: HIGH — reuses `applyHostAction`'s proven ordering and the `store.ts:75-91` guard.
  - Blind spot: Whether the intermediate write re-arms to `ENDED_TTL` or skips TTL entirely.
- **Fix B**: Publish an explicit terminal message that is not a versioned snapshot.
  - Strength: Single round trip; sidesteps version ordering by not being a snapshot.
  - Tradeoff: A second message type on a channel that has carried exactly one since F-02, which S-02
    inherits.
  - Confidence: MEDIUM — widens the transport contract in the slice meant to close surfaces.
  - Blind spot: F-02's spine contract argues snapshot-per-publish is why divergence is structurally
    impossible; a second shape needs that argument re-made.
- **Decision**: FIXED via Fix A. Also pinned by a new route test asserting the published version is
  strictly greater than the version read, and by an explicit statement that the stale case refuses
  rather than forces the purge.

### F3 — Residue check's safety guard permits `lobby`, the exact state a host creates before an event

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1 — Residue check script
- **Detail**: The script refused to run unless the phase was `lobby` or `ended`. But `start` opens the
  lobby rather than question 1, so `lobby` is precisely the pre-event window where running the script
  would seed decoy keys into the live store and then purge the session the host just started — this
  slice's own named failure mode, reintroduced by the check meant to prevent it.
- **Fix**: Guard narrowed to "any session document present ⇒ refuse, and say which phase it found".
- **Decision**: FIXED

### F4 — Desired End State asserts an Ably outcome Phase 1 admits it may not achieve

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State ↔ Phase 1
- **Detail**: Desired End State said "Nothing identifying was ever retained by Ably", while Phase 1's
  own contract admits the floor may not reduce to zero. Every phase could complete, every criterion
  pass, and the stated end state still be false — visible only to whoever read the artifact. Nothing
  escalated a non-zero floor into the S-02 constraint the brief says it would become.
- **Fix**: End state restated conditionally against the measured floor, with the conditionality
  explained. Two Phase 1 criteria added: a non-zero floor must land in Phase 5's retention contract
  as a constraint on what S-02 may publish, and the end state must be reconciled against the measured
  figure before the plan closes.
- **Decision**: FIXED

### F5 — The 10-minute window is a deliberate deviation from the PRD guardrail, recorded nowhere durable

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 5 — documents updated
- **Detail**: The PRD guardrail reads "...remains in operator-accessible storage **after the session
  that collected it has ended**." The design deliberately retains that data for ten minutes after a
  session has ended. Defensible and knowingly chosen, but on the PRD's wording a deviation rather
  than a satisfaction. Phase 5 updated the runbook, risk register, roadmap and `CLAUDE.md` — not
  `prd.md`, which is where the guardrail lives and where a retention audit starts.
- **Fix**: `context/foundation/prd.md` added as Phase 5 §3, recording the window as an accepted,
  reasoned deviation in the style of the PRD's existing Socratic resolutions — explicitly *not* by
  rewording the guardrail, since the value of the entry is that the gap stays visible. A non-zero
  Ably floor is directed to the same place as a second, involuntary deviation from the same sentence.
- **Decision**: FIXED

### F6 — Two "automated" criteria are manual procedures

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — criteria 2.3 and 2.4
- **Detail**: Both read "verified by making the change, observing the failure, and reverting" — a
  human procedure listed under Automated Verification, where every sibling is a runnable command.
- **Fix**: Made genuinely automated. The registry test gains a fixture case proving the detector
  fires on an unregistered namespaced literal (without it, a detector whose regex stopped matching
  would pass forever and look like compliance). The log constraint gains a `// @ts-expect-error` case
  that also inverts helpfully — reopening the field set turns it into an unused-directive error.
- **Decision**: FIXED

### F7 — Migration Notes overstates the rollback remedy

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Migration Notes, final ¶
- **Detail**: "the remedy is to wait out the TTL" — but the key is directly deletable from the Upstash
  console or CLI, faster and available to the same person doing the rollback.
- **Fix**: Console delete named as the remedy; TTL demoted to the fallback when nobody has store
  access at that moment.
- **Decision**: FIXED

### F8 — `purge`'s phase guard is implied, not stated

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §4
- **Detail**: `end` gets an explicit phase guard; `purge` gets none, which is correct — it is the
  escape hatch for exactly the mid-question abandonment `end` refuses. But the plan never said so, so
  an implementer applying the rules symmetrically would add one and remove the only exit from a
  session gone wrong.
- **Fix**: Stated explicitly as one of two deliberate asymmetries with `end` (alongside "a publish
  failure does not abort the delete"), both required in the route docstring, and pinned by a route
  test asserting `purge` is accepted from `question-open`.
- **Decision**: FIXED

## Not flagged, deliberately

- **`keys.ts` + `keys.test.ts` for a namespace holding one key** reads as premature abstraction, but
  is not: with the registry inside `store.ts`, the enforcement test would have to exempt `store.ts` —
  the file where nearly all key usage lives — and the gate would be worth close to nothing.
- **The two opposite write/publish orderings** looked like an architectural smell, but F2's Fix A
  removes them, so it was folded into that finding rather than duplicated.
