import { describe, expect, it } from "vitest";

import { type PlayerRecord } from "./players";
import {
  STANDINGS_SIZE,
  buildStandings,
  rankOf,
  standingsRowSchema,
  standingsSchema,
} from "./standings";

const NOW = 1_785_000_000_000;

/**
 * Players are built one at a time rather than spread from a shared base, and that is
 * deliberate: every interesting case in this file turns on `points`, `joinedAt` or `id`,
 * so a fixture that inherited any of the three from a base object would decide the branch
 * somewhere other than the test that names it (`lessons.md`, "Prove the fixture reaches
 * the branch the test names").
 */
function player(
  id: string,
  displayName: string,
  joinedAt: number,
): PlayerRecord {
  return { id, displayName, joinedAt };
}

describe("rankOf", () => {
  it("counts from 1", () => {
    expect(rankOf(100, [100])).toBe(1);
  });

  it("places a total below everyone who beat it", () => {
    expect(rankOf(40, [100, 90, 80, 40])).toBe(4);
  });

  /**
   * COMPETITION RANKING, and the reason the whole slice hangs on it.
   *
   * Two players tied for second are both second. Defined as a position in the ordered
   * array instead, one of them would be third here and second on the projector — and the
   * per-device path, which holds only the scores hash, cannot compute an array position
   * at all. See the function's own note.
   */
  it("gives tied totals the same rank", () => {
    expect(rankOf(90, [100, 90, 90, 40])).toBe(2);
  });

  it("resumes after a tie at the position the tie consumed", () => {
    // 100, 90, 90, 40 ranks as 1, 2, 2, 4 — never 1, 2, 2, 3.
    expect(rankOf(40, [100, 90, 90, 40])).toBe(4);
  });

  it("ranks a total nobody has beaten first, even at zero", () => {
    expect(rankOf(0, [0, 0, 0])).toBe(1);
  });
});

