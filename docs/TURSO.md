# Turso — operational runbook

> Provision, apply schema, back up, restore, rotate. Baseline: `origin/main` at `4c94bf2`, inspected 2026-10-12. These instructions operate remote databases and secrets; they are not a credentials-free tutorial. Cloud provisioning and deployment must be verified separately.
>
> Companion docs:
> - Current boundaries: [database decision](decisions/002-database-boundaries.md) and [operations](OPERATIONS-AND-QUALITY.md)
> - Historical deployment plan: `.gstack/launch/deployment-plan-2026-06-01.md` (not an authoritative inventory of deployed resources)
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
# Install and authenticate; check provider account terms before provisioning.
brew install tursodatabase/tap/turso     # or: curl -sSfL https://get.tur.so/install.sh | bash
turso auth signup                        # browser flow
turso auth login                         # if signup left you logged out

# Provision the subscriber DB; corpus SSR also needs a seeded CORPUS DB.
# Names are examples, not evidence these resources exist.
turso db create sohamhamso-pii

# Read back the URL + per-DB token for Cloudflare Pages secrets.
turso db show --url sohamhamso-pii        # → TURSO_PII_URL
turso db tokens create sohamhamso-pii     # → TURSO_PII_AUTH_TOKEN

# Mint a CI account token (for the weekly backup GH Action).
turso auth api-tokens mint backup-ci      # → TURSO_API_TOKEN
```

Set the Cloudflare Pages PII secrets (changes remote configuration):

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

Re-running table/index creation is idempotent, but it does not add changed columns to existing tables. Review [schema migrations](../db/migrations) and [migration runner](../pipeline/ingest/migrations.ts) for an already-provisioned database. The schema file contains corpus, subscriber and media tables; applying it wholesale to a PII database does not enforce a separated schema. `SCHEMA_FILE` can select an operator-reviewed subset.

### Verify

```bash
turso db shell sohamhamso-pii "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY name;"
# Compare against db/schema.sql for the chosen schema subset;
# subscribers must exist for the PII path. The full schema also has
# chapters, lemma_index, media lifecycle, quota and migration tables.
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

Treat CORPUS, PII, and account-level CI credentials as separate scopes. Mint a replacement per-database token, update the corresponding Pages secret, redeploy, then verify representative requests. Do not print the token into logs or documentation. Revoke the old credential only after verifying the provider's supported revocation scope.

The previously documented `turso db tokens invalidate <db>` command invalidates **all** database tokens, including a newly minted replacement. It is not a selective old-token revocation step. If an all-token invalidation is needed, plan a coordinated remint/configuration cutover and verify every consumer; it can interrupt service. Check the installed CLI's help for current capabilities before executing it.

Account-level `TURSO_API_TOKEN` rotation is independent: replace the GitHub backup credential and verify a backup run before retiring the previous account token. The runtime does not consume it.

## 7. Runtime naming and corpus seeding

| Runtime | Database responsibility | Connection |
| --- | --- | --- |
| Local build/development | Corpus and local operational tables in `db/sohamhamso.db` | `bun:sqlite`; optional `SOHAMHAMSO_DB_PATH` |
| Cloudflare corpus reader/search/OG | CORPUS URL/token pair; seeded corpus/translations/glosses/embeddings | `@libsql/client/web` |
| Cloudflare subscribe/confirm/unsubscribe | PII URL/token pair; subscribers | `@libsql/client/web` |
| CI/local media jobs | Local operational SQLite, persisted separately via R2 state snapshots | [state sync script](../scripts/youtube-state-db.sh) |

Both Turso pairs may point at one DB, but that weakens physical separation. The baseline does not prove actual cloud names, topology, least-privilege tokens or subscriber scale. The corpus adapter is read-mostly: [search-miss logging](../src/lib/search-miss.ts) also creates/writes a demand table, so enforced read-only credentials would prevent that instrument.

The default weekly backup covers `sohamhamso-pii`; separately schedule or manually back up a distinct corpus database. Schema creation alone does not seed reader data. The two verse routes SSR against CORPUS at request time, so remote freshness is a reader dependency.

```sh
# Build local input first; this command writes the local DB.
bun run db:build
# Remote mutation: add one text to the configured CORPUS database.
bun scripts/turso-seed-corpus.ts --text siva-sutras
```

[Seeder implementation](../scripts/turso-seed-corpus.ts) performs content/checksum comparisons and rejects destructive replacement/deletion without `--backup-confirmed`. Take and verify a fresh backup before using `--replace` or `--delete-only`; that flag is an operator assertion, not an automatic backup. Full-database seed mode requires empty targets. Row-ID conflicts need reconciliation or a verified full restore; do not bypass the check by editing IDs blindly. Seed before deploying index pages that link to new references, and verify a known verse on the remote-backed site.

Uncommitted D1/static-corpus and Node/Docker files were inspected in the original working directory on 2026-10-12. They propose replacing this edge topology, but are absent from `4c94bf2`. This runbook remains the baseline explanation; do not retire Turso, disable backups, or route subscriber writes elsewhere based solely on a local cutover document's production assertions.
