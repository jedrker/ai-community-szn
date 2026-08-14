# Resilient Join Implementation Plan

## Overview

Roadmap S-09. Close the two halves of device-scoped identity: FR-018's per-device player cap,
which does not exist at all today, and the remaining honest gaps in FR-009's resume, which S-02
and S-03 built most of already.

The two halves pull in opposite directions on purpose — resume needs the device *remembered*,
the guard needs the device *counted* — and the whole risk of this slice is that the guard reaches
the resume path and eliminates a player a screen lock was supposed to preserve.

## Current State Analysis

**Resume is largely built, and works.** S-02 shipped the identity handshake and S-03 hardened it:

- `PLAYER_STORAGE_KEY` holds `{ id, displayName }` on the device (`src/lib/session/keys.ts:214`),
  read on every page load by `readPlayer` (`src/lib/client/player.ts:53`).
- `/api/quiz/join` has two shapes in one route; the `playerId` branch is checked **before** the
  name so a reload never becomes a second claim (`src/pages/api/quiz/join.ts:66`).
- `readPlayerById` returns `found` / `not-found` / `failed` as three distinct outcomes
  (`src/lib/session/store.ts:795`), because the two failure classes need opposite things done to
  `localStorage` — a store blip that cleared the id would lock the attendee out under their own
  name.
- `QUESTION_SEEN_STORAGE_KEY` persists first-paint times, the `submitted` flag and the submitted
  text per question (`src/lib/client/answer.ts:124`), so a reload neither resets the speed clock
  nor loses the fact that this device already answered.
- The score itself lives server-side in `livequiz:scores` keyed by player id
  (`src/lib/session/keys.ts:172`), so it is *intact* across a reload by construction.

**The cap does not exist.** Nothing in the project counts joins per device. An IP-keyed throttle
was considered and rejected during S-02 planning because a venue network puts many attendees
behind one address, and `join.ts:28` records that rejection.

**Two honest gaps remain in the resume half:**

1. **The running total is invisible after a mid-question reload.** `result-total` is painted only
   from inside the result panel (`src/pages/quiz/index.astro:1187`, `:1217`, `:1257`), which is
   gated on `question-revealed` / `standings`. Reload during `question-open` and the phone shows a
   name and a question with no score anywhere on it. FR-009 says "with score intact"; server-side
   it is, on screen it is not until the next reveal.
2. **A device whose storage is unavailable is locked out of its own name.** `readPlayer` reports
   private mode, disabled storage and a malformed value all as "no stored player"
   (`src/lib/client/player.ts:67`) — deliberately, since nothing there may throw. The attendee is
   shown the join form, re-types the name they are still holding, and is refused as `taken` with
   no explanation and nowhere to go.

### Key Discoveries

- **The claim is one Lua `EVAL` and must stay one** — `CLAIM_PLAYER` at `src/lib/session/store.ts:244`
  does the phase check, the collision check, both writes and both TTLs in a single script, and
  `store.test.ts` asserts it stays a single `eval`. The join contract states plainly: *do not move
  any part of it into TypeScript*. A cap checked outside the script is a check against a count that
  can change before the write lands.
- **Every `livequiz:`-prefixed name is declared in `src/lib/session/keys.ts` and nowhere else**
  (`keys.test.ts` fails the suite otherwise). That includes browser storage keys, which are declared
  there despite no purge reaching them — the invariant is "one module owns every namespaced name",
  and an invariant with an exemption list rots.
- **A client module may not value-import from `src/lib/session/`** (`boundary.test.ts`, which also
  scans every `<script>` block in `src/pages/quiz/*.astro`). Storage keys reach the client through
  `define:vars` — `index.astro:266` parks them on `window` and the module script picks them up.
- **`lessons.md`: absent untrusted input must fail toward the safe end.** S-03's `Number(null) === 0`
  handed full speed weight to a submission that simply omitted a field. An absent `deviceId` must not
  become an un-counted claim.
- **`lessons.md`: check the data path can deliver a promised UI affordance.** S-02 promised a live
  lobby count over a document only a host action could change. A permanently-visible running total
  refreshed only at reveal is that same defect.
- **`lessons.md`: break the guard and watch the named test fail.** Applies to every test in this
  plan, and specifically to the resume exemption in Phase 3.
