/**
 * Per-quiz signage themes (change `quiz-color-scheme`).
 *
 * **This module overturns a written decision, on purpose.** The signage redesign said: "Do
 * **not** introduce a second `@theme` block, a `:root` override on the quiz pages, or a
 * `data-theme` attribute" (`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:221`).
 * That position bought one thing — every `quiz-` class name being self-evident in a diff — and
 * it is the thing this module gives up, in exchange for an evening being able to look like
 * itself. What replaces it is the split below: the tokens that *decorate* may be re-declared per
 * quiz, and the tokens that *mean something* may not, so a diff is still self-evident about
 * every colour the room is told to read.
 *
 * **The look belongs to the evening; the quiz slug is a proxy for it.** No event record links to
 * a quiz today (`src/content.config.ts` has no quiz field, and BRAVE UnAIted has no entry at
 * all), so the slug is the only handle available at render time. If an event↔quiz link ever
 * lands, this registry is what moves — not the pages.
 *
 * **Why here rather than in `quizSchema`.** A `theme` field in `src/quiz/` would need a Polish
 * `superRefine` clause, would meet `public.test.ts`'s join-code substring scan (UnAIted's code is
 * `1990`, so `#1990ab` would fail with a message about leaking join codes), and would need the
 * public projection's allowlist widened. It buys generality nothing asks for. A quiz with no
 * theme is the normal case and costs nothing here.
 *
 * Server-side only: read from Astro frontmatter, never from a `<script>` block. It holds no
 * secrets, imports nothing, and touches no `astro:` specifier, so `vitest` can import it
 * directly.
 */

/**
 * The nine tokens a theme may set: ground, surfaces, hairlines and type. None of them carries a
 * message — remove the colour and no fact is lost.
 *
 * `zinc` is in despite two semantic uses (`VERDICT_TONES.silent` for `Bez odpowiedzi`, and
 * `CONNECTION_UNLIT`) because **both are worded**: the verdict prints its own text and the lamp
 * keeps a `role="status"` sentence. It is also the palette's most-used token, so excluding it
 * would leave a theme barely visible.
 *
 * `pill-disabled` is in and is always accompanied by the real `disabled` attribute, so its colour
 * is decoration over a fact the DOM already states. It is also the token behind the repo's only
 * recorded contrast defect (2.22:1, signage-redesign impl-review F-contrast); the floor in
 * `theme.test.ts` is what retires it.
 */
export const THEMEABLE_TOKENS = [
  "ink",
  "asphalt",
  "float",
  "signwhite",
  "zinc",
  "divider",
  "field-border",
  "echo",
  "pill-disabled",
] as const;

export type ThemeableToken = (typeof THEMEABLE_TOKENS)[number];

/**
 * The eleven a theme may not set. Each carries a fact, or is bound to a token that does:
 *
 * - `chrome` — the next legal action, the `attention`/`degraded` register, and (by being rationed
 *   everywhere else) the closing screen's ground. The runbook tells the host the screen "turns
 *   yellow" so they know the close landed **without reading anything**.
 * - `mint` / `mint-tint` — correct answer, correct verdict, `ok` register, `connected` lamp.
 * - `signal` — refused or failed. Nothing else.
 * - `slab-inactive` — at a reveal this means *not* the answer; its meaning is relational to mint.
 * - `pill-border` — also the `pending` register, the runbook's "grey — in flight — wait a beat".
 * - `chrome-tint` — "this one is mine" (a live pick, and the attendee's own standings row).
 * - `locked-tint` / `locked-slab` / `locked-letter` — my locked pick, as distinct from the
 *   correct one.
 * - `ink-on-chrome` — exists only where chrome is the ground, so it cannot move while chrome
 *   stays put.
 *
 * `theme.test.ts` asserts these two lists together cover every `--color-quiz-*` token declared in
 * `global.css`, so a token added there is a failing test rather than an unclassified colour.
 */
export const FROZEN_TOKENS = [
  "chrome",
  "mint",
  "signal",
  "slab-inactive",
  "pill-border",
  "chrome-tint",
  "mint-tint",
  "locked-tint",
  "locked-slab",
  "locked-letter",
  "ink-on-chrome",
] as const;

export type FrozenToken = (typeof FROZEN_TOKENS)[number];

/**
 * A theme sets **all nine** themeable tokens rather than a subset, deliberately. A partial theme
 * would leave the omitted tokens at their global values, which pairs a themed ground with an
 * unthemed foreground — a combination nobody authored and the contrast floor would have to guess
 * at. Requiring all nine means the effective palette *is* what the test measures.
 */
export type QuizTheme = {
  /** Names the look, for a failing test's message. Not rendered anywhere. */
  readonly name: string;
  readonly tokens: Readonly<Record<ThemeableToken, string>>;
  /**
   * The evening's mark, as a path under `public/`, or absent for a theme with no logo.
   *
   * **A plain string, never an import.** `astro:assets` is banned across `src/quiz/` and would be
   * wrong here for the same reason: this module has to load under a bare `vitest run` and inside a
   * serverless function, where an ESM asset import resolves through neither. It follows the
   * convention the events collection already uses for a partner's logo (`logo: z.string()` in
   * `src/content.config.ts`), which is also why nothing optimises it — no image in this project
   * goes through Astro's pipeline.
   *
   * Nothing validates the path at the build gate, because a gate cannot read the filesystem from
   * inside a serverless bundle. `theme.test.ts` reads `public/` instead, so a typo is a red test
   * rather than a broken `<img>` on a projector.
   */
  readonly logo?: string;
};

