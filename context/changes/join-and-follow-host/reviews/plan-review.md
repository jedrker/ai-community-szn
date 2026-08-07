<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Join and Follow Host (S-02)

- **Plan**: `context/changes/join-and-follow-host/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-07
- **Verdict**: REVISE → SOUND after triage
- **Findings**: 1 critical, 4 warnings, 2 observations

## Verdicts

| Dimension | Verdict | After triage |
|-----------|---------|--------------|
| End-State Alignment | FAIL | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | PASS | PASS |
| Blind Spots | WARNING | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

11/11 paths ✓, 3/3 symbols ✓, brief↔plan ✓. Six paths the plan creates confirmed absent. Riskiest
claims verified directly against `advance.ts`, `reveal.ts`, `end.ts`, `state.ts`, and a grep sweep for
`SessionState` literal construction across `src/` and `scripts/`.

## Findings

### F1 — A reload locks an attendee out under their own name

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: End-State Alignment
- **Location**: Desired End State; Phase 3 §2; Phase 4 §1; criterion 4.7
- **Detail**: Desired End State claims a reloading phone re-renders the current question, and criterion
  4.7 tested it — but Phase 3 §2 said "S-09 owns resume; this slice only persists" and Phase 4 never
  read storage back. On reload the name form reappears, the attendee re-enters their name, and is
  rejected because they hold it themselves. `roadmap.md:441`: "A screen lock during a 15-minute segment
  is near-certain, so this is not optional polish."
- **Fix A ⭐ Recommended**: Read the stored player back on load and skip the form
  - Strength: The storage module already existed in the plan; this reads what was already written.
    Gives `livequiz:player-ids` its first real reader (resolves F3).
  - Tradeoff: Needs a validity check against the store — a small addition to the join route.
  - Confidence: HIGH — the reverse index the plan already specified is exactly the lookup needed.
  - Blind spot: Whether S-09's author would rather own the whole read path.
- **Fix B**: Narrow the end-state promise and drop criterion 4.7
  - Strength: Keeps the S-09 boundary absolutely clean; smallest diff.
  - Tradeoff: Ships a known dead end into a live room.
  - Confidence: HIGH — trivially correct as an edit, clearly worse as an outcome.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `readPlayerById` added to Phase 1 §3; `POST /api/quiz/join` now takes
  either `displayName` or `playerId` with a `resumed: true` / 404 outcome pair; Phase 3 §2 and Phase 4
  §1 specify the load-time read-back and the storage clear on miss; "What We're NOT Doing" now
  distinguishes score-intact resume (S-09) from device recognition (here); criteria 2.7, 2.8, 4.7 and
  4.12 cover it.

### F2 — How the fresh join count reaches `next` is unspecified

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4 and §5
- **Detail**: Three constructors build a full `SessionState` literal — `advance.ts:36`, `reveal.ts:35`,
  `endedSessionState` in `state.ts:141`. The plan named only the third. Type-check catches omission
  (`SessionState` is zod's output type, so the field is required), but not the likely implementation:
  each constructor copying `current.playerCount`, so the count is read fresh and then discarded and the
  host's number never moves.
- **Fix**: Specify a single injection point — `applyHostAction` spreads the freshly-read count over
  `nextFrom`'s result — and pin it with an assertion that the published count *differs* from
  `current`'s, since "the field is present" passes against the bug.
- **Decision**: FIXED — Phase 1 §5 and §6 rewritten.

### F3 — `livequiz:player-ids` is written and never read

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 1 §1 and §3
- **Detail**: The reverse index existed "for S-09's resume", which the plan's own scope excluded, and
  nothing read it. Session data never outlives an evening, so S-09 could have added it for free.
- **Fix**: Conditional on F1 — Fix A gives it a reader; Fix B would have meant dropping it.
- **Decision**: DISMISSED — resolved by F1 Fix A. The index is now read by the returning-device check,
  and Phase 1 §1's docstring says so.

### F4 — Test blast radius under-enumerated; two suites will fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §6
- **Detail**: Five suites assert whole state objects with strict `toEqual`; the plan named three.
  Unnamed: `realtime.test.ts:107`, `routes.test.ts:150`, and `store.test.ts:158` — the last subtle,
  since `createSession` parses the returned JSON and gains `playerCount: 0` while the local fixture has
  no such key. `scripts/check-purge-residue.ts:140` also seeds a lobby document.
- **Fix**: Add the three unnamed files to Phase 1 §6, noting the fix belongs in the shared fixtures.
- **Decision**: FIXED — file list extended with a "blast radius" note.
- **Correction (2026-08-07, during Phase 1)**: this finding **over-predicted**. `realtime.test.ts` and
  `routes.test.ts` did *not* fail — both mock at a level where no schema parse happens, so their
  fixtures flow through untouched. Only `realtime.test.ts` needed a type-level fixture update (its
  `state` object is passed to a typed `publishSnapshot`), and `routes.test.ts` needed nothing at all.
  The prediction about `store.test.ts:158` held. What the finding *missed* is more useful than what it
  over-called: the real breakage was `advance.ts:36` and `reveal.ts:35` failing to compile — which is
  F2's mechanism, caught by the compiler exactly as F2 said it would be. Recorded rather than edited
  out, because a review that over-predicts on one axis and under-predicts on another is worth being
  able to see later.

### F5 — Progress titles drift from their Success Criteria bullets

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `## Progress`
- **Detail**: Roughly six rows were reworded rather than copied, and Phase 0's "Nothing to automate"
  bullet had no row. Phase headers all matched, so parsing was never at risk — but
  `progress-format.md:44` makes titles immutable once reviewed.
- **Fix**: Regenerate Progress verbatim from the Success Criteria; drop Phase 0's placeholder bullet so
  the omitted subsection is genuinely empty.
- **Decision**: FIXED — Progress regenerated (48 steps, 7 phases). New criteria took the next free
  index in their phase (2.7, 2.8, 4.12) rather than renumbering.

### F6 — The boundary gate misses the surface most likely to leak

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §4
- **Detail**: `boundary.test.ts` scanned `src/lib/client/*.ts` only, while Phase 4 puts view logic in
  inline `<script>` blocks in the two `.astro` pages — the place someone reaches for
  `import.meta.env`. `keys.test.ts:38` already scans those files for the same reason.
- **Fix**: Extend the scan to page `<script>` blocks, excluding frontmatter (which legitimately reads
  env and imports server modules).
- **Decision**: FIXED — scan scope widened, frontmatter exclusion stated, and `spine-check.astro`
  verified to pass without an exemption.

### F7 — No defined attendee behaviour for a mid-session purge

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 §1
- **Detail**: The view enumerated five states; state going `null` for an already-joined device — what a
  purge looks like from a phone — was a sixth, reachable from `spine-check.astro`, which the plan keeps.
- **Fix**: Render null-after-joined as `ended`, not as the name form.
- **Decision**: FIXED — added to Phase 4 §1, with the live path and the load path distinguished.
