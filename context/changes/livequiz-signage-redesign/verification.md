# Verification — LiveQuiz signage redesign (plan step 11)

Run 2026-08-15, against the dev server and the real Upstash and Ably credentials in `.env`.

## The three commands

| Command | Result |
| --- | --- |
| `bun run type-check` | 0 errors (105 files) |
| `bun run test` | 1286 passed, 36 files |
| `bun run build` | clean |

## The two-device run

Driven through **both views' own UIs** over CDP — two real pages, a 1920×1080 projector and
a 390×844 phone — rather than over HTTP. That distinction is the point of this pass: every
earlier rehearsal in this change drove the host with `curl`, which never touches `fire`,
`syncControls`, `syncEndButton` or the two-tap close. Here the secret was typed into the
field, every flow verb was clicked, the attendee joined through the join form, and each
answer was typed or tapped on the phone.

Covered: join → lobby → word cloud → multiple choice → single choice → text → number →
standings → end. Both screens were read at every beat.

What it confirmed, beyond "it renders":

- **The panel offers exactly what the phase accepts.** The ringed next step tracked
  `start → advance → reveal → advance …`, and the enabled set matched `CONTROL_RULES` at
  every phase (`advance`+`reveal` while open, `advance`+`standings` at a reveal, nothing at
  all in `ended`).
- **The close needs two taps.** The first rewrote the label to `na pewno? kliknij ponownie`,
  the second fired; the panel then disabled every verb and replaced the row with its
  sentence.
- **Every kind scored the way its reveal reads.** `Dobrze! +968`, and on the number question
  `Blisko! +776` — `correct: false` with a positive award, in chrome rather than as a miss.
  The two unscored kinds got their own lines rather than the warm-up copy.
- **No page exception in either view** across the whole segment.

## Bugs this change found and fixed

Both were pre-existing and both surfaced only because a screen was actually looked at.

1. **The expired-question screen crashed the phone's render** (`d4d14bd`), since S-11.
   `stopCountdown` cleared the `timeUp` latch that `paintCountdown` guarded on, so
   `render → paint → render` recursed until the stack blew and left the attendee on a blank
   screen until the host advanced.
2. **A reload lost this device's own pick** (`76ea6f5`). The selection lived only in memory,
   so an attendee who answered and refreshed reached the reveal with the answer marked and
   nothing saying which option had been theirs.

## Not covered here

- **The read from the back of the venue.** Every size in the plan was chosen for that and is
  still validated only on a screenshot. This is the one row of step 11 that cannot be done
  from a laptop.
- **A second real phone.** One attendee played; the standings and the per-device highlight
  were exercised with one row of real data plus seeded players, not with a room.
- **The rail's correctness figure at a reveal.** The plan's §2 sketch puts a figure at the
  foot of the rail in `question-revealed`; no step commissions one and none exists in the
  code, so the rail is empty there. Left open deliberately rather than invented.
- **`spine-check.astro`** is unchanged, per the plan's §7.

## Note on the dev store

The rehearsals in this change ran `start … end … purge` against the shared dev Upstash
store, and one early run purged two player records left over from an earlier manual test.
The store is empty as of this run.
