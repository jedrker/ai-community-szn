import { expect, test } from "@playwright/test";

/**
 * Risk: every user-facing string in this project is Polish, and the font that renders them can be
 * missing the glyphs without anything failing.
 *
 * This is the guard for a defect that shipped at project scaffold and stayed invisible for months.
 * `global.css` declared the latin-ext subset's `unicode-range` correctly, but the file committed
 * under that name was Archivo's **vietnamese** subset — the two Google Fonts URLs differ by one
 * character (`…Sfdb…` vs `…Sfdf…`). So `ą ć ę ł ń ś ź ż` had no glyph and the browser substituted a
 * system face per character, inside every Polish word.
 *
 * Nothing could see it, twice over: while `.font-archivo` resolved to no rule the whole site
 * rendered in the platform stack, hiding the missing glyphs behind a bigger bug; once that was
 * fixed the page still rendered, just with two typefaces mixed. No unit test can reach it — glyph
 * coverage is a fact about a binary a browser decodes.
 *
 * **What this proves, and what it does not.** It proves the *font files* carry Polish, which is a
 * site-wide fact because one stylesheet declares them. It does not prove a given page asks for that
 * family; `src/styles/tokens.test.ts` covers that from the other side, by refusing a `font-<name>`
 * class with no declared token behind it.
 *
 * **Runs against a prerendered page on purpose.** The measurement is a `page.evaluate`, and any
 * page carrying a client module can navigate underneath it during Vite's re-optimize window — the
 * one `E2E-RULES.md` §"toBeEnabled" describes, which an interleaved `bun run build` reliably opens.
 * This spec lost to exactly that once. A prerendered route runs no module, so there is nothing to
 * race.
 *
 * **Creates no session and reads no host route**, so it needs neither the host secret nor a purge —
 * and unlike its neighbours it stays runnable while a room is live.
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

/**
 * Per-glyph fallback is silent, so it is measured rather than asked about: the same character is
 * laid out once asking for the site's family with a deliberately different fallback behind it, and
 * once asking for that fallback alone. Identical advance widths mean the browser used the fallback,
 * i.e. the family had no glyph. `document.fonts.check` cannot answer this — it reports whether a
 * *face* loaded, not what is inside it.
 */
const MEASURE = (characters: readonly string[]) => {
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

  const missing = characters.filter(fellBack);
  const control = { absent: fellBack("字"), present: fellBack("a") };
  probe.remove();
  return { missing, control };
};

const EVENTS_PATH = "/wydarzenia";

test("the site's own typeface has a glyph for every Polish character", async ({
  page,
}) => {
  await page.goto(EVENTS_PATH);
  // Anchored on rendered content rather than a load event, so the evaluate below runs against a
  // settled document.
  await expect(page.getByRole("heading", { name: "Wydarzenia" })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const { missing, control } = await page.evaluate(MEASURE, POLISH_DIACRITICS);

  // Verifies the measurement before trusting its verdict: a character no Latin subset carries must
  // read as absent, and a plain one as present. Without this, a measurement that silently stopped
  // working would report an empty `missing` list forever and read as full coverage.
  expect(
    control.absent,
    "a character outside every Latin subset was reported as present",
  ).toBe(true);
  expect(
    control.present,
    "a plain Latin character was reported as missing",
  ).toBe(false);

  expect(
    missing,
    `these Polish characters have no glyph in the site's typeface and fell back to a system face: ${missing.join(" ")}`,
  ).toEqual([]);
});
