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
| 2 | A regression reaches a live session because the suite was green: the guard covering that area asserts source shape rather than behaviour, and cannot fail when the behaviour breaks | High | High | interview Q2; `context/foundation/lessons.md` (three entries: source-scanning guards, break-the-guard, prove-the-fixture); `context/archive/2026-08-14-per-question-timer/`; **measured 2026-08-16 in `context/changes/testing-host-control-rules/research.md` — of ~150 assertions in the project's highest-churn view, none is a property assertion and six pass against deleted code** |
| 3 | A host transition reaches some phones and not others; the room desynchronises and nothing on stage indicates which devices are stuck | High | Medium | interview Q1; PRD Success Criteria guardrails (1-second reflection; no divergence in standings between devices); hot-spot dir `src/lib/client/` (65 commits/30d); `context/archive/2026-08-09-connection-limit-degradation/` |
| 4 | An answer submitted before the reveal is lost from the tally, or counted twice, under room-scale concurrency | High | Medium | PRD US-02 acceptance criterion ("no answer submitted before a reveal is lost from the tally"); PRD Success Criteria guardrail (150 concurrent, no lost answers); hot-spot dirs `src/lib/session/` (144 commits/30d), `src/pages/api/` (90 commits/30d) |
| 5 | A submission that omits or malforms a field is scored favourably rather than refused, producing a silently wrong award on a public leaderboard | Medium | Medium | `context/foundation/lessons.md` ("Absent untrusted input must fail toward the safe end", lived in S-03); PRD FR-019; hot-spot dir `src/pages/api/` (90 commits/30d) |
| 6 | One device registers enough players to flood the room and wreck the final reveal | Medium | Medium | PRD FR-018 (recorded as an explicitly lightweight, defeatable guard); PRD FR-007 Socratic challenge; `context/archive/2026-08-14-resilient-join/` |
| 7 | Attendee display names or submitted answers outlive the session that collected them | High | Low | PRD Success Criteria retention guardrail and its four recorded deviations; `context/archive/2026-08-06-session-end-and-data-purge/`; `context/archive/2026-08-12-word-cloud-question/` (the tally key stopped being counters-only) |

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
| #1 | For every phase and last-question position, the panel offers **no** verb the route would refuse; and every verb the route accepts but the panel withholds appears in an explicit, named exception list. **A one-way implication plus a closed exception set — not an equality** | (a) "The routes refuse illegal transitions anyway, so the panel is cosmetic." The PRD's primary success criterion is the host not fighting the tool; the panel is the interaction, the refusal is the backstop. (b) "The panel's phase rules are one mechanism." They are two — the flow-verb table, and a separate inline rule governing the closing verb | Where the phase-to-verb decision is actually made, whether that decision is reachable from a test process at all, what determines the last-question variant, and the full list of places the panel deliberately offers *less* than the route | unit, over a pure decision function | Asserting panel/route **equality**, which fails on correct code — the panel withholds five verbs the routes accept, four of them for recorded reasons; re-asserting the table's source text; testing the renderer instead of the decision |
| #2 | Each guard fails when the code it covers is broken, and passes when restored — demonstrated, not assumed | "The test is green, therefore the behaviour holds." A scan for an expression that exists today certifies whatever is there, defects included | Which existing tests execute code and which scan source text; which of the scans assert a property versus a current shape; which properties have no harness and why | unit, plus **conversion of any scan that must remain to the detector-plus-fixture pattern this project already uses in two of its structural guards** — a discipline alone cannot fix a guard that passes on deleted code | Repairing a newly-failing guard back toward the bug it just caught; pinning a symbol name rather than a property; **ordering assertions of the form `indexOf(guard) < indexOf(action)`, which hold when the guard is absent because the miss returns −1** |
| #3 | A device whose primary transport drops converges on the host's current phase within the guardrail, and a stop actually stops | "The fallback loop is running, therefore it is delivering." `lessons.md` records a `stop()` silently undone by the `finally` of a request the test never knew about | Both lifecycle exits, what re-arms the loop, what the visibility rule is, and what the real settle points are | integration, with pinned interval randomness and manually-settled deferreds | Advancing fake time by the widest jittered interval and assuming one advance is one tick; a stub that resolves immediately in a test whose name claims an overlap |
| #4 | An answer accepted at the deadline boundary appears in the tally exactly once, and concurrent submissions do not lose each other | "The write is atomic, therefore the count is right." The race is between the deadline, the reveal transition and the tally write — not inside any one atomic script | The ordering guarantee at the reveal boundary, what the grace window does, and the store's real semantics versus the fake the suite currently uses | integration at the store boundary; room-scale concurrency stays with the existing harness | Mocking the store so that the atomicity under test is the mock's; asserting the count without asserting which submissions produced it |
| #5 | An absent field is refused rather than coerced, and the test asserts the resulting *award* rather than that the request was accepted | "The hostile value is guarded, therefore the absent value is too." These take different paths through the same code | Every untrusted field on every submission route, and what "said nothing" currently yields for each | integration, at the route | Spelling the absent case as `undefined` where a destructuring default silently replaces it; asserting a status code where the defect is in the number |
| #6 | The cap holds across repeated claims from one device, and a claim refused for a different reason charges nobody | "Resume is exempt, therefore resume is free." The exemption is the entire substance of the slice that introduced it | The claim path's internal ordering, what the counter actually counts, and what an absent device identifier does | integration, at the route | Testing the cap with a fresh device on each attempt, which exercises no cap at all |
| #7 | After a close, no registered key holds attendee data — including any key whose name is assembled at runtime rather than declared | "The key scan passes, therefore the namespace is clean." The scan catches declared literals only, by design | Which key names are assembled rather than declared, and what the existing residue check does and does not reach | the existing residue script, promoted to a gate | Writing a second literal scan instead of checking the real store; treating a green scan as coverage of the runtime-assembled case |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder via `/10x-new`. Status
moves left-to-right through the values below; the orchestrator updates Status as artifacts appear on
disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Host control rules, executable | Prove the panel offers no verb the phase refuses by running the decision, not by reading its source | #1, #2 | unit | researched | `context/changes/testing-host-control-rules/` |
| 2 | Sync under a degraded link | Prove a device converges on the host's phase after the transport drops, and that no answer is lost at the reveal boundary | #3, #4 | integration | not started | — |
| 3 | Submission edges and the retention floor | Prove absent and hostile fields fail toward refusal, the per-device cap holds, and no registered key outlives the session | #5, #6, #7 | integration, contract, existing scripts | not started | — |
| 4 | Gates wired | Make the checks that already run locally run between a commit and production | cross-cutting | gates | not started | — |

