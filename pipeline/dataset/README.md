# Dataset pipeline

Local bundle generation and optional external Zenodo publication. [Corpus and data platform](../../docs/CORPUS-AND-DATA-PLATFORM.md#dataset-export-and-release-procedure) is the authoritative format, filtering and release reference. [Security, provenance and licenses](../../docs/SECURITY-PROVENANCE-AND-LICENSES.md) explains source obligations.

## Files

- [publish.ts](publish.ts): emits CSV, per-text JSON and minimal TEI with attribution and SHA-256 checksums.
- [zenodo-deposit.ts](zenodo-deposit.ts): prepares metadata/file inventory locally by default; `--execute` creates, uploads and publishes an external deposit.

## Build and inspect locally

```bash
bun install
bun run db:build
bun pipeline/dataset/publish.ts --version v2026.10.12 --out /tmp/sohamhamso-dataset-review
cd /tmp/sohamhamso-dataset-review/sohamhamso-dataset-v2026.10.12
shasum -a 256 -c checksums.sha256
```

The publisher opens SQLite read-only and writes bundle artifacts only; it does not update the `dataset_releases` ledger or operational database state.

The version defaults to the current UTC date and must match `vYYYY.MM.DD`; proposed post-1.0 semantic versioning is not implemented.

The bundle contains README, `LICENSE-CC-BY-SA-4.0`, attribution, changelog, `checksums.sha256`, five CSVs (`texts`, `verses`, `translations`, `word_glosses`, `parallels`), and `json/{slug}.json`/`tei/{slug}.xml`. Headers are explicit lists in `publish.ts`, **not** a complete 1:1 export of current database columns. Verse CSV/JSON omit prose section metadata; chapter titles and the lemma index are not exported. JSON uses translation `text` and boolean `ai_assisted`; CSV uses `translation_text` and 0/1.

## Filters and permission review

Draft translations are excluded. YAML `text.pending_miri: true` excludes the entire text and its children, including parallels crossing a held boundary. At `4c94bf2` six texts are held; five texts with 377 units and 4,524 translations pass the automated filters.

Passing this filter does not resolve every source license. Two unheld texts retain NC-SA source terms and the Karpūrādi source attribution records permission restrictions. The generated CC-BY-SA license file cannot override stricter source terms. Review permission and attribution before distributing a bundle.

Embeddings, subscribers, videos, quota ledgers and other operational data do not ship. The checksum manifest is written last and excludes itself.

## Zenodo dry run and publication boundary

A dry run needs no real API key, makes no HTTP calls and writes a local provenance file:

```bash
bun pipeline/dataset/zenodo-deposit.ts --dir /tmp/sohamhamso-dataset-review/sohamhamso-dataset-v2026.10.12
```

`--execute` is an external publishing action requiring `ZENODO_API_KEY`; `--sandbox` selects the sandbox service. Each execution creates a new deposit. Inspect existing remote deposition state before retrying an interrupted execution. The locally added `zenodo-deposit.json` is outside the original checksum manifest.

No actual Zenodo publication or DOI is established by this repository baseline. Placeholder DOI examples are pending information and must not be cited as real releases. Verify a published record independently before adding it to citation materials.
