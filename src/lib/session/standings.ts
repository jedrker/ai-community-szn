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
  /**
   * How many places this player moved since before the last question — **positive means
   * they climbed** (this change).
   *
   * **The sign is the one thing here that cannot be recovered from the code.** Rank
   * numbers get *smaller* as a player climbs, so the arithmetic that produces this field
   * is `previousRank - rank` and the naive subtraction has the opposite sign. Inverted, it
   * renders as a perfectly plausible board in which everyone who gained points fell.
   *
   * **Computed on the server and published, rather than derived by each device**, for the
   * same reason `renderStandings` may not sort: a figure two surfaces compute
   * independently is a figure they can disagree about, and the disagreement shows up
   * between screens rather than on any one of them.
   *
   * `null` is "no movement can be stated", which covers three different situations that
   * deliberately render identically (an empty cell): the caller passed no baseline, the
   * baseline read failed, or this player's previous total was zero — see the
   * zero-baseline rule on `buildStandings`. `0` is a *value*, not an absence: the player
   * held their position. The renderer draws nothing for either, which is the decision
   * this change took about what "nothing changed" looks like; the field stays honest
   * about which of the two it is.
   *
   * **`.default(null)` is load-bearing, not tidiness.** `SessionState` documents are read
   * back out of the store and parsed, so a board written before this field shipped must
   * still parse after it — required, the host's next action would 409 mid-segment. Same
   * reasoning as the transition fields in `state.ts`.
   */
  delta: z.number().int().nullable().default(null),
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
 * The room one question ago: every player's total then, and the same numbers as the array
 * `rankOf` measures a previous position against.
 *
 * Both halves or neither — see where it is built in `buildStandings`.
 */
type Baseline = {
  readonly scores: Readonly<Record<string, number>>;
  readonly totals: readonly number[];
};

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
  previousScores: Readonly<Record<string, number>> | null = null,
): Standings {
  const contenders: Contender[] = players.map((player) => ({
    ...player,
    // A missing entry is zero, not an absence: `HINCRBY` only writes when something was
    // awarded, so everyone who scored nothing shares this branch.
    points: scores[player.id] ?? 0,
  }));

  const totals = contenders.map((contender) => contender.points);

  /**
   * The same two things, one question earlier — **one nullable object rather than two
   * nullable values**, because they are only ever absent together and a pair of
   * independent null checks invites a caller to supply one without the other.
   *
   * `totals` is built over the **whole** contender set rather than over the five rows that
   * get published. A rank is a statement about everyone, so a previous rank computed from
   * five totals would be a different quantity from the rank beside it. `rankOf` is what
   * both go through, which is the property that stops the two numbers on one row being
   * produced by different rules.
   */
  const baseline: Baseline | null =
    previousScores === null
      ? null
      : {
          scores: previousScores,
          totals: contenders.map(
            (contender) => previousScores[contender.id] ?? 0,
          ),
        };

  const ordered = [...contenders].sort(
    (a, b) =>
      b.points - a.points ||
      a.joinedAt - b.joinedAt ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return {
    rows: ordered.slice(0, STANDINGS_SIZE).map((contender) => {
      // Through `rankOf`, not through the index this `map` already has — see that
      // function's note. The index would be a *positional* rank, which the per-device
      // path cannot reproduce.
      const rank = rankOf(contender.points, totals);

      return {
        rank,
        displayName: contender.displayName,
        points: contender.points,
        delta: deltaFor(contender, rank, baseline),
      };
    }),
    playerCount: players.length,
  };
}

/**
 * How many places one contender moved, or `null` when no movement can be stated.
 *
 * **`previousRank - rank`, and that order is the whole of the sign convention** — see the
 * field's note on `standingsRowSchema`. Both sides come from `rankOf`, so a tie is a tie
 * on both dates and cannot manufacture a move.
 *
 * ## The zero-baseline rule, which is not an edge case
 *
 * **A contender whose previous total was 0 gets `null`.** Before the first question every
 * player holds nothing, and competition ranking puts a room full of zeros in a single tie
 * at position 1 — so without this rule the first board of every session would show the
 * leader at 0 and places two through five at −1, −2, −3, −4. The room would be told its
 * top scorers had just fallen, on the one board where nobody had fallen at all.
 *
 * It keeps behaving correctly after that first board, which is why it is a rule about
 * zero rather than a special case for the opening: a player arriving on the board from
 * nothing has not climbed forty places, they have appeared. The accepted cost is that the
 * first board of a session carries no movement at all.
 *
 * Note this is deliberately keyed on the *previous* total alone. A player who had points
 * and has since been passed still gets their fall reported; only an absent past is silent.
 */
function deltaFor(
  contender: Contender,
  rank: number,
  baseline: Baseline | null,
): number | null {
  if (baseline === null) return null;

  const previousTotal = baseline.scores[contender.id] ?? 0;
  if (previousTotal === 0) return null;

  return rankOf(previousTotal, baseline.totals) - rank;
}
