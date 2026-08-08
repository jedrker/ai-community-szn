import { describe, expect, it } from "vitest";

import {
  MAX_DISPLAY_NAME_LENGTH,
  MIN_DISPLAY_NAME_LENGTH,
  newPlayerId,
  parsePlayerRecord,
  validateDisplayName,
} from "./players";

/**
 * The uniqueness fold and the name bounds (roadmap S-02, PRD FR-007/FR-008).
 *
 * The equivalence-class tests below are the ones that matter. Everything else here is
 * bounds checking; the fold is what decides whether two lines on a projected
 * leaderboard can be confused for each other.
 */

function accepted(raw: string) {
  const result = validateDisplayName(raw);
  if (!result.ok) throw new Error(`expected "${raw}" to be accepted, got: ${result.error}`);
  return result;
}

function rejected(raw: string) {
  const result = validateDisplayName(raw);
  if (result.ok) throw new Error(`expected "${raw}" to be rejected`);
  return result;
}

describe("validateDisplayName — what is accepted", () => {
  it("accepts an ordinary name", () => {
    expect(accepted("Anna")).toMatchObject({ displayName: "Anna", key: "anna" });
  });

  it("accepts Polish diacritics and keeps them in the displayed form", () => {
    // The attendee sees what they typed; only the claim key is folded.
    expect(accepted("Zażółć")).toMatchObject({ displayName: "Zażółć", key: "zazolc" });
  });

  it("accepts digits and the permitted marks", () => {
    expect(accepted("dev_2026").ok).toBe(true);
    expect(accepted("O'Brien").ok).toBe(true);
    expect(accepted("Anna-Maria").ok).toBe(true);
    expect(accepted("j.kowalski").ok).toBe(true);
  });

  it("trims and collapses internal whitespace", () => {
    expect(accepted("  Jan    Kowalski  ")).toMatchObject({
      displayName: "Jan Kowalski",
      key: "jan kowalski",
    });
  });

  it("measures length after collapsing, not before", () => {
    // Twenty-four characters once collapsed; well over before. Measuring the typed
    // string would reject a name that displays perfectly well.
    const spacedOut = "A".repeat(12) + "     " + "B".repeat(11);
    expect(spacedOut.length).toBeGreaterThan(MAX_DISPLAY_NAME_LENGTH);
    expect(accepted(spacedOut).displayName).toHaveLength(MAX_DISPLAY_NAME_LENGTH);
  });
});

describe("validateDisplayName — what is refused", () => {
  it("refuses an empty or whitespace-only name", () => {
    expect(rejected("").error).toBeTruthy();
    expect(rejected("   ").error).toBeTruthy();
  });

  it("refuses a name below the minimum", () => {
    expect(rejected("A".repeat(MIN_DISPLAY_NAME_LENGTH - 1)).error).toContain(
      String(MIN_DISPLAY_NAME_LENGTH)
    );
  });

  it("refuses a name above the maximum", () => {
    expect(rejected("A".repeat(MAX_DISPLAY_NAME_LENGTH + 1)).error).toContain(
      String(MAX_DISPLAY_NAME_LENGTH)
    );
  });

  it("accepts exactly the boundary lengths", () => {
    expect(accepted("A".repeat(MIN_DISPLAY_NAME_LENGTH)).ok).toBe(true);
    expect(accepted("A".repeat(MAX_DISPLAY_NAME_LENGTH)).ok).toBe(true);
  });

  it("refuses characters outside the allowlist", () => {
    expect(rejected("<script>").error).toBeTruthy();
    expect(rejected("Anna 🎉").error).toBeTruthy();
    // Written as an escape, never as the raw character: U+200B is invisible in every
    // editor, so a formatter or a copy-paste can silently delete it and leave this
    // asserting that "AnnaAnna" is rejected — which it is not.
    expect(rejected("Anna\u200bAnna").error).toBeTruthy();
  });

  /**
   * Whitespace control characters are **collapsed, not rejected** — the `\s+` pass runs
   * before the allowlist, so a pasted name carrying a stray newline becomes a clean
   * one-line name instead of an error. Worth an explicit test because the obvious
   * reading of the allowlist says otherwise, and because it is the friendlier
   * behaviour against a thirty-second join target: cleaning beats refusing when the
   * result is unambiguous. What matters for the projector is that no newline survives
   * into the stored name, which is what this asserts.
   */
  it("collapses newlines and tabs rather than refusing them", () => {
    expect(accepted("a\nb").displayName).toBe("a b");
    expect(accepted("Jan\tKowalski").displayName).toBe("Jan Kowalski");
  });

  /**
   * Every rejection message is Polish, because the join form renders it directly to an
   * attendee who has thirty seconds to be playing.
   */
  it("explains itself in Polish", () => {
    for (const bad of ["", "A", "A".repeat(99), "<script>"]) {
      expect(validateDisplayName(bad)).toMatchObject({ ok: false });
      const { error } = rejected(bad);
      expect(error).toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|Nazwa|Podaj/);
    }
  });
});

