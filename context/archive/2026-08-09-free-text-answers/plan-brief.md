# Free-text answers — Plan Brief

> Full plan: `context/changes/free-text-answers/plan.md`

## What & Why

Roadmap S-05. An attendee types an answer instead of tapping one, and it counts as correct if it
matches any accepted variant once case, spacing, Polish diacritics and trailing sentence punctuation
are folded away (PRD FR-011, US-01). The quiz already contains a text question that no phone can
currently answer — the route refuses the kind with a message, by design, waiting for this slice.

## Starting Point

S-03 shipped the whole answer path for the two choice kinds and left three labelled seams for this
one: the route's `unsupportedKind` refusal, a scoring module that exports `speedWeight` separately so
a second kind can reuse it, and a reveal transition that hands text questions an empty array. The fold
itself (`normalizePolish`) already exists and already handles the `ł`/`Ł` trap — but nothing scores
with it; its only caller validates the quiz definition at build time.

Three gaps block the mechanic: no correctness function, no field on `AnswerRecord` to hold typed
text, and no text-shaped way for the correct answer to reach the room at reveal.

## Desired End State

The host advances to the text question. Every phone shows a field. `Halucynacje.` — capitalised, with
a full stop the keyboard added — is accepted and scored with the same speed weighting a tapped answer
gets; `halucynacja` is too; `halucynajce` is not. The device locks after one submission and survives
a reload with its clock and lock intact. At reveal the large screen shows the accepted answer, and
each phone shows it beside what that device typed, with the verdict, award and running total.

## Key Decisions Made

| Decision | Choice | Why |
| --- | --- | --- |
| How the correct answer reaches the room | New `revealedAnswerText` on `SessionState` | Mirrors `revealedOptionIds` exactly, keeping FR-016's property that a failed per-device fetch still leaves the answer on screen |
| Generalise the two reveal fields into one union? | No | Would rewrite a field S-03 just hardened, break documents in flight, and touch three test files for no user-visible gain |
| Where the typed answer is stored | New nullable `text` on `AnswerRecord` | Additive, so records written pre-deploy still parse; S-04 can keep reading `optionIds` untouched |
| Raw or folded text stored | Raw, trimmed | The fold is a comparison artefact; showing it back at reveal would confuse, and a stage dispute needs the real input |
| Punctuation folding | Trailing sentence terminators only | Catches the keyboard's auto-inserted full stop without merging answers that genuinely differ by a hyphen or apostrophe |
| Where that fold lives | A new `normalizeAnswer` beside `normalizePolish`, not an edit to it | `normalizePolish` is also the display-name claim key (`players.ts:100`) and `.` is a legal name character — widening it in place would merge `"Ania."` into `"Ania"` and, mid-deploy, let two identical names onto the leaderboard. `schema.ts` moves to the new fold too, so scoring and the authoring check still cannot drift |
| Input bound on an open endpoint | Server refuses over `MAX_TEXT_ANSWER_LENGTH` (80), exported from `scoring.ts` | `curl` ignores `maxlength`; refusal not truncation, since scoring a prefix nobody typed is worse than a clean no. One constant, three readers — the schema's `.max()`, the route's refusal, and the input's `maxlength` via `define:vars` |
| Empty / whitespace-only answer | Blocked client-side, refused server-side | Matches the choice path's disabled-on-empty submit, and never burns FR-004's one-answer lock on nothing |
| Where the input element lives | Static element in `index.astro` | `renderQuestion` calls `replaceChildren()` and `render()` runs per snapshot — an input inside it loses value, focus and caret mid-typing |
| Reveal copy | Accepted answer **and** the device's own text | A typo and a genuinely wrong answer look identical otherwise, and that is the dispute the host fields from the stage |
| Host large screen | Shows the accepted answer at reveal | The field is already on the wire; a projector showing nothing while 150 phones show the answer is the failure the host notices |
| A fifth contract document | No | No new key, no new downstream decision, no invariant not enforced in code — durable notes go to CLAUDE.md |
| 150-device rehearsal run | No | Adds no new fan-in shape; same routes, one more kind, one live text question in fourteen |

