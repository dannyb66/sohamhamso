# Run the multilingual reader locally

You will build the database from source-controlled corpus files, export static reader assets, and open the English and Hindi reader without API keys. This tutorial uses the Cloudflare/Bun configuration from the static corpus release. Production subscriber storage uses D1; reading locally requires no D1 or Turso credentials. Node/Docker remains outside this website release.

## What you need

Install Bun (the documentation walkthrough used **1.3.14**; CI installs latest). [CONTRIBUTING.md](../../CONTRIBUTING.md) records the historical minimum 1.1. Network access is required for dependency installation. Generation APIs, Turso, YouTube, R2 and email credentials are unnecessary. Run from a fresh checkout so you do not overwrite an operator's existing local database or state.

## Step 1: Install and build the local corpus

```sh
git clone https://github.com/dannyb66/sohamhamso.git
cd sohamhamso
bun install --frozen-lockfile
bun run db:build
```

`db:build` applies idempotent schema initialization and ingests the YAML (after any shard merge) into `db/sohamhamso.db`. At the documented baseline it reports 11 texts and 3,023 units; it calls prose blocks “verses” in its output. The generated binary is ignored by git. Do not use `db:init --force` on an existing database containing subscriber or video state.

## Step 2: Start the reader

```sh
bun run dev
```

Open `http://localhost:4321/trika/siva-sutras/1/1` and `http://localhost:4321/hi/trika/siva-sutras/1/1`. You should see Sanskrit, transliteration and the selected translation. English has no locale prefix. The configured reader supports `en hi ta te bn mr gu kn ml pa or as`.

`dev` runs `db:ensure` and `static:export` before starting Astro. Reader requests use the generated files under `dist/_data/corpus/`; SQLite supplies the build/export input. Keep the server running while browsing. Opening a page does not call a database, translation or speech API. A first-run warning about Wrangler configuration is not a request to deploy or supply credentials.

## Step 3: Validate and inspect without external writes

In a second terminal, from the repository root:

```sh
bun -e 'import {parseTextYaml} from "./pipeline/ingest/ingest.ts"; console.log(parseTextYaml("data/corpus/siva-sutras.yaml").id)'
bun run typecheck
MOCK_ALL=true bun run youtube:validate-config
bun pipeline/translate/runner.ts --lang en --text siva-sutras --dry-run --limit 1
```

The `parseTextYaml` command validates one YAML file without writing rows. The ingest CLI itself has no dry-run flag. The translation dry-run makes no model calls or translation writes; an already translated corpus normally reports zero eligible rows. `MOCK_ALL` config validation establishes schema/config correctness, not real narration or a rendered video. Use [AI reference](../AI-SYSTEMS-AND-EVALUATION.md) to construct a disposable fixture when testing a translation that is actually missing.

## Verification

The original walkthrough was tested on 2026-10-12; its [verification report](../VERIFICATION-2026-10-12.md) predates the static corpus cutover. Current `bun run build` also exports static assets and verifies their counts against SQLite. To run unit checks, use `bun run test`; bare `bun test` selects Bun's test runner and is not the intended Vitest entry point. Browser tests require Playwright Chromium (`bunx playwright install chromium`) and use port 4321 by default.

## Troubleshooting

| Symptom | Action |
|---|---|
| Missing database | `bun run dev` initializes it through `db:ensure`; use `bun run db:build` explicitly to inspect ingest errors. |
| Reader reports unavailable content | Restart `bun run dev` to regenerate `dist/_data/corpus/`; do not add Turso credentials. |
| Native SQLite error under Node | Use Bun. The baseline has no Node deployment target. |
| Port already in use | Run `bun run db:ensure`, `bun run static:export`, then `bun --bun astro dev --host 127.0.0.1 --port 4327`; use that port in URLs and test baseURL. |
| Locale page missing | Use the canonical `siva-sutras` slug and the supported two-letter locale; check [routing](../WEB-DELIVERY-AND-EDGE.md). |
| Expected new corpus edit is absent | Re-run `bun run ingest`, then restart `bun run dev` to export fresh assets. `db:ensure` only checks database existence. |
| Optional API command asks for secrets | Return to the dry-run/mock command. Live generation, uploads, email and deploys are separate operator tasks. |

## What you built

You have a locally reconstructed corpus and multilingual reader, plus credentials-free validation of its schema and media configuration. Continue with [ingestion](../INGESTION.md) to add a source, [data reference](../CORPUS-AND-DATA-PLATFORM.md) for field contracts, and [architecture](../ARCHITECTURE.md) to understand how web and media share the platform.