- `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` governs any new key.
- `context/archive/2026-08-07-join-and-follow-host/join-contract.md` is this slice's direct
  predecessor and already names the per-device cap and the score-intact resume as S-09's.

## Desired End State

A device may register at most **3** players in a session; the fourth claim is refused with a Polish
message that does not invite a doomed retry. That guard never touches the resume path: a capped
device that reloads still comes back as its existing player, with its score. An attendee who reloads
mid-question sees, under their name, what they are returning with. An attendee whose device could not
remember them is told what happened and what to do instead of meeting a bare "name taken".

Verified by: `bun run test`, `bun run type-check`, and a manual reload-and-resume run on two real
devices against production before the next session.

## What We're NOT Doing

- **No IP-based throttling** on `/api/quiz/join`. Rejected in S-02 planning for the venue-NAT reason
  and not reopened here.
- **No cookie, no fingerprinting.** The device id is client-minted and opaque; FR-018 is explicitly a
  lightweight, defeatable guard and not an identity system.
- **No attempt to make the cap undefeatable.** Clearing storage or opening a private tab resets it.
  That is the accepted cost, stated in the PRD.
- **No release of a cap slot.** The counter is cumulative and never decremented — there is no
  "abandon a player" action in this product to hang a release on.
- **No recovery of a player whose device forgot its id.** Without the id there is nothing to present;
  Phase 4 makes the refusal *explicable*, not reversible.
- **No permanently-visible running total.** See the affordance/data-path lesson above.
- **No `rehearse-room.ts` scenario.** The cap and the resume are both per-device properties, not
  concurrency properties, so the harness would re-prove what a store test already covers.
- **No change to the final winner reveal (S-10), the standings, or any snapshot field.**
  `SessionState` gains nothing in this slice.

## Implementation Approach

The cap lands where the claim already is — inside `CLAIM_PLAYER` — as one more guard, one
`HINCRBY` and one `EXPIRE`. The device id is minted on the phone and travels as a form field, so no
server-side identity system appears. The resume path is left structurally untouched and gains only a
number on its way out.

Three decisions taken during research rather than left to the implementer, because each one has a
wrong answer that looks right:

**The cap check sits after the phase checks and before the collision check.** A device that is both
capped and typing a taken name must be told it is capped: "that name is taken" invites a retry that
will also fail, and the attendee would work through three names before learning the real reason.

**An absent `deviceId` is refused, never un-counted.** Bucketing every device that sent no id into a
single shared counter would let three private-mode attendees consume the whole room's allowance, so
that is not the answer either. Our own client always sends one — minted in memory when storage is
unavailable, so a storage-less device gets a fresh id per page load and is never capped in practice.
An absent field therefore means a caller that is not our client, which is precisely the farming case.
The refusal is a 400 with a "refresh the page" message, so the one honest way to hit it — a page
cached from before this deploy — is recoverable in one tap.

**The resumed total gets its own element and retires itself.** It is phrased as a statement about the
moment of resuming (`Wracasz z wynikiem N pkt`), which stays true however long it sits there, and it
is cleared the first time a fresh total paints, so two scores are never on screen at once.

## Critical Implementation Details

**Ordering inside `CLAIM_PLAYER`.** The increment must happen on the *claimed* path only, alongside
the two `HSET`s — above the collision check it would charge a device for a name it did not get, and a
device could be capped by three collisions with names it never held. The `EXPIRE` on the devices key
belongs inside the script for the reason the other two do: a separate `EXPIRE` is another round trip
that can fail on its own and leave a key on no lifetime at all, covered by neither `end` nor the next
host action.

**Billed command cost.** The claim goes from 6 to 9 calls on the accepted path (`EVAL`, `GET`,
`HGET` on devices, `HEXISTS`, 2× `HSET`, `HINCRBY`, 3× `EXPIRE`). Joins happen ~150 times once per
session, paced by attendees arriving rather than by a loop, so this is nowhere near the shape
`command-counter-diagnostic.md` exists to watch. Worth recording, not worth optimising.

**`readPlayerById` is read-only and stays that way.** It is an `EVAL` for the round trip, not for any
guard (`store.ts:283`). Adding the score is one more `HGET` in the same script; it must not acquire
a write.

## Phase 1: The device identity and the cap rule

### Overview

