# Verification — break the code, watch the named test fail, restore

> §1's fourth rule, discharged as evidence rather than as intent. Every row was **run**, not
> reasoned about. `/10x-plan`'s phase 1 of the previous rollout condemned six guards by reading
> them and vindicated all six by running them — this table exists so a later reader does not have
> to take the discipline on trust.

Each break was applied to the committed code, the suite was run, and the file was restored and
confirmed byte-identical with `git diff --stat` before moving on.

## Phase 1 — the adoption seam

| # | Break | Expected | Observed |
|---|---|---|---|
| 1.a | Accept an equal version: `state.version <= current.version` → `<` (`session.ts:526`) | the same-version test fails | ✅ 1 failed — "drops a snapshot at the same version" |
| 1.b | Refuse `null`: guard becomes `if (current && (!state \|\| state.version <= current.version))` | the purge tests fail | ✅ 3 failed — both purge tests and the absent-session latch |
| 1.c | Advance the latch above the guard, not below it | the dropped-snapshot latch test fails | ✅ 1 failed — "does not advance the latch on a snapshot the guard dropped" |
| 1.d | — (the extraction itself; see below) | — | `bun run e2e` 2/2 pass after the extraction |

**Rows 1.a–1.c were run late, during the implementation review, and that is the finding.** This
file first recorded a placeholder here, arguing that the reconciler's tests were new code whose
"failure mode is absence rather than silence". That does not hold up: the version guard is one
comparison operator, and a `<` where `<=` belongs is exactly the silent defect §1's fourth rule
exists for. *The phase whose subject is a rule nobody ever watched fail nearly shipped its own tests
without watching them fail.* The rationale is deleted rather than softened, so it cannot be quoted
as precedent.

**Row 1.d is a different kind of gap, and it stays open by nature.** A botched extraction — wiring
the client to a reconciler it then ignores — passes every test in `session.test.ts`, because those
tests construct the reconciler directly. No unit break can reach that; `bun run e2e` is the only
automated thing between that mistake and production, which is why it moved into this phase.

## Phase 2 — the loop's cancel semantics

| # | Break | Expected | Observed |
|---|---|---|---|
| 2.a | Remove `arm()` from `tick`'s `finally` (`session.ts:474`) | both pins fail | ✅ both failed, plus 6 loop tests — the re-arm is load-bearing well beyond these |
| 2.b | Make `stop` and `pause` terminal (set `disposed`) — i.e. **fix the defect** | all three fail | ✅ exactly 3 failed, 60 passed |

Row 2.b is the one that matters. It is the future in which somebody repairs `pause`, and it
confirms the pins track the property rather than the wording: the repaired `:567` test fails there,
where its predecessor would have stayed green, because `refresh === 2` holds either way.

## Phase 3 — the reveal-race refusal

| # | Break | Expected | Observed |
|---|---|---|---|
| 3.a | Client: drop the `refusal` check, map every 409 to `rejected` (`client/answer.ts:461`) | the `expired` contrast fails | ✅ 1 failed |
| 3.b | Route: give store-level `not-open` its own refusal class (`answer.ts:420`) | the pin fails | ⚠️ **only the mechanism test failed — the pin stayed green** |
| 3.c | Both 3.b and the client half together — the complete fix | both reveal-race tests fail | ✅ 2 failed |

**Row 3.b is a finding, not a defect in the test.** Classifying the refusal at the route changes
nothing an attendee experiences: the client maps *every* non-`expired` class to `rejected`, which is
final. The fix takes both halves, and the two-test split is what makes the half-done state visible —
a single test would have gone green at 3.b and reported the defect fixed while the phone still
locked.

## Phase 4 — the reveal's distribution drift

| # | Break | Expected | Observed |
|---|---|---|---|
| 4.a | Close the gap: hoist `readPlayerCount()` above the `nextFrom` callback in `host.ts:230` | both drift tests fail | ✅ 2 failed |
| 4.b | Land the concurrent answer inside the tally-read mock instead of in the gap | the drift disappears | ✅ the pin failed with `answered: 4` vs `3` |

Row 4.b is the plan's manual criterion 4.4, run as an experiment rather than read: it proves the
fixture reaches the branch the test names, per `lessons.md`'s "Prove the fixture reaches the branch".
An increment landing *before* the read is a race that cannot happen, and a test written that way
would assert nothing.

Row 4.a doubles as a **candidate fix** for the follow-up change: `playerCount` is documented as
stale-tolerant, so reading it before the callback costs nothing and removes a round trip from the
window. It is not applied here — this rollout measures rather than repairs.

## What no break could reach

The atomic script itself. `redis.eval` is a `vi.fn()` throughout the suite, so the Lua is passed as
a string and never executed; whether 150 concurrent submissions land 150 increments is invisible to
every test in this repository by construction (`store.test.ts:1010-1015` says so itself). The only
tool that drives it is `scripts/rehearse-room.ts`, by hand, against production, and it never reveals
during its burst. That gap is unchanged by this phase and is recorded as the rollout's named
residual in test-plan §6.6.
