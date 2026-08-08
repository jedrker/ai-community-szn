<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Join and Follow Host (S-02)

- **Plan**: `context/changes/join-and-follow-host/plan.md`
- **Scope**: Phases 1–2 of 7 (Phase 0 still open on human readings)
- **Date**: 2026-08-08
- **Verdict**: NEEDS ATTENTION → APPROVED after triage
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING → accepted |
| Safety & Quality | WARNING → PASS after fixes |
| Architecture | PASS |
| Pattern Consistency | WARNING → PASS after fixes |
| Success Criteria | PASS |

## Success criteria re-run

All 10 automated criteria across both phases pass on re-run: `bun run test` (337 tests, 17 files),
`bun run type-check` (0 errors), `keys.test.ts` (20), `public.test.ts` (18), and `bun run build`
completes cleanly. The single-`eval` assertion for `claimPlayer` is present. Manual rows 1.6, 2.5,
2.6 and 2.8 are checked and were confirmed by the user at the time.

## Findings

### F1 — Every join costs two store round trips where one would do

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/quiz/join.ts:104,137 (claim) and :67,70 (resume)
- **Detail**: `CLAIM_PLAYER` already does `GET` on the session key as its first statement — it must,
  to check the phase — and then discards the document, returning only `{status, count}`. `join.ts`
  immediately calls `readSession()` to fetch the very same document again. The resume path does the
  same: `readPlayerById` (EVAL) followed by `readSession` (GET). So a 150-device room spends ~300
  store commands on joining where ~150 would do, and the second read is not fresher in any way that
  matters — it can only be *staler* relative to the claim it reports on. This is the one code path
  that multiplies by room size, and it lands while the command-counter anomaly (513 → 4102, Phase 0)
  is still unexplained and Phase 5 is about to take the first measurement with attendee writes in
  the system.
