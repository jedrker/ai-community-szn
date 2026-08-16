# src/quiz/ — the LiveQuiz question set

The quiz definition, its schema and its Polish text folds. Server-and-test only: no client module
may *value*-import from here (see `src/lib/client/CLAUDE.md`).

Layout: `schema.ts` (discriminated union over five question kinds plus the domain invariants),
`normalize.ts` (FR-011 answer folding), `definition.ts` (the questions), `index.ts` (the accessors
downstream slices import — never import `definition.ts` directly), `public.ts` (the projection that
strips answers before anything reaches a phone), `test-support.ts` (test-only, see below).

## This is NOT a content collection

The question set lives at `definition.ts` as a typed TypeScript literal validated by a Zod schema —
deliberately *not* a third content collection, even though it is content and the root `CLAUDE.md`
says collections are the CMS. Do not "fix" this by moving it. Two reasons, both load-bearing:

- **Audience.** Events and speakers are organizer-edited Markdown. The quiz is developer-authored
  source (PRD FR-001 — avoiding a builder interface is the reason LiveQuiz is built rather than
  rented), and `satisfies Quiz` on the literal means an authoring mistake is a red squiggle in the
  editor rather than a runtime surprise.
- **Portability.** `astro:content` does not resolve outside the Astro build — a bare `vitest run`
  fails with `Cannot find package 'astro:content'`. This module is imported by tests and by
  serverless functions, so it imports `zod` directly instead. `portability.test.ts` fails the suite
  if anything under `src/quiz/` ever imports an `astro:` specifier.

## No test may name a question id, an option id, an accepted answer or a true value

The quiz is in source so it can be *edited* (FR-001), and a test that transcribes its content
converts routine editing into breakage somewhere unrelated: swapping the quiz for the next event
used to fail six assertions in `definition.test.ts` plus fixtures in four session and route files,
every one of them reporting only "the quiz changed". Three rules, in order of preference:

- **Need only a question-shaped value?** Build a literal. `deadline.test.ts` and `scoring.test.ts`
  are the pattern, and their fixture ids all start with `fixture-` so nobody mistakes one for
  content.
- **Need a question the code will resolve through `getQuestionById`?** Take it from
  `questionOfKind(kind, { scored })` / `questionsOfKind` in `test-support.ts` — by kind, never by
  id, never by positional index. Derive what you submit against it too
  (`question.correctOptionIds[0]`, `question.acceptedAnswers[0]`, `question.correctValue`), and
  derive the *guesses* from `correctValue` rather than typing figures that only fit one question.
- **Need to assert something about the committed quiz?** Say it as a rule over whatever the quiz
  contains — `definition.test.ts` asserts that no id gives away its own answer and that the opener
  scores nothing; it counts nothing and quotes nothing.

Two consequences worth knowing. `definition.test.ts` still requires the quiz to **exercise every
question kind**, because the route tests derive fixtures by kind and a dropped kind silently drops
its coverage — that one constraint is deliberate and documented at the assertion. And an *unscored
choice* question is treated as optional: the two tests needing one `skipIf` it away, so retiring the
gather beat is an editorial decision rather than a red build.

Properties that need a population — the option shuffle's lack of a positional tell is the one — are
measured over generated questions via `projectQuiz(source)` in `public.ts`, with the real quiz kept
only for conformance. Reading a distribution off fourteen committed questions made the strength of
the test depend on how many the event happened to want.

## The three folds — merging any pair is a bug with no symptom until a live session

`normalize.ts` carries a trap: **`ł` and `Ł` need an explicit mapping.** Every other Polish
diacritic decomposes under NFD and is removed by `\p{Diacritic}`, but `ł` is an atomic codepoint
with no decomposition, so the idiomatic fold leaves it untouched — `"żółć łódź"` becomes
`"zołc łodz"`.

Two of the three folds live here and differ by exactly one rule (trailing sentence punctuation); the
third lives in `src/lib/session/words.ts` and differs from both by keeping diacritics:

