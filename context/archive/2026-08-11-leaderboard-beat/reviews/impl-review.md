<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Leaderboard beat (S-07)

- **Plan**: `context/changes/leaderboard-beat/plan.md`
- **Scope**: Phases 1–4 of 5 (Phase 5 not implemented)
- **Date**: 2026-08-11
- **Verdict**: REJECTED at review; all 10 findings triaged 2026-08-11 — 9 fixed, 1 accepted as risk (F7)
- **Findings**: 1 critical, 4 warnings, 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | WARNING |

Automated criteria for Phases 1–4 all pass: `bun run test` 965/965 across 30 files, `bun run type-check` 0 errors, `keys.test.ts` + `boundary.test.ts` 51/51. Nine manual rows (3.4–3.7, 4.6–4.10) remain unchecked and un-rubber-stamped.

## Findings

### F1 — Display names are readable by anyone through the open state endpoint, for the whole beat — and the PRD still says the opposite

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/state.ts:234`, `src/pages/api/quiz/state.ts:25`
- **Detail**: Every comment justifying names-on-the-wire cites "the ~2 minutes Ably retains a snapshot". That is not the binding exposure. `GET /api/quiz/state` is deliberately unauthenticated and returns the whole session document; its own docstring justifies that with "this returns exactly what is already broadcast, so guarding it would protect nothing" — true when the document held only a count. During a standings beat any unauthenticated caller can read the top five display names with their scores, and can keep polling for as long as the host leaves the board up. The document retains `standings` until the next host action, so the window is the length of the beat, not 120 s.

  Compounding it, three shipped source comments (`standings.ts:18`, `state.ts:214`, and the plan) cite `leaderboard-contract.md` as the record of this decision, and that file does not exist. `context/foundation/prd.md:142` still asserts, as a correction, "**S-02 took the remedy.** No display name is ever published", and `state.ts`'s `playerCount` comment still says "Names live in the players hash; a device knows only its own." Both are now false. CLAUDE.md makes reading and updating the retention contract a precondition for adding a field to a published snapshot, so this is the guardrail's enforcement mechanism rather than paperwork.

  The likely resolution is that the exposure is *acceptable* — the board is on a projector in the room, and the PRD already accepts an open token endpoint and an unprotected host view — but it must be an explicit, recorded decision, not one arrived at by accident and contradicted by the requirements document.
- **Fix A ⭐ Recommended**: Deliver Phase 5 before merge, and state the true exposure surface in it — the open `/api/quiz/state` for the duration of the phase, not the Ably floor. Amend PRD Deviation 2, write `leaderboard-contract.md`, and correct the two now-false comments in `state.ts`.
  - Strength: Makes the decision explicit and the record accurate; the artifacts already exist as a planned phase, and three shipped comments already point at one of them.
  - Tradeoff: Accepts the exposure. Anyone with the URL can read five names and scores during a beat.
  - Confidence: HIGH — the exposure is verified by reading both files; the accept-and-record posture matches how this project handled the token endpoint and the host view.
  - Blind spot: Whether the organizers consider "outside the room, during the beat" materially different from "on the projector". That is their call, not mine.
- **Fix B**: Strip `standings` from `/api/quiz/state`'s response and let only the Ably channel carry it.
  - Strength: Restores the ~120 s bound the code already claims, with no change to the recorded decision.
  - Tradeoff: Breaks the degraded-polling path for this phase — a device on the connection-limit fallback loop would see the phase and no board, which is the blank screen the whole read-failure design avoids.
  - Confidence: MEDIUM — the polling loop is the documented reason the board rides the document at all.
  - Blind spot: How many devices are on the fallback path at a real event; F-04 measured ~20 refused above the Ably ceiling.
- **Decision**: FIXED via Fix A — accepted the exposure. Two now-false comments in `state.ts` corrected in place (the `playerCount` note and the `standings` docstring, which now names the open `/api/quiz/state` for the duration of the phase as the real surface, not the Ably floor). Phase 5's PRD-amendment contract in the plan carries a dated correction instructing it to record that surface.

### F2 — An in-flight rank fetch renders as a failure on any re-render

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:580-605`
- **Detail**: `rank = null` is set *before* the fetch is issued, and `rank === null` is also the documented failure state. Any re-entry into `render()` at the same snapshot version takes the `else` path and calls `renderOwnPosition(null)`, which prints "Nie udało się pobrać Twojej pozycji." Re-entry at the same version is routine: `onConnection` calls `render()` on every connection transition, and the join flow calls it three times. Failure scenario: the board arrives, the phone shows "Sprawdzamy Twoją pozycję…", the venue Wi-Fi flaps 400 ms later → the line flips to a failure that has not happened, then flips back to a real position seconds later. On the one beat the slice exists for.
- **Fix**: Carry a third state — a `rankPending` flag set alongside `rankVersion` and cleared in the `.then` — and have `renderOwnPosition` leave the pending copy alone while a request for this version is open.
  - Strength: Small, local, and testable through `standingsPositionText`'s existing seam.
  - Tradeoff: A third piece of module state on a page that already has several.
  - Confidence: HIGH — control flow read directly; the collapse is unambiguous.
  - Blind spot: None significant.
