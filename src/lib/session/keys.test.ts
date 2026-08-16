import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { registeredKeys, SESSION_KEY, SESSION_NAMESPACE } from "./keys";

/**
 * The gate that makes the retention guardrail survive slices that are not written yet
 * (roadmap F-03).
 *
 * Same shape and same reasoning as `portability.test.ts`: read the real source off
 * disk and assert a textual property, with a failure message that explains the rule
 * rather than just reporting a mismatch.
 *
 * What it defends: a key created outside `keys.ts` is invisible to both `end` (which
 * re-arms every registered key to the short lifetime) and `purge` (which deletes
 * every registered key). It would sit in the store on the 4-hour lifetime holding
 * attendee data, and nothing would ever say so.
 *
 * **Known limitation, stated rather than hidden:** this catches string *literals*. A
 * name assembled at runtime — `` `livequiz:${kind}` `` built from a variable, or
 * `"live" + "quiz:players"` — passes this gate. That is the accepted cost of a textual
 * check, and it is why `scripts/check-purge-residue.ts` (Phase 4) scans the real store
 * for residue instead of trusting this test alone. The two are complementary: this one
 * runs on every commit and catches the likely mistake; that one needs credentials and
 * catches the unlikely one.
 */

const SESSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const API_DIR = fileURLToPath(new URL("../../pages/api/quiz", import.meta.url));
/**
 * The browser modules (roadmap S-02). They hold no store key and cannot — a client
 * module may not value-import from this directory at all (`boundary.test.ts`), so a
 * namespaced name here could only be a literal someone retyped rather than imported,
 * which is exactly the escape this scan exists to catch. Added because a new directory
 * is invisible to a scan that lists its directories by hand.
 */
const CLIENT_DIR = fileURLToPath(new URL("../client", import.meta.url));
/**
 * Astro pages are scanned too, and not for completeness' sake: frontmatter runs
 * server-side and can reach the store, so a key literal there would be as real as one
 * in a `.ts` module — and would have been invisible to a `.ts`-only scan.
 */
const PAGES_DIR = fileURLToPath(new URL("../../pages/quiz", import.meta.url));

/** `keys.ts` is the registry, so it is the one file allowed to spell the prefix out. */
const REGISTRY_FILE = "keys.ts";

/**
 * Matches a string literal containing the namespace, in any of the three quote styles.
 * Built from `SESSION_NAMESPACE` rather than hardcoded so the gate cannot drift from
 * the constant it is guarding.
 */
function namespacedLiteralPattern(): RegExp {
  const escaped = SESSION_NAMESPACE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["'\`]${escaped}`);
}

export type Offender = { line: string; number: number };

/**
 * The detector, exported so the fixture case below can prove it actually fires.
 *
 * A scan that silently stopped matching — a changed prefix, a regex typo, a quote
 * style nobody thought of — would pass forever and read as compliance. That failure
 * mode is exactly what F-02's post-mortem found in the quiz gate, where a documented
 * mechanism turned out to be dead code and only surfaced when someone deliberately
 * broke an invariant.
 */
export function findNamespacedLiterals(source: string): Offender[] {
  const pattern = namespacedLiteralPattern();

  return source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => pattern.test(line));
}

/**
 * Production source only. Test files are excluded deliberately: a test that hardcodes
 * a key name creates no key in the store, and including them would make this file's
 * own fixture case self-tripping.
 */
function sourceFiles(): { label: string; path: string }[] {
  const sessionFiles = readdirSync(SESSION_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .filter((name) => name !== REGISTRY_FILE)
    .map((name) => ({
      label: `src/lib/session/${name}`,
      path: join(SESSION_DIR, name),
    }));

  const clientFiles = readdirSync(CLIENT_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({
      label: `src/lib/client/${name}`,
      path: join(CLIENT_DIR, name),
    }));

  const apiFiles = readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({
      label: `src/pages/api/quiz/${name}`,
      path: join(API_DIR, name),
    }));

  const pageFiles = readdirSync(PAGES_DIR, {
    recursive: true,
    encoding: "utf8",
  })
    .filter((name) => name.endsWith(".astro"))
    .map((name) => ({
      label: `src/pages/quiz/${name}`,
      path: join(PAGES_DIR, name),
    }));

  return [...sessionFiles, ...clientFiles, ...apiFiles, ...pageFiles];
}

describe("every namespaced name is declared in keys.ts", () => {
  it("has a non-empty registry", () => {
    // Without this, emptying the registry would turn every other assertion green by
    // vacuity — purge would delete nothing and the suite would applaud.
    expect(registeredKeys().length).toBeGreaterThan(0);
    expect(registeredKeys()).toContain(SESSION_KEY);
  });

  it("has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it("detects a namespaced literal in source that has one", () => {
    // Assembled rather than written as a literal, so this fixture does not itself
    // become the violation it is describing.
    const prefix = SESSION_NAMESPACE;
    const fixture = [
      "const fine = SESSION_KEY;",
      `const sneaky = "${prefix}players";`,
      "const alsoFine = registeredKeys();",
    ].join("\n");

    const offenders = findNamespacedLiterals(fixture);

    expect(offenders).toHaveLength(1);
    expect(offenders[0]!.number).toBe(2);
  });

  it("reports nothing for source with no namespaced literal", () => {
    expect(
      findNamespacedLiterals("const fine = SESSION_KEY;\nconst n = 1;"),
    ).toEqual([]);
  });

  it.each(sourceFiles())(
    "$label declares no namespaced literal of its own",
    ({ label, path }) => {
      const offenders = findNamespacedLiterals(readFileSync(path, "utf8"));

      expect(
        offenders,
        `${label} contains a "${SESSION_NAMESPACE}"-prefixed string literal:\n` +
          offenders
            .map(({ line, number }) => `  line ${number}: ${line}`)
            .join("\n") +
          `\n\nEvery namespaced name belongs in src/lib/session/keys.ts, because that is ` +
          `the list\n` +
          `the end and purge operations read. A key declared anywhere else survives both ` +
          `the\n` +
          `TTL re-arm and the purge, holding attendee data past the session that ` +
          `collected it —\n` +
          `which is the PRD retention guardrail F-03 exists to enforce.\n\n` +
          `Add it to REGISTERED_KEYS in keys.ts and import it from there.`,
      ).toEqual([]);
    },
  );
});
