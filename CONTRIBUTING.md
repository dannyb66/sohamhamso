# Contributing

Thank you for the interest. Read this in full before opening a PR.

## 1. Project overview

sohamhamso is a non-profit, donation-funded reader for the Tantric / Kashmir Shaivism / Trika / Kaula corpus, with Sanskrit, transliteration, word-by-word glosses, and translations across eleven Indic languages. Auto-commentaries are sibling texts under the same anatomy, not a nested layer. Reader and AI-assisted media tooling share the corpus; the [documentation library](docs/README.md) maps data, AI, web and publishing boundaries. The full project intent is in [`README.md`](./README.md); the methodology page on the live site (`/about/methodology`) is the source of truth for editorial and translation policy.

## 2. Local development setup

```sh
git clone https://github.com/dannyb66/sohamhamso.git
cd sohamhamso
bun install
bun run db:build
bun run dev
```

Open `http://localhost:4321`. The local reader runs against the checked-in corpus in `data/corpus/` and a generated SQLite snapshot in `db/sohamhamso.db`. Reading locally requires no remote database credentials; local subscriber writes use SQLite. The dev pepper fallback (`SUBSCRIBER_HASH_PEPPER`) is fine for local-only testing.

Minimum tooling: **Bun ≥ 1.1** (everything else installs via `bun install`).

## 3. Test commands

| Command | What it runs |
|---|---|
| `bun run test` | Vitest unit suite (`vitest.config.ts`) |
| `bun run e2e` | Playwright end-to-end suite (`playwright.config.ts`) |
| `bun -e 'import {parseTextYaml} from "./pipeline/ingest/ingest.ts"; console.log(parseTextYaml("data/corpus/siva-sutras.yaml").id)'` | Validate one corpus YAML through the pure exported parser, without DB writes |

CI runs the configured Vitest and Playwright scripts on every PR. Run both locally before pushing.

## 4. Lint commands

| Command | What it runs |
|---|---|
| `bun typecheck` | `tsc --noEmit` — fail on any new type error |
| `bun run check` | `biome check .` — lint + format check, baseline 238 errors permitted, an error count above the baseline fails CI |
| `bun run format` | `biome format --write .` — apply formatter fixes |
| `bun run lint` | `biome lint .` — lint only, no format check |

The configured Biome baseline (238 errors at the documentation baseline, `2026-10-12`) is recorded in `.gstack/qa-reports/baseline-pass2.json` and gated by `.github/workflows/ci.yml`. Don't try to "fix" pre-existing lints in unrelated PRs; open a dedicated lint-sweep PR if you want to drive the baseline down.

## 5. How to add a new text

The full runbook is in [`docs/INGESTION.md`](./docs/INGESTION.md) (12-step guide from discovery to public launch). The PR-side summary:

1. Create `data/corpus/{text-slug}.yaml`. Use an existing file as a template.
2. Fill `source`, `source_revision`, `license`, and per-verse Devanāgarī. SLP1 and IAST are derived during ingest; do not hand-type them unless the source needs correction.
3. Run `bun run ingest` to reconcile the full corpus, or use `--dir <directory>` with an isolated corpus directory and `--db <path>` for a disposable database. The CLI accepts only `--db` and `--dir`; it has no positional-file or dry-run option.
4. Verify in the local reader at `/{tradition}/{text-slug}/1/1`.
5. Confirm verse count matches the printed edition (see `text.expected_verse_count` in the YAML).
6. Open a PR. The PR template asks for source, license, and a spot-check of three random verses.

Per-text editorial policy (variant edition, emendations) is documented in `texts.source_revision` for V1. Full editorial-policy markdown lands in V1.x.

## 6. How to review an AI translation

V1 ships AI-only translations with a clear `AI · not verified` badge. A V1.x review tool will let Sanskrit-literate volunteers promote translations from `ai_assisted=true, status='published'` to `status='reviewed'` with attribution. Until that ships:

- Open an issue using the **Translation issue** template at [`.github/ISSUE_TEMPLATE/translation-issue.md`](./.github/ISSUE_TEMPLATE/translation-issue.md). Title it `review: {text-slug} {chapter}.{verse} {lang}`.
- Paste the verse URL, the current text, and your proposed correction.
- Cite the Sanskrit grounds (lemma, morphology, lexicon entry).

**Reviewer rule (load-bearing):** reviewers MUST NOT paste from or transcribe Singh, Dyczkowski, Silburn, Sanderson, or any other copyrighted scholarly translation. Consult them on paper if you must; cite them as having been consulted; write your correction from the Sanskrit. Provenance of every consulted source is tracked in the review record.

**AI-assist provenance is permanent.** Every translation carries `(model, model_version, prompt_version, generated_at)`. Reviewers add their name and review date; the AI provenance stays attached. Do not strip it.

## 7. Style guide

- **Brand voice:** precise, scholarly-plain, reverent-without-piety. No "sacred journey," no "ancient wisdom," no "unlock." See the brand spec for the full anti-pattern list.
- **Type, palette, motion, motif:** defined in the project's design system. Manuscript-at-dawn palette, shirorekha-only ornamentation, 240ms motion ceiling.
- **Code style:** Biome defaults (see `biome.json`), two-space indent, single quotes in TS/TSX, trailing commas, semicolons required, no default exports for components.
- **Commits:** Conventional Commits encouraged, not required. Keep the subject under 72 characters. The PR template captures the rest.

## 8. License agreement

By contributing, you agree:

- **Code** contributions are licensed **MIT**.
- **Content** contributions (corpus YAML, translations, glosses, prose) are licensed **CC-BY-SA 4.0**.
- Your name (or chosen handle) and the nature of your contribution are added to [`ATTRIBUTION.md`](./ATTRIBUTION.md).

The per-directory mapping of which license applies where is in [`NOTICE`](./NOTICE); the full license texts are in [`LICENSE`](./LICENSE). If you cannot license under those terms, do not contribute.

## 9. Code of conduct

We follow the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

**Addendum (sectarian-sensitive content):** this project handles material from living religious traditions. Some Kaula and lineage-restricted texts are published here for scholarly access; treat discussions about them with the care they merit. Sectarian polemic, ad hominem against lineages or scholars, and Hindutva-coded politicization are out of scope and will be moderated.

Report concerns to `conduct@sohamhamso.org`.
