# src/lib/session/ — the live session, its store, and its scoring

Server-only. The session lives in Upstash Redis under the `livequiz:` namespace; scoring, standings
and the published `SessionState` are all decided here. No client module may *value*-import from this
directory (see `src/lib/client/CLAUDE.md`).

## Two retention rules that break the build

The PRD carries a retention guardrail: nothing about who played survives the session. Two mechanisms
enforce it, and both are easy to defeat by accident.

**Every `livequiz:`-prefixed name is declared in `keys.ts`.** Nowhere else. `end` re-arms the
registered set to a short lifetime and `purge` deletes it, so a key created outside the registry is
reached by neither and sits holding attendee data with nothing to say so. `keys.test.ts` fails the
suite on a namespaced string literal anywhere but that module. It catches literals, not
runtime-assembled names — `scripts/check-purge-residue.ts` covers the rest, against the real store.

**Never pass a display name or an answer to `logSessionEvent`.** `LogFields` is a closed type, so
`{ displayName }` is a compile error — and that closure *is* the enforcement, not a comment
alongside one. Do not restore the index signature or add a catch-all field; add the specific field
you need. Logs are retained ~1 hour and are covered by no TTL, no purge and no rollback, so anything
written there outlives the session document by design.

Before adding any key or any field to a published snapshot, read
`context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`. It also records the
one constraint that is not enforceable in code: Ably retains published snapshots for ~2 minutes and
that floor cannot be configured away.

## The keys

**`livequiz:tallies` has three field families** — `answered:<questionId>`,
`opt:<questionId>:<optionId>` and `word:<questionId>:<foldedWord>` — all spelled by `tallies.ts` and
nowhere else. The word family's **field names are attendee-authored text**, folded only for case, so
this key is not "counters only". It is still keyed by no player id and no display name, so nothing
in it says *who* wrote or chose anything, and it is still re-armed by `end` and deleted by `purge`.
The word family is the only one whose field count grows with the **room** rather than with the quiz,
up to one field per attendee.

**`livequiz:players`** (folded display name → player record) and **`livequiz:player-ids`** (opaque id
→ folded name, the reverse index a reloading device is recognised by) are the attendee-data keys.
Both are registered, so `end` and `purge` reach them.

**`livequiz:devices` is a count per device, and it is the one key that is not attendee data.** It
backs the per-device player cap (FR-018): opaque device id → how many players that device has
claimed. The id is minted by the browser about itself and stored beside no name, no player id and no
answer. It is registered anyway, for two reasons worth keeping apart — the registry has no exemption
list, and a device id left behind after a session would still be a stable handle on a returning
phone.

Read and written **only inside `CLAIM_PLAYER`**, where the count going up is part of the same atomic
claim. Two orderings there are load-bearing and silent when wrong: the cap check sits *before* the
collision check, so a device that is both capped and typing a taken name hears the final reason; the
increment sits *after* it, so a claim refused as taken charges nobody. The counter only ever goes up
— a releasable slot could be cycled indefinitely, which is the guard defeated by a mechanism built
to be forgiving.

## Names on the wire

**A join publishes nothing.** 150 joins fanning out to 150 subscribers is the O(N²) shape the spine
contract forbids, so the count reaches the room on the host's next action instead. `SessionState`
carries `playerCount` — a count, not attendee data — and a device knows only its own name.

`SessionState.standings` then publishes up to `STANDINGS_SIZE` (5) display names, and the binding
exposure is the deliberately unauthenticated `GET /api/quiz/state` rather than the Ably floor. The
same five names also ride the *terminal* document, so they are readable for `ENDED_TTL_SECONDS` —
**bounded by a TTL rather than by the host's attention**, which is longer and out of anyone's hands
once the close lands. Accepted: the same names reached the same devices minutes earlier, and both
fixes break something built on purpose (shortening the TTL removes the reload window F-03 chose;
stripping the field from the state route recreates a failure already rejected).

Read, in order, before changing any of this:
`context/archive/2026-08-07-join-and-follow-host/join-contract.md`,
`context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`,
`context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md`.

## SessionState: one decoration field, four transition fields

`playerCount` is decoration: `applyHostAction` overwrites it on every action and a stale value costs
nothing. `revealedOptionIds`, `revealedDistribution`, `revealedAnswerText` and `standings` are *part
of* a transition — set by the constructor that owns the transition (`reveal.ts` for the first three;
the standings route and `endedSessionState` for the fourth), nulled by every other, and guarded by
its own `superRefine` clause so the failure names the field.

**Never inject one of the four in `applyHostAction`**, which is where a reader who pattern-matched
on "aggregate fact about the room" would naturally put them: that publishes one question's answer
key, bar chart, accepted answer or leaderboard while the *next* question is open, and it looks
entirely correct on screen. Each carries `.default(null)` so a document written before it shipped
still parses — required, or the host's next action 409s mid-segment.

