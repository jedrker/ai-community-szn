# Join burst — first measurement of the join path (S-02, Phase 5)

The first time PRD **FR-002**'s thirty-second join target has been measured at all, and the
only place the name claim's atomicity is *tested* rather than asserted. `store.test.ts`
pins that `claimPlayer` is a single `EVAL` with three keys — that it **is** one round trip
— but a mocked test has nothing to race against. 150 concurrent claims against the real
store do.

## Parameters

| | |
| --- | --- |
| Harness | `scripts/rehearse-room.ts`, join stage added this phase |
| Target | `https://ai-community-szn.vercel.app` (production — see below) |
| Function region | `fra1`, read from `x-vercel-id` on every action, every run |
| Deployment | `06022fb` |
| N | 150 concurrent claims per run |
| Runs | 3 at N=150, plus one N=4 smoke |
| Date | 2026-08-08 |
| Driver | one process, one machine, one network |

Production rather than a preview deployment, for the reason `change.md` records: preview
URLs on this project return 302 to Vercel SSO for anonymous visitors, so simulated
attendee devices cannot reach one.

## Results

All three runs: **20/20 checks passed.**

| Run | Pool connect | Burst wall clock | Join RTT median | Join RTT p95 | Join RTT max | Claims |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 3431 ms | **1647 ms** | 607 ms | 974 ms | 1644 ms | 150/150 |
| 2 | 2705 ms | **1238 ms** | 525 ms | 1051 ms | 1173 ms | 150/150 |
| 3 | 3995 ms | **1419 ms** | 609 ms | 1241 ms | 1382 ms | 150/150 |

**Reported as a range, not a best case** (F-04's lesson: a baseline is a range or it is
wrong):

- Burst wall clock — **1.24 s to 1.65 s** for all 150 claims to complete
- Join round trip — median **525–609 ms**, p95 **974–1241 ms**, max **1.17–1.64 s**

Against FR-002's 30 s, the burst finishes in **4–6% of the budget**. That is a wide enough
margin that no reading of the caveats below overturns the conclusion.

Fan-out was measured alongside and stayed inside its own budget — worst end-to-end p95
across measured actions was **525 / 529 / 461 ms** against 1000 ms, with 150/150 devices
receiving every action in all three runs. Consistent with F-04's 111–592 ms band, now with
150 attendee writes in the system.

### The guarantee FR-008 exists to provide

| Check | Run 1 | Run 2 | Run 3 |
| --- | --- | --- | --- |
| Claims accepted | 150/150 | 150/150 | 150/150 |
| Distinct player ids | 150 | 150 | 150 |
| Names in the players hash | 150 | 150 | 150 |
| **Two ids sharing one folded name** | **0** | **0** | **0** |
| Collision probe rejected | 5/5 | 5/5 | 5/5 |

**Zero duplicate folded names across 450 concurrent claims.**

The duplicate check reads the **reverse index**, not the players hash, and that choice is
load-bearing. The players hash is keyed *by* the folded name, so a duplicate is
structurally impossible in it — a lost race would show as one entry silently overwritten,
with `HLEN` looking perfectly healthy. `livequiz:player-ids` is keyed by player id, so two
ids that both claimed one name both survive, and grouping by value surfaces the pair. The
accepted-count-vs-`HLEN` check is the same fault seen from the other side.

The collision probe claims `GOSC  <n>` against an already-held `Gość <n>` — case,
diacritics **and** an extra internal space at once, since those are three separate rules in
`validateDisplayName` and any one regressing alone would let a duplicate through. Every
variant was refused 409.

### The join count reaches the room

`the published snapshot carries the real join count — 150 in the last published snapshot,
150 accepted claim(s)` — all three runs.

This is the first test of Phase 1 §5's injection against reality. `host.test.ts` pins that
the published count *differs from* the one on `current`, which catches the read-and-discard
bug, but no mocked test can show that the number arriving on 150 devices is the number in
the hash.

### Store cost

Predicted **before** running, so the comparison is a test and not a rationalisation:
1 pre-flight `GET`, 3 for `start`, 150 join `EVAL`s, 12 for four flow verbs, 3 for
teardown ≈ **169 per run**, ~510 for three.

| | Commands | Writes | Reads |
| --- | --- | --- | --- |
| Before the three runs | 1541 | 640 | 901 |
| After | 2794 | 1411 | 1383 |
| **Delta** | **+1253** | **+771** | **+482** |
| Predicted delta | ~510 | ~470 | ~40 |

