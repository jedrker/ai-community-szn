<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Several independent quizzes

- **Plan**: `context/changes/multiple-quizzes/plan.md`
- **Scope**: Full plan — Phases 1–6 of 6
- **Date**: 2026-08-17
- **Verdict**: REJECTED at review; all ten findings triaged and fixed (see Decisions)
- **Findings**: 1 critical, 4 warnings, 6 observations (F11 found during triage)

Commit range: `dff8dde^..HEAD` (7 commits, 60 files, +5743/−2754).

All automated success criteria reproduce clean: `bun run test` 1653/1653 (43 files),
`bun run type-check` 0 errors, `bun run lint`, `prettier --check .`, `bun run build`,
`bun run e2e` 2/2. The gate-fires checks (1.5, 1.6), the scoped-test mapping (3.6), the
unknown-slug 404s (3.7) and the code route (4.5) were each re-verified independently
against a temporary second quiz, which was then removed.

**Both F1 and F2 are invisible to every one of those checks.**

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | FAIL |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

Notes on the verdicts:

- **Plan Adherence — WARNING, not FAIL.** Every "Changes Required" item is implemented and
  nothing functional is missing. Two contracts were met by a different mechanism than
  specified (F3), and two prescribed integration tests were never written (F5). Both
  deviations were disclosed at the time rather than discovered here.
- **Scope Discipline — WARNING.** No "What We're NOT Doing" boundary was crossed: the diff
  touches no `keys.ts`, `scoring.ts`, `deadline.ts`, `tallies.ts`, `answers.ts`, `words.ts`
  or `players.ts`; no `livequiz:` name gained a quiz dimension; one global `SHUFFLE_SALT`;
  no builder UI; no stored-session migration. The warning is for one benign EXTRA: Phase 5
  ships the whole registry's slug→title map to every phone where the plan authorised only
  the rendered quiz's id. It is argued against the retention contract in two places and
  holds `code` back, so it reads as a deliberate widening — recorded, not faulted.
- **Success Criteria — PASS.** Automated all reproduce; manual rows are user-attested. Note
  that manual steps 3, 4 and 6 of the plan's Manual Testing Steps require a second
  committed quiz, which the repo does not ship (F10) — the mechanisms behind them were
  verified against a temporary quiz during Phase 5 instead.
- **A plan error, for the record:** the plan's Phase 6 aside that "the root file also still
  describes `CONTROL_RULES` in `host.astro`" is false. `git show dff8dde^:CLAUDE.md`
  contains no `CONTROL_RULES`. There was no pre-existing drift to fix.

## Findings

