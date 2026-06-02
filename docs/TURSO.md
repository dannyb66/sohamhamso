# Turso — operational runbook

> Provision, apply schema, back up, restore, rotate. One-page; copy-pasteable.
>
> Companion docs:
> - Deployment plan: `.gstack/launch/deployment-plan-2026-06-01.md` (items #12, #14, Option A step 8)
> - Ingestion runbook: `docs/INGESTION.md`
> - Edge auth model: `.env.example` (`TURSO_PII_URL`, `TURSO_PII_AUTH_TOKEN`)

---

## Auth model — two distinct scopes

| Scope | Used by | Env var | How to mint |
|---|---|---|---|
| **Account-level CLI** | `scripts/turso-*.sh`, GH Action, you on a laptop | `TURSO_API_TOKEN` (CI) or interactive `turso auth login` (local) | `turso auth api-tokens mint backup-ci` |
| **Per-DB runtime** | Cloudflare Pages Function (libSQL HTTP) | `TURSO_PII_URL` + `TURSO_PII_AUTH_TOKEN` | `turso db tokens create <db>` |

Do not cross the streams: the CLI scripts never read the per-DB runtime token; the edge worker never reads `TURSO_API_TOKEN`.

---

## 1. First-time provisioning

```bash
# Install + sign up (free; CC required, no charge on Hobby).
brew install tursodatabase/tap/turso     # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup                        # browser flow
turso auth login                         # if signup left you logged out

# V1 launch: single PII DB (deployment plan recommends single-DB for V1;
# split corpus/vectors/pii later once subscribers > 1k).
turso db create sohamhamso-pii

# Read back the URL + per-DB token for Cloudflare Pages secrets.
turso db show --url sohamhamso-pii        # → TURSO_PII_URL
turso db tokens create sohamhamso-pii     # → TURSO_PII_AUTH_TOKEN

# Mint a CI account token (for the weekly backup GH Action).
turso auth api-tokens mint backup-ci      # → TURSO_API_TOKEN
```

Set the Cloudflare Pages secrets:

```bash
wrangler pages secret put TURSO_PII_URL --project sohamhamso
wrangler pages secret put TURSO_PII_AUTH_TOKEN --project sohamhamso
```

Set the GitHub repo secret: `TURSO_API_TOKEN` (Settings → Secrets and variables → Actions → New repository secret).

---

## 2. Apply the schema

```bash
# Default DB name (sohamhamso-pii):
bash scripts/turso-apply-schema.sh

# Explicit DB name:
bash scripts/turso-apply-schema.sh sohamhamso-pii

# Different schema file:
SCHEMA_FILE=db/schema.sql bash scripts/turso-apply-schema.sh
```

The script:
- validates `turso` CLI exists + is authenticated,
- confirms the named DB exists (does not auto-create),
- streams `db/schema.sql` through `turso db shell <db> < schema.sql`,
- prints a before/after table count + list.

Re-running is safe — `db/schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` throughout.

### Verify

```bash
turso db shell sohamhamso-pii "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name;"
# Expect: api_quota, dataset_releases, parallels, subscribers, texts,
#         translations, verse_embeddings, verses, word_glosses
```

The edge worker (`src/lib/subscriber-db.ts`) also runs an idempotent `CREATE TABLE IF NOT EXISTS subscribers` on cold-start — but pre-seeding via this script saves one round trip on the first request and surfaces schema errors at deploy time instead of at first user signup.

---

## 3. Manual backup

```bash
bash scripts/turso-backup.sh                   # → ./backups/backup-sohamhamso-pii-<UTC>.sql.gz
bash scripts/turso-backup.sh sohamhamso-pii    # explicit
BACKUP_DIR=/tmp bash scripts/turso-backup.sh   # custom dir
```

Sanity checks built in: dump must be non-empty, must contain at least one `CREATE TABLE`, and the script prints size + total `INSERT` count.

### Optional R2 upload

Set these env vars (or GH Action secrets) to upload alongside the local file:

```bash
export R2_BUCKET=sohamhamso-backups
export AWS_ACCESS_KEY_ID=...                              # R2 access key
export AWS_SECRET_ACCESS_KEY=...                          # R2 secret
export AWS_ENDPOINT_URL=https://<acct>.r2.cloudflarestorage.com
bash scripts/turso-backup.sh
```

(Plain S3 also works — set `AWS_S3_BUCKET` instead and skip `AWS_ENDPOINT_URL`.)

---

## 4. Automated weekly backup

`.github/workflows/turso-backup.yml` runs every Sunday at 03:00 UTC and on manual dispatch. Default output: a 90-day GitHub Actions artifact named `turso-backup-<db>-<run-id>`. On failure, it opens a labeled GitHub Issue (`ops`, `backup-failure`).

To download a backup: Actions tab → "Weekly Turso backup" → click a run → Artifacts.

---

## 5. Restore from a backup

```bash
gunzip backup-sohamhamso-pii-20260601T030000Z.sql.gz
# Restore into a NEW DB (never overwrite prod in-place — create + cutover):
turso db create sohamhamso-pii-restored
turso db shell sohamhamso-pii-restored < backup-sohamhamso-pii-20260601T030000Z.sql

# Verify rows landed:
turso db shell sohamhamso-pii-restored "SELECT COUNT(*) FROM subscribers;"

# If satisfied, cut the edge over by rotating the Pages secrets:
turso db show --url sohamhamso-pii-restored
turso db tokens create sohamhamso-pii-restored
wrangler pages secret put TURSO_PII_URL --project sohamhamso        # paste new URL
wrangler pages secret put TURSO_PII_AUTH_TOKEN --project sohamhamso # paste new token
# Trigger a Pages redeploy (or wait for next push) so the new env binds.
```

---

## 6. Rotate the per-DB auth token

```bash
# 1. Mint a new token first (so there's no window of zero valid tokens).
turso db tokens create sohamhamso-pii

# 2. Update the Cloudflare Pages secret and redeploy.
wrangler pages secret put TURSO_PII_AUTH_TOKEN --project sohamhamso
# Trigger redeploy: empty commit, or Pages dashboard "Retry deployment".

# 3. After confirming the new token works in prod, revoke the old one.
turso db tokens invalidate sohamhamso-pii   # invalidates ALL existing tokens
turso db tokens create sohamhamso-pii       # mint a fresh one for the edge
wrangler pages secret put TURSO_PII_AUTH_TOKEN --project sohamhamso
```

Same flow for the account-level `TURSO_API_TOKEN` used by the GH Action — `turso auth api-tokens mint` / `revoke` / update repo secret.

---

## 7. Per-environment naming

| Env | DB | Connection | Notes |
|---|---|---|---|
| **Local dev** | `db/sohamhamso.db` (bun:sqlite) | filesystem | Single SQLite file holding all tables; `subscriber-db.ts` routes here when `process.versions.bun` is defined. |
| **Production V1** | `sohamhamso-pii` (Turso, single DB) | libSQL HTTP (`@libsql/client/web`) at the edge | Deployment plan recommends single-DB at V1 scale (~334 verses, ~hundreds of subscribers). |
| **Production V2** | `sohamhamso-corpus` + `sohamhamso-vectors` + `sohamhamso-pii` | libSQL HTTP per DB | Split when subscribers > 1k or vector search QPS rises. Turso Hobby allows 500 DBs free — split is free to add later. |

When you split: add a wrapper around `scripts/turso-apply-schema.sh` that loops over the three DB names with section-filtered schema files (`db/schema-corpus.sql`, `db/schema-vectors.sql`, `db/schema-pii.sql`). The single-file schema today is already grouped + commented by target DB to make that split mechanical.
