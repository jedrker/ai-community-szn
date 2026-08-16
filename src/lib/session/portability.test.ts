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
 *
 * **The detector is exported and has its own fixtures**, for the reason its sibling gives:
 * before this slice, replacing `ASTRO_IMPORT` with a pattern that can never match left all
 * thirty-two tests green. A scan nobody has watched fail has been written, not verified.
 *
 * **Duplicated from the sibling rather than shared.** The two directories are the two halves
 * of the boundary `boundary.test.ts` also guards from the other side, and a common module
 * would have to live in one of them — which is the thing neither is allowed to import from.
 */

const SESSION_DIR = fileURLToPath(new URL(".", import.meta.url));
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
  return readdirSync(SESSION_DIR).filter((name) => name.endsWith(".ts"));
}

/**
 * Assembled at runtime, because `sourceFiles()` globs every `.ts` here including this file —
 * a fixture written out in full would be scanned as a violation of the rule it demonstrates.
 */
const FORBIDDEN_ENV = `${"astro"}:${"env"}`;

describe("the astro: detector fires", () => {
  it("finds an import from an astro: specifier, at its line", () => {
    const fixture = [
      'import { Redis } from "@upstash/redis";',
      "export const fine = 1;",
      `import { UPSTASH_URL } from "${FORBIDDEN_ENV}/server";`,
    ].join("\n");

    const found = findAstroImports(fixture);

    expect(found).toHaveLength(1);
    expect(found[0]!.number).toBe(3);
  });

  it("finds the dynamic and re-export forms too", () => {
    expect(
      findAstroImports(`const e = await import("${FORBIDDEN_ENV}/server");`),
    ).toHaveLength(1);
    expect(
      findAstroImports(
        `export { UPSTASH_URL } from "${FORBIDDEN_ENV}/server";`,
      ),
    ).toHaveLength(1);
  });

  /**
   * The reading this rule actually asks for: configuration comes through `import.meta.env`.
   * Asserting the compliant shape passes is what stops a later tightening from banning it.
   */
  it("reports nothing for a module reading config the sanctioned way", () => {
    const fixture = [
      'import { Redis } from "@upstash/redis";',
      "const url = import.meta.env.UPSTASH_REDIS_REST_URL;",
      "export const ok = true;",
    ].join("\n");

    expect(findAstroImports(fixture)).toEqual([]);
  });

  it("does not fire on the astro package itself", () => {
    expect(findAstroImports('import type { APIRoute } from "astro";')).toEqual(
      [],
    );
  });
});

describe("src/lib/session stays importable outside the Astro build", () => {
  it("has files to check", () => {
    expect(sourceFiles().length).toBeGreaterThan(0);
  });

  it.each(sourceFiles())(
    "%s does not import from an astro: specifier",
    (name) => {
      const source = readFileSync(join(SESSION_DIR, name), "utf8");
      const offending = findAstroImports(source);

      expect(
        offending,
        `src/lib/session/${name} imports from an "astro:" specifier:\n` +
          offending
            .map(({ line, number }) => `  line ${number}: ${line}`)
            .join("\n") +
          "\n\nThose specifiers only resolve inside the Astro build. These modules are " +
          "imported by vitest and by serverless functions, where they fail with " +
          '"Cannot find package". Read configuration through `import.meta.env` ' +
          "instead. See CLAUDE.md.",
      ).toEqual([]);
    },
  );
});
