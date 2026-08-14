<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Word-cloud question (S-08)

- **Plan**: `context/changes/word-cloud-question/plan.md`
- **Scope**: All 6 phases (full plan review)
- **Date**: 2026-08-14
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 5 warnings, 5 observations

Commits reviewed: `ab05c1d` (p1) · `bbfbf53` (p2) · `2b362c7` (p3) · `f0399ad` (p4) · `c107230` (p5) ·
`7eda8a2` (p6) · `b9696ae` (epilogue). `db44eba` sits inside the range but is an unrelated zod-4
rename in `src/quiz/schema.ts`, excluded from scope.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

**Automated criteria re-run at review time:** `bun run test` 1130 passed / 33 files · `bun run
type-check` 0 errors · `bun run build` complete. Every phase's targeted test invocations pass.

**Post-triage state (all ten findings decided):** 8 fixed, 2 accepted as recorded risks. Suite
**1141 passed / 33 files**, type-check 0 errors, build complete. Every fix that could carry a guard got
one, and each guard was verified by breaking the fix and watching the named test fail. Two guards had to
be rewritten because their first versions did not discriminate — recorded in F2's and F6's decisions,
because "the assertion was right and the fixture pointed it at the wrong branch" is the failure this
repository already has two `lessons.md` entries about, and it recurred twice inside this triage.

**What held up well, recorded so it is not re-litigated:** all seven behavioural contracts verified
against code rather than comments (total ordering, pre-slice `distinct`, the counter's position below
`HSETNX` with the Lua unchanged, 400-not-409, diacritic-preserving fold, both re-arm sites gated on
`pollWanted`, the target covering both phases). All six "not doing" prohibitions held — `state.ts`,
`scoring.ts`, `reveal.ts` and `check-purge-residue.ts` are byte-identical across the range. Pattern
compliance found **no** drift against siblings in any changed file. The four judgement calls (the third
fold, the two-field record, the source-scan test, the shared tallies key) were each assessed
independently sound.

## Findings

### F1 — The polled fetch has no timeout, so a stall freezes the cloud with no staleness marker

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:867
- **Detail**: `src/lib/client/answer.ts` puts `AbortSignal.timeout(REQUEST_TIMEOUT_MS)` on both of its
  calls, with a docstring giving the reason: "a request that never returns is worse than one that
  fails, because nothing downstream can tell the difference between the two." The poll has none. A
  stalled request leaves `polling = true`, so `schedulePoll` returns early at `:829` and no further
  tick fires; and because `pollFailed` never ran, `cloudStale` stays `false`. The projector therefore
  shows a **frozen cloud that looks live** — exactly the failure the `(nieaktualne)` marker exists to
  prevent, and the same class as the `pageshow` bug this file already documents. Pre-existing from
  S-04, but S-08 widened the blast radius from one number to the whole panel and to the final-read
  gate. A venue network is the environment this runs in.
- **Fix**: Add `signal: AbortSignal.timeout(...)` to the poll's `fetch`, matching `client/answer.ts`;
  the existing `catch` already routes to `pollFailed(target.kind)`, which sets the marker and backs off.
  - Strength: Two-line change reusing a constant and a pattern already in the codebase; the failure
    path it needs is already written and tested.
  - Tradeoff: Introduces a bound that must exceed a slow-but-working venue response, or a healthy poll
    starts reporting stale. `client/answer.ts` chose 10 s for the same network.
  - Confidence: HIGH — the sibling module states the rule and the recovery path already exists.
  - Blind spot: Not verified whether an aborted `fetch` on the host's browser could interact with the
    401 fast-retry counter.
- **Decision**: FIXED — AbortSignal.timeout(POLL_TIMEOUT_MS) added; new host.test.ts assertion, verified by breaking it

### F2 — The "final read" can be a pre-reveal read, permanently dropping late words

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:955-957
- **Detail**: `cloudFinalReadFor` is recorded from the phase at the moment the response **arrives**,
  not the phase the request was **issued** in. If the host reveals while a tick is in flight, a body
  computed during `question-open` is accepted as the final cloud, `pollWanted` (`:587-589`) closes the
  loop, and any word submitted between that request leaving and the reveal is **permanently absent**
  from the cloud the host then talks over — with nothing on screen to say so. The reveal-mid-fetch case
  is not exotic: `runPoll`'s own `finally` docstring calls the host revealing mid-fetch "the ordinary
  way that happens". This is the timing class `lessons.md` has an entry about, and the structural scan
  in `host.test.ts` cannot see it.