The pure, storage-level half: the threshold, the two names, and the client module that mints and
reads the device id. Nothing enforces anything yet, so this phase cannot break a join.

### Changes Required:

#### 1. The threshold

**File**: `src/lib/session/players.ts`

**Intent**: Declare how many players one device may register, beside the display-name bounds it
already owns — this module is the pure half of joining and holds no store access, so both the route
and the Lua caller can read it without a cycle. The docstring must carry *why* 3: it covers the
honest shared-handset cases (a couple, a parent and child, one lent phone) while making farming
tedious, and the guard is defeatable by design, so the number buys friction rather than prevention.

**Contract**: `export const MAX_PLAYERS_PER_DEVICE = 3;`

#### 2. The two names

**File**: `src/lib/session/keys.ts`

**Intent**: Register the server-side counter hash as a purgeable key, and declare the browser storage
key beside `PLAYER_STORAGE_KEY` and `QUESTION_SEEN_STORAGE_KEY`. The registry entry's `holds` text is
load-bearing: it must state that the hash holds a count and nothing else — no name, no player id,
nothing joinable back to a person — which is what makes it the weakest thing that can enforce the
cap. The storage key's docstring inherits the stated posture of its two neighbours: no purge reaches
it, and that is compliant rather than a gap, because the retention guardrail is about
operator-accessible storage.

**Contract**: a sixth entry in `REGISTERED_KEYS` exported as `DEVICES_KEY`
(`livequiz:devices`, hash of opaque device id → integer claim count), and
`export const DEVICE_STORAGE_KEY = \`${SESSION_NAMESPACE}device\`;` alongside the other two
browser-storage constants. `registeredKeys()` picks the new key up automatically, so `end` and
`purge` cover it with no further change.

#### 3. The device id on the phone

**File**: `src/lib/client/device.ts` (new)

**Intent**: Mint an opaque id on first load, persist it, and hand the same one back on every later
load. `player.ts` is the pattern to follow in posture — nothing throws, every storage failure is
absorbed — but the fallback differs and that difference is the point: where `player.ts` reports a
failed read as "no stored player", this module must **always return an id**. A storage-less device
therefore gets a fresh id per page load and is never capped, which is the accepted defeatability;
what it must never do is return an empty string, because the route refuses that.

**Contract**: `export function deviceId(storageKey: string): string` — reads the stored id, or mints
one with `crypto.randomUUID()`, attempts to persist it, and returns it either way. Memoised per page
load so two calls cannot mint two ids.

#### 4. The tests

**File**: `src/lib/client/device.test.ts` (new)

**Intent**: Cover the three paths — first load mints and persists, second load returns the same id,
and a broken `localStorage` still returns a usable id rather than an empty string.

**Contract**: `// @vitest-environment happy-dom` docblock at the top, per CLAUDE.md — the suite
default is `node` and there is no vitest config file to change. The broken-write case must save and
restore `localStorage.setItem` by hand: happy-dom's `localStorage` is a Proxy and
`vi.restoreAllMocks()` does not restore a spy installed on it, so a leaked stub silently swallows
writes in every later test in the file. `answer.test.ts`'s `withBrokenWrite` helper is the pattern to
copy.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `keys.test.ts` still passes — the new `livequiz:` names appear only in `keys.ts`
- `boundary.test.ts` still passes — `device.ts` reads no `import.meta.env` and value-imports nothing
  from `src/quiz/` or `src/lib/session/`
- The broken-storage test is verified in both directions: it fails when `device.ts`'s `try/catch` is
  removed, and passes when it is restored

#### Manual Verification:

- Nothing user-visible changed yet — the join flow behaves exactly as before

---

## Phase 2: The claim script enforces the cap

### Overview

The guard, inside the one `EVAL` that already owns the claim's atomicity.

### Changes Required:

#### 1. The script

**File**: `src/lib/session/store.ts`

**Intent**: `CLAIM_PLAYER` gains the devices hash as a fourth key, the device id and the cap as
arguments, a refusal status when the count is already at the cap, and — on the claimed path only —
one `HINCRBY` and one `EXPIRE`. Position the cap check after the two phase checks and before the
`HEXISTS` collision check, and say in the docstring why: a device that is both capped and typing a
taken name must hear the final reason, not the one that invites three more attempts.

