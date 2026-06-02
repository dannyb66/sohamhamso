#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# turso-apply-schema.sh — apply db/schema.sql to a named Turso database.
#
# Deployment plan item #12 (Turso DB provisioning) + Option A "Code work"
# step 8 — see .gstack/launch/deployment-plan-2026-06-01.md.
#
# AUTH MODEL (important, easy to confuse):
#   This script uses the `turso` CLI, which carries its own auth context
#   (interactive `turso auth login`, or `TURSO_API_TOKEN` env in CI). It
#   does NOT consume the runtime per-DB env vars `TURSO_PII_URL` /
#   `TURSO_PII_AUTH_TOKEN` — those are for the Cloudflare Pages Function
#   talking libSQL HTTP at request time, a different auth scope.
#
# IDEMPOTENCY:
#   `db/schema.sql` uses `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF
#   NOT EXISTS` throughout, so re-running this script on an already-
#   populated DB is a no-op.
#
# USAGE:
#   scripts/turso-apply-schema.sh                       # uses default DB name
#   scripts/turso-apply-schema.sh sohamhamso-pii        # explicit DB name
#   TURSO_DB_NAME=sohamhamso-pii scripts/turso-apply-schema.sh
#   SCHEMA_FILE=db/schema.sql scripts/turso-apply-schema.sh
#
# EXIT CODES:
#   0   success
#   1   missing prerequisite (turso CLI, schema file, auth)
#   2   schema apply failed
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Inputs ────────────────────────────────────────────────────────────────────
DB_NAME="${1:-${TURSO_DB_NAME:-sohamhamso-pii}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_FILE="${SCHEMA_FILE:-$REPO_ROOT/db/schema.sql}"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if ! command -v turso >/dev/null 2>&1; then
  echo "ERROR: turso CLI not found on PATH." >&2
  echo "       Install: curl -sSfL https://get.tur.so/install.sh | bash" >&2
  exit 1
fi

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "ERROR: schema file not found: $SCHEMA_FILE" >&2
  echo "       Override with SCHEMA_FILE=/path/to/schema.sql" >&2
  exit 1
fi

# Auth sniff — `turso db list` is the cheapest authenticated call.
# In CI, this works as long as TURSO_API_TOKEN is exported.
if ! turso db list >/dev/null 2>&1; then
  echo "ERROR: turso CLI is not authenticated." >&2
  echo "       Local:  turso auth login" >&2
  echo "       CI:     export TURSO_API_TOKEN=<account-token>" >&2
  exit 1
fi

# Confirm the named DB exists. We do NOT create it here — provisioning is
# a separate, explicit step (see docs/TURSO.md). Auto-creating from an
# ops script is the kind of thing that bites you in prod.
if ! turso db list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$DB_NAME"; then
  echo "ERROR: Turso DB '$DB_NAME' does not exist in this account." >&2
  echo "       Create it first:  turso db create $DB_NAME" >&2
  echo "       Or pass an existing name:  $0 <db-name>" >&2
  exit 1
fi

# ── Apply schema ──────────────────────────────────────────────────────────────
echo "→ applying $SCHEMA_FILE to Turso DB '$DB_NAME' ..."
TABLES_BEFORE="$(turso db shell "$DB_NAME" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%';" \
  2>/dev/null | tail -n 1 | tr -d '[:space:]' || echo "0")"

# `turso db shell <name> < file.sql` streams SQL over the shell. The
# schema file is bounded by transaction discipline inside libSQL — the
# IF NOT EXISTS guards make a partial re-apply safe.
if ! turso db shell "$DB_NAME" < "$SCHEMA_FILE"; then
  echo "ERROR: schema apply failed against '$DB_NAME'." >&2
  exit 2
fi

TABLES_AFTER="$(turso db shell "$DB_NAME" \
  "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%';" \
  2>/dev/null | tail -n 1 | tr -d '[:space:]' || echo "?")"

TABLE_LIST="$(turso db shell "$DB_NAME" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name;" \
  2>/dev/null | tail -n +2 | tr '\n' ' ' || echo "?")"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "✓ schema applied successfully"
echo "  DB:           $DB_NAME"
echo "  schema file:  $SCHEMA_FILE"
echo "  tables:       $TABLES_BEFORE → $TABLES_AFTER"
echo "  table list:   $TABLE_LIST"
echo ""
echo "Re-run is safe (schema uses IF NOT EXISTS guards)."
