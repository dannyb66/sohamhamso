# Operations and quality

How-to and reference for baseline `origin/main` at `4c94bf2`, inspected 2026-10-12. Workflow configuration is evidence that automation exists, not evidence that secrets are installed, schedules ran successfully, or production passed its checks.

## Credentials-free reader walkthrough

Use Bun and the committed [bun.lock](../bun.lock). Reader installation and local corpus ingestion require no cloud credentials. [package.json](../package.json) deliberately executes Astro and Vitest with Bun; plain Node cannot load the build-time `bun:sqlite` module in this baseline.

```sh
bun install --frozen-lockfile
bun run db:build
bun run dev
```

Open `http://localhost:4321`, `/trika/siva-sutras/1/1`, and `/hi/trika/siva-sutras/1/1`. Inspect the Sanskrit, translation, word sheet, chapter navigation, saved language and script preferences. Test lexical search at `/api/search?q=consciousness&type=lexical&lang=en&limit=3`. A language missing published data should be treated as a coverage issue, not silently described as available because a locale exists.

`db:build` applies schema and ingest to `db/sohamhamso.db`. The binary is an ignored build cache; YAML is the durable corpus input. `db:ensure` only checks whether the file exists, so existing files are not automatically refreshed after edits. Run `bun run ingest` for corpus changes and apply required existing-column changes through [the numbered migration runner](../pipeline/ingest/migrations.ts); schema initialization alone does not upgrade existing columns. To validate from scratch without disturbing a local file:

```sh
bun pipeline/ingest/init-db.ts --db /tmp/sohamhamso-docs-check.db
bun pipeline/ingest/ingest.ts --db /tmp/sohamhamso-docs-check.db
```

The baseline ingest CLI accepts only `--db` and `--dir`; it has no dry-run flag or positional single-file selector. Unknown arguments are ignored, so a purported `ingest --dry-run file.yaml` would execute a normal ingest. For pure single-document validation without database writes:

```sh
bun -e 'import {parseTextYaml} from "./pipeline/ingest/ingest.ts"; console.log(parseTextYaml("data/corpus/siva-sutras.yaml").id)'
```

This validates schema/FAQ references and normalizes input in memory. Expected-count and relational constraints require the isolated database ingest above. Translation/gloss shards must be merged into corpus YAML through the relevant merge tooling before ingest can consume them.

Local DB writes are reversible. Do not point validation at a production database. [INGESTION.md](INGESTION.md) retains the end-to-end content runbook; [Corpus and data platform](CORPUS-AND-DATA-PLATFORM.md) explains its contracts.

## Quality gates and what they establish

[CI](../.github/workflows/ci.yml) runs on repository changes with read-only contents permission. Its main job installs frozen dependencies, ensures a DB, typechecks, builds SEO output, checks deployment file count, verifies preflight/noindex/hreflang/phase-zero invariants, validates SEO, runs unit tests, then Playwright. A separate job ingests the corpus into `/tmp/corpus-verify.db` from scratch. A path-filtered YouTube job validates configuration and runs mocked unit/integration suites when its relevant inputs change.

```sh
bun run typecheck
bun run test
bun run seo:build
bun run seo:preflight
bun run seo:noindex-sweep
bun run seo:hreflang-closure
bun run seo:validate
bunx playwright install chromium
bun run e2e
MOCK_ALL=true bun run youtube:validate-config
MOCK_ALL=true bun run youtube:test
MOCK_ALL=true bun run youtube:integration
```

The first browser installation downloads Chromium. The remaining commands exercise local code and artifacts; mocked media checks require no provider secrets. Playwright starts `bun dev`, uses desktop and iPhone viewports, and pins both projects to Chromium. Traces on retry and HTML reports support reproduction; they are not coverage for Safari or real iPhone hardware.