**Contract**: `KEYS[4]` = devices hash, `ARGV[5]` = device id, `ARGV[6]` = cap. New status `-3` for
capped, returned alongside the session document like every other refusal so the caller can still
render the room's current state. The increment sits with the two existing `HSET`s; the `EXPIRE` sits
with the two existing ones. The script stays a single `eval` — `store.test.ts` asserts this and the
join contract forbids moving any part of it into TypeScript.

#### 2. The result type and the caller

**File**: `src/lib/session/store.ts`

**Intent**: `ClaimResult` gains a `capped` member, and `claimPlayer` takes the device id as a
parameter and maps status `-3` onto it. `capped` is an ordinary outcome, not an error — the same
posture `taken` has.

**Contract**: `| { outcome: "capped"; state: SessionState | null }` on `ClaimResult`;
`claimPlayer(key: string, record: PlayerRecord, deviceId: string)`. The cap value is read from
`MAX_PLAYERS_PER_DEVICE` here rather than passed by the route, so there is one place it is spelled.

#### 3. The tests

**File**: `src/lib/session/store.test.ts`

**Intent**: Cover the cap at its boundary and the ordering decisions that are easy to get backwards.

**Contract**: at minimum — the third claim from one device succeeds and the fourth returns `capped`;
a *failed* claim (`taken`) does not consume a slot; a claim from a different device id is unaffected;
the capped refusal still carries the session document; and the existing single-`eval` assertion still
holds. Per `lessons.md`, verify each guard in both directions — remove the cap check and confirm the
boundary test fails, then restore.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- The single-`eval` assertion in `store.test.ts` still passes
- The cap boundary test fails when the `-3` branch is removed from the script, and passes when
  restored
- The "a taken name does not consume a slot" test fails when the `HINCRBY` is moved above the
  collision check, and passes when restored

#### Manual Verification:

- Nothing user-visible changed yet — the route does not pass a device id, so no claim is capped

---

## Phase 3: The route, and the resume exemption

### Overview

Wire the guard to the request, and make the exemption that keeps it away from FR-009 an explicit,
tested property rather than a consequence of where the code happens to sit.

### Changes Required:

#### 1. The join route

**File**: `src/pages/api/quiz/join.ts`

**Intent**: Read `deviceId` from the form on the *claim* path, refuse it absent or empty, pass it to
`claimPlayer`, and render `capped` as a Polish 409. The docstring must state the exemption as a rule:
the `playerId` branch never consults the cap, because a guard that can refuse a resume turns a
lightweight anti-farming measure into something that eliminates a player whose screen locked.

The absent-field refusal needs its own reasoning in the docstring, per `lessons.md`: an absent
`deviceId` is refused rather than treated as un-counted, because a shared "unknown device" bucket
would let a handful of private-mode attendees consume the room's whole allowance, and because our own
client always sends one. The one honest way to hit it is a page cached from before this deploy, which
the message tells the attendee to fix.

**Contract**: two new `MESSAGES` entries, Polish, rendered directly by the client —
`capped` ("Z tego urządzenia dołączyło już zbyt wielu graczy.") and `noDevice` ("Odśwież stronę i
spróbuj ponownie."). 400 for the missing field, 409 for `capped` (an outcome about the request, like
`taken`, not a server failure). A `logSessionEvent("session.join.rejected", { rejection: "capped" })`
line beside the five existing ones — the *class*, never the device id, since logs outlive the session
document and are covered by no TTL and no purge. The `rejection` union in `src/lib/session/log.ts:202`
is deliberately closed and must be *extended*, never widened to `string`: add `"capped"` and
`"no-device"`.

#### 2. The route tests

**File**: `src/pages/api/quiz/join.test.ts`

**Intent**: Pin the exemption and the absent-field refusal, both of which are properties a future
edit could quietly reverse while every other test stays green.

**Contract**: a test named for the exemption — a device already at the cap presents a `playerId` and
is resumed, not refused — and one for the absent field, which must assert the *outcome* (a 400, and
that `claimPlayer` was never reached) rather than merely that the request was rejected. Per
`lessons.md`, do not spell the absent value as `undefined` where a helper's destructuring default can
replace it with a valid one; prove the fixture reaches the branch. Verify both by breaking the guard
and watching the named test fail.

#### 3. The phone sends its id

**File**: `src/pages/quiz/index.astro`

