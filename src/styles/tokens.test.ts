import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The stylesheet's token contract (change `archivo-font-token`).
 *
 * This file exists because of a defect that shipped and stayed invisible: `global.css` declared
 * `--font-family-archivo`, but Tailwind 4 derives a utility's name from the token's namespace, so
 * that generated `.font-family-archivo` while every surface in the project asked for
 * `font-archivo`. No rule matched. Both `.woff2` files were fetched and applied to nothing, and
 * the whole site — marketing pages and the LiveQuiz alike — rendered in the platform sans stack
 * for as long as the typo stood.
 *
 * Nothing could see it. `astro check` type-checks TypeScript, not class names; ESLint does not
 * resolve Tailwind utilities; there is no CI, no visual test, and a class that matches no rule is
 * silent by construction — the page renders, just in the wrong typeface. It was found by reading
 * the built CSS during unrelated work.
 *
 * So the guard is about the *namespace*, which is the thing that was wrong, and about the
 * round trip between a declared token and the class the source actually writes.
 */

const STYLES = fileURLToPath(new URL(".", import.meta.url));
const SRC = fileURLToPath(new URL("..", import.meta.url));
const GLOBAL_CSS = `${STYLES}global.css`;

/**
 * Tailwind's own `font-*` utilities, which name no family and need no token. Weights and the
 * two families Tailwind ships by default; anything else in `font-<name>` form is a family this
 * project is claiming, and a claim is what needs backing.
 */
const BUILT_IN_FONT_UTILITIES = new Set([
  "thin",
  "extralight",
  "light",
  "normal",
  "medium",
  "semibold",
  "bold",
  "extrabold",
  "black",
  "sans",
  "serif",
  "mono",
]);

/**
 * CSS `font-*` *property* names, which are not utilities at all.
 *
 * They appear in `@font-face` blocks, in the inline `style` strings on the two hand-built HTML
 * fallbacks, and in prose in this file's own comments — so a scan for `font-<word>` sees them and
 * would report the stylesheet against itself. Excluded by name rather than by trying to parse only
 * class attributes: a regex that pretends to know which strings are class lists across `.astro`,
 * `.ts` and `.css` is the more fragile of the two guesses.
 */
const CSS_FONT_PROPERTIES = new Set([
  "family",
  "size",
  "weight",
  "style",
  "display",
  "stretch",
  "variant",
  "feature",
  "variation",
  "kerning",
  "synthesis",
  "optical",
  "smooth",
  "smoothing",
  "face",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(`${path}/`);
    return /\.(astro|ts|tsx|css|md)$/.test(entry.name) &&
      !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

/** Every `--font-…` custom property the stylesheet declares, as the raw token name. */
function declaredFontTokens(): string[] {
  const css = readFileSync(GLOBAL_CSS, "utf8");
  return [...css.matchAll(/--font-([a-z0-9-]+)\s*:/g)].map(
    (match) => match[1]!,
  );
}

describe("the font tokens", () => {
  /**
   * The defect itself, stated as a rule. `--font-family-x` is a plausible-looking name — it reads
   * like the CSS property it feeds — and that is exactly why it survived review.
   */
  it("declares no token in the --font-family-* namespace", () => {
    const wrong = declaredFontTokens().filter((token) =>
      token.startsWith("family-"),
    );
    expect(
      wrong,
      `these tokens would generate .font-family-* utilities nothing asks for: ${wrong.join(", ")}`,
    ).toEqual([]);
  });

  it("declares at least one family token", () => {
    // Non-vacuity: with no tokens found, both directions below assert nothing and pass forever —
    // which is indistinguishable from the stylesheet having lost its @theme block.
    const families = declaredFontTokens().filter(
      (token) =>
        !BUILT_IN_FONT_UTILITIES.has(token) && !token.startsWith("family-"),
    );
    expect(
      families.length,
      "global.css declares no custom font family",
    ).toBeGreaterThan(0);
  });

  /**
   * The round trip, in the direction that matters: a page asking for a family nobody declared
   * renders in the fallback and says nothing about it. This is the assertion that would have
   * failed on the original defect, because `font-archivo` was written in five files while the
   * token generating it did not exist.
   */
  it("backs every font family the source asks for with a token", () => {
    const declared = new Set(declaredFontTokens());
    const files = sourceFiles(`${SRC}/`);
    expect(files.length, "no source files scanned").toBeGreaterThan(0);

    const missing = new Map<string, string[]>();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(
        /\bfont-([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b/g,
      )) {
        const name = match[1]!;
        // Tailwind's own utilities, then CSS property names, then anything already backed.
        if (BUILT_IN_FONT_UTILITIES.has(name)) continue;
        if (CSS_FONT_PROPERTIES.has(name.split("-")[0]!)) continue;
        if (declared.has(name)) continue;
        const where = missing.get(name) ?? [];
        where.push(file.slice(SRC.length + 1));
        missing.set(name, where);
      }
    }

    const report = [...missing.entries()].map(
      ([name, where]) => `font-${name} (${[...new Set(where)].join(", ")})`,
    );
    expect(
      report,
      `these classes name a font family global.css does not declare: ${report.join("; ")}`,
    ).toEqual([]);
  });
});
