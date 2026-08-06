import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The same guard `src/quiz/portability.test.ts` puts on the quiz definition, for
 * the same reason and with the same failure mode.
 *
 * Every module here runs inside a serverless function and under a bare
 * `vitest run`. An `astro:`-prefixed import resolves in neither: the module keeps
 * working inside a page and starts failing everywhere else with "Cannot find
 * package 'astro:content'". Reaching for `astro:env` to read a secret is the
 * likely temptation — use `import.meta.env`, as `src/lib/newsletter.ts` does.
 */

const SESSION_DIR = fileURLToPath(new URL(".", import.meta.url));
const ASTRO_IMPORT = /(?:from|import)\s*\(?\s*["']astro:[^"']*["']/;

function sourceFiles(): string[] {
  return readdirSync(SESSION_DIR).filter((name) => name.endsWith(".ts"));
}

describe("src/lib/session stays importable outside the Astro build", () => {
  it("has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())("%s does not import from an astro: specifier", (name) => {
    const source = readFileSync(join(SESSION_DIR, name), "utf8");
    const offending = source
      .split("\n")
      .map((line, index) => ({ line: line.trim(), number: index + 1 }))
      .filter(({ line }) => ASTRO_IMPORT.test(line));

    expect(
      offending,
      `src/lib/session/${name} imports from an "astro:" specifier:\n` +
        offending.map(({ line, number }) => `  line ${number}: ${line}`).join("\n") +
        "\n\nThose specifiers only resolve inside the Astro build. These modules are " +
        "imported by vitest and by serverless functions, where they fail with " +
        '"Cannot find package". Read configuration through `import.meta.env` ' +
        "instead. See CLAUDE.md."
    ).toEqual([]);
  });
});
