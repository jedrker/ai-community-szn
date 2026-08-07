# Runbook — running a live session

Operational checklist for the host on event day. This is the compensating control for the platform gaps
recorded in `context/foundation/infrastructure.md`: there is **no CI gate**, **no alerting**, and on the
Hobby plan **runtime logs are retained for about one hour**. Nothing will tell you a failure happened —
you have to be watching.

Read this before the session, not during it.

> Status note (updated 2026-08-06): the **session spine** exists as of roadmap F-02 — server-held state,
> sub-second fan-out, and the host verbs `start` / `advance` / `reveal` — plus, as of F-03, `end` and
> `purge`, so a session can now be closed and its data removed on demand. The **live loop does not**:
> nobody can join yet, nothing is answered, nothing is scored (S-02 onward). So "the session" still means
> the existing site for now — event archive, speaker directory, newsletter endpoint — plus a spine you can
> drive but not yet play. The log-tailing and second-device steps apply either way.

## The day before — rehearse the room

Optional, and worth it before an event where the quiz actually runs. This drives production with
simulated devices and measures what the room will see. **Not on event day with attendees present:** it
starts and advances a real session on production.

```bash
bun scripts/rehearse-room.ts --base=https://<production-url> --clients=150
```

It needs `LIVEQUIZ_HOST_SECRET` and the `KV_REST_API_*` pair in the environment — `vercel env pull`, or
export them by hand. It refuses to start if it cannot see them, and names which one is missing.

What to expect, and how to read it:

- **It refuses to run while a session exists**, naming the phase (`a session already exists (phase:
  lobby)`). That is the safety gate, not a bug — it exists so a rehearsal can never trample a live
  segment. If it fires unexpectedly, someone or something left a session open; clear it with `purge`
  before rehearsing.
- **It purges when it finishes**, including after a failure, so runs do not accumulate state. Confirm
  with `bun scripts/check-purge-residue.ts` — note that script refuses to run while a session document
  exists, which makes it a pre-rehearsal check as well as a post-run one.
- **The verdict is end-to-end p95 against a 1000 ms budget**, and the exit code follows it. The
  reference figure to compare against is **356 ms at 150 clients from `fra1`**
  (`context/changes/room-scale-rehearsal-harness/rehearsal-report.md`).
- **`received X/Y connected of N` is the line to read**, not just the p95. A device that connected and
  then missed a snapshot is a loss the percentile cannot show you.
- **Rehearse from a machine on a network you can describe.** The figure is a lower bound: one process on
  one Wi-Fi link is not 150 phones on a venue AP.

To check that losses are reported rather than swallowed, add `--kill-after-start=3`: three devices are
disconnected after the warm-up and every action should then read `received (N-3)/N` with the figures of
the remainder unchanged.

If a run was killed rather than finishing, it will have left a session behind — a kill cannot be caught,
so teardown does not run. The next run's pre-flight then refuses for a reason unrelated to a real
session. Clear it with `--purge-stale`, which purges instead of refusing. **Only pass it when you know
no real session is running** — that refusal is the only thing separating this script from a live room.

**Read the store's command counter before and after the run.** This is the tripwire standing in for the
spend alert the roadmap asked for, which cannot be configured on the free tier
(`context/changes/room-scale-rehearsal-harness/rehearsal-report.md` records why). In the Upstash console,
reached via **Open in Upstash** from the Vercel dashboard's Storage tab, note `commands` for the month:

- One rehearsal should cost on the order of **20 commands** — minting a token touches no store key, and
  a host action is one `get` plus one `EVAL`.
- **Above ~200K attributable to a single run, stop and look.** That is the signature of a polling design
  replacing the push design, which is cheap in money and expensive in architecture.
- Recorded readings so far: 513 before the first load run, 4102 after seven of them. That delta is
  larger than the code accounts for and is **still unexplained** — if you see the counter rising while
  nothing is running, that is a finding worth chasing.

