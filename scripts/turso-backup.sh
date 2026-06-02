#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# turso-backup.sh — dump a Turso DB, gzip, optionally upload to R2/S3.
#
# Deployment plan item #14 (backup strategy) — see
# .gstack/launch/deployment-plan-2026-06-01.md. The plan says:
#   "On Hobby, run `turso db shell pii .dump > backup.sql` weekly via
#   GH Action → push to private repo or S3."
#
# This script supports BOTH paths:
#   - Default: write the dump to BACKUP_DIR (and let the caller — usually
#     the GH Action — collect it as an artifact).
#   - If R2_BUCKET or AWS_S3_BUCKET is set, additionally `aws s3 cp` the
#     dump to that bucket. R2 needs AWS_ENDPOINT_URL set to the R2
#     endpoint (and AWS_* credentials with R2 access keys).
#
# AUTH MODEL:
#   Uses the `turso` CLI; expects either an interactive `turso auth
#   login` session or `TURSO_API_TOKEN` exported (CI path). Per-DB
#   runtime env vars (TURSO_PII_URL/TURSO_PII_AUTH_TOKEN) are NOT used —
#   different auth scope.
#
# USAGE:
#   scripts/turso-backup.sh                     # backs up TURSO_DB_NAME or default
#   scripts/turso-backup.sh sohamhamso-pii      # explicit DB name
#   BACKUP_DIR=/tmp scripts/turso-backup.sh
#   R2_BUCKET=sohamhamso-backups scripts/turso-backup.sh
#
# OUTPUT:
#   $BACKUP_DIR/backup-<db-name>-<UTC-timestamp>.sql.gz
#
# EXIT CODES:
#   0   success
#   1   missing prerequisite (turso/gzip, auth)
#   2   dump failed (empty, no CREATE TABLE, or pipeline error)
#   3   upload failed
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Inputs ────────────────────────────────────────────────────────────────────
DB_NAME="${1:-${TURSO_DB_NAME:-sohamhamso-pii}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTFILE="$BACKUP_DIR/backup-${DB_NAME}-${TIMESTAMP}.sql.gz"

# ── Pre-flight checks ─────────────────────────────────────────────────────────
if ! command -v turso >/dev/null 2>&1; then
  echo "ERROR: turso CLI not found on PATH." >&2
  echo "       Install: curl -sSfL https://get.tur.so/install.sh | bash" >&2
  exit 1
fi

if ! command -v gzip >/dev/null 2>&1; then
  echo "ERROR: gzip not found on PATH." >&2
  exit 1
fi

if ! turso db list >/dev/null 2>&1; then
  echo "ERROR: turso CLI is not authenticated." >&2
  echo "       Local:  turso auth login" >&2
  echo "       CI:     export TURSO_API_TOKEN=<account-token>" >&2
  exit 1
fi

if ! turso db list 2>/dev/null | awk 'NR>1 {print $1}' | grep -qx "$DB_NAME"; then
  echo "ERROR: Turso DB '$DB_NAME' does not exist in this account." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# ── Dump → gzip in a single pipeline (no plaintext on disk) ───────────────────
#
# `set -o pipefail` (from `set -euo pipefail` above) ensures we catch a
# failure in either turso or gzip. We then sanity-check the gzipped
# artifact post-hoc to confirm the dump is real.
echo "→ dumping '$DB_NAME' → $OUTFILE ..."
if ! turso db shell "$DB_NAME" ".dump" | gzip > "$OUTFILE"; then
  echo "ERROR: dump pipeline failed for '$DB_NAME'." >&2
  rm -f "$OUTFILE"
  exit 2
fi

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [[ ! -s "$OUTFILE" ]]; then
  echo "ERROR: dump file is empty: $OUTFILE" >&2
  rm -f "$OUTFILE"
  exit 2
fi

# Stream-decompress and grep for a CREATE TABLE statement — proves the
# dump is structurally a Turso/SQLite dump and not, say, an error
# message that the shell wrote to stdout.
if ! gzip -dc "$OUTFILE" | grep -q "CREATE TABLE"; then
  echo "ERROR: dump contains no CREATE TABLE statements (possibly an error response)." >&2
  echo "       File preserved for inspection: $OUTFILE" >&2
  exit 2
fi

# Count INSERT statements across all tables — gives a rough row sanity
# number without re-running the dump.
ROW_COUNT="$(gzip -dc "$OUTFILE" | grep -c '^INSERT INTO' || true)"
SIZE_BYTES="$(wc -c < "$OUTFILE" | tr -d '[:space:]')"
SIZE_HUMAN="$(du -h "$OUTFILE" | awk '{print $1}')"

# ── Optional: upload to R2 / S3 ───────────────────────────────────────────────
UPLOAD_TARGET=""
if [[ -n "${R2_BUCKET:-}" ]]; then
  UPLOAD_TARGET="s3://${R2_BUCKET}/$(basename "$OUTFILE")"
  if ! command -v aws >/dev/null 2>&1; then
    echo "WARN: R2_BUCKET set but aws CLI not installed; skipping upload." >&2
  elif [[ -z "${AWS_ENDPOINT_URL:-}" ]]; then
    echo "WARN: R2_BUCKET set but AWS_ENDPOINT_URL not set (e.g. https://<acct>.r2.cloudflarestorage.com); skipping upload." >&2
  else
    echo "→ uploading to R2: $UPLOAD_TARGET"
    if ! aws s3 cp "$OUTFILE" "$UPLOAD_TARGET" --endpoint-url "$AWS_ENDPOINT_URL"; then
      echo "ERROR: R2 upload failed." >&2
      exit 3
    fi
  fi
elif [[ -n "${AWS_S3_BUCKET:-}" ]]; then
  UPLOAD_TARGET="s3://${AWS_S3_BUCKET}/$(basename "$OUTFILE")"
  if ! command -v aws >/dev/null 2>&1; then
    echo "WARN: AWS_S3_BUCKET set but aws CLI not installed; skipping upload." >&2
  else
    echo "→ uploading to S3: $UPLOAD_TARGET"
    if ! aws s3 cp "$OUTFILE" "$UPLOAD_TARGET"; then
      echo "ERROR: S3 upload failed." >&2
      exit 3
    fi
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "✓ backup complete"
echo "  DB:           $DB_NAME"
echo "  file:         $OUTFILE"
echo "  size:         $SIZE_HUMAN ($SIZE_BYTES bytes)"
echo "  INSERT rows:  $ROW_COUNT"
if [[ -n "$UPLOAD_TARGET" ]]; then
  echo "  uploaded:     $UPLOAD_TARGET"
else
  echo "  uploaded:     (no R2_BUCKET / AWS_S3_BUCKET set — local only)"
fi
