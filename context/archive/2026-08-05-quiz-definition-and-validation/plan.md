# Quiz Definition and Validation — Implementation Plan

## Overview

Roadmap item **S-01**, PRD **FR-001** and **FR-017**. Deliver the quiz as a typed, Zod-validated
TypeScript definition authored alongside the project's source, carrying all 14 drafted questions
across four mechanics, with domain invariants enforced by a gate that fails `astro build` — and
therefore the Vercel deploy — rather than surfacing on stage.

This is the data contract S-02 through S-08 read. Nothing in it scores, matches, or runs a session.

## Current State Analysis

Probed in the repository on `2026-08-05`:

- **Quiz content exists only as prose.** `idea-notes.md:41-56` drafts 14 questions in Polish across
  exactly four mechanics: word cloud (Q1), multiple choice (Q2, Q8), single choice (Q3, Q5, Q6, Q7,
  Q9, Q11, Q12, Q13), free text (Q4), guess-the-number (Q10, Q14). Nothing machine-readable exists.
- **The draft is incomplete for 8 questions.** Q3, Q5, Q6, Q7, Q9, Q11, Q12 and Q13 name only the
  correct answer — the distractor options were never written. Q2 is the "everything is correct"
  gather question; Q1 is the unscored word cloud.
- **Content validation has a precedent, but not a matching one.** `src/content.config.ts` defines two
  glob-loaded, Zod-validated collections (`events`, `speakers`) fed by Markdown. That is the CMS for
  organizer-edited site content. The quiz is developer-authored source, not site content, and PRD
  §Non-Goals rules out changing how existing content is authored.
- **`zod` resolves at 4.3.6 in `node_modules` but is not a declared dependency** — it arrives
  transitively through Astro, re-exported as `astro:content`'s `z`.
- **`astro:content` is not resolvable in a bare `vitest run`.** Validation written against it would
  need extra Vite configuration for tests; validation written against `zod` directly does not.
- **The test pattern to copy is `src/lib/newsletter.test.ts`** — a plain vitest suite over a
  `src/lib/` module with named exports and no default export. `vitest` is a devDependency with `test`
  and `test:watch` scripts; there is no `vitest.config.*` file, so vitest runs on defaults.
- **Nothing runs between a commit and production.** No `.github/`, no CI, no linter, no formatter, no
  pre-deploy gate. `bun run test` and `bun run type-check` execute only when a human types them.
- **`astro.config.ts` has no `integrations` array today** — `output: "server"`, `adapter: vercel()`,
  and Tailwind through `vite.plugins`. Adding an integration means introducing the array.

### Key Discoveries

- **The Polish diacritic trap is real and verified.** The idiomatic fold
  `s.normalize("NFD").replace(/\p{Diacritic}/gu, "")` correctly folds `ż ó ć ę ą ś ń ź` but leaves
  `ł` and `Ł` completely untouched — `ł` is an atomic codepoint with no combining-mark decomposition.
  Verified in this repo's Node: `"żółć łódź"` folds to `"zołc łodz"`. Q4's accepted variants are
  exactly the content this would fail on.
- **A `prebuild` script is the wrong gate.** Vercel's build command is configurable, and Bun's
  handling of npm pre/post lifecycle scripts is not something a deploy gate should rest on. An
  `astro:build:start` integration hook runs inside `astro build` itself and holds regardless of what
  invokes the build.
- **The `zod` version must be pinned to what Astro already resolves.** CLAUDE.md documents a live
  precedent in this repo: a second `vite` copy nested under `node_modules/astro/` breaks `astro
  check` with a `PluginOption` type mismatch on `@tailwindcss/vite`. A duplicated `zod` is the same
  failure class — Zod's branded types are nominal, so two copies produce schemas that do not
  structurally match across the boundary.
- **Question identity is load-bearing beyond this slice.** F-02 keys authoritative session state in
  Upstash Redis, and S-09 resumes a reloaded device against an in-flight question. Positional
  identity would reassign ids on any insertion and read as `3` in logs the Hobby plan retains for one
  hour (`context/changes/deployment-target-readiness/plan.md`).