## Before the session

**1. Confirm what is actually in production.**

```bash
vercel ls
```

The top `Production` row is what attendees will hit. Check the age matches the deploy you expect. If
someone pushed to `main` recently, that push *is* live — there is no staging environment and almost
nothing between a commit and production.

**Confirm the latest deploy went green — especially if you edited a question today.** Check the state
of the top row, not just its age:

```bash
vercel ls          # look at the state column: ● Ready vs ● Error
```

The quiz definition is gated at build time (`quiz-definition-gate` in `astro.config.ts`), so a
malformed question **fails the build and never deploys**. That is the safe outcome — the previous
good quiz stays live — but it is also a silent one: there is no CI and no alerting, so nothing tells
you your fix did not ship. A last-minute edit that failed the gate leaves you on stage running the
*old* question while believing you fixed it. If the top row is `Error`, run `bun run build` locally;
the failure message names the offending question by id.

**2. Open a live log stream and leave it running.**

```bash
vercel logs <production-deployment-url>
```

Streaming is the default — **do not pass `--follow`.** It is deprecated as of CLI 48.10.3 and the CLI
prints *"The `--follow` option was ignored because it is now deprecated"*. Any older note in
`infrastructure.md` showing `--follow` is stale.

Log retention is roughly one hour, so evidence of a failure is gone before a post-mortem would start. A
stream you opened beforehand captures what a retrieval afterwards cannot. Keep it on a second screen or
a spare terminal for the whole segment.

> **Fire one throwaway action before you trust the stream.** Measured 2026-08-06 on production: with the
> stream already open, a `start` → `advance` → `reveal` sequence produced five `[livequiz]` lines but the
> stream captured only four — the `session.publish.ok` for the *first* action never appeared, even though
> the HTTP response proved it succeeded (`start` returns `applied: true` only after the publish lands).
> The first invocation after attaching can be missed, probably a cold start racing log delivery.
>
> Practical consequence: **silence right after your first click is not evidence of a problem, and it is not
> evidence of health either.** Press a host action once before the room is watching, confirm lines are
> flowing, and only then treat the stream as your signal.

> **Know what this does and does not show — verified 2026-08-06.** The stream carries what functions
> *emit* (console output, thrown errors), **not** an access log. Measured on this project: ~100 requests
> to on-demand routes produced **zero** stream output, while response headers confirmed the function ran
> (`x-vercel-cache: MISS`, `x-vercel-id: arn1::iad1::…`). Successful renders are simply silent.
>
> Two consequences:
> - **Silence is not proof of health.** It is the normal state. Use the second device (step 3) to know
>   the site is up; use the stream to see *why* something failed, not *whether* it did.
> - **This step only pays off if the code speaks.** LiveQuiz (F-02 onward) must log deliberately at the
>   points that matter — session start, join, answer submission, purge — or the host will spend the
>   session watching an empty terminal. Treat that as a requirement on those slices, not a nicety.

> **The stream loses lines under a burst, and can stall without saying so — measured 2026-08-07 (F-04).
> This is the most important thing on this page about logs.**
>
> - It does **not** expire on a timer: 14 requests at 20-second spacing delivered 14 of 14 lines.
> - A burst costs **roughly 10–15% of lines**: a 150-device join delivered 127 and 135 of 150 on two
>   measurements. So the stream shows you a join burst but cannot be counted through one.
> - On two occasions it **stalled permanently** — no further lines, ever — while `vercel logs` kept
>   printing `waiting for new logs...`. Three later attempts did not reproduce it and **the cause is not
>   known**. Treat it as intermittent, not as something you can predict or avoid.
>
> **A stalled stream and a quiet system look identical.** That is the part that matters, and it holds
> whatever the cause turns out to be.
>
> What to do:
> - **Prove the stream is alive rather than trusting its silence**, once after the room has joined and
>   again if you have seen nothing for a while: `curl -s -o /dev/null <production-url>/api/quiz/token` and
>   confirm a `session.token.issued` line appears. No line means the stream is stalled, not that nothing
>   is happening.
> - **Re-attach when it stalls.** `Ctrl-C` and run `vercel logs <production-deployment-url>` again. A
>   fresh attach on the same deployment works immediately — verified.
> - **Do not treat the tail as your failure detector.** The second device (step 3) is the dependable half
>   of this checklist. The stream is for diagnosing something already known to be wrong.

