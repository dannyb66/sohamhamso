# Decision 002: separate corpus, subscriber, and media responsibilities

Status: reconstructed from merged interfaces at `4c94bf2`; written 2026-10-12. Source comments record the edge import failure and database separation intent; no contemporaneous ADR or verified database provisioning is implied.

## Context and decision

The local build needs fast SQLite reads; edge functions cannot execute `bun:sqlite`. Public corpus queries and sensitive subscriber mutations also have different responsibilities. Keep a local generated SQLite build cache, an async [corpus backend](../../src/lib/corpus-db.ts) for edge queries, a narrow [subscriber backend](../../src/lib/subscriber-db.ts), and a [media state interface](../../src/lib/videos-db.ts) for the publishing lifecycle.

Bun uses the local database. Non-Bun edge runtime uses libSQL's web client with separate CORPUS and PII URL/token pairs. Dynamic imports behind runtime guards avoid evaluating native SQLite in workerd. Corpus YAML and schema/migrations are inputs; the ignored binary is rebuilt via ingest. Remote corpus seeding is an explicit operator responsibility, including checksums and backup gates for destructive replacements.

## Boundaries and caveats

The interfaces separate concerns; the environment can still point both URL pairs at one database. Separation is therefore a configuration choice, not proof of physical isolation or least-privilege credentials. In addition, [search-miss logging](../../src/lib/search-miss.ts) writes DDL/demand rows through the corpus adapter despite its read-only description. State this exception when provisioning credentials.

Subscriber storage uses HMAC email hashes and secret tokens; media lifecycle state travels between workflow jobs using a separate R2-backed SQLite snapshot. R2 media objects, corpus exports, database backups, and subscriber records have different content/retention concerns. Dataset publishing excludes operational/private tables.

## Verification and future changes

[Search edge regression tests](../../tests/unit/search-edge-compat.regression-1.test.ts), [subscriber edge tests](../../tests/unit/subscribe-edge-compat.test.ts), [seeder tests](../../tests/unit/scripts/turso-seed-corpus.test.ts), and [migration tests](../../tests/unit/migrations.test.ts) support the interfaces. They do not prove cloud resource configuration.

An uncommitted D1/static-corpus cutover exists in the original working directory as of 2026-10-12. It must preserve subscriber migration/privacy and corpus parity separately; an older Turso-writing build is not a safe rollback after a new database accepts writes without reconciliation. See the baseline [Turso runbook](../TURSO.md) for the currently documented interface.
