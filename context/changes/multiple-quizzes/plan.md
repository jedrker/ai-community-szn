# Several independent quizzes — Implementation Plan

## Overview

Turn the single committed quiz definition into a **registry of independent quizzes**, each with its own
slug, Polish title and four-digit join code. The host picks one by opening its URL (reached from a
picker at `/quiz/host`); attendees reach it by QR, by `/quiz`, or by typing a short `/q/<code>`. There
is still exactly **one live session at a time** — this change gives that session an identity, it does
not add parallel rooms.

## Current State Analysis

The quiz exists once, as a module-scope singleton, and nothing anywhere records *which* quiz anything
belongs to.

- **No quiz identity exists.** `quizSchema` is a closed object with exactly one key, `questions`
  (`src/quiz/schema.ts:281-297`). `PublicQuiz` is the same shape (`src/quiz/public.ts:74`).
  `SessionState` has no quiz field (`src/lib/session/state.ts:87-289`). A repo-wide grep for
  `quizId|quizSlug|quizTitle` returns nothing under `src/`, `scripts/` or `e2e/`.
- **Three singletons and one misplaced accessor.** `quiz` (`src/quiz/index.ts:51`), `publicQuiz`
  (`public.ts:217`), and their by-id lookups (`index.ts:68`, `public.ts:220`). The question-*order*
  accessor lives in the session layer and reads the singleton directly — `nextQuestionId`
  (`state.ts:437-450`).
- **Half the transition already exists.** `projectQuiz(source: Quiz = quiz)` (`public.ts:213`) and
  `forbiddenAnswerValues(source = quiz)` (`public.ts:239`) already take a quiz; commit `a004df7`
  parameterised them for test generation.
- **Question ids are unique only within a quiz** (`schema.ts:287-297`), and `definition.ts:3-23`
  recommends subject-descriptive ids — the style two quizzes for the same meetup collide on.
- **`start` is create-if-absent** (`store.ts:210-218`, `:583-619`) and its `exists` branch returns the
  full existing state (`:618`) and answers 200 `already-started` (`start.ts:87-90`).
- **Both views bake one projection at page render** and hand it to the browser through `define:vars`;
  every client-side question lookup resolves against that frozen list.
- **No on-demand dynamic route exists in this project.** Both existing `[...slug]` routes are
  prerendered and use `getStaticPaths` + `Astro.props` (`src/pages/wydarzenia/[...slug].astro:1-18`);
  `grep -rn "Astro.params" src/` returns zero hits.

Full evidence, including the six ways an id collision goes wrong silently, is in
`context/changes/multiple-quizzes/research.md`.

## Desired End State

Several quizzes live under `src/quiz/definitions/`. The host opens `/quiz/host`, sees a list of quiz
titles, and clicks through to `/quiz/host/<slug>`; pressing start binds that quiz to the session. The
projector shows a QR to `/quiz/<slug>` and the short address `/q/<code>`. An attendee reaching a quiz
that is not the one being run sees a Polish message with a link to the one that is. A build that
would ship two quizzes sharing a question id, a code or a slug fails before it deploys.

Verify by: authoring a second quiz, running `bun run test && bun run type-check && bun run build`,
then driving a session end to end on two devices through both `/quiz/<slug>` and `/q/<code>`.

### Key Discoveries:

