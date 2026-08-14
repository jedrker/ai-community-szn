# Resilient Join — Plan Brief

> Full plan: `context/changes/resilient-join/plan.md`

## What & Why

Roadmap S-09 closes the last must-have gap in the live loop: an attendee whose screen locks or who
reloads mid-question must come back as the same player with their score (FR-009), and one device must
not be able to register an unreasonable number of players (FR-018). A screen lock inside a
fifteen-minute segment is near-certain, so this is not optional polish — without it, a locked handset
eliminates someone from the leaderboard.

## Starting Point

Resume is roughly 80% built already. S-02 shipped the identity handshake (`PLAYER_STORAGE_KEY`, the
`playerId` branch of `/api/quiz/join`, and `readPlayerById`'s three-way `found`/`not-found`/`failed`
split that stops a store blip from destroying a device's identity); S-03 added persisted paint times,
the `submitted` flag and the submitted text per question. The score already lives server-side in
`livequiz:scores` keyed by player id, so it survives a reload by construction. **The per-device cap,
by contrast, does not exist at all** — nothing counts joins per device, and IP-keyed throttling was
explicitly rejected in S-02 planning because a venue network puts many attendees behind one address.

## Desired End State

A device may register at most three players; the fourth claim is refused with a Polish message that
does not invite a doomed retry. That guard never touches the resume path — a capped device that
reloads still comes back as its existing player, with its score. An attendee who reloads mid-question
sees, under their name, what they are returning with. An attendee whose device could not remember
them is told what happened instead of meeting a bare "name taken".

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| Device identity | Client-minted UUID in `localStorage` | Lightweight and non-invasive; FR-018 explicitly accepts a defeatable guard, so a cookie or a fingerprint would buy durability against a threat model the PRD isn't defending |
| Threshold | 3, cumulative, never decremented | Covers the honest shared-handset cases while making farming tedious; matches FR-018's wording ("registering an unreasonable number") and is one `HINCRBY` |
| Trip behaviour | Refuse new claims; resume always exempt | A guard that can refuse a resume turns anti-farming into elimination — the exact failure FR-009 exists to prevent |
| Absent `deviceId` | Refused (400, "refresh the page") | `lessons.md`: absent input must fail toward the safe end. A shared "unknown device" bucket would let a few private-mode attendees eat the room's allowance |
| Cap check position | After the phase checks, before the collision check | Capped *and* taken must say "capped" — "name taken" invites three more doomed attempts |
| Server-side storage | `livequiz:devices`: device id → integer count | Holds a count and nothing joinable to a person, so it's the weakest thing that can enforce the cap; registered, so `end` and `purge` reach it |
| Score on resume | Carried on the resume response, shown once, then retired | Makes "score intact" visible rather than asserted, without the stale-affordance defect `lessons.md` opens with |
| Verification | Store/route tests + a live two-device check | The S-02 defect in `lessons.md` was green in tests and surfaced only in a live two-device run; this path is the same shape |

## Scope

**In scope:** the per-device cap end to end (constant, key, Lua guard, route, client id); the resume
exemption as a tested property; the running total on the resume response and on screen; a `taken`
refusal that explains itself when the device has no stored player; the contract, CLAUDE.md, roadmap
and runbook updates.

**Out of scope:** IP throttling · cookies or fingerprinting · making the cap undefeatable · releasing
a cap slot · recovering a player whose device forgot its id · a permanently-visible running total ·
a `rehearse-room.ts` scenario · any `SessionState` field · S-10.

## Architecture / Approach

The cap lands where the claim already is — inside the single `CLAIM_PLAYER` `EVAL` that owns the
join's atomicity — as one more guard, one `HINCRBY` and one `EXPIRE`. A check outside that script is
a check against a count that can change before the write lands, and the join contract forbids moving
any part of the claim into TypeScript. The device id is minted on the phone by a new
`src/lib/client/device.ts` and travels as a form field, so no server-side identity system appears.
The resume path is left structurally untouched and gains only a number on its way out; `deviceId` is
sent on the claim request and *not* on the resume request, which is what makes the exemption visible
in the source rather than merely true.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Device identity and the cap rule | The threshold, two registered names, the client id module | The mint must never return an empty string — the route refuses that |
| 2. The claim script enforces it | Cap check, increment and TTL inside the one `EVAL` | Increment placement: above the collision check, a device is charged for names it never got |
| 3. The route and the resume exemption | `deviceId` wired in, `capped` rendered, resume exempt | The exemption is a property a future edit can reverse with every other test still green |
| 4. The phone | Score on resume, painted then retired; a refusal that explains itself | Two totals on screen at once, one stale — the affordance/data-path trap |
| 5. Contract and documents | `resume-contract.md`, CLAUDE.md, roadmap, runbook | The manual check gets skipped unless the runbook names it |

**Prerequisites:** S-02 (delivered). No blockers; the threshold question the roadmap flagged is
answered above.
**Estimated effort:** ~2 sessions across 5 phases; phases 1–3 are the bulk, 4–5 are short.

## Open Risks & Assumptions

- **A page cached from before this deploy sends no `deviceId` and is refused.** Mitigated by making
  it a 400 with recoverable copy rather than a silent pass, and by deploying between sessions as the
  runbook already requires.
- **A genuinely shared handset in a group of four is refused.** Accepted: the PRD names this cost
  explicitly, and the guard is defeatable by clearing storage anyway.
- **A device with storage disabled is never capped** (it mints a fresh id per load) and cannot resume
  at all. Accepted — FR-018's defeatability is stated, and Phase 4 makes the resume failure
  explicable rather than silent.
- **The claim goes from 6 to 9 billed Upstash commands.** Paced by attendees arriving, ~150 per
  session, so nowhere near the polling shape the command tripwire watches.

## Success Criteria (Summary)

- An attendee who reloads or unlocks their phone mid-segment comes back as the same player and can
  see the score they returned with.
- A fourth claim from one browser is refused, and that same browser still resumes its existing player.
- An attendee whose device forgot them gets an explanation and a way to keep playing, not a bare
  "name taken".
