# Run the multilingual reader locally

You will build the database from source-controlled corpus files and open the English and Hindi reader without API keys. This tutorial uses the merged Cloudflare/Bun configuration; Node/Docker and D1 commands belong to uncommitted work and do not apply to this checkout.

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

Keep the server running while browsing. The local Bun adapter reads SQLite; opening a page does not call a translation or speech API. A first-run warning about Wrangler configuration is not a request to deploy or supply credentials.

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

The walkthrough was tested on 2026-10-12 with a new database and no production credentials. See [verification report](../VERIFICATION-2026-10-12.md) for route checks and targeted tests. To run unit checks, use `bun run test`; bare `bun test` selects Bun's test runner and is not the intended Vitest entry point. Browser tests require Playwright Chromium (`bunx playwright install chromium`) and use port 4321 by default.

## Troubleshooting

| Symptom | Action |
|---|---|
| Missing database | Run `bun run db:build` before `bun run dev`; `dev` does not initialize it automatically. |
| Native SQLite error under Node | Use Bun. The baseline has no Node deployment target. |
| Port already in use | Run `bun run dev --host 127.0.0.1 --port 4327` and use that port in the URLs; configure test baseURL accordingly. |
| Locale page missing | Use the canonical `siva-sutras` slug and the supported two-letter locale; check [routing](../WEB-DELIVERY-AND-EDGE.md). |
| Expected new corpus edit is absent | Re-run ingest. `db:ensure` only checks file existence, not corpus freshness. |
| Optional API command asks for secrets | Return to the dry-run/mock command. Live generation, uploads, email and deploys are separate operator tasks. |

## What you built

You have a locally reconstructed corpus and multilingual reader, plus credentials-free validation of its schema and media configuration. Continue with [ingestion](../INGESTION.md) to add a source, [data reference](../CORPUS-AND-DATA-PLATFORM.md) for field contracts, and [architecture](../ARCHITECTURE.md) to understand how web and media share the platform.