**Intent**: Pass `DEVICE_STORAGE_KEY` down through `define:vars`, import `deviceId` in the module
script, and set the field on the claim request. The resume request is deliberately left alone — it
sends `playerId` and nothing else, which is what makes the exemption visible in the source.

**Contract**: `deviceStorageKey` added to the `define:vars` object, the `window.__liveQuiz` literal
and the `Config` type; `body.set("deviceId", deviceId(config.deviceStorageKey))` in `claim()` only.
The frontmatter import of `DEVICE_STORAGE_KEY` from `src/lib/session/keys.ts` is correct and must not
be "fixed" — `boundary.test.ts` deliberately does not scan frontmatter, which runs server-side and is
meant to read server modules.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- `boundary.test.ts` passes — the new `<script>` usage value-imports nothing forbidden
- The exemption test fails when the cap check is applied to the `playerId` branch, and passes when
  restored
- The absent-`deviceId` test fails when the guard is removed, and passes when restored

#### Manual Verification:

- Joining from a fresh device still works and still lands inside the 30-second target
- A fourth claim from one browser is refused with the Polish capped message, and the message does not
  read as "try another name"
- After being capped, reloading the page still resumes the device's existing player

---

## Phase 4: The phone — score-intact resume and a recoverable refusal

### Overview

The two gaps in the resume half: what a returning attendee can see, and what a forgotten attendee is
told.

### Changes Required:

#### 1. The score travels with the lookup

**File**: `src/lib/session/store.ts`

**Intent**: `READ_PLAYER_BY_ID` picks up the player's running total in the same round trip, and
`LookupResult` carries it. Read the total explicitly rather than by bare coercion — `lessons.md`'s
absent-input rule applies here too: a player absent from the scores hash has scored nothing and is a
legitimate `0`, which must stay distinguishable from a value that failed to parse. The script stays
read-only; it is an `EVAL` for the round trip, not for a guard.

**Contract**: `KEYS[4]` = scores hash, one more `HGET`, a third element in the returned tuple;
`LookupResult` gains `readonly total: number`.

#### 2. The resume response carries it

**File**: `src/pages/api/quiz/join.ts`

**Intent**: The `resumed: true` body gains the total. No new exposure: this is the requesting
device's own score, returned to the id that owns it, on a path that already returns that device's own
name.

**Contract**: `total: lookup.total` on the resumed 200 body only. The claim path is untouched — a
fresh player's total is zero and saying so would be a second place the number is spelled.

#### 3. The view paints it, then retires it

**File**: `src/pages/quiz/index.astro`

**Intent**: Show what the attendee is returning with, under their name, on the resume path only.
Phrase it as a statement about the moment of resuming so it stays true however long it sits there,
and clear it the first time the result panel paints a fresh total — two scores on one screen, one of
them stale, is worse than no score at all. This is the affordance-vs-data-path trap `lessons.md`
opens with, met deliberately.

**Contract**: a new `<p id="resume-total">` inside the `follow` section beside `#player-name`,
written once from the resume response (`Wracasz z wynikiem N pkt`) and cleared wherever
`result-total` is set. Not written on a fresh join.

#### 4. A refusal the attendee can act on

**File**: `src/pages/quiz/index.astro`

**Intent**: When a claim is refused as `taken` and this device has no stored player, add a line
explaining that the device did not remember a previous player — private mode or cleared data — and
that they should pick a slightly different name to keep playing. The bare "name taken" is accurate
and useless in exactly the case where the attendee knows the name is theirs.

**Contract**: appended to the existing `join-error` region on a 409 from the claim path when
`readPlayer(config.storageKey)` is null. Copy is Polish and states the cost plainly — the earlier
score cannot be recovered.

#### 5. Tests

**Files**: `src/lib/session/store.test.ts`, `src/pages/api/quiz/join.test.ts`

**Intent**: Cover the total on the lookup and on the resumed response, including the zero case for a
player who has scored nothing — that case is the one a bare coercion gets wrong.

**Contract**: a resumed join for a player absent from the scores hash returns `total: 0` and is not
conflated with a read failure.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- The zero-total test fails when the explicit parse is replaced with a bare coercion of a missing
  field, and passes when restored

#### Manual Verification:

