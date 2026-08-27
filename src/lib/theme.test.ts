import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getQuizById } from "../quiz/index";
import {
  contrastRatio,
  FROZEN_TOKENS,
  getThemeForQuiz,
  MIN_CONTRAST_RATIO,
  THEMEABLE_TOKENS,
  THEMED_TEXT_PAIRS,
  themedQuizSlugs,
  themeRootCss,
  type ThemeableToken,
} from "./theme";

/**
 * The guards behind the per-quiz palette (change `quiz-color-scheme`).
 *
 * Nothing else in this repository can see a colour — no CI, no visual test, no accessibility
 * check, and no `e2e/` spec that opens the themed quiz. So these assertions are the whole safety
 * net between a themed palette and a room that cannot read the screen.
 *
 * Per `src/quiz/CLAUDE.md`'s rule about tests and content, **nothing below quotes a hex value or
 * a quiz title**: every assertion iterates whatever is registered and names the offender in its
 * own failure message, so re-tuning a palette is never a test edit.
 */

const GLOBAL_CSS = fileURLToPath(
  new URL("../styles/global.css", import.meta.url),
);

/** Every `--color-quiz-*` token declared in the stylesheet, as name → hex. */
function declaredQuizTokens(): ReadonlyMap<string, string> {
  const source = readFileSync(GLOBAL_CSS, "utf8");
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(
    /--color-quiz-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g,
  )) {
    declarations.set(match[1]!, match[2]!.toLowerCase());
  }
  return declarations;
}