- **Fix A ⭐ Recommended**: Return the session document from the two scripts
  - Strength: The data is already in hand inside the Lua — `raw` is read and thrown away. Halves the
    per-join cost on both paths, makes the returned state provably consistent with the claim that
    just succeeded (which also dissolves F5), and makes Phase 5's measurement describe the design
    rather than an accident of it.
  - Tradeoff: Both scripts' return shapes change from `{number, number}` to `{number, number,
    string}`, so `store.test.ts`'s claim assertions and the `ClaimResult` union move with them.
  - Confidence: HIGH — the read already exists at `store.ts` `CLAIM_PLAYER` line 2; this is
    returning a local, not adding a call.
  - Blind spot: Not yet checked whether `@upstash/redis` types a mixed-type Lua array cleanly; the
    existing scripts all return uniform numeric arrays.
- **Fix B**: Leave it — 300 commands is far inside the free tier
  - Strength: No churn to a guard that is tested and working, and the cost is genuinely negligible
    in money (500K/month allowance).
  - Tradeoff: Bakes a 2× multiplier into the exact path Phase 5 measures, on top of a baseline
    nobody has explained yet — which is how a measurement stops being able to answer its question.
  - Confidence: HIGH — the cost claim is arithmetic.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `CLAIM_PLAYER` and `READ_PLAYER_BY_ID` now return the session document they already read; `join.ts` drops both second reads and no longer imports `readSession`. Join is one store round trip on both paths, pinned by `join.test.ts` → "joins in one store round trip, on both paths", which asserts `readSession` is never called.

### F2 — The two join events are emitted from different layers

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/session/store.ts:575 vs src/pages/api/quiz/join.ts:82,87,94,107,115,120
- **Detail**: `session.player.joined` is logged inside `claimPlayer` (the store layer); all six
  `session.join.rejected` lines are logged in the route. The event family is split across two
  layers, so a second caller of `claimPlayer` would inherit success logging for free and no
  rejection logging at all. Every other event in the vocabulary is emitted from exactly one layer.
- **Fix**: Move the `session.player.joined` call from `claimPlayer` up into `join.ts`, beside the
  rejection lines, so the whole family lives at the route.
- **Decision**: FIXED — `session.player.joined` moved out of `claimPlayer` and into `join.ts` beside the six rejection lines. `store.test.ts` keeps the name-never-logged assertion (which must hold wherever it is emitted); `join.test.ts` gains "emits both join events from this one layer".

### F3 — A raw zero-width space sits in test source

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/session/players.test.ts:90
- **Detail**: The assertion `rejected("Anna​Anna")` contains a literal U+200B — confirmed as the raw
  byte sequence `e2 80 8b` in the file. It is invisible in every editor, so a formatter, a
  copy-paste, or a well-meaning cleanup can silently remove it, at which point the test asserts that
  `"AnnaAnna"` is rejected, which it is not. It would fail loudly rather than silently, but the
  likely repair is deleting the assertion rather than restoring the character.
- **Fix**: Write it as the escape `"Anna​Anna"` so the intent survives any editor.
- **Decision**: FIXED — raw U+200B replaced with the `\u200b` escape, with a comment explaining why the raw character must not come back. Verified no `e2 80 8b` bytes remain in the file.

### F4 — A double-tapped join reports the attendee's own name as taken

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/quiz/join.ts:98-108 (behavioural; the fix lands in Phase 4)
- **Detail**: Two rapid submits mint two different player ids. The first claims the folded name; the
  second comes back `taken`, so the attendee is told their own just-claimed name is unavailable —
  at the exact moment the 30-second target is running, on a phone, where double-tapping a button
  that has not visibly responded is the normal thing to do. The first request did succeed, so the
  device also now holds a valid player id it may have discarded. Nothing in the plan's Phase 4
  section mentions disabling the submit control, and this was discovered in Phase 2.
- **Fix**: Phase 4's attendee view must disable the submit control on first press and keep it
  disabled until the response resolves — the pattern `spine-check.astro` already uses for host
  actions. Worth recording in the plan's Phase 4 notes so it is not rediscovered on stage.
- **Decision**: FIXED (recorded for Phase 4) — the plan's Phase 4 §1 now requires the submit control to disable on first press until the response resolves, with success criterion and Progress row 4.13 added. Not a code change in this phase; the view does not exist yet.

### F5 — `state: null` on a successful claim is indistinguishable from a purge

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/quiz/join.ts:137-142
- **Detail**: If `readSession()` returns `invalid`, `failed` or `unconfigured`, the route still
  answers 200 with a valid `player` and `state: null`. The plan's Phase 4 spec renders
  null-after-joined as the ended screen — so a transient store blip during the join burst would show
  a just-joined attendee "the session is over". Rare, and it self-corrects on the next snapshot, but
  the failure presentation is maximally wrong for the moment it happens in.
- **Fix**: On a successful claim with `state: null`, have the client re-prime from `/api/quiz/state`
  rather than rendering a terminal screen. Resolved entirely by F1 Fix A, which makes the state come
  from the same script as the claim.
- **Decision**: RESOLVED by the F1 fix — state now comes out of the claim script itself, so a successful claim cannot carry a null state unless there genuinely is no session. Pinned by `join.test.ts` → "returns the state the claim itself was checked against".

### F6 — `check-purge-residue.ts` was repaired outside the plan's file list

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/check-purge-residue.ts:29-60
- **Detail**: Phase 1's Changes Required does not list this file. It was changed because the script
  hardcoded `EXPECTED_REGISTERED = ["livequiz:session"]` behind a docstring asserting two things that
  were both false — that `keys.ts` cannot be imported under bare `bun`, and that an assertion kept
  the list in sync. With S-02's two new keys it would have purged one key of three, left both hashes
  of attendee names in the store, and reported a green run. Flagged to the user when made, and it is
  recorded here so the EXTRA is visible to a later reader rather than only in a commit body.
- **Fix**: No action — the change is correct and was surfaced at the time. Recorded for the audit
  trail.
- **Decision**: ACCEPTED — correct change, surfaced to the user when made, recorded here for the audit trail. No action.

### F7 — The player id becomes a bearer credential in S-03

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/session/players.ts:113-121
- **Detail**: `newPlayerId`'s docstring says the id "is not a secret — holding someone else's id
  would let you claim to be them — which is acceptable under the PRD's stated model". That is true
  *today*, because the id carries nothing: the worst an impostor gets is a display name. From S-03
  the same id carries a score, and from S-07 a leaderboard position, so the sentence justifying the
  posture stops being about nothing and starts being about the thing the segment builds toward. A v4
  UUID is unguessable, so the practical risk stays low and the PRD's no-accounts decision still
  holds — the issue is that the *reasoning* will be inherited rather than re-taken.
- **Fix**: Add a line to the docstring marking the claim as scoped to S-02, so S-03 re-decides rather
  than inherits. `join-contract.md` (Phase 6) should carry the same note.
- **Decision**: FIXED — `newPlayerId`'s docstring now scopes the "not a secret" claim to S-02 and states that S-03 must re-take it rather than inherit it, since from S-03 the id carries a score. `join-contract.md` (Phase 6) carries the same note.