## Desired End State

- `src/quiz/definition.ts` holds all 14 questions as a typed literal, in Polish, valid against the
  schema, with drafted distractors for the 8 questions the notes left incomplete.
- `src/quiz/schema.ts` defines a discriminated union over four question kinds with domain invariants
  as refinements — not just shape checks.
- `src/quiz/normalize.ts` exports a `ł`-aware Polish normalizer, unit-tested, used by validation now
  and by S-05's matching later.
- `src/quiz/index.ts` exports the accessors S-02 onward consume: a parsed quiz and lookup by question
  id.
- `bun run build` fails with a readable, question-identifying message when the definition is
  malformed, and that failure has been observed to fail a Vercel deploy — not assumed to.
- CLAUDE.md records why the quiz is not a content collection and why `zod` is pinned.

**Verification**: `bun run test`, `bun run type-check` and `bun run build` all pass on the valid
definition; deliberately breaking an invariant makes `bun run build` fail and a preview deploy fail.

## What We're NOT Doing

- **No scoring implementation.** No point calculation, no speed weighting (FR-019), no
  all-or-nothing multi-answer evaluation, no relative-error curve (FR-013). S-03 and S-06 own those.
  The definition declares parameters; it does not consume them.
- **No free-text matching.** The normalizer ships here; the match itself is S-05's. Validation uses
  the normalizer only to detect variants that collapse to duplicates.
- **No session, transport, store, or route.** Nothing in this change touches F-02's spine, and
  nothing reads the definition at request time yet.
- **No UI.** No host view, no attendee view, no preview page for eyeballing the 14 questions. The
  build gate is the feedback mechanism this slice delivers.
- **No presentation-layer validation.** Option text length and back-of-room legibility are S-04's
  rendering concern; guessing thresholds now would produce either false rejections or rules nobody
  trusts.
- **No change to `src/content.config.ts`** or to how events and speakers are authored.
- **No CI.** Roadmap Open Question 3 stays open; this change adds a build gate, not a pipeline.

## Implementation Approach

A discriminated union on a `kind` field, parsed once by Zod, with cross-field rules expressed as
refinements rather than left to convention. The definition file is a plain TypeScript literal so that
authoring mistakes surface three times, each earlier than the last: in the editor while typing, in
`astro check`, and in the build gate. Downstream slices import a parsed, typed value and never see
the raw literal.

Phases are ordered so the schema is proven against synthetic cases before the real content is written
against it — otherwise a schema bug and a content bug are indistinguishable.

## Critical Implementation Details

**Polish normalization.** NFD-plus-diacritic-strip is insufficient for Polish. `ł` and `Ł` must be
mapped explicitly before the NFD pass; every other Polish diacritic decomposes correctly. Verified
behaviour without the mapping:

```
"żółć łódź ŁÓDŹ".normalize("NFD").replace(/\p{Diacritic}/gu, "")
// => "zołc łodz ŁODZ"   ← ł and Ł survive
```

**Zod duplication.** Declare `zod` at the exact range Astro resolves (`^4.3.6` at time of writing —
confirm against `node_modules/zod/package.json` before pinning). If `astro check` starts reporting
type mismatches on schema values after this change, a duplicated copy is the first thing to check;
the fix is `rm -rf node_modules && bun install`, matching the documented `vite` remedy.

**Gate placement.** The validation must throw from `astro:build:start`, not from module top-level in
a route. Routes that read the quiz are on-demand (`prerender` omitted), so a top-level parse in a
route would never execute during the build and the gate would silently not exist.

---

## Phase 1: Schema, types, and the Polish normalizer

### Overview

Establish the validated shape of a quiz and the normalizer, proven against synthetic fixtures. No
real quiz content exists yet at the end of this phase — that separation is deliberate, so a failing
test in Phase 2 is unambiguously a content problem.

