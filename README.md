# sohamhamso

[![DOI](https://img.shields.io/badge/DOI-pending-lightgrey.svg)](#citation)
[![Code license: MIT](https://img.shields.io/badge/code-MIT-blue.svg)](./LICENSE)
[![Content license: CC BY-SA 4.0](https://img.shields.io/badge/content-CC--BY--SA%204.0-orange.svg)](./LICENSE)

`so'haṃ haṃsaḥ` — the ajapa-japa breath mantra: *haṃ* on the outbreath, *sa* on the in. Read forward and backward, it mirrors itself, a palindrome that doubles as the Pratyabhijñā motif of *pratibimba* (reflection).

A mobile-first reader for the Tantric / Kashmir Shaivism / Trika / Kaula corpus, with original Sanskrit, transliteration, word-by-word glosses, and translations across eleven Indic languages. No commentary layer glued under the verse; auto-commentaries (e.g., Kṣemarāja's Vimarśinī on the Śiva Sūtras) are ingested as their own texts under the same anatomy. The site is donation-funded and non-profit.

## Currently online

| Surface | Path | Notes |
|---|---|---|
| Homepage | `/` | Daily-verse spotlight, corpus index |
| Reader | `/{tradition}/{text-slug}/{chapter}/{verse}` | Verse anatomy: Devanāgarī, IAST, gloss, translations |
| Search | `/search` | Lexical now; semantic blended search ships V1.x |
| Texts index | `/texts` | All Phase-1 texts with verse counts and licenses |
| Subscribe | `/` (homepage band) and `/api/subscribe` | Daily-verse email opt-in via Resend |
| Methodology | `/about/methodology` | Editorial + translation policy |
| Privacy | `/about/privacy` | Subscriber data + region disclosure |
| Attribution | `/about/attribution` | Per-source license matrix |

## The corpus

Phase 1 ships five texts, 334 verses, translated into 12 languages (English + 11 Indic). All Sanskrit is publicly redistributable under the per-source licenses listed in [`ATTRIBUTION.md`](./ATTRIBUTION.md); Muktabodha-derived texts are surfaced under scholarly-use terms pending written redistribution permission from MIRI.

| Text | Tradition | Verses | Primary Sanskrit source |
|---|---|---:|---|
| Śiva Sūtras (Śivasūtrāṇi) | Trika | 77 | GRETIL |
| Spanda Kārikās (Spandakārikāḥ) | Trika | 52 | GRETIL |
| Pratyabhijñāhṛdayam | Trika | 20 | GRETIL |
| Vijñāna Bhairava Tantra | Trika | 163 | Muktabodha (scholarly use, MIRI permission pending) |
| Karpūrādi Stotra | Śākta | 22 | sanskritdocuments.org |

Translation provenance is per-verse. AI-generated translations carry an `AI · not verified` badge with full model / prompt / generation-time metadata on tap; human-reviewed translations carry the reviewer's name. The full state matrix is in [`STATUS-CONTRACT.md`](./STATUS-CONTRACT.md).

## Run locally

```sh
git clone https://github.com/sohamhamso/sohamhamso.git
cd sohamhamso
bun install
bun dev
```

Open `http://localhost:4321`. The local reader runs against a sample corpus shipped in `data/corpus/` and a build-time SQLite snapshot in `db/sohamhamso.db`. Turso credentials in `.env.local` are only needed when testing the subscribe write path; see [`.env.example`](./.env.example).

## Architecture

Astro 5 in hybrid mode: every verse page is pre-rendered to static HTML at build time (read from `bun:sqlite` on the build machine) and served as a flat asset, while a single SSR route (`/api/subscribe`) runs as a Cloudflare Pages Function and writes to a Turso libSQL DB over HTTPS. Solid.js powers the small interactive islands (settings sheet, script picker, search box). The deploy target is Cloudflare Pages + Workers; the same build runs locally under Bun against `bun:sqlite`. See [`.gstack/launch/deployment-plan-2026-06-01.md`](./.gstack/launch/deployment-plan-2026-06-01.md) for the locked V1 stack.

## Dataset

Every release publishes a dataset bundle to Zenodo under CC-BY-SA 4.0: CSV, JSON shards, and TEI-XML per text, with `checksums.sha256` for integrity. Version tags follow `vYYYY.MM.DD`. DOI: *TBD on first release*.

Load it in pandas:

```python
import pandas as pd
texts = pd.read_csv("texts.csv")
verses = pd.read_csv("verses.csv")
translations = pd.read_csv("translations.csv")
ss = verses[verses.text_id == texts.loc[texts.slug == "shiva-sutras", "id"].iloc[0]]
print(ss.head())
```

## Contributing

Issues, translation corrections, and PRs are welcome. Read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR — the reviewer rules around AI provenance and copyrighted translation sources are load-bearing.

The most common contributor entry point is a translation correction. Use the **Translation issue** template at [`.github/ISSUE_TEMPLATE/translation-issue.md`](./.github/ISSUE_TEMPLATE/translation-issue.md) — paste the verse URL, the current text, and your proposed correction with Sanskrit grounds.

## License

Dual-licensed. **Code** (everything under `src/`, `pipeline/`, `scripts/`, `tests/`, `db/schema.sql`, configuration files) is **MIT**. **Content** (everything under `data/corpus/`, generated `dataset/` outputs, translations, glosses, prose documentation under `docs/`) is **CC-BY-SA 4.0**. The per-directory mapping is enumerated in [`NOTICE`](./NOTICE); the full license texts are in [`LICENSE`](./LICENSE).

Upstream per-source licenses (per [`ATTRIBUTION.md`](./ATTRIBUTION.md)) may impose additional or alternative terms on specific files; the most-restrictive applicable license governs.

## Citation

A Zenodo DOI is minted per tagged release. Cite the version you used:

```bibtex
@misc{sohamhamso_TBD,
  title        = {sohamhamso: The Tantric canon, read in eleven tongues},
  author       = {{sohamhamso contributors}},
  year         = {2026},
  howpublished = {\url{https://sohamhamso.org}},
  note         = {Version vYYYY.MM.DD},
  doi          = {10.5281/zenodo.TBD}
}
```

The DOI placeholder is filled in post-launch (first Zenodo deposit pending MIRI written permission for Muktabodha-derived texts; non-Muktabodha bundle ships first if needed).

## Acknowledgements

- **Muktabodha Indological Research Institute (MIRI)** — for the digitized Sanskrit critical editions that underpin much of Phase 1. Redistribution pending written permission; until then, scholarly use only.
- **GRETIL** (Göttingen Register of Electronic Texts in Indian Languages) — public Sanskrit machine-readable editions, per-file CC-BY.
- **sanskritdocuments.org** — community-maintained Sanskrit corpus, fallback source for several Phase-1 texts.
- **Cologne Digital Sanskrit Dictionaries / C-SALT** — Monier-Williams lookups grounding the word-by-word glosses.
- **Vidyut** (vidyut-prakriya / vidyut-cheda) — Sanskrit morphological analysis used in the translation pipeline.
- **Ambuda** — open-source Sanskrit reading platform; we coordinate corpus formats and share the open-data ethos.
- **The Lakshman Joo lineage** — for the living transmission of Kashmir Shaivism, without which the editorial care taken here would be impossible. This project does not speak for any lineage; it tries to make the source texts more findable for everyone the lineage has touched.

## Links

- Site: <https://sohamhamso.org>
- Discussions: <https://github.com/sohamhamso/sohamhamso/discussions>
- Methodology: [`/about/methodology`](https://sohamhamso.org/about/methodology) on the live site
- Per-source attribution: [`ATTRIBUTION.md`](./ATTRIBUTION.md)
- Translation status contract: [`STATUS-CONTRACT.md`](./STATUS-CONTRACT.md)
