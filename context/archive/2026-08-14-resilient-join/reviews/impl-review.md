<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Resilient Join (S-09)

- **Plan**: `context/changes/resilient-join/plan.md`
- **Scope**: Phases 1–5 of 5
- **Date**: 2026-08-14
- **Verdict**: NEEDS ATTENTION → all four findings fixed 2026-08-14
- **Findings**: 1 critical, 1 warning, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria re-run at review time: `bun run test` 1163 passing, `bun run type-check` 0 errors,
`bun run build` complete.

Checked and cleared: `scripts/reset-quiz.ts` and `scripts/check-purge-residue.ts` both derive from
`registeredKeys()`, so `livequiz:devices` is covered by the pre-session reset and the residue scan
with no further change.

## Findings

### F1 — Storage-stranded copy fires on the ordinary taken-name path

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/index.astro:1554
- **Detail**: The gate is `payload.refusal === "taken" && readPlayer(storageKey) === null`. A
  first-time joiner also has no stored player, so the ordinary FR-008 case (two people in 150 pick
  "Anna") gets the storage-failure copy — "to urządzenie jej nie pamięta … wcześniejszych punktów nie
  odzyskamy" — which is alarming and false for someone joining for the first time, on the most common
  refusal in the room, inside the 30-second window. A regression: the plain message was correct
  before. Same conflation `store.ts:795` documents for not-found/failed. Nothing caught it because
  the inline script has no test harness.
- **Fix A ⭐ Recommended**: Gate on storage being unavailable rather than on player absence.
  - Strength: That is the discriminator the copy claims to use; a first-time joiner with working
    storage never sees it. `device.ts` already learns whether the write succeeded.
  - Tradeoff: Narrower — a mid-session "clear site data" is undetectable and falls back to the plain
    message. Correct-but-silent beats wrong-and-loud.
  - Confidence: HIGH — failure and fix are both mechanical.
  - Blind spot: Safari private mode often permits localStorage with a quota, so the hint may fire
    less often in the field than expected.
- **Fix B**: Soften the copy so it is harmless either way.
  - Strength: One line, no new plumbing.
  - Tradeoff: Keeps showing storage speculation to people it does not apply to; the specificity is
    what made it worth adding.
  - Confidence: MEDIUM — depends on wording nobody can test.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A. `device.ts` now records whether the id could be persisted and
  exposes `deviceStoragePersists(storageKey)`; the view gates the extra copy on that instead of on
  player absence, so a first-time joiner never sees it. Four tests added, verified in both
  directions (forcing `persisted` to `true` fails the broken-write test).

### F2 — The runbook's reload check sits where no session exists

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: docs/runbook-live-session.md:217 (step 3)
- **Detail**: The check was folded into step 3 ("load the site on a second device"), but step 4 is the
  mandatory session reset and the session is not started until later. A host following the steps in
  order cannot join — or joins a stale session that step 4 purges. This is the only place the Lua cap
  is ever executed, so placed where it cannot run the guard has no verification at all.
- **Fix**: Move the reload-and-cap check after the reset and host-secret steps, as its own step 6,
  and note that it needs a started session.
- **Decision**: FIXED. Now step 6, after the reset and the host secret, stating that it needs a
  started session (the `start` press doubles as step 5's throwaway action) and that it must be
  followed by a second `bun run quiz:reset`, since the check leaves four players and a spent cap
  allowance behind. Step 3 keeps a pointer to it. The tripwire is renumbered to 7.

### F3 — `deviceId` is the only untrusted input with no length bound

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/quiz/join.ts:170
- **Detail**: The project bounds every other attendee-supplied field (name 24, word 24, text 80,
  guess input). `deviceId` is checked for presence only and becomes a Redis hash field name. No
  injection risk — it travels as an EVAL ARGV — and writes happen only on a successful claim, so
  growth is bounded by unique names; the exposure is field size, not field count. Weakened by
  precedent: `playerId` has the same unbounded shape today.
- **Fix**: Add a length ceiling beside the presence check, refusing with the existing `noDevice`
  message.
- **Decision**: FIXED. `MAX_DEVICE_ID_LENGTH` (64) added beside the other bounds in `players.ts` and
  enforced in the route. Two tests — one over the bound, one exactly at it — built from the constant
  rather than a literal; verified by removing the bound. `playerId`'s matching gap is left alone
  deliberately and the reason is recorded in the constant's docstring: bounding it would add a new
  refusal to the resume path, which is the path this slice exists to keep open.

### F4 — Two Progress rows no longer describe what was verified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/resilient-join/plan.md (Progress 2.6, 4.3)
- **Detail**: 2.6 reads "Nothing user-visible changed — no claim is capped yet", which stopped being
  true once the route wiring moved into Phase 2; it was checked against substituted criteria named at
  the gate. 4.3 reads "the zero-total test", but the test that satisfies it is the corrupt-total one —
  the zero test provably could not fail. Both substitutions are recorded in the commits, not in the
  plan a future reader opens first.
- **Fix**: Append a one-line note to each row recording what was actually verified.
- **Decision**: FIXED. Both rows keep their planned titles and carry a note recording the
  substitution — 2.6's superseded statement and the checks used instead, and 4.3's zero-test that
  could not fail versus the corrupt-total test that does.