- Answer a scored question, reload mid-next-question, and confirm the returning line shows the score
- Confirm that line disappears once the next reveal paints a fresh total — never two scores at once
- On a fresh join, no returning line appears at all
- In a private tab, join, then reload: the form appears and the `taken` refusal explains itself

---

## Phase 5: Contract, documents, and the live check

### Overview

The slice's own pointer document and the standing documents that state rules this change moved.

### Changes Required:

#### 1. The contract

**File**: `context/changes/resilient-join/resume-contract.md` (new)

**Intent**: What the next slice must not undo. A pointer, not a summary — the join contract's own
warning is that a contract past a page has become a second copy of the plan, and a second copy can
disagree with it. S-10 is the reader.

**Contract**: covers, at minimum — the cap lives inside `CLAIM_PLAYER` and must stay there; the
resume path is exempt and why; the device id is client-minted, defeatable by design, and refused when
absent; `livequiz:devices` holds a count and nothing joinable; and the resumed total is a statement
about a moment, not a live figure.

#### 2. CLAUDE.md

**File**: `CLAUDE.md`

**Intent**: Record the new registered key and its third-family-style caveat in the session-data
section, the new browser storage key beside the other two, and the cap constant's home. State the
absent-`deviceId` refusal, since a future reader adding a client will otherwise discover it as a 400.

**Contract**: edits inside the "LiveQuiz session data" and "Client interactivity" sections. Do not
touch the generated `@przeprogramowani/10x-cli` block.

#### 3. Roadmap

**File**: `context/foundation/roadmap.md`

**Intent**: Mark S-09 `done` in the At-a-glance table, the slice block and the Backlog Handoff row,
and record the delivered threshold and the exemption so S-10 inherits a decision rather than a
question. Answer the slice's open unknown ("how many is unreasonable") in place — 3, cumulative,
never decremented.

**Contract**: the file's convention is to keep superseded text and mark it, not delete it.

#### 4. Runbook

**File**: `docs/runbook-live-session.md`

**Intent**: Add the two-device reload check to the pre-session steps. A failed deploy is silent in
this project and there is no CI, so a check that lives only in this plan will not be run again.

**Contract**: one step in the existing pre-session section — join on two devices, reload one
mid-question, confirm it comes back as the same player with its score.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Build succeeds: `bun run build` — the quiz definition gate runs at config load, so this also
  re-checks the definition

#### Manual Verification:

- A live two-device run against production: both devices join, one reloads mid-question and returns
  as the same player with its score, and a fourth claim from one browser is refused
- `docs/runbook-live-session.md` reads correctly end to end for a host who did not write it

---

## Testing Strategy

### Unit Tests

- `device.ts`: mints and persists on first load, returns the same id on the second, returns a usable
  id when storage throws.
- `store.ts`: the cap boundary (third claim succeeds, fourth is `capped`); a `taken` claim consumes
  no slot; a different device is unaffected; the capped refusal still carries the session document;
  the claim stays a single `eval`; `readPlayerById` returns a correct total, including `0`.
- `keys.ts`: the new names appear only there (existing scan covers this automatically).

### Integration Tests

- `join.test.ts`: a capped device resumes by `playerId` (the exemption); a claim with no `deviceId`
  is refused with a 400 and never reaches `claimPlayer`; a capped claim renders the Polish message;
  a resumed join carries the total.

### Manual Testing Steps

1. Join from a phone, answer a scored question, wait for the reveal, note the total.
2. Reload mid-next-question — confirm the same player, and the returning line showing that total.
3. Wait for the next reveal — confirm the returning line is gone and only the fresh total shows.
4. In one browser, claim four different names in a row — the fourth is refused as capped, with copy
   that does not suggest trying another name.
5. Reload that capped browser — it still resumes its existing player.
6. In a private tab: join, reload, and confirm the `taken` refusal explains itself.

## Performance Considerations

The claim goes from 6 to 9 billed Upstash commands. It runs ~150 times per session, paced by
attendees arriving rather than by any loop, so it is nowhere near the polling shape the runbook's
command tripwire watches for. `readPlayerById` gains one `HGET` inside a script it already runs once
per reload. Neither adds a round trip.

## Migration Notes

`livequiz:devices` is absent from any session document written before this deploy, which is harmless:
`HGET` on a missing key returns nil and the script reads it as zero, so an in-flight session simply
starts counting from the deploy. No document schema changes, so no `.default()` is needed and no host
action can 409 mid-segment.

