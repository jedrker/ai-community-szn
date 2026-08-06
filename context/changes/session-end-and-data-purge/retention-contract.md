# Retention contract — what S-02 onward must do about attendee data

> Deliberately short, like `spine-contract.md` before it. This is a pointer, not a second
> copy of the plan — the reasoning lives in `plan.md`, which is not going anywhere. If this
> file grows past a page it has become a duplicate that can disagree with the plan.

F-03 delivered the mechanism. The data it protects does not exist yet: S-02 adds display
names, S-03 answers and scores, S-07 standings. These are the rules those slices are bound
by, written while they were still cheap to bind.

## Four rules

1. **Every key is declared in `src/lib/session/keys.ts`.** There is no other sanctioned
   path. `end` re-arms the registered set to the short lifetime and `purge` deletes it; a
   key created anywhere else is reached by neither, and would sit on the four-hour lifetime
   holding attendee data with nothing to say so. `keys.test.ts` fails the suite on a
   namespaced string literal outside that module.

2. **Display names and answers never appear in a log line.** `LogFields` is a closed type
   and that closure *is* the enforcement — passing `{ displayName }` is a compile error.
   Logs are retained ~1 hour on the Hobby plan and are covered by no TTL, no `purge`, and
   no `vercel rollback`, so anything written there outlives the session document by design.
   Do not reopen the field set; add the specific field you need, and ask whether it can
   carry attendee data first.

3. **Assume anything published to Ably is readable for ~2 minutes.** Measured, not assumed
   — see `ably-retention-probe.md`. Persistence is off for the `livequiz` namespace, but the
   platform's connection-recovery buffer is retained regardless and **cannot be reduced to
   zero**. Since `publishSnapshot` sends the whole `SessionState`, every field S-02 adds to
   that document inherits this window.

4. **`end` shortens, `purge` deletes.** They are not interchangeable, and the ten-minute
   window between them is deliberate, not an oversight.

## The one open decision this hands to S-02

Rule 3 is a real constraint, not a formality. The last snapshot published before a session
ends will carry display names and stay retrievable for roughly two minutes by anything
holding a subscribe token — and `GET /api/quiz/token` is deliberately open and unthrottled
(accepted risk, `infrastructure.md`).

Two properties bound it: the window trails the *final* host action rather than accumulating
across the segment, because each publish supersedes the last; and it is the platform's floor,
so no code in this project can shorten it.

**If that is judged unacceptable once real names are involved, the remedy is S-02's to take:
publish opaque per-device player ids and keep names out of the snapshot, resolving them
elsewhere.** That option was considered during F-03 planning and deliberately not forced,
because it constrains how S-07 renders a leaderboard and that tradeoff belongs to the slice
that owns the view. Decide it knowingly rather than inheriting it by default.

## What `end` and `purge` actually do

| | `end` | `purge` |
| --- | --- | --- |
| Store | re-arms every registered key to ~10 min | deletes every registered key |
| Phase guard | refused while a question is open | none, deliberately — it is the escape hatch |
| Confirmation | current version required | current version required (unless no session exists) |
| Ordering | write, then publish | write, publish, **then** delete |

The purge ordering is the part that looks safe to simplify and is not. Clients drop any
snapshot whose version is not strictly greater than the one they hold, so publishing before
writing means broadcasting at the existing version — silently discarded by every device,
with the failure looking like a dead network. Verified both ways in
`purge-verification.md`.

## Where to read more

| Thing | Where |
| --- | --- |
| Key registry and its textual-gate limitation | `src/lib/session/keys.ts`, `keys.test.ts` |
| Lifetimes and their reasoning | `src/lib/session/store.ts` (`SESSION_TTL_SECONDS`, `ENDED_TTL_SECONDS`) |
| The `ended` phase and its invariant | `src/lib/session/state.ts` |
| Guards, and why they are asymmetric | `src/pages/api/quiz/host/end.ts`, `purge.ts` |
| Measured Ably retention | `ably-retention-probe.md` |
| Proof the namespace empties | `purge-verification.md` |
| Full reasoning | `plan.md` |