- **Decision**: FIXED — added `rankPending`, a third state, so an in-flight request no longer renders as a failure. `standingsPositionText` gained a `pending` argument checked before the absent-rank branch, with three new tests; verified by removing the branch and watching the named test fail.

### F3 — The host screen and the phones show different room sizes

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/quiz/index.astro:606`, `src/lib/session/standings.ts:142`
- **Detail**: The plan said the attendee line's denominator comes from the snapshot's `playerCount`. The implementation uses `board.playerCount` instead, on the stated reasoning that it was counted in the same read as the rows. That reasoning is incomplete: the host screen renders `state.playerCount`, which `applyHostAction` overwrites with a fresh `HLEN` *after* the board is built. So one join landing between the two reads — or any single unparseable player record — leaves the projector reading "150" and every phone reading "z 149", permanently for that beat. This is the divergence the PRD guardrail names, and `standings.ts`'s own comment predicts it: two numbers about the size of the room that disagree "would be read as a bug in the one that was smaller".
- **Fix**: Use the snapshot's `playerCount` for the attendee denominator, as the plan specified, so both surfaces render the same field.
  - Strength: One source for the number; restores plan adherence; deletes a field's second consumer rather than adding a reconciliation rule.
  - Tradeoff: The denominator is then a beat fresher than the rows it describes, so a very late joiner can make "N of M" have an M the ranking did not consider. That is invisible; two different totals on two screens is not.
  - Confidence: HIGH — both render paths read directly.
  - Blind spot: None significant.
- **Decision**: FIXED — the attendee denominator is now the snapshot's `playerCount` (read from live state in the async path), as the plan originally specified, so projector and phones render the same field. The comment recording the wrong reasoning is replaced with the correct one.

### F4 — The rank costs five billed commands per device, not one; two of them are pure waste

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/quiz/result.ts:83,137`
- **Detail**: The plan's Performance section claims "one per device that fetches its rank (~150)" and "roughly 600 commands" a segment. `result.ts` calls `readOwnResult` unconditionally before any phase branching; that is the `READ_ANSWER` EVAL, which `store.ts:391` documents as four billed commands (the EVAL plus `GET`, `HGET`, `HGET`). The standings branch then adds `readOwnRank`'s `HGETALL`. Five per device, ~750 per beat, ~3,000 for a four-beat segment — 5× the recorded figure, and the tripwire budget in the runbook was reasoned against the wrong number. Two of the four are waste on this path: the branch uses only `result.state` and discards `result.answer`, while `result.total` is superseded by `readOwnRank`'s own total, so the scores hash is read twice in two round trips. Still far inside the 500k monthly tier, so this is an accuracy defect, not a capacity problem — but a future slice reading "600 per segment" carries the error forward.
- **Fix A ⭐ Recommended**: Correct the plan's Performance section and `leaderboard-contract.md` to the real figure, and leave the code as it is.
  - Strength: The absolute cost is genuinely negligible; the defect is the recorded number, and the record is what the next slice reads.
  - Tradeoff: Leaves two wasted commands per device per beat on the table.
  - Confidence: HIGH — arithmetic confirmed against `store.ts`'s own cost docstring.
  - Blind spot: The store's command counter still has an unexplained baseline two orders of magnitude above what the code accounts for, so "negligible against the budget" rests on an unmeasured assumption.
