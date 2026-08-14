# Winner reveal contract (S-10)

Fifth after `spine-contract.md` (F-02), `retention-contract.md` (F-03), `join-contract.md` (S-02),
`leaderboard-contract.md` (S-07) and `word-cloud-contract.md` (S-08) — and it inherits their warning:
**a contract that grows past a page has become a second copy of the plan, and a second copy can
disagree with it.** A pointer, not a summary.

Read before touching the `ended` phase, the closing screen, or the host view's irreversible verbs.

## Two phases may carry a board now, and they are not symmetric

`BOARD_PHASES` in `state.ts` is `{ standings, ended }`. The asymmetry is the decision, and merging the
two clauses in either direction breaks something:

| | `standings` | `ended` |
| --- | --- | --- |
| Board **permitted** | yes | yes |
| Board **required** | **yes** — the board *is* the phase; a null one is a blank projector | **no** |
| Failed `readStandings` | route refuses the transition, room stays on the reveal | **session still ends**, plain closing screen |

`end` may never be refused over a board it could not read: it is what moves every key onto
`ENDED_TTL_SECONDS`, so a blocked close leaves the retention guardrail unserved with a host stuck in
front of a room. The beat is optional; the close is not. `state.test.ts`'s "accepts the ended phase
with NO board" is the tripwire, and widening the requires-clause to `BOARD_PHASES` fails five tests.

`endedSessionState(current, now, standings?)` takes the board it is handed, **never
`current.standings`** — ending from a beat must publish a freshly-read board or the closing screen
freezes the room on one computed before the last answers landed.

## The retention window changed shape. It was accepted, not mitigated

Third deviation in the PRD's retention guardrail (Deviation 2's dated chain). Same bound as S-07 — at
most `STANDINGS_SIZE` (5) display names, no player id — but the window is now **bounded by a TTL
rather than by the host's attention**: the names sit on the terminal document for
`ENDED_TTL_SECONDS` and are readable through the deliberately unauthenticated `GET /api/quiz/state`,
which is the binding surface here exactly as S-07's implementation review found it to be there.

Accepted because the same five names reached the same devices minutes earlier during the beat, and
because both alternatives break something built on purpose: shortening the TTL removes the window
F-03 built so a reloading attendee still finds their result, and stripping the field from the state
route leaves a device on the connection-limit polling fallback looking at a closing screen with no
board — the failure S-07 already rejected that fix for.

## `end` is on the host view. `purge` is not

S-10 reversed half of an explicit F-03 decision, and the reversal is answered by guards rather than by
distance: no `data-action` (so the flow verbs' blanket handler cannot reach it), `disabled` in markup
and by phase, two taps, disarmed by any action that moves the session, and the second tap sends the
version the host confirmed — which the route refuses if stale. `host.test.ts` scans all of it; the
page's docstring quotes the position it overturned rather than deleting it.

`purge` stays on the harness page. It deletes with no undo and no window, and FR-006 asked for
neither.

## The closing screen, and what each half depends on

The board rides the snapshot; the attendee's own position is per device. **Both views key the board's
visibility on `standings !== null`, never on a phase list** — the schema decides where a board may
appear, and a list in a view is a copy that can fall behind it. The stale-reply guard in
`renderBoard` is on `live.standings === null` for the same reason.

`result.ts`'s `ended` branch now returns a rank (the gap `leaderboard-contract.md` handed this slice)
through the same `rankOf` the published rows were numbered by. **A failed rank read degrades to
`rank: null` rather than 503** — deliberately unlike the standings branch, because the segment is over,
there is no beat to retry into, and refusing would take the attendee's total away over a missing line.

The closing snapshot carries **no `currentQuestionId`**, and `/api/quiz/result` 400s on an empty one,
so the phone sends the last question's id. The route ignores the field in both board branches; the
field stays required there because rejecting a formless request is the cheaper contract.

## Scope boundary

Not here: a staged 3 → 2 → 1 reveal, any animation, a podium shape distinct from the top five, a new
store key or phase or snapshot field, an F-04 harness re-run, and the removal of `bun run quiz:reset`
(still the recovery path when the host view is unreachable).

## Pointers

`leaderboard-contract.md` (the board this slice carries, and the gaps it handed over) ·
`retention-contract.md` · `word-cloud-contract.md` · `resume-contract.md` · `plan.md` · `plan-brief.md`