describe("the uniqueness fold — which names are the same claim", () => {
  const sameClaim: ReadonlyArray<readonly [string, string, string]> = [
    ["case", "Anna", "anna"],
    ["upper case", "Anna", "ANNA"],
    ["diacritics", "Zażółć", "Zazolc"],
    ["surrounding space", "Anna", "  Anna  "],
    ["internal spacing", "Jan Kowalski", "Jan    Kowalski"],
  ];

  it.each(sameClaim)("folds %s to one claim: %s === %s", (_label, left, right) => {
    expect(accepted(left).key).toBe(accepted(right).key);
  });

  /**
   * The `ł` trap. Every other Polish diacritic decomposes under NFD and is stripped by
   * `\p{Diacritic}`, but `ł` is an atomic codepoint with no decomposition — the
   * idiomatic fold leaves it alone, and `Michał` / `Michal` would become two players
   * with names nobody could tell apart on a projector. `normalizePolish` maps it
   * explicitly; this test is what stops that mapping being "simplified" away.
   */
  it("folds ł, which a bare NFD pass does not", () => {
    expect(accepted("Michał").key).toBe(accepted("Michal").key);
    expect(accepted("Łódź").key).toBe(accepted("Lodz").key);
  });

  it("keeps genuinely different names apart", () => {
    expect(accepted("Anna").key).not.toBe(accepted("Hanna").key);
    expect(accepted("Jan").key).not.toBe(accepted("Jan K").key);
  });

  it("never produces an empty claim key from an accepted name", () => {
    // An empty key is a field every such attendee would silently share.
    for (const name of ["Anna", "Zażółć", "O'Brien", "..."]) {
      const result = validateDisplayName(name);
      if (result.ok) expect(result.key.length).toBeGreaterThan(0);
    }
  });
});

describe("newPlayerId", () => {
  it("mints distinct ids", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newPlayerId()));
    expect(ids.size).toBe(500);
  });

  it("carries nothing about the attendee", () => {
    // Opaque is the requirement — the id is handed to a browser and comes back.
    expect(newPlayerId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("parsePlayerRecord", () => {
  it("accepts a well-formed record", () => {
    const record = { id: "abc", displayName: "Anna", joinedAt: 1_785_000_000_000 };
    expect(parsePlayerRecord(record)).toEqual(record);
  });

  it("returns null rather than throwing on anything else", () => {
    // A record read back from the store is untrusted input, and nothing here may
    // throw into a request path (the `src/lib/slack.ts` posture).
    expect(parsePlayerRecord(null)).toBeNull();
    expect(parsePlayerRecord("not json")).toBeNull();
    expect(parsePlayerRecord({ id: "abc" })).toBeNull();
    expect(parsePlayerRecord({ id: "", displayName: "Anna", joinedAt: 1 })).toBeNull();
  });
});