- **Fix B**: Have the client declare the beat (`mode=standings`) so the route can skip `readOwnResult` and issue only the rank read; the server still verifies the phase, so a lying client gains nothing.
  - Strength: Cuts the path to one command, removes the double read of the scores hash.
  - Tradeoff: Adds a client-supplied branch selector to a route whose current contract is "the server decides everything from the document it read".
  - Confidence: MEDIUM — safe because the phase check is unchanged, but it is new surface on the densest attendee path.
  - Blind spot: Not measured at room scale, and this slice deliberately skipped the rehearsal re-run.
- **Decision**: FIXED via Fix A — code unchanged; the plan's Performance section now states five commands per device (~750 a beat, ~3,000 a segment) with a dated correction explaining the 5× error, why accept-and-record was chosen over the client-declared-mode optimisation, and that "negligible" still rests on the unexplained command baseline.

### F5 — A failed broadcast leaves the beat unrecoverable while telling the host to retry

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/pages/api/quiz/host/standings.ts:105-116`
- **Detail**: When the write commits but the publish fails, `applyHostAction` returns 502 with "Powtórz akcję, aby rozgłosić go ponownie". The retry's transition sees `current.phase === "standings"` and returns `null`; this route reads that no-op as the benign "already showing it" case and returns 200. Nothing is republished. The store is in the standings phase, the room is still looking at the previous reveal, `reveal` now 409s, and the only way out is `advance`, which abandons the beat. The same shape exists for `reveal`, but there the answer key had already reached the room on the prior publish; here the phase's entire content is the board that never went out.
- **Fix**: On a same-phase no-op, republish the current snapshot instead of reporting a silent 200.
  - Strength: Makes the host's "retry the same action" advice true for this verb, which is what the 502 message already promises.
  - Tradeoff: A re-tap in the normal case now spends a publish; devices drop a snapshot they already hold, so it is harmless.
  - Confidence: MEDIUM — the failure path is clear, but the republish would sit in this route rather than in `applyHostAction` where the 502 is generated, so the two could drift.
  - Blind spot: Whether the same fix belongs in `reveal` for consistency; that is pre-existing behaviour this review did not scope.
- **Decision**: FIXED — the route now re-broadcasts on a same-phase no-op, making the 502's "retry the same action" advice true for this verb, and reports a failed re-broadcast as a 502 rather than a silent 200. Three tests added (republish, failed republish, no republish from the wrong phase); verified by disabling the branch and watching two fail. `reveal` deliberately left alone — there a lost broadcast costs a bar chart, not the whole phase.

### F6 — The stale-reply guard does not do what its comment claims

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/index.astro:588`
- **Detail**: `if (rankVersion !== state.version) return;` compares the module-level value against the version captured in the closure. `renderStandingsBeat` is its only writer, so the guard fires only when a *newer standings beat* arrives — never when the room moved on to a question, which is the case the comment names ("a reply landing after the next question opened would paint a position under a prompt"). It does paint it; the write lands in `#standings-you`, which happens to be hidden by an unrelated `setHidden` two functions away. The stated safety property is real but is provided by something else. Second hole, of exactly the class the purge-reset comment was written about: versions restart at 1 after a purge, so a reply captured at version 7 can pass the guard during a new session's version-7 beat.
- **Fix**: Re-read live state in the `.then` — `client.current()?.phase === "standings" && client.current()?.version === beat` — and correct the comment.
- **Decision**: FIXED — the guard now reads live state (`client.current()` phase and version against the captured beat) instead of comparing a module value against its own copy, which could only ever fire on a newer beat. Closes the purge/version-reuse hole as a side effect, and the overclaiming comment is corrected.

