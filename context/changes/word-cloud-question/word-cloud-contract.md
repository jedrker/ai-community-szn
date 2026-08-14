# Word-cloud contract (S-08)

Fifth after `spine-contract.md` (F-02), `retention-contract.md` (F-03), `join-contract.md` (S-02) and
`leaderboard-contract.md` (S-07), and it inherits their warning: **a contract that grows past a page
has become a second copy of the plan, and a second copy can disagree with it.** A pointer, not a
summary.

Read before adding any continuously-updating display, any snapshot field, or a sixth question kind.

## The cloud does not ride the snapshot. Nothing about it touches Ably

S-08 added **no `SessionState` field, no phase, and no change to `state.ts`**. The projector polls
`GET /api/quiz/host/words` on its own device, ~2.5 s, host-secret gated.

Every other aggregate in this project rides the published snapshot because each is attached to a *host
action*. A cloud that fills as the room types has none — and `infrastructure.md` records that Ably's
free tier bills one broadcast to 150 clients as **150 messages against a 100/second ceiling**, so
publishing per submission is the O(N²) fan-out `spine-contract.md` forbids: the room would start
disconnecting at the exact moment it was all answering.

**FR-005's scope note is what permits the live display at all**: "an unscored word-cloud question has
no correct answer to leak, so its aggregate may display live." The reasoning that keeps
`revealedDistribution` off the wire until the reveal does not transfer.

Moving the cloud onto the snapshot "for consistency" is the most plausible way to break the room, and
it would pass every test in the suite.

## The third fold keeps diacritics, because its output is rendered

`foldWord` (`src/lib/session/words.ts`) folds case and whitespace and **nothing else**. The other two
folds are comparison artefacts nobody sees; this one's output *is* the chip on the projector, so
folding `ó` away would put a misspelt Polish word on the big screen.

Added **beside** the two in `src/quiz/normalize.ts`, never by widening either — `lessons.md` has an
entry about that exact mistake, made against `normalizePolish` during S-05. It lives outside
`src/quiz/` because it is a session-aggregation rule, not a rule about the definition.

**Accepted cost:** a word typed both with and without its diacritics counts as two entries. Cosmetic
here; the same slip in `normalizeAnswer` would cost somebody points.

**Its tripwire's fixture is `Gęś`, not `Żółw`, and that is the substance of the test.** `ł` is atomic
and survives a bare NFD pass, so a `żółw`-based divergence assertion still holds against a fold that
has lost every *other* diacritic — found by breaking the guard, not by reading it.

## `livequiz:tallies` is no longer counters-only

Third field family, `word:<questionId>:<foldedWord>`, in the existing hash — so no new key, and
`keys.ts`'s registry, `end`, `purge` and `check-purge-residue.ts` needed no change.

The registry entry used to open *"NOT attendee data — the first registered key that is not"*. Corrected
in place rather than deleted, the way `state.ts` corrects `playerCount`'s note: **the word family's
field names are attendee-authored text.** What still holds is the part that matters — no field is keyed
by a player id or a display name, so nothing says *who* wrote anything, and `end`/`purge` still reach
it. It is the only family whose field count grows with the **room** rather than with the quiz.

`wordFromField` is a **prefix strip, never `split(":")`**: the fold removes nothing but case, so a word
may in principle contain a colon, and splitting would silently merge two distinct words into one chip.
(The current allowlist refuses a colon, so this is defence-in-depth rather than a live case.)

**The ten-minute post-`end` window now covers attendee-authored words, and that is accepted** (impl
review F8). `end` re-arms every registered key to `ENDED_TTL_SECONDS`, and that window was reasoned
about in F-03 when this key held nothing but integers — the reclassification above changes what sits in
it for those ten minutes. It is accepted on the same terms as the PRD's Deviation 1, which already
accepts the window for the standings a device might reload into: the words are aggregate, keyed by no
player id and no name, so nothing in them says who wrote what, and the window is bounded,
self-expiring, and escapable by the explicit purge a host can run on the spot. The rejected alternative
was deleting the word family in `COMPARE_AND_END` rather than re-arming it — it adds a branch to the one
Lua path whose failure mode is "the session never ends", to shorten a window that carries no name.

## The counter rides the submission script, below the lock

One more entry in `SUBMIT_ANSWER`'s already-generic variadic tail, **below the `HSETNX`** — so a
duplicate tap cannot put a word on the projector twice. That inheritance is the whole reason the word
cloud is counted here rather than by a lighter write of its own. A word-cloud submission bills exactly
what a single-choice one does (`k = 1`), so S-08 moved the event's cost by nothing.

