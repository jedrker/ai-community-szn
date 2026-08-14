import { z } from "zod";

import { normalizePolish } from "../../quiz/index";

/**
 * Display names: what is accepted, and what counts as the same name (roadmap S-02).
 *
 * The pure half of joining. No store access and no `import.meta.env` read, so it is
 * unit-testable on its own and the atomicity question stays entirely in `store.ts`
 * where the Lua lives.
 *
 * `zod` is imported directly, not through `astro:content` — this module is read by a
 * serverless function and by `vitest`, and `astro:` specifiers resolve in neither.
 * `portability.test.ts` in this directory enforces it. See CLAUDE.md.
 */

/**
 * Two characters, so a single letter is not a name anyone can find themselves by on a
 * leaderboard, and twenty-four, because that is what fits on a projected line at the
 * type size the back of a venue room needs (PRD: "the host's view is legible from the
 * back of a venue room").
 *
 * The upper bound is the load-bearing one and it belongs here rather than in a view:
 * a 200-character name breaks the leaderboard layout regardless of what it says, and
 * the store is the only place that can refuse it for every view at once.
 */
export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_DISPLAY_NAME_LENGTH = 24;

/**
 * How many players one device may register in a session (roadmap S-09, PRD FR-018).
 *
 * **Three, and the number is a judgement rather than a measurement.** It covers the
 * honest shared-handset cases — a couple, a parent and a child, one phone lent to
 * somebody whose battery died — while making leaderboard-farming tedious enough to be
 * visible. Two would refuse a lent handset on the first try, which lands the refusal on
 * an attendee who did nothing wrong; five is already enough fake players to distort a
 * board in a room of 150, so it would protect against almost nothing.
 *
 * **What this buys is friction, not prevention**, and that is the requirement rather
 * than a shortfall against it: FR-018 asks for a lightweight, defeatable guard and
 * explicitly not an identity system. Clearing site data or opening a private tab resets
 * the count, because the device is identified by an id it stores about itself
 * (`DEVICE_STORAGE_KEY`). The PRD accepts that, and it also accepts the cost pointing
 * the other way — a genuinely shared phone in a group of four is refused.
 *
 * It lives here, beside the name bounds, for the reason those do: this module is the
 * pure half of joining, so both the route and the store can read the number without a
 * cycle and there is one place it is spelled.
 */
export const MAX_PLAYERS_PER_DEVICE = 3;

/**
 * Polish letters, digits, spaces, and a small set of marks people actually put in a
 * nickname. Deliberately permissive about *what* a name says and strict about what it
 * is made of: PRD §Non-Goals accepts unmoderated content on the projector, so this is
 * a layout and encoding guard, not a content filter. No blocklist — that decision was
 * taken during planning and reversing it here would be reopening it by the back door.
 *
 * Emoji are excluded as a side effect of the allowlist. That is a real cost worth
 * naming: some attendees will type one and be refused. It buys a name that renders
 * predictably at projector scale on whatever the venue laptop happens to be.
 */
const ALLOWED_CHARACTERS = /^[\p{L}\p{N} ._'-]+$/u;

/** Polish, because the join form renders these directly. */
const MESSAGES = {
  empty: "Podaj swoją nazwę.",
  tooShort: `Nazwa musi mieć co najmniej ${MIN_DISPLAY_NAME_LENGTH} znaki.`,
  tooLong: `Nazwa może mieć najwyżej ${MAX_DISPLAY_NAME_LENGTH} znaki.`,
  disallowed: "Nazwa może zawierać tylko litery, cyfry, spacje i znaki . _ - '",
} as const;

/**
 * What the store holds per player.
 *
 * `displayName` is what the attendee typed; the folded form is the hash *field*, not a
 * field of this record, so there is one place it can disagree with itself: nowhere.
 */
export const playerRecordSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  /** Epoch milliseconds. */
  joinedAt: z.number().int().positive(),
});

export type PlayerRecord = z.infer<typeof playerRecordSchema>;

export type ValidatedDisplayName =
  | { ok: true; displayName: string; key: string }
  | { ok: false; error: string };

/**
 * Trims, collapses internal whitespace, and checks the bounds and the character set.
 *
 * The collapse happens before the length check on purpose: `"Jan    Kowalski"` should
 * be measured as the name it will be displayed as, not as the string that was typed.
 *
 * **The returned `key` is the whole point.** Uniqueness is decided on
 * `normalizePolish(displayName)` — case-, spacing- and diacritic-folded — so `Anna`,
 * `anna` and `ANNA` are one claim. FR-008 exists to make the leaderboard unambiguous,
 * and three lines that differ only in capitalisation is precisely the ambiguity it is
 * meant to remove. The attendee still sees the name they typed.
 *
 * `normalizePolish` is reused rather than reimplemented: it already handles the `ł`
 * trap that a bare NFD pass gets wrong (`żółć łódź` would otherwise fold to
 * `zołc łodz`), and a second fold would be a second thing to get that wrong in.
 */
export function validateDisplayName(raw: string): ValidatedDisplayName {
  const displayName = raw.trim().replace(/\s+/g, " ");

  if (displayName.length === 0) return { ok: false, error: MESSAGES.empty };
  if (displayName.length < MIN_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: MESSAGES.tooShort };
  }
  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    return { ok: false, error: MESSAGES.tooLong };
  }
  if (!ALLOWED_CHARACTERS.test(displayName)) {
    return { ok: false, error: MESSAGES.disallowed };
  }

  const key = normalizePolish(displayName);

  // A name made only of characters the fold removes would claim an empty key, and an
  // empty hash field is a name nobody can ever collide with — every such attendee
  // would silently share one claim. Unreachable through the allowlist above as it
  // stands, and checked anyway, because the two rules are far enough apart in this
  // file that a later edit to either could open it.
  if (key.length === 0) return { ok: false, error: MESSAGES.disallowed };

  return { ok: true, displayName, key };
}

/**
 * An opaque per-device identity, minted server-side.
 *
 * Opaque on purpose: it is handed to the browser and comes back on later requests, so
 * it must carry nothing about who the attendee is.
 *
 * **"Not a secret" is a claim scoped to S-02, and S-03 must re-take it rather than
 * inherit it.** Holding someone else's id lets you claim to be them, which is
 * acceptable *today* only because the id carries nothing worth stealing — the worst an
 * impostor gets is a display name. From S-03 the same id carries a score, and from
 * S-07 a leaderboard position, so the sentence stops being about nothing and starts
 * being about the thing the whole segment builds toward.
 *
 * That may well still be fine: a v4 UUID is unguessable, the ids travel over HTTPS,
 * and the PRD's no-accounts, trust-the-room model is a deliberate decision rather than
 * an oversight. The point is that it is a decision, and the slice that attaches scores
 * is the one that should make it.
 */
export function newPlayerId(): string {
  return crypto.randomUUID();
}

/** Parses a record read back from the store. Never throws. */
export function parsePlayerRecord(raw: unknown): PlayerRecord | null {
  const result = playerRecordSchema.safeParse(raw);
  return result.success ? result.data : null;
}
