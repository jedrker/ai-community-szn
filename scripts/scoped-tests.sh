#!/usr/bin/env bash
# Resolve a list of changed files to the tests that cover them, and run those.
#
# One reader, two callers: the per-edit agent hook (.claude/hooks/per-edit-check.sh,
# one file, risk areas only) and lefthook's pre-commit job (all staged files).
# The resolution lives here rather than in both, because the interesting half of
# it is a trap that a second copy would eventually lose:
#
#   `vitest related` walks the module graph, and this project's highest-risk
#   files are not in it. host.test.ts and index.test.ts read their .astro pages
#   with readFileSync, so `vitest related src/pages/quiz/host.astro` prints
#   "No test files found" and exits 0 — green, on the file test-plan.md §2 puts
#   at the top of the risk map. An .astro page is therefore mapped to its
#   sibling suite by name.
#
# Usage: scripts/scoped-tests.sh <file> [<file> ...]
# Exit:  0 = nothing to run, or everything passed. Non-zero = tests failed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0

VITEST="$ROOT/node_modules/.bin/vitest"
[ -x "$VITEST" ] || exit 0

# Compact reporter output for an agent's context window (Vitest 4.1+).
export AI_AGENT=1

explicit=() # test files named directly
related=()  # sources handed to the module-graph walk

for file in "$@"; do
  [ -f "$file" ] || continue

  # Normalized before matching, because the `case` globs below anchor at the start of the
  # string: `e2e/x.spec.ts` was skipped while `./e2e/x.spec.ts` and an absolute path were
  # not, and the bypassing forms fail with the very error the skip exists to prevent — a red
  # gate on correct code. Both current callers happen to pass clean relative paths; that is
  # one caller change away from being false.
  file="${file#./}"
  file="${file#"$ROOT"/}"

  # Playwright's specs are not vitest's to run, and vitest cannot decline them
  # politely: handed one, it collects the file, Playwright's `test` object throws
  # "did not expect test.beforeEach() to be called here", and the job exits 1. So
  # staging or editing anything under e2e/ failed this gate on correct code. They
  # have their own runner (`bun run e2e`) and their own config (`testDir: ./e2e`).
  case "$file" in
    e2e/*) continue ;;
  esac

  case "$file" in
    *.test.ts | *.test.tsx)
      explicit+=("$file")
      ;;
    *.astro)
      sibling="${file%.astro}.test.ts"
      [ -f "$sibling" ] && explicit+=("$sibling")
      ;;
    *.ts | *.tsx | *.js | *.mjs)
      related+=("$file")
      ;;
  esac
done

status=0

if [ ${#explicit[@]} -gt 0 ]; then
  "$VITEST" run --dir src "${explicit[@]}" || status=1
fi

if [ ${#related[@]} -gt 0 ]; then
  "$VITEST" related "${related[@]}" --run --dir src || status=1
fi

exit "$status"
