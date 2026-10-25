# Static corpus and D1 subscriber cutover

Production uses immutable corpus assets for reads and Cloudflare D1 only for
subscriber writes. The deployed Worker must not contain Turso credentials or a
libSQL client.

`bun run build` and `bun run seo:build` generate chapter bundles, the lemma
index and per-language full-text search indexes in `dist/_data/corpus/`, then
verify exported content counts against local SQLite. Verse HTML remains
request-rendered from those assets. Deploy the entire `dist/` directory so
the Worker and its static content always belong to the same build.

## Apply and deploy

```bash
bun run typecheck
bun run test
bun run build
bun run static:verify

bunx wrangler d1 migrations apply sohamhamso-pii --remote
bunx wrangler pages secret put SUBSCRIBER_HASH_PEPPER --project-name sohamhamso
bunx wrangler pages secret put SUBSCRIBER_EMAIL_KEY --project-name sohamhamso
bunx wrangler pages secret put RESEND_API_KEY --project-name sohamhamso
bunx wrangler pages secret put RESEND_FROM --project-name sohamhamso
bunx wrangler pages deploy dist --project-name sohamhamso --branch main
```

Migration and secret commands above configure the initial cutover. For later
deployments, apply pending migrations and preserve existing secret values;
do not generate a new email encryption key or hash pepper on every release.
The `PII_DB` binding is declared in `wrangler.toml`. No Turso secret is needed.

`SUBSCRIBER_EMAIL_KEY` must be a base64 or base64url encoding of exactly 32
random bytes. Store an offline backup; losing it makes encrypted subscriber
addresses unrecoverable.

During the initial mailer-stabilization period, the subscriber table also
retains a normalized plaintext `email` fallback alongside the HMAC and
ciphertext fields. Treat the D1 database as sensitive PII storage. Remove the
column and its writes in a later cleanup migration once confirmation and daily
delivery have passed production verification.

A separately deployed daily email Worker is outside this website release. Its scheduling and delivery require separate verification.

## Verify production

```bash
curl -fsS https://sohamhamso.org/api/health/corpus | jq
curl -fsS https://sohamhamso.org/_data/corpus/manifest.json | jq '.version'
curl -fsS 'https://sohamhamso.org/api/search?q=consciousness&lang=en&limit=1' | jq
curl -fsSI https://sohamhamso.org/og/trika/siva-sutras/1/1
curl -fsS https://sohamhamso.org/trika/spanda-karikas/1/1 >/dev/null
curl -fsS https://sohamhamso.org/hi/trika/spanda-karikas/1/1 >/dev/null
curl -fsS https://sohamhamso.org/trika/siva-sutras/1/2 >/dev/null
curl -fsS https://sohamhamso.org/trika/gitartha-samgraha/1/1 >/dev/null
```

Submit a controlled mailbox through the production subscription form. Confirm
that the email arrives, its confirmation link redirects to `/confirmed`, and
its unsubscribe link deletes the D1 row.

## Retire Turso

Before deleting anything, export the old PII database and compare counts. Old
rows contain only HMAC email hashes unless a separate historical plaintext
source exists; hashes cannot be reversed and cannot be converted into
deliverable addresses. Preserve those rows for suppression/audit or invite
users to subscribe again.

After the production checks pass:

1. Remove `TURSO_CORPUS_URL`, `TURSO_CORPUS_AUTH_TOKEN`, `TURSO_PII_URL`, and
   `TURSO_PII_AUTH_TOKEN` from Cloudflare Pages secrets.
2. Remove Turso-only backup workflows. The demand report now reads D1 aggregates.
3. Keep the final exports through the agreed retention window, then delete or
   suspend the Turso databases in the Turso dashboard.

## Rollback

Rollback is a Pages deployment rollback, not a database switch. Static corpus
assets are generated from the local SQLite source, and D1 remains the writable
subscriber store. Never restore a build that writes new subscribers to Turso
after D1 has accepted production traffic unless the D1 delta is reconciled.

## Weekly demand report

`bun scripts/demand-dashboard.ts` reads subscriber counts through the Cloudflare
D1 administrative REST API. It permits only the total subscriber count and the
count since a bound date; email fields, tokens, joins and UNION queries are not
allowed. This is an operator report, not a website data service.

Configure `CF_D1_READ_TOKEN` with Account > D1 > Read permissions. Set
`CF_ACCOUNT_ID` and `D1_PII_DATABASE_ID` (the current subscriber database ID is
listed in `wrangler.toml`). In GitHub Actions put the token in a repository
secret and the IDs in repository variables. Do not reuse a deployment token
with broader write permissions for the scheduled report. Missing credentials
produce an explicit unavailable section, as before.

`D1_DEMAND_DATABASE_ID` is optional and only reads existing sanitized
`search_misses` history. No table is created and public search logging remains
disabled. Cloudflare analytics and Search Console configuration are unchanged.

## Retirement status (2026-10-25)

Pages production and preview bindings and the separately deployed daily-verse
Worker use D1, without legacy database bindings. GitHub repository secrets contain
no Turso credentials. The old standalone confirmation sender had no deployment;
the website sends confirmations inline through its current Resend adapter.

Legacy corpus and PII read attempts returned provider `BLOCKED` errors. Their
exports and reconciliation remain unavailable, so no legacy database or
operator-local credential was deleted. Preserve them until a verified export
and reconciliation are possible. No D1 data migration is needed for this code
cleanup, and the existing daily-verse Worker and schedules are unchanged.
