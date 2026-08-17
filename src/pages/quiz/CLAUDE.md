# src/pages/quiz/ — the host panel and the attendee view

`host/[slug].astro` is the projector-and-host view, `[slug].astro` the attendee's phone — **one
address per quiz** (multiple-quizzes). Both are on-demand routes whose inline `<script>` blocks are
bound by the client boundary (see `src/lib/client/CLAUDE.md`) and guarded only by structural source
scans — an Astro inline script has no harness, so anything worth testing gets extracted into
`src/lib/client/` instead.

**Both are pinned in `.prettierignore`, and the pin is part of the guard.** Those scans assert the
inline scripts as literal text, so re-wrapping a line does not merely fail an assertion — it can
silently disarm one. When these files moved, the stale entries un-pinned them long enough for a reflow
to break eight of them. The entries escape the brackets (`\[slug\]`), because `.prettierignore` reads
gitignore glob syntax where a bare `[slug]` is a character class. Move a page, move its entry, and
check with `npx prettier --check` on the new path.

Three more routes sit around them, and none carries an inline script:

| Route | What it is |
| --- | --- |
| `/quiz/host` (`host/index.astro`) | the host's picker — every committed quiz by title, with its join code. No session read, no secret. `host` is a **static** path segment, so no quiz slug can collide with it: no reserved words, no dependence on route priority |
| `/quiz` (`index.astro`) | reads the session and redirects to `/quiz/<slug>` of the quiz being run; renders "not started yet" when there is none, because arriving early is normal. Keeps old QR codes and bookmarks working |
| `/q/<code>` (`src/pages/q/[code].astro`) | the four-digit short address. Redirects to `/quiz/<slug>`; an unknown code gets a Polish page with a link to `/quiz`, not the framework's blank 404 |

An unknown slug on either quiz view is a **404**, never a fallback to whichever quiz is first — a host
who mistyped has to find out in the lobby, not by starting the wrong questions. Neither exports
`getStaticPaths`: it is required for a *prerendered* dynamic route and meaningless on an on-demand one.

`/q/<code>` deliberately does **not** check which quiz is running. That message belongs on the attendee
view, once, where a phone arriving by an old QR meets it too — see `quizMismatch` in
`src/lib/client/render.ts`. Two copies of one error is two places for it to drift.

## The panel offers only the action the phase accepts

**Which verb is enabled in which phase is stated once, as `verbsFor` in
`src/lib/client/controls.ts`.** It names the one button ringed as the next step too, so the panel
leads the sequence instead of leaving it in the runbook. The principle: *disabled elsewhere rather
than relying on the route's 409; the refusal is the backstop, not the interaction.*

The table is **private** inside `controls.ts` — `verbsFor` is the only export — so a second reader is
not expressible rather than merely forbidden. It lives there rather than on this page because a scan
of a table's own literal cannot answer the question the rule exists for: *does the panel offer a verb
the route refuses?* is a statement about `src/pages/api/quiz/host/*`, and no reading of the panel's
source can check it. `controls.test.ts` runs the decision against route legality instead.

