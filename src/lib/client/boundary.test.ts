import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The gate that keeps browser code inside its own half of the project (roadmap S-02).
 *
 * Same shape and same reasoning as `keys.test.ts` and `portability.test.ts`: read the
 * real source off disk and assert a textual property, with a failure message that
 * explains the rule rather than just reporting a mismatch.
 *
 * Two failure modes, both silent, which is why they need a test rather than a comment:
 *
 * - **A value import from `src/quiz/`** ships every question's `correctOptionIds`,
 *   `acceptedAnswers` and `correctValue` to the phone being asked the question. The
 *   public projection exists precisely so the answers stay server-side; one convenient
 *   import defeats it, and the page still looks correct.
 * - **A value import from `src/lib/session/`, or any `import.meta.env` read**, pulls
 *   server-side configuration into a public bundle and drags `zod` and the Upstash and
 *   Ably server SDKs into a download budget that has to survive a venue network. The
 *   30-second join target (FR-002) is the thing that pays.
 *
 * `import type` is erased by the compiler and is therefore allowed — that is how
 * `SessionState` and `PublicQuestion` reach the client modules. Channel names, event
 * names and the storage key arrive as `define:vars` arguments instead.
 *
 * ## What is scanned, and what is deliberately not
 *
 * Every `.ts` under `src/lib/client/`, **and the `<script>` blocks of
 * `src/pages/quiz/*.astro`**. The pages matter more than the shared modules: view logic
 * lives in inline scripts, which is exactly where someone reaches for an env read, and
 * a gate covering only `src/lib/client/` would never see it. `keys.test.ts` scans the
 * same pages for the same reason.
 *
 * **Astro frontmatter is excluded.** It runs server-side and legitimately reads env and
 * imports server modules — that is how the views get the channel name to pass down. So
 * the scan takes what sits between `<script>` and `</script>`, not the whole file.
 *
 * **Known limitation, stated rather than hidden:** full-line comments are stripped
 * before scanning, so a docstring may discuss the rule (this file's own subjects
 * included). A *trailing* comment on a line of code is not stripped and can therefore
 * produce a false positive. That is the accepted cost of a textual check; move the
 * remark to its own line.
 */

const CLIENT_DIR = fileURLToPath(new URL(".", import.meta.url));
const PAGES_DIR = fileURLToPath(new URL("../../pages/quiz", import.meta.url));

/**
 * Directories a browser module may not pull a value out of, expressed as the path they
 * resolve to once the relative prefix is stripped. `session/` and `lib/session/` are
 * both listed because the depth of the importer decides which one a specifier looks
 * like: `../session/state` from `src/lib/client/`, `../../lib/session/keys` from a page.
 */
const FORBIDDEN_AREAS = [/^quiz\//, /^lib\/session\//, /^session\//];

const ENV_READ = "import.meta.env";

export type Violation = {
  readonly number: number;
  readonly line: string;
  readonly rule: "env" | "import";
};

/**
 * Blanks the Astro frontmatter, keeping character offsets intact.
 *
 * Removing it is the rule, but it is also load-bearing for the extractor below: a
 * frontmatter docstring that *mentions* a script tag — `spine-check.astro` has exactly
 * that — would otherwise open a block that swallows the whole frontmatter, and every
 * legitimate server-side env read in it would be reported as a violation.
 */
function withoutFrontmatter(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---/.exec(source);
  if (!match) return source;

  return match[0].replace(/[^\n]/g, " ") + source.slice(match[0].length);
}

/**
 * Blanks every line outside a `<script>` block, keeping line numbers intact so a
 * failure points at the real line of the `.astro` file.
 */
export function clientScriptOnly(rawSource: string): string {
  const source = withoutFrontmatter(rawSource);
  const kept = source.split("\n").map(() => "");
  const pattern = /<script\b[\s\S]*?>([\s\S]*?)<\/script>/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const body = match[1] ?? "";
    const bodyStart = match.index + match[0].length - body.length - "</script>".length;
    const startLine = source.slice(0, bodyStart).split("\n").length - 1;

    body.split("\n").forEach((line, offset) => {
      kept[startLine + offset] = line;
    });
  }

  return kept.join("\n");
}

/** Strips whole-line comments so a docstring can describe the rule it is guarded by. */
function isCommentLine(line: string): boolean {
  return line.startsWith("//") || line.startsWith("/*") || line.startsWith("*");
}

function resolvesIntoForbiddenArea(specifier: string): boolean {
  const trimmed = specifier.replace(/^(?:\.\.?\/)+/, "").replace(/^src\//, "");
  return FORBIDDEN_AREAS.some((area) => area.test(trimmed));
}

/**
 * Import specifiers on one line, with whether the import is type-only.
 *
 * Three forms are matched: `import … from "x"` / `export … from "x"`, the side-effect
 * form `import "x"`, and `import("x")`. Only `import type …` counts as erased — a mixed
 * `import { type A, B }` still brings `B` across at runtime.
 */
function importsOn(line: string): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];

  const fromForm = /\b(?:import|export)\s+([^;]*?)\s+from\s*["']([^"']+)["']/.exec(line);
  if (fromForm) {
    found.push({
      specifier: fromForm[2]!,
      typeOnly: /^type\b/.test(fromForm[1]!.trim()),
    });
  }

  const sideEffect = /\bimport\s*["']([^"']+)["']/.exec(line);
  if (sideEffect) found.push({ specifier: sideEffect[1]!, typeOnly: false });

  const dynamic = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/.exec(line);
  if (dynamic) found.push({ specifier: dynamic[1]!, typeOnly: false });

  return found;
}

