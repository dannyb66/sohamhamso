# Architecture

Sohamhamso turns one Sanskrit corpus into a multilingual reader and reusable publishing inputs. A source document carries the text identity, chapter/verse addresses, Sanskrit, glosses, translations and provenance. Build tools normalize this into SQLite; delivery and media systems consume that contract through different runtime adapters.

Evidence baseline: **2026-10-12, `4c94bf2`**. See [capability status](CAPABILITY-MATRIX.md) for developments outside this checkout and [verification](VERIFICATION-2026-10-12.md) for tests actually run.

## Components and ownership

| Component | Inputs | Outputs | Runtime and source |
|---|---|---|---|
| Corpus ingestion | Corpus YAML, schema; shard merge happens upstream | Relational rows, chapter metadata, lemma index | Bun; [ingest](../pipeline/ingest/ingest.ts), [schema](../db/schema.sql) |
| Translation | Sanskrit, database glosses, neighboring context, versioned prompts | Translation and judge provenance | Bun and Anthropic API; [runner](../pipeline/translate/runner.ts), [dispatch](../pipeline/translate/dispatch.ts) |
| Morphological audit | Corpus Sanskrit and Vidyut data | Analysis artifacts and comparison reports | Python; [runner](../pipeline/morph/runner.py), [comparison](../pipeline/morph/compare.ts) |
| Dataset publisher | Local SQLite and YAML permission flags | CSV, JSON, TEI, checksums; optional Zenodo deposit | Bun; [publisher](../pipeline/dataset/publish.ts) |
| Reader build | Local SQLite, Astro routes, fonts, SEO metadata | Static index/chrome/sitemaps and Worker bundle | Bun; [Astro config](../astro.config.mjs), [database](../src/lib/db.ts) |
| Reader requests | URL, locale, Turso corpus configuration | Verse/search HTML or JSON | Cloudflare workerd; [async corpus adapter](../src/lib/corpus-db.ts), [verse aggregate](../src/lib/verse-read.ts) |
| Subscriber requests | Email, language, region, token | HMAC identifier, confirmation/unsubscribe state | Local SQLite or Turso PII; [subscriber adapter](../src/lib/subscriber-db.ts) |
| Media worker | Eligible corpus translation and config | Narration, composition, MP4, R2 key, video event state | Bun, Chromium, FFmpeg and service APIs; [render engine](../pipeline/youtube/render-engine.ts) |
| Publishing and analytics | QA-passed rows, R2 files, OAuth | YouTube IDs, events, daily statistics | GitHub Actions/operator host; [upload](../scripts/youtube-upload.ts), [analytics](../scripts/youtube-analytics-sync.ts) |

## System flow

```text
Reviewed source selection + upstream attribution
                    |
     translation/gloss shards -> merge into corpus YAML
                    |
       Zod validation -> transactional ingest
                    |
     local SQLite corpus + operational state
        /                |                  \
Astro build         dataset export       AI/media workers
   |                     |                  |
static chrome        CSV / JSON / TEI    TTS + composition
+ OG JSON            + SHA-256              |
+ Worker bundle      optional Zenodo    FFmpeg / Remotion
   |                                        |
Cloudflare Pages                         media QA + R2
   |                                        |
SSR -> Turso CORPUS                      YouTube upload
API -> Turso PII                         analytics -> state
```

AI translations can be persisted into the local database by the runner; source-controlled YAML/shard material must be updated through the relevant merge tooling before a clean rebuild reproduces those changes. A media render consumes a translation; it does not automatically retranslate the source. Neither the reader nor the dataset needs to call a generation API to serve already ingested content.

## Runtime boundary

Astro uses `output: 'static'` with Cloudflare's adapter. This is not “all pages static”: both verse route families and search set `prerender = false`. Most corpus indexes and informational pages render at build time. [Web delivery](WEB-DELIVERY-AND-EDGE.md) provides the route map.

Bun's synchronous `bun:sqlite` is confined to build/local code through guarded lazy loading. At the edge, asynchronous `@libsql/client/web` provides HTTPS access; `nodejs_compat` in [Wrangler configuration](../wrangler.toml) enables the Node built-ins needed by subscriber cryptography. A compatibility flag does not make Chromium, FFmpeg or Bun SQLite available inside workerd. Media rendering therefore belongs on an Actions runner or operator machine, not in a request handler.

## Storage responsibilities

Local development uses one SQLite file for corpus, embedding, subscriber and media tables. This convenience does not imply identical production access policies. The edge separates `TURSO_CORPUS_*` from `TURSO_PII_*`; setting both pairs to one database is technically possible but loses the intended isolation. Corpus is read-mostly: [search-miss](../src/lib/search-miss.ts) can store sanitized miss diagnostics, so “read-only credentials” are not an established invariant.

Video scripts use `YOUTUBE_DB_PATH` for durable worker state and `SOHAMHAMSO_DB_PATH` for corpus reads. Actions download and later persist state through an R2-backed snapshot workflow. R2 also holds rendered objects; object storage is not a relational queue. SQL lifecycle/event rows coordinate eligibility, leases, retries and uploads. Inspect the [CLI handbook](../scripts/youtube/README.md) before interpreting a local empty state database as an empty production queue.

Subscriber hashes cannot deliver email. The merged handler does not populate a deliverable email address, and confirmation-sending code expects a `pending_email_plaintext` database queue column that the handler does not populate; an accepted form is not evidence of mailbox delivery. See [security](SECURITY-PROVENANCE-AND-LICENSES.md). Uncommitted D1/mail work tackles a different storage design and must be verified independently before becoming the architectural baseline.

## Tradeoffs and failure boundaries

- SSR prevents one HTML file per verse per locale from exhausting the platform's file limit; it adds a remote-database dependency and request latency. [Decision 001](decisions/001-static-versus-ssr.md) covers the evidence.
- Separate adapters preserve native local tooling and an edge-compatible web path. They require parity tests and care with import chains. [Decision 002](decisions/002-database-boundaries.md) covers isolation and the pending cutover.
- Persistent AI flags and model/prompt fields make machine-generated content inspectable after human review. They are provenance, not proof of correctness. [Decision 003](decisions/003-translation-provenance.md) describes the limits.
- Durable video states and lease recovery make interrupted workflows inspectable. They do not establish exactly-once YouTube publishing across an external API and SQL commit. [Decision 004](decisions/004-media-lifecycle-recovery.md) explains the gap.

Build failures should stop publication of a new artifact, not mutate the live service. Verse-route corpus errors return a service-unavailable response rather than a false “verse missing” result. Search errors return 500; unsubscribe logs a DB failure but still redirects, so response handling is not uniform. A rendering worker records a failure stage for retries; operators must reconcile uncertain remote uploads before retrying. Translation dispatch retries recognized transient failures with bounded concurrency, but an LLM score cannot repair incorrect upstream Sanskrit or missing lexical grounding.

## Verification and known limits

The repository supplies schema/ingestion tests, edge import regressions, SSR tests, SEO checks, and mocked media integration tests. A mock demonstrates control flow and state transitions, not voice quality, glyph shaping or successful YouTube publication. Dataset checksums test bytes, not upstream permission or scholarly correctness.

No current throughput benchmark, cost ledger, SLO attainment, user count or multi-team adoption is established here. The [career brief](STAFF-PRINCIPAL-POSITIONING.md) uses architectural evidence without substituting repository complexity for organizational impact. Read [operations](OPERATIONS-AND-QUALITY.md) for actionable checks and [evolution](EVOLUTION-FROM-PROTOTYPE.md) for the historical comparison.