- **The attendee page does not change depth.** `src/pages/quiz/[slug].astro` sits where `index.astro`
  sits, so its 15 relative imports are untouched. Only the host page moves a level deeper — 12
  specifiers become `../../../` (`host.astro:2,6,7,8` and the `<script>` block's 8 more).
- **Tests must move with their pages.** `scripts/scoped-tests.sh:53-59` maps an `.astro` file to a
  sibling `.test.ts` **by stem**; if a test keeps its old path, editing the page runs no tests and
  exits green — the exact failure the script exists to prevent.
- **The structural scans are already recursive and depth-agnostic.** `boundary.test.ts:183-191` and
  `:292-297` pass `recursive: true`; `FORBIDDEN_AREAS` (`:56`) matches after the relative prefix is
  stripped, so a deeper importer is still caught. `keys.test.ts:112-120` is the same. **No change
  needed in any of them** — but `src/quiz/portability.test.ts:40-42` is *not* recursive and must
  become so, or definitions in a subdirectory silently stop being scanned.
- **`SessionState` back-compat is a documented rule with a documented failure.** Every field added
  after launch carries `.default()`; `playerCount`'s docblock (`state.ts:117-122`) states why —
  required, it 409s the host's next action mid-session. **The obvious default for `quizId` is the
  bug**: defaulting to "the current quiz" makes an in-flight document claim an identity it never had.
- **`quizId` is a third category of field.** The directory's `CLAUDE.md` documents two — decoration
  (`playerCount`) and transition (the four nulled-by-every-other fields). `quizId` is neither:
  immutable for the session's life, set once, copied unchanged by every constructor.
- **The `exists` branch already returns the running state** (`store.ts:618`), so `start` can compare
  quiz ids with no extra read and no change to the Lua script.
- **A 409 is `{ status: 409, body: { error: "<Polish sentence>" } }` through `toResponse`**
  (`host.ts:323-329`). House style states what is wrong, then the action that resolves it, em-dash
  joined — `end.ts:111-117`, `standings.ts:190-196`, `reveal.ts:183`.
- **`extractSecret` consumes the body.** `host.ts:87-102` records the rule verbatim: a request body can
  only be read once. Reading a quiz id on `start` means an `extractHostFields`-shaped single read.
- **`quizId` becomes publicly readable**, through `GET /api/quiz/state` (`state.ts:107`) and both
  `POST /api/quiz/join` success paths (`join.ts:108-113`, `:252-256`). A slug is quiz content, not
  attendee data, so the retention contract is satisfied — but it must be *said*, not inherited
  (`lessons.md:101-120`).

## What We're NOT Doing

- **No parallel sessions.** One session, one room stays true; only "one quiz" is overturned. No
  `livequiz:` key gains a quiz dimension — `keys.ts` structurally forbids the runtime-assembled name
  that would require, and with one session there is nothing to disambiguate.
- **No quiz builder or admin UI.** The picker only *selects* among committed definitions. FR-001 is
  untouched: quizzes remain developer-authored source.
- **No per-session PIN.** The join code is authored content, not generated state.
- **No per-quiz `SHUFFLE_SALT`.** It stays one global constant (`public.ts:104`); with globally unique
  question ids every question already gets its own seed.
- **No change to scoring, deadlines, tallies, answer records, or any field format.** Global question-id
  uniqueness is precisely what buys this.
- **No migration of stored sessions.** A session running across the deploy keeps working via the
  field default and ends normally.

## Implementation Approach

The strategy is to make the **build gate carry the risk**. Question ids become globally unique across
the registry, checked at config load. That single rule collapses the sharpest failure mode — a session
resolving question ids against the wrong quiz — into a red build, and it is why `getQuestionById` can
stay quiz-agnostic, why the two polled routes keep their two-command saving, and why no stored field
format changes.

Everything else follows the project's existing grain: identity on the session document rather than in
key names; a defaulted field with its own `superRefine` clause; the selection resolved in frontmatter
and handed down through `define:vars`; refusals as Polish 409s through `toResponse`.

Phases 1–3 are the deployable core. Phases 4–5 are additive and can slip without leaving the repo in a
broken state.

## Critical Implementation Details

**Ordering within Phase 3 is atomic, not incremental.** The four page files and the two new entry
pages must land in one commit. Splitting the moves from the entry pages leaves a deployable state where
`/quiz` and `/quiz/host` are 404 — the two addresses on the QR, in the runbook and in both e2e specs.

**`Astro.params.slug` is typed `string | undefined`** under `astro/tsconfigs/strict`, and
`bun run type-check` must report 0 errors. The new routes must **not** export `getStaticPaths` — it is
required for prerendered dynamic routes and meaningless on on-demand ones, and both quiz pages are
deliberately on-demand (`host.astro:17`, `index.astro:21` say so in their docstrings).

**`new URL("./[slug].astro", import.meta.url)` is the one genuinely uncertain mechanic** in the move:
`[` and `]` are legal-but-unencoded in a relative URL path. If the round-trip through `fileURLToPath`
misbehaves, use `join(dirname(fileURLToPath(import.meta.url)), "[slug].astro")` instead. Decide this by
running the test, not by reasoning about it.

---

## Phase 1: The quiz registry and its build gate

### Overview

Give a quiz an identity, move definitions into a registry, and extend the build gate to walk all of
them — including the three new cross-quiz uniqueness rules. Behaviour is unchanged: with one quiz
committed, the registry is a one-element registry and every view renders exactly what it renders today.

### Changes Required:

#### 1. Quiz identity in the schema

**File**: `src/quiz/schema.ts`

**Intent**: Add the three identity fields so a quiz can be routed to, listed, and joined by a short
code. Keep every existing per-question invariant untouched.

**Contract**: `quizSchema` gains `id` (the existing `QUESTION_ID` slug regex at `:22` — reuse it, do not
write a second one), `title` (non-empty Polish string), and `code` (exactly four digits). Export a
`QUIZ_CODE` regex beside `QUESTION_ID`. The existing top-level `superRefine` (duplicate question ids
within one quiz, `:287-296`) stays as is — it is correct and still needed. Messages follow
`checkQuestion`'s idiom: Polish, `code: "custom"`, no `path`, naming the quiz.

#### 2. The registry

**File**: `src/quiz/definitions/<slug>.ts` (moved from `src/quiz/definition.ts`), plus
`src/quiz/definitions/index.ts`

**Intent**: One file per quiz, and one module that collects them. Moving the existing definition rather
than copying it keeps its authoring docblock and its `POINTS`/`TAP_SECONDS`/`TYPE_SECONDS` locals with
the questions they explain.

**Contract**: Each definition file exports one literal closed by `satisfies Quiz`, now carrying `id`,
`title` and `code` alongside `questions` — the same shape as today's `definition.ts:33-240`, plus three
fields. `definitions/index.ts` exports the raw registry as an array (or a record keyed by id) of
unparsed literals; it is the only module that imports the individual definition files.

#### 3. Registry accessors

**File**: `src/quiz/index.ts`

**Intent**: Replace the single parsed `quiz` with a parsed registry plus lookups, keeping this module
the single front door the roadmap's baseline rule requires (`roadmap.md:114-121` — downstream slices
never import a definition file directly).

