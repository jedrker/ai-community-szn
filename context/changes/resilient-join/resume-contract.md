# Resume and device-cap contract (S-09)

Fifth after `spine-contract.md` (F-02), `retention-contract.md` (F-03), `join-contract.md` (S-02) and
`leaderboard-contract.md` (S-07), and it inherits their warning: **a contract that grows past a page
has become a second copy of the plan, and a second copy can disagree with it.** A pointer, not a
summary.

Read before S-10 adds a phase, a key, or anything that refuses a request.

## The exemption is the whole slice

FR-018 wants the device counted; FR-009 wants it remembered. **The cap governs the claim path and
never the resume path.** `/api/quiz/join`'s `playerId` branch does not consult the cap and does not
read the device id at all — which is why that read sits *below* it rather than at the top of the
handler, where a reader tidying up would naturally move it.

Applied to a resume, the cap stops being anti-farming and starts eliminating players: a phone that
legitimately registered three and then locked its screen would be refused on the way back and lose a
score it had already earned. `join.test.ts` names the property, and its fixture sends **no** device
id — because that is what a resume actually sends, so it fails on the specific edit most likely to
break it.

## The cap is inside `CLAIM_PLAYER` and stays there

Third guard in that script, for the reason the other two are there: a count read from TypeScript can
change before the write lands. **Do not move any part of it out.** `store.test.ts` still asserts a
single `eval`.

Two orderings carry the behaviour and both are silent when wrong:

- **Cap check before the collision check.** After it, a device that is capped *and* typing a taken
  name is told the name is taken, and works through three names learning nothing.
- **Increment after it.** Before it, a claim refused as taken still charges the device, so three
  collisions with common first names cap someone who never held a player.

**What no test in this project can see:** the redis client is mocked, so the Lua never executes. The
orderings are pinned as structural properties of the script text — `host.test.ts`'s position, and for
the same reason. The behaviour itself rests on the live check in the runbook.

## The device id, and the absent case

Client-minted, opaque, `localStorage`, declared as `DEVICE_STORAGE_KEY`. No cookie and no
fingerprint: clearing site data or opening a private tab is a new device, and FR-018 says that is the
design rather than a hole.

**`device.ts` always returns an id**, unlike `player.ts`, which reports storage failure as "no stored
player". That asymmetry is load-bearing: **the route refuses a claim carrying no device id.** Letting
it through is the cap's bypass; bucketing every id-less device into one shared counter is worse, as a
handful of private-mode attendees would then consume the room's whole allowance. Refusing is safe
only because our own client always sends one — a memory-minted id when storage is unavailable.

The refusal is a 400 with "reload the page", because the one honest way to reach it is a page cached
from before this shipped.

## `livequiz:devices` holds a count and nothing else

Registered, so `end` re-arms it and `purge` deletes it. Device id → integer. No name, no player id,
nothing joinable to a person. The counter **only goes up** — there is no "abandon a player" action to
release a slot against, and a releasable slot could be cycled indefinitely, which is the guard
defeated by a mechanism built to be forgiving.

`DEVICE_STORAGE_KEY` is the third browser-storage name no purge reaches — compliant on the same
reasoning as the other two, and **it is deliberately not cleared when a stale player is dropped**.
`clearPlayer` and `clearSeen` run on that path because their data belonged to a session that is gone;
this belongs to the device, and clearing it would hand a fresh allowance to anyone who reloads after
a purge.

## Two 409s, so the client needs a discriminator

`taken` and `capped` are both 409 and the device does different things with them, so both carry a
`refusal` class beside the human string. Without it, the storage-stranded copy — shown when a `taken`
lands on a device holding no player — would also greet a capped attendee and tell them their storage
had failed.

## The resumed total is a statement about a moment, not a live score

`Wracasz z wynikiem N pkt`, painted once from the resume response and retired by `paintTotal` the
first time a fresher number reaches the result panel. **Do not promote it to a standing score line.**
Nothing refreshes it between reveals, so a permanent version would sit stale through a whole question
— the affordance-vs-data-path defect `lessons.md` opens with — and would put two different scores on
one screen.

Absent from the scores hash is `0`, not a failure: `HINCRBY` only writes when something was awarded,
so every player is absent until their first scoring answer. A **corrupt** entry is also `0` here,
unlike on the leaderboard where `null` means "could not say" — this number is one device's own
reassurance and has no such rendering.

## Scope boundary

Not here: recovering a player whose device forgot its id (there is nothing left to present) · making
the cap undefeatable · IP throttling · a room-scale rehearsal of either half · the winner reveal
(S-10).

## Pointers

`spine-contract.md` · `retention-contract.md` · `join-contract.md` (the predecessor; it named both
halves as S-09's) · `leaderboard-contract.md` · `docs/runbook-live-session.md` (the live two-device
check that covers what the mocked suite cannot)