### F1 — A session that spans the deploy cannot advance, and two documents promise it can

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/state.ts:100-106` and `:557-563`; `src/pages/api/quiz/host/advance.ts:45-48`; `src/lib/session/CLAUDE.md:125`
- **Detail**:
  `state.ts:103` states: *"a session running across the deploy still parses, so the host can
  advance, reveal and close normally. What it cannot do is start a quiz."*
  `src/lib/session/CLAUDE.md` repeats it. Verified false by direct test:

  1. A document written before this change parses — `quizId` defaults to
     `PRE_IDENTITY_QUIZ_ID`, and the `superRefine` clause exempts the sentinel from
     must-resolve.
  2. `advance.ts:32` calls `nextQuestionId(current.quizId, …)` with the sentinel.
  3. `getQuizById("__pre_identity__")` → `undefined` → `{ outcome: "unresolved", reason:
     'quiz "__pre_identity__" is not in the registry' }`.
  4. `advance.ts:45` `console.error`s and returns `null` → `applyHostAction` answers
     `200 { applied: false, note: "no-op" }`.

  So `dalej` is a **permanent no-op** for any session in flight across the deploy, while
  `verbsFor` still rings it as the next step and the panel reports "ta akcja została już
  zastosowana". `reveal`, `standings` and `end` do work — none consults the quiz. The only
  way forward is `bun run quiz:reset`, which destroys the in-flight scores: exactly the
  mid-segment breakage the sentinel default was introduced to prevent. It converts a 409
  into a silent stall, which by the panel's own principle is the worse failure ("the
  refusal is the backstop, not the interaction").

  No test covers it. `state.test.ts` asserts only that the sentinel parses and is
  unforgeable; nothing advances a sentinel-bearing document. This is `lessons.md`'s "prove
  the fixture reaches the branch" and "the CLAUDE.md edit is part of the slice" pair, in
  the direction where the *documentation* is the false artefact.
- **Fix A ⭐ Recommended**: Let a pre-identity session advance by resolving its quiz from the open question, and heal `quizId` on that write.
  - Strength: Keeps the back-compat promise both documents already make, so no doc has to
    retract. `getQuizByQuestionId(currentQuestionId)` is unambiguous precisely because the
    Phase 1 gate makes question ids globally unique — the same argument that licenses
    `getQuestionById`. Healing the field on the next write means the session leaves the
    sentinel behind after one `dalej`.
  - Tradeoff: `advance` becomes the one transition that may change `quizId`, which dents
    the "written once, copied unchanged" rule `state.ts` and `CLAUDE.md` both state — so
    that rule needs an explicit, narrow exception written next to it.
  - Confidence: HIGH — the lookup already exists and is exported; the lobby case
    (`currentQuestionId === null`) needs its own answer, and the first registry quiz is the
    only available one there.
  - Blind spot: A pre-identity session sitting in the *lobby* has no question to resolve
    from, so it still cannot advance under this fix unless the lobby case falls back to the
    first registry quiz — which is a guess, and guessing is what the sentinel exists to
    avoid.
- **Fix B**: Accept that it cannot advance; correct both documents and make `advance` refuse visibly.
  - Strength: Keeps `quizId` strictly write-once and keeps every guess out of the store.
    Honest about the real behaviour, and a visible refusal beats a silent no-op on stage.
  - Tradeoff: A mid-event deploy now costs the segment's scores rather than a beat, and
    that has to be written into the runbook as a hard rule ("reset before deploying").
    Changing `advance` to answer anything but 200 also means widening
    `applyHostAction`'s `nextFrom` contract, which the implementation deliberately avoided.
  - Confidence: MEDIUM — the doc edits are trivial; the visible-refusal half touches a
    helper shared by five routes.
  - Blind spot: Whether the project ever actually deploys mid-session. If it does not, the
    whole sentinel apparatus is defending an impossible case and Fix B is nearly free.
- **Decision**: FIXED via Fix A. `nextQuestionId` resolves a sentinel session's quiz from its
  open question via `getQuizByQuestionId` and reports it on the `next` outcome; `advance`
  writes that resolved id, healing the document. The lobby case stays `unresolved` by
  design (no question to resolve from, nothing at stake in a lobby) with its own test and
  reason string. Two new tests — `state.test.ts` "advances a session written before quizId
  existed…" and `routes.test.ts` "heals a pre-identity session's quizId…" — verified in
  both directions: reverting the resolve fails both, reverting only the heal fails the
  second. `state.ts`'s docblocks and `src/lib/session/CLAUDE.md` now record the corrected
  claim rather than the old one.

### F2 — Quiz A's host panel silently drives quiz B's session, and the projector promises a question that will never come

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `src/pages/quiz/host/[slug].astro:2339-2363`, `:3128`; `src/lib/client/controls.ts:240-243`, `:385`
- **Detail**:
  The attendee view got a full mismatch branch (`quizMismatch`). `start` got a 409. The
  host panel — the surface with the irreversible verbs and the projector — got neither.
  Verified: `config.quizId` is read at exactly **one** site in the whole panel
  (`:3128`, inside `startBody()`), and `verbsFor(phase, atLast)` has no quiz dimension.

  With quiz B in `question-open` and a host on `/quiz/host/<A>`:

  - **Counter** hidden — `config.questions.findIndex(B's id)` is `-1`.
  - **Prompt**: `renderQuestion(box, undefined)` paints `MISSING_QUESTION_TEXT` =
    *"Za chwilę pojawi się kolejne pytanie."* (`render.ts:33`, `:342`). **The projector
    tells the room a question is coming that never will.**
  - **Phase chip** falls back to `PHASE_LABELS[state.phase]`, so the panel looks live.
  - **Poll/rail**: `pollTargetFor` returns `null` for a foreign id, so no answered count
    and no rail — quiet, not an error.
  - **Verbs**: `atLastQuestion(A.questions, B's id)` → `false`, so `advance` and `reveal`
    are enabled and **`reveal` is ringed as the next step**. No host route compares the
    panel's quiz to the session's, so pressing them advances, reveals or ends **quiz B's
    live session** from quiz A's panel.

  Related, on the attendee side: `showJoinForm` runs from boot independently of `render()`,
  so a phone arriving at quiz A's URL while B runs claims a player in session B — spending
  one of its `MAX_PLAYERS_PER_DEVICE` slots, which the store never releases — and only then
  meets the mismatch screen. Benign in outcome (`PLAYER_STORAGE_KEY` is not quiz-scoped, so
  the link resumes the same player) but a device can spend its allowance on a page it was
  told to leave.

  Note the asymmetry is documented nowhere as a decision: `src/pages/quiz/CLAUDE.md:26-30`
  says the mismatch message "belongs on the attendee view, once", which reads as a decision
  about `/q/<code>` — not as a decision to leave the panel inert.
- **Fix A ⭐ Recommended**: Give the panel the same comparison, and force the no-verb decision on a mismatch.
  - Strength: The data is already there (`config.quizId` in `define:vars`, `state.quizId` on
    the snapshot) and `quizMismatch` is already a tested pure function in `render.ts` — the
    panel can reuse it rather than growing a second copy of the rule. Killing the verbs is
    what stops one host stepping on another's live session, which is the half that is worse
    than cosmetic.
  - Tradeoff: Touches a page whose inline script is guarded by literal source scans and
    pinned out of the formatter, so the edit is careful work; `verbsFor` needs a way to be
    overridden, or the call site needs a branch before it.
  - Confidence: MEDIUM — the mechanism is proven on the phone, but the panel has four
    `syncControls` call sites and a reparented `end` button, so "no verb is live" has more
    places to leak than it looks.
  - Blind spot: Whether two host panels open at once is a real scenario or a theoretical
    one. If the picker makes it easy to open the wrong panel, it is real.
- **Fix B**: Ship only the projector half — override `missingText` on a mismatch so the screen stops promising a question — and leave the verbs alone.
  - Strength: A few lines, no risk to the verb machinery or the source scans, and it removes
    the one thing 150 people in the room can see.
  - Tradeoff: Leaves the actual hazard — a host driving the wrong session — in place.
  - Confidence: HIGH — `renderQuestion` already takes a `missingText` option for exactly
    this kind of caller override.
  - Blind spot: None significant; this is a partial fix by design.
- **Decision**: FIXED via Fix A. `quizMismatch` gained a `linkBase` parameter so one tested
  function serves both surfaces (`/quiz/<slug>` for the phone, `/quiz/host/<slug>` for the
  panel). The panel gained `quizTitles` through `define:vars`, a single-reader `wrongQuiz`
  helper, a `render()` early return that paints "Ta sesja prowadzi inny quiz." with a link
  to the running quiz's panel and hides every rail block, and the precondition in
  `syncControls` + `syncEndButton` that darkens **every** verb (including `start`) with a
  Polish reason and suppresses the next-step ring. Deliberately a precondition on the bar,
  not a pseudo-phase in `verbsFor` — a mismatch has no route-legality row to be checked
  against, which is `controls.test.ts`'s premise. Four counting/shape guards moved
  legitimately and were updated (`syncControls` 4→5, `syncRail` 3→4, two `setText("phase")`
  literals, and the end-ring assertion relaxed from the whole expression to the property it
  was always about — it had become a scan that fails on correct code). One positive guard
  added. Verified in a real browser with a temporary second quiz, both directions: the wrong
  panel refuses everything and links to the right one; the right panel is unaffected. That
  spec is parked at `follow-ups/f2-panel-mismatch.spec.ts.txt` (it needs a second committed
  quiz — see F10). `src/pages/quiz/CLAUDE.md` records the new count and the
  precondition-not-a-phase decision.

  The related attendee-side note (a phone claims a player in session B before meeting the
  mismatch screen) is **not** fixed — it is benign, and gating `showJoinForm` on the first
  snapshot restructures the join flow on a page with no harness. Left as accepted.

### F3 — Phase 1 §9's positional-fixture migration was not done, and the hazard it named is now doubled

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: `src/lib/session/store.test.ts:62`, `:91`; `src/pages/api/quiz/host/routes.test.ts:97`, `:126`, `:590`; `src/lib/session/state.test.ts:16`, `:96`; plus `result.test.ts`, `host.test.ts`, `realtime.test.ts`, `participation.test.ts`, `words.test.ts`, `public.test.ts`
- **Detail**:
  Phase 1 §9's contract: *"Test files that index `quiz.questions[0]` positionally move to
  `questionOfKind` — `lessons.md:48-70` already forbids positional indexes into real data,
  and 'which quiz's question 0' makes it ambiguous as well as fragile."*

  What happened instead: ~10 test files got a two-line mechanical swap —
  `const { quiz } = await import(...)` became `const quizzes = ...; const quiz = quizzes[0]!`
  — which keeps every `quiz.questions[0]` / `[1]` / `[length-1]` index **and adds a new
  positional index into the registry**. The plan's stated hazard is now present twice:
  adding a quiz at the top of `definitions/index.ts` silently re-points ~40 fixtures at a
  different quiz, and reordering questions moves them again. `routes.test.ts:590` even
  carries a comment asserting which *kind* `quiz.questions[0]` is — the transcript style
  `definition.test.ts` was rewritten to eliminate.

  Phase 1 §6 is the enabling half and is part of the same story: `questionOfKind` was
  supposed to "return the question together with the quiz it came from", and instead returns
  a bare question with `getQuizByQuestionId` + a `quizId` filter supplying the owner. That
  substitution is documented in-file and is arguably cleaner — but because callers can
  reach the owning quiz without the pair, nothing forced anyone through `questionOfKind`,
  which is precisely how §9 stayed undone.
- **Fix A ⭐ Recommended**: Migrate the kind-dependent fixtures to `questionOfKind` now, and leave the opaque-id ones on an explicit named helper.
  - Strength: Splits the work by what the fixture actually needs, which is the distinction
    the contract was really about. Only a handful of fixtures care which *kind* they get
    (`routes.test.ts:590` is the self-documenting example); the rest use a question id as an
    opaque session key, where `questionOfKind` buys nothing. A named
    `theCommittedQuiz()`-style accessor makes "which quiz" a single decision instead of ~10.
  - Tradeoff: Real work across ~10 files, and rewriting a fixture can silently change which
    branch a test reaches — the `lessons.md` hazard that argued for the mechanical swap in
    the first place. Each rewritten test needs its branch re-proven.
  - Confidence: MEDIUM — the mechanical part is safe; judging which fixtures are
    kind-dependent requires reading each assertion.
  - Blind spot: Not verified how many of the ~40 indexes are genuinely kind-dependent; the
    split could turn out to be 3/37 or 20/20.
- **Fix B**: Leave it, and record the deviation in the plan as an addendum with the reason.
  - Strength: Costs nothing and risks nothing. The suite is green and the indexes are only
    dangerous when a second quiz lands at the top of the registry — which is a change that
    will run the whole suite anyway and fail loudly, not silently.
  - Tradeoff: A stated contract stays unmet and `lessons.md:48-70` stays violated in ~10
    files, so the next reader sees the rule and the counter-example side by side.
  - Confidence: HIGH — the failure mode is a red suite, not a wrong result.
  - Blind spot: Whether any of the ~40 fixtures would fail *silently* rather than loudly
    under a registry reorder. One that reaches a different branch and still passes is the
    case that makes Fix B wrong.
- **Decision**: FIXED via Fix A. Measuring first changed the shape of the work: **no
  kind-dependent positional index remained in code** — `routes.test.ts` already resolved its
  choice fixture by kind, and the transcribing comment beside it ("`quiz.questions[0]` is the
  word-cloud opener") sat over a redundant `.find()` that duplicated the file's own
  `questionOfKind` fixture. That is now `singleQuestion`, comment corrected. What remained was
  ~15 opaque session keys and a handful of legitimate ordering reads.

  `test-support.ts` gained `fixtureQuiz()`, `someQuestionId()` and `anotherQuestionId()` —
  named for what the caller wants, so none can be read as a claim about kind, position or
  content — and nine test files moved onto them, retiring every `quizzes[0]!` outside
  `state.test.ts` (which keeps positional reads because `nextQuestionId`'s job *is* the running
  order, now stated in its docblock). "Which quiz" is one decision instead of ten.

  The tradeoff this fix carried — that rewriting a fixture can silently move which branch a
  test reaches — was closed rather than accepted: a throwaway parity test asserted
  `fixtureQuiz() === quizzes[0]`, `someQuestionId() === quizzes[0].questions[0].id` and
  `anotherQuestionId() === …questions[1].id`, so every fixture resolves to exactly the value it
  did before. `src/quiz/CLAUDE.md` records the new helpers as a fourth fixture rule and says
  explicitly that they are not an escape hatch from `questionOfKind`.

  Phase 1 §6 (the pair return) stays as implemented: `getQuizByQuestionId` + the `quizId` filter
  supply the owner, and with the fixtures now named the enabling concern is moot.

### F4 — `createSession` writes the document before validating it, unlike every sibling write

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/session/store.ts:589-617`
- **Detail**:
  `initialSessionState(now, quizId)` is `JSON.stringify`'d straight into `CREATE_IF_ABSENT`
  and only the *returned* value is parsed. `writeSession:653` and `endSession:721` both
  validate **before** the `EVAL`, and `writeSession`'s own comment calls that "the last
  point at which a state that breaks its own invariants can be stopped from becoming the
  thing 150 devices render". Create is now the one path where that ordering is reversed —
  and it is also the one path that, since Phase 2, carries a value originating in a
  **request body**.

  If an unresolvable `quizId` ever reached it, the poisoned lobby document is persisted
  under `SESSION_KEY` with a 4-hour TTL and *then* reported `invalid`. From there every host
  verb 409s, `/api/quiz/state` 409s, `/quiz` shows "not started", and `start` cannot recover
  because create-if-absent keeps returning the broken document. Only `quiz:reset` clears it.

  Unreachable today — `start.ts:43-52` refuses an absent or unknown slug — so the guard
  lives exclusively in the route. Thin for a request-body value that lands in a persisted
  document: a second caller (a script, a future "reset and restart" verb) inherits zero
  protection, and the symptom is a bricked session rather than a 400.
- **Fix**: Parse `initial` through `parseSessionState` before the `EVAL` and return `{ outcome: "invalid" }` on failure — three lines, symmetric with `writeSession`. Keep the route guard, which produces the better message.
- **Decision**: FIXED. `createSession` now validates before the `EVAL` and logs
  `session.read.invalid` on refusal, matching `writeSession`/`endSession`; the route guard in
  `start.ts` is unchanged. Two tests: one asserts `eval` was **never called** (the property
  that matters — "it returned invalid" would also hold for a version that wrote first and
  complained afterwards), one asserts a resolvable quiz still writes exactly once so the
  guard is not refusing everything. Break-the-guard confirmed: disabling the clause fails
  precisely the first test.

### F5 — Both prescribed integration tests were never written

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `e2e/` (only `seed.spec.ts` and `host-question-open.spec.ts` exist)
- **Detail**:
  The plan's Testing Strategy → Integration Tests names two:

  1. *"open a host panel by slug, start, join from `/quiz/<slug>`, and confirm the verb the
     phase allows"* — the existing two specs open a panel by slug and start, but neither
     joins from `/quiz/<slug>`.
  2. *"E2E: `/q/<code>` lands on the quiz"* — no such spec exists.

  Neither was mirrored into a phase's Progress rows (3.5 is only "E2E passes"), so nothing
  in the checklist caught the omission. Sharpening the point: a throwaway Playwright spec
  covering the Phase 5 mismatch **was** written during implementation, used to verify the
  branch in a real browser, and then deleted — so a spec that would have closed part of
  this gap existed and was discarded.
- **Fix**: Add two specs reusing `e2e/support/host-session.ts`'s setup and purge — one that joins from `/quiz/<slug>` after starting, one that asserts `/q/<code>` lands on the quiz — and keep a variant of the deleted mismatch spec.
- **Decision**: FIXED. `e2e/join-by-slug.spec.ts` starts a session from the panel by slug and
  joins from `/quiz/<slug>` on a second page, asserting the phone is in the game *and* that the
  store's `playerCount` moved — two routes resolving the same quiz out of the registry, either
  of which could 404 alone. `e2e/short-join-code.spec.ts` covers both `/q/<code>` branches. The
  suite is 5 specs, all green.

  Followed `E2E-RULES.md` throughout: role-based locators, the seed's `clearedToCreate`
  precondition and gated teardown on the spec that creates a session (and a documented
  explanation on the one that does not), a `Date.now()`-suffixed display name, no
  `waitForTimeout`, no value import from `src/`. `QUIZ_CODE`, `SHORT_JOIN_PATH` and
  `ATTENDEE_PATH` joined the mirrored constants in `e2e/support/host-session.ts`.

  **Verified per rule 7 by breaking the behaviour**: forcing `/quiz/<slug>` to 404 reddens the
  join spec (and the code spec's landing assertion); disabling `/q/<code>`'s redirect reddens
  only the code spec. Restored, all five pass.

  The F2 panel-mismatch spec stays parked at `follow-ups/f2-panel-mismatch.spec.ts.txt` with a
  header recording *why* it cannot ship as written: it needs F10's second quiz, and its last
  assertion uses `[data-action]`, which `E2E-RULES.md` rule 2 forbids.

### F6 — An unknown slug answers with an unstyled text body, against this change's own stated convention

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/pages/quiz/[slug].astro:59`, `src/pages/quiz/host/[slug].astro:95` vs `src/pages/q/[code].astro:36-45`
- **Detail**:
  `/q/<code>` argues explicitly that "an unknown code gets a page, not the framework's blank
  404 — a mistyped digit is the most likely thing that lands here, and the answer to it is
  'check the screen, or go to /quiz'". The identical reasoning applies harder to the
  attendee view: the new QR codes encode `/quiz/<slug>`, so **any printed QR from this event
  stops working with a bare `Nie ma takiego quizu.`** the moment that slug is renamed or
  retired — no link, no `/quiz`, no styling, no `Content-Type`.

  Secondary, and the reason this is filed as an observation rather than ignored: Progress row
  4.5 reads "an unknown code renders the fallback page **rather than a 404**", and the
  implementation returns status 404 *with* the fallback body. That was flagged and accepted
  at the time on the reading that §1's "not a *bare* 404" is the binding contract, but the
  two sentences do not agree and one of them should be corrected.
- **Fix**: Render the `/q/<code>` page shape from both quiz routes with `Astro.response.status = 404` and the same link to `/quiz`; and settle 4.5's wording against §1's.
- **Decision**: FIXED, with one deliberate asymmetry. A shared `src/components/QuizNotice.astro`
  now carries the shell (heading, body, optional link) for **three** routes: `/q/<code>`,
  `/quiz`'s waiting screen, and `/quiz/<slug>`'s unknown-slug 404. The attendee route sets
  `Astro.response.status = 404` and picks the notice or the view in its template — the early
  `return` is gone, because a `Response` cannot carry a component. Verified live:
  `/quiz/nie-ma` → **404 `text/html`** with the notice and a link to `/quiz`; the real slug
  still renders the full view.

  **`/quiz/host/<slug>` deliberately does not share the component.** Its frontmatter derives
  `attendeeUrl`, `questionTotal` and the QR from a *definite* quiz, so dropping the early
  return makes every one of those need a placeholder that is never rendered — verified as two
  real `ts(18048)` errors when tried. The alternative, extracting the panel into a component,
  would move the inline script out of the file `host/[slug].test.ts` scans **by path** and
  silently disarm ninety assertions. It keeps the early return but now answers a small inline
  HTML page with `Content-Type: text/html`, a heading and a link to `/quiz/host`, and the
  docblock records why it is not the shared shell and that `QuizNotice` is canonical if the two
  drift. The finding itself rates the host route as the lesser half — a host can read a
  sentence; a printed QR cannot be reissued.

  Progress row 4.5's wording is settled in favour of §1's contract ("not a *bare* 404") and now
  says so inline.

### F7 — The registry gate refuses four collisions but not two more that are just as expensive live

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/quiz/index.ts:94-141`, `src/quiz/schema.ts:306-352`
- **Detail**:
  - **A duplicate `title` is legal.** Slugs and codes are checked; titles are not. Two
    quizzes sharing a title make the `/quiz/host` picker ambiguous and make
    `quizMismatch`'s message ("W tej sali trwa «X»") point at the wrong one — on the exact
    surface the title exists to serve.
  - **Static routes shadow some legal slugs.** `src/pages/quiz/CLAUDE.md:20` says keeping
    `host` a static segment means "no reserved words". True for the *panel*, but a quiz with
    `id: "host"` or `id: "spine-check"` has an unreachable **attendee** view, because the
    static `host/index.astro` and `spine-check.astro` win route priority — and
    `spine-check` 404s in production.

  Neither is reachable with one quiz committed; both are cheap to refuse and expensive to
  diagnose during an event.
- **Fix**: Add a duplicate-title clause and a small reserved-slug set (`host`, `spine-check`) to `registryProblems`, with a fixture for each in `definition.test.ts`.
- **Decision**: FIXED. `registryProblems` now refuses six things rather than four: a duplicate
  title (naming both quizzes) and an id in `RESERVED_QUIZ_SLUGS` join the existing four.

  The reserved set is a **literal**, because `src/quiz/index.ts` has to import inside a
  serverless function and a bare `vitest run` where reading the filesystem is the wrong answer
  — so the drift risk is real, and `definition.test.ts` closes it by reading
  `src/pages/quiz/` and asserting an **equality in both directions** (a missing entry is the
  drift; a stale extra one needlessly forbids a legal slug). Verified by touching a throwaway
  `.astro` under that directory and watching the sync test go red.

  All three guards broken and restored: disabling the title clause fails only the title test;
  disabling the reserved clause fails both `it.each` cases; adding a route fails the sync test.
  `src/quiz/CLAUDE.md` now says six rules, and `src/pages/quiz/CLAUDE.md`'s "no reserved words"
  sentence is corrected — it was true of the panel and false of the attendee view.

### F8 — Renaming or removing a quiz slug now bricks a live session, and the runbook does not say so

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `src/lib/session/state.ts:359-367`; `docs/runbook-live-session.md`
- **Detail**:
  The new must-resolve clause means a deploy that renames or removes a quiz whose session is
  in flight makes every subsequent `readSession` return `invalid`: all host verbs 409, all
  state fetches 409, no way forward but `quiz:reset`. That is the deliberate posture and the
  safe direction — the Polish message names the cause — but it is a **new** way for a
  mid-event deploy to stop a segment. `state.ts`'s pointer to "runbook step 4" does not
  resolve to anything about quiz identity, and the runbook's own pre-session check does not
  mention it.
- **Fix**: One line in the runbook's step 1: do not rename or remove a quiz slug while a session exists — `quiz:reset` first.
- **Decision**: FIXED. The runbook's step 1 now states the rule, separates it from the safe
  case (editing a *question* inside a quiz), says the cost (`quiz:reset` takes the scores), and
  notes the printed-QR consequence of renaming between events. `state.ts`'s docblock gained the
  pointer that was previously dangling — it referenced "runbook step 4", which says nothing
  about quiz identity; it now names step 1, which does.

### F9 — ~30 stale prose references to the moved files, and one live doc still names the removed front door

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/roadmap.md:834` (worst); plus docblocks in `src/lib/client/{toast,controls,motion,render}.ts`, `src/lib/session/store.test.ts:601`, both moved test files, `src/pages/quiz/host/[slug].astro`, `scripts/rehearse-room.ts:1662`, `scripts/scoped-tests.sh:10-11`, `e2e/E2E-RULES.md:12,40`, `src/lib/client/boundary.test.ts:221`
- **Detail**:
  Phase 6 amended every document that asserted a *false invariant*, which was its stated
  scope. It did not sweep prose that merely *names a moved file*. The sharpest one:
  `roadmap.md:834` still reads "`src/quiz/index.ts` is the import site (`quiz`, …) — never
  `definition.ts`", naming the removed `quiz` singleton and the removed file in a single
  sentence, in a document a future agent reads as ground truth.

  Also: `boundary.test.ts:221` uses `'import { publicQuiz } from "../../quiz/public"'` as a
  detector *fixture string*. Harmless — it is deliberately synthetic — but it now names a
  non-existent export, which is the kind of thing that gets "corrected" wrongly later.

  This is the class of drift `lessons.md:164-181` is about, one notch below the invariant
  case Phase 6 handled.
- **Fix**: Fix `roadmap.md:834` (the only one that asserts something wrong), then sweep the docblock mentions in one pass.
- **Decision**: FIXED. `roadmap.md`'s front-door sentence now names `quizzes` / `getQuizById`
  and "never a file under `definitions/`", and records that it said `quiz` and `definition.ts`
  until this change. The prose sweep then covered 19 files — `src/lib/client/{toast,controls,
  motion,render.test}.ts`, `controls.test.ts`, `scoring.test.ts`, `store.test.ts`,
  `answer.test.ts`, `routes.test.ts`, `public.ts`, `public.test.ts`, both moved page files and
  suites, `e2e/{seed,host-question-open}.spec.ts`, `E2E-RULES.md`, `rehearse-room.ts`,
  `scoped-tests.sh`, `test-plan.md`, `roadmap.md`.

  Only **backticked prose** was rewritten, never bare identifiers, which is why `publicQuiz` as
  a local in `public.test.ts` survived untouched — confirmed by type-check and the full suite
  staying green. `boundary.test.ts:221`'s detector fixture was fixed deliberately rather than
  swept: it now names `publicQuizzes`, a real export, so nobody later "corrects" a synthetic
  fixture in the wrong direction. Zero live stale mentions remain.

  **`context/foundation/lessons.md` is deliberately untouched.** It is an append-only register
  describing past events, and rewriting the file names inside a historical account would edit
  the history rather than the claim. Its one stale path is a `host.test.ts` mention in an
  entry's Context.

### F11 — A cold Vite dep cache fails the first e2e spec, and it reads exactly like a regression

- **Severity**: 📋 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: `e2e/` (whichever spec runs first — alphabetically `host-question-open.spec.ts`)
- **Detail**:
  Found during this triage, not in the change. Playwright starts its own `astro dev`, and the
  first page load after the dep graph changes — a fresh clone, a `bun install`, a deleted
  `node_modules/.vite`, or an added import anywhere in a page's module graph — answers **504
  Outdated Optimize Dep** while Vite re-optimizes. That kills the page's inline script, so the
  panel renders and its buttons do nothing.

  It surfaces as `expect(locator).toBeEnabled() failed / element(s) not found` on the first
  spec, with the store showing no session because the `start` click never fired. **It is
  indistinguishable from a real regression by reading the failure**, and it cost two false
  bisects here — including one that briefly pointed at code that turned out to be fine
  (`src/` fully reverted to HEAD still failed, which is what finally ruled it out). The tell is
  a `pageerror` reading "Failed to fetch dynamically imported module" with none of your
  assertions in the stack; the fix is to re-run, because the second run is warm.
- **Fix**: Wait for the panel's script to attach before the first click, and record the mechanism in `e2e/E2E-RULES.md` §8.
- **Decision**: FIXED in the specs, not just documented — the first diagnosis ("re-run, it is a
  cache flake") was **wrong**, and chasing it further found the real bug in the suite.

  The flow verbs are server-rendered **with no `disabled` attribute**, so
  `expect(start).toBeEnabled()` is satisfied by static HTML *before the inline script attaches a
  listener*. A click in that window is dropped. Vite's 504 only widens the window from
  microseconds to seconds; the fragility is the spec's.

  `waitForHostPanelReady(page)` in `e2e/support/host-session.ts` waits for the connection status
  the script writes over the server's `połączenie: —` — a state condition, per rule 6, never a
  timeout — and the four panel-driving specs call it after `goto`. The suite is now 7/7 green
  from a **cold** `node_modules/.vite`, warm, and straight after `bun run build` — all three
  states that failed deterministically before. Verified in both directions: removing the wait
  from the first spec fails it on a cold cache; restoring it passes.

  `E2E-RULES.md` §8 now leads with "`toBeEnabled()` on a host verb does not mean the panel is
  listening" rather than with the cache, because that is the transferable rule.

### F10 — The registry ships exactly one quiz, so half the feature's own manual test steps cannot be run

- **Severity**: 📋 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: `src/quiz/definitions/index.ts:20`
- **Detail**:
  `quizDefinitions = [summerTourSzczecin]`. The change delivers the machinery for several
  quizzes and ships one, which means in the committed state: the picker lists a single item,
  a mismatch is unreachable, the `start` 409 is unreachable, and manual test steps 3, 4 and 6
  of the plan cannot be performed as written. The mechanisms behind them were verified during
  implementation against a temporary second quiz (and, for the schema's cross-quiz clause, by
  a documented early-return in the test rather than a real fixture) — but nothing in the
  repository exercises them now, and nothing will until someone authors quiz two.

  This is not a code defect. It is the honest gap between "supports several quizzes" and
  "has several quizzes", and it is worth a decision rather than a shrug, because the request
  that started this change was *"chciałbym, żeby można było kilka niezależnych od siebie
  quizów"*.
- **Fix A ⭐ Recommended**: Author the second real quiz now, as content, and let it stand as the permanent fixture.
  - Strength: Turns three unreachable manual steps and one skipped schema test into live
    coverage, permanently — the union-of-kinds rule, the cross-quiz clause, the picker and
    the mismatch all get a real subject. It is also what the original request asked for.
  - Tradeoff: Content work (questions, a title, a code) that is the user's to author, not
    a mechanical edit.
  - Confidence: HIGH — the gate, the picker and the mismatch were all exercised against a
    temporary second quiz during implementation and behaved correctly.
  - Blind spot: None on the code path; the open question is editorial — which event the
    second quiz is for.
- **Fix B**: Commit a deliberately minimal second quiz purely as a fixture, marked as such.
  - Strength: Closes the coverage gap immediately with no editorial decision, and makes the
    picker show a real list.
  - Tradeoff: A throwaway quiz is reachable by anyone with the URL and would appear on the
    host's picker at an event — a fixture on a production surface, which is the arrangement
    `spine-check.astro` exists behind a flag to avoid.
  - Confidence: MEDIUM — no mechanism hides a registry entry from the picker today, so
    "marked as such" means copy, not enforcement.
  - Blind spot: Whether the picker needs a way to hide a quiz at all — nothing in the plan
    considered it.
- **Decision**: FIXED via Fix A. `src/quiz/definitions/jesienny-meetup-ai.ts` is a drafted
  eight-question quiz (code `2002`), registered second. Its docblock says plainly that it is a
  **starting point to be edited**, and lists the shape an edit must preserve — unscored opener,
  `timeLimitSeconds` on scored questions only, registry-wide unique question ids, no id that
  gives away its own answer, unique title and code, no reserved slug — all of which the build
  gate refuses.

  **The guard under review caught my own content mistake, which is worth recording.** The first
  draft asked "Ile *tokenów* mieści się w oknie kontekstu GPT-4o?" one question after a text
  question whose accepted answer is `token`. Both quizzes' projections are embedded at page
  render, so that printed the answer into every phone's page source — and
  `public.test.ts`'s value-level scan failed on exactly that. The question was replaced and the
  reason written next to it.

  What this turned from theoretical into live:
  - `state.test.ts`'s cross-quiz `superRefine` clause no longer early-returns on a one-quiz
    registry — it takes the real path, and reverting the clause now fails it.
  - `e2e/wrong-quiz-panel.spec.ts` ships (two tests), replacing the parked file: F2's fix
    verified in a browser permanently, with role-based locators, the seed's precondition and
    gated teardown, a near-miss test on the *running* quiz's panel, and the store asserted
    untouched. Reverting F2's precondition fails exactly the first test.
  - The picker lists two quizzes with codes `1001`/`2002`; both attendee routes answer 200 and
    both `/q/<code>` addresses redirect correctly.
  - Manual steps 3, 4 and 6 of the plan are now performable as written.

  E2E suite is 7 specs, all green. `follow-ups/` is removed — nothing is parked any more.
