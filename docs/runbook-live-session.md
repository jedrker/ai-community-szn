# Runbook — running a live session

Operational checklist for the host on event day. This is the compensating control for the platform gaps
recorded in `context/foundation/infrastructure.md`: there is **no CI gate**, **no alerting**, and on the
Hobby plan **runtime logs are retained for about one hour**. Nothing will tell you a failure happened —
you have to be watching.

Read this before the session, not during it.

> Status note (updated 2026-08-06): the **session spine** exists as of roadmap F-02 — server-held state,
> sub-second fan-out, and the host verbs `start` / `advance` / `reveal` / `standings` — plus, as of F-03, `end` and
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

- **Measured 2026-08-08 (S-02): a full N=150 rehearsal costs ~1260 commands**, and a real event was on
  the order of **1600** — because **Upstash bills a Lua `EVAL` *and* every `redis.call` inside it**,
  so one attendee joining costs eight commands, not one. Plus a `GET`+`HLEN` per device connect and
  per host action. Minting an Ably token still touches no store key.
- **S-03 changed the order of magnitude, and this is the figure to use now.** Answering is the first
  path that scales with **attendees × questions**: a submission bills 8 (a `readSession`, plus an
  `EVAL` with six internal calls) and a per-device result read bills 4. At 150 attendees over 14
  questions that is **~27k commands per event**, against ~1600 before — a ~17× rise on the same
  eight-commands-per-EVAL model, not a new mechanism.
  Predicted-vs-observed for the S-03 run is recorded in
  `context/changes/answer-choice-question-and-reveal/answer-cost-report.md`.
- **S-04 raised it again, by less than S-03 did but on the same path.** Counting participation adds
  `k + 2` commands to a submission — **8 → 11** for a single-choice answer, where `k` is the number of
  options selected — plus one read per reveal and two per poll tick. Only the **10 answerable
  questions** generate submissions, so the arithmetic is not over all 14. Predicted **~32.4k per
  event**, against ~26.8k after S-03.
  **Measured 2026-08-09: the model is confirmed, the per-event figure is extrapolated from it.** A
  150-client harness run plus a 14-question stage pass spent an observed **3,184** commands against a
  **3,210–3,310** prediction written down beforehand — **0.8% under**. So nothing is issuing commands
  nobody counted, and ~32.4k is built from per-command counts that hold. It remains an extrapolation:
  no 150-attendee event has been measured end to end, and it never will be before one happens. See
  `context/changes/host-participation-and-distribution/participation-cost-report.md`.
- **Ten events a month reaches ~324k, about 65% of the 500K ceiling** — up from ~54% after S-03 and
  roughly 1% before. Not a blocker and not an incident; it is simply no longer noise, and every slice
  from here (S-05 through S-08) adds another per-attendee path on top of this one.
  - **S-05, S-06 and S-08 have now landed and moved that figure by essentially nothing.** Each added an
    answer *kind* rather than a per-attendee path: a text, numeric or word submission bills exactly what
    a single-choice one does. S-08's word cloud adds the only new polled path — 2 commands per tick on
    the host's device alone, under 100 for the whole beat — so the estimate above stands unrevised.
    S-07's leaderboard is the one that added a real per-device cost (~5 per device per beat).
- **The console counter lags. Do not quote a reading taken minutes after a burst.** Measured: a
  reading 7 minutes after three N=150 runs was 2526 commands short of the same counter 85 minutes
  later, with ~15 commands of work in between. A premature reading looks settled and is not — this is
  how the first version of this section came to understate the cost by 3×. Wait, re-read, and only
  quote a figure that has stopped moving.
- **The plan ceiling is 500K per month, not 200K.** The tripwire below is a deliberately conservative
  fraction of the limit, not the limit itself.
