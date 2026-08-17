---
project: bizarre-bar
researched_at: 2026-08-05
recommended_platform: Vercel
runner_up: Cloudflare Workers
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6.4 (output "server", per-route prerendering)
  runtime: Node 22 / bun
  realtime: Ably (managed, external)
---

# Infrastructure decision — LiveQuiz on the Brave AI Community Szczecin site

All platform facts below were researched on **2026-08-05** against live pricing pages and official
docs. Every non-GA capability is marked inline. No `tech-stack.md` exists for this project (it is a
greenfield artifact; this is a brownfield repo), so the stack was read from `astro.config.ts`,
`package.json`, and `tsconfig.json`.

## Recommendation

**Stay on Vercel, and carry the realtime layer on Ably.**

The interview settled the decisive question: LiveQuiz does **not** need to own persistent server-side
connections, so a managed realtime provider carries the sockets and the hosting platform only has to
serve Astro SSR — which Vercel already does today, in production, with zero migration cost. Vercel
passes four of the five criteria outright (CLI-first, managed, agent-readable docs, scriptable deploy
API) with only its MCP server in beta. Ably stays inside its free tier at 150 concurrent participants
(200 peak connections, 6M messages/month), needs no database, and is GA.

Two conditions attach to this recommendation, both from the cross-check rather than the scoring:

1. **Upgrade to Vercel Pro.** The Hobby plan is *"restricted to non-commercial personal use only…
   includes donations"*, and this site carries a sponsor logo and outbound link. Pro ($20/seat/month)
   also unlocks EU region selection and longer log retention, both of which this project needs.
   Cost-neutrality was released during shaping, so this is affordable — but it is now a prerequisite,
   not an optimization.

   > **AMENDED 2026-08-06 — Pro upgrade deferred by user decision.** The project stays on **Hobby**. The
   > user's judgment on record: although the site carries Brave Courses branding, it is a free local
   > community initiative rather than a commercial project. Recorded in
   > `context/changes/deployment-target-readiness/change.md`; the licensing exposure is accepted with a
   > tripwire (below).
   >
   > **Two claims in this document turned out to be factually wrong**, and the deferral is not the reason
   > — they were wrong when written. Both were disproven empirically in F-01 Phase 2; evidence in
   > `context/changes/deployment-target-readiness/region-probe.md`:
   >
   > - **"Pro unlocks EU region selection"** — no. A Hobby deployment carrying
   >   `regions: ["fra1"]` in `vercel.json` reports `λ _render … [fra1]` under `vercel inspect`. `iad1`
   >   was the *default*, not a plan-enforced ceiling. The EU region is already in place on Hobby (see
   >   §Getting Started step 1).
   > - **"Preview URLs are publicly reachable by default"** (§Operational Story) — not for this project.
   >   Vercel Authentication is enabled; anonymous requests to a preview get a `302` to
   >   `vercel.com/sso-api`. This *improves* the PRD's unprotected-host-view concern for previews,
   >   though production remains unprotected.
   >
   > What remains genuinely Pro-only for this project is **log retention** (~1 hour on Hobby). That is
   > handled operationally by `docs/runbook-live-session.md`, which has the host tail logs live rather
   > than retrieve them afterwards.
   >
   > **Tripwire — revisit Pro if either fires.** Owner: the repository owner (account holder). Re-read as
   > a line item in the runbook's pre-session checklist, because a tripwire nobody is scheduled to check
   > is not a tripwire.
   > 1. **Latency**: a rehearsal or live session shows state reaching attendee devices in more than one
   >    second. Now much less likely — functions run in Frankfurt, so the transatlantic round trip that
   >    motivated this is gone.
   > 2. **Licensing**: Vercel makes any contact about fair use.
2. **Do not attempt realtime on Vercel itself.** Its native WebSocket support is public beta and caps
   connection duration below the length of one quiz. Details in the cross-check.

## Platform Comparison

| Platform | CLI-first | Managed / serverless | Agent-readable docs | Stable deploy API | MCP / integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare Workers | Pass | Pass | Pass | Pass | Pass | 5 pass |
| **Vercel** | **Pass** | **Pass** | **Pass** | **Pass** | **Partial** | **4 pass, 1 partial** |
| Render | Partial | Pass | Pass | Pass | Pass | 4 pass, 1 partial |
| Netlify | Partial | Pass | Pass | Pass | Pass | 4 pass, 1 partial |
| Railway | Partial | Pass | Pass | Pass | Partial | 3 pass, 2 partial |
| Fly.io | Partial | Pass | Pass | Pass | Partial | 3 pass, 2 partial |

