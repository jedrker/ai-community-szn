# Final Winner Reveal — Plan Brief

> Full plan: `context/changes/final-winner-reveal/plan.md`

## What & Why

The host can end the segment on a winner screen instead of on the plain "To już koniec" text the
`ended` phase renders today. Roadmap S-10, PRD FR-006 (`nice-to-have`) and US-02 — the last slice on
the roadmap, and the one it names as the natural cut if effort runs out.

## Starting Point

Almost all the machinery is S-07's. `buildStandings` / `rankOf`, `readStandings`, `renderStandings` on
both screens and the "board is a transition payload" pattern all exist. What is missing is a *closing*
beat: `endedSessionState` explicitly nulls the board (`state.ts:403`), the schema refuses one outside
the `standings` phase, `result.ts`'s `ended` branch serves the running total with no rank, and `end`
lives off the host view entirely by an F-03 decision — the runbook tells the host to close from a
terminal. The leaderboard contract names the first three as inherited by this slice.

## Desired End State

The host taps **zakończ**, confirms, and the room lands on a closing screen: the winner at the largest
type the projector carries, the rest of the top five beneath, and on every phone the same five rows
with its own row highlighted and its own final position under it — including the attendees outside the
top five, who today leave knowing only their total. A device reloading inside the ~10-minute window
finds the same screen.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Which phase carries the board | The `ended` phase itself | The closing screen *is* the terminal state, which is what `state.ts:424` and the leaderboard contract name as this slice's inheritance — no new phase for `advance` / `reveal` / `standings` to be taught about. |
| How the host triggers it | New "zakończ" button with a two-tap confirmation | FR-006 says the host triggers this, and a terminal window in front of a room does not; `end` already takes a `confirmVersion` that makes a mis-click refusable. |
| What the room sees | One published state, one screen | A staged or animated reveal puts 150 phones on their own clocks against the projector in the one moment everyone watches both. |
| Board size | Top five, `STANDINGS_SIZE` unchanged | No schema change and no second bound to keep in step with the retention decision; the winner is a styling difference. |
| Five names on the ended document for the full TTL | Accept, bound it, write it down | The same names went to the same devices minutes earlier; the alternatives each break something built on purpose, and `lessons.md:101` requires amending the documents that state the old guarantee in the same change. |
| Attendee's own closing line | Final rank + total via `readOwnRank` | Closes the gap the leaderboard contract handed the slice, and shares `rankOf` so a phone cannot contradict the projector. |
| Board read fails at close | End anyway, plain screen | Ending is what moves attendee data onto the ten-minute lifetime — a host who cannot close because an `HGETALL` blipped is stuck in front of a room. |

## Scope

**In scope:** the ended-phase board · the closing button with confirmation · the final rank on each
phone · winner styling on the projector · the slice contract, runbook and PRD retention amendment ·
a `host.test.ts` structural scan for the confirmation guard.

**Out of scope:** staged 3 → 2 → 1 reveal or animation · a podium shape · changing
`ENDED_TTL_SECONDS` · stripping `standings` from `GET /api/quiz/state` · any new store key, log event,
snapshot field or phase · removing `bun run quiz:reset` · an F-04 harness re-run · moving `purge` onto
the host view.

## Architecture / Approach

Carry the existing board onto the existing terminal document and let the existing renderers paint it.
`end.ts` reads the board inside its `applyHostAction` transition closure — never beside `playerCount`
in the shared helper, which would attach a board to every action including the `advance` that opens the
next question. The host projector needs no render logic at all: it already keys the board on
`standings !== null` rather than on the phase. The real restructure is on the phone, where `ended` and
"purged" are currently one branch that clears everything.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Ended document carries the board | Schema clause widened, `endedSessionState` takes a board, `end.ts` reads one | The widening is one character from allowing a board in every phase — pin it per phase, both directions |
| 2. Attendee's final position | `result.ts`'s `ended` branch returns a rank | Diverges from the standings branch by degrading to a null rank instead of a 503; easy to "fix" back |
| 3. The two closing screens | Winner styling; the phone's `ended` branch split from its purge branch | The purge half must keep clearing rank state or a stale rank matches a version in the next session |
| 4. The host's closing button | An irreversible verb on a stage screen, guarded by a confirmation | Reverses an explicit F-03 decision; `fire`'s blanket re-enable can leave the button armed |
| 5. Contract, runbook, PRD | The documents that state the old guarantee | Prose is a third of the slice and is the first thing trimmed under pressure |

**Prerequisites:** S-07 delivered (it is). No new infrastructure, no env vars, no store changes.
**Estimated effort:** ~2 sessions across 5 phases; phases 1–2 are small and mostly tests.

## Open Risks & Assumptions

- **The redis client is mocked throughout the suite**, so the board read at close is exercised by no
  test against a real store — the same limit S-09 recorded. The manual rows carry it.
- **The name window is now bounded by a TTL rather than by the host's attention.** Accepted, recorded,
  not eliminated.
- **The inline `<script>` in `host.astro` has no harness**, so the confirmation guard is protected by a
  source scan — which asserts shape unless deliberately written to assert the property.
- Command cost is assumed negligible against an unexplained baseline two orders of magnitude above
  what the code accounts for. Inherited knowingly.

## Success Criteria (Summary)

- The host ends the segment from the stage in two taps, and the room sees a winner rather than a
  sentence.
- Every attendee learns where they finished, and the phone never disagrees with the projector.
- A store failure at the close costs the board, never the close.