- **Above ~200K attributable to a single run, stop and look.** **This is a polling detector, not a
  capacity guard** — nothing but a loop could approach it in one run. Do not raise it as usage grows:
  raising it is how it stops working. The failure it catches is cheap in money and expensive in
  architecture.
  **The threshold is unchanged; its margin is not.** It sat roughly 125× above a real session when
  that session cost ~1600 commands. After S-03 a real event is ~27k, so the same threshold now sits
  roughly **7×** above one. Still ample for a polling detector — a loop overshoots by orders of
  magnitude, not by sevenfold — but the sentence that justified it has moved, and a reader quoting
  "125×" from an older copy of this file would be quoting a number that no longer exists.
- **There is one sanctioned polling loop on the host page, and this is its shape.** Until S-04
  "nothing in this project polls" was true and the detector above could treat *any* periodic pattern
  as a fault; that is no longer the case, so the expected pattern is written down here to keep
  expected cost distinguishable from a leak. **One timer on one device** (the host page, never an
  attendee's), doubling its interval to a ~20 s ceiling on failure, **2 commands per tick** whichever
  endpoint it is on, and it serves three:
  - `/api/quiz/state` — **the lobby's join count**, ~3 s. Ends at `start`.
  - `/api/quiz/host/participation` — **the answered count, every kind that takes an answer**
    (choice, text and number alike), ~2.5 s, only while the question is open.
  - `/api/quiz/host/words` — **the word cloud**, ~2.5 s, through the reveal as well so you can talk
    over a complete cloud. It stops after one final read.

  Over a whole event that is roughly **1400 commands** — the participation count ~950 of it, the
  lobby ~400 — against a ~27k total, so still a couple of percent. If polling appears to account for
  materially more, the loop is running when it should not be. Anything periodic that does *not* match
  this shape — attendee-side, or a participation tick during `question-revealed` — is a fault, not
  this loop. **Two of those exclusions have been retired and the old wording is worth knowing about:**
  the lobby and the typed question kinds both used to be listed as faults here, and both are now
  sanctioned targets. The **attendee** side has its own separate loop, the connection fallback, which
  runs only while a device's channel is down.
- **Cost is now explained.** The settled S-02 delta matches the eight-commands-per-join model to
  within 0.1% (writes predicted 2320 against 2323 observed), so nothing is issuing commands
  unprompted. See `context/archive/2026-08-07-join-and-follow-host/command-counter-diagnostic.md`. The older
  513 → 4102 figure across seven F-04 runs is still not fully explained — those runs had no joins, and
  the same mechanism inflates their cost only ~3×, not the ~13× observed.
  **If you see the counter rising while nothing is running — and it has genuinely settled — that is
  still a finding worth chasing.**

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

The quiz registry is gated at build time (`assertQuizValid` in `astro.config.ts`), so a malformed
question **fails the build and never deploys**. That is the safe outcome — the previous good registry
stays live — but it is also a silent one: there is no CI and no alerting, so nothing tells you your fix
did not ship. A last-minute edit that failed the gate leaves you on stage running the *old* question
while believing you fixed it. If the top row is `Error`, run `bun run build` locally; the failure
message names the offending quiz and the offending question by id.

**And confirm the quiz you mean to run is actually committed.** "Which quiz is live" is no longer
answered by "which commit is deployed": several quizzes ship together, and the host chooses one at
`/quiz/host` (step 5). So the deploy check answers *whether your edit shipped*, not *which questions
the room will see*. If you added or renamed a quiz today, open `/quiz/host` now and confirm it is in
the list under the title you expect.

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

Keep this phone to hand: **step 6 uses it** for the one check that exercises the resume path.

**4. Reset the session. (S-02 — mandatory, not tidy.)**

```bash
bun run quiz:reset
```

`start` is **create-if-absent**: without a reset, it picks up the previous session, its players and
its phase, and the room joins a quiz already halfway through. The four-hour TTL will not save you —
it is longer than the gap between a rehearsal and the event.

There is no button for *this*. The host view has a **zakończ sesję i pokaż wyniki** button (S-10) — in
**Menu prowadzącego**, behind the join QR, until the last question brings it out onto the control bar —
which ends the session cleanly, but ending is not resetting: the document survives on the ~10-minute lifetime, and
`start` during that window still picks the old session up. `purge` is what deletes on the spot, and it
lives only on `/quiz/spine-check`, which 404s in production by design (it renders the host secret into
HTML) — so **the terminal is the only reset path at an event.** Do it before the room arrives, not
after they start joining.

**A stale session now blocks a second thing, visibly.** Since a session records which quiz it is
running, `start` on a *different* quiz answers **409** with the running quiz's title rather than a
200 that looks like success — so a leftover session does not merely get picked up, it stands between
you and the quiz you meant to run. The fix is the same reset. This is the good failure: the old
behaviour was to quietly resume the wrong quiz.

**5. Open `/quiz/host`, pick the quiz, and paste the host secret.**

`<production-url>/quiz/host` is now a **picker**, not the panel: it lists every committed quiz by
title with its four-digit join code, and clicking one opens that quiz's panel at
`/quiz/host/<slug>`. Read the code off this page rather than hunting for it — it is the number you
say out loud to anyone whose phone will not scan.

**Pick deliberately.** With a session already running, pressing `start` on a *different* quiz's panel
is refused with a Polish 409 naming the quiz that is running (see step 4) — which is the safety net,
not the plan. The plan is to open the right panel.

The panel itself is unprotected — there is nothing
on it worth guarding — but every action sends the secret as a header, so paste
`LIVEQUIZ_HOST_SECRET` into the **Sekret hosta** field once. It is held in `sessionStorage` for that
tab only: **close the tab and you re-paste it.** Do not open the host view in a tab you are going to
close.

**The field is not on the projector.** It lives in the host menu, which opens by **clicking the join
QR in the top-right corner** — a password box on a 1080p screen is one being typed in front of the
room. A tab with nothing stored opens the menu by itself on first paint, so on a fresh tab it is
already waiting for you; on a reload mid-segment it stays out of the way. A refused action reopens it
too. Escape closes it.

**Confirm the field is accepted by taking one throwaway action** — which step 2 already requires for
the log stream anyway, so this costs nothing extra. A wrong or missing secret shows the routes' own
Polish message, *Brak uprawnień hosta*. Finding that out at the front of a room is the failure this
step exists to prevent.

Then point the room at **`/quiz`** — or at `/quiz/<slug>` directly, which is what the projector's QR
encodes. `/quiz` reads the running session and redirects there, so the short address on the old QR
codes and in people's history still lands in the right room; before you press `start` it says the
quiz has not started rather than 404ing. You do not need a second screen for it.

**For a phone that will not scan, read out `/q/<kod>`** — the four digits are on the picker in step 5
and on the lobby screen under **Albo krócej**, beside the QR. It redirects to the same place the QR
does. An unknown code says so and offers `/quiz`, so a mistyped digit is one tap from recovery rather
than a dead end. **In the lobby the
projector is the join screen**: a white plate carrying a QR big enough to scan from the back row,
and beside it the address in yellow and the number of people who have arrived. Once a question is
open the same two move into the top strip, small but never gone, for whoever walks in at question
four.

**6. Reload the second device, and try to trip the cap. (S-09 — two minutes.)**

**This needs a started session, which is why it sits here and not beside step 3.** Press **start** on
the host view — that also serves as step 5's throwaway action, so it costs nothing extra.

On the second device: join with any name, then **pull-to-refresh**. It must come back as the same
player, with the same name, showing a *Wracasz z wynikiem N pkt* line rather than the join form.

Then claim three more names in the same browser. The fourth must be refused with *Z tego urządzenia
dołączyło już zbyt wielu graczy* — and that same browser must **still** resume its existing player on
reload. If the refusal reaches the reload, the cap has been wired to the wrong path and a locked
screen will eliminate someone mid-segment.

**Then reset again — `bun run quiz:reset` — because this check leaves four players and a used cap
allowance behind.** Step 4's reasoning applies unchanged; the difference is only that you are now
clearing your own test data rather than last rehearsal's.

Worth the two minutes because **no test in the project can see any of this.** The store is mocked in
the suite, so the Lua enforcing the cap never executes anywhere, and the resume path is the one whose
failure hurts most: a screen lock during a fifteen-minute segment is close to certain.

**7. Re-read the tripwire.** (30 seconds — do not skip.)

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

- **The join count only moves when you make it move.** It refreshes on a host action, on the
  lobby's own poll, or on the **odśwież** button, and never on a join. **That is by design, not a
  bug**: 150 joins each broadcasting to 150 devices is the O(N²) fan-out the spine is built to
  avoid, so nothing is published when someone joins. While the lobby is on screen the figure
  re-reads itself every few seconds, so you should not need to do anything. If it looks stuck,
  **odśwież** is in **Menu prowadzącego** — click the join QR to open it.

- **`zakończ sesję i pokaż wyniki` is on the host view now (S-10); `purge` is still not.** The control bar has two
  lines. The lower one is the four flow verbs in a fixed order — `start`, `dalej`,
  `pokaż odpowiedź`, `pokaż ranking` — and they never move; only which one is reachable changes.
  (`pokaż odpowiedź` reads **`zamknij pytanie`** on the word cloud, which has no answer to show —
  same button, same beat, honest name.)
  The upper one is the host's own row, and it is empty until the last question, when
  `zakończ sesję i pokaż wyniki` appears there, set apart and outlined in red.

  **The rest of the session that button is not on the bar at all.** It lives in
  **Menu prowadzącego** — the dialog you open by clicking the join QR in the top strip, the same
  place the host secret is typed. That is where you end a session early: open the menu, and the
  button is there. It is *not* a way around the phase rule — it goes dark in a phase the route
  would refuse, exactly as it does on the bar, so you can close from a revealed answer or from the
  ranking and not from an open question.

  Wherever you press it, it **takes two taps**: the first arms it and changes its label to
  "na pewno? kliknij ponownie", the second closes the session. Anything that moves the session in
  between disarms it, so a tap you made a minute ago cannot fire into a state you have not looked at.
  See "After the session" below for what closing does.

  `purge` stayed off this screen deliberately — it deletes with no undo and no ten-minute window.
  It lives on `/quiz/spine-check`, or use `bun run quiz:reset` from the terminal.

- **The panel leads the sequence — every flow button goes dark in a phase that would refuse it, and
  one is ringed as the next step.** So `start` is live only before a session exists, `pokaż odpowiedź`
  only while a question is open, and in the lobby the only ringed button is `dalej`. **Hold on a dark
  button to read why it is dark** — the reason is on the button itself, in Polish. The one deliberate
  exception is `dalej`, which stays live while a question is open even though it is not the ringed
  step: it is your only lever if something is on the projector that should not be. `odśwież`, in the
  menu, is never gated. The routes still refuse an illegal action — that refusal is now the backstop, not something
  you should meet. The **ringed** button is filled yellow; the others are outlined.

- **On the last question the bar empties out and the ring moves to the closing button.** Once the
  final question is the current one, `dalej` goes dark — there is nothing to advance to, and it used
  to answer the tap with "nic do zrobienia" — and after you reveal that last answer, `pokaż ranking`
  goes dark too: the closing beat publishes the final board itself, so the one step left is
  `zakończ sesję i pokaż wyniki` — which **appears on the upper line at that moment**, ringed in red,
  having been in **Menu prowadzącego** until then. It still takes two taps.

- **Read the bar's message by its colour before you read its words.** Every reply the panel gives you
  appears in one bubble that floats in the bottom-right corner, just above the control bar, with a
  coloured left edge, and that edge is the whole point — from the stage you have time for a colour,
  not a sentence:

  | Edge | Means | What to do |
  | --- | --- | --- |
  | green | it happened | carry on |
  | grey | in flight | wait a beat |
  | **yellow** | **nothing broke, but you have to decide something** | read it — this is the arming prompt, and "nic do zrobienia" when an action was a no-op |
  | red | refused, or it did not reach the devices | read it; a 502 asks you to repeat the same action |

  Yellow is the one that used to lie: before the redesign both of its cases came out green, so an
  action that had quietly done nothing looked exactly like one that had worked.

  **The bubble now clears itself, and that includes the red one.** It used to stay until the next
  thing happened, which meant "start: OK" sat over the room for the rest of the segment. Green goes
  after about four seconds, red after six, grey and yellow after nine — so if you look away and look
  back to an empty corner, nothing is wrong and nothing is pending. If you missed a reply and need to
  know, press the action again: everything on this panel is safe to repeat, and `odśwież` in the menu
  will tell you where the session actually is. Two things you might expect to vanish with the message do not:
  the buttons stay dark while an action is in flight, and the closing button stays reading
  "na pewno? kliknij ponownie" for as long as it is armed.

- **Every scored question now has a clock, and it does not move the session** (S-11, FR-020). The
  projector carries it in the right-hand rail, under the answered count; every phone shows the same
  number above its prompt. Both are counted from the moment you tapped `dalej`. Five things worth
  knowing on stage:

  - **Nothing happens when it reaches zero.** The question stays on screen, the phones lock their
    inputs, and the room waits for you exactly as before. Advancing, revealing, the leaderboard beat
    and the close are all still yours — there is no automatic anything.
  - **What it does is stop counting answers.** A submission arriving after the budget is refused
    with "Czas na odpowiedź minął." on that phone, and the answer is not recorded. There is a
    couple of seconds of grace past the visible zero so a slow phone that tapped in time still
    lands; the room is not told about it, and you do not need to.
  - **You cannot extend it from the stage, and this is deliberate.** There is no override button.
    Changing a budget is an edit to the quiz's file in `src/quiz/definitions/` and a deploy, like changing a question
    — so if the room clearly needs longer on a question, the lever you have is the same one you
    always had: talk over it, then `dalej`.
  - **The budgets are 25 seconds for a tap and 30 for anything typed.** If a question feels
    consistently too tight or too generous in a real room, that is worth writing down after the
    session — it is a one-line change per question.
  - **Q1 and Q2 have no clock at all.** The word cloud and the gather question are unscored, and
    unscored questions carry no budget: the cloud still fills until you reveal it.

- **`pokaż ranking` is the leaderboard beat, and it is reachable from a reveal** (S-07, FR-014).
  The button is dark in the lobby, while a question is open, and after the session ends, so the
  sequence is `dalej` → `pokaż odpowiedź` → optionally `pokaż ranking` → `dalej`. It **stays live once
  the board is up**, where tapping it again simply re-publishes the same board — that is the retry its
  own "Ranking jest zapisany, ale nie dotarł do urządzeń. Kliknij ponownie…" asks for. Four things
  worth knowing on stage:

  - **It replaces the question on screen**, top five by name and points. The phones show the same five
    rows in the same order, each attendee's own line highlighted, and their own position underneath —
    including attendees outside the top five.
  - **You do not have to use it after every question.** It is a host-controlled beat precisely so a
    fourteen-question segment does not grow fourteen leaderboards. Two or three is a rhythm; every
    question is a different, longer show.
  - **`pokaż odpowiedź` is dark while the board is up** — the question is already closed, so the way
    onward is `dalej`. The route would refuse it with "Ranking jest już pokazany"; you should no
    longer meet that message, because the button is not offered there.
  - If it answers **"Nie udało się odczytać rankingu"**, the store did not respond and the room stayed
    on the reveal rather than getting a blank board. Tap it again; if it fails twice, carry on with
    `dalej` — the segment does not depend on the beat.
  - **A board with no green or red arrows is normal, not broken.** Each row shows how many places that
    player moved since before the last question, and there are two ordinary reasons a whole board has
    none. The **first leaderboard of a session** never has any: before question 1 everybody held zero
    points, so nobody has a position to have moved from. And a **question that awards nothing** — the
    word cloud — moves nobody, so the board after it is arrow-free too. A row that simply held its
    place shows nothing either. Do not announce the feature as broken; if you want to check it, show
    the board after two scored questions.

- **Q1 is the word cloud, and it is the one beat that fills by itself** (S-08, FR-012/FR-015). Attendees
  type one word; the projector shows them as a cloud whose type size grows with how many people wrote
  each word, refreshing roughly every 2.5 seconds. Four things worth knowing on stage:

  - **It needs the host secret like the answer count does.** Without it the panel says
    "Wpisz sekret hosta, żeby zobaczyć chmurę słów" rather than filling. Type the secret before you
    advance to Q1 — it is the same field you already need for every action.
  - **The words are NOT moderated, by explicit decision** (PRD §Non-Goals). Whatever an attendee types
    reaches the projector unreviewed, subject only to a 24-character limit and letters/digits (no
    emoji). There is no hide button and no per-word delete. **Your only lever on stage is `dalej`** —
    if something appears that you do not want on screen, advance past the question. Know this before
    you are standing in front of it.
  - **It keeps filling until you close it, then freezes.** On this question the third flow verb reads
    **`zamknij pytanie`** rather than `pokaż odpowiedź` — it takes one last reading and
    stops the refresh, so you can talk over a complete cloud. There is no correct answer to show — the
    green "Poprawna odpowiedź" box stays hidden for this question, which is not a fault.
  - **"(nieaktualne)" beside the count means the refresh failed, not that the room stopped writing.**
    The cloud you can see is the last one that arrived. It recovers on its own; if it does not, the
    segment does not depend on it — carry on with `dalej`.

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
  | `session.standings.shown` | the leaderboard reached the room; `rowCount` is how many rows it carried | nothing. A `rowCount` below 5 means the room is smaller than the board |
  | `session.standings.failed` | the board could not be read. Its `reason` says which beat: the leaderboard beat, or the close | for the beat, tap **pokaż ranking** again and move on with **dalej** if it fails twice. **For the close, nothing** — the session still ended, just without the winner screen |
  | `session.standings.degraded` | the board reached the room, but its rank arrows could not be computed. The beat itself was fine | **nothing.** The room saw a correct leaderboard; only the movement column is missing, and nothing on screen distinguishes that from a board where nobody moved |
  | `session.auth.rejected` | someone tried a host action with a wrong or missing secret | **if it was not you mis-clicking, someone else has the control URL.** One line is noise; a stream of them during a session means stop and rotate `LIVEQUIZ_HOST_SECRET` |
  | `session.publish.failed` | state is committed but did **not** reach devices | repeat the action; it re-broadcasts and is safe to retry |
  | `session.unconfigured` | an environment variable is missing | the session cannot run; check `vercel env ls` |
  | `session.read.invalid` | stored state does not match the quiz registry — an unknown question id, or a `quizId` that is no longer committed | a deploy changed or removed the quiz mid-session — roll back |
  | `session.ended` | the segment is closed; every key is now on the ~10-minute lifetime. `rowCount` is how many rows the closing board carried | nothing, if you meant it. **A `rowCount` of 0 means the winner screen did not appear** — the close was still correct. **If you did not mean to end, act within ten minutes** — after that the session is gone and cannot be resumed |
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

**End the session with `zakończ sesję i pokaż wyniki`.** This is the closing beat, and it is deliberate — there is no
automatic end. Ending writes a terminal state that every connected device renders, and moves the room's
data onto a **~10-minute lifetime** instead of the four-hour one. That window exists so an attendee who
reloads right after the finish still sees the final standings.

**It is also the winner reveal** (S-10, FR-006). The closing snapshot carries the same top five the
leaderboard beat shows, with the winner's row set large and the heading changed to "Zwycięzca", and each
phone shows those five rows plus its own final position — including everyone outside the top five. So
end the session **in front of the room**, not afterwards on the way out: this is the last thing the
segment shows.

**The projector inverts when it lands** — the whole screen turns yellow with the winner's name in
black across it, and the row of verbs is replaced by one sentence. That inversion is the signal to the
room that it is over, so you will know the close took without reading anything.

Four things about it are worth knowing before you press it:

- **It takes two taps.** The first arms the button; the second closes the session. Any action in
  between disarms it.
- **It is refused while a question is open.** Reveal first. That guard exists so the one irreversible
  verb cannot fire mid-question. The button is disabled there, so you should not meet the refusal.
- **It asks for the session's current version as confirmation.** Every other host verb is safe to
  double-tap because a repeat is a harmless no-op; `end` is safe for the opposite reason — a repeated
  or stale request is *refused*. If you get a message about the confirmation not matching, refresh
  the view rather than retrying blind.
- **If the board cannot be read, the session still ends** — you get the plain "To już koniec" screen
  instead of the winner. That is deliberate: closing is what puts the room's data on the short
  lifetime, so it is never blocked by a leaderboard. The log line says so (`session.ended` with
  `rowCount: 0`). There is no way to re-show the winner afterwards; carry on and announce it yourself.

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

### Attendees report a yellow-marked "tryb zapasowy" banner

**What it means.** The banner reads *"Tryb zapasowy — odpowiedzi działają, ale punkty za czas mogą
być niższe."* Those devices could not open an Ably channel and have fallen back to polling
`/api/quiz/state` every ~6 seconds. They are still in the quiz: they see each question, can submit
answers, and get their result. They are a few seconds behind the room.

**During the session: do nothing.** There is no action that helps mid-segment, and the fallback is
already the mitigation. Keep running the quiz normally.

**Check your own screen.** Hover the connection lamp — the small dot in the bottom-right corner of the
host view — and read the sentence it shows. If it reads `limit Ably wyczerpany (40111) — sala
pełna`, the cause is the account's peak-connection ceiling — 200 on the free tier — and not the venue
network. Any other wording points at the network instead.

The lamp's colour is the same fact at a glance, and it is what you check without stopping: **green** is
connected, **amber** is connecting or running on the fallback, **red** is a lost connection. Only amber
and red are worth a hover.

**The real fix is before the event, not during it.** A room above ~180 people needs a paid Ably plan;
180 real attendees can already brush 200 once reloads, second tabs, the projector and your own device
are counted. Check expected attendance against the ceiling when you plan the session — the risk row in
`context/foundation/infrastructure.md` names the host as owner, per event.

**If someone asks why they scored lower.** Answer honestly: a device on the fallback starts its clock
when the question reaches it, so it earns fewer speed points. It is not a scoring bug and the banner
says so on their phone.

**If someone on the fallback says the question closed too early.** Their countdown is counted from
the moment you advanced, not from when the question reached them — so a device running ~6 seconds
behind really does get ~6 seconds less to answer (S-11, FR-020). That is the same trade the banner
already describes for speed points, and it is why the two clocks are separate: the *cutoff* has to
be shared or the projector and the phones would disagree about how long is left, while the *reward*
is per-device so nobody is punished twice for a bad connection. Nothing to do mid-segment; if it
affects several people, the answer is a longer budget next time, not a change on stage.

## Standing constraints

- **Keep the repository under a personal GitHub account.** Hobby projects cannot connect to
  Git-organization repositories; moving `ai-community-szn` into an org would break the deploy pipeline.
- **Prefer git push over `vercel deploy` for real deployments.** A CLI deploy from this repo uploads
  ~244MB (`public/photos` is 122MB of it) and has failed once with `Error: Upload aborted`. A retry
  worked, but the git path does not carry this risk.
- **Preview deployments are not public.** Vercel Authentication is enabled, so preview URLs return a 302
  to Vercel SSO for anonymous visitors. Checking that a preview renders requires a logged-in browser —
  an anonymous `curl` will only ever see the redirect.