- **Fix**: Capture the phase in `runPoll` at issue time and set `cloudFinalReadFor` only if the request
  itself was issued in `question-revealed`; otherwise leave the flag clear so one more tick runs.
  - Strength: Makes the flag mean what its own docstring claims; a single captured local, and the
    worst case becomes one extra billed pair of commands rather than a missing word.
  - Tradeoff: The loop may run one additional tick after a reveal.
  - Confidence: HIGH — the same capture-at-issue pattern is already used in `index.astro`'s rank fetch
    (`const beat = state.version`) for this exact class of race.
  - Blind spot: Not verified against a real reveal-mid-flight run; only by reading.
- **Decision**: FIXED — phase captured at issue time (issuedInPhase); host.test.ts assertion rewritten to pin the fix rather than the defect

### F3 — The HGETALL payload is attacker-controlled, not room-bounded, and only the honest-room risk was recorded

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/session/store.ts:1145
- **Detail**: `readWordCloud` reads the **entire** `livequiz:tallies` hash, and the word family is the
  first field family whose cardinality grows with the room rather than with the quiz definition.
  `/api/quiz/join` is deliberately open and unthrottled (an accepted risk in `infrastructure.md`), and
  word fields never shrink within a session — TTL only. So a scripted join-and-submit run inflates what
  the projector downloads **every 2.5 s for the rest of the segment**, on the one network nobody
  controls. Pre-S-08 this HGETALL would have been bounded by the definition. The contract records the
  unmeasured payload "at ~150 distinct words" as an accepted risk, which is the *honest-room* figure —
  a different risk from deliberate amplification, and the contract does not distinguish them. Secondary
  and cost-only: the reply also carries every other question's `answered:`/`opt:`/`word:` fields, so it
  grows monotonically across the segment.
- **Fix A ⭐ Recommended**: Record the amplification explicitly as its own named accepted risk — in
  `word-cloud-contract.md` beside the honest-room figure and as an `infrastructure.md` row with a
  tripwire — without adding a guard.
  - Strength: Consistent with how this project has handled every other consequence of the open join
    (the token endpoint, the unprotected host view) — named, owned, and tripwired rather than
    defended. Costs nothing at runtime and does not reopen the PRD's trust model.
  - Tradeoff: The exposure remains real; a determined attendee can degrade the projector's refresh for
    the rest of a segment, and the only mitigation is the host noticing.
  - Confidence: MEDIUM — the precedent is strong, but no measurement exists of how bad the payload
    actually gets, so "acceptable" is being asserted rather than shown.
  - Blind spot: Nobody has measured the HGETALL payload or its parse time at, say, 2,000 distinct
    fields; the decision to accept is being taken without that number.
- **Fix B**: Bound distinct word fields at write time — an `HLEN`-style refusal inside `SUBMIT_ANSWER`
  once the hash exceeds a ceiling.
  - Strength: Closes the amplification structurally rather than by observation, inside the script that
    already owns atomicity.
  - Tradeoff: Adds a billed command to the densest path in the project (150 × 14 submissions), and a
    ceiling that fires in an honest full room would silently stop counting real attendees' words —
    turning a performance risk into a correctness one.
  - Confidence: MEDIUM — the mechanism is straightforward; choosing a ceiling that cannot misfire in a
    150-person room is the unresolved part.
  - Blind spot: No data on distinct-word counts in a real room, which is exactly the number a ceiling
    would need.
- **Decision**: ACCEPTED AS RISK (Fix A) — amplification recorded as its own section in word-cloud-contract.md and as an infrastructure.md row with a tripwire; no code guard