**Hard filters applied:** the interview answer "a managed realtime service is fine" means no platform
was dropped for lacking persistent connections. Had the answer been "yes, I want to own the realtime
layer", Netlify (no WebSocket primitive at all) and Vercel-native (beta, duration-capped) would both
have been filtered out — worth recording, because that answer is the load-bearing one in this decision.

**Soft weights applied:** cost-vs-DX was answered "roughly equal", so no cost penalty was applied.
Familiarity with Vercel, Supabase and Cloudflare broke ties toward Vercel and Cloudflare. "Single
region is fine" removed any edge-native advantage, which is the main reason Cloudflare's five-pass
score did not automatically win. "External providers are fine" removed any co-location advantage.

### Per-platform notes

**Cloudflare Workers** — the only platform passing all five criteria. `wrangler deploy`,
`wrangler tail`, and `wrangler rollback` cover the full loop; docs ship as `llms.txt`, `llms-full.txt`,
per-page markdown and public GitHub source; the MCP surface is extensive (2,500+ endpoints) though
carries no explicit GA label. Free tier is 100k requests/day. Durable Objects with the WebSocket
Hibernation API are GA and would solve realtime *and* session state in one primitive at roughly 0.3%
of a single free day per session. The cost is migration: `@astrojs/cloudflare` **v13.x** is the line
for Astro 6 (v14 pins Astro 7), v13 dropped Cloudflare Pages support entirely, removed
`Astro.locals.runtime`, and exporting a Durable Object class requires a custom `workerEntryPoint`.
Node APIs need `nodejs_compat` plus `compatibility_date >= 2024-09-23`.

**Vercel** — the incumbent. Full CLI loop (`vercel deploy --prod`, `vercel rollback`,
`vercel logs --follow`), `llms.txt` and per-page markdown, MCP at `mcp.vercel.com` in **beta on all
plans**. `@astrojs/vercel` **v10.0.8** is the correct line for Astro 6; **v11 requires Astro 7** and is
therefore a framework upgrade rather than a bump. Scored down only on MCP maturity — and separately
constrained by the Hobby licensing issue, which is a policy matter the criteria do not capture.

**Render** — genuinely good CLI (v2.22.0, Go), GA MCP server, WebSockets GA with no max duration, and
a **Frankfurt** region available. Marked partial on CLI only because rollback is dashboard or REST API,
with no CLI verb. Free web services spin down after 15 minutes idle with a 30–60 second cold start,
which is disqualifying for a live event; the Starter tier is $7/month. A credible migration target if
Vercel's licensing became unworkable.

**Netlify** — competent hosting with a GA MCP server, but the weakest fit here. **No WebSocket
primitive exists** (the term does not appear in its `llms.txt`), functions cap at 60s, and SSE
connections are closed at ~28–30s. Its free tier is a **hard credit cap that takes the site offline**
on exhaustion, and free-tier functions are pinned to US-East Ohio with region selection reserved for
Pro+. For EU participants under a one-second budget, that is a poor default.

**Railway** — native persistent processes; WebSockets are explicitly exempt from idle and request
timeouts and can stay open indefinitely, with a 10,000 concurrent-connection ceiling per service.
Single EU region (Amsterdam). $5/month floor including $5 usage credit. Marked partial on CLI because
rollback is dashboard-only, and on MCP because the remote endpoint and agent shipped 2026-04-17
without a GA label. The best choice *if* the persistent-connection answer ever flips to yes.

**Fly.io** — WebSockets pass through the proxy natively and scale-to-zero is configurable, but there is
**no free tier** (withdrawn for new customers October 2024), no rollback command (documented workaround
is redeploying a prior image label), and `fly launch` creates **two machines by default** — which
splits in-memory session state unless pinned with `fly-replay` or externalized. Managed Postgres starts
at $38/month. Cold start from stopped is 2+ seconds, with community reports of outliers near 30s.

### Shortlisted Platforms

#### 1. Vercel (Recommended)

