import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards the decision that put the quiz in `src/quiz/` as plain TypeScript
 * rather than in an Astro content collection.
 *
 * The case for that format is that a plain import behaves the same in a
 * serverless function and in a bare `vitest run`. An `astro:`-prefixed import
 * breaks it silently: the module keeps working inside a page, and starts
 * failing everywhere else with "Cannot find package 'astro:content'".
 */

const QUIZ_DIR = fileURLToPath(new URL(".", import.meta.url));
const ASTRO_IMPORT = /(?:from|import)\s*\(?\s*["']astro:[^"']*["']/;

function sourceFiles(): string[] {
  return readdirSync(QUIZ_DIR).filter((name) => name.endsWith(".ts"));
}

describe("src/quiz stays importable outside the Astro build", () => {
  it("has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())("%s does not import from an astro: specifier", (name) => {
    const source = readFileSync(join(QUIZ_DIR, name), "utf8");
    const offending = source
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => ASTRO_IMPORT.test(line));

    expect(
      offending,
      `src/quiz/${name} imports from an "astro:" specifier:\n` +
        offending.map(({ line, number }) => `  line ${number}: ${line}`).join("\n") +
        "\n\nThose specifiers only resolve inside the Astro build. This module is " +
        "imported by vitest and by serverless functions, where they fail with " +
        '"Cannot find package". Import the underlying package directly instead ' +
        "(e.g. `zod`, not `astro:content`). See CLAUDE.md."
    ).toEqual([]);
  });
});
