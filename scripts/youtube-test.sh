#!/usr/bin/env bash
# youtube-test.sh — reliable vitest runner for the YouTube pipeline suite.
#
# WHY THIS EXISTS:
#   The suite is mixed-runtime. Several tests import `bun:sqlite`
#   (videos-table, lease-sweep, supersede-policy, the integration flow),
#   so they MUST run on the bun runtime (`bun --bun vitest`). But a
#   bun-runtime vitest bug makes a BATCHED multi-file run
#   (`bun --bun vitest run <dir>`) exit 0 even when tests fail — a silent
#   false-green that would let CI pass on a broken suite. (Plain node-runtime
#   `vitest` reports failures correctly but cannot load `bun:sqlite`, so the
#   DB tests fail to collect there.)
#
#   Single-FILE bun-runtime runs ARE reliable (correct exit code). So this
#   wrapper runs each test file individually under bun and aggregates the
#   exit codes itself. Slower (one process per file) but correct.
#
# USAGE:
#   bash scripts/youtube-test.sh <test-dir> [extra vitest args...]
#   bash scripts/youtube-test.sh tests/unit/youtube
#   bash scripts/youtube-test.sh tests/integration/youtube --config vitest.integration.config.ts
#
# Honors MOCK_ALL from the environment (the caller sets MOCK_ALL=true for
# the zero-secret path).

set -u
set -o pipefail

DIR="${1:?usage: youtube-test.sh <test-dir> [extra vitest args...]}"
shift || true
EXTRA_ARGS=("$@")

# Resolve repo root from script location; allow running from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { printf 'Cannot cd to repo root: %s\n' "$REPO_ROOT" >&2; exit 2; }

if [ ! -d "$DIR" ]; then
  printf 'youtube-test: test dir not found: %s\n' "$DIR" >&2
  exit 2
fi

# Collect *.test.ts files (recursive), sorted for stable ordering.
# Portable read loop (macOS ships bash 3.2 — no `mapfile`).
FILES=()
while IFS= read -r line; do
  FILES+=("$line")
done < <(find "$DIR" -type f -name '*.test.ts' | sort)

if [ "${#FILES[@]}" -eq 0 ]; then
  printf 'youtube-test: no *.test.ts files under %s\n' "$DIR" >&2
  exit 2
fi

if [ -t 1 ]; then
  RED=$'\033[31m'; GRN=$'\033[32m'; BLD=$'\033[1m'; DIM=$'\033[2m'; RST=$'\033[0m'
else
  RED=''; GRN=''; BLD=''; DIM=''; RST=''
fi

printf '%syoutube-test%s — %d file(s) under %s%s%s (per-file, bun runtime)\n' \
  "$BLD" "$RST" "${#FILES[@]}" "$DIM" "$DIR" "$RST"

failures=0
failed_files=()
total_files=${#FILES[@]}

for f in "${FILES[@]}"; do
  if bun --bun vitest run "$f" ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} >/tmp/youtube-test-one.log 2>&1; then
    n=$(grep -oE '\([0-9]+ tests?\)' /tmp/youtube-test-one.log | grep -oE '[0-9]+' | head -1)
    printf '  %s[pass]%s %-52s %s test(s)\n' "$GRN" "$RST" "$(basename "$f")" "${n:-?}"
  else
    failures=$((failures + 1))
    failed_files+=("$f")
    printf '  %s[FAIL]%s %s\n' "$RED" "$RST" "$f"
    # Surface the failing assertion(s) inline.
    grep -E '×|✗|FAIL|AssertionError|Error:' /tmp/youtube-test-one.log | head -n 12 | sed 's/^/        /'
  fi
done

printf '\n%ssummary%s — %d/%d file(s) passed\n' "$BLD" "$RST" "$((total_files - failures))" "$total_files"

if [ "$failures" -gt 0 ]; then
  printf '%syoutube-test: FAIL%s — %d file(s) failed:\n' "$RED" "$RST" "$failures"
  printf '    %s\n' "${failed_files[@]}"
  exit 1
fi

printf '%syoutube-test: PASS%s\n' "$GRN" "$RST"
exit 0
