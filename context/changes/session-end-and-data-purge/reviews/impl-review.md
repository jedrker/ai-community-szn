<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Session End and Data Purge (F-03)

- **Plan**: `context/changes/session-end-and-data-purge/plan.md`
- **Scope**: Full plan — Phases 1–5 (35/36 Progress items complete)
- **Date**: 2026-08-06
- **Verdict**: REJECTED → **APPROVED** after triage (5/5 findings fixed)
- **Findings**: 1 critical, 1 warning, 3 observations

## Verdicts

| Dimension | At review | After triage |
|-----------|-----------|--------------|
| Plan Adherence | PASS | PASS |
| Scope Discipline | WARNING | PASS |
| Safety & Quality | FAIL | PASS |
| Architecture | PASS | PASS |
| Pattern Consistency | PASS | PASS |
| Success Criteria | PASS | PASS |

## Automated criteria — all re-run at review time

| Command | Result |
|---|---|
| `bun run test` | 14 files, 243 tests passed (248 after triage) |
| `bun run type-check` | 0 errors |
| `bun run build` | Complete |
| `bun scripts/probe-ably-retention.ts --quick` | 3/3 |
| `bun scripts/check-purge-residue.ts` | 6/6 |

## Findings

### F1 — `end`'s confirmation guard does not bind the write it authorizes

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/quiz/host/end.ts:110-118`, `src/lib/session/host.ts:158-188`
- **Detail**: `end.ts` reads the session, validates `confirmVersion` against that read, then delegates
  to `applyHostAction`, which performs its **own second read** and writes with *that* version
  (`host.ts:188` — `write(current.state.version, next)`). The confirmed version never reaches the
  compare-and-set, so anything that moves the session between the two reads is ended without the
  host ever having confirmed it.

  Demonstrated, not inferred. Mocking the two reads to return v3 then v4, with the caller confirming
  v3, `endSession` was invoked with `expectedVersion: 4` — `expected 4 to be 3`. The ending succeeded
  against a state the host never saw.

  This matters more than a millisecond window suggests. The PRD explicitly accepts that the host
  control view is unprotected and that "anyone who obtains the control address — including from a
  photograph of the host screen — can advance or reset the session", so a second actor is an
  anticipated condition rather than a hypothetical. It is also the precise pattern F-02's spine
  contract forbids in rule 3 ("No read-then-write on the store") — the guard is a read-then-write in
  TypeScript wrapped around a store-level guard that never sees the confirmed value.

  `purge.ts:116` gets this right — `endSession(current.state.version, ended)` uses the version from
  the same read it validated. The defect is specific to `end.ts`, which makes it a consistency bug as
  much as a correctness one.

  Replay protection is unaffected: a replayed request fails at the *first* read, which is why the
  live test and the route tests both pass. Only concurrency exposes it.
- **Fix A ⭐ Recommended**: Teach `applyHostAction` an optional `expectedVersion`; when supplied and
  the re-read version differs, return the existing `stale` outcome instead of writing.
  - Strength: Closes the race while keeping the shared error mapping — five outcomes with Polish
    messages — in one place, which is why `applyHostAction` exists. Reuses the `stale` path the host
    already understands as "already applied", so no new vocabulary reaches the control view.
  - Tradeoff: Adds a parameter to a helper shared by five routes, four of which will never pass it.
  - Confidence: HIGH — the `stale` outcome and its rendering already exist and are tested.
  - Blind spot: The second read remains, so the fix narrows the window to the store's own
    compare-and-set rather than removing the extra round trip.
- **Fix B**: Make `end.ts` mirror `purge.ts` — call `endSession(current.state.version, ended)`
  directly with the version it validated, then publish, dropping `applyHostAction`.
  - Strength: Removes the second read entirely and makes the two destructive verbs structurally
    identical, which the retention contract already claims ("purge is `end` plus a `DEL`").
  - Tradeoff: Duplicates the outcome-to-response mapping that `purge.ts` already partly duplicates —
    three copies of the error vocabulary instead of two.
  - Confidence: MEDIUM — correct, but pushes the codebase further from the single-mapping design.
  - Blind spot: Whether the duplication in `purge.ts` should itself be consolidated first.
- **Decision**: FIXED via Fix A. `applyHostAction` takes an optional `expectedVersion`; on mismatch
  it returns the existing `stale` shape (`applied: false, note: "already-applied"`) without writing,
  and `end.ts` passes `confirmVersion` through. Three regression tests added to `host.test.ts`
  (refuses on mismatch, proceeds on match, flow verbs stay unguarded) plus one in `routes.test.ts`
  asserting the route forwards the confirmed version. Re-running the probe that proved the bug now
  shows `endSession` never called.

### F2 — Two file groups changed outside the plan's "Changes Required"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/pages/api/quiz/host/advance.ts:29`, `reveal.ts:24`, `src/lib/session/realtime.ts:30`
- **Detail**: Two unplanned changes, both defensible, neither recorded in the plan:

  1. **`advance.ts` and `reveal.ts` gained `ended` guards** (Phase 3). Necessary — an ended session
     carries `currentQuestionId: null` exactly like the lobby, so `nextQuestionId(null)` would have
     reopened question 1 on a closed session. Documented in commit `e957151` but not in the plan.
  2. **`SESSION_CHANNEL` moved into `keys.ts`** (Phase 2), re-exported from `realtime.ts`. Driven by
     the registry test as specified: leaving it would have required an exemption list.

  Both were surfaced at the time and neither is scope creep in spirit. The gap is that `plan.md`'s
  Changes Required no longer describes what was built, so a future reader diffing plan against code
  finds two unexplained deltas.
