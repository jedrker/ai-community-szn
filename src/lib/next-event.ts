/**
 * The date of the next meetup, for the window where it has been agreed but has
 * no entry in the `events` collection yet — no Luma page, so nothing to
 * register for and nothing the homepage could resolve per request.
 *
 * The homepage falls back to this only while `getCollection("events")` yields
 * no entry with `status: "upcoming"`. The moment the event gets its Markdown
 * file, that file wins and this value stops being rendered — so it never
 * competes with the collection for the same fact.
 *
 * It lives here because it is announced twice on the homepage, in the hero and
 * in the section below it. Held in both templates it went stale in one place
 * and not the other, which reads as a working page advertising a date that has
 * already passed.
 *
 * Built from local date parts on purpose: `new Date("2026-10-15")` is UTC
 * midnight and renders as the 14th anywhere behind UTC.
 */
export const PLANNED_NEXT_EVENT_DATE = new Date(2026, 9, 15);

/** The date as the homepage prints it, e.g. `15.10.2026`. */
export const plannedNextEventLabel = PLANNED_NEXT_EVENT_DATE.toLocaleDateString(
  "pl-PL",
  { day: "numeric", month: "numeric", year: "numeric" }
);