### Changes Required:

#### 1. Declare the Zod dependency

**File**: `package.json`

**Intent**: Make `zod` an explicit dependency rather than relying on Astro's transitive copy,
declared at the range Astro itself resolves so the two deduplicate to a single hoisted copy.

**Contract**: A `zod` entry under `dependencies` matching `astro`'s own declared range — verified as
`^4.3.6` in `node_modules/astro/package.json`, with a single hoisted copy at `node_modules/zod`
today. `bun install` afterwards must leave exactly one `zod` in the tree.

Note the limit of this mitigation: a caret range does not *prevent* duplication, it merely overlaps
Astro's today. If a future Astro major moves to zod 5 while this project still declares `^4`, bun
will install two copies and `astro check` will break with the mismatch this pin exists to avoid. **An
Astro major bump is the trigger to re-check this range** — worth noting alongside the adapter pin
that `deployment-target-readiness` guards for the same reason.

#### 2. The Polish normalizer

**File**: `src/quiz/normalize.ts`

**Intent**: Fold a free-text answer to a comparable form per FR-011 — case, surrounding whitespace,
and Polish diacritics — and deliberately no further. No fuzzy matching, no edit distance, no
misspelling tolerance; PRD FR-011 records that a threshold is something the host would have to defend
out loud on stage.

**Contract**: A named export `normalizePolish(value: string): string`. Named exports only, no default
export, matching `src/lib/`'s convention. Internal whitespace collapses to single spaces; surrounding
whitespace is trimmed. The `ł`/`Ł` mapping must precede the NFD pass — see Critical Implementation
Details for why.

#### 3. The question schema

**File**: `src/quiz/schema.ts`

**Intent**: Define the four question kinds as a Zod discriminated union with the domain invariants
that a flat schema cannot express, and export the inferred TypeScript types that every later slice
consumes.

**Contract**: A discriminated union on `kind` over `"single-choice" | "multiple-choice" | "text" |
"number" | "word-cloud"`, plus a quiz-level object wrapping an ordered `questions` array.

Shared per-question fields: a hand-authored `id` (slug-shaped, stable), a `prompt` string, and
`points` — a positive number for a scored question, `null` for an unscored one. `points: null` is how
FR-017's "mark a question as unscored" is expressed; there is no separate boolean.

Kind-specific fields:

| Kind              | Fields                                                       |
| ----------------- | ------------------------------------------------------------ |
| `single-choice`   | `options: { id, text }[]`, `correctOptionIds: string[]`       |
| `multiple-choice` | `options: { id, text }[]`, `correctOptionIds: string[]`       |
| `text`            | `acceptedAnswers: string[]`                                   |
| `number`          | `correctValue: number`                                        |
| `word-cloud`      | (none beyond the shared fields)                               |

Invariants enforced as refinements, each with a message naming the offending question id:

- Question ids are unique across the quiz; option ids are unique within their question.
- A choice question has at least two options.
- `correctOptionIds` all reference options that exist on that question.
- A **scored** `single-choice` question has exactly one correct option.
- A **scored** `multiple-choice` question has at least one correct option.
- A `text` question has at least one accepted answer, and no two accepted answers collapse to the
  same value under `normalizePolish` — a redundant variant is an authoring mistake worth surfacing.
- A `number` question's `correctValue` is finite.
- A `word-cloud` question is necessarily unscored (`points: null`); it has no correct answer to score
  against, and PRD FR-015 depends on that to permit its live aggregate display.
- The quiz has at least one question.

Also export the inferred types — `Quiz`, `Question`, and the per-kind narrowed types — since the
whole point of the TS-literal choice is that S-02 onward get real inference.

**Note on scoring parameters**: `points` is the only scoring field. The speed weighting (FR-019) and
the relative-error curve (FR-013) are global rules owned by S-03 and S-06 and are deliberately absent
here — the roadmap names over-designing this format as this slice's principal risk.

#### 4. Schema and normalizer tests

