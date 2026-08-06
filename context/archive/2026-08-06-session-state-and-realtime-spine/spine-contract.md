# Spine contract — what S-02 onward may rely on

> Deliberately short. This is a pointer, not a second copy of the plan — the full
> reasoning lives in `plan.md`, which is not going anywhere. If this file grows past a
> page it has become a duplicate that can disagree with the plan.

## Three non-reliances (rules, not suggestions)

1. **No Ably presence.** `infrastructure.md` measures the join storm at O(N²) — 150
   attendees entering one presence set is ~22.5k messages, and 150 `track()` calls at join
   breach the rate limit on their own. Broadcast standings from authoritative state
   instead. This binds S-07 in particular.
2. **No authoritative state in the browser.** Ably carries messages; it is not the truth.
   Scores, standings and flow all come from the store. A client may render state and may
   drop stale state — it may never be the reason a value is what it is.
3. **No read-then-write on the store.** `writeSession` is the only sanctioned mutation
   path, and its version guard is the reason 150 near-simultaneous writes cannot lose one.
   A `GET` followed by a `SET` in TypeScript reintroduces the lost-update race that
   `store.test.ts`'s single-`eval` assertion exists to prevent. This binds S-02's display
   name claim especially: the name claim must be atomic in the store, which the roadmap
   flags as S-02's top risk.

## What exists, and where to read about it

| Thing | Where | Plan section |
| --- | --- | --- |
| Session key, TTL, `readSession` / `writeSession` / `createSession` | `src/lib/session/store.ts` | Phase 2 §2 |
| State schema, phases, `nextQuestionId` | `src/lib/session/state.ts` | Phase 2 §1 |
| Log event vocabulary (eight events; closed set — extend it there, don't invent a second one) | `src/lib/session/log.ts` | Phase 2 §3 |
| Channel name, subscribe-only token, snapshot publish | `src/lib/session/realtime.ts` | Phase 3 §1 |
| Host secret check, version bump, write-then-publish, outcome shapes | `src/lib/session/host.ts` | Phase 3 §3 |
| Routes | `src/pages/api/quiz/` | Phase 3 §2–4 |

## Client rule, in one line

Apply whichever of the fetched snapshot and the subscribed snapshot carries the higher
`version`; drop anything not newer. That single rule makes the two sources safe to race,
makes a missed message self-correcting, and makes a failed publish safely retryable.

## Two traps discovered while building this

- **Astro's origin check applies to the host POSTs.** A POST that reads
  `request.formData()` is rejected with `403 Cross-site POST form submissions are
  forbidden` *before* the handler runs, unless the `Origin` header matches. Same-origin
  `fetch` from a page on this site satisfies it automatically — but testing with `curl`
  needs `-H "Origin: <base-url>"`, or a 403 reads as a broken endpoint.
- **The Vercel Marketplace injects `KV_REST_API_*`, not `UPSTASH_REDIS_REST_*`.** The
  documented names are not the delivered ones. `store.ts` accepts either and prefers the
  observed pair; `.env.example` records why.

## Scope boundary

This slice ships flow only — no players, no answers, no scores. `SessionState` carries
`version`, `phase`, `currentQuestionId`, `startedAt`, `updatedAt` and nothing else.
Adding players is S-02's; answers and scoring are S-03's. Keep the document small: every
host action publishes the whole thing.
