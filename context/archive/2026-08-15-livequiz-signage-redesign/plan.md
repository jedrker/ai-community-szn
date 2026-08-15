# Plan — LiveQuiz signage redesign

Read `change.md` first. This plan is self-contained: every colour, size and layout rule
is written down here, so you do not need the Paper file open to execute it.

---

## 0. Facts to establish before touching anything

Four things about this codebase decide the shape of the whole change. Verify each once,
at the start — they are cheap to check and expensive to discover halfway through.

1. **`render.ts` does not own any styling.** Every class name it applies arrives as a
   parameter from the calling page (`optionClassName`, and the `classNames` objects in
   `renderQuestion` / `renderDistribution` / `renderStandings` / `renderWordCloud`). So
   the redesign is overwhelmingly **class-string edits in `src/pages/quiz/host.astro` and
   `src/pages/quiz/index.astro`**, not a rewrite of the renderer.
   → `grep -n 'classNames\.' src/lib/client/render.ts`

2. **`src/lib/client/render.test.ts` asserts some of those class names.** Changing a
   class string that a test names will fail the suite. That is the tripwire working, not
   a problem — update the expectation in the same commit.
   → `grep -n 'class' src/lib/client/render.test.ts`

3. **The site palette is site-wide.** `src/styles/global.css` `@theme` defines
   `--color-brand-purple*`, `--color-surface-*`, `--color-text-*`, and `/wydarzenia`,
   `/prelegenci`, `/` and `/zglos-sie` all render from them. **Do not repoint those
   tokens** — that restyles the whole community site. Step 1 says how to scope instead.

4. **Word-cloud chip type size is set inline by `render.ts`, not by class** (see the
   comment at `chip` in `renderWordCloud`). Do not try to move it into a class.

---

## 1. The design system

### Palette

| Token | Hex | Role — and the rule that goes with it |
| --- | --- | --- |
| `ink` | `#0B0B0C` | The ground. Both views, every phase except the closing screen. |
| `asphalt` | `#141416` | Second plane: answer bands, the control bar, input fields. |
| `float` | `#1B1B1F` | Message-bubble surface only — reads as a layer above the ground. |
| `signwhite` | `#F5F5F2` | Primary text. |
| `zinc` | `#8A8A87` | **Labels only.** Never body copy, never a message. |
| `chrome` | `#FFD400` | Primary accent. **One intense moment per screen.** |
| `mint` | `#3DDC84` | Correct answer / correct verdict. Nothing else. |
| `signal` | `#E5342A` | Refusal or failure. Nothing else. |

Hairlines and tints, all derived from the above — use these exact values:

| Value | Where |
| --- | --- |
| `#26262A` | Dividers: top-strip bottom border, rail left border, control-bar top border, countdown track. |
| `#2A2A2E` | Inactive letter slab; disabled control-pill border. |
| `#33333A` | Input field border; bubble border when the bubble sits on `asphalt`. |
| `#3A3A40` | Enabled-but-not-primary control pill border. |
| `#4E4E52` | Disabled control-pill label. |
| `#C9C9C4` | The one step between `signwhite` and `zinc` — echo lines, non-correct answer text at reveal. |
| `#231F05` | Chrome-selected row fill (phone option, own standings row). |
| `#13211B` | Mint box fill (accepted answer, correct row). |
| `#1C1905` / `#6B5A00` / `#E8D26A` | Locked own-pick: fill / slab / letter. |
| `#7A6300` | Ink-on-chrome secondary text — **closing screen only**, where chrome is the ground. |

**Pairings that are decisions, not preferences.** Chrome is the accent everywhere except
the closing screen, where it becomes the ground and ink becomes the type — that inversion
is the visual signal that the session ended, and it only works because chrome was rationed
up to that point. Mint and signal never appear together on one screen.

### Type — Archivo (already loaded, variable 100–900)

Projector (1920×1080):