Order rationale. Phase 1 is the highest risk at the lowest cost, and it is the area the team named
as least confident. Phase 2 depends on the timing discipline Phase 1 establishes, because its risks
are the ones the archive shows fake timers getting wrong. Phase 4 is last on purpose: a gate wrapped
around a suite nobody trusts yet enforces the wrong thing.

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

**Two files are excluded from the formatter, and the reason is Risk #2 itself.** `src/pages/quiz/host.astro`
and `index.astro` are pinned by structural source scans that assert their inline scripts as literal
text. Reformatting them broke five assertions in `host.test.ts` — one of which was the poll-loop
timer guard, whose regex stopped matching anything at all and would therefore have gone on passing
against a page with no timer. They are listed in `.prettierignore` rather than reformatted, and the
five assertions were left alone rather than rewritten to fit the new line wrapping. Do not remove
those two entries without first re-verifying every scan in `host.test.ts` and `index.test.ts` by
breaking the behaviour each one covers.

**`vitest related` alone is green on the top of the risk map, and that is why the resolver exists.**
`host.test.ts` and `index.test.ts` read their `.astro` pages with `readFileSync`, so those pages are
in no module graph: `vitest related src/pages/quiz/host.astro` prints "No test files found" and exits
0. A hook wired straight to `related` would therefore report success on precisely the file Risk #1 is
about. `scripts/scoped-tests.sh` maps an `.astro` page to its sibling suite by name, and both the
per-edit hook and the pre-commit job call that one script rather than each spelling the rule — the
same single-reader discipline `CONTROL_RULES` and the key registry follow. Verified by deleting one
of `host.astro`'s `syncControls()` call sites: the per-edit hook exits 2 and the commit is refused.

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

- TBD — see §3 Phase 2.
- Open question that phase must settle rather than inherit: whether the ad-hoc store fake is
  sufficient for the ordering guarantees Risk #4 depends on.

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

- TBD — see §3 Phase 1 for the host panel's decision rules. There is no recipe for the *visual* half
  and this rollout does not produce one; see §7.
- The existing files (`src/pages/quiz/host.test.ts`, `src/pages/quiz/index.test.ts`) are structural
  source scans, which is what Risk #2 is about. Do not add a scan without first asking whether the
  property can be made executable instead.

### 6.6 Per-rollout-phase notes

(Filled in as phases land.)

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
- **Live realtime and store connections inside the suite** — latency and flake on every run buys
  nothing the two existing out-of-band scripts do not already cover. Re-evaluate if those scripts
  stop being run.

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-08-16
- Stack versions last verified: 2026-08-16
- AI-native tool references last verified: 2026-08-16

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