### F4 — The cloud panel never renders `answered`, so the host cannot see how much of the room has written

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/quiz/host.astro:946 (stored), :660-682 (not rendered)
- **Detail**: The route returns `answered` (`api/quiz/host/words.ts:143`) and the page assigns it
  (`host.astro:946`), but the only render site is `host.astro:628`, gated on
  `pollTargetFor(state)?.kind === "participation"` — false for a word cloud. `renderWordCloudPanel`
  renders only `wordCloudCountText(shown, cloudDistinct)`, and the markup has no answered/joined line.
  The plan's **Desired End State** says: "the projector shows the prompt and, below it, `odpowiedzi N /
  M` **and** a cloud of words". The line that exists counts *distinct words*, not people — thirty
  attendees can write five words — so the host has lost the figure they use on stage to judge when to
  reveal. `words.ts:118-124` compounds it by documenting `readPlayerCount()` as "the denominator for
  the panel's `answered / joined`", a panel element that does not exist; on that route the call's only
  surviving effect is refreshing the page header's join count. This is `lessons.md`'s first rule
  inverted: that entry is about an affordance promised with no data path, and here the data path was
  built and the affordance never was.
- **Fix A ⭐ Recommended**: Render an `odpowiedzi N / M` line in the word-cloud panel from the
  `answered` and `playerCount` the route already returns.
  - Strength: Delivers what the plan specified, uses data already fetched and already stored, and costs
    no extra commands — it makes the existing `HLEN` earn its price rather than removing it.
  - Tradeoff: One more figure on a projector the plan wanted uncluttered; needs the same
    keep-last-value-on-failure treatment the participation count has.
  - Confidence: HIGH — both values are already in hand at the render site.
  - Blind spot: Not confirmed with you whether the word count line was intended to *replace* that
    figure rather than sit beside it.
- **Fix B**: Drop `answered` from the route's response and stop calling `readPlayerCount()` there,
  correcting the docstrings and the contract's "two numbers" section to match.
  - Strength: Removes a dead data path and one billed command per tick from a file that prices
    commands carefully; smallest honest change if the word count is the figure you actually want.
  - Tradeoff: Contradicts the plan's Desired End State, and the host keeps no per-person sense of
    participation during the one question built to prove the room is live.
  - Confidence: MEDIUM — depends entirely on intent, which the plan states one way and the code
    another.
  - Blind spot: The header's `player-count` freshness currently depends on this call; removing it
    would need that checked.
- **Decision**: FIXED (Fix A) — `Odpowiedzi N / M` rendered in the cloud panel; words.ts docstring corrected to name the line that now exists

### F5 — The plan's own records misdescribe what was delivered, in four places

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/word-cloud-question/plan.md (Progress rows 1.4, 2.3; Phase 4 note)
- **Detail**: Four mismatches between the plan-as-record and the code, each individually disclosed
  during implementation but never written back:
  1. **Row 1.4** reads "`normalize.test.ts` asserts `foldWord` and `normalizeAnswer` disagree" — the
     assertion is in `words.test.ts:76-79`; `normalize.test.ts` received only a pointer docstring.
  2. **`src/pages/quiz/host.test.ts` appears in no phase's contract.** It is the substitute for Phase
     4's prescribed timer tests ("pin the interval source… hold the fetch open with a manually
     resolved deferred"), which were not written because an Astro inline script has no harness.
     CLAUDE.md now advertises this file as the guard against a second timer, so the plan is the one
     document that does not know it exists.
  3. **Row 2.3** asks for a word-cloud-specific `already-answered` test; that outcome is covered only
     by the pre-existing generic outcome-mapping table driven with a *choice* question. Behaviour is
     guaranteed by the `HSETNX` position (covered in `store.test.ts`), so this is a naming gap, not a
     behaviour gap.
  4. **Phase 1's contract** asked for `normalize.ts`'s two-column table to gain a third row; the third
     fold is described there in prose instead, with the three-row table living in `words.ts` and
     CLAUDE.md.
  Left as-is, the next reader treats the Progress rows as ground truth — the failure mode
  `lessons.md`'s "check every path that emits a shared document" entry is about, applied to the plan
  itself.
- **Fix**: Append a short "Delivered differently" addendum to the plan recording all four, and reword
  rows 1.4 and 2.3 to name what actually exists.
- **Decision**: FIXED — 'Delivered differently' addendum added to plan.md; rows 1.4 and 2.3 reworded

### F6 — A 200 with no `words` array clears the staleness marker

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/quiz/host.astro:942-947
- **Detail**: The code correctly keeps the previous cloud when `payload.words` is not an array, and its
  comment says so — but `cloudStale = false` runs unconditionally two lines later. A route that changed
  shape would present old data as fresh, which is the same "looks live but isn't" class as F1.
- **Fix**: Move `cloudStale = false` inside the `Array.isArray(payload.words)` branch.
- **Decision**: FIXED — cloudStale=false moved inside the isArray branch. Note: the first version of its new guard failed on correct code (counted file-wide, but resetPanels clears it too); rescoped to the words handler and verified both ways

### F7 — Nothing enforces that the stored fold matches the stored text

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/lib/session/answers.ts:91
- **Detail**: `AnswerRecord` holds `text` (raw) and `word` (its fold), and only the length bound is
  checked — nothing asserts `word === foldWord(text)`. The single current writer is correct, but a
  future second writer could desynchronise them silently, and the fold is what the projector renders.
  `words.ts` is a leaf already imported by `answers.ts`, so the check is cheap.
- **Fix**: Add a `superRefine` to `answerRecordSchema` requiring `word === foldWord(text)` when `word`
  is non-null.
- **Decision**: FIXED — superRefine on answerRecordSchema requiring word === foldWord(text); 7 new tests, 4 fail when the clause is removed

### F8 — Attendee-authored content now rides the 10-minute post-`end` window alongside pure counters

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/session/keys.ts (TALLIES_KEY), src/lib/session/store.ts:54-67
- **Detail**: The change correctly retracts the "NOT attendee data" claim in place and the PRD records
  the reclassification. What neither revisits is the consequence: `livequiz:tallies` is re-armed to
  `ENDED_TTL_SECONDS` (10 minutes) by `end`, and that window was reasoned about when the key held only
  integers. It now holds attendee-authored words for those ten minutes. The PRD's Deviation 1 already
  accepts a ten-minute window for *standings*; whether it also covers this was not asked.
- **Fix**: Add a sentence to the contract's retention section (and Deviation 1) stating explicitly
  whether the ten-minute window is accepted for word content, or purge the word family at `end`.
- **Decision**: ACCEPTED AS RISK — the ten-minute post-`end` window is now explicitly accepted for word content in both the contract and PRD Deviation 2, with the rejected alternative recorded

### F9 — Two other slices' documentation debts were paid inside this diff

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: CLAUDE.md (SessionState transition fields), docs/runbook-live-session.md (cost projection)
- **Detail**: Two corrections outside this plan's contract: CLAUDE.md's "three transition fields" (S-07
  made it four, and its "S-07 still owns the open half" paragraph was also stale), and the runbook's
  projection that "every slice from here (S-05 through S-08) adds another per-attendee path" — three
  landed and none did. Both are true fixes to false statements, both were disclosed when made, and both
  sat in passages this change was editing anyway. Recorded because paying another slice's debt inside a
  feature diff makes `git blame` misleading about when the claim broke.
- **Fix**: No code change; note them in the plan's addendum alongside F5 so the provenance is findable.
- **Decision**: RECORDED — both out-of-scope corrections named in plan.md's addendum so git blame is not the only trace

### F10 — Three cosmetic gaps between what the attendee types and what the room sees

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/quiz/index.astro:1119, src/lib/session/words.ts:55,100, src/lib/session/tallies.ts:73-76
- **Detail**: Three small, independent mismatches, none a data-integrity risk:
  1. **The phone echoes the raw typed word, the projector shows the fold.** An attendee who typed
     `KAWA` reads "Twoje słowo: KAWA" while the chip says `kawa` — the very mismatch
     `index.astro:193-195` cites as its reason for `autocapitalize="off"`.
  2. **No NFC normalisation before the allowlist.** `ALLOWED_CHARACTERS` excludes `\p{M}`, so a
     decomposed `ą` (`a` + U+0328) — reachable by paste — is refused with "tylko litery, cyfry i
     znaki…" for a word that visibly is letters. Consistent with `players.ts`, and it cannot create
     duplicate chips since decomposed forms never reach the store; words are likelier pasted than
     nicknames, which is why it is worth naming.
  3. **`tallies.ts:73-76` justifies the prefix strip with "a submitted word may contain a colon"**,
     which the current allowlist refuses. Defence-in-depth is right, but the prose reads as though
     colons occur today.
- **Fix**: For (1) echo `foldWord`'s result, or say "na ekranie: …"; for (2) `.normalize("NFC")` in
  `foldWord` before validation; for (3) reword to "may in principle contain".
- **Decision**: FIXED — NFC normalisation in foldWord and validateWord (decomposed Polish was being refused); the phone's reveal copy now states the projector shows lower case rather than implying a match, because a client-side fold would cross the boundary

## Note on manual verification

Fourteen manual rows across phases 2–5 were confirmed in two batches at the end rather than per phase,
which was the plan's design. One consequence is worth recording: row **3.9** — "a minute of polling
leaves `updatedAt` and `version` untouched", the guard that a polled host route cannot inflate every
subsequent award — was confirmed against code that had changed twice since Phase 3, because Phase 4
rewrote the loop that does the polling. The check is sound and the property still holds (both route
tests assert the ban against their own source); the *evidence* is for a later revision than the row
names. F1 and F2 are both defects in that same rewritten loop, and neither was caught by the batched
manual pass.