| | `normalizePolish` | `normalizeAnswer` | `foldWord` |
| --- | --- | --- | --- |
| Where | `src/quiz/normalize.ts` | `src/quiz/normalize.ts` | **`src/lib/session/words.ts`** |
| Folds | case, whitespace, diacritics | the same, plus trailing `. ! ? , ; :` | case and whitespace **only** |
| Used by | the display-name claim key (`src/lib/session/players.ts`) | answer matching (`scoreTextAnswer`) **and** the authoring-collision check in `schema.ts` | word-cloud grouping (`wordField`, `readWordCloud`) |
| Owns | FR-008 name uniqueness | FR-011 answer matching | FR-012/FR-015 word grouping |

**`foldWord` keeps diacritics because its output is *rendered*.** The other two are comparison
artefacts nobody ever sees; the folded word *is* the chip on the projector, so folding `ó` away
would put a misspelt Polish word on the big screen in front of the room. The accepted cost: a word
typed both with and without its diacritics counts as two entries — cosmetic on an unscored question,
where the same slip in `normalizeAnswer` would cost somebody points. Its tripwire is in
`src/lib/session/words.test.ts`, and that test's fixture is `Gęś` rather than `Żółw` on purpose:
`ł` survives a bare NFD pass, so a `żółw`-based assertion still holds against a fold that has lost
every *other* diacritic. It lives outside `src/quiz/` because it is a session-aggregation rule
rather than a rule about the quiz definition — the same reasoning that keeps `scoring.ts` out.

**`normalizePolish` must keep punctuation** because `.` is a legal display-name character
(`players.ts`'s `ALLOWED_CHARACTERS`), and the claim keys already stored in `livequiz:players` were
written with it — so widening it in place would merge `"Ania."` and `"Ania"` into one claim and,
mid-deploy, let two visually identical names onto the leaderboard. `normalize.test.ts` asserts
`normalizePolish("Ania.") !== normalizePolish("Ania")`; that assertion is the tripwire.

Answer matching and the build-time collision check deliberately share **one** function, so an author
cannot ship two accepted variants the schema allows and the scorer treats as identical. Matching
stops at case, spacing, diacritics and trailing punctuation — **no fuzzy or edit-distance matching**,
because a threshold is something the host would have to defend out loud in front of the room.

For a text question, **`acceptedAnswers[0]` is the variant the room sees**: `reveal.ts` publishes it
as the accepted answer to every phone and the projector. Order there is not arbitrary.

## Schema invariants refused at the build gate

`astro.config.ts` calls `assertQuizValid()` at top level, so all of these fail `astro build`,
`bun run dev`, `bun run type-check` and `bun run test` alike.

- A number question's **`correctValue` may not be zero** (nor non-finite). The closeness rule
  divides by the true value, and there is no reading of "within 5% of zero".
- A **word-cloud question must be unscored** (`points: null`). FR-015 lets its aggregate display
  live precisely because it has no correct answer to leak. It also takes no scoring function at all:
  the route writes `correct: false, awarded: 0` directly, because there is nothing to weigh.
- A scored question must carry **`timeLimitSeconds`**, and an unscored one may not (FR-020).
  Required where `points !== null`, refused where `points === null`, bounded to
  `[MIN_TIME_LIMIT_SECONDS, MAX_TIME_LIMIT_SECONDS]` (5–180) — all three keyed on `points` rather
  than on `kind`, so marking a question unscored is enough to take its clock away. A value below the
  20-second speed window is legal and compresses the reward curve; every authored value sits at or
  above it.

**Scoring rules deliberately do not live here.** `points` (a number, or `null` for an unscored
question per FR-017) is the only *scoring* field — **`timeLimitSeconds` is pacing, not scoring**,
and that distinction is the whole of why it is allowed in this directory: it decides how long a
question accepts answers, never what an answer is worth. The deadline arithmetic, the speed
weighting, `MAX_TEXT_ANSWER_LENGTH` and the numeric-closeness curve all live in `src/lib/session/`.
