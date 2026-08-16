import { z } from "zod";

import { type PlayerRecord } from "./players";

/**
 * The leaderboard: what it holds, how it is ordered, and how a position is numbered
 * (roadmap S-07, PRD FR-014).
 *
 * The pure half of the beat. No store access and no `import.meta.env` read, so the two
 * ordering rules below are unit-testable on their own — the same split `players.ts`
 * holds for joining and `scoring.ts` for awarding.
 *
 * `zod` is imported directly, not through `astro:content`: this module is read by a
 * serverless function and by `vitest`, and `astro:` specifiers resolve in neither.
 * `portability.test.ts` in this directory enforces it. See CLAUDE.md.
 *
 * ## Why a row carries a name and not a player id
 *
 * These rows are **published on the session snapshot**, which is the first time this
 * project puts an attendee display name on the wire — see the field's note in
 * `state.ts` and `leaderboard-contract.md` for the decision and its bound.
 *
 * A player id is deliberately *not* on the row. Holding someone's id lets you answer as
 * them, and `players.ts` says in as many words that each scoring slice must re-take the
 * "not a secret" claim rather than inherit it. Publishing the five ids most worth
 * stealing to every device in the room is not a re-taking anyone could defend. A device
 * recognises its own line by name instead: names are unique by fold (FR-008), and the
 * name in a device's `localStorage` is the one the server returned.
 */

/**
 * Five rows, and the number is a legibility bound rather than a taste one.
 *
 * `MAX_DISPLAY_NAME_LENGTH` is 24 because that is what fits a projected line at the type
 * size the back of a venue room needs (`players.ts`), and five such lines is what fits
 * beside the rest of the host's screen. It is also the count of names entering the
 * ~2-minute Ably retention window, so it is the bound the retention decision was taken
 * against — raising it is a retention change, not a layout tweak.
 */
export const STANDINGS_SIZE = 5;

export const standingsRowSchema = z.object({
  /** Competition rank — see `rankOf`. Shared by tied players, so ranks may repeat. */
  rank: z.number().int().positive(),
  displayName: z.string().min(1),
  points: z.number().int().nonnegative(),
});

export type StandingsRow = z.infer<typeof standingsRowSchema>;

export const standingsSchema = z.object({
  /**
   * At most `STANDINGS_SIZE`, and fewer in a room smaller than that. Bounded in the
   * schema rather than only at the call site, because this shape is what gets published:
   * the bound is the retention promise, so the document itself should refuse to carry
   * more than it.
   */
  rows: z.array(standingsRowSchema).max(STANDINGS_SIZE),
  /**
   * Everyone who joined, not just everyone on the board and not just everyone who
   * scored. It is the denominator of the attendee's "your position: N of M" line, and it
   * matches the `playerCount` already on the same screens — two numbers about the size of
   * the room that disagreed would be read as a bug in the one that was smaller.
   */
  playerCount: z.number().int().nonnegative(),
});

export type Standings = z.infer<typeof standingsSchema>;

/** A player and their total, before ordering. */
type Contender = PlayerRecord & { points: number };

/**
 * Where a total places, counting from 1.
 *
 * **Competition ranking: tied players share a number** (1, 2, 2, 4, 5), and that is
 * load-bearing rather than a convention borrowed from sport.
 *
 * Two paths compute a position and they hold different data. The board is built here
 * from every player. A single device asks `/api/quiz/result` for its own position, and
 * that path has only the scores hash — no names, no join times. A rank defined as
 * "position in the ordered array" is not computable there, so the two paths would have to
 * disagree by construction: a player tied for second would read `2` on the projector and
 * `1` on their own phone, at the moment they are looking at both.
 *
 * Defined from totals alone, both paths call *this function* and cannot diverge. That is
 * also why `buildStandings` below numbers its rows through here rather than using the
 * index it already has in hand.
 */
export function rankOf(total: number, totals: readonly number[]): number {
  return 1 + totals.filter((other) => other > total).length;
}

/**
 * Orders every player and returns the top `STANDINGS_SIZE`.
 *
 * `scores` is the raw scores hash — player id to running total — and a player absent
 * from it has scored nothing rather than not existing. Everyone in `players` is a
 * contender, so an attendee who joined and never answered still has a position to find
 * themselves at; the alternative would leave the quietest half of the room with nothing
 * on screen and a denominator that disagreed with the join count beside it.
 *
 * **The sort is a total order — `points` desc, then `joinedAt` asc, then `id` asc — and
 * every part of it earns its place.** Ordering by points alone leaves ties to the order
 * the store happened to return, so two devices could render the same standings in
 * different orders. Nothing here would catch that: the board looks correct on each screen
 * and only disagrees between them, which is exactly the divergence the PRD guardrail
 * forbids and exactly the kind of failure a room notices before a test does. `joinedAt`
 * settles a tie in favour of whoever joined earlier; `id` settles the residual tie
 * between two devices that joined in the same millisecond, and exists so the order is
 * total rather than nearly so.
 *
 * In practice no device ever sorts — the rows are published in this order and rendered as
 * received. The total order is what makes *this* function's output reproducible.
 */
export function buildStandings(
  players: readonly PlayerRecord[],
  scores: Readonly<Record<string, number>>,
): Standings {
  const contenders: Contender[] = players.map((player) => ({
    ...player,
    // A missing entry is zero, not an absence: `HINCRBY` only writes when something was
    // awarded, so everyone who scored nothing shares this branch.
    points: scores[player.id] ?? 0,
  }));

  const totals = contenders.map((contender) => contender.points);

  const ordered = [...contenders].sort(
    (a, b) =>
      b.points - a.points ||
      a.joinedAt - b.joinedAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    rows: ordered.slice(0, STANDINGS_SIZE).map((contender) => ({
      // Through `rankOf`, not through the index this `map` already has — see that
      // function's note. The index would be a *positional* rank, which the per-device
      // path cannot reproduce.
      rank: rankOf(contender.points, totals),
      displayName: contender.displayName,
      points: contender.points,
    })),
    playerCount: players.length,
  };
}
