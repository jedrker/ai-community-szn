# Sync Under a Degraded Link — Plan Brief

> Full plan: `context/changes/testing-sync-degraded-link/plan.md`
> Research: `context/changes/testing-sync-degraded-link/research.md`

## What & Why

Rollout phase 2 of the test plan, covering Risk #3 (a device that receives a newer snapshot and
fails to adopt it) and Risk #4 (an answer submitted just before the reveal that is refused in a way
the phone reports as answered, or is missing from the distribution the room sees). Research
falsified part of each row: the poll loop is already well covered and double-counting is
structurally impossible, so the phase aims at what is genuinely uncovered — the *adoption* decision
and the two loss mechanisms at seams above the atomic script. **It pins today's behaviour rather
than fixing it**, because a test written against repaired code has never been observed failing.

## Starting Point

`apply` — the version guard that is the client's only convergence primitive — is a closure inside
`createSessionClient`, which no test in the repo constructs; the archive recorded and accepted that
gap a slice ago. On the answer side, the route's 409 for a store-level `not-open` and the client's
mapping of a refusal-less 409 to the final `rejected` are each covered on their own and green;
nothing joins them, which is where the failure lives. The reveal's tally read sits outside the
version guard with a one-answer drift asserted only in a comment.

## Desired End State

The adoption rule is an exported unit with executing tests. An integration test shows the
reveal-race refusal reaching the attendee's client as final, and another shows the projector's bars
short by exactly the answer that landed in the reveal's read-to-commit gap. The two loop defects
found in passing are pinned and named as findings. Every test has been broken and restored on the
record, and `test-plan.md` §6.2 stops reading "TBD".

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Risk #3's seam | Extract `createSnapshotReconciler` from `createSessionClient` | Covers the version guard, the `null` wipe and the `sessionOver` latch together, in the stateful-factory shape `countdown.ts` set; constructing the whole client would need an Ably fake the project forbids | Plan |
| Risk #4(a)'s shape | Route → client seam test over a real `Response` | Both halves are already green separately; only the composition can fail | Plan |
| Risk #4(b) | Pin the drift with an interleaved mock | Turns "at most a one-answer drift" from prose into an assertion, and proves the read really is outside the guard | Plan |
| The two loop defects | Repair `session.test.ts:567`; pin `pause()` as non-terminal; fix neither | The test plan's 2026-08-16 decision — this phase measures, a later change repairs | Research + test plan |
| Store instance | None; the uncovered failures sit above the Lua | No local or ephemeral Redis exists, Playwright is single-threaded, and the only real-concurrency tool points at production | Research |
| `rehearse-room.ts` | Not extended | A by-hand script against the production namespace gates nothing, and phase 1's impl-review showed what a misfire there costs | Plan |
| Verification evidence | A break-and-restore table in the change folder | Phase 1 condemned six guards by reading them and vindicated all six by running them | Plan |
| Risk #3's third proof clause | Met for `dispose` only; recorded in §2 and §6.6 rather than implied by a green row | Phase 2 pins its *failure* for `stop` and `pause`, so "complete" is honest about deliverables, not about the clause | Plan review |
| When a pin goes red | Invert the expectation, never restore the behaviour — stated at each test and once in §6.6 | A pin is the most inviting instance of the anti-pattern §2 names: repairing a guard back toward the bug it caught | Plan review |
| `bun run e2e` | Runs in phase 1, with a refuse-if-live precondition | It is the only automated layer that can see a botched extraction, since `createSessionClient` stays untested by design | Plan review |

## Scope

**In scope:** one behaviour-preserving extraction in `session.ts`; reconciler tests; the repaired
cancellation test and the `pause` pin; `answer.seam.test.ts`; `reveal.drift.test.ts`;
`verification.md`; test-plan §6.2/§6.6/§3/§8 and CLAUDE.md's extraction list.

**Out of scope:** fixing either defect; constructing `createSessionClient` with a faked Ably;
extending the rehearsal script; any store instance; rebuilding the deadline boundary tests; the
stage-blindness product absence (PRD/runbook, a change of its own).

## Architecture / Approach

Two seams, one extraction. `apply` moves out of a closure into an exported factory the client
consumes, so the adoption rule can be driven directly. The two integration tests work by letting
mocks that already exist *disagree* — `readSession` says open while `submitAnswer` says `not-open`;
`readQuestionTallies` returns a count that grows before `writeSession` runs — and by running one
real module against another with only the transport between them stubbed. Nothing new is installed.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The adoption seam | `createSnapshotReconciler` + its tests | The only product change; the suite cannot see a botched extraction, so `bun run e2e` is the safety net |
| 2. Loop lifecycle pins | Repaired `:567`, `pause` pinned | Wording — a pin reads as endorsement unless it says it is the recorded gap |
| 3. The reveal-race refusal | `answer.seam.test.ts` | A new test shape; it must not blur into `answer.test.ts`'s stated scope |
| 4. The distribution drift | `reveal.drift.test.ts` | The increment must land in the gap, not before it, or the test is vacuous |
| 5. Verification and documents | `verification.md`, test plan, CLAUDE.md | A table that records intent rather than observation defeats its own purpose |

**Prerequisites:** none beyond the research doc; no new dependency, no store, no CI.
**Estimated effort:** ~2 sessions across five phases, phase 1 the largest.

## Open Risks & Assumptions

- The extraction is asserted to be behaviour-preserving; `bun run test`, `bun run e2e` and a
  two-device manual pass stand behind that, since `createSessionClient` itself remains untested by
  design. The e2e run drives the real Upstash namespace, so it carries a refuse-if-live
  precondition.
- Risk #3's third proof clause — "a cancel is not undone by a request already in flight" — comes
  out of this phase met for `dispose` and pinned as failing for `stop` and `pause`.
- Both pinned defects stay live in production until a follow-up change picks them up; the findings
  land in §6.6 rather than in an issue tracker, so they depend on someone reading it.
- The interleaving below the Lua — a reveal fired during a 150-answer burst — remains covered by
  nothing, deliberately, and is recorded as the phase's named residual.
- `verification.md` is hand-maintained and can drift from the suite.

## Success Criteria (Summary)

- The rule that decides whether a phone adopts the host's newer snapshot fails a test when it is
  broken — today nothing in the project would notice.
- The two ways an answer can be lost at the reveal boundary are each demonstrated by a test that
  goes red when the seam is closed.
- A future contributor can write the next integration test from §6.2 without re-deriving where the
  store instance went.
