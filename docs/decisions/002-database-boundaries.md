# Decision 002: separate corpus, subscriber, and media responsibilities

Status: updated 2026-10-25. The original remote-database design at `4c94bf2`
is superseded by generated public corpus assets and D1 subscribers.

## Current decision

Corpus YAML and local SQLite ingestion produce static chapter, lemma and lexical
search assets. Public reader, search and OG requests use those generated assets;
they do not query a corpus database. `db.ts` and the asynchronous `corpus-db.ts`
wrapper are local tools only. No remote corpus adapter, seed job or libSQL client
is retained. Production search is lexical and does not log queries.

Subscriber persistence, confirmation and unsubscribe use Cloudflare D1 through
narrow repositories. Local development uses SQLite. Media lifecycle state uses
its existing separate R2-synced SQLite file. Public corpus exports, subscriber
records, media objects and state snapshots have distinct retention requirements.

## Verification and operations

[Static runtime tests](../../tests/unit/static-corpus-runtime.test.ts),
[D1 tests](../../tests/unit/subscriber-d1.test.ts),
[local adapter tests](../../tests/unit/search-edge-compat.regression-1.test.ts),
and [migration tests](../../tests/unit/migrations.test.ts) cover these boundaries.
Follow [D1-CUTOVER.md](../D1-CUTOVER.md) for deployment and recovery. Preserve
unreconciled legacy data as described in [the retirement record](../TURSO.md).
An older remote-database-writing deployment is not a valid rollback after D1
has accepted subscriber writes.
