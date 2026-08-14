# Per-question time limit (S-11) — Plan Brief

> Full plan: `context/changes/per-question-timer/plan.md`

## What & Why

Every scored question gets its own time budget, authored per question in `src/quiz/definition.ts`, shown
as a countdown on the phone and the projector, and enforced server-side as a **submission window** —
once it is spent, `/api/quiz/answer` refuses. The host keeps every pacing lever they have today.

This partly reverses PRD FR-003, which rejected a timer outright ("the host reading the room beats a
fixed clock"). Only the *answering* half is reversed: advancing, revealing and ending stay manual, so
FR-004 is untouched and FR-014's "consistent with FR-003" clause is amended rather than falsified.

## Starting Point

There is already a per-question clock, and it is not a limit: `speedWeight` decays an award over 20
seconds to a floor of half, measured from each attendee's **own first paint** so a slow connection costs
no points (FR-019). Nothing cuts a question off — the host closes it. The session document's `updatedAt`
already *is* the moment the open question opened, and it is the upper bound every award's speed clamp
measures against, true only because nothing writes while a question is open.

## Desired End State

A host runs a session exactly as the runbook describes. Each scored question shows a countdown on the
projector and every phone, both derived from the same server timestamp so they agree. At zero the phone
locks its input and says the time ran out; a late submission is refused with a Polish message distinct
from "already answered". The opening word cloud and the warm-up carry no clock and still fill until the
host reveals.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| What the clock governs | Submission window only | Keeps FR-003/FR-004 manual pacing and needs no scheduler — there isn't one | Plan |
| Where the deadline lives | Derived from `updatedAt + limit`, stored nowhere | No snapshot field, no key, no mid-question write; both inputs already reach every device | Plan |
| Two clocks | Shared cutoff, per-device speed weight | FR-019 stays intact: a slow connection still costs no points | Plan |
| In-flight answers | Server-side grace (~2 s), invisible to clients | Protects the "loses no submitted answer" guardrail without making the visible clock lie | Plan |
| Authoring | Required on every scored question; refused on unscored | No question inherits a number nobody chose; enforced at the build gate | Plan |
| Late refusal | 409 with a `refusal: "expired"` discriminator | Two 409s from one route need a machine-readable class (resume-contract precedent) | Plan |
| Unscored questions | No clock, host-paced | Preserves the word cloud's documented behaviour and the host's only lever on it | Plan |
| Countdown rendering | JS timer with numeric seconds | Legible from the back of a room; costs a rewrite of the one-timer guard | Plan |
| Phone at zero | Locks input, says time is up | Never invites an answer that will be refused | Plan |
| Host override | None | An extension is a write during `question-open`, which inflates every later award | Plan |
| Latecomer / reload | The shared remainder; locked if already past | One truthful clock in the room, matching what the server enforces | Plan |
| Enforcement site | `answer.ts` only, not the Lua script | The redis client is mocked, so a Lua branch is the least verifiable place for this rule | Plan |

## Scope

**In scope:** a `timeLimitSeconds` field and its build gate; the twelve values; exposure through
`PublicQuestion`; a `deadline.ts` module with the grace constant; the 409 refusal and its log class; a
countdown plus input lock on `/quiz`; a countdown on `/quiz/host`; rewriting `host.test.ts`'s one-loop
guard; PRD, roadmap, runbook, CLAUDE.md and a one-page contract.

**Out of scope:** automatic advance/reveal/standings/end; host override, extension or pause; any change
to `speedWeight`, `SPEED_WINDOW_MS`, `clampElapsed` or award arithmetic; new `SessionState` fields, keys,
Ably messages or polling loops; a clock on unscored questions; client-side authority.

## Architecture / Approach

```
definition.ts (timeLimitSeconds)  ──►  public.ts ──► define:vars ──► phone + projector countdown
        │                                                                    (updatedAt + limit)
        └──► deadline.ts (+ grace) ──► answer.ts expiry check ──► 409 refusal: "expired"
                                            ▲
                        session.state.updatedAt (server clock only — never the client's elapsedMs)
```

Nothing is stored, published or scheduled. The deadline is arithmetic over two values every party
already holds, and expiry is enforced lazily on the next submission rather than fired by anything.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The rule | Schema field, build gate, 12 values, `deadline.ts` | A limit under 20 s makes the speed floor unreachable — legal, but must be a deliberate authoring choice |
| 2. The write path | 409 refusal with its discriminator and log class | A cutoff derived from the client's `elapsedMs` would be one a phone can opt out of |
| 3. The phone | Countdown, input lock, `expired` outcome | A countdown timer surviving its question; `markSubmitted` claiming an answer that never existed |
| 4. The projector | Countdown on the large screen, guard rewritten | The rewritten guard must be verified in both directions, or it certifies whatever is there |
| 5. Documents | Contract, PRD reversal, roadmap, runbook, CLAUDE.md | Leaving a document asserting the old guarantee — the failure `lessons.md` names |

**Prerequisites:** none beyond the current `main`; every roadmap slice is done, so this is the first
post-roadmap change.
**Estimated effort:** ~4–5 sessions across five phases, with a manual two-device pass between each.

## Open Risks & Assumptions

- The proposed budgets (25 s tapping, 40 s typing) are a first guess and will want one live rehearsal to
  calibrate; they are a one-line edit per question.
- The grace window means the enforced cutoff is later than the visible one. Accepted deliberately, and
  the reason it must stay invisible to clients is recorded in the contract.
- Timing logic is this project's weakest test surface — the Lua never executes under test and Astro
  inline scripts have no harness. Mitigated by keeping enforcement in TypeScript and by break-the-guard
  passes in every phase.
- A question already open when this deploys may be instantly expired; the host's next `dalej` clears it.

## Success Criteria (Summary)

- An attendee can see how much time is left, on a clock that agrees with the projector's, and cannot
  answer after it runs out.
- No attendee's award changes on any answer that would have been accepted before this change.
- The host's session runs exactly as the runbook describes, with no automatic transition anywhere.