/**
 * BRAVE UnAIted — 1990s.
 *
 * The quiz's own docstring sets the brief: a hackathon-and-school-disco day whose party is a
 * *szkolna dyskoteka* and whose join code is a year. So: a deep indigo ground where the signage
 * system currently has near-black, lifted surfaces in violet, and type warmed towards magenta —
 * the era's colour, without touching the era-agnostic business of telling the room what is
 * correct and what was refused.
 *
 * Every pair here clears 4.5:1 against its own ground, including the one pair the closing screen
 * creates: unthemed `chrome` behind this theme's `ink`. See `theme.test.ts`.
 */
const unaitedNineties: QuizTheme = {
  name: "UnAIted 1990s",
  /**
   * The community's own mark, not a period wordmark — there is no UnAIted logo committed, and
   * inventing one here would put a brand nobody approved on a projector. Swapping it is one line
   * plus a file, and `theme.test.ts` will refuse a path that does not resolve.
   *
   * White-on-indigo: the mark ships in white, which is what this palette's ground wants.
   */
  logo: "/images/logo/BRAVE-WHITE.svg",
  tokens: {
    ink: "#140627",
    asphalt: "#1f0d38",
    float: "#2b1450",
    signwhite: "#f8f2ff",
    zinc: "#b49fd4",
    divider: "#3d1f6b",
    "field-border": "#4d2a84",
    echo: "#ded0f5",
    "pill-disabled": "#9c86c4",
  },
};

/**
 * Slug → theme. A quiz absent from here renders the global signage palette, which is the normal
 * case and the reason every surface still works with no theme at all.
 *
 * Keyed by the quiz `id`, so **renaming a quiz's `id` silently unthemes it**. The runbook already
 * forbids that rename while a session exists; `theme.test.ts` catches the stale key at test time.
 */
const THEMES_BY_QUIZ: Readonly<Record<string, QuizTheme>> = {
  unaited: unaitedNineties,
};

/** Every slug that carries a theme. For tests; pages resolve one quiz at a time. */
export function themedQuizSlugs(): readonly string[] {
  return Object.keys(THEMES_BY_QUIZ);
}

/** The theme for a quiz, or `undefined` when it has none. */
export function getThemeForQuiz(
  slug: string | undefined,
): QuizTheme | undefined {
  if (slug === undefined) {
    return undefined;
  }
  return THEMES_BY_QUIZ[slug];
}

/**
 * The theme as one `:root` rule.
 *
 * **`:root`, not `body`** — both quiz pages put the ground on `<html>`
 * (`class="bg-quiz-ink"`), so a `body`-scoped override would leave the page's outermost surface
 * at the global colour and letterbox the projector in the wrong one.
 *
 * This is the single reader of the custom-property naming: the pages render the string and never
 * spell `--color-quiz-*` themselves, so the two of them cannot drift apart. It re-declares
 * *values* rather than adding same-utility rules, which is what keeps it clear of the ordering
 * hazard the signage redesign hit (impl-review F10: reordering the token block silently flipped
 * the reveal's slabs).
 */
export function themeRootCss(theme: QuizTheme): string {
  const declarations = THEMEABLE_TOKENS.map(
    (token) => `--color-quiz-${token}: ${theme.tokens[token]};`,
  ).join(" ");
  return `:root { ${declarations} }`;
}

/**
 * Parse `#rrggbb` into channels.
 *
 * **Throws on anything malformed rather than coercing.** A silent fallback here would read as
 * `#000000`, which is the *most* contrasting value against a light foreground — so a typo would
 * make the contrast floor pass rather than fail, which is the failure direction
 * `lessons.md`'s "absent untrusted input must fail toward the safe end" warns about. Shorthand
 * (`#abc`) is refused too: accepting it would mean two spellings of one colour in the registry.
 */
function parseHex(hex: string): readonly [number, number, number] {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    throw new Error(
      `Nieprawidłowy kolor "${hex}" — motyw wymaga zapisu #rrggbb.`,
    );
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ] as const;
}

/** WCAG 2.x relative luminance of one channel. */
function channelLuminance(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928
    ? scaled / 12.92
    : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  return (
    0.2126 * channelLuminance(red) +
    0.7152 * channelLuminance(green) +
    0.0722 * channelLuminance(blue)
  );
}

/**
 * WCAG 2.x contrast ratio, 1–21. Order-independent.
 *
 * Exported because it is the only thing standing between a themed palette and an illegible
 * screen: nothing else in this repository can see a colour — no CI, no visual test, no
 * accessibility check — so this function plus its test is the whole safety net.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * The floor every themed text pair must clear.
 *
 * **One number rather than WCAG's two.** The standard would allow 3:1 for large text, and the
 * projector is nothing but large text — but the phone is not, the repo had no floor at all before
 * this, and a single stricter number needs no per-pair judgement about which size bucket a token
 * lands in. Deviations are possible but must be argued for in the test's exceptions list, which
 * starts empty.
 */
export const MIN_CONTRAST_RATIO = 4.5;

/**
 * The token pairs a theme creates, as foreground → grounds.
 *
 * `ink`, `asphalt` and `float` are the three grounds the signage system paints on; the four type
 * tokens all appear over at least one of them. Kept here rather than in the test so the pairing
 * is a statement about the palette rather than a fixture.
 */
export const THEMED_TEXT_PAIRS: readonly {
  readonly foreground: ThemeableToken;
  readonly grounds: readonly ThemeableToken[];
}[] = [
  { foreground: "signwhite", grounds: ["ink", "asphalt", "float"] },
  { foreground: "echo", grounds: ["ink", "asphalt", "float"] },
  { foreground: "zinc", grounds: ["ink", "asphalt", "float"] },
  { foreground: "pill-disabled", grounds: ["ink", "asphalt"] },
];