**Files**: `src/quiz/normalize.test.ts`, `src/quiz/schema.test.ts`

**Intent**: Prove the normalizer against real Polish (including `ł`, which is the case that breaks
the obvious implementation) and prove every invariant rejects, using synthetic fixtures rather than
the real quiz.

**Contract**: Plain vitest suites following `src/lib/newsletter.test.ts`'s style. `normalize.test.ts`
must include `ł`/`Ł` cases explicitly, plus case folding, trimming, and the Q4-shaped variants
(`"halucynacje"`, `"Halucynacje "`). `schema.test.ts` must have one rejecting case per invariant
listed above and at least one accepting case per question kind, and must assert that the failure
message identifies the offending question.

### Success Criteria:

#### Automated Verification:

- Exactly one `zod` resolves in the dependency tree:
  `test "$(find node_modules -type d -name zod | wc -l | tr -d ' ')" = "1"`
  (note: `bun pm ls zod` does **not** work — bun ignores the package argument and exits 0 regardless,
  and plain `bun pm ls` lists only direct dependencies. `bun pm ls --all | grep -i zod` is a usable
  alternative for eyeballing the version.)
- Unit tests pass: `bun run test`
- Type checking passes with zero errors: `bun run type-check`
- Build still succeeds: `bun run build`

#### Manual Verification:

- Every invariant in the schema table has a corresponding rejecting test — read the suite against the
  list rather than trusting the count
- A rejection message names the offending question id and reads as something an organizer could act
  on minutes before showtime, not a raw Zod path dump

**Implementation Note**: After completing this phase and all automated verification passes, pause for
manual confirmation before proceeding.

---

## Phase 2: The 14-question definition and its accessors

### Overview

Author the real quiz against the proven schema, including drafted Polish distractors for the eight
questions the notes left incomplete, and expose the accessors that S-02 through S-08 will import.

### Changes Required:

#### 1. The quiz definition

**File**: `src/quiz/definition.ts`

**Intent**: Transcribe all 14 drafted questions from `idea-notes.md:41-56` into the schema's shape, in
Polish, and draft the missing distractors.

**Contract**: A single named export holding the quiz literal, typed against the schema so authoring
errors surface in the editor. Mapping from the draft:

| Draft | Kind              | Notes                                                                                  |
| ----- | ----------------- | -------------------------------------------------------------------------------------- |
| Q1    | `word-cloud`      | Unscored. "Napisz śmieszne słowo związane z AI"                                          |
| Q2    | `multiple-choice` | **Unscored** — the gather question whose four options are all correct. PRD FR-010 records that FR-017 is how this case is handled, so it carries `points: null` rather than four correct ids |
| Q3    | `single-choice`   | Correct: "Large Language Model" — **distractors to draft**                                |
| Q4    | `text`            | Accepted: halucynacje, halucynacja, hallucinations, hallucination                        |
| Q5    | `single-choice`   | Correct: "Losowość/kreatywność odpowiedzi" — **distractors to draft**                     |
| Q6    | `single-choice`   | Correct: "#veryBrave" — **distractors to draft**                                          |
| Q7    | `single-choice`   | Correct: "7" — **distractors to draft**                                                   |
| Q8    | `multiple-choice` | Scored, two correct: "Kinem plenerowym", "Networkingiem" — **distractors to draft**       |
| Q9    | `single-choice`   | Correct: "BRAVE UnAIted" — **distractors to draft**                                       |
| Q10   | `number`          | `correctValue: 67`                                                                        |
| Q11   | `single-choice`   | Correct: "Gier mobilnych" — **distractors to draft**                                      |
| Q12   | `single-choice`   | Correct: "14 września" — **distractors to draft**                                         |
| Q13   | `single-choice`   | Correct: "Szymon Negacz" — **distractors to draft**                                       |
| Q14   | `number`          | `correctValue: 10000`                                                                     |

Q10 and Q14 differing by two orders of magnitude is the case FR-013's relative-error rule exists for;
the definition carries only the true values, and S-06 owns the curve.