## Scope

**In scope:** the punctuation fold; `scoreTextAnswer`; `text` on the answer record;
`revealedAnswerText` on the session state and in `reveal.ts`; the route's text branch with its length
bound and empty refusal; `text` on the result payload; the attendee input, submit and reveal echo;
the host screen's reveal line; CLAUDE.md and roadmap updates.

**Out of scope:** fuzzy / edit-distance matching, stemming, synonyms; internal punctuation stripping;
S-06's number and S-08's word cloud (the route keeps refusing both); S-04's participation count and
answer distribution; the pre-existing gap where the host screen never marks correct *choice* options;
any throttle on `/api/quiz/answer`.

## Architecture / Approach

```
normalize.ts (fold)  ──►  scoring.ts (scoreTextAnswer, reusing speedWeight)
                                │
                          answer.ts route ──► answers.ts record (.text)
                                                      │
reveal.ts ──► state.ts (.revealedAnswerText) ──► snapshot ──► phones + projector
                                                      │
                                          result.ts (own text) ──► reveal echo
```

Correctness travels on the broadcast; the award, total and the device's own text travel on the
per-device fetch. That split is S-03's and is preserved deliberately — it is why a failed fetch costs
the score line and never the answer.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. The fold and the rule | `normalizeAnswer`, `scoreTextAnswer`, `MAX_TEXT_ANSWER_LENGTH` | Re-deriving the speed curve instead of reusing `speedWeight`; or folding punctuation into `normalizePolish`, which is player identity |
| 2. The two data contracts | `text` on the record, `revealedAnswerText` on the state, set in `reveal.ts` | Treating the new field like `playerCount` — injecting it in `applyHostAction` publishes the previous answer into an open question |
| 3. Route and result payload | Text submissions accepted, scored, bounded; own text returned | The absent-`text` case taking the favourable path, exactly as `elapsedMs` did in S-03 |
| 4. The attendee view | Input, submit, reveal echo | An input inside the re-rendered container losing focus mid-typing; a control `hideAnswerControls()` forgets |
| 5. Host view and docs | Accepted answer on the large screen; CLAUDE.md, roadmap | `host.astro` is also touched by S-04, planned in parallel |

**Prerequisites:** S-03 done and archived (it is). Nothing else — no new dependency, no new key, no
provisioning step.

**Estimated effort:** ~2 sessions across 5 phases. Phases 1–3 are small and mostly test-writing;
phase 4 carries the real work.

## Open Risks & Assumptions

- **`host.astro` collides with S-04**, planned in parallel in another session. Whichever implements
  second must re-read the other's `render()` rather than assuming its shape. Plan them in parallel,
  implement sequentially.
- **The trailing-punctuation fold also flows into build-time validation** — `schema.ts` moves to
  `normalizeAnswer` so the authoring-collision check and the scorer stay the same function. Checked
  against the current definition — no new collision — but a future author could hit one, and the
  message names it.
- **The two folds must stay apart.** Plan review caught the original single-fold design merging
  answer matching into the display-name claim key. A `normalize.test.ts` assertion pins
  `normalizePolish` to preserving a trailing `.`, so a later edit that recombines them fails the
  suite rather than reaching a leaderboard.
- **Three fields rely on `.default(null)` for mid-session deploy safety.** If any is made required
  later, a live session's next host action 409s on stage.
- **Assumes `acceptedAnswers[0]` is the canonical form** the room should see. True for the one live
  question; recorded in the schema docstring so a future author knows the first entry is special.

## Success Criteria (Summary)

- An attendee typing a correct answer with different capitalisation, spacing, missing diacritics or a
  trailing full stop is scored correct — and a misspelling is not.
- At reveal, every phone and the large screen show the accepted answer, and each phone additionally
  shows what it typed, its verdict and its running total.
- A device that reloads mid-question keeps its clock and its lock; one whose result fetch fails still
  sees the correct answer.