Biome is **baseline-gated**, with `BIOME_BASELINE: 238`; CI rejects an increased aggregate error count, not every lint error. Its count parser assumes zero if the summary format is missing. Do not describe that as a clean lint gate. `bun run check` remains useful for inspecting findings.

Unit test entry points include [ingest reconciliation](../tests/unit/ingest-reconcile.test.ts), [migration behavior](../tests/unit/migrations.test.ts), [draft visibility](../tests/unit/draft-visibility.test.ts), [draft marker leaks](../tests/unit/no-draft-marker-leak.test.ts), [edge compatibility](../tests/unit/search-edge-compat.regression-1.test.ts), and [schema freshness](../tests/unit/schema-gen-freshness.test.ts). Browser tests cover [SSR states](../tests/e2e/verse-ssr.spec.ts), [accessibility](../tests/e2e/a11y.spec.ts), [fonts](../tests/e2e/font-loading.spec.ts), subscriptions, preference changes, and responsive reading.

## SEO and observability

[SEO-BEHAVIORS.md](SEO-BEHAVIORS.md) describes established metadata behavior. Build checks validate canonicals, JSON-LD, sitemap/hreflang closure, draft/noindex policy, fonts, redirects, and output file count. Some validators inspect only emitted HTML; SSR pages require route/unit tests and live samples as well. Build success alone cannot establish live metadata, cache headers, or remote corpus freshness.

Live operator scripts include `seo:og-sample`, `seo:cache-freshness`, and `seo:live-noindex-sweep`. These make network reads; `seo:indexnow` and `seo:ping` submit URLs to external indexing services. [Phase 8 guidance](../scripts/seo/PHASE8-README.md) covers post-launch measurement with Cloudflare analytics, Search Console, and best-effort CrUX. Missing analytics credentials can yield a manual checklist rather than a failed job; review the result payload, not only the exit status.

[CF-OBSERVABILITY-SETUP.md](CF-OBSERVABILITY-SETUP.md) retains the temporary Logpush-to-R2 setup. Setup/tail/disable scripts support dry run, but live setup and disable change cloud configuration. The baseline has application logs and workflow artifacts; it does not establish a continuously staffed alerting service, distributed tracing, SLO attainment, or a durable observability platform.

## Workflow schedule inventory

Times below are configured UTC cron times, not a record of successful execution. GitHub can delay scheduled jobs; inspect Actions results for actual run times and failure summaries.

| Workflow | Baseline trigger and responsibility |
| --- | --- |
| [Corpus/reader CI](../.github/workflows/ci.yml) | Push/PR checks; separate fresh-ingest and mocked media jobs |
| [Turso backup](../.github/workflows/turso-backup.yml) | Sunday 03:00; PII default, SQL gzip artifact retained 90 days; optional R2 |
| [Demand dashboard](../.github/workflows/demand-dashboard.yml) | Monday 06:00; aggregate search misses |
| [Short generation](../.github/workflows/youtube-generate.yml) | Every six hours at minute 23; generation/rendering |
| [Chapter generation](../.github/workflows/youtube-generate-chapters.yml) | 03:00 and 15:00; chapter backfill/render |
| [Upload](../.github/workflows/youtube-upload.yml) | Manual dispatch; the four-hour cron is commented out |
| [Lease sweep](../.github/workflows/youtube-lease-sweep.yml) | Hourly at minute 27; recover expired media leases |
| [Analytics sync](../.github/workflows/youtube-analytics-sync.yml) | Daily 05:00; synchronize video metrics |
| [Digest](../.github/workflows/youtube-digest.yml) | Daily 11:13; summarize failures/state |
| [SEO Phase 8](../.github/workflows/seo-phase8.yml) | Daily 20:00; script gates work against launch timing |
| [Temporary Logpush disable](../.github/workflows/seo-phase8-logpush-disable.yml) | June 14 04:00 recurrence plus dispatch; review before reuse |
| [IndexNow](../.github/workflows/seo-indexnow.yml) | Push to main; waits 90 seconds then submits URLs externally; does not verify deploy completion |

