# Verification — Archivo font token

The edit is one line. Everything worth recording is the measurement, because this fix changes the
typeface of every surface in the project at once and the artboard it lands on has
`overflow-hidden` and no scrollbar.

## The defect, measured rather than reasoned

Playwright, Chromium, 1920×1080, reading `getComputedStyle(document.body).fontFamily` and
`document.fonts.check()` on four surfaces, before and after the rename:

| Surface | Before | After |
| --- | --- | --- |
| `/quiz/host/unaited` | `ui-sans-serif, system-ui, …` — Archivo **not loaded** | `Archivo, sans-serif` — loaded |
| `/quiz/unaited` | same | `Archivo, sans-serif` — loaded |
| `/` | same | `Archivo, sans-serif` — loaded |
| `/wydarzenia` | same | `Archivo, sans-serif` — loaded |

`document.fonts.check()` reported **false** before the fix: nothing referenced the family, so the
browser never fetched either `.woff2`. The files were being served to nobody.

Built CSS, before → after:

- `.font-archivo` rule: **absent** → `.font-archivo{font-family:var(--font-archivo)}`
- `--font-archivo` in `:root`: absent → `"Archivo", sans-serif`
- `font-family:Archivo` occurrences: 2 (the two `@font-face` blocks, referenced by nothing) → 2
  (now reached through the variable)

## Does Archivo still fit the artboard?

This was the real risk. Every projector size was measured *for* Archivo
(`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:70-107`, and the in-code notes
naming "56px Archivo 800" and "92px Archivo"), and `promptClass` steps down by **character count**
against those measurements — but production had never rendered in Archivo, so the thresholds had
never been tested against the font they were written for.

**Archivo is wider than the fallback.** Measured over all 36 committed prompts at the size
`promptClass` picks for each:

- 34 prompts: same line count
- 2 prompts: one line more in Archivo (a 95-character prompt at 60px, 2→3 lines; a 30-character
  prompt at 92px, 1→2 lines)
- 0 prompts: fewer lines

Both gains are *within* the design's stated expectations — the in-code note says "92px Archivo at
weight 800 averages close to 26 characters a line", so a 30-character prompt is meant to be two
lines. The fix moves rendering toward the spec, not away from it.

**Nothing overflows.** Prompt plus option list, measured for all 25 committed choice questions at
the stage's documented 1336px width against its measured 768px height:

- would overflow with Archivo: **0 of 25**
- worst case: 576px used of 768px available — 192px of headroom
- the same worst case in the fallback font: 484px

The first measurement pass used the sessionless stage width (1920px, the rail hidden) and was
therefore optimistic; the numbers above are the re-run at 1336px.

## Guard

`src/styles/tokens.test.ts`, verified in three directions — each break run, observed, reverted:

| Break | Fails with |
| --- | --- |
| Restore `--font-family-archivo` | *"these tokens would generate `.font-family-*` utilities nothing asks for: family-archivo"* |
| A page asks for `font-nineties` | *"these classes name a font family global.css does not declare: font-nineties (pages/quiz/host/index.astro)"* |
| Delete the token | *"global.css declares no custom font family"*, plus a report naming all five files that ask for `font-archivo` |

That third report is the one that would have surfaced the original defect.

## Not covered

- **The venue read.** Archivo now actually renders, at sizes chosen for it, on a screen nobody has
  read from the back of the room — the step the signage redesign also left open. The measurements
  above say the text fits the box; they say nothing about whether it is legible at distance.
- **Marketing pages.** They change typeface too, and no measurement here covers their layout. They
  are fluid rather than fixed-artboard, so clipping is not the risk; word-wrap and line-length are,
  and those want an eye rather than a number.
