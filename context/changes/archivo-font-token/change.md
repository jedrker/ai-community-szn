---
change_id: archivo-font-token
title: Archivo is declared but applied to nothing — fix the theme token's namespace
status: implemented
created: 2026-08-27
updated: 2026-08-27
archived_at: null
---

## Notes

Found while researching `quiz-color-scheme`, and deliberately kept out of it: fixing this
re-metrics every measured surface at once, and that change should not ride along with a palette.

`src/styles/global.css:39` declares `--font-family-archivo`. Tailwind 4's font-family namespace is
`--font-*`, so the token generates `.font-family-archivo` — while every surface in the project asks
for `font-archivo`:

- `src/layouts/BaseLayout.astro:58`
- `src/pages/quiz/[slug].astro`, `src/pages/quiz/host/[slug].astro`
- `src/pages/quiz/host/index.astro`, `src/components/QuizNotice.astro`

Verified against a production build: no `.font-archivo` rule is emitted, and `font-family: "Archivo"`
appears only inside the two `@font-face` blocks. **Both `.woff2` files are downloaded-declared and
applied to nothing; the whole site and the whole LiveQuiz render in the platform `ui-sans-serif`
stack.**

The reason this matters beyond tidiness: every type size on the projector was measured *for Archivo*
(`context/archive/2026-08-15-livequiz-signage-redesign/plan.md:70-107`, and the in-code notes at
`host/[slug].astro` naming "56px Archivo 800" and "92px Archivo"), and `promptClass` steps down by
**character count** against those measurements. So the artboard's fit has never been tested against
the font it was designed for, and this one-line fix is what puts the two in the same room.
