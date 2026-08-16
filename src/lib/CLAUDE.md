# src/lib/ — server-side modules

Named exports, no default exports. Secrets come from `import.meta.env` and are documented in
`.env.example` (`RESEND_API_KEY`, `ADMIN_EMAIL`, `RESEND_AUDIENCE_ID`, `SLACK_WEBHOOK_URL`).

`src/lib/client/` and `src/lib/session/` carry their own `CLAUDE.md` — read those before touching
either.

- `resend.ts` — transactional email (welcome mail, admin notifications) and Resend Audience contacts.
- `slack.ts` — webhook notifications. **This is the error-handling pattern to copy**: missing config
  warns and no-ops, failures are caught and logged with context, and nothing ever throws into a
  request path. **It returns `boolean` rather than `void`, and that is the half that is easy to
  drop**: "never throws" is not the same as "the caller cannot tell". `sendSlackNotification`
  reports `false` for all three failures (missing config, non-OK response, transport error), so
  `speaker-signup.ts` can distinguish *notified somebody* from *notified nobody and said thank you*.
  Do not narrow it back to `void` to "match the fire-and-forget style" — the swallow is about not
  throwing, never about hiding the outcome.
- `newsletter.ts` — the subscriber store, backed by **Resend Audiences**. `addSubscriber` derives
  duplicate detection from `contacts.get` and throws when a signup could not be recorded, so the
  route can never report success it didn't achieve. Covered by `newsletter.test.ts`. (It replaced
  `subscribers.ts`, which wrote `data/subscribers.json` through `node:fs/promises` and therefore
  always rejected on Vercel's read-only serverless filesystem.)

**The Resend SDK resolves with `{ data, error }` and does NOT throw on an API failure**, so a bare
`await resend.emails.send(...)` inside a `try`/`catch` is a swallow with no log line at all: an
invalid key, an unverified domain, a 429 or a bounce all read as a successful send, and the `catch`
never runs. **Every call site must inspect `.error`** — `emails.send` in both signup routes and
`contacts.get` / `contacts.create` in `newsletter.ts`. The `contacts.get` case is the subtle one:
only `error.name === "not_found"` means the contact is genuinely absent, and treating any other
error as "not a duplicate" degrades a store outage into a second create attempt.

**A route with no database may not report success it cannot back.** `speaker-signup.ts` is the
worked example: with no store, the admin email and the Slack message *are* the application, so the
route answers 200 only once at least one of the two landed, and 503s with retry copy when neither
did. Two orderings there are load-bearing — the applicant's confirmation mail is sent *after* that
check (so nobody is thanked for an application that reached no organiser) and is *excluded* from it
(the application is already recorded by then, and refusing would ask for a duplicate). Missing
`RESEND_API_KEY` or `ADMIN_EMAIL` is logged rather than silently skipped, for the same reason.

**There is no database and no writable filesystem.** Never persist anything that must outlive a
request through `node:fs` — it works locally and fails in production.