Point values: a uniform base for every scored question. The schema permits variation, but nothing in
the PRD asks for it, and inventing a weighting now would be a decision made without a reason.

Ids are hand-authored, slug-shaped, and describe the question's subject rather than its position
(e.g. `llm-skrot`, not `q3`) — position changes when the quiz is reordered; subject does not.

The draft's closing beat ("And the winner is… 🥁" with the loading words, then the leaderboard) is
**not** a question. It is the S-10 winner-reveal sequence and does not appear in this file.

#### 2. Accessors

**File**: `src/quiz/index.ts`

**Intent**: Give downstream slices a parsed, validated quiz and a lookup by question id, so no
consumer ever touches the raw literal or re-parses.

**Contract**: Named exports for the parsed quiz value, a lookup by question id, and an assertion
entry point the build gate calls in Phase 3. The lookup's miss behaviour must be explicit — a
question id arriving from a device is untrusted input in F-02 and must not throw into a request path.
Follow the error-handling posture CLAUDE.md names in `src/lib/slack.ts`: nothing throws into a
request path.

Re-export the schema's inferred types from here too, so consumers have one import site.

*Amended under impl-review F3:* `normalizePolish` is also re-exported from here. Not in the original
contract — recorded so S-05, which is the slice that actually needs it for FR-011 matching, does not
read it as undocumented drift.

#### 3. Definition test

**File**: `src/quiz/definition.test.ts`

**Intent**: Assert that the real, committed quiz parses — this is the test that turns an authoring
mistake into a red test rather than a stage incident.

**Contract**: Parses the definition through the schema and asserts success. Additionally asserts the
facts that make this the *drafted* quiz rather than any valid quiz: 14 questions, all four kinds
present, Q1 and Q2 unscored.

#### 4. Portability guard

**File**: `src/quiz/portability.test.ts`

**Intent**: Protect the decision that chose this format. The whole case for a TS module over a
content collection is that a plain import behaves identically in a serverless route and in vitest —
but nothing in this slice imports the quiz from a route, so that half goes unexercised until S-02.
The way it actually breaks later is someone adding an `astro:`-prefixed import inside `src/quiz/`,
which works in a page and fails in a bare `vitest run`.

**Contract**: Reads every file under `src/quiz/` and asserts none imports from an `astro:` specifier.
A failure message should say why the rule exists, not just that it was violated — a future
contributor hitting this needs the reason, which is that `astro:content` is unresolvable outside the
Astro build (verified: bare vitest reports `Cannot find package 'astro:content'`).

### Success Criteria:

#### Automated Verification:

- The real definition parses and all tests pass: `bun run test`
- Type checking passes with zero errors: `bun run type-check`
- Build succeeds: `bun run build`

#### Manual Verification:

- Read all 14 questions in Polish for correctness and tone against `idea-notes.md:41-56` — this is
  content going on a large screen at a branded community event
- The drafted distractors are plausible but unambiguously wrong; no distractor is arguably also
  correct, since the host cannot amend a question mid-session (PRD FR-016)
- Q2 reads as the gathering beat it is, and being unscored does not make it look broken

**Implementation Note**: Pause for manual confirmation before proceeding. The distractors need an
editorial pass and that is a human judgement, not an automated check.

---

## Phase 3: The build gate and the record of why

### Overview

Make a malformed definition fail the deploy rather than the evening, and write down the two decisions
a future agent would otherwise reverse.

### Changes Required:

#### 1. The build-time gate

**File**: `astro.config.ts`

**Intent**: Fail `astro build` when the quiz definition is invalid, so Vercel's deploy fails instead
of shipping a broken quiz — the mechanism that makes FR-001's "rejected loudly rather than discovered
on stage" true given there is no CI.

**Contract**: An inline Astro integration added to a new `integrations` array, hooking
`astro:build:start` and calling Phase 2's assertion entry point. On failure it must throw with the
schema's message so the build log names the offending question.

