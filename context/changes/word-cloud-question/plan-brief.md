# Word-cloud question (S-08) — Plan Brief

> Full plan: `context/changes/word-cloud-question/plan.md`

## What & Why

An attendee submits one word to the unscored word-cloud question that opens the segment, and the
aggregate fills visibly on the projector as the room answers (FR-012, FR-015). The PRD kept this view
knowing it is the most expensive in the set, built for a single question, because **watching your own
word appear on the big screen is the moment that proves the session is live**.

## Starting Point

The kind is half-built: `word-cloud` is already in the schema's union, the build gate already refuses a
scored one, `publicQuiz` already projects it prompt-only, and it is `quiz.questions[0]`. Four seams sit
stubbed with comments naming S-08 — the answer route refuses the kind with a Polish message, the
attendee view renders it as static text, `revealedAnswerText` is null for it, and `render.ts`'s
"`textContent`, never `innerHTML`" rule was written specifically for the attendee-typed strings this
slice feeds it. Nothing stores, reads or renders a word.

## Desired End State

The host advances to Q1. The projector shows the prompt, `odpowiedzi N / M`, and a cloud whose word
sizes scale with how many people typed each one, refreshing every ~2.5 s. An attendee types one word,
sends, and sees their own word echoed with a line pointing at the big screen — no verdict, no points.
The host reveals; the cloud takes one final read and freezes to be talked over. The host advances; the
cloud clears.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| How the cloud reaches the room | Host-side polled read, **never** the snapshot | Ably's free tier bills one broadcast to 150 clients as 150 messages against a 100/s ceiling, and a continuous cloud has no host action to attach to. S-04's participation loop is the exact template. |
| Where the counts live | Third field family in `livequiz:tallies` | No new key, so the registry, `end`, `purge` and the purge-residue probe need no change — and the increment sits below the existing `HSETNX`, so a duplicate tap cannot double-count. |
| How two words count as one | A **third** fold: lowercase + whitespace, diacritics **preserved** | The folded form is what the projector displays, and Polish stripped of diacritics reads as a typo on a screen the room is looking at. Added beside the existing two, never widening them (`lessons.md` rule 3). |
| Cloud on attendee phones | No — confirmation and echo only | FR-015 asks the *host* to display it; 150 devices polling an aggregate is the densest path this slice could add and buys nothing the projector doesn't already give the room. |
| What a valid word is | One token, max 24 chars, `players.ts`'s allowlist minus the space | 24 is the projected-line bound `MAX_DISPLAY_NAME_LENGTH` already uses. A readable refusal beats a truncation nobody sees. |
| Write path | Reuse `submitAnswer` | The one-answer-per-question lock, TTL arming, unknown-player check and phase guard all come for free and cannot disagree with the other four kinds. |
| Endpoint | A new host-gated `GET /api/quiz/host/words` | Mirrors the reasoning that split `readAnsweredCount` from `readQuestionTallies`: one route, one response shape, and `participation.test.ts`'s writes-nothing assertion stays about one file. |
| Poll loop | One loop, endpoint chosen by kind | `host.astro` documents a second timer as the failure it guards hardest against; two loops mean two backoffs and two chances to leave one running for a hidden panel. |
| Poll lifecycle | Poll while open, one final read at reveal, then stop | The host keeps a complete cloud to talk over for the cost of one command, and no timer outlives the beat. |
| Moderation | None, per PRD §Non-Goals | Building half of a parked feature would reopen a closed decision by the back door. The host can advance past the question. |
| Rehearsal harness | Not re-run; the stale comment corrected | Follows the boundary S-07 drew. **Named as an accepted risk below.** |

## Scope

**In scope:** the word fold and validation · a third tallies field family · one extra counter in the
existing submission Lua · `word` on the answer record · the answer route's word branch · a store read
and a new host-gated route · a size-scaled cloud renderer · the host panel and its poll · the attendee
field, lock and reveal echo · a contract plus every document this change falsifies.

**Out of scope:** any `SessionState` field, phase, or snapshot change · any new store key · any cloud
on an attendee phone · moderation of any kind, including a blank-the-cloud control · a scoring function
· a room-scale rehearsal re-run · emoji.

## Architecture / Approach

```
phone ──POST /api/quiz/answer──▶ validateWord → foldWord
                                 SUBMIT_ANSWER (one Lua, atomic):
                                   HSETNX answers          ← the lock
                                   HINCRBY tallies word:…  ← below it, so a duplicate can't count
projector ──GET /api/quiz/host/words (~2.5s, host-secret)──▶ HGETALL tallies + HLEN players
                                 ◀── { answered, playerCount, words, distinct } → chips, size ∝ count
```

Nothing publishes to Ably. The host's snapshot subscription is untouched.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The word rule | `words.ts` (fold, validation, bounds), the tallies field family, and the corrected "two folds" claim | Widening an existing fold instead of adding beside it — the exact `lessons.md` rule 3 failure, whose symptom appears only mid-deploy |
| 2. The write path | `word` on the record, one counter in the Lua, the answer route's last seam | Placing the increment above the `HSETNX`, which counts a submission the lock then rejects |
| 3. The read and the route | `readWordCloud` and `GET /api/quiz/host/words` | A write on this path moves `updatedAt`, which bounds the speed clamp — inflating every award after it, silently |
| 4. The projector | The cloud renderer and one loop serving two panels | A second timer, or a renderer that sorts; both look correct on screen |
| 5. The phone | The field, the gate, the lock, the echo | Branching on `scored` before `kind` and telling the room its word was a worthless warm-up |
| 6. Contract and documents | `word-cloud-contract.md`, CLAUDE.md, roadmap, PRD, infrastructure, runbook | Leaving a falsified guarantee standing in a document a future agent trusts |

**Prerequisites:** S-03 (delivered). Upstash and Ably credentials for the manual runs. A second device.
**Estimated effort:** ~2–3 sessions across six phases; phases 1–3 are small and mostly test-shaped,
4–5 carry the hand-written DOM.

## Open Risks & Assumptions

- **The mechanic the roadmap flagged as most likely to strain the spine goes to a live event
  unmeasured at room scale.** Deliberate, following S-07's boundary: the submission path bills exactly
  what a choice answer already does, and the cloud is one polled read on one device. What is untested
  is the top-30 truncation and the `HGETALL` payload at ~150 distinct words. Recorded in the contract's
  scope boundary; reversible by extending `rehearse-room.ts` later.
- **"Negligible cost" rests on an unexplained baseline** (`command-counter-diagnostic.md`). The
  absolute figures are small; the baseline they sit on is an assumption.
- **A word typed with and without Polish diacritics counts as two chips.** Accepted cost of displaying
  the fold; cosmetic on an unscored question.
- **Unmoderated attendee text goes on a projector.** The PRD's decision, not this slice's. Markup is
  neutralised (`textContent` only); content is not filtered. The runbook will say so before the host is
  on stage with it.
- **The tallies hash stops being counters-only.** Still keyed by no player and no name, still re-armed
  by `end` and deleted by `purge` — but the registry's "NOT attendee data" claim is corrected in place
  rather than inherited.

## Success Criteria (Summary)

- An attendee submits one word from a phone and sees it appear on the projector within a couple of
  seconds, then sees their own word echoed at the reveal with no verdict attached.
- The host runs the beat without touching anything but `dalej` and `pokaż odpowiedź`, and the session
  document's `version` and `updatedAt` never move while the cloud is polling.
- `bun run test`, `bun run type-check` and `bun run build` are clean, and no document in the repository
  still states a guarantee this change falsified.
