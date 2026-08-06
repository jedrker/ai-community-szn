# Runbook — running a live session

Operational checklist for the host on event day. This is the compensating control for the platform gaps
recorded in `context/foundation/infrastructure.md`: there is **no CI gate**, **no alerting**, and on the
Hobby plan **runtime logs are retained for about one hour**. Nothing will tell you a failure happened —
you have to be watching.

Read this before the session, not during it.

> Status note (updated 2026-08-06): the **session spine** exists as of roadmap F-02 — server-held state,
> sub-second fan-out, and the host verbs `start` / `advance` / `reveal`. The **live loop does not**:
> nobody can join yet, nothing is answered, nothing is scored (S-02 onward). So "the session" still means
> the existing site for now — event archive, speaker directory, newsletter endpoint — plus a spine you can
> drive but not yet play. The log-tailing and second-device steps apply either way.

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

**3. Load the site on a second device.**

Open the attendee-facing view on a phone that is *not* the host machine, on the venue network if
possible. This is the minimum failure detection this project has: without monitoring, a second device
is how you notice a problem before the room does.

**4. Re-read the tripwire.** (30 seconds — do not skip.)

The project deliberately stays on the Vercel **Hobby** plan. Two conditions would change that decision.
Ask both, out loud:

- **Latency**: has any rehearsal or live session shown state taking longer than **one second** to reach
  attendee devices? `vercel.json` declares `fra1` (Frankfurt) and it works on the Hobby plan — see
  `region-probe.md` — **but production only runs there once that key has reached `main` and rebuilt.**
  Until then functions execute in `iad1` (US East) and the transatlantic round trip is real. Check which
  you are on rather than assuming: `curl -sI <production-url> | grep x-vercel-id` returns
  `<edge>::<function-region>::<id>`.
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
  | `session.publish.failed` | state is committed but did **not** reach devices | repeat the action; it re-broadcasts and is safe to retry |
  | `session.unconfigured` | an environment variable is missing | the session cannot run; check `vercel env ls` |
  | `session.read.invalid` | stored state does not match the quiz definition | a deploy changed the quiz mid-session — roll back |

  `version` should only ever climb, and it climbs by exactly one per applied action. Two `applied` lines
  at the same version, or a version that goes backwards, means something is wrong with the store and is
  worth stopping for.
- **If attendees report a problem**: check the second device first. If it reproduces there, it is a real
  failure; if not, it is that attendee's network or handset.
- **Do not deploy during a session.** A push to `main` goes straight to production with nothing in
  between.

## After the session

**Capture the log stream immediately.** The one-hour retention window starts when each line is emitted,
not when the session ends. Copy anything relevant out of the terminal before closing it — once it is
gone, it is gone, and `vercel logs` will not bring it back.

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