| Role | Size / line-height | Weight | Tracking |
| --- | --- | --- | --- |
| Prompt | 92 / 92 | 800 | −0.035em |
| Prompt, 3-line question | 72 / 74 | 800 | −0.035em |
| Answer band text | 50 / 58 | 600 | −0.02em |
| Band letter (slab 92×92) | 48 | 800 | −0.02em |
| Hero metric | 176 / 164 | 800 | −0.05em |
| Second metric (countdown, %) | 140 / 132 → 116 / 112 with a label above | 800 | −0.05em |
| Winner name (closing) | 224 / 212 | 800 | −0.055em |
| Standings row 1 / rows 2–5 | 104 / 112 · 72 / 88 | 800 / 600 | −0.035em |
| Label | 26 | 600 | **0.16em, uppercase** |
| Control pill | 40 | 700 primary / 600 other | −0.01em |
| Bubble copy | 40 / 52 | 600 | −0.015em |

Phone (390×844):

| Role | Size / line-height | Weight |
| --- | --- | --- |
| Headline (join, lobby, ranking) | 44 / 46 | 800 |
| Question prompt with options below | 36 / 38 | 800 |
| Option row text (row 64px, slab 56×64) | 26 / 32 | 600 |
| Option letter | 24 | 800 |
| Verdict | 56 / 58 | 800 |
| Award | 72 / 76 | 800 |
| Echo line | 30 / 38 | 600 |
| Total line | 28 / 36 | 600 |
| Note above submit | 22 / 28 | 600 |
| Countdown seconds | 34 / 34 | 800 |
| Field text / placeholder | 30 / 36 | 600 |
| Submit | 27–32 | 700 |
| Label | 20, **0.14em uppercase** | 600 |

**Nothing below 20px on the phone and nothing below 26px on the projector.** If something
does not fit, cut words or drop a line — do not go smaller.

### Radii and geometry

`20px` projector bands and bubbles · `18px` phone fields, rows and buttons · `16px` phone
bubbles · `999px` control pills and countdown tracks · countdown track `14px` projector /
`8px` phone.

---

## 2. Layout skeletons

### Projector — every phase except lobby and closing

```
Top strip      padding 56/72/40/72, border-bottom 2px #26262A
               left: "04" chrome 96px + "/ 14" zinc 48px
               right: "WEJDŹ" label + the join URL 56px 800
Body (row, flex-grow)
  Stage  flex-grow, padding 48/72/40/72, column, justify-content: space-between
  Rail   width 440, flex-shrink 0, padding 48/72/40/56, border-left 2px #26262A
         column, justify-content: space-between
Control bar    flex-shrink 0, asphalt, border-top 2px #26262A, padding 32/72
               left: three pills in FIXED order · right: phase label
```

The rail carries at most **two** blocks: the room's participation on top, and the clock
(open) or the correctness figure (revealed) at the bottom. Never three.

**Lobby** replaces the whole body with a two-plate split: a `signwhite` plate 860px wide
holding a 700px QR at 80px padding, and the ink plate with the URL (56px, chrome) and the
joined count (264 / 244, 800). **Closing** drops the rail and inverts to a chrome ground.

### Phone

```
Status bar (paste from get_guide "mobile-status-bar" — do not hand-draw)
Body  column, flex-grow, padding 20-24 / 28 / 24-32 / 28
      order: label → prompt → countdown → options/field → note → submit
```

Waiting screens (lobby, purged session) use `justify-content: space-between` so the
status line sits in the thumb zone; answering screens stack from the top.

---

## 3. Components with a rule attached

**Answer band (projector).** Row, `asphalt`, radius 20, `overflow: hidden`; a
`92×92` chrome slab with the ink letter, then the text. At reveal: correct band gets a
mint slab and `#13211B` fill with mint text; the rest keep `asphalt` with `#2A2A2E` slabs
and `#C9C9C4` text; the share percentage sits at the right end (52px, 800), mint on the
correct row and `zinc` elsewhere.

**Multiple choice is visually distinct from single choice, and that is load-bearing.**
Its slabs are `80×80` **outlined** (4px chrome border, no fill, chrome letter), and a
chrome label sits under the prompt: `MOŻESZ WYBRAĆ WIĘCEJ NIŻ JEDNĄ`. An empty square
means "more than one is allowed"; a filled one means "pick one".