### F7 — The two rank paths rank against different populations when a record is corrupt

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/store.ts:1152-1160,1200-1206`
- **Detail**: `readStandings` builds its totals from records that parsed, dropping any that did not; `readOwnRank` builds them from the raw scores hash. One corrupt player record holding 900 points therefore omits 900 from the projector's population and includes it in every phone's, numbering everyone below them one better on the board than on their own device. The zero-score asymmetry is benign (a zero is never strictly greater than anything), so this single input is the one thing that makes the deliberately-shared `rankOf` diverge anyway — which is the failure sharing it was meant to make impossible.
- **Fix**: Derive both populations the same way, or refuse to silently drop a record that carries points.
- **Decision**: ACCEPTED AS RISK — corrected during triage. The first fix targeted the wrong mechanism (corrupt *scores*, which cannot shift a rank either way); the real divergence comes from a dropped *player record*, and closing it would mean reading the players hash per device, doubling the cost F4 just declined to add. Reachable only through store corruption. The gap and its reasoning are now recorded in `readOwnRank`'s docstring.

### F8 — `Number(raw) || 0` reads a corrupt total as zero rather than refusing

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/session/store.ts:1164,1204`
- **Detail**: The bare-coercion shape `lessons.md`'s second entry warns about. Reading an *absent* entry as 0 is intended and correct here, but the same expression reads a non-finite or garbage value as 0 — a wrong number on a leaderboard, when `readStandings`' own contract reserves `null` for "could not say". `readOwnResult` has the same line and defends it on the grounds that `HINCRBY` only writes integers, so corruption is the only way to reach it; that argument holds, which is why this is an observation and not a warning.
- **Fix**: Parse explicitly and treat a non-finite value as a dropped entry rather than a zero.
- **Decision**: FIXED (clarity only) — `storedTotal` parses explicitly instead of `Number(x) || 0`, per lessons.md's bare-coercion rule. Stated honestly in the code and the tests: it changes no output, because a dropped value and a value coerced to zero are both read as zero downstream. The two tests pin the observable contract and are labelled as holding under either implementation — they were rewritten after a regression run showed the originals could not fail.

### F9 — The standings log event records the room size, not the row count the plan asked for

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/pages/api/quiz/host/standings.ts:107`
- **Detail**: The plan said "`logSessionEvent` with the row count only". The route logs `{ playerCount }` — equally safe for retention, and it reuses an existing `LogFields` field rather than adding one, but a beat that published a two-row board is now indistinguishable in the log from one that published five. Two new events (`session.standings.shown`, `session.standings.failed`) were also added, which the plan did not ask for; `LogFields` was correctly left unwidened, so the closed-type rule holds.
- **Fix**: Either add a `rowCount` field to `LogFields` and log it, or record in the contract that the room size was logged instead and why.
- **Decision**: FIXED — `LogFields` gained a `rowCount` field (the sanctioned way to extend a closed type; no widening, no catch-all) and the event now logs both counts. A board shorter than `STANDINGS_SIZE` is now visible in the log.

### F10 — `renderStandings` shipped in Phase 3, but the plan assigns it to Phase 4

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: `src/lib/client/render.ts`, commits `1973edf` / `1764909`
- **Detail**: The renderer, its option types and the `StandingsRow` re-export all landed in Phase 3, because Phase 3's projector board calls it — the plan's sequencing made this unavoidable, so the plan's assignment is what is wrong rather than the code. Consequence for anyone reading plan against history: Phase 3's criteria silently covered a Phase 4 deliverable, and Phase 4's `render.test.ts` criterion retro-validates code from the previous commit. Disclosed at the time in the Phase 3 hand-off. A minor EXTRA rides along: `export type { StandingsRow }` is a second name for a type importers could take from `standings.ts` directly.
- **Fix**: Note the reassignment in the plan's Phase 4 section so plan-vs-history reads cleanly.
- **Decision**: FIXED — the plan's Phase 4 section carries a dated note that `renderStandings` shipped in Phase 3 and why, so plan-vs-history reads cleanly.