The hook must be `astro:build:start` specifically — routes reading the quiz are on-demand, so a
top-level parse in a route never runs during the build and the gate would silently not exist. Note
that this is the file's first `integrations` entry; `@astrojs/tailwind` is installed but deliberately
unused (CLAUDE.md) and must not be added alongside it.

#### 2. Project guidance

**File**: `CLAUDE.md`

**Intent**: Record the two decisions in this change that read as inconsistencies to anyone who did
not make them, so a future agent does not "fix" either.

**Contract**: Additions to the Project guide section covering (a) why the quiz lives in `src/quiz/` as
a TypeScript literal rather than a content collection — it is developer-authored source, not
organizer-edited site content, and `astro:content` is not resolvable in a bare vitest run; and (b)
why `zod` is an explicit pinned dependency, cross-referencing the existing `vite` deduplication note
as the same failure class with the same remedy. Also note that the build gate exists and what it
gates, so nobody removes the `integrations` array as dead configuration.

#### 3. Roadmap status

**File**: `context/foundation/roadmap.md`

**Intent**: Record the format decision where the slices that depend on it will be read.

**Contract**: Add a line to the Baseline section recording that the quiz definition now exists at
`src/quiz/` with a build-time validation gate, since S-02 through S-08 all read it and the Baseline
is what tells them what they may assume.

**Do not touch S-01's `Status` or the At-a-glance row.** `roadmap.md:523-525` records that
`/10x-archive` owns that field — it flips the matching item to `done` when the change is archived.
Hand-editing it here either conflicts with that step or marks S-01 done before it has been reviewed.

#### 4. Make the failed deploy visible to the host

**File**: `docs/runbook-live-session.md`

**Intent**: Close the gap between the gate firing and the host knowing. The gate makes a malformed
quiz fail the deploy, which correctly leaves the previous good quiz live — but FR-001's accepted risk
is an organizer editing minutes before showtime, and with no CI and no alerting (roadmap Open
Question 3) a failed deploy is loud only in a dashboard nobody watches during a meetup. The host
would take the stage believing their fix shipped.

**Contract**: A pre-session checklist line instructing the host to confirm the latest deploy went
green before starting the session, naming the build gate as the thing that may have blocked it.

This file is a deliverable of the parallel `deployment-target-readiness` change (F-01). If F-01 has
not landed when this phase runs, do **not** create the runbook here — instead record the requirement
in that change's `plan.md` so it lands with the rest of the checklist, and note the deferral in this
plan's Progress. Creating a competing one-line runbook would fragment the document F-01 owns.

### Success Criteria:

#### Automated Verification:

- Build succeeds on the valid definition: `bun run build`
- Tests and types still pass: `bun run test`, `bun run type-check`

#### Manual Verification:

- Deliberately break one invariant (e.g. give the single-choice Q3 two correct option ids), confirm
  `bun run build` **fails** and the message names `Q3`'s id, then revert
- With the break still applied, push to a branch and confirm the **Vercel preview deploy fails** —
  the gate's whole value is that it blocks the deploy, and Vercel's build command is configurable, so
  this must be observed rather than assumed
- CLAUDE.md's new entries are accurate against the delivered code, not against this plan
- The host has a written instruction to confirm the deploy went green before starting a session —
  either in `docs/runbook-live-session.md` or recorded in F-01's plan if that change hasn't landed

---

## Testing Strategy

### Unit Tests

- **Normalizer**: `ł` and `Ł` (the case the obvious implementation fails), every other Polish
  diacritic, case folding, surrounding and internal whitespace, and the Q4-shaped variants. An
  explicit negative: a misspelling does **not** normalize to a match, since FR-011 stops short of
  tolerating misspellings on purpose.
- **Schema**: one rejecting case per invariant, one accepting case per question kind, and an
  assertion that messages identify the offending question.
- **Definition**: the real committed quiz parses; 14 questions; all four kinds present; Q1 and Q2
  unscored.

### Integration Tests

