# Several independent quizzes — Plan Brief

> Full plan: `context/changes/multiple-quizzes/plan.md`
> Research: `context/changes/multiple-quizzes/research.md`

## What & Why

The LiveQuiz holds exactly one question set, and which quiz is live is answered by "which commit is
deployed". This change turns the definition into a **registry of independent quizzes**, each with its
own slug, Polish title and four-digit join code, and lets the host pick one when starting a session.
Attendees reach a quiz by QR, by `/quiz`, or by typing a short `/q/<code>` — nobody types a slug.

## Starting Point

One quiz, parsed once at module scope (`src/quiz/index.ts:51`), with no identity anywhere: `quizSchema`
is `{ questions }` and nothing else, and `SessionState` has no quiz field. Question ids are unique only
*within* a quiz, and `start` is create-if-absent, so a stale session silently wins over any selection.
Both views bake one projection at page render, so a phone shown the wrong quiz goes inert with no error
and no reload. There are no on-demand dynamic routes in the project yet.

## Desired End State

Several quizzes live under `src/quiz/definitions/`. The host opens `/quiz/host`, sees a list of titles,
clicks through to `/quiz/host/<slug>`, and pressing start binds that quiz to the session. The projector
shows a QR to `/quiz/<slug>` and the short address `/q/<code>`. A phone on the wrong quiz sees a Polish
message with a link to the one being run. A build that would ship two quizzes sharing a question id, a
code or a slug fails before it deploys.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope of "independent" | Several definitions, still one live session | Keeps `livequiz:` keys free of a quiz dimension, which is what makes the change tractable | Plan |
| Question-id uniqueness | Global across the registry, refused at the build gate | Collapses the sharpest silent failure into a red build, and keeps the polled routes' two-command saving | Plan |
| Quiz selection | A URL per quiz — `/quiz/<slug>`, `/quiz/host/<slug>` | The host's choice is the address, so nothing has to be threaded through a form or a snapshot to reach the attendee's first render | Plan |
| URL shape | `host` stays a static prefix | No quiz slug can collide with it — no reserved words, no reliance on route priority | Plan |
| Old addresses | `/quiz/host` → picker, `/quiz` → active session | Old QR codes and habits keep working, and the host remembers one address instead of slugs | Plan |
| Quiz metadata | `id`, `title`, `code` | Routing, the picker and the room's copy, and the short join address | Plan |
| Join code | Four digits, authored in the definition | Printable before the event, works before the host clicks anything, adds no session state and no retention surface | Plan |
| Stale code / wrong quiz | Opens the quiz, shows the session's state | One error path instead of two — the same one the URL entry needs anyway | Plan |
| `start` on a different quiz | 409 naming the running quiz's title | The only variant where the mistake is visible on the panel rather than looking like success | Plan |
| `SessionState.quizId` default | A sentinel, never a real quiz id | Defaulting to a current quiz makes an in-flight document claim an identity it never had | Research |
| Registry layout | `src/quiz/definitions/<slug>.ts` + recursive portability scan | One file per quiz, with the `astro:`-import gate extended in the same phase so it cannot silently stop covering them | Plan |
| Every-kind rule | Applies to the union of the registry | A short single-event quiz stays legal while route fixtures keep their coverage | Plan |
| `SHUFFLE_SALT` | Stays one global constant | With globally unique question ids, every question already has its own seed | Plan |

## Scope

**In scope:** the quiz registry and its build gate; `quizId` on the session document; `start` refusing a
different quiz; per-quiz URLs for both views; a host picker and an attendee redirector; `/q/<code>`; a
visible mismatch state on the phone; amending the PRD, roadmap, shape-notes, four `CLAUDE.md` files,
the runbook and the README.

**Out of scope:** parallel sessions; any quiz builder or admin UI; a per-session PIN; per-quiz shuffle
salt; any change to scoring, deadlines, tallies, answer records or stored field formats; migrating
stored sessions.

## Architecture / Approach

The build gate carries the risk. Making question ids globally unique across the registry, checked at
config load, means `getQuestionById` stays quiz-agnostic, `state.ts`'s existing question-id guard keeps
working unchanged, the two polled routes never need to read the session, and no stored field format
moves. Everything else follows the project's grain: identity on the session document rather than in key
names; a defaulted field with its own `superRefine` clause; the selection resolved in frontmatter and
handed down through `define:vars`; refusals as Polish 409s through `toResponse`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Registry & build gate | Quiz identity, `definitions/`, cross-quiz rules, recursive scan | The portability scan silently stops covering the new subdirectory |
| 2. `quizId` on the session | Session identity, `start` refuses a different quiz | The back-compat default is the one place a wrong choice mis-scores silently |
| 3. A URL per quiz | Both views under slugs, picker, redirector, QR, e2e | Expensive to revert — moves four files and changes the address on the QR and in the runbook |
| 4. Short join code | `/q/<code>` and the code on the projector | Additive; low |
| 5. Visible mismatch | The phone stops going quietly inert | The fixture must reach the new branch and no other |
| 6. Documents | PRD, roadmap, shape-notes, four `CLAUDE.md`, runbook, README | Skipping it leaves the files every future agent trusts asserting something false |

**Prerequisites:** none beyond a clean tree — no in-flight change touches these files now that
`testing-host-control-rules` and `quiz-animations-and-transitions` are archived. A second quiz's
questions must be authored to exercise the change end to end.
**Estimated effort:** ~4–6 sessions across 6 phases; phases 1–3 are the deployable core.

## Open Risks & Assumptions

- **Phase 3 is the irreversible one.** It changes the address on the QR, in both e2e specs and in the
  runbook, and it must land atomically or a deploy exists where `/quiz` is 404.
- **`new URL("./[slug].astro", …)` in the moved tests** is the one mechanic that has to be run rather
  than reasoned about; `join(dirname(...))` is the fallback if the round-trip misbehaves.
- **Four digits assumes a handful of quizzes.** It is an authoring format enforced in one place, so
  widening it later is cheap.
- **A stale fixed code leads to a quiz nobody is running.** Accepted: the attendee lands on the quiz and
  is told what is running, which is the same path a stale bookmark takes.
- **`quizId` becomes publicly readable** through `GET /api/quiz/state` and both join responses. A slug
  is quiz content, not attendee data — stated deliberately rather than inherited.

## Success Criteria (Summary)

- The host runs two different quizzes at two different events without editing or redeploying anything.
- An attendee joins by scanning a QR or typing four digits, and a phone on the wrong quiz is told so.
- A quiz authored with a question id that collides with another quiz's fails the build, naming both.
