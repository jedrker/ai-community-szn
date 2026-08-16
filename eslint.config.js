import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import prettier from "eslint-config-prettier";

// Flat config. Type-aware rules are deliberately NOT enabled: `astro check` is
// this project's type gate (see CLAUDE.md), and duplicating it here would make
// the per-edit hook as slow as the pre-commit one it feeds.
export default [
  {
    ignores: [
      "dist/**",
      ".astro/**",
      ".vercel/**",
      "node_modules/**",
      "public/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,
  {
    rules: {
      // The codebase uses `_`-prefixed names for deliberately unused bindings.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // `let x = <default>` followed by a reassignment inside try/catch is the
    // project's deliberate "fail toward the safe end" shape (lessons.md); the
    // rule reads the initializer as dead and it is not.
    rules: {
      "no-useless-assignment": "off",
    },
  },
  {
    // The `<script is:inline>` blocks in content pages are hand-written ES5 on
    // purpose (they run before any bundling). Rewriting them is product work,
    // not a lint gate's job.
    // The plugin lints an inline script as a virtual `<file>.astro/*.js`, so the
    // override has to name that shape — `**/*.astro` alone does not reach it.
    files: ["**/*.astro", "**/*.astro/*.js", "**/*.astro/*.ts"],
    rules: {
      "no-var": "off",
    },
  },
  {
    // A test may cast to `any` to reach a callback the production types hide;
    // `routes.test.ts` captures `applyHostAction`'s transition that way.
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
  prettier,
];
