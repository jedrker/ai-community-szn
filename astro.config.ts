// astro.config.ts
import { defineConfig } from "astro/config";
import type { AstroIntegration } from "astro";
import tailwindcss from "@tailwindcss/vite";
import vercel from "@astrojs/vercel";
import { assertQuizValid } from "./src/quiz/index";

/**
 * Fails the build when `src/quiz/definition.ts` violates its schema, so a
 * malformed quiz fails the Vercel deploy instead of surfacing on stage
 * (PRD FR-001). This is the project's only gate between a commit and
 * production — there is no CI.
 *
 * It hooks `astro:build:start` rather than living in a `prebuild` script,
 * because that runs inside `astro build` itself and so holds regardless of what
 * invokes the build or how the platform's build command is configured. The
 * import is dynamic so the definition parses inside the hook, where a failure is
 * attributable, rather than at config-load time.
 *
 * Do not add `@astrojs/tailwind` to this array — it is installed but
 * deliberately unused; Tailwind is wired through `vite.plugins` below.
 */
const quizDefinitionGate: AstroIntegration = {
  name: "quiz-definition-gate",
  hooks: {
    "astro:build:start": () => {
      assertQuizValid();
    },
  },
};

export default defineConfig({
  output: "server",
  adapter: vercel(),
  integrations: [quizDefinitionGate],
  vite: {
    plugins: [tailwindcss()],
  },
});
