# Connection-limit degradation — Plan Brief

> Full plan: `context/changes/connection-limit-degradation/plan.md`

## What & Why

A room larger than ~180 people exhausts the Ably free tier's 200 peak-connection ceiling, and
every device Ably refuses is currently removed from the quiz: it shows a red "reconnecting" line
and its answer controls are hidden. Both halves of that are wrong — the message is a guess about
a cause the client already knows, and the device's actual needs (`/api/quiz/state`,
`/api/quiz/answer`) are plain HTTP and still work. This change makes the message true and keeps
the device playing.

## Starting Point

`src/lib/client/session.ts` folds all five unhealthy Ably connection states into one `"lost"`
status and throws away the `ErrorInfo` that names the cause. `src/pages/quiz/index.astro:289`
treats `lost` as overriding everything and calls `hideAnswerControls()`. `session.ts` has no
test file. There is no participant cap anywhere in the server code — the ceiling is entirely
Ably's, and it is recorded as an accepted risk in `context/foundation/infrastructure.md:272`.

## Desired End State

A refused device shows an amber "backup mode" banner instead of a red failure, receives each new
question within ~6 seconds, can select or type and submit an answer, sees the reveal, and is told
in one sentence that its speed points may be lower. If the fallback itself stops working it falls
back to the existing red screen. The host's screen names the account limit by error code, so the
one person who can act knows whether to wait or raise the plan.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Cause discrimination | On `reason.code`, family of four codes (40111, 40115, 42910, 42911) | Ably's docs don't commit 40111 to a specific connection state, so discriminating on state would be a guess; all four codes mean the same thing to an attendee | Plan |
| Scope of polling | Both attendee and host views | One implementation in `session.ts`; the host is the single device whose failure stops the room | Plan |
| Poll interval | 6 s ± 1,5 s jitter | ~7k Redis commands for ~20 refused devices; ~66k for a fully-degraded 220-person room, against 500k/month. Jitter breaks the lockstep of a cohort refused in the same second | Plan |
| degraded → lost | After 2 consecutive failed polls | A single venue-network blip must not flash a red screen; a real walk-out-of-range shows within ~12 s | Plan |
| Speed scoring | Unchanged in code; stated in the UI | A polled device starts its clock a poll late and honestly earns less. Compensating would mean trusting a client-reported time — the shape `lessons.md` already has an entry about | Plan |
| Attendee copy | Amber banner, neutral wording, no mention of limits | The attendee cannot act on "the account's limit is exhausted"; diagnostics belong on the host's screen | Plan |
| Test approach | Pure classifier + lifecycle tests, no Ably module mock | Matches the project's pure-function test style; a module mock would freeze the SDK's API and pass against a real breakage | Plan |
| Docs touched | `state.ts` docstring, `host.astro` docstring, runbook | Both docstrings assert the project has no timer-driven read, which this change makes false; the runbook's command counter is described as a polling detector | Plan |

## Scope

**In scope:** cause classification in `session.ts`; a fourth `degraded` status; a jittered
polling loop with a visibility check and an `ended` stop condition; attendee view keeping its
answer controls plus an amber banner; host diagnostic line; a new `session.test.ts`; the two
invalidated docstrings; a runbook entry.

**Out of scope:** any participant cap or lobby queue; throttling `/api/quiz/token`; any change to
scoring, `/api/quiz/answer`, or the published snapshot; `/api/quiz/state`'s response shape;
re-scoring the risk rows in `infrastructure.md`; raising the Ably plan (an account action, and
still the only real fix for a room over ~180).

## Architecture / Approach

`session.ts` stays the single place the spine contract is implemented. It gains a pure
`classifyConnection(state, code)` returning `{ status, cause }`, and an opt-in fallback loop that
re-fetches `/api/quiz/state` when Ably is down. The loop is modelled on the host's existing
participation poll (`host.astro:517-534`): one timer, never stacked behind an open request,
skipped while the tab is hidden, re-armed in exactly one place. Status is *earned* — it stays
`lost` until the first poll succeeds, so a genuinely offline device never sees a calm amber
banner. The existing version guard in `apply` suppresses `onSnapshot` for an unchanged snapshot,
so idle polls cost a request and no DOM work.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Classify the disconnect cause | `reason.code` reaches both views; each renders its own sentence; first-ever `session.test.ts` | `onConnection`'s signature changes and has two call sites — a missed one is a type error, not a silent bug |
| 2. Degrade to polling | `degraded` status, the fallback loop, attendee keeps answering, docstrings and runbook corrected | A timer that outlives its purpose spends commands silently after the session; the `ended` stop, the `close()` cancel and their tests are the guard |

**Prerequisites:** none — client-only plus docs. A manual run needs two devices and devtools
request blocking for `realtime.ably.io`.
**Estimated effort:** ~2 sessions, one per phase, with a manual check between them.

## Open Risks & Assumptions

- **Assumption: Ably surfaces 40111 in `ConnectionStateChange.reason.code`.** Documented as the
  code for the condition, but not observed live here. If it arrives only on
  `connection.errorReason`, Phase 1's classifier reads that too — a one-line adjustment found by
  the manual step, not a design change.
- **Polling only helps if HTTP is healthy.** A venue network bad enough to break Ably will often
  break `fetch` as well; those devices land in `lost` after two failures, which is today's
  behaviour and no worse.
- **Degraded players score lower on speed.** Accepted and stated on screen. A leaderboard
  question from the floor now has an honest answer.
- **The real remedy is still a paid Ably plan.** This change makes exceeding the ceiling
  survivable, not free.

## Success Criteria (Summary)

- A device Ably refuses can answer every question and see every reveal, roughly 6 seconds behind
  the room, and knows why it is behind.
- No device shows a calm banner while it is actually offline, and none shows a red failure for a
  fallback that is working.
- The host can tell from their own screen whether the cause is the account limit, and the runbook
  says what to do about it.