A calendar-specific cron expression recurs annually unless disabled; a dated launch comment is not a one-shot scheduler. Media workflows pull/push operational SQLite state with [youtube-state-db.sh](../scripts/youtube-state-db.sh), separate from rebuilding corpus inputs. See [media lifecycle documentation](AI-VIDEO-AND-YOUTUBE-PLATFORM.md) before recovering or superseding jobs.

## Configuration and side effects

| Scope | Configuration source | When required |
| --- | --- | --- |
| Local reader | Bun, local schema/YAML; optional `SOHAMHAMSO_DB_PATH` | No API credentials needed |
| Cloudflare corpus SSR | `TURSO_CORPUS_URL`, `TURSO_CORPUS_AUTH_TOKEN` | Baseline deployed verse/search/OG reads |
| Subscriber writes | `TURSO_PII_URL`, `TURSO_PII_AUTH_TOKEN`, `SUBSCRIBER_HASH_PEPPER` | Edge subscribe/confirm/unsubscribe |
| Translation/embeddings | Anthropic/OpenAI keys in pipeline documentation | Live model requests incur charges |
| TTS/render/storage/upload | [YouTube secrets module](../pipeline/youtube/secrets.ts), [.env.example](../.env.example) | Provider calls, storage changes, OAuth publishing |
| Cloud observability | [.env.example](../.env.example), Cloudflare/R2/GSC credentials | Live telemetry queries/setup |

Do not copy secrets into shell transcripts, documentation, screenshots, or commits. Local `.env` is optional for the reader. `MOCK_ALL=true` selects media mocks, while live CLI dry-run behavior is command-specific: confirm its help and [CLI conventions](../pipeline/youtube/CLI-CONVENTIONS.md). A simulation that avoids upload may still modify local manifests or query remote state.

## Failure diagnosis and recovery

| Symptom | Check and recovery |
| --- | --- |
| Build has stale corpus | Existing DB bypassed `db:ensure`; re-ingest, compare counts, validate expected references |
| Verse 503 | Read worker logs, verify CORPUS variables and remote seed; do not relabel as 404 |
| New text index exists but verse 404 | Static build and remote corpus may disagree; seed the same baseline before linking it |
| Subscribe 500 | Check pepper guard, PII credentials/table, logs; avoid printing tokens/hashes |
| Subscribe succeeds but mail never arrives | Baseline subscribe does not populate mailer's plaintext queue; success copy is not proof of delivery |
| Search empty | Inspect `meta.note`, lexical coverage, embedding configuration, and stored vector compatibility |
| Media stuck in rendering/uploading | Inspect status/events and lease timestamps; use lease sweep rather than force-changing lifecycle columns |
| Backup missing | Inspect backup workflow failure issue, account token/auth, gzip integrity, artifact retention |
| SEO live result differs from build | Inspect SSR routes, deployed revision, remote corpus, response headers and cache staleness |

[TURSO.md](TURSO.md) owns backup/restore/seeding detail. Restore into a new database, verify rows and representative routes, then cut over configuration; retaining a known-good backup is a separate responsibility from rebuilding corpus YAML. PII and media snapshots are not interchangeable with public dataset releases.

## Current limits and later work

The standalone [confirmation sender](../pipeline/email/send-confirmations.ts) has retry tracking and a scheduled handler, but needs `pending_email_plaintext` populated by a subscription flow, which the baseline does not do. Missing Resend configuration causes a no-op. This source does not establish a deployed daily sunrise sender or end-to-end opt-in delivery.

The original dirty worktree inspected 2026-10-12 adds D1/static-corpus health/parity tools, a standalone daily worker, Node target support and Docker. They are uncommitted relative to this baseline. Keep their migration instructions out of the baseline walkthrough until merged and verified; retire old workflow assumptions only after cutover evidence exists.