Wins on the thing the other five cannot offer: it is already running this site in production, with a
working deploy pipeline, a configured domain, and a team that knows it. With realtime delegated to
Ably, nothing about LiveQuiz exceeds what Vercel already does — Astro 6 SSR with on-demand routes plus
prerendered content pages, which is exactly the current architecture. The full operational loop is
CLI-driven, so an agent can deploy, inspect, and roll back unattended.

#### 2. Cloudflare Workers

The strongest technical fit and the only five-pass platform. Durable Objects would collapse the two
hardest requirements — sub-second fan-out and session state that survives a reload — into a single free
primitive, and would resolve PRD Open Question 7 outright rather than by adding a vendor. It placed
second only because the interview removed the two advantages that would have made it decisive (edge
reach and service co-location), leaving a real migration as the price of a benefit LiveQuiz does not
strictly need. **Revisit this if Ably's limits ever bind, or if a second stateful feature appears.**

#### 3. Railway

The answer to a different question: if owning the socket layer ever becomes preferable to renting it,
Railway offers persistent processes, an EU region, and no connection-duration ceiling, for $5/month.
Kept on the shortlist as the escape hatch from managed-realtime pricing.

## Anti-Bias Cross-Check: Vercel

### Devil's Advocate — Weaknesses

1. **The Hobby plan forbids commercial use, and this site is arguably commercial.** Fair-use policy:
   *"Hobby teams are restricted to non-commercial personal use only… includes donations."* The site
   carries a Brave Courses sponsor logo and outbound link. Enforcement is discretionary and the failure
   mode is a paused project — potentially during an event. This risk exists **today**, independent of
   LiveQuiz.
2. **Vercel's own Astro documentation is stale.** Its framework page still documents the removed
   `@astrojs/vercel/serverless` import and `output: 'hybrid'`. An agent that trusts it will generate
   config that does not work against the v10 adapter in this repo.
3. **The adapter upgrade path is a framework major.** `@astrojs/vercel` v11 requires Astro 7. Anyone
   "just updating the adapter" is committing to an Astro major.
4. **Native WebSockets cannot span a single quiz.** Public beta since 2026-06-22, requires Fluid
   compute, and the connection dies at the function's max duration — 300s on Hobby, 800s GA on Pro
   (1800s in beta) — against a ~900s session. Connections are pinned to one instance with no
   cross-instance fan-out, presence, or ordering; Vercel's own guidance is to keep pub/sub in external
   Redis. Astro is absent from Vercel's WebSocket recipes and has no adapter-level upgrade API. Going
   Vercel-native for realtime is not viable, which is why the external provider is a requirement rather
   than a preference.
5. ~~**Hobby is single-region (`iad1`, US East)** with region selection reserved for Pro and above.~~
   **DISPROVEN 2026-08-06.** `iad1` is the *default*, not a plan-enforced ceiling: a Hobby deployment
   with `regions: ["fra1"]` in `vercel.json` reports `λ _render … [fra1]`, while production built before
   the key existed reports `iad1` via `x-vercel-id`. Evidence and method in
   `context/changes/deployment-target-readiness/region-probe.md`. The transatlantic-latency concern this
   raised is real but already addressed, and did not require a paid plan.

### Pre-Mortem — How This Could Fail

The team stays on Hobby because it is free and the site already works. LiveQuiz ships with Ably
carrying the sockets, and the first live session goes fine — the realtime layer was never the risk.
Two months later a compliance sweep flags the sponsor logo and the project is paused, taking the event
archive, speaker directory and newsletter endpoint down with it. Nobody is paged, because no monitoring
exists; a community member reports it. Recovery is slow because Hobby retains runtime logs for one hour
and the evidence is long gone. Meanwhile an agent asked to "fix a deploy warning" reads Vercel's stale
Astro page, reintroduces `output: 'hybrid'`, and breaks the build — undetected, because nothing runs
between a commit and production. The post-mortem finds that every conversation about risk had been
about realtime and concurrency, while the platform underneath was never modelled at all.

### Unknown Unknowns

- **Hobby runtime logs are retained for one hour.** After a failed event the diagnostic evidence is
  already gone. This also undercuts debugging the newsletter endpoint 503 recorded in
  `health-check.md`.
