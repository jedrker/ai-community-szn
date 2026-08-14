<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Final Winner Reveal

- **Plan**: `context/changes/final-winner-reveal/plan.md`
- **Scope**: Full plan — Phases 1–5 of 5
- **Date**: 2026-08-14
- **Verdict**: NEEDS ATTENTION (triaged 2026-08-14 — 4 fixed, 1 skipped, 1 recorded as a lessons.md rule)
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

Automated criteria re-run at review time: `bun run test` 1188/1188 passing across 34 files;
`bun run type-check` 0 errors; `boundary.test.ts`, `host.test.ts`, `keys.test.ts` and
`portability.test.ts` 91/91.

## Findings

### F1 — A checked manual row describes behaviour the code cannot produce

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/pages/quiz/index.astro:465`, `:700`; plan Progress row 2.5
- **Detail**: Row 2.5 reads "A phone that never joined sees the board and no position line" and is
  checked off. `render()` opens with `if (!joined) return;`, and `joined` is set only inside
  `enterSession`, which always sets `player` too. So a device that never joined never reaches any
  render branch — it sits on the join form and sees no board at any point, closing screen included.
  The row cannot have been observed as written. The same fact makes `renderBoard`'s `if (!player)`
  spectator branch unreachable (pre-existing from S-07 — this slice inherited it and then wrote a
  verification row on top of it). This is `lessons.md`'s first rule, from the other direction: the
  plan asserted an affordance the data path does not deliver.
- **Fix A ⭐ Recommended**: Correct the record — rewrite row 2.5 to the behaviour that exists ("a
  device that never joined stays on the join form"), and mark the `if (!player)` branch in
  `renderBoard` as unreachable-by-construction or delete it.
  - Strength: The current behaviour is defensible — a phone with no claim has no result to show, and
    the join form is the more useful screen. Nothing shipped is wrong; only the record is.
  - Tradeoff: Loses a spectator mode nobody has asked for. `!player` is cheap insurance if `joined`
    and `player` ever decouple, so deleting the branch is the riskier half of this option.
  - Confidence: HIGH — traced every assignment of `joined` and `player`.
  - Blind spot: None significant.
- **Fix B**: Make spectators real — let a device follow the session without claiming a name, so the
  board and the closing screen are visible without joining.
  - Strength: Delivers what the row claims, and a projector-adjacent phone could watch.
  - Tradeoff: A slice's worth of work in the wrong slice — it touches the join gate, the boot path
    and the connection budget, and FR-006 asked for none of it.
  - Confidence: MEDIUM — the render path would take it, but the join/boot flow is untouched territory.
  - Blind spot: Ably connection ceiling — spectators consume connections against the 200 cap.
- **Decision**: FIXED via Fix A — row 2.5 rewritten to the behaviour that exists, in both the Phase 2 criterion and the Progress row; the unreachable `!player` branch annotated rather than deleted.

### F2 — A repo-tracked permission allowlist gained a blanket `python3 -c` entry

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `.claude/settings.local.json:29-30`
- **Detail**: Committed in `6ff675a` on an explicit "stage all" instruction, so the staging was
  authorised — the content is what is worth a second look. `Bash(python3 -c ' *)` permits any Python
  one-liner without a prompt, which is arbitrary code execution, and the file is tracked, so it
  applies to every future agent session in this repo rather than to this one. The neighbouring entry
  pins a one-off `grep` of the runbook as a permanent rule. Both accumulated from commands I ran
  during this session; neither is related to S-10.
- **Fix**: Drop both entries in a follow-up commit; re-add narrower ones if the prompts become
  annoying.
- **Decision**: FIXED — both entries removed from `.claude/settings.local.json`; file re-validated as JSON.

### F3 — The closing log line landed in `store.ts`, not in `end.ts` as planned

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/session/store.ts:730`
- **Detail**: Phase 1 specified "log `session.ended` with `playerCount` and `rowCount`" in the route.
  `endSession` already emitted `session.ended`, so a route-level line would have been the second per
  close — against the runbook's "one line per mutation, one JSON object" property, which is how a host
  is told to read the stream. `rowCount` was added to the existing line instead; `playerCount` was
  dropped, since that layer does not hold a fresh count and `session.action.applied` already carries
  one. Deviation was reported at the phase gate before committing.
- **Fix**: None needed — record the deviation in the plan if the plan is treated as ground truth by
  later reviews.
- **Decision**: FIXED — deviation recorded as a block quote under Phase 1's log-line entry in `plan.md`.

### F4 — `CLAUDE.md` edited although Phase 5 listed four documents

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `CLAUDE.md:376`, `:382`
- **Detail**: Phase 5's Changes Required named the contract, the runbook, the PRD and the roadmap.
  `CLAUDE.md` was edited too, because two of its statements became false with Phase 1 — "each [transition
  field] is set by exactly one constructor" and the retention paragraph — and `lessons.md:101` requires
  amending documents that state the old guarantee in the same change. An EXTRA that the plan should
  have listed rather than one that should not exist.
- **Fix**: None needed; note it as a planning gap — every prior slice that changed `SessionState`
  touched `CLAUDE.md`, so the plan could have predicted it.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "The CLAUDE.md edit is part of the slice, not a discovery at the end of it" (`lessons.md`). `CLAUDE.md` added to Phase 5's Changes Required, flagged as added after the fact.

### F5 — A dropped connection leaves the board on screen under "Utracono połączenie"

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `src/pages/quiz/index.astro:472-494`
- **Detail**: The `connection === "lost"` branch returns before the board-visibility line, so whatever
  the section last held stays painted under the connection message. Pre-existing shape from S-07, not
  introduced here — but S-10 moved it onto the *last* screen of the segment, where phones going to
  sleep, tabs backgrounding and people leaving the room make a lost connection ordinary rather than
  exceptional. The stale board is also correct at that moment (the session is over and the standings
  will not change), which is why this is an observation and not a warning.
- **Fix**: If it ever reads wrong on the night, hide the board in the `lost` branch for live phases and
  leave it for `ended` — the board is stale-but-true only once the segment has closed.
- **Decision**: SKIPPED — the stale board is true once the segment has closed; revisit only if it reads wrong live.