**`standings` is the one with two owners, and its two phases are asymmetric** (FR-006).
`BOARD_PHASES` in `state.ts` permits a board in `standings` and in `ended`; only `standings`
*requires* one. That is not an oversight to tidy: the board **is** the standings phase, so a null one
is a blank projector and the route refuses the transition — while `end` is what moves every key onto
`ENDED_TTL_SECONDS`, so it may never be refused over a board read that failed, and a boardless close
falls back to the plain closing screen. Widening the requires-clause to both phases makes a
transient store blip un-closeable. Both views therefore key the board's *visibility* on
`standings !== null` rather than on a phase list — the schema owns that rule, and a list in a view is
a copy that falls behind.

The three reveal fields carry quiz content about a question the host has already closed, so none of
them touches the retention reasoning above. What an attendee *typed* is per-player and travels on
`/api/quiz/result`, never on the snapshot.

**The word cloud is the one aggregate that does NOT ride the snapshot, and it must stay that way.**
It added no field, no phase and no change to `state.ts` at all. Every other aggregate reaches the
room attached to a *host action* — but a cloud that fills as the room types has none, and Ably's
allowance bills one broadcast to 150 clients as 150 messages against a 100/second ceiling, so
publishing per submission is the O(N²) fan-out the spine contract forbids. Instead the projector
polls `GET /api/quiz/host/words` on its own device. Moving the cloud onto the snapshot "for
consistency" is the single most plausible way to break the room, and it would look correct in every
test. See `context/archive/2026-08-12-word-cloud-question/word-cloud-contract.md`.

## Numeric answers carry partial credit, and one flag lies about it

A guess is worth `points × closeness × speedWeight`, where closeness is banded on **relative error**
— `|guess − correctValue| / |correctValue|`, so the rule behaves identically on an answer of 67 and
one of 10,000, which is the whole of FR-013's resolution and the reason there is no per-question
tolerance knob:

| Relative error | Closeness |
| --- | --- |
| exactly 0 | 1.00 |
| ≤ 0.05 | 0.80 |
| ≤ 0.10 | 0.60 |
| ≤ 0.25 | 0.30 |
| > 0.25 | 0 |

These five rows exist **once**, as `CLOSENESS_BANDS` in `scoring.ts`; this table quotes it.
Comparisons carry a small epsilon so a guess engineered onto a band edge does not fall through by
floating-point luck — three of the twelve exact-edge cases across the two live questions do overshoot
in binary, and `scoring.test.ts` asserts every one of them.

**`AnswerRecord.correct` is exact-hit-only for a number question, so it is `false` on an answer that
scored 800 of 1000.** No consumer may read that flag as "scored nothing" — the leaderboard is the
likeliest place to get this wrong. The attendee reveal branches on question **kind before** it
branches on `correct`, because a kind-blind branch renders "Tym razem nie." beside a positive award.

The true value reaches the room formatted **server-side** into `revealedAnswerText`, via
`Intl.NumberFormat("pl-PL")` — so 150 phones and the projector cannot disagree about the string.
**Its group separator is U+00A0**: a test that types `"10 000"` by hand fails with a diff in which
both sides look identical, so build the expectation from the formatter.

There is exactly **one parser** for a typed guess, `parseGuess` in `guess.ts`, and it is
server-side. The attendee view gates its submit button on "contains a digit" rather than parsing — a
client-side parser would either duplicate this one or cross the boundary `boundary.test.ts`
enforces, and two parsers that disagree is a scoring dispute on stage. A comma is the **decimal**
separator (`67,5` is 67.5, never 675) and spaces are grouping **in grouping positions only** — the
shape is validated before the separators are stripped, so `6 7` is refused rather than read as 67.
The consequence of the comma rule, accepted deliberately, is that `10,000` reads as ten. An absent,
empty or unparseable field is refused, never coerced.

The word bound (`MAX_WORD_LENGTH`, 24) lives in `words.ts` and is **24 rather than the text field's
80 because a word goes on a projector** — the same number and the same reasoning as
`MAX_DISPLAY_NAME_LENGTH`. It has three readers that must not drift: the route's visible refusal,
`answerRecordSchema`'s `.max()`, and the input's `maxlength` (which reaches the markup through
frontmatter, never through a `<script>` block).

## The deadline is derived, not stored

`deadline = updatedAt + timeLimitSeconds` (`deadline.ts`), stored nowhere — no `SessionState` field,
no key, no new snapshot traffic. During `question-open` the session document's `updatedAt` *is* the
moment the question opened, and it is also the upper bound `clampElapsed` measures every award
against.

**So nothing on a polled path may write.** A host-side write during `question-open` both inflates
every award after it *and* silently grants the room extra time nobody authored, with nothing on any
screen to say either changed. That is why there is no host override on the clock, and why "just
stamp a `deadlineAt` when the question opens" is a worse trade than it looks: it buys nothing the
subtraction does not, and costs a fourth kind of state field with its own guard clause and
back-compat default. Both host route tests assert the write ban against their own source. See
`context/changes/per-question-timer/timer-contract.md`.
