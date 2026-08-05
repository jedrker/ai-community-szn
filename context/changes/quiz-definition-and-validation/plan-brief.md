# Quiz Definition and Validation — Plan Brief

> Full plan: `context/changes/quiz-definition-and-validation/plan.md`
> Roadmap slice: `context/foundation/roadmap.md` §S-01
> PRD refs: FR-001, FR-017

## What & Why

The organizer must be able to author the whole quiz — questions, types, options, accepted answers,
true values, scoring flags — in a file alongside the project's source, with no builder interface, and
have a malformed or incomplete definition rejected loudly rather than discovered on stage. Avoiding
the builder is the reason LiveQuiz is being built rather than rented, so the file *is* the product's
distinguishing trait, not an implementation detail.

## Starting Point

The quiz exists only as prose: 14 questions drafted in Polish in `idea-notes.md:41-56`, using exactly
four mechanics. Eight of them name only the correct answer — the distractor options were never
written. The project validates content at its boundary today (`src/content.config.ts`, two
Zod-validated Markdown collections) and has a working test runner, but nothing machine-readable
describes the quiz, and nothing runs between a commit and production.

## Desired End State

`src/quiz/` holds the full 14-question quiz as a typed TypeScript literal, validated by a Zod
discriminated union whose refinements catch the errors a flat schema cannot — a single-choice
question with two correct answers, a scored question with none, a word cloud claiming points. A
malformed definition fails `astro build`, and therefore fails the Vercel deploy. S-02 through S-08
import a parsed, typed value.

## Key Decisions Made

| Decision                     | Choice                                             | Why (1 sentence)                                                                                                  |
| ---------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Definition format            | Typed TS module + Zod schema, at `src/quiz/`        | Authoring typos surface in the editor and `astro check`; a plain import works identically in serverless and vitest, whereas `astro:content` is not resolvable in a bare `vitest run`. |
| Not a content collection     | Deliberate divergence from the Markdown CMS         | The quiz is developer-authored source, not organizer-edited site content, and PRD §Non-Goals rules out changing how existing content is authored. |
| Enforcement                  | Vitest suite **plus** an `astro:build:start` gate   | The only option that actually blocks production given there is no CI — a `prebuild` script would rest on Vercel's configurable build command and Bun's lifecycle-script handling. |
| Validation strictness        | Domain invariants, not just shape                   | The highest-consequence authoring errors are cross-field and invisible to a flat schema; presentation rules are left to S-04.                        |
| Scoring in the definition    | Per-question `points` only; global rules elsewhere  | Keeps this slice a data contract and lets S-03 establish exactly one scoring model — the roadmap names over-designing this format as the slice's principal risk. |
| Question identity            | Hand-authored stable slug ids                       | Reordering or inserting a question cannot silently reassign identity, which F-02's store keys and S-09's resume both depend on.                      |
| Polish normalizer            | Ships here, ahead of its slice (S-05/FR-011)        | Validation uses it to reject accepted-variant lists that collapse to duplicates, and the `ł` trap gets tested against real content now rather than mid-S-05. |
| Missing distractors          | Drafted during implementation, editorial pass after | Proves the format against the real quiz and gives S-02..S-08 a genuine fixture, rather than a toy one.                                               |

## Scope

**In scope:** the Zod schema and inferred types over four question kinds; domain invariants as
refinements; the `ł`-aware Polish normalizer; all 14 questions authored in Polish including drafted
distractors; accessors for downstream slices; a build-time gate; `zod` as a pinned dependency;
CLAUDE.md and roadmap records.

**Out of scope:** all scoring (S-03, S-06); free-text matching itself (S-05); any session, transport,
store or route (F-02); any UI, including a preview page; presentation/legibility rules (S-04); CI.

## Architecture / Approach

`src/quiz/definition.ts` (the content) → `src/quiz/schema.ts` (discriminated union on `kind`, with
refinements) → `src/quiz/index.ts` (parsed value + lookup by id, the contract downstream imports).
`src/quiz/normalize.ts` is used by both the schema's duplicate-variant check and, later, S-05's
matching. An inline Astro integration hooks `astro:build:start` and calls the assertion, so a bad
quiz fails the build inside `astro build` regardless of what invoked it.

Authoring mistakes surface three times, each earlier than the last: in the editor, in `astro check`,
in the build gate.

## Phases at a Glance

| Phase                                     | What it delivers                                                  | Key risk                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1. Schema, types, Polish normalizer       | Validated shape + normalizer, proven on synthetic fixtures         | The `ł` trap: NFD-strip silently leaves `ł`/`Ł` unfolded, so the obvious implementation is wrong |
| 2. The 14-question definition + accessors | The real quiz, drafted distractors, the contract S-02..S-08 import  | Distractor quality — a distractor that is arguably also correct cannot be amended mid-session    |
| 3. Build gate + the record of why         | A malformed quiz fails the Vercel deploy; decisions written down    | The gate not actually blocking the deploy; must be observed on a preview, not assumed            |

**Prerequisites:** none — S-01 is the only user-facing slice with no dependency on the realtime spine
or on any platform decision, so it runs in parallel with F-01.
**Estimated effort:** ~1–2 sessions across the three phases; Phase 2's editorial pass on the eight
drafted distractors is the least predictable part and needs the organizer's judgement.

## Open Risks & Assumptions

- **Eight questions will carry drafted wording, not the organizer's.** They need an editorial read
  before any live session. This is FR-001's accepted operational risk in its ordinary form.
- **Vercel's build command is configurable**, so the gate's protection is verified on a preview
  deploy in Phase 3 rather than assumed from the local build passing.
- **A duplicated `zod` copy would break `astro check`**, the same failure class CLAUDE.md already
  documents for `vite`. Pinning to Astro's resolved range is the mitigation; `rm -rf node_modules &&
  bun install` is the remedy.
- **Uniform point values are assumed** — nothing in the PRD asks for per-question weighting, and the
  schema permits it later without a breaking change.
- **The format may still be reshaped by S-03.** The scoring boundary drawn here (declare `points`,
  own no rules) is the guard against that, but S-03 is where it gets tested.

## Success Criteria (Summary)

- An organizer can open one file, read all 14 questions in Polish, and edit one — including minutes
  before showtime — with mistakes caught in the editor rather than on stage.
- A definition that violates a domain invariant fails the build and therefore never deploys, with a
  message naming the offending question.
- S-02 through S-08 can import a parsed, typed quiz and a lookup by stable question id without
  re-parsing or touching the raw literal.
