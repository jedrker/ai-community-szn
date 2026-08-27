# Verification — per-quiz palette, mark and display voice

Measured with Playwright/Chromium at 1920×1080 (projector) and at 320×568 / 390×844 (phone).
Recorded here because three of the four phases turn on numbers rather than on opinion, and nothing
in this repository can see a rendered line.

## Phase 1 — the palette

Contrast, WCAG 2.x, floor 4.5:1. The themed palette clears it everywhere, with the worst pair at
**5.64:1**:

| Pair | Themed | Default (shipped) |
| --- | --- | --- |
| signwhite on ink | 17.64 | 18.01 |
| zinc on float | 6.71 | 4.96 |
| **pill-disabled on asphalt** | **5.64** | **2.22 — the recorded defect** |
| themed ink on unthemed chrome (the closing screen) | 13.52 | n/a |

So the themed quiz is *more* legible than the default one at the pair that was already failing.
The floor deliberately applies to themes only; a test asserts the default's 2.22:1 gap so nobody
reads the floor as a claim about the shipped palette.

Rendered output, checked live: the `:root` block appears on `/quiz/unaited` and
`/quiz/host/unaited`, is absent on the other two quizzes, and carries **none** of the eleven frozen
tokens. `html:has(body[data-phase="ended"])` and `data-[phase=ended]:bg-quiz-chrome` still resolve
to the global yellow on every quiz.

## Phase 2 — the mark

Container present on every quiz so `el("event-mark")` resolves; `<img>` present only for a theme
with a logo, which is what `applyShell` reads via `childElementCount`. Asset serves 200,
`image/svg+xml`, 2944 b. `event-mark` survives into the client bundle.

## Phase 4 — the display voice, and why it is narrow

Archivo is a variable face and both axes are live: the same string at weight 900 measures **314px
at 62%** and **583px at 125%**. So a display voice costs no new file, no request, and no licence.

**Where it may go is a fit question.** With the production address at 56px/800 against the lobby's
916px column:

| Line | Width | Verdict |
| --- | --- | --- |
| full address @100% | 1032px | overflows — the line already replaced once, for this reason |
| short address @100% | 885px | fits, **31px of slack** |
| short address @110% | 963px | overflows by 47px |
| short address @125% | 1079px | overflows by 163px |

**So the treatment does not touch the join address**, and 31px of slack on the line the room
retypes is worth knowing about on its own. It goes on the two lobby labels (eleven characters, ample
room) and on the phone's wordmark and join headline, where the page is fluid and nothing was
measured against a column.

Confirmed live:

| Surface | Display rule | Computed |
| --- | --- | --- |
| `/wydarzenia`, `/` | absent | — |
| `/quiz/unaited`, `/quiz/host/unaited` | present | 900 / 125% |
| `/quiz/host/summer-tour-szczecin` | absent | 600 / 100% (class inert) |

The lobby's address renders at **100%**, i.e. untreated. Artboard overflow: **false**. Phone at
320×568: no horizontal overflow. **Font requests are the same two Archivo files on every surface,
including the marketing pages** — 4.6 holds by construction rather than by care.

## Re-measured after the font fix

Every figure above was first taken while `ą ę ł ż` still fell back to a system face (see
`context/changes/archivo-font-token/verification.md`), so the widths were a blend of two typefaces
and had to be retaken once Archivo carried the glyphs.

Retaken, all conclusions unchanged:

| Measurement | Before the font fix | After |
| --- | --- | --- |
| choice questions overflowing the stage | 0 of 25 | **0 of 25** |
| worst prompt-plus-options height | 576px of 768px | **576px of 768px** |
| `Wejdź na` @125% in a 916px column | — | **212px** (168px at 100%) |
| `Pełny adres` @125% | — | **286px** (227px at 100%) |
| join address @100% | 885px | **885px**, 31px of slack |

The join address is still measured at `100%`, which is the check that matters: it confirms the
display voice does not reach it.

## Not covered

- **The venue read.** Every figure above says text fits its box. None says it is legible from the
  back of a room, and that step was left open by the signage redesign too.
- **Layout on the marketing pages** after the Archivo fix (`archivo-font-token`): they change
  typeface as well, and line-length there wants an eye rather than a number.
- **A themed reveal end to end.** The carriers are covered executably in `happy-dom`; a real
  session on a projector is where the beat itself gets watched.