**Contract**: Export `quizzes` (all parsed quizzes, in registry order — the picker's list order),
`getQuizById(id): Quiz | undefined`, and keep `getQuestionById(id): Question | undefined` **searching
the whole registry** — legal precisely because Phase 1's gate makes question ids globally unique, and
it keeps `state.ts`'s `superRefine` working unchanged. `assertQuizValid()` keeps its name and its
no-argument signature (`astro.config.ts:5,21` imports it by name — do not rename, it *is* the gate).
`InvalidQuizDefinitionError`'s header string currently hardcodes `src/quiz/definition.ts`
(`index.ts:28`) — it must name the offending file or quiz id instead, since that string is the only
"which file" signal an organizer gets from a failed build.

#### 4. The cross-quiz gate

**File**: `src/quiz/index.ts` (inside `assertQuizValid`) or a sibling `registry.ts`

**Intent**: Refuse at build time the four things that are invisible to a per-quiz schema and dangerous
at runtime.

**Contract**: After every quiz parses individually, check across the registry: duplicate quiz `id`,
duplicate `code`, duplicate **question id across different quizzes**, and an empty registry. Reuse
`findDuplicates` (`schema.ts:299-307`) rather than writing a second one. Each failure names the two
quizzes involved and the colliding value, in Polish, in the same register as `checkQuestion`'s messages
— an organizer reads these minutes before showtime.

#### 5. The public projection

**File**: `src/quiz/public.ts`

**Intent**: Make the projection per-quiz. `projectQuiz(source)` already takes a quiz and needs no
change; the two singletons bound to the committed quiz do.

**Contract**: `PublicQuiz` gains `id` and `title` (the views need the title for the lobby; the id is
what the client compares against the snapshot in Phase 5). It does **not** gain `code` — a code is a
routing concern and nothing on a phone needs it after arrival. `publicQuiz` and `getPublicQuestionById`
become per-quiz: either a memoized `publicQuizFor(quizId)` or a registry-keyed map built once at module
scope, preserving the "parse/project once, not per request" rule
(`context/archive/2026-08-05-quiz-definition-and-validation/plan.md:487-489`). `SHUFFLE_SALT` stays one
global constant; `forbiddenAnswerValues(source)` is unchanged.

#### 6. Test fixtures from the union

**File**: `src/quiz/test-support.ts`

**Intent**: Let `questionOfKind` keep working when no single quiz carries all five kinds.

**Contract**: `questionsOfKind` / `questionOfKind` search the **whole registry** and return the question
together with the quiz it came from, so a caller that needs to open a session against it knows which
quiz to start. `QuestionFilter` gains an optional quiz constraint for tests that need both. The throw
message (`:77-81`) currently names `src/quiz/definition.ts` — it must name the registry.

#### 7. The definition suite, restated as rules over the registry

**File**: `src/quiz/definition.test.ts`

**Intent**: Keep every existing rule, restated over N quizzes, and keep the every-kind guarantee that
route fixtures depend on.

**Contract**: Per-quiz rules loop (no id gives away its own answer; the opener scores nothing). The
**every-kind rule applies to the union** of the registry, not to each quiz — a short single-event quiz
must stay legal, and the union is what `test-support.ts` now draws fixtures from, so it is the union
that must be complete. Add rules for the new identity: every quiz has a title, codes and slugs are
unique, and — the load-bearing one — **no question id appears in two quizzes**. Keep the file counting
nothing and quoting nothing (`src/quiz/CLAUDE.md:26-54`).

#### 8. The recursive portability scan

**File**: `src/quiz/portability.test.ts`

**Intent**: Keep the `astro:`-import gate covering definitions now that they live in a subdirectory.

**Contract**: `sourceFiles()` (`:40-42`) becomes recursive (`readdirSync(QUIZ_DIR, { recursive: true })`,
matching `boundary.test.ts:183`'s idiom) and `readFileSync`/`it.each` join the returned relative names.
Add a test that the scan actually reaches a file in `definitions/` — the file's own docblock (`:16-22`)
warns that a scan whose pattern stops matching passes forever, and this change is exactly that hazard.

#### 9. Call sites of the old singleton

**Files**: `src/lib/session/state.ts`, `src/pages/quiz/host.astro`, `src/pages/quiz/index.astro`, and
the test files listed in `research.md` § "Test-suite blast radius"

**Intent**: Keep everything compiling and green while the singleton disappears, without yet changing
behaviour.

**Contract**: `state.ts`'s `nextQuestionId` gets its quiz in Phase 2; for Phase 1 it may resolve
through the registry (question ids are globally unique, so `findIndex` across the owning quiz is
well-defined). Both pages select the single registry entry explicitly rather than importing a
`publicQuiz` singleton. Test files that index `quiz.questions[0]` positionally move to
`questionOfKind` — `lessons.md:48-70` already forbids positional indexes into real data, and "which
quiz's question 0" makes it ambiguous as well as fragile.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check` (0 errors)
- Linting passes: `bun run lint`
- Build succeeds with the gate active: `bun run build`
- The gate fires: temporarily add a second definition sharing a question id with the first and confirm
  `bun run build` fails naming both quizzes; then remove it
- The recursive portability scan fires: temporarily add an `astro:content` import to a file under
  `src/quiz/definitions/` and confirm the suite fails

#### Manual Verification:

- `/quiz` and `/quiz/host` render and behave exactly as before this phase
- A malformed second quiz (bad code, missing title) produces a Polish build error naming the quiz

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: Quiz identity on the session document

### Overview

Bind a session to a quiz, and make `start` say so when the host asks for a different one. Still one
quiz in the registry and still one URL — this phase is about the store and the route.

### Changes Required:

#### 1. The `quizId` field

**File**: `src/lib/session/state.ts`

**Intent**: Record which quiz a session is running, so every later reader can tell.

**Contract**: `sessionStateSchema` gains `quizId: z.string()`, carrying `.default(...)` for the
back-compat reason `playerCount`'s docblock states (`:117-122`) — a document written before this ships
must still parse or the host's next action 409s mid-session. **The default must be a sentinel that
means "written before quizzes had identity", never the id of a current quiz**: defaulting to a real
quiz makes an in-flight document assert an identity it never had, which is the silent mis-scoring this
whole change exists to prevent. Add its own `superRefine` clause in the house pattern (one clause per
field, `path: ["quizId"]`, Polish message naming the field): the id must resolve in the registry, and
`currentQuestionId` — when non-null — must belong to *that* quiz. Document `quizId` as a **third
category** beside decoration and transition fields: session identity, set once, copied unchanged.
`initialSessionState(now, quizId)` and `endedSessionState` carry it through.

#### 2. Question order per quiz

**File**: `src/lib/session/state.ts`

**Intent**: Advance within the session's quiz rather than within a global singleton.

**Contract**: `nextQuestionId(quizId, currentQuestionId)`. Keep the documented `null` return for "past
the last question" (`:431-436`) — callers treat it as a no-op — but an id that is not in *this quiz*
must be distinguishable from the end of the quiz, because today `:447` conflates them and `advance.ts`
turns both into a silent 200 no-op. The schema clause above is what makes that state unreachable; the
function should not silently absorb it as well.

#### 3. `createSession` takes a quiz

**File**: `src/lib/session/store.ts`

**Intent**: Write the identity at the only moment a session comes into existence.

**Contract**: `createSession(now, quizId)`, passing it to `initialSessionState`. The `CREATE_IF_ABSENT`
Lua script (`:210-218`) and `CreateResult` (`:96-101`) are unchanged — the `exists` branch already
returns the full parsed state (`:618`), which is what the route needs. `session.created`'s log line may
carry the quiz id; `LogFields` is a closed type by design, so add that one field deliberately (a slug
is not attendee data).

#### 4. `start` reads a quiz id and refuses visibly

**Files**: `src/pages/api/quiz/host/start.ts`, `src/lib/session/host.ts`

**Intent**: Make "you asked for quiz B while quiz A is running" a visible refusal instead of a 200 that
looks like success.

**Contract**: `start` reads the quiz id in a **single body read** — `extractSecret` consumes
`request.formData()` when no header is present and a body can only be read once (`host.ts:87-102`), so
follow `extractHostFields`'s shape (`:103-125`) rather than calling `extractSecret` and then reading the
form. An absent or unknown quiz id is refused, never defaulted — `lessons.md:12-29`: decide what "said
nothing" means and make it fail toward the conservative end. On `outcome: "exists"`, compare
`result.state.quizId` with the request: same quiz keeps today's idempotent 200 `already-started`;
different quiz returns 409 through `toResponse` with a Polish message naming the running quiz's
**title** and pointing at the reset the runbook already mandates.

#### 5. The host page sends the quiz it rendered

**File**: `src/pages/quiz/host.astro`

**Intent**: Close the loop before URLs exist, so this phase is independently deployable.

**Contract**: The page's frontmatter already selects a registry entry (Phase 1); it passes that quiz's
id down through the existing `define:vars` block and `fire("start", …)` sends it. No new import, no
`import.meta.env` read — `boundary.test.ts` forbids both in a `<script>`, and `define:vars` is the
sanctioned hand-off it names in its own failure message (`:335-337`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- A session document written without `quizId` still parses (test asserts the default, not just that
  parsing succeeds)
- `start` returns 409 with the running quiz's title when a different quiz is requested, and 200
  `already-started` when the same one is
- `start` refuses an absent and an unknown quiz id, with the outcome asserted — not merely the
  rejection (`lessons.md:12-29`)
- Break-the-guard check: revert the `quizId` `superRefine` clause and confirm the named test fails
  (`lessons.md:122-142`)

#### Manual Verification:

- A full session runs end to end on two devices with no visible change from today
- With a session running, pressing start after switching the rendered quiz shows the 409 copy on the
  host panel — not a silent success

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 3: A URL per quiz

### Overview

Move both views under dynamic segments, and replace the two addresses they vacate with an entry page
each. **This phase lands as one commit** — the URL surface cannot be half-migrated.

### Changes Required:

#### 1. The attendee view moves to a slug

**Files**: `src/pages/quiz/index.astro` → `src/pages/quiz/[slug].astro`; `index.test.ts` →
`[slug].test.ts`

**Intent**: Give each quiz its own attendee address.

**Contract**: Same directory, so all 15 relative imports are unchanged. Frontmatter reads
`Astro.params.slug`, resolves it through `getQuizById`, and returns a 404 for an unknown slug. No
`getStaticPaths` and no `prerender` export — the route stays on-demand. The test moves with the page
and updates only its `SOURCE` filename literal (`index.test.ts:29-32`); its assertions are about
`<script>` structure and are unaffected.

#### 2. The host view moves under a static prefix

**Files**: `src/pages/quiz/host.astro` → `src/pages/quiz/host/[slug].astro`; `host.test.ts` →
`host/[slug].test.ts`

**Intent**: Same for the host, with `host` kept as a static path segment so no quiz slug can ever
collide with it — no reserved words, no dependence on Astro's route-priority rules.

**Contract**: 12 relative specifiers become `../../../` (frontmatter `:2,:6,:7,:8`; `<script>`
`:1023,:1024,:1025,:1026,:1034,:1048,:1049`). `attendeeUrl` (`:68`) becomes the slug-bearing attendee
URL, which is what the QR (`:134`) and `joinDisplayUrl` (`:79`) then carry. Unknown slug → 404. The
test moves with the page; every occurrence-count assertion is about `<script>` structure and survives
untouched.

#### 3. The host picker

**File**: `src/pages/quiz/host/index.astro` (new)

**Intent**: `/quiz/host` stops being a view and becomes the host's entry point — one address to
remember instead of a slug.

**Contract**: Lists every registry quiz by `title`, linking to `/quiz/host/<slug>`, and shows each
quiz's join code so the host can read it onto the projector. Server-rendered from the registry; no
session read, no host secret — it exposes nothing an attendee could not already see by visiting a quiz.

#### 4. The attendee redirector

**File**: `src/pages/quiz/index.astro` (new, replacing the moved one)

**Intent**: Keep the address that is on old QR codes and in people's history working, and make it the
answer to "just go to /quiz".

**Contract**: Reads the session; redirects to `/quiz/<slug>` of the running quiz. With no session, it
renders the existing `brak sesji` copy rather than a 404 — arriving before the host presses start is
normal.

#### 5. Callers of the old addresses

**Files**: `e2e/seed.spec.ts:89`, `e2e/host-question-open.spec.ts:82`,
`docs/runbook-live-session.md:246,248`, `scripts/simulate-room.ts:13,46,688`,
`src/pages/quiz/spine-check.astro:12,24`, `README.md:64-65`

**Intent**: Nothing may still point at `/quiz/host` expecting a host panel.

**Contract**: The two e2e specs navigate to a quiz-specific host URL, deriving the slug from the
registry rather than hardcoding one (`e2e/E2E-RULES.md` forbids value imports from `src/`, so take it
from a fixture or a constant in `e2e/support/`). The runbook's step 5 gains the picker. `README.md`'s
route table gains the new shapes. No navigation or layout link exists anywhere, so there is nothing
else to update.

#### 6. Scoped-test wiring

**File**: `scripts/scoped-tests.sh` — verification only

**Intent**: Confirm the per-edit gate still finds the moved suites.

**Contract**: `:53-59` maps `<page>.astro` to a sibling `<page>.test.ts` by stem; with both tests moved
alongside their pages this keeps working. Verify by editing each page and confirming its suite runs —
a silent green here means the gate has stopped covering the file.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check` (`Astro.params.slug` is `string | undefined` — the guard
  must be explicit)
- Linting passes: `bun run lint`
- Build succeeds: `bun run build`
- E2E passes: `bun run e2e`
- Editing `src/pages/quiz/[slug].astro` runs `[slug].test.ts`, and editing `host/[slug].astro` runs
  `host/[slug].test.ts` — verified by running the per-edit hook, not assumed
- An unknown slug returns 404 on both `/quiz/<slug>` and `/quiz/host/<slug>`

#### Manual Verification:

- `/quiz/host` lists the quizzes and each link opens the right panel
- The QR on the projector resolves to `/quiz/<slug>` and a phone joins through it
- `/quiz` with a session running redirects to the running quiz; with no session it shows `brak sesji`
- A full session runs end to end on two devices through the new addresses

**Implementation Note**: Pause for manual confirmation before proceeding. This is the phase that is
expensive to revert — confirm on real devices, not only locally.

---

## Phase 4: The short join code

### Overview

Add `/q/<code>` so nobody has to type a slug. Purely additive: nothing existing changes behaviour.

### Changes Required:

#### 1. The code route

**File**: `src/pages/q/[code].astro` (new)

**Intent**: One short address that lands an attendee in the right quiz.

**Contract**: Resolves the four-digit code through the registry and redirects to `/quiz/<slug>`; an
unknown code renders a short Polish "nie znamy tego kodu" page with a link to `/quiz`, not a bare 404.
A code whose quiz is not currently being run still redirects — Phase 5's mismatch message is what the
attendee then sees, which keeps one error path instead of two. On-demand, no `getStaticPaths`.

#### 2. The code on the projector

**File**: `src/pages/quiz/host/[slug].astro`

**Intent**: The short address has to be readable from the back of the room, beside the QR.

**Contract**: The lobby renders `/q/<code>` next to the existing join QR and address. Frontmatter
value, no new client state, no change to `define:vars`. The existing QR keeps pointing at
`/quiz/<slug>` — it is scanned, not typed, so it loses nothing by being long.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- Build succeeds: `bun run build`
- A known code redirects to its quiz; an unknown code renders the fallback page rather than a 404

#### Manual Verification:

- Typing `/q/<code>` on a phone reaches the quiz in one step
- The code is legible from the back of the room on the projector

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 5: Mismatch is visible on the attendee's phone

### Overview

Close the silent-inert failure: a phone on one quiz while the host runs another currently paints a
neutral placeholder with no error and no reason to reload.

### Changes Required:

#### 1. The quiz id reaches the phone

**Files**: `src/pages/quiz/[slug].astro`, `src/lib/client/render.ts`

**Intent**: Give the client something to compare, and one place to render the answer.

**Contract**: The page's `define:vars` block already carries the projection; it gains the rendered
quiz's id. The snapshot already carries `quizId` from Phase 2. The comparison and its message belong in
`src/lib/client/render.ts` rather than inline — an Astro `<script>` has no harness, and the directory's
`CLAUDE.md` says anything worth testing gets extracted. The message is Polish, names the running quiz's
title, and links to `/quiz/<slug>` of the quiz that is actually running. **No automatic navigation** —
150 phones must not move on their own.

#### 2. The mismatch state in the view

**File**: `src/pages/quiz/[slug].astro`

**Intent**: Render that state distinctly from `brak sesji`, which currently absorbs it and lies.

**Contract**: A distinct branch in the existing render path, keyed on the id comparison — never on a
phase list. Answer controls hidden, exactly as the `!question` branch does today.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `bun run test`
- Type checking passes: `bun run type-check`
- Linting passes: `bun run lint`
- `render.ts`'s mismatch branch is covered by a unit test whose fixture reaches that branch and no
  other (`lessons.md:48-70`)
- Break-the-guard check: remove the comparison and confirm the named test fails
- `boundary.test.ts` still passes — no value import from `src/quiz/` reached a `<script>`

#### Manual Verification:

- A phone left on quiz A while the host starts quiz B shows the message and the link, and following it
  joins normally
- The message does not appear during a normal session, including across a reveal and the closing beat

**Implementation Note**: Pause for manual confirmation before proceeding.

---

## Phase 6: The documents that now assert something false

### Overview

Amend every document stating the non-goal this change overturns, plus the four `CLAUDE.md` files whose
claims Phases 1–5 falsified. `lessons.md:164-181` makes this part of the change, not a discovery at the
end of it — it is listed as a phase for exactly that reason.

### Changes Required:

#### 1. The product documents

**Files**: `context/foundation/prd.md:510-511`, `context/foundation/shape-notes.md:437-438`,
`context/foundation/roadmap.md:658-659`

**Intent**: Overturn "one session, one quiz, one room" in the three places it is stated, keeping the
half that still holds.

**Contract**: Quote the position being overturned rather than deleting it — the house pattern the PRD
and `state.ts` already use. State plainly that parallel *sessions* remain out of scope and that this is
what keeps the key registry untouched. Note that FR-001 is unaffected: selecting among committed,
developer-authored definitions is not a builder interface.

#### 2. The agent rule files

**Files**: root `CLAUDE.md`, `src/quiz/CLAUDE.md`, `src/lib/session/CLAUDE.md`,
`src/pages/quiz/CLAUDE.md`

**Intent**: Every one of these carries at least one sentence Phases 1–5 made false.

**Contract**: Root — the rendering-model table's `/quiz`, `/quiz/host` rows and the quiz-definition
section. `src/quiz/` — the layout paragraph (`:6-9`), the every-kind consequence (`:45-49`), and the
new identity fields and gate rules in "Schema invariants refused at the build gate". `src/lib/session/`
— the `SessionState` field-category section gains the third category. `src/pages/quiz/` — the opening
sentence naming `host.astro` and `index.astro` (`:1-6`) and the polling table's file column (`:129`).
Note the root file also still describes `CONTROL_RULES` in `host.astro`, which the directory file says
moved to `verbsFor` in `controls.ts` — a pre-existing drift worth fixing while in there.

#### 3. Operational documents

**Files**: `docs/runbook-live-session.md`, `README.md`

**Intent**: The host's pre-session check changes: "which quiz is live" stops being answered by "which
commit is deployed".

**Contract**: Step 1's deploy check keeps its warning but gains the quiz selection; step 5 goes through
the picker; the mandatory reset in step 4 gains its second reason (a stale session now also blocks
starting a *different* quiz, visibly, per Phase 2's 409). `README.md`'s route table gains
`/quiz/<slug>`, `/quiz/host/<slug>` and `/q/<code>`.

### Success Criteria:

#### Automated Verification:

- Linting passes: `bun run lint`
- Formatting passes: `bun run format`
- `grep -rn "one session, one quiz, one room" context/foundation/` returns only amended, quoted-history
  occurrences

#### Manual Verification:

- A reader who knows only these documents can author a second quiz and run a session from them
- No `CLAUDE.md` still asserts an invariant the code stopped holding

---

## Testing Strategy

### Unit Tests:

- **The registry gate, in both directions.** Each of the four cross-quiz rules (duplicate quiz id,
  duplicate code, cross-quiz question id, empty registry) needs a fixture that trips it *and*
  confirmation the suite passes without it. `lessons.md:144-162` — a guard checked in only one
  direction has been checked, not verified.
- **`quizId` back-compat.** A document without the field parses, and the test asserts the resulting
  *value*, not merely that parsing succeeded.
- **`start`'s three branches:** same quiz (200 idempotent), different quiz (409 naming the title),
  absent/unknown quiz id (refused, outcome asserted).
- **The mismatch branch in `render.ts`**, with a fixture proven to reach it.
- **Fixtures come from `questionOfKind` over the registry**, never by id, index or transcribed content
  (`src/quiz/CLAUDE.md:26-54`).

### Integration Tests:

- E2E: open a host panel by slug, start, join from `/quiz/<slug>`, and confirm the verb the phase
  allows — reusing `e2e/support/host-session.ts`'s setup and purge rather than re-implementing them.
- E2E: `/q/<code>` lands on the quiz.

### Manual Testing Steps:

1. Author a second quiz with a deliberately colliding question id; confirm `bun run build` fails and
   names both quizzes. Fix and confirm it passes.
2. Open `/quiz/host`, pick a quiz, start it, and join from a phone via the QR.
3. With that session running, open the other quiz's host panel and press start — confirm the 409 copy.
4. On a second phone, open the *other* quiz's attendee URL — confirm the mismatch message and that its
   link joins the running session.
5. Type `/q/<code>` on a phone and confirm one-step arrival.
6. Run the session to the close, then `bun run quiz:reset`, and start the other quiz.

## Performance Considerations

The registry is parsed and projected once at module scope, as the single quiz is today — no per-request
cost is added. Global question-id uniqueness is what keeps `GET /api/quiz/host/participation` and
`/words` from having to read the session to learn the quiz; those are the polled routes, and the
saving they document (`participation.ts:98-104` — two billed Upstash commands, not three) recurs every
~2.5 s for a whole session. Do not regress it by "simplifying" a question lookup to take a quiz id
read from the store.

## Migration Notes

A session running across the deploy keeps working: `quizId` defaults to a sentinel, the document
parses, and the host can finish and close normally. Because the sentinel is not a real quiz id, a
mid-session deploy cannot make an old document claim a current quiz — it fails toward refusal, and
`bun run quiz:reset` is the documented way out (runbook step 4). Old QR codes and bookmarks pointing at
`/quiz` keep working through Phase 3's redirector.

## References

- Research: `context/changes/multiple-quizzes/research.md`
- Retention rules: `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md`
- Why the quiz is source, not a collection: `src/quiz/CLAUDE.md`
- Field categories on `SessionState`: `src/lib/session/CLAUDE.md`
- Recurring rules this plan leans on: `context/foundation/lessons.md:12-29`, `:48-70`, `:101-120`,
  `:122-142`, `:144-162`, `:164-181`
- The commit that made swapping the quiz cheap: `a004df7`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: The quiz registry and its build gate

#### Automated

- [x] 1.1 Unit tests pass: `bun run test` — dff8dde
- [x] 1.2 Type checking passes: `bun run type-check` — dff8dde
- [x] 1.3 Linting passes: `bun run lint` — dff8dde
- [x] 1.4 Build succeeds with the gate active: `bun run build` — dff8dde
- [x] 1.5 The cross-quiz question-id gate fires on a colliding fixture — dff8dde
- [x] 1.6 The recursive portability scan reaches `src/quiz/definitions/` — dff8dde

#### Manual

- [x] 1.7 `/quiz` and `/quiz/host` behave exactly as before this phase — dff8dde
- [x] 1.8 A malformed second quiz produces a Polish build error naming the quiz — dff8dde

### Phase 2: Quiz identity on the session document

#### Automated

- [x] 2.1 Unit tests pass: `bun run test`
- [x] 2.2 Type checking passes: `bun run type-check`
- [x] 2.3 Linting passes: `bun run lint`
- [x] 2.4 A document written without `quizId` parses, with the resulting value asserted
- [x] 2.5 `start` returns 409 for a different quiz and 200 `already-started` for the same one
- [x] 2.6 `start` refuses an absent and an unknown quiz id, outcome asserted
- [x] 2.7 Break-the-guard: reverting the `quizId` `superRefine` fails the named test

#### Manual

- [x] 2.8 A full session runs end to end on two devices with no visible change
- [x] 2.9 The 409 copy appears on the host panel when a different quiz is requested

### Phase 3: A URL per quiz

#### Automated

- [ ] 3.1 Unit tests pass: `bun run test`
- [ ] 3.2 Type checking passes: `bun run type-check`
- [ ] 3.3 Linting passes: `bun run lint`
- [ ] 3.4 Build succeeds: `bun run build`
- [ ] 3.5 E2E passes: `bun run e2e`
- [ ] 3.6 Editing each moved page runs its sibling suite via the per-edit hook
- [ ] 3.7 An unknown slug returns 404 on both quiz routes

#### Manual

- [ ] 3.8 `/quiz/host` lists the quizzes and each link opens the right panel
- [ ] 3.9 The projector QR resolves to `/quiz/<slug>` and a phone joins through it
- [ ] 3.10 `/quiz` redirects with a session and shows `brak sesji` without one
- [ ] 3.11 A full session runs end to end on two devices through the new addresses

### Phase 4: The short join code

#### Automated

- [ ] 4.1 Unit tests pass: `bun run test`
- [ ] 4.2 Type checking passes: `bun run type-check`
- [ ] 4.3 Linting passes: `bun run lint`
- [ ] 4.4 Build succeeds: `bun run build`
- [ ] 4.5 A known code redirects; an unknown code renders the fallback page

#### Manual

- [ ] 4.6 Typing `/q/<code>` on a phone reaches the quiz in one step
- [ ] 4.7 The code is legible from the back of the room

### Phase 5: Mismatch is visible on the attendee's phone

#### Automated

- [ ] 5.1 Unit tests pass: `bun run test`
- [ ] 5.2 Type checking passes: `bun run type-check`
- [ ] 5.3 Linting passes: `bun run lint`
- [ ] 5.4 The mismatch branch is covered by a fixture proven to reach it
- [ ] 5.5 Break-the-guard: removing the comparison fails the named test
- [ ] 5.6 `boundary.test.ts` still passes

#### Manual

- [ ] 5.7 A phone left on the wrong quiz shows the message, and its link joins the running session
- [ ] 5.8 The message never appears during a normal session

### Phase 6: The documents that now assert something false

#### Automated

- [ ] 6.1 Linting passes: `bun run lint`
- [ ] 6.2 Formatting passes: `bun run format`
- [ ] 6.3 The non-goal appears only as amended, quoted history

#### Manual

- [ ] 6.4 A reader can author a second quiz and run a session from the documents alone
- [ ] 6.5 No `CLAUDE.md` still asserts an invariant the code stopped holding