- **Vercel Postgres and Vercel KV no longer exist as first-party products.** Postgres and Redis are
  Marketplace integrations now (Neon, Upstash, Supabase). First-party storage is Blob and Global Config
  (the renamed Edge Config). Any guidance naming Vercel Postgres/KV is out of date.
- **Bytecode caching applies in production only** (Node 20+), so local cold-start impressions will not
  match live behaviour.
- **Hobby projects cannot connect to Git-organization repositories.** Moving `ai-community-szn` into a
  GitHub org would break the deploy pipeline.
- **1,024 file descriptors are shared across concurrent executions on an instance** — irrelevant while
  Ably holds the sockets, but a hard ceiling if that ever changes.
- **On the realtime side: the familiar option is the wrong one.** Supabase Realtime's free tier allows
  200 peak connections but only **100 messages/second**, and a single broadcast to 150 clients bills as
  150 messages *simultaneously* — exceeding the ceiling and disconnecting clients until throughput
  drops. Presence caps at 20 messages/second, so 150 participants calling `track()` at join also
  breaches it. Free projects additionally pause after 7 days of low database activity, which a
  realtime-only app will trigger. Supabase Pro ($25/month) raises the limits, but the point stands:
  prior familiarity pointed at the option with a defect matching this workload's exact shape.

## Operational Story

- **Preview deploys**: Vercel creates a preview deployment automatically for every branch and pull
  request, at a generated URL, with no configuration. ~~Preview URLs are publicly reachable by default —
  acceptable here since the site holds no private data, but note a preview of the quiz host view would
  also be publicly reachable, which compounds the "no host-view protection" decision recorded in the
  PRD.~~ **CORRECTED 2026-08-06:** not for this project — Vercel Authentication is enabled, so anonymous
  requests to a preview URL return `302` to `vercel.com/sso-api` and no function executes. A preview of
  the quiz host view would therefore **not** be publicly reachable, which *reduces* rather than compounds
  the PRD's host-view concern; production remains unprotected. Practical consequence: verifying that a
  preview renders needs a logged-in browser — an anonymous `curl` only ever sees the redirect. Fork PRs
  do not receive environment variables.
- **Secrets**: environment variables live in Vercel's per-environment store (Production / Preview /
  Development), set with `vercel env add <NAME> <environment>` or in project settings; `.env.example`
  documents the required set (`RESEND_API_KEY`, `ADMIN_EMAIL`, `RESEND_AUDIENCE_ID`,
  `SLACK_WEBHOOK_URL`, plus `ABLY_API_KEY` once added). Anyone with project access can read them.
  Rotation is manual: set the new value, redeploy, revoke the old key at the provider.
- **Rollback**: `vercel rollback <deployment-url-or-id>`, with `vercel rollback status` to confirm.
  Time-to-revert is seconds because prior deployments remain immutable and pre-built. Caveat: rollback
  reverts code only — it does not revert environment variables, Resend Audience contacts already
  created, or anything held in Ably.
- **Approval**: promoting to production is human-gated in practice because production deploys are
  triggered by pushing to `main`. An agent may deploy previews, read logs, and inspect deployments
  unattended. Rotating the Resend or Ably keys, changing the plan or domain, and deleting the project
  stay human-only.
- **Logs**: ~~`vercel logs <deployment-url> --follow`~~ → **`vercel logs <deployment-url>`** for runtime
  logs (streaming is the default; **`--follow` is deprecated and ignored** as of CLI 48.10.3, which prints
  a notice saying so), `vercel inspect` for deployment metadata. **Retention is one hour on Hobby** —
  longer on Pro, though the current figure should be confirmed against Vercel's limits page rather than
  assumed. There is no alerting; nothing notifies anyone of a failure.

  **Verified 2026-08-06 (F-01), and it changes what this buys you**: the stream carries what functions
  *emit* — console output and errors — **not an access log**. ~100 requests to on-demand routes produced
  zero stream output while `x-vercel-cache: MISS` and `x-vercel-id: arn1::iad1::…` confirmed the function
  executed. So a quiet stream is the normal state, not a health signal, and "tail logs during the event"
  only helps if the code logs deliberately. F-02 onward should instrument session start, join, answer
  submission and purge; otherwise the host watches an empty terminal. Detail in
  `docs/runbook-live-session.md` §Before the session.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Hobby plan's non-commercial restriction breached by sponsor branding; project paused | Devil's advocate | M | H | **AMENDED 2026-08-06:** accepted risk — staying on Hobby by user decision (free local community initiative). Tripwire: any Vercel contact about fair use. Owner: account holder, re-read in `docs/runbook-live-session.md` |
