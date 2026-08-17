# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-08-16

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the risk wins. Do not promote to
   e2e because e2e "feels safer." Do not put a vision model on top of a deterministic visual diff
   that already catches the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team is worried about X, and
   the failure would surface somewhere in <area>" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what could fail* and *why we
   believe it's likely* — drawn from documents, interview, and codebase *signal* (churn, structure,
   test base). It does NOT claim to know which line owns the failure. That knowledge is produced by
   `/10x-research` during each rollout phase. If the plan and research disagree about where the
   failure lives, research is the ground truth.

A fourth rule is specific to this project and is not a style preference. **A guard that has never
been observed failing has been checked, not verified.** Every test written by this rollout is
verified in both directions — break the code it covers, confirm that named test fails, restore. This
project has already shipped guards that passed for four commits while the defect they were written
to catch was live (§2 Risk #2), so the discipline is a deliverable of every phase, not a flourish.

Hot-spot scope used for likelihood weighting: `src/`, `scripts/` — excluding `docs/`, `context/`,
`public/`, and build output. 108 commits in the last 30 days; ample signal.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by risk = impact × likelihood.
Risks are failure scenarios in user / business terms, not test names. The Source column cites the
*evidence that surfaced this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | The host panel offers a flow verb the current phase refuses, or withholds the one it accepts — the host presses a dead button in front of a live room | High | High | interview Q3; hot-spot dir `src/pages/quiz/` (73 commits/30d); PRD FR-002, FR-003, FR-004, FR-006, FR-014; PRD Success Criteria (host does not fight the tool) |
| 2 | A regression reaches a live session because the suite was green: the guard covering that area asserts source shape rather than behaviour, and cannot fail when the behaviour breaks | High | High | interview Q2; `context/foundation/lessons.md` (three entries: source-scanning guards, break-the-guard, prove-the-fixture); `context/archive/2026-08-14-per-question-timer/`; **measured 2026-08-16 in `context/changes/testing-host-control-rules/research.md` — of ~150 assertions in the project's highest-churn view, none is a property assertion**; two structural guards elsewhere passed with a detector regex that could never match (rollout phase 1, §6.6). *That measurement also claimed six assertions pass against deleted code; phase 1 tested each and none does — see §6.6, which is the more useful finding* |
| 3 | A device whose transport drops keeps rendering a phase the host has left — it receives the newer snapshot and fails to adopt it, so the room desynchronises | High | Medium | interview Q1; PRD Success Criteria guardrails (1-second reflection; no divergence in standings between devices); hot-spot dir `src/lib/client/` (65 commits/30d); `context/archive/2026-08-09-connection-limit-degradation/` (which recorded the client's snapshot-application decision as knowingly uncovered); **amended 2026-08-16 — see the note below the table** |
| 4 | An answer submitted just before the reveal is refused in a way the phone reports back as answered, or is missing from the distribution the room sees | High | Medium | PRD US-02 acceptance criterion ("no answer submitted before a reveal is lost from the tally"); PRD Success Criteria guardrail (150 concurrent, no lost answers); hot-spot dirs `src/lib/session/` (144 commits/30d), `src/pages/api/` (90 commits/30d); **measured 2026-08-16 in `context/changes/testing-sync-degraded-link/research.md` — double-counting is structurally prevented, and both surviving loss mechanisms are exercised by nothing in the repo** |
| 5 | A submission that omits or malforms a field is scored favourably rather than refused, producing a silently wrong award on a public leaderboard | Medium | Medium | `context/foundation/lessons.md` ("Absent untrusted input must fail toward the safe end", lived in S-03); PRD FR-019; hot-spot dir `src/pages/api/` (90 commits/30d) |
| 6 | One device registers enough players to flood the room and wreck the final reveal | Medium | Medium | PRD FR-018 (recorded as an explicitly lightweight, defeatable guard); PRD FR-007 Socratic challenge; `context/archive/2026-08-14-resilient-join/` |
| 7 | Attendee display names or submitted answers outlive the session that collected them | High | Low | PRD Success Criteria retention guardrail and its four recorded deviations; `context/archive/2026-08-06-session-end-and-data-purge/`; `context/archive/2026-08-12-word-cloud-question/` (the tally key stopped being counters-only) |

**Rows #3 and #4 were amended on 2026-08-16, after rollout phase 2's research falsified part of each.
The positions they replace are kept here rather than deleted.**

- **#4 used to read "lost from the tally, or counted twice."** Counted twice is not reachable: the
  answer record and every counter move inside one atomic script, with the uniqueness lock above every
  increment, so two increments for one player and question is not expressible. The half that survives
  is loss, and it turned out to be *two* failures with different audiences — a refusal the phone
  reports to the attendee as a recorded answer, and an answer that reaches the stored tally but not
  the distribution the projector draws. Leaving the old wording in place would have sent the phase
  hunting a defect that cannot exist while both real ones stayed uncovered.
- **#3 used to end "and nothing on stage indicates which devices are stuck."** That clause is true and
  is *not a test target*: attendees report nothing upward, so a stuck device is invisible to the host
  except as a shortfall in answered-over-joined, which has several ordinary explanations. It is a
  product absence belonging to the PRD and the runbook, and a test written against it would assert a
  decision rather than catch a defect. The row now names the failure a test can actually reach — a
  device that *receives* the newer snapshot and does not adopt it, which is a different mechanism from
  the transport loss the row used to imply and the one with no executing coverage.
- **Both risks keep their impact and likelihood.** The corrections change what fails, not how much it
  costs or how often it is likely.

**Row #3's third proof clause is met for one cancel out of three, and phase 2 closed anyway.** The
response guidance below asks for "a cancel is not undone by a request already in flight". `dispose`
holds it — it carries a terminal flag for exactly this reason. `stop` and `pause` do not: an
in-flight tick's `finally` re-arms past either, which phase 2 **pinned rather than fixed**, per the
decision recorded at the end of this section. So the phase is complete on what it set out to build,
and this clause is not something a green suite should be read as certifying. The two pinned tests are
named in §6.6, and both carry an inversion note so the day somebody repairs `pause` reads as a fix
rather than as a broken test.

Risk #7 is the one High-impact × Low-likelihood row kept in the map rather than deferred to
alerting, because it already has a mechanism and a named gap: the key registry is enforced by a
scan that catches declared literals but not names assembled at runtime, and a residue check exists
but runs by hand. Its response is promoting an existing check to a gate, not building a suite.

Risks considered and deliberately excluded: the unprotected host view (PRD Access Control Changes
accepts it explicitly — testing it would assert a decision, not catch a defect), unmoderated
word-cloud submissions (PRD Non-Goals, surfaced and accepted during shaping), and a realtime or
store provider outage (High impact, Low likelihood, third-party — this belongs to the runbook and
alerting, and there is no test that would change the outcome).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|---|---|---|---|---|---|
| #1 | For every phase and last-question position, the panel offers **no** verb the route would refuse; and every verb the route accepts but the panel withholds appears in an explicit, named exception list. **A one-way implication plus a closed exception set — not an equality** | (a) "The routes refuse illegal transitions anyway, so the panel is cosmetic." The PRD's primary success criterion is the host not fighting the tool; the panel is the interaction, the refusal is the backstop. (b) "The panel's phase rules are one mechanism." They were two — the flow-verb table, and a separate inline rule governing the closing verb — *until rollout phase 1 folded `end` into the same decision; they are one mechanism now, and that is a property to preserve rather than an assumption to rely on* | Where the phase-to-verb decision is actually made, whether that decision is reachable from a test process at all, what determines the last-question variant, and the full list of places the panel deliberately offers *less* than the route | unit, over a pure decision function | Asserting panel/route **equality**, which fails on correct code — the panel withholds verbs the routes accept — three of them materially, each now named in `MATERIAL_WITHHOLDINGS`; re-asserting the table's source text; testing the renderer instead of the decision |
| #2 | Each guard fails when the code it covers is broken, and passes when restored — demonstrated, not assumed | "The test is green, therefore the behaviour holds." A scan for an expression that exists today certifies whatever is there, defects included | Which existing tests execute code and which scan source text; which of the scans assert a property versus a current shape; which properties have no harness and why | unit, plus **conversion of any scan that must remain to the detector-plus-fixture pattern this project already uses in two of its structural guards** — a discipline alone cannot fix a guard that passes on deleted code | Repairing a newly-failing guard back toward the bug it just caught; pinning a symbol name rather than a property; **auditing a guard by reading it rather than by breaking it** — phase 1's research condemned six ordering assertions of the form `indexOf(guard) < indexOf(action)` (vacuously true when the guard is absent, since the miss returns −1) and every one of them turned out to carry a presence check on the line above. Read the assertion's neighbours, then delete the guarded statement and watch |
| #3 | A device that is handed a newer snapshot **adopts** it, an older one cannot overwrite a newer one, and a cancel is not undone by a request already in flight | *The original challenge — "the fallback loop is running, therefore it is delivering" — was already met before this phase began: the loop's tests pin the interval randomness and hold a request open with a manually-settled deferred.* The live assumption is the next one along: **"the loop delivers, therefore the client converged."** Delivery and adoption are different steps, and only the first has executing tests | Where the decision to adopt or drop a snapshot is made and what it compares; whether that decision is reachable from a test process at all without mocking the realtime SDK (which this project forbids, because a module mock freezes the SDK's API and passes against a real breakage); which lifecycle cancels are terminal and which are resumable | unit, over the snapshot-application decision — **not** more coverage of the poll loop, whose layer is saturated | Adding assertions to the loop's own tests and reporting the risk as covered; advancing fake time by the widest jittered interval and assuming one advance is one tick; a stub that resolves immediately in a test whose name claims an overlap; **a cancellation test whose assertion holds whether or not the cancel worked, because the re-arm beat it to the timer** |
| #4 | A submission refused because the host revealed mid-flight is reported to the attendee as refused rather than as recorded; and the distribution the room is shown accounts for every answer the store accepted | "The write is atomic, therefore the count is right" — **confirmed, and sharper than first written**: the atomic script is sound, so every surviving failure lives at a seam *above* it. Two reads that look like one: the route's phase read versus the script's own re-read, and the reveal's tally read versus its compare-and-set. Also challenge "a refusal is safe because nothing is written" — nothing being written is exactly what makes it invisible to the attendee | Which refusal classes the client treats as final versus retryable, and why one of them was deliberately given its own class; what the grace window bounds (the decision, not the write); which aggregate is read outside the version guard. **Also which store instance is available at all** — see the layer note below | **Split.** Above the script: unit and route-level, using the mocks that already exist but letting them *disagree*, which no test currently does. Below it: already at its practical ceiling in the by-hand room-scale script — do not rebuild it | Mocking the store so that the atomicity under test is the mock's; **adding mock-level assertions about a script the mock never executes, which reads as coverage and is not**; asserting the count without asserting which submissions produced it; computing a boundary expectation from a literal instead of from the grace constant and the question's own limit |
| #5 | An absent field is refused rather than coerced, and the test asserts the resulting *award* rather than that the request was accepted | "The hostile value is guarded, therefore the absent value is too." These take different paths through the same code | Every untrusted field on every submission route, and what "said nothing" currently yields for each | integration, at the route | Spelling the absent case as `undefined` where a destructuring default silently replaces it; asserting a status code where the defect is in the number |
| #6 | The cap holds across repeated claims from one device, and a claim refused for a different reason charges nobody | "Resume is exempt, therefore resume is free." The exemption is the entire substance of the slice that introduced it | The claim path's internal ordering, what the counter actually counts, and what an absent device identifier does | integration, at the route | Testing the cap with a fresh device on each attempt, which exercises no cap at all |
| #7 | After a close, no registered key holds attendee data — including any key whose name is assembled at runtime rather than declared | "The key scan passes, therefore the namespace is clean." The scan catches declared literals only, by design | Which key names are assembled rather than declared, and what the existing residue check does and does not reach | the existing residue script, promoted to a gate | Writing a second literal scan instead of checking the real store; treating a green scan as coverage of the runtime-assembled case |

**The layer note for #4, added 2026-08-16.** "Integration at the store boundary" was written as though
a store to integrate against existed. None does: the suite's client is mocked, so the atomic script is
passed to it as a *string* and never executed; the browser layer is deliberately single-threaded and
cannot express a concurrent burst; and the one tool that does drive real concurrency runs by hand
against production. There is no local or ephemeral instance in the repo, and introducing one is a
stack change that belongs to phase 4 rather than here. This is not the obstacle it first appears,
because the failures that remain uncovered sit above the script and need no store at all — but a plan
that writes "integration test" without saying *against what* has not answered the question, and the
row above is split so it cannot be inherited unexamined.

**Decision, 2026-08-16: this phase pins behaviour, it does not fix it.** Research surfaced two live
defects in reach — a refusal class the client treats as final when the answer was never recorded, and
a pause that an in-flight request can undo. Both are product changes, and a testing rollout that
quietly repairs what it was sent to measure loses the measurement: a test written against repaired
code has never been observed failing, which §1's fourth rule counts as checked rather than verified.
So the tests assert today's behaviour, name it as the finding it is, and leave the fix to a change of
its own.

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status
moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on
disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Host control rules, executable | Prove the panel offers no verb the phase refuses by running the decision, not by reading its source | #1, #2 | unit | complete | `context/changes/testing-host-control-rules/` |
| 2 | Sync under a degraded link | Prove a device converges on the host's phase after the transport drops, and that no answer is lost at the reveal boundary — **on its deliverables; one proof clause is deliberately not met, see the note below and §6.6** | #3, #4 | unit, integration | complete | `context/changes/testing-sync-degraded-link/` |
| 3 | Submission edges and the retention floor | Prove absent and hostile fields fail toward refusal, the per-device cap holds, and no registered key outlives the session | #5, #6, #7 | integration, contract, existing scripts | not started | — |
| 4 | Gates wired | Make the checks that already run locally run between a commit and production | cross-cutting | gates | not started | — |

**Phase 2 reads `complete` on what it built, and that is narrower than "Risk #3 is covered".** Its
third proof clause — "a cancel is not undone by a request already in flight" — holds for `dispose`
and for neither `stop` nor `pause`; phase 2 pinned that failure rather than repairing it, under the
decision at the end of §2. The two pinned tests carry inversion notes, and §6.6 names them. A row
saying `complete` is not a claim that every clause beside it is met.

Order rationale. Phase 1 is the highest risk at the lowest cost, and it is the area the team named
as least confident. Phase 2 depends on the timing discipline Phase 1 establishes, because its risks
are the ones the archive shows fake timers getting wrong. Phase 4 is last on purpose: a gate wrapped
around a suite nobody trusts yet enforces the wrong thing.

**Amended 2026-08-16:** a browser layer arrived outside this rollout, between phases 1 and 2 of
the row above — `playwright.config.ts` and two specs under `e2e/`, installed with the toolkit's
`/10x-e2e` skill rather than planned here. It is wired to no gate and belongs to no rollout phase.
It is recorded in §7 rather than added as a phase, because the phase that was dropped was about
*visual* regressions and this is not that. Phase 4 (gates) is where a decision about running it in
CI belongs.

This rollout is **classic-only, by decision rather than by omission.** A fifth phase — a selective
visual review of the host and attendee screens at projector and laptop widths — was proposed and
dropped at write time; the reasoning and its re-evaluation trigger are recorded in §7 rather than
deleted, so a later reader meets the position that was overturned. The consequence to state plainly:
Risk #1 is covered by this rollout only in its *decision* half. Whether the enabled verb is legible
and correctly placed on the screen the room actually sees remains uncovered by any test.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:` date so future readers
can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | 4.1.10 | No config file, deliberately — it reuses the Vite pipeline Astro already runs. `bun run test` |
| DOM environment | happy-dom | 20.11.2 | Selected **per file** by a `// @vitest-environment happy-dom` docblock; the suite default stays `node`. Its `localStorage` is a Proxy — see CLAUDE.md for the two-halved trap |
| type checking | astro check (`@astrojs/check` + TypeScript) | 0.9.10 / 6.x | `bun run type-check`; requires TypeScript 6.x |
| build-time content gate | `assertQuizValid()` at config load | n/a | The project's only currently-enforced gate: a malformed quiz fails `astro build` and therefore fails the deploy |
| API / network mocking | none — hand-rolled fakes and `vi.mock` | n/a | No MSW. Phase 2 and Phase 3 must decide whether the store fake is sufficient rather than inheriting it |
| store fixture (Redis) | none yet — see Phase 2 and Phase 3 | n/a | Currently mocked ad hoc per test file |
| room-scale rehearsal | `scripts/rehearse-room.ts` | n/a | Exists (F-04). Drives the real spine at ~150 devices; deliberately outside the suite and not run per commit |
| retention residue check | `scripts/check-purge-residue.ts` | n/a | Exists (F-03). Runs against the real store; refuses to run while a session document exists. Phase 3 promotes it to a gate |
| e2e / browser | none, and not planned in this rollout | n/a | No Playwright, no Cypress, no browser automation in the repository. See §7 |
| accessibility | none, and not planned | n/a | No risk in §2 names it; adding it would be coverage without a risk behind it |
| AI-native layer | none, and not planned in this rollout | n/a | Deliberate, not an oversight — the one candidate that passed cost × signal was dropped with its reasoning in §7. checked: 2026-08-16 |

**Stack grounding tools (current session):**
- Docs: none — no Context7 or framework docs MCP is exposed in this session; built-in WebFetch and WebSearch are available and stack facts below were taken from local manifests instead; checked: 2026-08-16
- Search: built-in WebSearch only — not used; every version in the table above came from `package.json` and `node_modules`; checked: 2026-08-16
- Runtime/browser: none — **no Playwright MCP is available in this session**, and none is in the repository. This absence is one of the two reasons the visual phase was dropped; see §7; checked: 2026-08-16
- Provider/platform: Vercel MCP present but unauthenticated; Vercel CLI installed at v48 against a current v59, so neither was used as evidence. GitHub is reachable via `gh` for Phase 4's gate wiring; checked: 2026-08-16

## 5. Quality Gates

The full set of gates that must pass before a change reaches production. "Required after §3 Phase N"
means the gate is enforced once that rollout phase lands; before that, the gate is planned.

| Gate | Where | Required? | Catches |
|---|---|---|---|
| quiz definition validity | build (config load) → deploy | required — already enforced | A malformed quiz reaching a live room; the previous good quiz stays live instead |
| lint + format (single edited file) | agent `PostToolUse` hook, `.claude/hooks/per-edit-check.sh` | required — enforced 2026-08-16 | Formatting drift and simple lint errors, while the agent can still fix them itself; exit 2 returns the message as `additionalContext` |
| lint + format (staged files) | pre-commit, `lefthook.yml` | required — enforced 2026-08-16 | The same, on edits the agent hook never saw: manual edits and a teammate's commit |
| scoped tests (risk areas only) | agent `PostToolUse` hook → `scripts/scoped-tests.sh` | required — enforced 2026-08-16 | A regression in a §2 hot-spot, while the agent is still holding the edit that caused it |
| scoped tests (staged files) | pre-commit, `lefthook.yml` → the same script | required — enforced 2026-08-16 | The same, unrestricted by risk area, on edits the agent hook never saw |
| typecheck | pre-commit, `lefthook.yml` (`astro check`) | required — enforced 2026-08-16 locally; §3 Phase 4 moves it to CI | Type drift; strict-config violations |
| unit + integration | pre-push, `lefthook.yml` (`bun run test`) | required — enforced 2026-08-16 locally; §3 Phase 4 moves it to CI | Logic regressions across session, scoring, client and route layers |
| guard verification (break-and-restore) | local, per test authored | required after §3 Phase 1 | Guards that cannot fail — the failure mode that produced Risk #2 |
| retention residue check | between rehearsal runs; before a live session | required after §3 Phase 3 | Attendee data surviving a close, including runtime-assembled key names |
| pre-session smoke (`docs/runbook-live-session.md`) | between merge and a live session | required, manual — and currently unreliable | Environment-specific failures and a silently failed deploy |

Three honest notes. First, the pre-session smoke is the only gate standing between a commit and a live
room today, and the archive records its ten manual rows being closed unchecked at least once — a
gate that exists on paper is listed here as it actually behaves. Second, nothing in this table runs
in CI, because there is no CI; Phase 4 is what changes that, and authoring the pipeline itself is
owned outside this plan. The local layers added on 2026-08-16 do not substitute for it: a git hook
is skippable with `--no-verify` and is installed per clone, so it protects the author's machine
rather than the shared repository state.

Third, this table's lint row reversed a position taken at write time. It read "not planned in this
rollout" until 2026-08-16, when ESLint 10, Prettier 3 and lefthook were installed as Module 3 Lesson
3's per-edit and pre-commit layers. The reversal is recorded rather than overwritten because the
original reasoning still stands where it was pointed: no rollout *phase* installed a linter, and
none of these gates covers any risk in §2 that was not already covered. They shorten the loop; they
do not extend the map.

**The layer split is a cost decision, not a taxonomy.** `astro check` reads all 111 files with no
incremental mode (~7.5s), so a per-edit typecheck would block the agent loop on every save — it
belongs at commit. The per-edit hook stays at roughly a second by lint and format alone, and it is
the only layer that can hand its output back to the agent mid-session.

**Two files are excluded from the formatter, and the reason is Risk #2 itself.**
`src/pages/quiz/host/[slug].astro` and `[slug].astro` are pinned by structural source scans that
assert their inline scripts as literal text. Reformatting them broke five assertions in the host
page's suite — one of which was the poll-loop timer guard, whose regex stopped matching anything at
all and would therefore have gone on passing against a page with no timer. They are listed in
`.prettierignore` rather than reformatted, and the assertions were left alone rather than rewritten to
fit the new line wrapping. Do not remove those two entries without first re-verifying every scan in
both suites by breaking the behaviour each one covers.

**It happened a second time, and the mechanism was the *pin* rather than the formatter.** The
multiple-quizzes change moved both pages under dynamic segments, and `.prettierignore` still named the
old paths — so the pages were un-pinned, a reflow landed, and eight assertions in the host suite went
red at once. **Move a page, move its entry**, and note that the entries escape the brackets
(`\[slug\]`) because `.prettierignore` reads gitignore glob syntax, where a bare `[slug]` is a
character class matching one of `s l u g`. Verify positively rather than by absence of complaint: an
identical copy at an unignored path must be *flagged* by `npx prettier --check` while the real one is
skipped.

**`vitest related` alone is green on the top of the risk map, and that is why the resolver exists.**
Both page suites read their `.astro` pages with `readFileSync`, so those pages are in no module graph:
`vitest related src/pages/quiz/host/[slug].astro` prints "No test files found" and exits 0. A hook wired straight to `related` would therefore report success on precisely the file Risk #1 is
about. `scripts/scoped-tests.sh` maps an `.astro` page to its sibling suite by name, and both the
per-edit hook and the pre-commit job call that one script rather than each spelling the rule — the
same single-reader discipline `verbsFor` and the key registry follow. Verified by deleting one
of the host page's `syncControls()` call sites: the per-edit hook exits 2 and the commit is refused.
**Re-verified after the pages moved** (multiple-quizzes): the mapping is by stem, so
`host/[slug].astro` resolves to its sibling `host/[slug].test.ts`, confirmed in both directions by
breaking one assertion in each suite and watching the gate fail.

The per-edit layer runs tests **only** for the four §2 hot-spots (`src/pages/quiz/`, `src/pages/api/`,
`src/lib/session/`, `src/lib/client/`); a helper or config edit costs ~1.2s for lint and format alone
against ~1.8–2.4s when a suite runs. The pre-commit layer drops the risk filter, because at commit
time the wider net is still under a second.

The baseline was made green by targeted ESLint rule overrides rather than by rewriting product code:
`no-var` off inside `<script is:inline>` blocks (hand-written ES5 on purpose), `no-explicit-any` off
in `*.test.ts`, and `no-useless-assignment` off globally because it misreads the project's fail-safe
`let x = <default>` / try-catch shape. Each override carries its reasoning in `eslint.config.js`.

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the relevant rollout phase
ships; before that, the sub-section reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: beside the module under test, in the same directory.
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/session/scoring.test.ts` — pure functions, exact-edge cases built from
  the formatter or the constant rather than typed by hand.
- **Run locally**: `bun run test`.
- **Mandatory step**: after writing a test for a guard or branch, break that code, confirm this
  specific test fails, restore. See §1's fourth rule and §2 Risk #2.

### 6.2 Adding an integration test

**The open question is settled: there is no store instance, and the tests worth writing do not need
one.** No local Redis, no testcontainers, no emulator; the suite's client is mocked, so the atomic
script is handed to it as a *string* and never executed. What that rules out is real-Lua coverage —
which is already at its ceiling in `scripts/rehearse-room.ts` and must not be rebuilt here. What it
does **not** rule out is everything above the script, which is where both of Risk #4's surviving
failures actually live.

The recipe, in one line: **run one real module against another, stub only the transport between
them, and let the mocks that already exist disagree.**

- **Location**: beside the route that owns the contract, as `<route>.seam.test.ts`.
- **Reference tests**: `src/pages/api/quiz/answer.seam.test.ts` (route → client, across a real
  `Response`) and `src/pages/api/quiz/host/reveal.drift.test.ts` (route → real `applyHostAction` →
  store mocks, with an answer landing mid-request).
- **Run locally**: `bun run test`. No hook or config change is needed — `scripts/scoped-tests.sh`
  hands sources to `vitest related`, which reaches a seam file from either module it imports.

Five things these two files learned the hard way:

1. **Make the mocks disagree.** A seam test whose mocks all tell the same story is a slower unit
   test. `readSession` says the question is open while `submitAnswer` says it is not — that
   contradiction *is* the reveal landing mid-request, and no existing test creates it.
2. **Stub the transport, never the peer.** `answer.seam.test.ts` stubs `globalThis.fetch` and hands
   the route's own `Response` to the real client. A helper that built its own response would be
   testing the helper.
3. **A `Response` body is one-shot.** Clone it *inside* the stub, before the client reads it — a
   clone taken at the assertion throws "Body has already been consumed".
4. **Check which module the file under test mocks.** `routes.test.ts` mocks `applyHostAction`, so an
   interleaving *inside* that function cannot be expressed there at all; the drift test needed a file
   of its own with the real one. This is the first question to ask before adding to an existing suite.
5. **Preconditions are not optional decoration.** Pin the clock (`vi.spyOn(Date, "now")`) and derive
   `updatedAt` from the question's own `timeLimitSeconds`, or an open-question fixture drifts into the
   expired branch; stub `LIVEQUIZ_HOST_SECRET` and send the header, or a host route 401s and the
   assertions never run. Keep the default `node` environment unless the code under test truly touches
   the DOM — a copied happy-dom docblock buys nothing and inherits the `localStorage` Proxy trap.

### 6.3 Adding a test that needs a DOM

- **Location**: beside the client module, in `src/lib/client/`.
- **Naming**: `<module>.test.ts`, with `// @vitest-environment happy-dom` as the first line.
- **Reference test**: `src/lib/client/device.test.ts` — note its `withBroken(method, body)` helper,
  which installs the failure with `vi.spyOn` and restores with `spy.mockRestore()`. A plain
  assignment is swallowed by happy-dom's `localStorage` Proxy and `vi.restoreAllMocks()` does not
  reach the spy; both halves are required and CLAUDE.md explains why.
- **Run locally**: `bun run test`.

### 6.4 Adding a test for a new API route

- **Test type**: integration, at the route.
- **Reference test**: `src/pages/api/quiz/answer.test.ts`.
- **Mandatory case**: for every untrusted field, assert the outcome when the field is *absent*, not
  only when it is hostile — and assert the resulting value (the award, the count), never merely the
  status code. See §2 Risk #5.
- **Run locally**: `bun run test`.

### 6.5 Adding a test for an Astro view

**The recipe is: don't. Move the rule out first.** An inline `<script>` has no harness, so the only
guard available over it is a source-text scan — and a scan for an expression that exists today
certifies whatever is there, defects included (§1, rule four). Reference implementation:
`src/lib/client/controls.ts` and `controls.test.ts`, landed by rollout phase 1.

1. **Find the decision, and check what it closes over.** Anything that only closes over
   `define:vars` data — the question list, a channel name — is already pure; take that value as a
   parameter. `verbsFor`, `atLastQuestion` and `pollTargetFor` all moved this way; `syncControls`
   did not, because it writes the DOM.
2. **Move it to `src/lib/client/` as plain named exports.** No factory unless it holds state
   (`classifyConnection` in `session.ts` is the stateless shape; `countdown.ts` is the stateful one).
   `SessionState`, `SessionPhase` and `PublicQuestion` arrive as `import type` — a value import fails
   `boundary.test.ts`.
3. **Keep the lookup table private and export a function over it.** This is the part worth copying.
   `host/[slug].test.ts` used to assert `CONTROL_RULES` had exactly one reader; exporting `verbsFor` with
   the table private makes a second reader *unrepresentable*, which retires that guard rather than
   re-expressing it. A guard you can delete is better than a guard you have to maintain.
4. **Type the table as a `Record` over a union**, so adding a phase or a question kind is a
   `bun run type-check` failure rather than a silent fallback. This is the project's cheapest
   exhaustiveness check and it costs one type annotation.
5. **Assert the property against something other than itself.** The panel's rules are checked
   against a literal of *route* legality, not against the panel. State the relationship honestly: it
   is `panel ⊆ routes` plus a named exception list, not equality — an equality assertion fails on
   correct code. Where the comparison table is hand-maintained, say so at the code and point at the
   test that executes the other side.
6. **Leave the page's scan alive, retargeted.** It keeps what only it can see: that the page reaches
   for the module, applies the decision at every site that could undo it, and states no rule of its
   own. Add a *positive* assertion that the import exists — without it, the negative assertions are
   satisfied by a page that dropped the behaviour entirely.
7. **Build fixtures as literals, not from the committed quiz.** `questionOfKind` is for code that
   resolves through `getQuestionById`; a predicate taking a list as a parameter does not. A `Record`
   over the kind union gives coverage the real quiz cannot — it only proves the kinds it happens to
   contain. `render.test.ts` is the precedent in that directory.

There is still no recipe for the *visual* half — whether the enabled verb is legible and correctly
placed on a projector. That is out of scope for the whole rollout; see §7.

### 6.6 Per-rollout-phase notes

**Phase 1 — Host control rules, executable** (`context/changes/testing-host-control-rules/`,
`c780a12`, `06b583c`, `fbdc914`).

- **The research's central finding was wrong, and this is the more useful lesson.** It reported six
  `-1` inversions — `indexOf(a) < indexOf(b)`, which holds vacuously when `a` is absent — and called
  one of them "the sharpest": the two-tap guard on the irreversible close. Measured by deleting each
  guarded statement and re-running, **all six failed correctly**. Every one already carried a
  `toContain` on the line directly above; the audit read the `indexOf` line in isolation. Checked
  against the commit the research read, so it was not a later fix. **An audit of a guard must
  execute it, not read it — the same rule the audit was written to enforce.**
- What *was* real: the presence check and the ordering check were two separable statements, and the
  second reads redundant beside the third. Reverting one site to the bare idiom and deleting the
  guarded statement leaves the suite green. `expectOrder(haystack, first, second)` in
  `host/[slug].test.ts` and `[slug].test.ts` fuses them. Duplicated rather than shared — the two files
  import nothing from each other, and a helpers module for ten lines is the larger cost.
- **Two portability gates had never been shown to fire.** Replacing `ASTRO_IMPORT` in
  `src/quiz/portability.test.ts` or `src/lib/session/portability.test.ts` with a regex that can
  never match left all 12 and all 32 tests green. Both now export `findAstroImports` with fixtures,
  following `boundary.test.ts`. **Trap:** each file's `sourceFiles()` globs every `.ts` in its
  directory *including the test file itself*, so the forbidden specifier must be assembled at
  runtime — written out in full, the fixture becomes the violation it demonstrates.
- **A withholding in an unreachable state is not a decision.** The exception-list sweep initially
  demanded an entry for `end` in `lobby` on the last question; `lobby` carries no current question,
  so nothing can reach it. The sweep runs over the nine reachable phase × position pairs, with the
  reachability claim tied to `atLastQuestion`'s own behaviour rather than restated.

**Phase 2 — Sync under a degraded link** (`context/changes/testing-sync-degraded-link/`,
`b613981`, `ba3d4be`, `f56a533`, `571a98b`). Break-and-restore evidence for every test below is in
that folder's `verification.md` — eight runs, each observed rather than reasoned about.

- **The extraction, again, and for the fourth time.** `apply` — the version guard that is the
  client's *only* convergence primitive — was a closure inside `createSessionClient`, which no test
  constructs, because constructing it means faking Ably and a module mock freezes the SDK's API.
  `createSnapshotReconciler` is now beside `createFallbackPoll`, following `countdown.ts`,
  `toast.ts` and `controls.ts`. **Delivery and adoption are different steps**: the loop's 19 tests
  proved a request goes out; nothing proved the snapshot it brings back is what the device renders.
- **Three defects pinned, not fixed** (the decision at the end of §2). Each pinned test carries an
  inversion note, and **that note is the rule for this whole phase**: *if this fails, the defect was
  fixed — invert the expectation and delete the note; do not restore the behaviour.* Without it a
  pin is the most inviting possible instance of the anti-pattern §2 Risk #2 names.
  1. **`pause()` is not terminal.** An in-flight tick's `finally` re-arms past it — the same class
     as impl-review F3, in the one sibling of `stop`/`dispose` never given a flag.
     (`session.test.ts`, "pause during an open request is undone by the finally".)
  2. **A `not-open` 409 reaches the attendee as a recorded answer.** The reveal lands between the
     route's read and the script's re-read, nothing is written, and the client treats the classless
     409 as final. (`answer.seam.test.ts`.)
  3. **The reveal's distribution can be one short.** The tally read sits outside the version guard,
     and `applyHostAction`'s `readPlayerCount` round trip sits inside the gap.
     (`reveal.drift.test.ts`.)
- **A test that could not fail, inside the file the archive holds up as Risk #2's remedy.**
  `session.test.ts`'s *"stop during an open request is resumable, unlike dispose"* asserted a fetch
  count that holds whether `stop` is resumable-by-arm or simply undone by the `finally`. The
  distinguishing assertion is `isArmed()` **between** the settle and the arm. Renamed to what it
  observes, with the resumability its old name claimed asserted separately, where it does hold.
- **Fixing a refusal class takes both halves, and one half alone looks like a fix.** Giving the
  route's `not-open` its own class changed nothing an attendee experiences — the client maps every
  non-`expired` class to `rejected`, which is final. Found by breaking, not by reading: a single
  test would have gone green and reported the defect closed while the phone still locked. Whoever
  takes that fix needs `answer.ts` *and* `client/answer.ts` in the same change.
- **The drift is closable by moving one await.** Hoisting `readPlayerCount()` above the `nextFrom`
  callback in `host.ts` removes the round trip from the window, and `playerCount` is documented as
  stale-tolerant, so reading it early costs nothing. Not applied here.
- **The named residual, stated so nobody reads this phase as complete coverage of #4.** A reveal
  fired *during* a concurrent burst — the interleaving below the atomic script — is exercised by
  nothing. `scripts/rehearse-room.ts` completes its burst, then audits, then reveals; it runs by
  hand against production and gates nothing. Extending it was considered and declined: signal that
  arrives only when someone remembers to run it, against the store phase 1's impl-review F1 showed a
  misfiring hook can destroy. An ephemeral instance is a stack change belonging to §3 Phase 4.
- **`client.close()` still has no caller anywhere in `src/`.** The terminal exit impl-review F3
  built is dead code in production — the same finding that slice made about *its* predecessor.

## 7. What We Deliberately Don't Test

Exclusions agreed during the rollout. Future contributors should respect these unless the underlying
assumption changes.

- **The marketing site** — the event archive, speaker directory, and their content-collection joins.
  Prerendered, stable for months, and nobody is on stage when it breaks. Re-evaluate if a content
  route stops being prerendered or starts carrying request-time data. (Source: Phase 2 interview Q5.)
- **Content collection schemas** — the Zod schema at the collection boundary is the test, and an
  unresolved slug is visible on the rendered page. Re-evaluate if a join moves somewhere a human
  does not look before publishing.
- **Host view access control** — the control view is deliberately unprotected and the PRD records
  the acceptance explicitly. Re-evaluate only if that decision is reversed.
- **Word-cloud submission moderation** — a PRD non-goal, surfaced and accepted during shaping.
  Re-evaluate if the reputational judgement changes.
- **Visual and layout regressions on the host and attendee screens** — dropped at write time
  (2026-08-16) after being proposed as a fifth rollout phase, so this exclusion is a decision rather
  than an oversight. It was the one AI-native candidate that passed cost × signal: CLAUDE.md records
  two shipped geometry defects on the projector (the control bar wrapping at 1440, and a band of
  reserved empty rail), both caught by eye rather than by a test, and both landing on the host's
  primary success criterion of not fighting the tool in front of the room. It was dropped because no
  browser automation exists in the repository and no Playwright MCP is available, making it a
  from-zero build for a class of defect that is visible the moment anyone opens the page.
  **Accepted cost:** Risk #1 is covered in its decision half only — that the right verb is *enabled*
  will be proven; that it is legible and correctly placed on a projector will not. Re-evaluate if a
  geometry defect reaches a live session, if browser automation arrives for another reason, or if the
  host view stops being opened manually before a session. (Source: rollout decision, 2026-08-16.)

  **Amended 2026-08-16 — the third trigger fired.** Browser automation arrived for another reason:
  Playwright was installed with the toolkit's `/10x-e2e` skill, and `e2e/seed.spec.ts` and
  `e2e/host-question-open.spec.ts` now drive the host panel in Chromium. This exclusion is therefore
  no longer accurate as written, and the position it overturns is kept above rather than deleted —
  the reasoning for dropping the phase was sound at the time and would apply again if the tooling
  went away.

  What exists now, stated precisely so nobody reads more into it than is there: **two DOM-level
  specs asserting which verbs the panel offers, wired to no gate**, run only by a deliberate
  `bun run e2e`. They cover Risk #1's rendered half in the sense that they assert against a real
  browser after a real transition — they do **not** cover geometry, legibility or projector widths,
  which is what the dropped phase was actually about. The accepted cost above therefore stands
  unchanged: no test in this repository will catch a control bar wrapping at 1440.

  Two consequences worth carrying: these specs drive the **real** Upstash namespace from `.env`
  (see `e2e/E2E-RULES.md`, and the teardown defect the first implementation review caught), and the
  vitest scripts now carry `--dir src` to keep the two runners' globs apart.
- **Live realtime and store connections inside the suite** — latency and flake on every run buys
  nothing the two existing out-of-band scripts do not already cover. Re-evaluate if those scripts
  stop being run.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-16 (§2 Risk #1 and #2 amended 2026-08-16 by rollout phase 1;
  §2 Risk #3 and #4 amended and §6.2 filled in 2026-08-16 by rollout phase 2)
- Stack versions last verified: 2026-08-16
- AI-native tool references last verified: 2026-08-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