/**
 * The detector, exported so the fixture cases below can prove it actually fires.
 *
 * A scan that silently stopped matching would pass forever and read as compliance —
 * the failure mode F-02's post-mortem found in the quiz gate, where a documented
 * mechanism turned out to be dead code.
 */
export function findBoundaryViolations(source: string): Violation[] {
  const violations: Violation[] = [];

  source.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    const number = index + 1;

    if (isCommentLine(line)) return;

    if (line.includes(ENV_READ)) {
      violations.push({ number, line, rule: "env" });
    }

    for (const { specifier, typeOnly } of importsOn(line)) {
      if (!typeOnly && resolvesIntoForbiddenArea(specifier)) {
        violations.push({ number, line, rule: "import" });
      }
    }
  });

  return violations;
}

function scannedFiles(): { label: string; source: string }[] {
  const clientFiles = readdirSync(CLIENT_DIR)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !name.endsWith(".test.ts"))
    .map((name) => ({
      label: `src/lib/client/${name}`,
      source: readFileSync(join(CLIENT_DIR, name), "utf8"),
    }));

  const pageFiles = readdirSync(PAGES_DIR, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".astro"))
    .map((name) => ({
      label: `src/pages/quiz/${name} (<script> blocks)`,
      source: clientScriptOnly(readFileSync(join(PAGES_DIR, name), "utf8")),
    }));

  return [...clientFiles, ...pageFiles];
}

describe("client modules stay on the client side of the boundary", () => {
  it("has files to check", () => {
    expect(scannedFiles().length).toBeGreaterThan(0);
  });

  it("detects a server-side env read", () => {
    // Assembled rather than written out, so this fixture does not become the violation
    // it describes when the scan is later widened to test files.
    const fixture = ["const fine = 1;", `const leak = import.meta${".env"}.SECRET;`].join("\n");

    const violations = findBoundaryViolations(fixture);

    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("env");
    expect(violations[0]!.number).toBe(2);
  });

  it("detects a value import from the quiz definition or the session modules", () => {
    const fixture = [
      'import type { SessionState } from "../session/state";',
      'import type { PublicQuestion } from "../../quiz/public";',
      'import { SESSION_CHANNEL } from "../session/keys";',
      'import { publicQuiz } from "../../quiz/public";',
      'import * as Ably from "ably";',
    ].join("\n");

    const violations = findBoundaryViolations(fixture);

    expect(violations.map((violation) => violation.number)).toEqual([3, 4]);
    expect(violations.every((violation) => violation.rule === "import")).toBe(true);
  });

  it("reports nothing for a clean module", () => {
    const fixture = [
      'import type { SessionState } from "../session/state";',
      'import * as Ably from "ably";',
      "export const ok = true;",
    ].join("\n");

    expect(findBoundaryViolations(fixture)).toEqual([]);
  });

  it("scans only the script blocks of an .astro file, and keeps line numbers", () => {
    const page = [
      "---",
      'import { SESSION_CHANNEL } from "../../lib/session/keys";',
      "const secret = import.meta" + ".env.LIVEQUIZ_HOST_SECRET;",
      "---",
      "<body>",
      "  <script>",
      '    const leak = import.meta' + '.env.ABLY_API_KEY;',
      "  </script>",
      "</body>",
    ].join("\n");

    const violations = findBoundaryViolations(clientScriptOnly(page));

    // The frontmatter's env read and server import are legitimate and must not fire.
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule).toBe("env");
    expect(violations[0]!.number).toBe(7);
  });

  it("is not fooled by frontmatter that mentions a script tag", () => {
    // `spine-check.astro`'s docstring does exactly this. Without the frontmatter being
    // blanked first, the mention opens a block that swallows the server-side env read
    // two lines below it, and the gate fails on a legitimate file.
    const page = [
      "---",
      "/** The plain <script> below is the client. */",
      "const secret = import.meta" + ".env.LIVEQUIZ_HOST_SECRET;",
      "---",
      "<script>",
      "  const fine = 1;",
      "</script>",
    ].join("\n");

    expect(findBoundaryViolations(clientScriptOnly(page))).toEqual([]);
  });

  it.each(scannedFiles())("$label stays inside the boundary", ({ label, source }) => {
    const violations = findBoundaryViolations(source);

    expect(
      violations,
      `${label} crosses the client boundary:\n` +
        violations
          .map(({ line, number, rule }) => `  line ${number} (${rule}): ${line}`)
          .join("\n") +
        `\n\nBrowser code may not read "${ENV_READ}", and may not *value*-import from ` +
        `src/quiz/\nor src/lib/session/. A quiz import ships every correct answer to ` +
        `the phone being\nasked the question; a session import or an env read ships ` +
        `server configuration and\npulls zod and the server SDKs into a bundle that has ` +
        `to load on a venue network.\n\n` +
        `Use \`import type\` (erased at compile time), or pass the value in from the ` +
        `page\nvia \`define:vars\` — which is how the channel name, the snapshot event ` +
        `and the\nplayer storage key already reach these modules.\n\n` +
        `Astro frontmatter is NOT scanned and never was: it runs server-side and is ` +
        `meant to\nread env and import server modules. Only what sits between ` +
        `<script> and </script> is\nchecked, so do not "fix" this by deleting a ` +
        `frontmatter import.`
    ).toEqual([]);
  });
});