| US-East region adds transatlantic latency against the 1s propagation guardrail | Devil's advocate | H | M | **RESOLVED 2026-08-06:** `regions: ["fra1"]` in `vercel.json` — and it works on **Hobby**, contrary to this document's original claim (`region-probe.md`). Still measure actual propagation in F-04; production only moves to `fra1` once the key reaches `main` |
| Agent follows Vercel's stale Astro docs and reintroduces `output: 'hybrid'` or `/serverless` | Devil's advocate | M | M | Already covered by the CLAUDE.md project guide, which pins the correct rendering model. Prefer Astro's own adapter docs over Vercel's framework page |
| Adapter update silently pulls an Astro major (`@astrojs/vercel` v11 → Astro 7) | Research finding | M | M | Pin `@astrojs/vercel` to the `^10` line. Treat Astro 7 as a separate, deliberate change — never bundled with feature work |
| One-hour log retention destroys evidence after a failed live event | Unknown unknowns | H | M | **AMENDED 2026-08-06:** accepted — staying on Hobby, so retention stays ~1 hour. This is now the *only* genuine Hobby gap. Mitigated operationally: `docs/runbook-live-session.md` has the host open `vercel logs --follow` before the session and capture it immediately afterwards. **Weaker than it reads, as of 2026-08-07:** F-04 measured a burst costing ~10–15% of lines, and observed the stream stalling silently twice for reasons unidentified — so a capture can be partial, or empty from the point it stalled. See the log-tail row below |
| Ably presence join-storm is O(N²): 150 participants entering one presence channel ≈ 22.5k messages | Research finding | M | L | Still ~135k messages/year against a 6M/month free allowance. Avoid presence for the leaderboard; use broadcast for state and presence only if genuinely needed |
| Ably free tier ceiling is 200 peak connections — 150 participants leaves ~25% headroom | Research finding | L | H | Fine for the drafted quiz. A room of 200+ requires a paid plan; check expected attendance before each event |
| **The token endpoint is open and unthrottled, so the 200-connection ceiling can be exhausted deliberately** | F-02 impl review (2026-08-06) | L | H | **Accepted risk, 2026-08-06.** `GET /api/quiz/token` must stay unauthenticated — attendees have no accounts — and the token it mints is subscribe-only, so nothing can be forged. But anyone with the link can mint unlimited tokens and hold connections until real attendees cannot join, mid-session. Not throttled because an IP-keyed limit would fall foul of venue NAT and threaten the 30-second join target (the tension FR-018 already names). Same reasoning as the PRD's accepted unprotected host view: the room is trusted for one session. **Tripwire:** attendees reporting they cannot connect while the host's own device works, or Ably's dashboard showing peak connections above expected attendance. Owner: host, per event. If it fires, the fix is a paid plan plus a throttle, not one or the other |
| **Ably retains a published snapshot for ~2 minutes, and that floor cannot be reduced to zero** | F-03 probe (2026-08-06) | H | L | **Measured, not assumed** — `context/archive/2026-08-06-session-end-and-data-purge/ably-retention-probe.md`. Message persistence is **off** for the `livequiz` namespace (verified: gone by 135s, still present at 60s), but Ably's ~120s connection-recovery buffer is retained regardless of that setting and no dashboard toggle removes it. From S-02 the final snapshot before a session ends carries attendee display names, so it stays retrievable for ~2 minutes by anything holding a subscribe token — and `GET /api/quiz/token` is deliberately open (row above). Bounded because each publish supersedes the last, so the window trails the final host action rather than accumulating. **The live risk is regression, not exposure:** persistence is off and is off by default; it would have to be deliberately switched on to get worse. **Tripwire:** re-run `bun scripts/probe-ably-retention.ts --expect-ephemeral` before any event where the room is unusually sensitive, and after any Ably plan or dashboard change. **Updated 2026-08-11 (S-07): real names are now involved, and this row is no longer the binding constraint.** The remedy this row proposed — publish opaque ids, keep names off the channel — was considered and **rejected**: the session document now carries a `standings` field with up to five `{ rank, displayName, points }` rows (never a player id). The window that matters is not this one. `GET /api/quiz/state` is deliberately unauthenticated and returns the whole document, so those five names are readable by anyone with the attendee URL for as long as the host leaves the board up — longer than 120s, and by a different mechanism. Accepted on the PRD's "the room is trusted for one session" reasoning, since the board is on a projector while it is readable; recorded in the retention guardrail's Deviation 2 and in `context/archive/2026-08-11-leaderboard-beat/leaderboard-contract.md`. **This row's tripwire still stands and matters more, not less:** it is what catches message persistence being switched back on, which would turn a trailing 2-minute window into an accumulating archive of boards. Owner: repository owner |
| **The word cloud is polled, so it is the one display whose cost scales with question length rather than with host actions** | S-08 (2026-08-14) | L | L | **Deliberately kept off Ably.** A continuously-filling display has no host action to ride, and one snapshot to 150 clients bills as 150 messages against the 100/second ceiling (row above), so publishing per submission would exceed it while the room was all answering. Instead the projector polls `GET /api/quiz/host/words`: **2 billed store commands per tick** (`HGETALL` + `HLEN`) on **one** device at ~2.5 s, so ~48 commands for a minute-long question and under 100 for the beat — bounded by one device, one question kind, tab visibility, exponential backoff on failure, and a final-read flag that stops the loop once the question is revealed. Nothing on the Ably budget at all. It is the host page's **same** loop as the participation count, not a second one (`src/pages/quiz/host/[slug].test.ts` fails on a second timer). **Tripwire:** the command counter rising while no question is open, or rising faster than ~1/s during a word-cloud question — either means a loop is re-arming when it should have stopped. Owner: repository owner, via the command counter the row below already tracks |
| **The word cloud's store read is the first whose payload an attendee controls** | S-08 impl review (2026-08-14) | L | M | `readWordCloud` does an `HGETALL` over `livequiz:tallies`, and the `word:` family is the first field family whose cardinality grows with the **room** rather than with the quiz definition. Because `/api/quiz/join` is deliberately open (row above) and word fields never shrink within a session — TTL only — the field count is bounded by how many player ids exist, not by attendance. A scripted join-and-submit run therefore inflates what the projector downloads **every 2.5 s for the rest of the segment**, on the one network nobody controls. **Distinct from the honest-room figure**, which the slice's contract accepts separately at ~150 distinct words; the two were conflated in the first draft of that contract and separated in implementation review. **Accepted, not defended**, on the same "the room is trusted for one session" reasoning as the token endpoint: the rejected alternative was an `HLEN` ceiling inside `SUBMIT_ANSWER`, which would bill a command on the densest path in the project and, set low enough to matter, would silently stop counting real attendees' words in a full room — a correctness risk in place of a performance one. **Unmeasured:** nobody has timed the payload or its parse at ~2,000 fields. **Tripwire:** the cloud visibly slowing on the projector, or the command counter climbing while no question is open. Owner: repository owner |
| No monitoring: a platform or realtime failure is discovered by attendees | Pre-mortem | H | H | Out of scope here, but the PRD names the live event as the blast radius. At minimum, have the host load the attendee view on a second device before starting — **now a checklist item in `docs/runbook-live-session.md` (2026-08-06)** rather than an aspiration. **2026-08-07:** the second device is the *dependable* half of that minimum — the log tail loses lines under a burst and has stalled silently twice (row below), so it detects nothing reliably; use it to diagnose, not to notice |
| **The live log tail drops lines under a burst, and can stall silently — a stalled stream looks exactly like a quiet one** | F-04 measurement (2026-08-07) | M | M | **Re-graded 2026-08-07 during impl review.** This row first read "dies silently under the join burst", H/H, headed "measured, not inferred" — generalised from one observation and **not reproduced**. What is measured (`context/changes/room-scale-rehearsal-harness/rehearsal-report.md`): a burst costs **~10–15% of lines** (127/150 and 135/150, twice), the stream does **not** expire on a timer (14/14 over 4.5 min), and request volume alone is not the trigger (150 requests emitting nothing left it working). Separately, the stream **stalled permanently on two occasions** with `vercel logs` still printing `waiting for new logs...` — **cause unidentified**, not reproduced in three later attempts, unknown whether CLI-side or server-side. The operational consequence stands whatever the cause and is the part to act on: silence is not evidence of health. **Tripwire:** fire a throwaway request mid-session and confirm its line appears; if it does not, re-attach (a fresh attach on the same deployment works immediately). Owner: host, per event, via `docs/runbook-live-session.md` |
| No CI gate between commit and production | Pre-mortem | H | M | `bun run test` and `bun run type-check` now exist locally; wiring them into CI is the infrastructure lesson's job |
| Moving the repo into a GitHub org silently breaks the Hobby deploy pipeline | Unknown unknowns | L | M | **LIVE CONSTRAINT as of 2026-08-06** — the project is staying on Hobby, so keep the repo under a personal account (`jedrker/ai-community-szn`). Restated in `docs/runbook-live-session.md` §Standing constraints |
| Supabase Realtime chosen later out of familiarity, hitting the 100 msg/sec ceiling mid-session | Unknown unknowns | M | H | Recorded here explicitly. If switching to Supabase, budget for Pro and verify the fan-out rate limit against a 150-client broadcast first |