describe("buildStandings", () => {
  it("orders by points, highest first", () => {
    const standings = buildStandings(
      [
        player("a", "Ala", NOW),
        player("b", "Bartek", NOW),
        player("c", "Celina", NOW),
      ],
      { a: 10, b: 30, c: 20 },
    );

    expect(standings.rows.map((row) => row.displayName)).toEqual([
      "Bartek",
      "Celina",
      "Ala",
    ]);
    expect(standings.rows.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  /**
   * THE TIEBREAK, and the fixture proves it reaches the branch: the two players hold
   * **equal points**, so `b.points - a.points` is 0 and the comparison can only be
   * settled by `joinedAt`. Asserting the order alone would pass against a sort that never
   * consulted the second key — the `rank` assertion beside it is what shows the tie was
   * real, since two rows sharing rank 1 is a state only a genuine tie produces.
   */
  it("breaks a points tie in favour of whoever joined earlier", () => {
    const standings = buildStandings(
      [player("late", "Późna", NOW + 5_000), player("early", "Wczesna", NOW)],
      { late: 50, early: 50 },
    );

    expect(standings.rows.map((row) => row.displayName)).toEqual([
      "Wczesna",
      "Późna",
    ]);
    expect(standings.rows.map((row) => row.rank)).toEqual([1, 1]);
  });

  /**
   * The residual tie: same points AND the same join millisecond, which is what two phones
   * tapping join together produce. Without the `id` key the order here is whatever the
   * players hash happened to return, and two devices could render it differently — the
   * divergence the guardrail forbids, invisible on any single screen.
   */
  it("breaks a joinedAt tie by id, so the order is total", () => {
    const forward = buildStandings(
      [player("zzz", "Zofia", NOW), player("aaa", "Adam", NOW)],
      {
        zzz: 50,
        aaa: 50,
      },
    );
    const reversed = buildStandings(
      [player("aaa", "Adam", NOW), player("zzz", "Zofia", NOW)],
      {
        zzz: 50,
        aaa: 50,
      },
    );

    expect(forward.rows.map((row) => row.displayName)).toEqual([
      "Adam",
      "Zofia",
    ]);
    // The same two players in the opposite input order produce the same board. That
    // property, not the alphabetical result, is the point of the third sort key.
    expect(reversed.rows.map((row) => row.displayName)).toEqual([
      "Adam",
      "Zofia",
    ]);
  });

  it("ranks a player with no score entry at zero rather than dropping them", () => {
    const standings = buildStandings(
      [player("a", "Ala", NOW), player("silent", "Cichy", NOW + 1_000)],
      { a: 10 },
    );

    expect(standings.rows).toHaveLength(2);
    expect(standings.rows[1]).toEqual({
      rank: 2,
      displayName: "Cichy",
      points: 0,
      delta: null,
    });
  });

  it("counts everyone who joined, not everyone on the board", () => {
    const players = Array.from({ length: 9 }, (_, index) =>
      player(`p${index}`, `Gracz ${index}`, NOW + index),
    );

    const standings = buildStandings(players, { p0: 10 });

    expect(standings.rows).toHaveLength(STANDINGS_SIZE);
    // The denominator of the attendee's "position N of M" line, and it must agree with
    // the `playerCount` on the same screens.
    expect(standings.playerCount).toBe(9);
  });

  it("returns a short board for a room smaller than the bound, without padding", () => {
    const standings = buildStandings(
      [player("a", "Ala", NOW), player("b", "Bartek", NOW + 1)],
      {
        a: 5,
        b: 3,
      },
    );

    expect(standings.rows).toHaveLength(2);
  });

  it("returns an empty board for an empty room", () => {
    const standings = buildStandings([], {});

    expect(standings).toEqual({ rows: [], playerCount: 0 });
  });

  it("produces a board that satisfies the published schema", () => {
    const players = Array.from({ length: 20 }, (_, index) =>
      player(`p${index}`, `Gracz ${index}`, NOW + index),
    );

    const standings = buildStandings(players, { p3: 100, p7: 50 });

    expect(standingsSchema.safeParse(standings).success).toBe(true);
  });

  /**
   * The bound is the retention promise — at most this many display names enter the
   * ~2-minute Ably window — so the schema refuses a longer board rather than trusting
   * every caller to slice.
   */
  it("is refused by the schema if a longer board is ever constructed by hand", () => {
    const rows = Array.from({ length: STANDINGS_SIZE + 1 }, (_, index) => ({
      rank: index + 1,
      displayName: `Gracz ${index}`,
      points: 100 - index,
    }));

    expect(standingsSchema.safeParse({ rows, playerCount: 50 }).success).toBe(
      false,
    );
  });

  it("does not put a player id on a published row", () => {
    const standings = buildStandings([player("secret-id", "Ala", NOW)], {
      "secret-id": 10,
    });

    // Not cosmetic: a row carrying an id publishes the credential the five most
    // impersonation-worthy attendees answer with. See the module note.
    expect(JSON.stringify(standings)).not.toContain("secret-id");
  });
});

/**
 * THE RANK DELTA (this change).
 *
 * Every fixture here is built player by player and states both dates explicitly, for the
 * reason the file's `player` helper carries: each of these tests turns on the *relationship*
 * between a previous total and a current one, so a shared base object would decide the
 * branch somewhere other than the test naming it.
 */
describe("buildStandings — the rank delta", () => {
  /**
   * THE SIGN, which is the one thing in this change that cannot be checked by reading the
   * output. Rank numbers shrink as a player climbs, so the subtraction that produces a
   * delta runs backwards from the intuition — inverted, this board would tell the room
   * that the player who just took the lead had fallen two places.
   *
   * The magnitudes are asserted alongside the signs deliberately: an implementation that
   * emitted ±1 for "moved" would satisfy a sign-only assertion and be wrong about Celina.
   */
  it("reports a climb as positive and a fall as negative", () => {
    const standings = buildStandings(
      [
        player("a", "Ala", NOW),
        player("b", "Bartek", NOW + 1),
        player("c", "Celina", NOW + 2),
      ],
      { a: 30, b: 20, c: 40 },
      { a: 30, b: 20, c: 10 },
    );

    // Celina came from last to first; the two she passed each slipped one place.
    expect(standings.rows.map((row) => [row.displayName, row.delta])).toEqual([
      ["Celina", 2],
      ["Ala", -1],
      ["Bartek", -1],
    ]);
  });

  /**
   * The previous rank is measured against **everyone**, not against the five rows that get
   * published — and this fixture is built to tell the two apart. Celina climbs from last of
   * six to first, which is five places; computed over the published board alone it would be
   * four, because the player she used to sit behind is off the bottom of it.
   */
  it("measures the previous rank against the whole room, not the published five", () => {
    const standings = buildStandings(
      Array.from({ length: 6 }, (_, index) =>
        player(`p${index}`, `Gracz ${index}`, NOW + index),
      ),
      { p0: 60, p1: 50, p2: 40, p3: 30, p4: 20, p5: 100 },
      { p0: 60, p1: 50, p2: 40, p3: 30, p4: 20, p5: 10 },
    );

    expect(standings.rows[0]).toMatchObject({
      displayName: "Gracz 5",
      rank: 1,
      delta: 5,
    });
  });

  /**
   * THE ZERO-BASELINE RULE, in the situation it exists for.
   *
   * Before question 1 the whole room holds nothing, and competition ranking puts every one
   * of them in a single tie at position 1. Without the rule this board reads `0, -1, -2` —
   * the first leaderboard of the session telling the room its top scorers had fallen.
   *
   * The baseline here is a real, *present* map that happens to be empty, not `null`: this
   * test must reach the zero rule rather than the no-baseline branch below it, and those two
   * produce identical output.
   */
  it("shows no movement on the first board of a session, where everyone came from zero", () => {
    const standings = buildStandings(
      [
        player("a", "Ala", NOW),
        player("b", "Bartek", NOW + 1),
        player("c", "Celina", NOW + 2),
      ],
      { a: 30, b: 20 },
      {},
    );

    expect(standings.rows.map((row) => row.delta)).toEqual([null, null, null]);
    // Proof the fixture reached the zero rule and not an empty board: three rows, ordered.
    expect(standings.rows.map((row) => row.displayName)).toEqual([
      "Ala",
      "Bartek",
      "Celina",
    ]);
  });

  /**
   * The same rule per player rather than per board: a newcomer arriving from nothing is
   * silent while the two she passed still have their falls reported. That asymmetry is the
   * rule's point — an absent past is silent, a real one is not.
   */
  it("silences only the player who came from zero, not the board around them", () => {
    const standings = buildStandings(
      [
        player("a", "Ala", NOW),
        player("b", "Bartek", NOW + 1),
        player("c", "Celina", NOW + 2),
      ],
      { a: 30, b: 20, c: 40 },
      { a: 30, b: 20 },
    );

    expect(standings.rows.map((row) => [row.displayName, row.delta])).toEqual([
      ["Celina", null],
      ["Ala", -1],
      ["Bartek", -1],
    ]);
  });

  /**
   * Tied players share a rank on both dates, so a tie cannot manufacture a move. The points
   * all change here and the positions do not — which is what separates "nobody moved" from
   * "nothing happened", and what an implementation using array positions instead of `rankOf`
   * gets wrong: it would hand Bartek a phantom climb out of a tie he never left.
   */
  it("reports no movement when a tie holds across both dates", () => {
    const standings = buildStandings(
      [
        player("a", "Ala", NOW),
        player("b", "Bartek", NOW + 1),
        player("c", "Celina", NOW + 2),
      ],
      { a: 20, b: 20, c: 30 },
      { a: 10, b: 10, c: 30 },
    );

    expect(standings.rows.map((row) => [row.displayName, row.delta])).toEqual([
      ["Celina", 0],
      ["Ala", 0],
      ["Bartek", 0],
    ]);
  });

  /**
   * No baseline is not zero movement — it is nothing to say. This is the shape `end.ts`
   * calls the read with and the shape a failed awards read degrades to, so it is the one
   * that has to stay quiet rather than confident.
   */
  it("leaves every delta null when no baseline is passed", () => {
    const standings = buildStandings(
      [player("a", "Ala", NOW), player("b", "Bartek", NOW + 1)],
      { a: 30, b: 20 },
    );

    expect(standings.rows.map((row) => row.delta)).toEqual([null, null]);
  });

  /**
   * The back-compat default, and it is load-bearing rather than tidy: a `SessionState`
   * written before this field shipped is read back and parsed after it, and a required
   * `delta` would fail that parse — which surfaces as the host's next action 409ing in the
   * middle of a segment.
   */
  it("parses a row written before the field existed, defaulting to no movement", () => {
    const parsed = standingsRowSchema.safeParse({
      rank: 1,
      displayName: "Ala",
      points: 10,
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.delta).toBe(null);
  });
});