The 150 Ably subscribers touch no store key — minting a subscribe token reads nothing —
so the burst itself is the whole cost.

**The prediction was 2.5× low, and the miss is almost entirely in the reads.** Per run,
against a code accounting of ~156 writes and ~13 reads:

| | Predicted / run | Observed / run | Factor |
| --- | --- | --- | --- |
| Writes | ~156 | ~257 | 1.65× |
| Reads | ~13 | ~161 | **12×** |

**Leading hypothesis: the claim `EVAL` is billed as more than one command.** The script's
first statement is `GET` on the session document, and ~155 claims per run (150 plus the
5-variant collision probe) against ~161 observed reads is close enough to one-read-per-claim
that the coincidence is worth naming. The `HEXISTS` and `HLEN` inside the same script are
apparently not billed the same way, or the read figure would be near 465 — so this is a
partial explanation at best, and the write excess (~100/run) is not explained by it at all.

**Not asserted as fact.** The honest statement is that a join costs **roughly two billable
commands, not one**, and the rest is unattributed. The cheap probe that would settle it:
read the counter, issue exactly one join, read it again. That is Phase 0's method applied
to a known operation instead of to an idle store, and it is now the more useful version of
that diagnostic — Phase 0's original framing (attribute the historical delta before
attendee writes exist) expired when Phase 1 shipped.

**Relation to the inherited 513 → 4102 anomaly: unresolved, and probably not the same
thing.** Those seven F-04 runs had no join stage, so the code accounted for roughly 19
commands each against ~513 observed — a factor near 27×, an order of magnitude worse than
the 2.5× here. A single multiplier does not explain both. What can be said is that the
current cost is *bounded and measured*, which the earlier figure was not.

**One new per-request cost landed this phase and belongs in any later projection:**
`/api/quiz/state` now issues an `HLEN` alongside its `GET`, because the host's refresh
button was otherwise re-reading a document whose count could not have changed. That is one
extra command per device per *connect* (~150 a session) plus one per host refresh. Paced by
connects and by the host, not by a timer.

### The tripwire

`docs/runbook-live-session.md` carries a **200K** command tripwire. The console reports the
plan ceiling as **500K per month**, so the tripwire is not the limit — it is a
deliberately conservative fraction of it, and that is worth stating in the runbook rather
than leaving a reader to infer a limit that is wrong by 2.5×.

Using the **measured** cost rather than the predicted one — ~420 per rehearsal run, plus
~150 for attendee connects now that `/api/quiz/state` also issues an `HLEN` — a real event
costs on the order of **500–600 commands**. Even at ten events a month that is ~1% of the
500K plan.

The tripwire needs no numeric change, but it needs its purpose stated. It is **not** a
capacity guard: at 200K it sits ~350× above a real session, and anything approaching it
could only have been produced by something looping. Recording it as "40% of the limit"
would invite someone to raise it when usage grows, which would defeat it. The runbook edit
in Phase 6 should say that, and correct the implied ceiling — the plan is 500K/month, not
200K.

## What this measurement is not

Following F-04's precedent, stated rather than left to be assumed:

- **A lower bound, not a venue simulation.** One process on one network. 150 real phones on
  one venue Wi-Fi will be worse. If it had failed here, real devices would certainly fail;
  passing here is not proof the venue passes.
- **The claim round trip, not a phone painting a screen.** Paint time is still not measured
  anywhere — it was deliberately left out of scope — so the user-visible join is the figure
  above *plus* an unmeasured render.
- **Therefore FR-002's 30-second target is informed by this figure, not proven by it.** The
  margin is 20× rather than marginal, which is what makes the gap tolerable; it does not
  close it.
- **The names were generated, not typed.** A real attendee spends seconds choosing and
  typing a name, and may be rejected and retry. None of that is in the 1.24–1.65 s.
- **Nothing here tests 150 devices resuming.** `readPlayerById` was exercised by the manual
  two-device run only.

## Teardown

`scripts/check-purge-residue.ts` — 6/6 passed, namespace clean, with the unregistered decoy
surviving as designed (a registry-based purge cannot reach what the registry does not know
about).

## Verdict

The atomic claim holds at room scale. 450 concurrent claims produced zero duplicate names,
and the fold that FR-008 depends on refused every collision variant. The burst completes in
4–6% of the join budget. Nothing here blocks S-03.