## Getting Started

The project is already deployed on Vercel, so these are the deltas — not a first deploy. Commands are
validated against the versions actually pinned in this repo (Astro 6.4.8, `@astrojs/vercel` 10.0.x),
not against general platform tutorials.

1. ~~**Upgrade the Vercel team to Pro** and set the function region to `fra1`.~~
   **DONE DIFFERENTLY — F-01, 2026-08-06.** The plan stays **Hobby**; the region was set anyway, because
   it turned out not to require Pro. Current state:

   - `vercel.json` declares `regions: ["fra1"]`, and a Hobby preview deployment confirmed the function
     runs in Frankfurt (`vercel inspect` → `λ _render … [fra1]`). Method and evidence:
     `context/changes/deployment-target-readiness/region-probe.md`.
   - **Production is still `iad1` until that key reaches `main`** — the key only affects builds made
     after it exists. Do not record a pre-merge latency figure as the project's baseline.
   - The **licensing risk is accepted**, not resolved (user decision: free local community initiative).
   - The **log-retention risk is accepted**, not resolved (~1 hour on Hobby) and mitigated operationally
     by `docs/runbook-live-session.md`.
   - Tripwire for revisiting Pro: see the amendment under §Recommendation.

   So of the three risks this step claimed to resolve "in one step", one was resolved for free, and two
   are live accepted risks. Do not treat the Pro upgrade as a prerequisite for LiveQuiz work.