**3. Load the site on a second device.**

Open the attendee-facing view on a phone that is *not* the host machine, on the venue network if
possible. This is the minimum failure detection this project has: without monitoring, a second device
is how you notice a problem before the room does.

**4. Re-read the tripwire.** (30 seconds — do not skip.)

The project deliberately stays on the Vercel **Hobby** plan. Two conditions would change that decision.
Ask both, out loud:

- **Latency**: has any rehearsal or live session shown state taking longer than **one second** to reach
  attendee devices? **Measured 2026-08-07 (F-04): no — end-to-end p95 was 356 ms at 150 simulated
  devices from `fra1`, the worst of three runs.** Production now genuinely runs in Frankfurt: that key
  has reached `main`. Still check rather than assume, because a region regression would invalidate the
  figure: `curl -sI <production-url> | grep x-vercel-id` returns `<edge>::<function-region>::<id>` and
  the middle segment must read `fra1`. Note the measured figure is a **lower bound** — one machine on
  one network — so a real room can be worse; that is what the second device is for.
- **Licensing**: has Vercel made *any* contact about fair use? The Hobby plan is restricted to
  non-commercial personal use, and this site carries Brave Courses branding. The judgment on record is
  that a free local community initiative is not commercial use. A notice would arrive at the account's
  billing address.

**Owner: the repository owner (account holder)** — nobody else sees that inbox. If either has fired,
raise it before the event rather than after.

## During the session

- **Watch the log stream**, not the dashboard. The stream is the only place a runtime error appears in
  time to act on.

  **What a healthy line looks like** (F-02 onward — grep for `[livequiz]`):

  ```
  [livequiz] {"event":"session.created","version":1,"phase":"lobby"}
  [livequiz] {"event":"session.action.applied","version":2,"phase":"question-open","questionId":"smieszne-slowo-ai"}
  [livequiz] {"event":"session.publish.ok","version":2,"phase":"question-open"}
  ```

  One line per mutation, one JSON object, `version` always present. The events worth reacting to:

  | Event | Means | What to do |
  | --- | --- | --- |
  | `session.action.applied` | the room moved | nothing — this is the happy path |
  | `session.publish.ok` | the snapshot reached Ably | nothing |
  | `session.action.stale` | two actions raced; the second was a no-op | nothing, unless you did not double-tap — then something else is driving the session |
  | `session.auth.rejected` | someone tried a host action with a wrong or missing secret | **if it was not you mis-clicking, someone else has the control URL.** One line is noise; a stream of them during a session means stop and rotate `LIVEQUIZ_HOST_SECRET` |
  | `session.publish.failed` | state is committed but did **not** reach devices | repeat the action; it re-broadcasts and is safe to retry |
  | `session.unconfigured` | an environment variable is missing | the session cannot run; check `vercel env ls` |
  | `session.read.invalid` | stored state does not match the quiz definition | a deploy changed the quiz mid-session — roll back |
  | `session.ended` | the segment is closed; every key is now on the ~10-minute lifetime | nothing, if you meant it. **If you did not, act within ten minutes** — after that the session is gone and cannot be resumed |
  | `session.purged` | every key was deleted | nothing, if you meant it. This one is not recoverable at all — there is no undo and `vercel rollback` does not reach it |

  `version` should only ever climb, and it climbs by exactly one per applied action. Two `applied` lines
  at the same version, or a version that goes backwards, means something is wrong with the store and is
  worth stopping for.