`AnswerRecord` carries **both** forms: `text` is what the attendee typed and what the reveal echoes;
`word` is the fold the counter was keyed by. Two fields for one word looks redundant and is not —
deriving either at read time means depending on a function that may have changed since.

## Two numbers, and the bound that keeps the truncation honest

`readWordCloud` returns at most `WORD_CLOUD_SIZE` (30) words plus `distinct`, the count **before** the
slice, so the panel says "30 z 47 słów" rather than presenting the top of the list as the whole room. A
silent cap is the one thing a truncation must not be.

Ordered `count desc, word asc` — a **total** order, and load-bearing in a way `buildStandings`' is not:
the slice means ordering decides *what is shown at all*, so a partial order would let two consecutive
polls drop different words and the cloud would flicker with nothing to explain it.

`answered` comes out of the same `HGETALL` — the tallies hash already holds `answered:<questionId>`, so
the numerator is free. Adding a `readAnsweredCount` beside it is the obvious change that would make the
cost note wrong.

**`null` only on a throw.** An absent hash is an empty cloud; a failed read must never surface as one,
because on a projector that is the claim "nobody in this room wrote a word".

## The payload is attacker-controlled, and that is a second risk, not the same one

The paragraph above accepts an unmeasured `HGETALL` payload **at ~150 distinct words** — the
honest-room figure. Deliberate inflation is a different risk and is recorded separately here, because
conflating them is how the smaller number ends up standing in for both (impl review F3).

`/api/quiz/join` is deliberately open and unthrottled (an accepted risk in `infrastructure.md`), and
word fields **never shrink within a session** — the TTL is the only thing that removes them. So the
field count is bounded by how many player ids exist rather than by how many people are in the room, and
a scripted join-and-submit run inflates what the projector downloads **every 2.5 seconds for the rest
of the segment**. Before S-08 this read was bounded by the quiz definition; the word family is the first
whose cardinality an attendee controls.

**Accepted rather than defended**, on the same reasoning the open token endpoint and the unprotected
host view already rest on: the room is trusted for one session. The rejected alternative was an
`HLEN`-style ceiling inside `SUBMIT_ANSWER` — it would add a billed command to the densest path in the
project (150 × 14 submissions) and, worse, a ceiling low enough to matter would silently stop counting
real attendees' words in a full room, turning a performance risk into a correctness one.

**What makes this an assumption rather than a measurement:** nobody has measured the payload or its
parse time at, say, 2,000 distinct fields. **Tripwire:** the projector's cloud visibly slowing or the
command counter climbing while no question is open. Secondary and cost-only: the reply also carries
every *other* question's `answered:`, `opt:` and `word:` fields, so it grows monotonically across the
segment.

## Cost, honestly

Per submission: **11** billed commands, unchanged from a single-choice answer. Per cloud beat: **2** per
tick (`HGETALL` + `HLEN`) on **one** device, ~24 ticks for a minute-long question ≈ 48 commands. Under
100 for the whole beat, and nothing on the Ably message budget.

As with S-07, the absolute figures are negligible **against an unexplained command baseline**
(`command-counter-diagnostic.md`), which is what makes "negligible" an assumption rather than a
measurement.

## Scope boundary

Not here: **no moderation of any kind**, including a host-side blank-the-cloud control — PRD
§Non-Goals parks it, and building half of it would reopen a closed decision by the back door (the host
can advance past the question) · no cloud on attendee phones; FR-015 asks the *host* to display it, and
150 devices polling an aggregate buys nothing the projector does not already give the room · no
snapshot field, no new store key, no scoring function · **no room-scale rehearsal re-run**, following
the boundary S-07 drew — so the top-30 truncation and the `HGETALL` payload at ~150 distinct words go to
a live event unmeasured. That is the accepted risk this slice's roadmap entry named, and extending
`scripts/rehearse-room.ts` is how to close it.

Markup is inert (`textContent` only, asserted in `render.test.ts`); **content is not filtered**. The
PRD accepts unmoderated content on the projector and says nothing about accepting unmoderated markup.

## Pointers

`spine-contract.md` (the fan-out rule this slice is shaped by) · `retention-contract.md` (the key
registry) · `leaderboard-contract.md` (read before a snapshot field; this slice adds none) ·
`command-counter-diagnostic.md` (the unexplained baseline) · `src/pages/quiz/host.test.ts` (what a
structural scan can and cannot prove)
