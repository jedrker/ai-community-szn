import { expect, test } from "@playwright/test";

import { ATTENDEE_PATH, hostSecret } from "./support/host-session";

/**
 * Risk: every user-facing string in this project is Polish, and the font that renders them can
 * be missing the glyphs without anything failing.
 *
 * This is the guard for a defect that shipped at project scaffold and stayed invisible for
 * months. `global.css` declared the latin-ext subset's `unicode-range` correctly, but the file
 * committed under that name was Archivo's **vietnamese** subset — the two Google Fonts URLs
 * differ by one character (`…Sfdb…` vs `…Sfdf…`). So `ą ć ę ł ń ś ź ż` had no glyph and the
 * browser substituted a system face per character.
 *
 * Nothing could see it, twice over. While `.font-archivo` resolved to no rule at all the whole
 * site rendered in the platform stack, so the missing glyphs were hidden behind a bigger bug;
 * once that was fixed, the page still rendered — just with two typefaces mixed inside every
 * Polish word. No unit test can reach it: glyph coverage is a fact about a binary a browser
 * decodes, so it needs a browser.
 *
 * **Reads no styling and asserts nothing about how anything looks** (E2E-RULES §1). The
 * measurement is whether the *declared* family renders a character or the browser falls back —
 * a correctness fact, not an appearance one.
 *
 * **Creates no session**, so no live-room precondition and no purge: it loads one page that
 * reads only committed source.
 */

/** Every Polish diacritic, both cases. `ó`/`Ó` live in the latin subset; the rest in latin-ext. */
const POLISH_DIACRITICS = [
  "ą",
  "ć",
  "ę",
  "ł",
  "ń",
  "ó",
  "ś",
  "ź",
  "ż",
  "Ą",
  "Ć",
  "Ę",
  "Ł",
  "Ń",
  "Ó",
  "Ś",
  "Ź",
  "Ż",
] as const;

test.beforeEach(() => {
  test.skip(
    hostSecret === "",
    "LIVEQUIZ_HOST_SECRET is absent — run with `bun run e2e` so .env is loaded.",
  );
});

test("the site's own typeface has a glyph for every Polish character", async ({
  page,
}) => {
  await page.goto(ATTENDEE_PATH);

  const fallingBack = await page.evaluate(
    async (characters: readonly string[]) => {
      await document.fonts.ready;

      const probe = document.createElement("span");
      probe.style.cssText =
        "position:absolute;left:-9999px;font-size:40px;white-space:pre;";
      document.body.append(probe);

      const widthIn = (text: string, family: string) => {
        probe.style.fontFamily = family;
        probe.textContent = text;
        return probe.getBoundingClientRect().width;
      };

      /**
       * Per-glyph fallback is silent, so it is measured rather than asked about: the same
       * character is laid out once asking for the site's family with a deliberately different
       * fallback behind it, and once asking for that fallback alone. Identical advance widths
       * mean the browser used the fallback — i.e. the family had no glyph. `document.fonts.check`
       * cannot answer this; it reports whether a *face* loaded, not what is inside it.
       */
      const missing = characters.filter(
        (character) =>
          Math.abs(
            widthIn(character, "Archivo, monospace") -
              widthIn(character, "monospace"),
          ) < 0.01,
      );

      probe.remove();
      return missing;
    },
    POLISH_DIACRITICS,
  );

  expect(
    fallingBack,
    `these Polish characters have no glyph in the site's typeface and fell back to a system face: ${fallingBack.join(" ")}`,
  ).toEqual([]);
});

test("the measurement can tell a missing glyph from a present one", async ({
  page,
}) => {
  await page.goto(ATTENDEE_PATH);

  // Verifies the guard rather than the font: a character no Latin subset carries must be
  // reported as falling back. Without this, a measurement that silently stopped working would
  // report an empty `missing` list forever and read as full coverage.
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const probe = document.createElement("span");
    probe.style.cssText =
      "position:absolute;left:-9999px;font-size:40px;white-space:pre;";
    document.body.append(probe);
    const widthIn = (text: string, family: string) => {
      probe.style.fontFamily = family;
      probe.textContent = text;
      return probe.getBoundingClientRect().width;
    };
    const fellBack = (character: string) =>
      Math.abs(
        widthIn(character, "Archivo, monospace") -
          widthIn(character, "monospace"),
      ) < 0.01;
    // A CJK ideograph, which a Latin webfont subset does not carry, next to a plain `a`.
    const out = { absent: fellBack("字"), present: fellBack("a") };
    probe.remove();
    return out;
  });

  expect(
    result.absent,
    "a character outside every Latin subset was reported as present",
  ).toBe(true);
  expect(
    result.present,
    "a plain Latin character was reported as missing",
  ).toBe(false);
});