2. **Keep the adapter on the v10 line.** `@astrojs/vercel@^10` is correct for Astro 6; v11 requires
   Astro 7. Do not run a blind `bun update @astrojs/vercel`. The in-range update to 10.0.8 is safe:
   ```bash
   bun update @astrojs/vercel
   ```

3. **Add Ably and expose a token endpoint — never the API key.** The browser must not receive
   `ABLY_API_KEY`; it requests a short-lived token from your own server instead.
   ```bash
   bun add ably
   vercel env add ABLY_API_KEY production
   ```
   Create `src/pages/api/ably-token.ts` as an on-demand route (no `prerender` export, per the project's
   rendering convention) that mints a token request scoped to the session channel. Follow the
   error-handling pattern in `src/lib/slack.ts`: missing configuration returns a clear failure rather
   than throwing into the request path.

4. **Keep the quiz's authoritative state on the server side of that endpoint**, not in the browser.
   Ably carries messages; it is not the source of truth for scores. Since the PRD requires that nothing
   survives the session, in-memory state in the serverless function is *not* sufficient (instances are
   not shared) — this is the remaining open decision, and it is the narrow residue of PRD Open Question
   7. A short-TTL store such as Upstash Redis via the Vercel Marketplace is the conventional answer at
   this scale; Cloudflare Durable Objects is the alternative that removes the extra vendor.

5. **Verify the operational loop before relying on it**, once Pro is active:
   ```bash
   vercel logs <deployment-url> --follow
   vercel rollback status
   ```

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup (deferred to the infrastructure lesson)
- Production-scale architecture (multi-region, HA, disaster recovery)
- Monitoring and alerting selection — named as a risk, not researched