None. This slice has no request path, no store and no transport — there is nothing to integrate
until F-02. The build gate is the closest thing to an integration check and is verified manually in
Phase 3.

### Manual Testing Steps

1. Read the 14 Polish questions end to end against `idea-notes.md:41-56` for accuracy and tone.
2. Check each drafted distractor is plausible but unambiguously wrong.
3. Break an invariant, run `bun run build`, confirm it fails with a question-identifying message.
4. Push the break to a branch; confirm the Vercel preview deploy fails. Revert.

## Performance Considerations

None meaningful. The definition is a static literal of 14 questions parsed once. The only
consideration worth recording is negative: **do not** re-parse the quiz per request in F-02 — parse
once at module scope in the accessor and export the result, which is what Phase 2's contract
specifies.

## Migration Notes

None. This change adds files and one dependency; it modifies no existing behaviour, no existing
route, and no existing content. Rollback is a revert — nothing outside the repository holds state
after this change.

## References

- Roadmap slice: `context/foundation/roadmap.md` §S-01, and §Baseline for what may be assumed
- PRD: `context/foundation/prd.md` FR-001, FR-011, FR-013, FR-015, FR-017, FR-019, §Business Logic
  Changes
- Drafted quiz content: `idea-notes.md:41-56`
- Validation precedent (Zod at a content boundary): `src/content.config.ts`
- Test and module-style precedent: `src/lib/newsletter.test.ts`, `src/lib/newsletter.ts`
- Error-handling posture to copy: `src/lib/slack.ts` (CLAUDE.md names it as the pattern)
- Dependency-duplication precedent: CLAUDE.md §Commands, the `vite` deduplication note
- Parallel change: `context/changes/deployment-target-readiness/plan.md` (F-01, log retention)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename
> step titles. See `references/progress-format.md`.

### Phase 1: Schema, types, and the Polish normalizer

#### Automated

- [x] 1.1 Exactly one `zod` resolves: `test "$(find node_modules -type d -name zod | wc -l | tr -d ' ')" = "1"` — fb9c201
- [x] 1.2 Unit tests pass: `bun run test` — fb9c201
- [x] 1.3 Type checking passes with zero errors: `bun run type-check` — fb9c201
- [x] 1.4 Build still succeeds: `bun run build` — fb9c201

#### Manual

- [x] 1.5 Every schema invariant has a corresponding rejecting test — fb9c201
- [x] 1.6 Rejection messages name the offending question id and are actionable — fb9c201

### Phase 2: The 14-question definition and its accessors

#### Automated

- [x] 2.1 The real definition parses and all tests pass: `bun run test` — ed84482
- [x] 2.2 Type checking passes with zero errors: `bun run type-check` — ed84482
- [x] 2.3 Build succeeds: `bun run build` — ed84482

#### Manual

- [x] 2.4 All 14 Polish questions read correctly against `idea-notes.md:41-56` — ed84482
- [x] 2.5 Drafted distractors are plausible but unambiguously wrong — ed84482
- [x] 2.6 Q2 reads as the gathering beat and does not look broken while unscored — ed84482

### Phase 3: The build gate and the record of why

#### Automated

- [x] 3.1 Build succeeds on the valid definition: `bun run build` — 9c9bd47
- [x] 3.2 Tests and types still pass: `bun run test`, `bun run type-check` — 9c9bd47

#### Manual

- [x] 3.3 A deliberately broken invariant fails `bun run build` with a question-identifying message — 9c9bd47
- [x] 3.4 The same break fails a Vercel preview deploy — confirmed by the user; not observed in the implementing session
- [x] 3.5 CLAUDE.md's new entries are accurate against the delivered code — 9c9bd47 (the §Deployment entry described the gate as an `astro:build:start` integration when it actually fires at config load; corrected under impl-review F1, so the claim holds as of the F1 fix rather than at first sign-off)
- [x] 3.6 The host has a written "confirm the deploy went green" instruction (runbook, or recorded in F-01's plan) — 9c9bd47