describe("the themeable/frozen split", () => {
  /**
   * The drift guard. Without it, a token added to `global.css` is simply unclassified — neither
   * themeable nor frozen — and the first theme to want it would add it to the themeable list with
   * nobody deciding whether it carries a message.
   */
  it("classifies every token the stylesheet declares, and no others", () => {
    const declared = new Set(declaredQuizTokens().keys());
    const classified = new Set<string>([...THEMEABLE_TOKENS, ...FROZEN_TOKENS]);

    // Non-vacuity: a regex that stopped matching would leave both sets empty and pass forever.
    expect(
      declared.size,
      "no --color-quiz-* tokens found in global.css",
    ).toBeGreaterThan(0);

    const unclassified = [...declared].filter(
      (token) => !classified.has(token),
    );
    expect(
      unclassified,
      `these tokens are declared in global.css but neither themeable nor frozen: ${unclassified.join(", ")}`,
    ).toEqual([]);

    const stale = [...classified].filter((token) => !declared.has(token));
    expect(
      stale,
      `these tokens are classified but no longer declared in global.css: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("puts no token in both lists", () => {
    const both = THEMEABLE_TOKENS.filter((token) =>
      (FROZEN_TOKENS as readonly string[]).includes(token),
    );
    expect(
      both,
      `these tokens are both themeable and frozen: ${both.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the registered themes", () => {
  it("registers at least one theme", () => {
    // Non-vacuity for every iteration below: an empty registry would pass all of them.
    expect(themedQuizSlugs().length).toBeGreaterThan(0);
  });

  /**
   * The theme registry is keyed by quiz `id` and nothing keeps the two in step at the build gate
   * — `assertQuizValid()` knows nothing about themes. One direction only: a quiz with no theme is
   * the normal case, while a theme naming a quiz that does not exist is a slug that was renamed
   * or removed, which shows up as an unthemed room rather than an error.
   */
  it("names only quizzes that exist", () => {
    for (const slug of themedQuizSlugs()) {
      expect(
        getQuizById(slug),
        `theme registered for unknown quiz "${slug}"`,
      ).toBeDefined();
    }
  });

  /**
   * The type already forbids a frozen token, but a theme could be authored through a looser path
   * — a cast, a spread, a JSON import — and this is the assertion that would still catch it. The
   * cost of missing it is the failure this whole change is arranged to prevent: a quiz where
   * "correct" or "refused" is a different colour than the host was told.
   */
  it("sets no frozen token", () => {
    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      const offending = Object.keys(theme.tokens).filter((token) =>
        (FROZEN_TOKENS as readonly string[]).includes(token),
      );
      expect(
        offending,
        `theme "${theme.name}" sets frozen token(s): ${offending.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("sets every themeable token", () => {
    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      const missing = THEMEABLE_TOKENS.filter(
        (token) => theme.tokens[token] === undefined,
      );
      expect(
        missing,
        `theme "${theme.name}" leaves themeable token(s) unset: ${missing.join(", ")}`,
      ).toEqual([]);
    }
  });

  it("renders a :root rule rather than a body-scoped one", () => {
    for (const slug of themedQuizSlugs()) {
      const css = themeRootCss(getThemeForQuiz(slug)!);
      // Both quiz pages carry the ground on <html>, so a body-scoped override would leave the
      // outermost surface at the global colour.
      expect(
        css.startsWith(":root {"),
        `theme for "${slug}" is not scoped to :root`,
      ).toBe(true);
      for (const token of THEMEABLE_TOKENS) {
        expect(
          css,
          `theme for "${slug}" omits --color-quiz-${token}`,
        ).toContain(`--color-quiz-${token}:`);
      }
      for (const token of FROZEN_TOKENS) {
        expect(
          css,
          `theme for "${slug}" re-declares frozen --color-quiz-${token}`,
        ).not.toContain(`--color-quiz-${token}:`);
      }
    }
  });

  it("has no theme for a quiz that registered none, and none for an absent slug", () => {
    expect(getThemeForQuiz(undefined)).toBeUndefined();
    // A slug shaped like a quiz id but registered nowhere.
    expect(getThemeForQuiz("a-quiz-with-no-theme")).toBeUndefined();
  });
});

describe("the evening's mark", () => {
  /**
   * A missing logo is **silent** — a broken `<img>` on a projector, in a room, with no CI and no
   * visual test to catch it. `theme.ts` cannot check this itself: it has to import inside a
   * serverless function and under a bare `vitest run`, where `node:fs` is absent or wrong. A test
   * may read the filesystem, and `src/quiz/definition.test.ts` establishes the pattern.
   *
   * Note what this does *not* buy: it gates `bun run test` and `pre-push`, not the Vercel deploy,
   * and a failed deploy here is silent. So this catches a typo before a push, never after one.
   */
  it("points every declared logo at a file that exists", () => {
    const publicDir = fileURLToPath(new URL("../../public/", import.meta.url));
    let declared = 0;

    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      if (theme.logo === undefined) {
        continue;
      }
      declared += 1;

      // A path under `public/` is served from the root, so it must be rooted to resolve at all.
      expect(
        theme.logo.startsWith("/"),
        `theme "${theme.name}" declares a logo that is not rooted: ${theme.logo}`,
      ).toBe(true);

      const onDisk = `${publicDir}${theme.logo.slice(1)}`;
      expect(
        existsSync(onDisk),
        `theme "${theme.name}" declares a logo no file answers: ${theme.logo}`,
      ).toBe(true);
    }

    // Non-vacuity: with no logo declared anywhere the loop above asserts nothing, and would keep
    // passing after a rename that dropped every path.
    expect(
      declared,
      "no theme declares a logo, so this guard proved nothing",
    ).toBeGreaterThan(0);
  });
});

describe("the display voice's scope", () => {
  /**
   * **This guards authorship, not fit, and the distinction matters.**
   *
   * What actually protects the projector is that the treatment was only applied where nothing
   * was measured against a column — recorded, with figures, in
   * `context/changes/quiz-color-scheme/`. No test in this project can measure a rendered line;
   * what a test *can* do is refuse the class inside a type constant whose size was chosen
   * against the artboard, which is how the mistake would be made.
   *
   * The constants below are the measured ones: the prompt and its character-count step-downs,
   * the answer band, the control pill, and the class strings the timer, the counters and the
   * standings are painted with.
   */
  const HOST_PAGE = fileURLToPath(
    new URL("../pages/quiz/host/[slug].astro", import.meta.url),
  );
  const DISPLAY_CLASS = "quiz-display";

  /** The constant declarations whose sizes were measured against the 1920x1080 artboard. */
  const MEASURED_CONSTANTS = [
    "PROMPT_BASE",
    "BAND_BASE",
    "SLAB_SINGLE",
    "SLAB_MULTIPLE",
    "FLOW_PILL",
  ] as const;

  function declarationOf(source: string, name: string): string {
    // From `const NAME =` to the closing `;` of its initialiser.
    const start = source.indexOf(`const ${name} =`);
    if (start < 0) return "";
    const end = source.indexOf(";", start);
    return end < 0 ? source.slice(start) : source.slice(start, end);
  }

  it("finds every measured constant it claims to check", () => {
    // Non-vacuity: a renamed constant would otherwise leave this suite asserting nothing about
    // it while still reporting green — the exact failure `lessons.md` records for scans.
    const source = readFileSync(HOST_PAGE, "utf8");
    for (const name of MEASURED_CONSTANTS) {
      expect(
        declarationOf(source, name).length,
        `${name} is no longer declared in the host page — this guard has stopped covering it`,
      ).toBeGreaterThan(0);
    }
  });

  it("keeps the display voice out of every measured type constant", () => {
    const source = readFileSync(HOST_PAGE, "utf8");
    for (const name of MEASURED_CONSTANTS) {
      expect(
        declarationOf(source, name),
        `${name} carries ${DISPLAY_CLASS}, so a measured size would render in the theme's display metrics`,
      ).not.toContain(DISPLAY_CLASS);
    }
  });

  it("emits the display rule only for a theme that declares one", () => {
    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      const css = themeRootCss(theme);
      if (theme.display === undefined) {
        expect(
          css,
          `theme "${theme.name}" declares no display voice but emits a rule`,
        ).not.toContain(`.${DISPLAY_CLASS}`);
      } else {
        expect(
          css,
          `theme "${theme.name}" declares a display voice but emits no rule`,
        ).toContain(`.${DISPLAY_CLASS} {`);
        // The width axis is the whole point; a rule without it is a weight change in disguise.
        expect(css).toContain("font-stretch:");
      }
    }
  });

  it("keeps the display rule inside the same per-request block as the palette", () => {
    // Not a separate stylesheet and not a global rule: the class must do nothing on an unthemed
    // quiz, which holds only because the whole block is absent there.
    for (const slug of themedQuizSlugs()) {
      const css = themeRootCss(getThemeForQuiz(slug)!);
      expect(css.startsWith(":root {")).toBe(true);
    }
  });
});

describe("the contrast floor", () => {
  /**
   * Sanity-check the ratio itself before trusting it on the palette: black on white is WCAG's
   * maximum of 21, and a colour against itself is 1. Without this, a broken luminance curve
   * would let every palette through.
   */
  it("computes WCAG ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#3ddc84", "#3ddc84")).toBeCloseTo(1, 5);
  });

  it("refuses a malformed colour rather than treating it as black", () => {
    // Coercing here would read as #000000 — maximum contrast against light type — so a typo
    // would make this suite pass rather than fail.
    expect(() => contrastRatio("#abc", "#ffffff")).toThrow();
    expect(() => contrastRatio("not-a-colour", "#ffffff")).toThrow();
    expect(() => contrastRatio("#12345g", "#ffffff")).toThrow();
  });

  it("holds for every type pair a theme creates", () => {
    expect(THEMED_TEXT_PAIRS.length).toBeGreaterThan(0);

    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      for (const { foreground, grounds } of THEMED_TEXT_PAIRS) {
        for (const ground of grounds) {
          const ratio = contrastRatio(
            theme.tokens[foreground],
            theme.tokens[ground],
          );
          expect(
            ratio,
            `theme "${theme.name}": ${foreground} on ${ground} is ${ratio.toFixed(2)}:1, below ${MIN_CONTRAST_RATIO}:1`,
          ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
        }
      }
    }
  });

  /**
   * The one pair a theme creates without setting both halves of it.
   *
   * The closing screen inverts to an unthemed `chrome` ground and paints its type with
   * `data-[phase=ended]:text-quiz-ink` — and `ink` *is* themeable. The leader's row does the same
   * with `first:text-quiz-ink`. So the winner's name lands in the theme's ground colour on the
   * global accent, on the one screen the whole room is looking at, and neither half of that pair
   * appears in `THEMED_TEXT_PAIRS`.
   */
  it("holds for the closing screen's themed ink on unthemed chrome", () => {
    const chrome = declaredQuizTokens().get("chrome");
    expect(chrome, "global.css declares no --color-quiz-chrome").toBeDefined();

    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      const ratio = contrastRatio(theme.tokens.ink, chrome!);
      expect(
        ratio,
        `theme "${theme.name}": ink on the closing screen's chrome is ${ratio.toFixed(2)}:1, below ${MIN_CONTRAST_RATIO}:1`,
      ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
    }
  });

  /**
   * **The floor is a rule about themes, not about the shipped signage palette.** The default
   * palette does not clear it: `pill-disabled` on asphalt measures 2.22:1, recorded as a defect
   * in the signage redesign's implementation review and deliberately out of scope here. Asserting
   * it would make this change red for somebody else's debt; asserting the *gap* keeps the fact
   * visible instead of letting a future reader assume the whole palette is clean.
   */
  it("is not yet met by the default palette, which is why it applies to themes only", () => {
    const declared = declaredQuizTokens();
    const asphalt = declared.get("asphalt");
    const pillDisabled = declared.get("pill-disabled");
    expect(asphalt).toBeDefined();
    expect(pillDisabled).toBeDefined();

    expect(contrastRatio(pillDisabled!, asphalt!)).toBeLessThan(
      MIN_CONTRAST_RATIO,
    );
  });
});

describe("the themed quizzes clear the floor the default palette misses", () => {
  /**
   * Not decoration: `pill-disabled` is the token behind the repo's only recorded contrast defect,
   * and it is in the themeable set precisely so a theme has to do better. This asserts the
   * improvement rather than assuming it.
   */
  it("lifts pill-disabled above the floor on every themed quiz", () => {
    const grounds: readonly ThemeableToken[] = ["ink", "asphalt"];
    for (const slug of themedQuizSlugs()) {
      const theme = getThemeForQuiz(slug)!;
      for (const ground of grounds) {
        expect(
          contrastRatio(theme.tokens["pill-disabled"], theme.tokens[ground]),
          `theme "${theme.name}": pill-disabled on ${ground}`,
        ).toBeGreaterThanOrEqual(MIN_CONTRAST_RATIO);
      }
    }
  });
});