Do not write a phase condition for a verb anywhere else — a second copy is how the panel and the
routes come apart. Three rows look inconsistent and are not: **`dalej` stays offered while a question
is open** (the host's only lever if the wrong thing is on the projector), **`pokaż ranking` stays
offered in `standings`** (it re-broadcasts — the retry its own 502 asks for, in the phase the state
is already in), and **`start` is offered only with no session** (the route is idempotent, so mid-quiz
it does nothing).

**The panel is a strict subset of route legality, never an equality**, and a test written as an
equality fails on correct code. `controls.test.ts` asserts the one-way implication — no allowed verb
is one the route answers with a 409 — plus `MATERIAL_WITHHOLDINGS`, the closed set of places the
panel offers *less* than a route that would act. There are exactly three: `end` in `lobby`, and
`pokaż ranking` on the last question in both `question-revealed` and `standings`. A verb withheld
where the route is a **no-op** needs no entry, because declining to offer a button that would do
nothing is the whole point. Adding a fourth material withholding means writing down why.

**The decision has a second dimension, `atLast`, and it is not a phase.** `advance` is a no-op past
the last question (`advance.ts` returns null when `nextQuestionId` does), and the phase cannot see
that — `question-revealed` on question 3 and on question 14 are the same phase and want opposite
bars. So each affected row carries a `whenLast` variant, selected by `verbsFor`'s second parameter,
which the page fills from `atLastQuestion(config.questions, …)` — the published question order the
page already holds, never a new snapshot field. The last `question-revealed` allows **no flow verb**:
`dalej` does nothing there, and `pokaż ranking` would show a board the closing beat is about to
publish itself.

**`end` is the one verb `whenLast` does not collapse**, and this is the most plausible way to break
the room while the suite stays green. The closing verb stays allowed on the last question in
`question-revealed` and `standings` — that is precisely the beat where it becomes the only step left
and takes the next-step ring. Applying the collapse to all five uniformly disables the one control
the host needs on question 14. `controls.test.ts` asserts `end`'s allowed state is identical for
`atLast` true and false in every phase.

The reveal verb is also **named** by question kind: `zamknij pytanie` on a word cloud, which has no
answer to show but still needs closing (`answer.ts` accepts only in `question-open`). Keyed on
`pollTargetFor`, the single kind predicate — never on a fresh `kind === "word-cloud"` test, and never
"fixed" by dropping `reveal` from the row, which would leave the cloud with no way to close.

**The verbs' geometry is stated once**, as `FLOW_PILL` in the host page's frontmatter, and its sizes are
`clamp` rather than fixed. The row was measured for a 1920 projector (`text-[40px] px-8`), which is
not the window the host drives it from: at 1440 the four verbs need more width than the bar has and
`flex-wrap` stacks them mid-session. Each figure keeps its projector value as the maximum — `2.08vw`
is exactly 40px at 1920 — and floors at 26px, the host's own copy size on the rest of that bar. Do
not re-fix them, and do not let `data-[next=true]` set geometry: the filled and outlined states must
stay the same size or the row reflows when a step becomes the next one.

`syncControls` must be called from **all four sites** — `render`'s ordinary path, `render`'s
sessionless early return, `fire`'s `finally` (which re-enables every button unconditionally), and the
reveal's arming tap, which changes the button's label and so must repaint the bar through the same
function rather than writing `textContent` itself. `host/[slug].test.ts` asserts the count.

## `zakończ sesję i pokaż wyniki` — one element, two homes

`end`'s phase rule is a row in `verbsFor` like the other four, which is what makes "the panel's phase
rules" one mechanism instead of two. A phase condition living outside the table was a second place
for the panel to drift from the routes, and it was the half no guard could reach.

What `syncEndButton` owns is everything a table cannot hold: the two-tap arming and its version rule,
the reparent, and the label. It reads its enabled state from `verbsFor(...).allow` and its ring from
`next === "end"` — the same decision the bar reads, so "exactly one filled pill" holds by
construction rather than by two conditions agreeing. It stays out of reach in `lobby` even though the
route accepts it there; that is one of the three entries in `MATERIAL_WITHHOLDINGS`.

The button is authored in `#host-menu` — the dialog behind the join QR — and moved out to
`#end-slot-bar` on the utility line when `atLastQuestion` holds and the phase is not `ended`;
`home.append(endButton)` is the only reparent in the file. **One element moved, never one per
place**: two copies would be two arming labels, two `disabled` flags and two listeners, and the copy
that fell behind is the one that fires unarmed. The bar's slot is an empty `display: contents` div,
so it takes no `gap` while it is empty.

**The row around that slot, `#end-row`, is `hidden` whenever the slot is** — same function, same
reading (`setHidden(endRow, home !== endSlotBar)`), so the region cannot outlive its only content. Do
not hold it open with a `min-h` to keep the bar's height constant: that reserves a band of empty
asphalt above the flow verbs for thirteen questions out of fourteen. Reserved emptiness is on screen
all session; the bar growing once at the close is on screen for a moment, and `#stage` is `flex-1`
and absorbs it. Note `hidden` beats a `flex` class here only because Tailwind's preflight carries
`[hidden] { display: none !important }`.

Two halves, both load-bearing. For thirteen questions the one control with no undo takes opening a
menu on purpose; on the fourteenth it is exactly where the host has always found it, ringed as the
only step left. **The menu is a route, not a bypass** — the phase rule is unchanged in either place,
so a host abandoning a session mid-quiz meets the same refusal `end` would give them. Do not answer
"the host cannot end early" by widening the phase rule, and do not answer "the button is hidden" by
`hidden` on a button that stays on the bar: it has to be somewhere while it is away, and a hidden
button on the bar is a button in no place at all.

## The projector's rail is present exactly when one of its blocks is

`syncRail` is its only writer. The blocks — the answered count, the clock, the word cloud's counters
— each hide on their own rule, and `#rail` used to outlive all of them, so an empty 440px column with
a divider sat beside the stage in four states: every non-cloud reveal, the standings beat, the
sessionless `brak sesji` fallback, and the close. `syncRail` reads those three sections' own `hidden`
state, so it is one rule rather than a fourth copy of predicates that already exist — which is why
`applyShell` no longer touches `railBox` at all.

**Never key the rail on the phase.** A `phase === "question-revealed"` condition looks equivalent and
is wrong: `pollTargetFor` keeps returning a words target through the reveal so the host can talk over
a frozen cloud, so a phase list takes the rail away from the one reveal that still has something in
it. `host/[slug].test.ts` fails the suite on a second `setHidden(railBox` or a missing call site — the rule
must reach both `render`'s ordinary path and its sessionless early return, each after the panel
renderers it reads. The rail's *absence* is what hands the distribution bars and the leaderboard the
full width; `#stage` is `flex-1` and widens on its own.

## Polling: two loops, three endpoints, and why every one has to be nameable

The runbook's command tripwire is a polling detector, so **an unaccounted-for loop reads as an
incident.** There are exactly two loops that *fetch*:

| Loop | Where | Bounded by |
| --- | --- | --- |
| The host panel poll | `host/[slug].astro` | one device; the lobby or a question kind; ~2.5 s (~3 s in the lobby) with exponential backoff; tab visibility |
| The connection fallback | `src/lib/client/session.ts` | the channel outage; tab visibility; the session ending |

**There are also timers that fetch nothing** — the countdowns in both pages and the host toast's
dismissal clock — and the distinction is the point rather than a footnote. They issue no request, so
they spend no commands and cannot appear in the tripwire; what bounds them is their question, not a
backoff. The countdown's is cleared on every render, armed only while a question with a limit is
open, stopped at both lifecycle exits; the toast's is one pending hide, re-armed by whatever was said
last. Both live in `src/lib/client/` rather than inline, because a scan cannot execute a timer.

**Do not count timers and do not merge the rules.** `host/[slug].test.ts`'s guard asserts a *property* —
exactly one timer whose callback can reach a `fetch` — not a `setTimeout` occurrence count, which
would have to be weakened every time a countdown lands and would then protect nothing. `motion.ts`
holds no timer at all (rAF only), which is what lets it exist without weakening either guard.

The host loop serves **three** endpoints — `/api/quiz/host/participation` for the answered count,
`/api/quiz/host/words` for the word cloud, and `/api/quiz/state` for the lobby's join count — chosen
in `pollTargetFor` by phase, then by question kind. **That predicate lives in
`src/lib/client/controls.ts`, not here**, and it is the module that spells all three URLs. The page
passes `config.questions` and fetches `target.url`; a URL literal on the page would be a second
request path. `controls.test.ts` runs the predicate over every question kind, so a sixth kind is a
type error rather than a question that silently polls nothing.

**The answered count is not choice-only, and used to be.** Every kind that takes an answer feeds it —
text and number included — because `SUBMIT_ANSWER` bumps `answered:<questionId>` before it touches an
option field, so the figure was being withheld rather than being unavailable. The clause that
excluded them came from the free-text slice and was written about the *distribution*, which a typed
answer really has no shape for; the bars stay away on their own (`reveal.ts` builds
`revealedDistribution` only for the choice kinds, and the panel hides on `distribution === null`).
Do not re-introduce a kind test here to keep bars off a text question. What the predicate still
refuses is a question with **no kind at all** — one this build does not have — and that guard is now
explicit rather than implied by the kind list: without it a host tab that outlived a deploy polls a
400 every 2.5 s.

The lobby target exists because **a join publishes nothing**, so the snapshot's `playerCount` moves
only on a host action: in the one phase where the host acts least and the number changes most, the
figure sat frozen until somebody pressed `odśwież`. It is the only target with no panel of its own,
so it writes nothing but `liveCount` and `pollFailed` marks nothing stale for it. It also ticks
slower — a 3-second **floor** on the loop's single `pollDelay`, applied in `schedulePoll`, never a
second interval variable: a second delay is a second backoff, which is most of what a second loop is.
The floor was 10 s and is not any more: this is the one beat the *room* watches the figure on, and at
ten seconds somebody who had just joined stood through two host sentences before the projector agreed
they were there.

**Every polled figure counts up rather than swapping** — `createCountUp` on this page, over
`renderFigureCountUp`'s `from` argument, which is why that argument exists. Three instances: the
lobby's join count, and the answered counter in each of the two panels. A polled number is the only
evidence the room's own actions are landing, so `0` becoming `25` in one frame reads as a figure
being set rather than a room filling.

It counts **from what is on screen**, never from zero — the default is an award, which is a fresh
figure each question. Each instance's `shown` is written by the format callback, so it stays true
even when a tick cancels a count that was still climbing. Hence one factory rather than three
closures, and hence `reset()`, which must **cancel and forget** the motion as well as clear `shown`:
it is both the sessionless dash and the between-questions dash, and a counter that remembered the
previous question's figure would count the first reply up from it. `host/[slug].test.ts` fails on a
`setText` to any of the three ids. `#word-cloud-count` is not one of them — it is a sentence, not a
figure.

None of this is an entrance: the counters' *boxes* stay still, which is a separate rule and still
holds (`renderEntrance`'s `enabled`).

**One loop, not three**, and that is load-bearing: the `polling` flag exists because a tick armed
from `render` while a fetch was open held several requests at once, worst exactly when the venue
network was worst. Two loops would mean two backoffs, two in-flight flags and two chances to leave a
timer running for a panel that is off screen. `host/[slug].test.ts` fails if a second timer, a second fetch
site or a second copy of the predicate appears.

The word-cloud target is the only one that runs in `question-revealed`, so the host keeps a complete
cloud to talk over; `cloudFinalReadFor` closes the loop after that final read, since no submission
can arrive in that phase.

**Nothing polled may write** — see the deadline rule in `src/lib/session/CLAUDE.md`. A host-side
write during `question-open` moves `updatedAt`, which both inflates every later award and silently
extends the submission window, with nothing on any screen to say either changed.
