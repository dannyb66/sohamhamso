#!/usr/bin/env bash
# preflight.sh — pre-deploy verification gate.
#
# Run before `wrangler pages deploy` (or before pushing to main and letting
# Cloudflare Pages auto-deploy). Exits 0 only if all gates green AND no
# security failures. Soft warnings (TODO / FIXME / dirty tree) print but
# do NOT block.
#
# Usage:
#   bash scripts/preflight.sh
#   bun run preflight
#
# All gates mirror .github/workflows/ci.yml so green-here implies green-there.

set -u
set -o pipefail

# ---------- pretty output ----------
if [ -t 1 ]; then
  RED=$'\033[31m'; YEL=$'\033[33m'; GRN=$'\033[32m'; DIM=$'\033[2m'; BLD=$'\033[1m'; RST=$'\033[0m'
else
  RED=''; YEL=''; GRN=''; DIM=''; BLD=''; RST=''
fi

failures=0
warnings=0

step() { printf '\n%s==>%s %s%s%s\n' "$BLD" "$RST" "$BLD" "$1" "$RST"; }
pass() { printf '  %s[pass]%s %s\n' "$GRN" "$RST" "$1"; }
warn() { printf '  %s[warn]%s %s\n' "$YEL" "$RST" "$1"; warnings=$((warnings + 1)); }
fail() { printf '  %s[fail]%s %s\n' "$RED" "$RST" "$1"; failures=$((failures + 1)); }

# Resolve repo root from script location; allow running from any cwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT" || { printf '%s\n' "Cannot cd to repo root: $REPO_ROOT" >&2; exit 2; }

printf '%spreflight%s — repo: %s%s%s\n' "$BLD" "$RST" "$DIM" "$REPO_ROOT" "$RST"

# Baseline mirrors CI (.github/workflows/ci.yml::BIOME_BASELINE).
BIOME_BASELINE="${BIOME_BASELINE:-94}"

# ---------- gate 1: typecheck ----------
step "Gate 1/4: typecheck"
if bun typecheck >/tmp/preflight-typecheck.log 2>&1; then
  pass "tsc --noEmit clean"
else
  fail "typecheck failed (see /tmp/preflight-typecheck.log)"
  tail -n 30 /tmp/preflight-typecheck.log || true
fi

# ---------- gate 2: unit tests ----------
step "Gate 2/4: unit tests (vitest)"
if bun run test >/tmp/preflight-unit.log 2>&1; then
  pass "unit tests green"
else
  fail "unit tests failed (see /tmp/preflight-unit.log)"
  tail -n 30 /tmp/preflight-unit.log || true
fi

# ---------- gate 3: e2e ----------
step "Gate 3/4: e2e (playwright)"
if bun e2e >/tmp/preflight-e2e.log 2>&1; then
  pass "e2e suite green"
else
  fail "e2e failed (see /tmp/preflight-e2e.log + playwright-report/)"
  tail -n 30 /tmp/preflight-e2e.log || true
fi

# ---------- gate 4: biome (baseline-gated) ----------
step "Gate 4/4: biome (baseline $BIOME_BASELINE)"
biome_out=$(bun run check 2>&1 || true)
biome_errors=$(printf '%s\n' "$biome_out" | grep -oE 'Found [0-9]+ error' | grep -oE '[0-9]+' | tail -n1 || true)
if [ -z "${biome_errors:-}" ]; then
  biome_errors=0
fi
if [ "$biome_errors" -gt "$BIOME_BASELINE" ]; then
  fail "biome: $biome_errors errors (net-new: $((biome_errors - BIOME_BASELINE)) above baseline of $BIOME_BASELINE)"
else
  pass "biome: $biome_errors errors (within baseline of $BIOME_BASELINE)"
fi

# ---------- security 1: committed .env files ----------
step "Security 1/2: no committed .env files"
# Only flag tracked files. Untracked .env files are operator-local and fine.
env_committed=$(git ls-files | grep -E '(^|/)\.env(\..*)?$' | grep -v '\.env\.example$' || true)
if [ -n "$env_committed" ]; then
  fail "committed .env files detected:"
  printf '    %s\n' $env_committed
else
  pass "no committed .env files"
fi

# ---------- security 2: required env vars are documented ----------
step "Security 2/2: .env.example documents required vars"
REQUIRED_VARS=(SUBSCRIBER_HASH_PEPPER TURSO_PII_URL TURSO_PII_AUTH_TOKEN)
missing_doc=()
if [ ! -f .env.example ]; then
  fail ".env.example missing"
else
  for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -qE "^${var}=" .env.example; then
      missing_doc+=("$var")
    fi
  done
  if [ "${#missing_doc[@]}" -gt 0 ]; then
    fail ".env.example missing entries: ${missing_doc[*]}"
  else
    pass ".env.example documents all required vars (${REQUIRED_VARS[*]})"
  fi
fi

# ---------- gate: youtube config validation ----------
step "Gate: youtube config (zod + palette/iconography)"
if MOCK_ALL=true bun scripts/youtube-validate-config.ts >/tmp/preflight-youtube-config.log 2>&1; then
  pass "youtube-config.yaml valid (schema + forbidden-palette/iconography gates)"
else
  fail "youtube config validation failed (see /tmp/preflight-youtube-config.log)"
  tail -n 30 /tmp/preflight-youtube-config.log || true
fi

# ---------- soft warning 1: TODO/FIXME/XXX in src/lib ----------
step "Warning scan: TODO / FIXME / XXX in src/lib"
if [ -d src/lib ]; then
  todo_count=$(grep -rEn '\b(TODO|FIXME|XXX)\b' src/lib 2>/dev/null | wc -l | tr -d ' ')
  if [ "$todo_count" -gt 0 ]; then
    warn "found $todo_count TODO/FIXME/XXX comment(s) in src/lib (informational)"
    grep -rEn '\b(TODO|FIXME|XXX)\b' src/lib 2>/dev/null | head -n 10 | sed 's/^/    /'
    if [ "$todo_count" -gt 10 ]; then
      printf '    %s... (%d more)%s\n' "$DIM" "$((todo_count - 10))" "$RST"
    fi
  else
    pass "no TODO/FIXME/XXX in src/lib"
  fi
else
  warn "src/lib not found (skipping)"
fi

# ---------- soft warning 2: dirty git tree ----------
step "Warning scan: git working tree"
if [ -n "$(git status --porcelain)" ]; then
  warn "git tree is dirty — deploy would ship local uncommitted changes:"
  git status --short | sed 's/^/    /'
else
  pass "git tree clean"
fi

# ---------- summary ----------
printf '\n%s==>%s %ssummary%s\n' "$BLD" "$RST" "$BLD" "$RST"
printf '  failures: %d\n' "$failures"
printf '  warnings: %d\n' "$warnings"

if [ "$failures" -gt 0 ]; then
  printf '\n%spreflight: FAIL%s — %d gate(s) blocking deploy.\n' "$RED" "$RST" "$failures"
  exit 1
fi

printf '\n%spreflight: PASS%s — safe to deploy.\n' "$GRN" "$RST"
exit 0
