---
date: 2026-08-16T19:14:11+0200
researcher: Jedrzej Meder
git_commit: 06b583cafb805e48afa61dd7d911d759b7e89579
branch: main
repository: ai-community-szn
topic: "Several independent quiz definitions, host picks one when starting a session"
tags: [research, codebase, quiz, session, host, keys, boundary, build-gate]
status: complete
last_updated: 2026-08-16
last_updated_by: Jedrzej Meder
---

# Research: several independent quiz definitions

**Date**: 2026-08-16T19:14:11+0200
**Researcher**: Jedrzej Meder
**Git Commit**: `06b583cafb805e48afa61dd7d911d759b7e89579` (local HEAD is ahead of `origin/main` at `5cc2da2` — GitHub permalinks omitted, they would 404)
**Branch**: main
**Repository**: ai-community-szn

## Research Question

> chcialbym, zeby mozna bylo kilka niezaleznych od siebie quizow

Scoped with the requester to: **several quiz definitions live in the repo; the host picks one when starting a session; there is still only ONE live session at a time.** The parallel-rooms reading was explicitly excluded. Depth requested: full map of what has to change.

## Summary

Six findings, in the order they should shape a plan.

1. **This overturns a written non-goal, and only half of one.** `prd.md:510-511` reads *"No parallel sessions and no multiple quizzes. One session, one quiz, one room at a time. This removes session management from the change entirely."* — restated verbatim at `shape-notes.md:437-438` and `roadmap.md:658-659`. The chosen scope keeps *one session, one room* and overturns *one quiz*. The half being kept is what makes this tractable: no key needs a quiz dimension, because only one session's data ever exists at a time.

2. **There is no quiz identity anywhere in the repo.** `quizSchema` is `z.object({ questions })` and nothing else (`src/quiz/schema.ts:281-297`); `quizDefinition` is `{ questions: [...] } satisfies Quiz` (`definition.ts:33`); `PublicQuiz` is `{ questions }` (`public.ts:74`); `SessionState` has no quiz field (`state.ts:87-289`). A repo-wide grep for `quizId|quizSlug|quizTitle|quiz_id` returns nothing under `src/`, `scripts/`, `e2e/`. **Inventing that identity is step one and everything else hangs off it.**

3. **The sharpest risk is question-id collision between quizzes, and every existing guard passes on it.** Question ids are unique only *within* a quiz (`schema.ts:288-296`) and `definition.ts:8-10` recommends subject-descriptive slugs (`gotowi`, `powitanie`) — exactly the style two quizzes for the same meetup collide on. On a collision the schema guard, the routes and the client all proceed and produce wrong output silently: wrong `kind` branch, wrong scoring key, wrong deadline, wrong published answer key, and un-purged tallies from quiz A read as quiz B's distribution. Details in [Risk 1](#risk-1--question-id-collision-is-silent-and-wrong-in-six-places).

4. **The transition is already half-built, in one module.** `projectQuiz(source: Quiz = quiz)` (`public.ts:213`) and `forbiddenAnswerValues(source = quiz)` (`public.ts:239`) already take a quiz; they were parameterised in commit `a004df7` for test generation. Everything else is a module-scope singleton: `quiz` (`index.ts:51`), `publicQuiz` (`public.ts:217`), `getQuestionById` (`index.ts:68`), `getPublicQuestionById` (`public.ts:220`), and — in the wrong module entirely — `nextQuestionId` (`state.ts:437-450`), which reads `quiz.questions` directly and is the project's only question-order accessor.

