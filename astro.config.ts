// astro.config.ts
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";
import { assertQuizValid } from "./src/quiz/index";

/**
 * THE QUIZ REGISTRY GATE — do not remove this call or the import above.
 *
 * Fails the build when a quiz in `src/quiz/definitions/` violates its schema, or
 * when the registry violates a rule that spans quizzes — a duplicate slug, a
 * duplicate join code, the same question id in two quizzes, or no quizzes at
 * all. So a malformed registry fails the Vercel deploy instead of surfacing on
 * stage (PRD FR-001). This is the project's only gate between a commit and
 * production — there is no CI.
 *
 * It runs at config load rather than from an `astro:build:start` hook: Astro
 * closes its Vite module runner before that hook fires, so a project file cannot
 * be imported there. Config load is also strictly earlier and wider — it covers
 * `astro build`, `astro dev` and `astro check` alike, and holds regardless of how
 * the platform's build command is configured. A `prebuild` script would not.
 */
assertQuizValid();

export default defineConfig({
  output: "server",
  adapter: vercel(),
  vite: {
    plugins: [tailwindcss()],
  },
});
