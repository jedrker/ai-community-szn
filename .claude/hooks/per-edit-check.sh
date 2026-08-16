#!/usr/bin/env bash
# PostToolUse hook: format + lint the single file the agent just wrote.
#
# Layering (see CLAUDE.md, Module 3 Lesson 3, and context/foundation/test-plan.md §5):
#   per-edit  -> this script: prettier --write + eslint --fix on ONE file (~1s)
#   pre-commit -> lefthook.yml: eslint on staged files + full `astro check` (~8s)
# `astro check` is deliberately NOT here: it type-checks all 110 files on every
# edit, which blocks the agent loop for ~8s per Write/Edit.
#
# Exit codes: 0 = clean (or nothing to do), 2 = blocking, stdout reaches the
# agent as additionalContext so it can self-correct on the next turn.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT" || exit 0

FILE="$(jq -r '.tool_input.file_path // empty')"
[ -n "$FILE" ] || exit 0
[ -f "$FILE" ] || exit 0

case "$FILE" in
  *.ts | *.tsx | *.js | *.mjs | *.cjs | *.astro) ;;
  *) exit 0 ;;
esac

# Files outside the repo are none of this hook's business.
case "$FILE" in
  "$ROOT"/* | [!/]*) ;;
  *) exit 0 ;;
esac

PRETTIER="$ROOT/node_modules/.bin/prettier"
ESLINT="$ROOT/node_modules/.bin/eslint"
[ -x "$PRETTIER" ] || exit 0

# Formatting is auto-applied and never blocks — a reformat is not a defect.
"$PRETTIER" --write --ignore-unknown --log-level warn "$FILE" >/dev/null 2>&1

# --fix first, so the agent only hears about what it actually has to decide.
OUTPUT="$("$ESLINT" --fix --format stylish "$FILE" 2>&1)"
STATUS=$?

if [ "$STATUS" -ne 0 ]; then
  echo "ESLint failed on ${FILE#"$ROOT"/} (auto-fixable problems were already applied):"
  echo ""
  # Cap the payload: additionalContext is truncated at 10,000 characters.
  echo "$OUTPUT" | head -c 8000
  exit 2
fi

exit 0