5. **Two failure modes are silent-and-inert rather than loud**, and both need a deliberate answer: `start` is create-if-absent so a requested quiz is ignored whenever a stale session exists ([Risk 2](#risk-2--start-silently-ignores-the-selection)); and both pages bake one projection at render, so a page rendered for quiz A that receives quiz B's snapshot goes permanently blank with no error and no reload ([Risk 3](#risk-3--a-page-rendered-for-the-wrong-quiz-goes-inert-and-says-nothing)).

6. **A build-gate rule closes most of the risk cheaply.** If question ids are required to be globally unique *across all quizzes*, checked at config load beside `assertQuizValid`, then Risk 1 evaporates, `getQuestionById` can stay quiz-agnostic, and the two polled routes that deliberately do not read the session (`participation.ts`, `words.ts`) can keep not reading it. That is the single highest-leverage decision in this change — see [Open Questions](#open-questions) Q2.

## Detailed Findings

### `src/quiz/` — the definition layer

**The singletons.** `src/quiz/index.ts:51` is `export const quiz: Quiz = parseOrThrow(quizDefinition)` — parsed once at module scope, deliberately (`context/archive/2026-08-05-quiz-definition-and-validation/plan.md:487-489`: *"do not re-parse the quiz per request… parse once at module scope"*). `getQuestionById(id)` (`index.ts:68-70`) is a linear `find` closing over it, returning `undefined` on a miss by design. There is **no exported accessor for question order, count or metadata** — consumers reach into `quiz.questions` directly.

**The projection.** `public.ts` builds `PublicQuestion` by allowlist (`public.ts:161-197`), never by deletion, and shuffles options with a seed of `` `${question.id}:${SHUFFLE_SALT}` `` (`public.ts:192`, salt at `:104`). Two consequences for this change: identical question ids across quizzes produce identical option permutations, and `SHUFFLE_SALT` is one global knob — a bad draw in one quiz forces a bump that re-permutes every quiz.

**The schema.** `quizSchema` (`schema.ts:281-297`) applies per-quiz and would apply unchanged to each member of a registry. What does *not* extend: the duplicate-id `superRefine` is scoped inside one quiz, and there is no uniqueness rule for quiz ids because no quiz id exists.

**The build gate.** `astro.config.ts:21` calls `assertQuizValid()` at config load; the comment at `:7-20` records why it is not an `astro:build:start` integration and forbids moving it to `prebuild`. `assertQuizValid` (`index.ts:59-61`) walks exactly one literal. `InvalidQuizDefinitionError`'s message hardcodes `"(src/quiz/definition.ts)"` at `index.ts:28` — **that string is the only "which file" signal an organizer gets from a failed build**, and with N quizzes it has to name which one failed.

**No path alias exists.** `tsconfig.json` has no `paths`; every import is relative (`../../quiz/index`). `@/quiz` appears nowhere.

### `src/lib/session/` — what the session remembers

`SessionState` (`state.ts:87-289`) carries `version`, `phase`, `currentQuestionId`, `startedAt`, `updatedAt`, `playerCount`, three reveal fields, and `standings`. **`currentQuestionId` is the only field referencing question identity, and it is a bare string** with nothing saying which quiz it came from.

Its first `superRefine` (`state.ts:295-306`) is the guard this change collides with head-on:

> *"Sesja wskazuje na pytanie \"X\", którego nie ma w definicji quizu. Prawdopodobnie quiz został zmieniony w trakcie trwającej sesji."*

The comment at `:291-294` says an unknown id *"means the definition changed under a live session — a deploy mid-segment"*. With several quizzes, that clause either passes everything or rejects everything unless it learns the session's quiz. `docs/runbook-live-session.md:460` and `context/archive/2026-08-06-session-state-and-realtime-spine/plan.md:643` both encode the same single-quiz reading.

**`nextQuestionId` (`state.ts:437-450`) is the question-order accessor and it lives in the session layer**, reading the singleton with no quiz parameter. It also **conflates "unknown id" with "past the last question"** — both return `null` (`:447`), and `advance.ts:33` turns both into a silent 200 no-op.

**Back-compat mechanism.** There is no schema-version field; the mechanism is `.default()` on every field added after launch (`playerCount` `:127`, the three reveal fields `:151,:187,:218`, `standings` `:288`), each with the same comment: a document written before the field shipped must still parse *"or the host's next action 409s mid-segment"*. **The obvious default for a new `quizId` is the bug**: `.default(currentQuizId)` makes an in-flight quiz-A document claim to be quiz B, which is precisely the silent mis-scoring of Risk 1. `.default(null)` plus an explicit *unknown quiz ⇒ refuse* branch is the only shape that preserves the existing failure posture.

**Keys need no quiz dimension, and must not get one.** `keys.ts:40-137` registers seven `livequiz:` names; `answers` and `tallies` already encode question ids in *field* names (`answers.ts:150-152`; `tallies.ts:28,42,63`), never in key names. `ANSWERS_KEY`'s own docstring states the rule: *"A per-question name would have to be assembled at runtime, and a runtime-assembled name is exactly what this registry cannot see — reached by neither `end` nor `purge`, and invisible to `keys.test.ts`."* A `livequiz:${quizId}:tallies` would be invisible three ways over. Since only one session exists at a time, the quiz id belongs **on the session document**, and the established pattern for anything finer is a compound field inside one hash.

**Stale data is the norm, not the exception.** `end` only shortens the lifetime to `ENDED_TTL_SECONDS` (10 min, `store.ts:82`); an abandoned session survives `SESSION_TTL_SECONDS` (4 h, `store.ts:66`) — named as the realistic outcome at `store.ts:60-63`. `purgeSession` (`store.ts:1555-1581`) is the only deletion, and the runbook makes `bun run quiz:reset` a **mandatory** pre-session step for exactly this reason (`runbook-live-session.md` step 4).

### Routes and views

Exactly **four routes** import `src/quiz/`: `answer.ts:15,156`, `host/reveal.ts:11,84`, `host/participation.ts:12,93`, `host/words.ts:9,100`. `answer.ts` already reads the session document (`:128`), so it could learn the quiz from it for free. **`participation.ts` and `words.ts` deliberately do not** — `participation.ts:98-104` prices that saving explicitly at two billed Upstash commands rather than three, and these are the *polled* routes (~every 2.5 s for the whole session). Making them read the session to learn the quiz is a real, recurring cost.

**`host/start.ts:25` is the only creation point and it parses nothing.** `extractSecret` (`host.ts:74`) reads the header, and only if absent calls `request.formData()` for `secret`, discarding the rest — and `formData()` cannot be read twice, so a `quizId` field needs `extractHostFields`-style widening (`host.ts:103`, which already parses the form once for `version`). `initialSessionState(now)` (`state.ts:409`) takes no quiz.

**Both pages bake one projection at render.** `host.astro:8` and `index.astro:13` value-import `publicQuiz` in frontmatter (legal — frontmatter is excluded from the boundary scan). What crosses to the browser is exactly four variables on the host (`host.astro:997-1006`: `channelName`, `snapshotEvent`, `secretHeader`, `questions`) and six on the attendee (`index.astro:445-463`). Also baked: `questionTotal = publicQuiz.questions.length` (`host.astro:87`, rendered at `:206` before any snapshot) and the join QR SVG (`host.astro:134`, from `attendeeUrl` built at `:68`).

**`boundary.test.ts` does not stand in the way.** It is a textual scan that blanks frontmatter before reading (`:75`, `:86`) and forbids only `import.meta.env` and *value* imports matching `/^quiz\//` or `/^lib\/session\//` inside `src/lib/client/*.ts` and `<script>` bodies (`:57,:126-151`). Passing `quizId` or a second projection through `define:vars` is the same shape as today's `questions: publicQuiz.questions` — the sanctioned escape hatch its own failure message names (`:335-337`). What *would* violate it is a `<script>` importing a quiz registry, or reading env to pick a quiz.

**Query params are already the precedent.** `GET /api/quiz/host/participation` and `.../words` read `?questionId=` (`participation.ts:90`, `words.ts:93`, built at `controls.ts:326`); these are the only two routes reading `url.searchParams`. There are **no dynamic route segments** anywhere under `src/pages/quiz/` or `src/pages/api/quiz/`, and every one of those routes is on-demand (no `prerender`), so reading `Astro.url.searchParams` in frontmatter needs no rendering-mode change.

### The three risks

#### Risk 1 — question-id collision is silent and wrong in six places

Ids validate only as lowercase slugs (`schema.ts:22`) and are unique only within a quiz. If quiz A and quiz B share an id, the session's `currentQuestionId` resolves under whichever quiz the process imported and **every guard passes**:

- `answer.ts:224/268/306/374` branches on B's `kind` while the phone rendered A's — a text question scored as a number, or `question.options` read off a question that has none.
- `scoring.ts:118/168/275` compares against B's `correctOptionIds` / `acceptedAnswers` / `correctValue` — a wrong verdict, no error anywhere.
- `deadline.ts:70` uses B's `timeLimitSeconds`, so the enforced window differs from the countdown the phone rendered from A's.
- `reveal.ts:141` publishes B's `correctOptionIds` to 150 phones as *the answer key*; `reveal.ts:32-35` publishes B's `acceptedAnswers[0]` or formatted `correctValue` as `revealedAnswerText`. If B's same-id question is a non-choice kind, `revealedOptionIds` becomes `[]` — rendered as "nothing to highlight", which looks like a correct unscored reveal.
- `tallies.ts:28/42/63` and `answers.ts:150` reuse the id, so **un-purged counters from quiz A are read as quiz B's distribution and word cloud** (`store.ts:1209,:1288`).
- On the attendee's own device, `QUESTION_SEEN_STORAGE_KEY` is a `{ [questionId]: epochMs }` map that **no purge reaches** (`keys.ts:259`) — reused ids land in the same map across quizzes.

Non-colliding ids fail loudly instead, but at the worst place: `readSession` → `invalid` → **409 on every host action including `end`** (`end.ts:76-83`), leaving the session closable only through `purge`.

#### Risk 2 — `start` silently ignores the selection

`createSession` runs `CREATE_IF_ABSENT` and never overwrites (`store.ts:583-619`, `:578-582`). On `exists`, `start.ts:64,87-90` republishes the **old** state and answers 200 `note:"already-started"`. With a quiz selector, pressing start for quiz B within the 10-minute (ended) or 4-hour (abandoned) window rebroadcasts quiz A, and nothing on the host panel distinguishes "started your new quiz" from "re-broadcast the old one". The runbook already warns about the same mechanism (*"without a reset, it picks up the previous session… The four-hour TTL will not save you."*), but a quiz selector makes the failure look like a working feature.

#### Risk 3 — a page rendered for the wrong quiz goes inert and says nothing

Every client-side question lookup resolves `currentQuestionId` against the projection frozen at page render:

- Host: `questionFor` (`host.astro:1552`), the counter (`:2231`), the countdown (`:2647`), `atLastQuestion` (`controls.ts:257`), `pollTargetFor` (`controls.ts:325`).
- Attendee: `indexOfQuestion` (`index.astro:762`), `:955`, the closing rank fetch `:1099`, `sendAnswer` `:1975`.

A miss yields `undefined` everywhere. On the host: no prompt, no counter, `pollTargetFor` → `null` so no poll and no panel, `syncRail` hides the rail, and `atLastQuestion` stays `false` forever so `end` never takes the next-step ring and never reparents to `#end-slot-bar`. On the attendee: `renderOpen`'s `!question` branch (`index.astro:1257`) paints a neutral placeholder with `hideAnswerControls()`. **The page looks alive and is inert, and nothing forces a reload.**

### Test-suite blast radius

| Guard | Where | What breaks |
| --- | --- | --- |
| `portability.test.ts:40-42` | flat, non-recursive `readdirSync` of `src/quiz/` | A registry at `src/quiz/definitions/*.ts` is **silently unscanned** — the `astro:`-import gate quietly stops covering the new files. The file's own header (`:16-22`) warns about exactly this class. |
| `definition.test.ts:49` | "exercises every question kind" | **The one assertion that must be redesigned, not looped.** Per-quiz makes a short quiz impossible to author; over the union it stops protecting the by-kind fixture derivation unless `test-support.ts` also picks from the union. |
| `test-support.ts:48,65` | `questionsOfKind` / `questionOfKind` filter the singleton | Need a quiz argument; ~10 test files inherit the change. Throw message at `:77-81` names `definition.ts`. |
| `definition.test.ts:130` | `getQuestionById(id)` identity assertion | Ambiguous across quizzes with colliding ids. |
| positional fixtures | `state.test.ts:79,83,87,…`, `store.test.ts:59,86,1597`, `host/routes.test.ts:54,…`, `result.test.ts:19` | `quiz.questions[0]/[1]/[last]` — "which quiz's question 0" becomes ambiguous. `lessons.md:50-70` already has an entry about positional indexes into real data. |
| `host.test.ts` (~40 counts) | notably `:768-769` `not.toContain("questions.length - 1")` and `not.toContain("function atLastQuestion")`; `:342` no local `pollTargetFor`; `:622` no `CONTROL_RULES`; `:816` one `setHidden(railBox`; `:647` exactly 4 `syncControls()` | A selector that recomputes order or predicates inline fails these. Function bodies are carved by 6-space-indent regexes — reindenting the `<script>` block silently empties most carves. |
| `keys.test.ts` | textual scan for `livequiz:` literals outside `keys.ts` | Only matters if a new key is introduced — which the [keys finding](#srclibsession--what-the-session-remembers) argues against. |
| `boundary.test.ts` | value imports into client scripts | Satisfied by `define:vars`; violated by importing a registry into a `<script>`. |

`schema.test.ts` and `normalize.test.ts` use synthetic fixtures only and are unaffected. `public.test.ts` is already split into a generated-population half (`:252-303`) and a committed-quiz conformance half (`:316-317`).

## Code References

- `src/quiz/index.ts:28` — error message hardcoding `definition.ts`; the only "which quiz failed" signal at build time
- `src/quiz/index.ts:51,59,68` — the `quiz` singleton, `assertQuizValid`, `getQuestionById`
- `src/quiz/public.ts:104,192,213,217,220,239` — shuffle salt and seed, `projectQuiz(source)` (already parameterised), `publicQuiz`, `getPublicQuestionById`
- `src/quiz/schema.ts:281-297` — `quizSchema`: one key, no identity, per-quiz duplicate-id rule
- `src/quiz/test-support.ts:48,65,77-81` — by-kind fixture accessors bound to the singleton
- `src/quiz/portability.test.ts:40-42` — the non-recursive scan
- `src/quiz/definition.test.ts:49,70,127-143` — every-kind rule, unscored opener, `getQuestionById` identity
- `src/lib/session/state.ts:87-289` — `SessionState`; `:295-306` the mid-session-mismatch guard; `:409` `initialSessionState`; `:437-450` `nextQuestionId`
- `src/lib/session/keys.ts:40-137,259` — the registry; `QUESTION_SEEN_STORAGE_KEY` that purge never reaches
- `src/lib/session/store.ts:60-66,82,578-619,1209,1288,1555-1581` — TTLs, create-if-absent, tally reads, purge
- `src/pages/api/quiz/host/start.ts:25,64,87-90` — the only creation point; the `already-started` branch
- `src/pages/api/quiz/host/host.ts:74,103` — `extractSecret` vs `extractHostFields` (the form is parsed once)
- `src/pages/api/quiz/answer.ts:15,128,156` — reads the session *and* the raw definition
- `src/pages/api/quiz/host/reveal.ts:11,32-35,84,141` — publishes the answer key
- `src/pages/api/quiz/host/participation.ts:90,93,98-104` / `words.ts:93,100,114` — the polled routes and the two-command saving
- `src/pages/quiz/host.astro:8,68,87,134,997-1006,1552,2231,2647` — frontmatter bakes, `define:vars`, client lookups
- `src/pages/quiz/index.astro:13,445-463,762,955,1099,1257,1975` — same on the attendee side
- `src/lib/client/controls.ts:257,297,325-326` — `atLastQuestion`, `pollTargetFor`, the `?questionId=` URL
- `src/lib/client/boundary.test.ts:57,75,86,126-151,335-337` — the boundary rule and its sanctioned escape hatch
- `astro.config.ts:5,7-20,21` — the build gate and why it lives at config load

## Architecture Insights

- **The identity belongs on the session document, not in a key name.** Because only one session runs at a time, no `livequiz:` key needs a quiz dimension — and `keys.ts` structurally forbids the runtime-assembled name such a dimension would require. One defaulted-null field on `SessionState`, set once at `start`, is the whole storage change.
- **A new *third* category of `SessionState` field.** CLAUDE.md documents two: decoration (`playerCount`, overwritten every action, stale is harmless) and transition fields (set by exactly one constructor, nulled by every other, each with its own `superRefine`). A `quizId` is neither — it is **session identity**: written once by `initialSessionState`, never changed, never nulled, and read by the guard rather than rendered. Its guard clause is the inverse of the others: not "is this field null in the wrong phase" but "does `currentQuestionId` belong to *this* quiz".
- **Globally-unique question ids is the cheap version of this change.** Enforce uniqueness across all quizzes at the build gate, and: Risk 1 disappears; `getQuestionById` can stay quiz-agnostic (a flat lookup across the registry); `participation.ts` and `words.ts` keep their two-command saving; the tally and answer field formats need no change; the `superRefine` guard keeps its current meaning. The cost is an authoring constraint the gate reports loudly at build time — which is exactly the trade the project already makes everywhere else in `schema.ts`.
- **`projectQuiz(source)` shows the intended shape.** The pattern the repo already reached for is *a pure function taking a quiz, plus a module-scope memo of the default*. Extending it means each accessor gains a quiz parameter and the memo becomes a registry-keyed map.
- **The client boundary is not an obstacle here.** Frontmatter is the sanctioned place to resolve which quiz, and `define:vars` is the sanctioned way to hand it down. The work is in making the *selection* reach frontmatter (URL query on both pages, with the host's QR carrying it to the attendee) and in making a mismatched page notice rather than go quiet.
- **Operationally, "which quiz is live" is currently answered by "which commit is deployed"** (`runbook-live-session.md` step 1). A selector moves that answer from the deploy to a host action, which is a real improvement to the FR-001 accepted risk — but it also adds a new pre-session thing to verify, and step 4's mandatory reset gains a second reason to exist.

## Historical Context (from prior changes)

- `context/foundation/prd.md:281-285` — **FR-001**: quiz authored in a file, no builder interface. The Socratic block resolves an explicit counter-argument: *"A non-developer edit path is the builder interface the product exists to avoid."* Restated as a load-bearing non-goal at `prd.md:507-509`. **Several definitions in source do not touch this** — they are still developer-authored files; a picker that only *selects* among committed quizzes is not a builder. Worth stating explicitly in the plan, because it will look like a violation.
- `context/foundation/prd.md:510-511`, `shape-notes.md:437-438`, `roadmap.md:658-659` — the "one session, one quiz, one room" non-goal, in three places. All three need amending; `lessons.md:164-181` ("The CLAUDE.md edit is part of the slice") makes CLAUDE.md a fourth, and `CLAUDE.md:145-195` plus the `keys.ts`/`state.ts` docstrings carry the claims that would become false.
- Commit `a004df7` (2026-08-16), *"test(quiz): stop pinning the suite to the committed quiz's content"* — the direct ancestor of this change. It created `test-support.ts`, parameterised `projectQuiz`, and records: *"Swapping the question set for the next event failed six assertions in `definition.test.ts` plus fixtures in four session and route files."* Verified by replacing the whole definition with five unrelated questions. Summarised at `CLAUDE.md:168-172`. **This change is the same problem's next step**: that commit made swapping the quiz cheap; this one makes swapping it a host action.
- `context/archive/2026-08-06-session-end-and-data-purge/retention-contract.md` — four rules. Rule 1 (every key declared in `keys.ts`) is what forbids a per-quiz key. Rule 3 (assume anything published to Ably is readable ~2 min) applies to a quiz id on the snapshot — formally satisfied, since a quiz id is quiz content, not attendee data (cf. `state.ts:142`).
- `context/archive/2026-08-07-join-and-follow-host/join-contract.md` — the option shuffle is seeded by question id *"so every device and the server agree, and the order survives a reload"*, and `SHUFFLE_SALT` is the documented remedy for a bad draw. Also: `PLAYER_STORAGE_KEY` is reached by no purge.
- `context/archive/2026-08-14-resilient-join/resume-contract.md` — the device id **deliberately survives across sessions** (clearing it would hand a fresh allowance to anyone reloading after a purge), while the player does not. So a quiz switch inherits: device persists, player dies, `QUESTION_SEEN_STORAGE_KEY` persists keyed by question id.
- `context/archive/2026-08-14-final-winner-reveal/winner-reveal-contract.md` — `end` may never be refused over a read it could not do; the closing snapshot carries no `currentQuestionId`, so the phone sends the last question's id to `/api/quiz/result`. Under multiple quizzes that phone-supplied id needs the same collision reasoning as everything else.
- `context/foundation/roadmap.md:114-121` — the baseline rule that S-02…S-08 read the quiz *through* `src/quiz/index.ts` and must not import `definition.ts` directly. A registry must preserve that single front door.
- **No prior open question about multiple quizzes exists** — not in `prd.md` §Open Questions (7 items) nor `roadmap.md` §Open Roadmap Questions (9 items). This is new ground, parked rather than deferred.

## Related Research

- `context/changes/testing-host-control-rules/research.md` — **status `implementing`, and it is actively rewriting `src/pages/quiz/host.astro` and `src/lib/client/controls.ts` right now.** It moved the phase→verb table out of `host.astro` into a private `verbsFor` in `controls.ts` and retired the single-reader source scan. Any plan here must land after it, or expect conflicts in the same two files.
- `context/changes/quiz-animations-and-transitions/change.md` — `status: new`, no plan; also targets the quiz views.
- `context/foundation/test-plan.md:132` — treats "quiz definition validity" as already enforced at build/config load, with *"the previous good quiz stays live"* as the safe outcome. That sentence assumes one quiz.

## Open Questions

1. **How does the host choose, and how does the choice reach the attendee?** A `?quiz=` query on `/quiz/host` read in frontmatter is the cheapest (all routes are on-demand; `?questionId=` is the precedent), and `host.astro:68` already builds `attendeeUrl` from `Astro.url` so the QR could carry it. The alternative — a picker in the host menu plus a `quizId` form field on `start` — keeps the URL clean but leaves the attendee page to learn the quiz from the snapshot, which means re-render or reload. **Both halves need one answer, not two.**
2. **Are question ids globally unique across quizzes, enforced at the build gate?** This is the load-bearing decision. Yes → Risk 1 closes, accessors stay quiz-agnostic, the polled routes keep their two-command saving, field formats are untouched. No → every question resolution needs the session's quiz, including the two routes that deliberately avoid reading the session at ~every 2.5 s for a whole session.
3. **What does `start` do when a session already exists for a different quiz?** Today it silently republishes the old one as 200 `already-started`. Options: keep that (and rely on the runbook's mandatory reset), or 409 naming the running quiz. The second is the only one that makes the failure visible on the panel.
4. **What is the registry's shape on disk** — flat `src/quiz/definitions/<slug>.ts` or a directory per quiz — and does `portability.test.ts` become recursive in the same phase? (It must, or the `astro:`-import gate silently stops covering the new files.)
5. **How does `definition.test.ts:49`'s every-kind rule get restated** for N quizzes without either burdening every quiz with all five kinds or hollowing out the by-kind fixture derivation in `test-support.ts`?
6. **Does a quiz gain a title, and where does it show?** A picker needs one; the lobby projector might want it; `PublicQuiz` currently has no room for it and `SessionState` would be the wrong place (it is quiz content the page already has).
7. **Should a page whose baked projection does not match the incoming snapshot reload itself?** Today it goes quiet (Risk 3). A `quizId` on the snapshot compared against a `define:vars` value is the natural detector, but a forced reload mid-session is its own hazard on 150 phones.
8. **Does `SHUFFLE_SALT` stay global** or become per-quiz? Global means a bad draw in one quiz re-permutes all of them; per-quiz means a new authoring field with its own gate.