**Control bar.** Three pills, **always the same three verbs in the same order**, exactly
one filled chrome — the next legal step. Others: 2px `#3A3A40` border with `signwhite`
label when enabled, 2px `#26262A` with `#4E4E52` label when not. **This must be driven by
the existing `CONTROL_RULES` table and its single reader `syncControls`** — `host.test.ts`
fails the suite if the table gains a second reader, and the "which one is ringed" bit is
already in that table. On `ended`, the pills are replaced by one sentence.

**Message bubble.** Row: an 8–10px marker bar, then the copy. Marker colour is the whole
message-register system:

| Marker | Means | Examples from the code |
| --- | --- | --- |
| `mint` | It happened. | `odświeżono`, `dalej: OK` |
| `#3A3A40` | In flight. | `…` → render as `Wysyłam…` |
| `chrome` | Nothing broke; you must decide. | `applied:false` no-op, `kliknij ponownie, aby zakończyć sesję` |
| `signal` | Refused or not delivered. | 401, 502, `Nie udało się wysłać…` |

**The bubble docks as the first row *inside* the control bar, never as an overlay.** An
overlaid bubble covers an answer option while the room is reading it — this was tried and
rejected. The bar grows, the stage shrinks by the same amount.

**Countdown.** Projector: label, `12 s` at 116/112 chrome, 312×14 track. Phone: label left
and seconds right on one baseline, 8px track under. **The number and the bar are one
component and must never disagree** — that is `renderCountdown`'s existing contract. Under
5 s the phone switches the number and fill to `signal`.
**No countdown on an unscored question** (word cloud, warm-up) and none after reveal.

---

## 4. Screen inventory

Each artboard maps to a phase the code already has. Projector: lobby · question open
(single / multiple / word cloud) · revealed (choice / text / number) · standings · ended ·
message bubbles (spec sheet) · bubble in context. Phone: join · join refused (taken /
device cap / private-mode) · lobby · resume · question open (choice / number / word) ·
answer locked · time up · reveal (correct / number partial / no answer) · standings ·
ended · degraded · connection lost · send failed · purged session.

**The failure and edge states are the half that matters.** They are the states a room
actually hits, and they are the ones missing from the current views' visual language.

---

## 5. Steps

Each step is a commit and ends with a check. Work top to bottom: the shell steps make the
later ones mechanical.

### Step 1 — Scope the palette (do not repoint the site tokens)

Add the signage tokens to `src/styles/global.css` under `@theme` with a **`quiz-` prefix**
(`--color-quiz-ink`, `--color-quiz-chrome`, …) so Tailwind generates `bg-quiz-ink`,
`text-quiz-chrome`, etc., and the existing `brand-purple` / `surface-*` / `text-*` tokens
keep serving the rest of the site untouched.

Do **not** introduce a second `@theme` block, a `:root` override on the quiz pages, or a
`data-theme` attribute. A prefix is boring and it makes every quiz class name self-evident
in a diff.

**Check:** `bun run build`, then confirm `/wydarzenia` and `/` render unchanged.

### Step 2 — Projector shell

`src/pages/quiz/host.astro` markup only: top strip, body split (stage + 440 rail), control
bar. Move the join QR and URL into the top strip; drop the standalone `Faza` / `Wersja`
metrics (phase becomes the control-bar label; version stays in the DOM for the host secret
flow but leaves the visual hierarchy). Keep every `id` and `data-` hook exactly as it is —
`syncControls`, `syncEndButton`, the poll and the countdown all query them.

**Check:** `bun run type-check`; load `/quiz/host` and confirm the panel still drives a
session end to end.

### Step 3 — Projector question kinds

The `renderQuestion` / `renderDistribution` / `renderWordCloud` class payloads in
`host.astro`: bands, slabs, the multiple-choice outline treatment and its label, the
accepted-answer box, the share percentages, the word chips. Then the countdown block.

**Check:** `bun run test` (expect `render.test.ts` expectations to need updating), and
walk all five kinds through `spine-check.astro`.

### Step 4 — Projector lobby, standings, closing

Lobby's two-plate split; the standings board (row 1 as a full chrome bar, rows 2–5 on
hairlines); the closing screen's chrome-ground inversion with the winner at 224px and
places 2–5 as four fixed-width lanes.

