# Join contract (S-02)

Third after `spine-contract.md` (F-02) and `retention-contract.md` (F-03), and it inherits their
warning: **a contract that grows past a page has become a second copy of the plan, and a second copy
can disagree with it.** A pointer, not a summary.

Read before S-03, S-04, S-07, S-08 or S-09 adds a client module, a store key, or a snapshot field.

## The client convention (Open Roadmap Question 2, resolved)

Browser behaviour lives in **`src/lib/client/` as plain TypeScript modules** imported by Astro
`<script>` tags; the server hands values down with **`define:vars`**. **No UI framework is installed
and none should be added.** Accepted cost: S-07 and S-08 hand-write their DOM updates with no
diffing. Reversing this is a slice's work, so reverse it deliberately.

`session.ts` is the one implementation of the spine contract's client rule. Do not reimplement it —
two views drifting on reconciliation is what it prevents.

**Two gates, because the failures are silent.**

- `boundary.test.ts` — no `import.meta.env`, no *value* import from `src/quiz/` or `src/lib/session/`,
  in `src/lib/client/*.ts` **and in every `<script>` block of `src/pages/quiz/*.astro`**. `import type`
  is allowed. Frontmatter is excluded: it runs server-side and is *meant* to read env. A `src/quiz/`
  value import ships all fourteen answers to the phone being asked the question; a session import
  ships server config and drags `zod` and the server SDKs into a venue-network download.
- `keys.test.ts` — now scans `src/lib/client/` too.

**The trap this slice hit:** the version guard orders *flow state*. Do not route informational values
through it. The join count travelled inside the snapshot, so a same-version refresh was correctly
dropped and the host's lobby read empty for a whole test run. The count now travels **beside** the
document from `/api/quiz/state`, through an `onCount` callback outside the guard.

## The player keys

| Key | Holds |
| --- | --- |
| `livequiz:players` | folded display name → `{ id, displayName, joinedAt }`. `HLEN` is the join count. |
| `livequiz:player-ids` | opaque player id → folded name. The reverse index. |

Both registered, so `end` re-arms and `purge` deletes them.

**The reverse index is used now, not banked for S-09** — it is how a reloading device is recognised;
without it a returning attendee is refused by their own claim and locked out. S-09 extends it to a
score-intact resume.

It is also the only way to *detect* a lost claim race: the players hash is keyed by the folded name,
so a duplicate is structurally impossible there and a lost race looks like a healthy `HLEN`. Two ids
mapping to one folded name is the failure.

`PLAYER_STORAGE_KEY` names a `localStorage` entry on the attendee's device. **No purge reaches it** —
compliant, because the guardrail is about *operator-accessible* storage.

The claim is one Lua `EVAL` — phase check, collision check, both writes, both TTLs, one round trip.
`store.test.ts` asserts it stays a single `eval`. **Do not move any part of it into TypeScript.**
Verified at room scale: 450 concurrent claims, zero duplicates (`join-burst-report.md`).

## Names are not in the snapshot — S-07 still owns the choice

`SessionState` gained exactly one field, `playerCount`. **No display name is ever published.** Ably
retains a snapshot ~120 s irreducibly and `/api/quiz/token` is open, so a name on the wire is readable
by anyone for two minutes. This was a **choice**, and it corrects PRD Deviation 2, which predicted the
opposite.

**S-07 inherits the open half**: a leaderboard needs names on 150 screens — publish them and accept
the window, or publish opaque ids and let each device resolve only itself. Decide it; do not inherit it.

**Joining publishes nothing.** 150 joins × 150 subscribers is the O(N²) fan-out the spine forbids; the
count reaches the room on the host's next action.

## The count is read outside the version guard

`applyHostAction` overwrites the field on its way out — one injection point, because three
constructors build a full state literal and each copies `current.playerCount`. Copying is correct
*because* it is overwritten.

**A stale count is acceptable; a stale version is not.** Do not "fix" the asymmetry. `playerCount`
carries `.default(0)` so a pre-deploy document still parses — required, it would 409 the host's next
action mid-segment.

## Scope boundary

Not here: answering and scoring (S-03) · participation count and distribution (S-04) · leaderboard and
word cloud (S-07, S-08) · per-device cap and score-intact resume (S-09) · name moderation · throttling
on `/api/quiz/join` · CI. Only the narrow half of resume its own end state needs is implemented.

**One claim S-03 must re-take rather than inherit:** the player id is "not a secret" *for S-02*, where
the worst an impostor gets is a display name. From S-03 it carries a score. Probably still fine — a v4
UUID over HTTPS in a no-accounts model — but the slice that attaches scores should decide it.

## Pointers

`spine-contract.md` · `retention-contract.md` · `join-burst-report.md` (room-scale figures and their
limits) · `command-counter-diagnostic.md` (store cost, still partly open)
