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
 *
 * **The detector is exported and has its own fixtures, because until this slice it had
 * never been shown to fire.** A scan whose pattern stops matching passes forever and reads
 * as compliance — and this one was demonstrably in that state: replacing `ASTRO_IMPORT`
 * with a regex that can never match left all twelve tests green. That is the same failure
 * `boundary.test.ts:145-150` and `keys.test.ts` each carry a fixture against, and the same
 * one F-02's post-mortem found in this project's other build gate.
 */

const QUIZ_DIR = fileURLToPath(new URL(".", import.meta.url));
const ASTRO_IMPORT = /(?:from|import)\s*\(?\s*["']astro:[^"']*["']/;

export type AstroImport = {
  readonly number: number;
  readonly line: string;
};

/** The detector, exported so the fixtures below can prove it actually fires. */
export function findAstroImports(source: string): AstroImport[] {
  return source
    .split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => ASTRO_IMPORT.test(line));
}

function sourceFiles(): string[] {
  return readdirSync(QUIZ_DIR).filter((name) => name.endsWith(".ts"));
}

/**
 * The forbidden specifier, assembled at runtime.
 *
 * **`sourceFiles()` globs every `.ts` in this directory, including this file**, so a fixture
 * written out in full would be scanned as a violation of the very rule it demonstrates — the
 * suite would fail on `portability.test.ts` itself and the obvious "fix" would be to delete
 * the fixture. `boundary.test.ts:197-198` records the same trap for the same reason.
 */
const FORBIDDEN = `${"astro"}:${"content"}`;

describe("the astro: detector fires", () => {
  it("finds an import from an astro: specifier, at its line", () => {
    const fixture = [
      "import { z } from 'zod';",
      "export const fine = 1;",
      `import { getEntry } from "${FORBIDDEN}";`,
    ].join("\n");

    const found = findAstroImports(fixture);

    expect(found).toHaveLength(1);
    expect(found[0]!.number).toBe(3);
  });

  it("finds the dynamic and re-export forms too", () => {
    const dynamic = `const c = await import("${FORBIDDEN}");`;
    const reexport = `export { getEntry } from "${FORBIDDEN}";`;

    expect(findAstroImports(dynamic)).toHaveLength(1);
    expect(findAstroImports(reexport)).toHaveLength(1);
  });

  it("reports nothing for a module that imports its packages directly", () => {
    const fixture = [
      'import { z } from "zod";',
      'import { quiz } from "./definition";',
      "export const ok = true;",
    ].join("\n");

    expect(findAstroImports(fixture)).toEqual([]);
  });

  /**
   * A near miss that must **not** trip it: `astro` the package is a legitimate import in the
   * config and in types, and only the `astro:` *virtual* specifiers fail outside the build.
   * Without this, tightening the pattern later has nothing telling it where the line is.
   */
  it("does not fire on the astro package itself", () => {
    expect(findAstroImports('import type { APIRoute } from "astro";')).toEqual(
      [],
    );
  });
});

describe("src/quiz stays importable outside the Astro build", () => {
  it("has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())(
    "%s does not import from an astro: specifier",
    (name) => {
      const source = readFileSync(join(QUIZ_DIR, name), "utf8");
      const offending = findAstroImports(source);

      expect(
        offending,
        `src/quiz/${name} imports from an "astro:" specifier:\n` +
          offending
            .map(({ line, number }) => `  line ${number}: ${line}`)
            .join("\n") +
          "\n\nThose specifiers only resolve inside the Astro build. This module is " +
          "imported by vitest and by serverless functions, where they fail with " +
          '"Cannot find package". Import the underlying package directly instead ' +
          "(e.g. `zod`, not `astro:content`). See CLAUDE.md.",
      ).toEqual([]);
    },
  );
});