**Check:** the closing screen must still key its board on `standings !== null`, not on a
phase list — the schema owns that rule.

### Step 5 — Bubbles on the projector

Build the bubble as markup inside the control bar, hidden by default.

### Step 6 — `say()` gets a third register

`say(text, bad)` is binary today, so `applied:false` ("nic do zrobienia") and the
end-session arming prompt both render as success-green. Widen it to a register:

```ts
type Register = "ok" | "pending" | "attention" | "refused";
function say(text: string, register: Register): void
```

Then map the existing call sites: `odświeżono` / `${action}: OK` → `ok`; the in-flight
`…` → `pending`; `applied:false` and the two-tap arming line → `attention`; 401, 502,
non-ok and the network catch → `refused`.

**This is the only behavioural change in the whole redesign.** Keep it in its own commit
so it can be reverted without taking the styling with it.

### Step 7 — Attendee shell, join and waiting states

`src/pages/quiz/index.astro`: the join form, the refusal bubble, lobby, resume line, purged
session. **`#display-name`, `#answer-text`, `#answer-number`, `#answer-word` must stay
static elements that are shown and hidden** — never something a renderer emits — and their
`maxlength` values must keep reaching the markup through frontmatter, not through a
`<script>` block.

### Step 8 — Attendee question kinds, countdown, locked and time-up

Option rows, the compact countdown, the disabled-submit state (the word field's gate is
"non-empty and no internal whitespace" — show it), locked, and `Czas minął…`.

### Step 9 — Attendee reveal, standings, ended

The verdict/award/echo/total panel. **Branch on question kind before `correct`** — a
kind-blind branch prints "Tym razem nie." next to a positive award on a number question.
Three verdict colours: mint correct, chrome partial ("Blisko!"), zinc for "Bez odpowiedzi".

### Step 10 — Attendee failure states

Degraded banner (chrome), connection lost (signal, answer controls hidden), send failure
(signal, submit stays enabled).

### Step 11 — Verify

- `bun run type-check` → 0 errors
- `bun run test` → all green
- `bun run build`
- A two-device run through `/quiz/host` + `/quiz` covering: join → lobby → each of the
  five kinds → reveal → standings → end.
- **Read the projector from the back of the actual room** if you can get into the venue.
  Every size in this plan was chosen for that and validated only on a screenshot.

---

## 6. Guardrails — breaking any of these is a defect, not a style choice

- **`src/lib/client/boundary.test.ts`**: no client module and no `<script>` block in
  `src/pages/quiz/*.astro` may read `import.meta.env` or *value*-import from `src/quiz/`
  or `src/lib/session/`. `import type` is fine. Frontmatter is exempt and is how values
  reach the markup.
- **`src/pages/quiz/host.test.ts`**: one polling loop, one fetch site, one reader of
  `CONTROL_RULES`, and exactly one timer whose callback can reach a `fetch`. The redesign
  adds no timer and no fetch — if you find yourself wanting one, stop.
- **No UI framework.** Vanilla modules and `define:vars`. This was decided deliberately.
- **Nothing polled may write.** Unchanged by this work, but do not add a "save layout
  preference" call on a polled path.
- **Names never enter a published snapshot**, and `LogFields` stays closed — no display
  name or answer may reach `logSessionEvent`.
- All user-facing copy stays Polish and **verbatim as the code already writes it**. The
  one string this redesign shortens deliberately is the degraded banner (three lines on a
  phone); if you keep the full sentence, budget the height for it.

---

## 7. Open questions to settle while implementing

1. **`www.` in the join URL.** The artboards print `ai-community.szczecin.pl/quiz`, but
   `host.astro` renders `attendeeUrl.host`, which may include `www.`. Either strip it for
   display or accept ~4 characters of extra width and drop the type size a step. The QR
   must keep encoding the full canonical URL either way.
2. **Bubble dwell time.** The design assumes `ok` and `pending` fade on their own while
   `attention` and `refused` persist until the next action. Nothing in the code does this
   today; decide before step 6 whether it is in scope.
3. **The redesign does not cover `spine-check.astro`.** It stays as it is — a harness page
   behind `LIVEQUIZ_HARNESS`, not a room-facing view.