- **Fix**: Add a short addendum to Phase 2 §1 and Phase 3 naming both changes and why, so the plan
  stays usable as ground truth for the next review.
- **Decision**: FIXED. Phase 2 §1 gained an addendum on `SESSION_CHANNEL`; Phase 3 gained a new §4b
  documenting the `advance`/`reveal` ended-guards and the reopen-question-1 bug they prevent.

### F3 — Phase 3's manual verification has no committed evidence

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `context/changes/session-end-and-data-purge/plan.md` — Progress rows 3.5–3.8
- **Detail**: Rows 3.5–3.8 are checked against commit `e957151`, and the verification genuinely
  happened — a dev server run through the full guard matrix, a measured 581s TTL, and a live Lua
  execution against Upstash. But the only durable record is a commit-message sentence. Phases 1 and 4
  each produced an artifact (`ably-retention-probe.md`, `purge-verification.md`); Phase 3 did not, so
  its evidence is the weakest of the three despite covering the riskiest code.
- **Fix**: Fold the Phase 3 session transcript — guard matrix responses, the 581s TTL reading, the
  Lua results — into `purge-verification.md` as a preceding section, or a sibling artifact.
- **Decision**: FIXED. `purge-verification.md` now opens with the full Phase 3 guard matrix, the 581s
  TTL reading, the ordered log lines and the live Lua results — plus an explicit note that this
  evidence did not and could not catch F1, since every step was sequential.

### F4 — `registeredKeyDetails()` is unused

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/session/keys.ts:96`
- **Detail**: Exported and never called anywhere in `src/` or `scripts/`. Added speculatively for
  "anything that wants to explain itself". The project's own guide is explicit that a leftover which
  *looks* useful is worse than none — the `@astrojs/tailwind` note in CLAUDE.md exists for exactly
  that reason.
- **Fix**: Delete it. The `holds` documentation stays valuable in the registry literal itself, which
  is where a reader looks.
- **Decision**: FIXED. Removed; `RegisteredKey` and the `holds` field stay.

### F5 — The registry gate does not scan `.astro` files

- **Severity**: 💭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/keys.test.ts:74-81`
- **Detail**: The scan filters to `.ts`, covering `src/lib/session/` and `src/pages/api/quiz/**`
  (verified: all five host routes including `end.ts` and `purge.ts` are checked). Astro frontmatter
  runs server-side and can reach the store, so a namespaced literal in a `.astro` file would pass
  unseen. No violation exists today — `spine-check.astro` imports `SESSION_CHANNEL` rather than
  spelling it — so this is a gap in coverage, not a live defect.
- **Fix**: Extend the scan to `.astro` files under `src/pages/quiz/`, or record the boundary in the
  test's docstring alongside the runtime-assembly limitation already documented there.
- **Decision**: FIXED via the wider scan. `src/pages/quiz/*.astro` is now covered (18 tests, up from
  15) and verified to fire: injecting a literal into `spine-check.astro` fails the suite by name.

## Manual criteria audit

All checked manual rows have observable evidence in the diff or an artifact, except as noted in F3.
Row **1.4** (Ably dashboard rule) is correctly left `- [ ]` — it is a vendor-side action, and
`change.md` was deliberately held at `implementing` rather than `implemented` for that reason. No
rubber-stamping found.
