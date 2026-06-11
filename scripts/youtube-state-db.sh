#!/usr/bin/env bash
#
# scripts/youtube-state-db.sh
#
# Sync the R2-synced youtube state DB to/from Cloudflare R2 (S3-compatible),
# matching the `aws s3 cp --endpoint-url` pattern in
# pipeline/youtube/render-engine.ts uploadR2(). AWS creds come from the
# standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env already in scope in
# the workflows.
#
# Usage: youtube-state-db.sh <pull|push>
#   pull  download remote state (tolerate first-run miss), then ensure schema
#   push  upload local state (warn + skip if the file is absent)
#
set -euo pipefail

R2_BUCKET="${R2_BUCKET:-sohamhamso-backups}"
STATE_DB="${YOUTUBE_DB_PATH:-db/youtube-state.db}"
KEY="state/youtube-state.db"
ENDPOINT="${AWS_ENDPOINT_URL:-}"

log() { echo "[youtube:state-db] $*"; }

cmd="${1:-}"
case "$cmd" in
  pull)
    log "pulling s3://$R2_BUCKET/$KEY -> $STATE_DB"
    if aws s3 cp "s3://$R2_BUCKET/$KEY" "$STATE_DB" --endpoint-url "$ENDPOINT"; then
      log "downloaded remote state"
    else
      log "no remote state yet — seeding fresh"
    fi
    log "ensuring schema via youtube-db-ensure.ts"
    bun scripts/youtube-db-ensure.ts
    ;;
  push)
    if [[ -f "$STATE_DB" ]]; then
      log "pushing $STATE_DB -> s3://$R2_BUCKET/$KEY"
      aws s3 cp "$STATE_DB" "s3://$R2_BUCKET/$KEY" --endpoint-url "$ENDPOINT"
      log "uploaded local state"
    else
      log "WARNING: $STATE_DB does not exist — nothing to push"
      exit 0
    fi
    ;;
  *)
    echo "usage: $0 <pull|push>" >&2
    exit 2
    ;;
esac
