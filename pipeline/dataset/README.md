# pipeline/dataset

Dataset publisher for sohamhamso. Emits a versioned CC-BY-SA 4.0 bundle from
the local SQLite corpus at `db/sohamhamso.db` and (optionally) deposits it to
Zenodo for a DOI.

Spec reference: see plan
`/Users/danny/.claude/plans/check-online-websites-aim-sparkling-pearl.md`,
section **"V1 DX Spec → 1. Dataset schema (Zenodo + GitHub publish)"**. Output
shape is taken verbatim from that section.

## Files

- `publish.ts` — build the dataset bundle from the local SQLite DB.
- `zenodo-deposit.ts` — Zenodo API deposit (dry-run by default, V1 scaffold).
- `README.md` — this file.

## Version scheme

`vYYYY.MM.DD` date tags (e.g. `v2026.07.15`). Pre-1.0 increments per text
addition; post-1.0, MAJOR for breaking schema changes and MINOR for new text
additions. The publisher rejects any version that does not match
`/^v\d{4}\.\d{2}\.\d{2}$/`.

## Publish a new release

1. Make sure the corpus DB is current:

   ```sh
   bun pipeline/ingest/init-db.ts
   bun pipeline/ingest/ingest.ts
   ```

2. Build the bundle. Version defaults to today (UTC) in `vYYYY.MM.DD` form.

   ```sh
   bun pipeline/dataset/publish.ts
   # or pin the version + output dir explicitly:
   bun pipeline/dataset/publish.ts --version v2026.05.31 --out dataset/build/
   ```

   The publisher writes to `dataset/build/sohamhamso-dataset-{version}/`:

   ```
   sohamhamso-dataset-vYYYY.MM.DD/
   ├── README.md                  # pandas snippet, integrity instructions
   ├── LICENSE-CC-BY-SA-4.0
   ├── ATTRIBUTION.md             # copied from repo root
   ├── CHANGELOG.md               # diffed against previous build in --out
   ├── checksums.sha256
   ├── texts.csv
   ├── verses.csv
   ├── translations.csv
   ├── word_glosses.csv
   ├── parallels.csv
   ├── json/{text-slug}.json      # denormalized verse anatomy
   └── tei/{text-slug}.xml        # minimal TEI (P5) per text
   ```

   CSV column order matches `db/schema.sql` 1:1.

3. (Optional) deposit to Zenodo. Dry-run first to confirm metadata + file list,
   then `--execute` to publish.

   ```sh
   export ZENODO_API_KEY=...
   bun pipeline/dataset/zenodo-deposit.ts --dir dataset/build/sohamhamso-dataset-v2026.05.31/
   # when satisfied:
   bun pipeline/dataset/zenodo-deposit.ts --dir <...> --execute
   ```

   Use `--sandbox` to hit `sandbox.zenodo.org` instead of production. Each run
   writes a `zenodo-deposit.json` provenance record into the bundle dir.

## Integrity verification

```sh
cd dataset/build/sohamhamso-dataset-vYYYY.MM.DD
shasum -a 256 -c checksums.sha256
```

Every non-checksum file in the bundle is listed. The publisher writes
`checksums.sha256` **last** so the file itself is never included in the hash
manifest.

## Schema source of truth

CSV headers and column order must match `db/schema.sql`. If you change the
schema, update the column lists at the top of `publish.ts` in the same commit
and bump the dataset version's day component (or MAJOR after 1.0).

## What ships, what does not

- `texts`, `verses`, `word_glosses`, `parallels` — all rows ship as-is.
- `translations` — only rows with `status IN ('reviewed','published')` ship.
  `draft` rows are reviewer-internal per STATUS-CONTRACT.md and excluded from
  both `translations.csv` and the per-verse JSON shards.
- `verse_embeddings`, `subscribers`, `api_quota`, `dataset_releases` — never
  included. PII / vector / operational data is out of scope for the published
  dataset.

## Why no npm CSV / XML deps?

The dataset is small (<10 MB through Phase 3) and the writers are <50 LoC
each. Avoiding deps keeps `bun pipeline/dataset/publish.ts` self-contained
and free of supply-chain surprises in the release pipeline.