- **If attendees report a problem**: check the second device first. If it reproduces there, it is a real
  failure; if not, it is that attendee's network or handset.
- **If several attendees cannot connect while your own device works fine**, suspect the realtime
  connection ceiling rather than their networks. The free tier allows 200 peak connections and the token
  endpoint is open by design, so the ceiling can be reached by more devices than you expected — or
  deliberately. Check peak connections in the Ably dashboard. There is no in-session remedy; note it and
  raise the plan question afterwards (accepted risk, recorded in `infrastructure.md`).
- **Do not deploy during a session.** A push to `main` goes straight to production with nothing in
  between.

## After the session

**End the session.** This is the closing beat, and it is deliberate — there is no automatic end.
Ending writes a terminal state that every connected device renders, and moves the room's data onto a
**~10-minute lifetime** instead of the four-hour one. That window exists so an attendee who reloads
right after the finish still sees the final standings.

Two things about it are worth knowing before you press it:

- **`end` is refused while a question is open.** Reveal first. That guard exists so the one
  irreversible verb cannot fire mid-question.
- **It asks for the session's current version as confirmation.** Every other host verb is safe to
  double-tap because a repeat is a harmless no-op; `end` is safe for the opposite reason — a repeated
  or stale request is *refused*. If you get a message about the confirmation not matching, refresh
  the view rather than retrying blind.

**Reach for `purge` when ten minutes is too long, or when a session has to be abandoned.** It removes
everything immediately. Unlike `end` it has **no phase guard** — that is deliberate, because
abandoning a session mid-question (a room being evacuated, a segment going wrong) is exactly the case
`end` refuses. There is no undo, and `vercel rollback` does not reach it.

**If you do nothing at all, the data still goes.** An abandoned session expires on its own within
four hours. The guardrail holds whether or not anyone remembers to press anything — which is the
realistic stage outcome and why it was built that way.

**Capture the log stream immediately.** The one-hour retention window starts when each line is emitted,
not when the session ends. Copy anything relevant out of the terminal before closing it — once it is
gone, it is gone, and `vercel logs` will not bring it back.

> **The log stream is not covered by any of this.** Purging the store does not touch what was already
> written to `vercel logs`, and neither does a rollback. That is why session log lines carry versions
> and phases but never attendee names — the code is prevented from writing them at all
> (`LogFields` is a closed type, so a display name in a log call is a compile error). If you are
> copying log output somewhere for a post-mortem, it is safe on that count by construction.

## If something breaks

```bash
vercel ls                                  # find the last known-good deployment
vercel rollback <deployment-url>           # revert production to it
vercel rollback status                     # confirm
```

Time-to-revert is seconds, because prior deployments stay immutable and pre-built.

**Two caveats that matter more than the speed:**

1. **Rollback has never been exercised on this project.** Its preconditions are verified — prior
   deployments exist and the command responds — but no actual rollback has been performed here. The
   first one will happen under pressure. Treat the commands above as untested.
2. **Rollback reverts code only.** It does not revert environment variables, Resend Audience contacts
   already created, or anything held at an external realtime provider. Once LiveQuiz exists, a rollback
   will not undo session state.

## Standing constraints

- **Keep the repository under a personal GitHub account.** Hobby projects cannot connect to
  Git-organization repositories; moving `ai-community-szn` into an org would break the deploy pipeline.
- **Prefer git push over `vercel deploy` for real deployments.** A CLI deploy from this repo uploads
  ~244MB (`public/photos` is 122MB of it) and has failed once with `Error: Upload aborted`. A retry
  worked, but the git path does not carry this risk.
- **Preview deployments are not public.** Vercel Authentication is enabled, so preview URLs return a 302
  to Vercel SSO for anonymous visitors. Checking that a preview renders requires a logged-in browser —
  an anonymous `curl` will only ever see the redirect.