The one real deploy consideration is a page cached from before this change: it sends no `deviceId`
and its claim is refused with the "refresh the page" message. That is why the refusal is a 400 with
recoverable copy rather than a silent pass. Deploying between sessions, as the runbook already
requires, avoids it entirely.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-09)
- PRD: `context/foundation/prd.md` (FR-009, FR-018, FR-007)
- Predecessor contract: `context/archive/2026-08-07-join-and-follow-host/join-contract.md`
- Retention rules: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Recurring rules: `context/foundation/lessons.md`
- The claim script: `src/lib/session/store.ts:244`
- The resume path: `src/pages/api/quiz/join.ts:66`, `src/lib/client/player.ts:53`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The device identity and the cap rule

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — ecd9d12
- [x] 1.2 Type checking passes: `bun run type-check` — ecd9d12
- [x] 1.3 `keys.test.ts` still passes — new `livequiz:` names appear only in `keys.ts` — ecd9d12
- [x] 1.4 `boundary.test.ts` still passes for `device.ts` — ecd9d12
- [x] 1.5 The broken-storage test is verified in both directions — ecd9d12

#### Manual

- [x] 1.6 Nothing user-visible changed — the join flow behaves as before — ecd9d12

### Phase 2: The claim script enforces the cap

#### Automated

- [x] 2.1 Unit tests pass: `bun run test` — 893575f
- [x] 2.2 Type checking passes: `bun run type-check` — 893575f
- [x] 2.3 The single-`eval` assertion in `store.test.ts` still passes — 893575f
- [x] 2.4 The cap boundary test fails with the `-3` branch removed, passes when restored — 893575f
- [x] 2.5 The "taken consumes no slot" test fails with the `HINCRBY` moved above the collision check — 893575f

#### Manual

- [x] 2.6 Nothing user-visible changed — no claim is capped yet — 893575f
      <br>Superseded at the gate: the route wiring moved into this phase, so claims *are* capped from
      here. Verified instead: joining still works from a fresh browser, and a fourth claim is refused
      with the Polish capped message.

### Phase 3: The route, and the resume exemption

#### Automated

- [x] 3.1 Unit tests pass: `bun run test` — 189f69a
- [x] 3.2 Type checking passes: `bun run type-check` — 189f69a
- [x] 3.3 `boundary.test.ts` passes for the new `<script>` usage — 189f69a
- [x] 3.4 The exemption test fails when the cap is applied to the `playerId` branch — 189f69a
- [x] 3.5 The absent-`deviceId` test fails when the guard is removed — 189f69a

#### Manual

- [x] 3.6 Joining from a fresh device works and lands inside the 30-second target — 189f69a
- [x] 3.7 A fourth claim is refused with copy that does not read as "try another name" — 189f69a
- [x] 3.8 A capped device still resumes its existing player on reload — 189f69a

### Phase 4: The phone — score-intact resume and a recoverable refusal

#### Automated

- [x] 4.1 Unit tests pass: `bun run test` — 523d157
- [x] 4.2 Type checking passes: `bun run type-check` — 523d157
- [x] 4.3 The zero-total test fails when the explicit parse becomes a bare coercion — 523d157
      <br>Substituted: the zero test could not fail, because `Number(false)` is `0` — it passed
      against the very coercion it was meant to catch. Verified instead with the corrupt-total test
      (`NaN` against `0`), which does fail when the parse is replaced.

#### Manual

- [x] 4.4 Reload mid-question shows the returning line with the correct score — 523d157
- [x] 4.5 The returning line disappears at the next reveal — never two scores at once — 523d157
- [x] 4.6 A fresh join shows no returning line — 523d157
- [x] 4.7 In a private tab, the `taken` refusal explains itself — 523d157

### Phase 5: Contract, documents, and the live check

#### Automated

- [x] 5.1 Unit tests pass: `bun run test` — 96e8c68
- [x] 5.2 Type checking passes: `bun run type-check` — 96e8c68
- [x] 5.3 Build succeeds: `bun run build` — 96e8c68

#### Manual

- [x] 5.4 Live two-device run against production: resume with score, and a capped fourth claim — 96e8c68
- [x] 5.5 `docs/runbook-live-session.md` reads correctly for a host who did not write it — 96e8c68
