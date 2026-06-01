# Contributing

Thank you for the interest. Read this in full before opening a PR.

## Project overview

sohamhamso is a non-profit, donation-funded reader for the Tantric / Kashmir Shaivism / Trika / Kaula corpus, with Sanskrit, transliteration, word-by-word glosses, and translations across eleven Indic languages. Auto-commentaries are sibling texts under the same anatomy, not a nested layer. The full project intent is in [`README.md`](./README.md); the methodology page on the live site is the source of truth for editorial and translation policy.

## Local development setup

```sh
git clone https://github.com/sohamhamso/sohamhamso.git
cd sohamhamso
bun install
cp .env.example .env.local
bun dev
```

The local reader runs against a sample corpus shipped in `data/corpus/`. Turso credentials in `.env.local` are optional for read-only local work; set them when you need to test write paths.

## Test commands

- `bun test` — unit tests (TBD at scaffolding; expected runner: Vitest or bun's built-in)
- `bun e2e` — end-to-end browser tests (TBD at scaffolding; expected: Playwright)
- `bun ingest --dry-run` — validate a corpus YAML without writing to the database

Exact commands are pinned at scaffolding time.

## Lint commands

- `bun lint` — Biome
- `bun typecheck` — `tsc --noEmit`
- `bun fmt` — Biome formatter

CI runs all three on every PR.

## How to add a new text

1. Create `data/corpus/{text-slug}.yaml`. Use an existing file as a template.
2. Fill `source`, `source_revision`, `license`, and per-verse Devanāgarī. SLP1 and IAST are derived; do not hand-type them unless the source needs correction.
3. Run `bun ingest data/corpus/{text-slug}.yaml`.
4. Verify in the local reader at `/{tradition}/{text-slug}/1/1`.
5. Confirm verse count matches the printed edition (see `verification.expected_verse_count` in the YAML).
6. Open a PR. The PR template asks for source, license, and a spot-check of three random verses.

Per-text editorial policy (variant edition, emendations) is documented in `texts.source_revision` for V1. Full editorial-policy markdown lands in V1.x.

## How to review an AI translation

V1 ships AI-only translations with a clear `AI · not verified` badge. A V1.x review tool will let Sanskrit-literate volunteers promote translations from `ai_assisted=true, status='published'` to `status='reviewed'` with attribution. Until that ships:

- Open an issue titled `review: {text-slug} {chapter}.{verse} {lang}` with the verse ID and the proposed correction.
- Cite the Sanskrit grounds (lemma, morphology, lexicon entry). Do not paste from copyrighted modern translations.

**Reviewer rule (load-bearing):** reviewers MUST NOT paste from or transcribe Singh, Dyczkowski, Silburn, Sanderson, or any other copyrighted scholarly translation. Consult them on paper if you must; cite them as having been consulted; write your correction from the Sanskrit. Provenance of every consulted source is tracked in the review record.

**AI-assist provenance is permanent.** Every translation carries `(model, model_version, prompt_version, generated_at)`. Reviewers add their name and review date; the AI provenance stays attached. Do not strip it.

## Style guide

- Brand voice: precise, scholarly-plain, reverent-without-piety. No "sacred journey," no "ancient wisdom," no "unlock." See the brand spec for the full anti-pattern list.
- Type, palette, motion, motif: defined in `DESIGN.md` at scaffolding. Manuscript-at-dawn palette, shirorekha-only ornamentation, 240ms motion ceiling.
- Code style: Biome defaults, two-space indent, single quotes in TS/TSX, no default exports for components.
- Commits: Conventional Commits encouraged, not required. Keep the subject under 72 characters.

## License agreement

By contributing, you agree:

- Code contributions are licensed MIT.
- Content contributions (corpus YAML, translations, glosses, prose) are licensed CC-BY-SA 4.0.
- Your name (or chosen handle) and the nature of your contribution are added to `ATTRIBUTION.md`.

If you cannot license under those terms, do not contribute.

## Code of conduct

We follow the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

Addendum: this project handles material from living religious traditions. Some Kaula and lineage-restricted texts are published here for scholarly access; treat discussions about them with the care they merit. Sectarian polemic, ad hominem against lineages or scholars, and Hindutva-coded politicization are out of scope and will be moderated.

Report concerns to `conduct@sohamhamso.org`.
