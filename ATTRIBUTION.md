# Attribution

Per-source and per-text attribution. Updated each release; per-text entries land as texts are ingested.

## Sanskrit source texts

### GRETIL (Göttingen Register of Electronic Texts in Indian Languages)
- URL: https://gretil.sub.uni-goettingen.de/
- License: per-file (mostly CC-BY 4.0; some files have stricter terms — header-parsed at ingestion)
- Citation: GRETIL, Universitätsbibliothek Göttingen, accessed YYYY-MM-DD
- Per-text revisions tracked in `texts.source_revision` column

### Muktabodha Indological Research Institute (MIRI)
- URL: https://muktabodha.org/ · library: https://muktalib7.com/
- Status: written redistribution permission **pending**. No Muktabodha-derived text is published in our dataset or upstreamed to Ambuda until this permission lands.
- Each Muktabodha-derived text carries `pending_miri: true` in its corpus YAML (`data/corpus/*.yaml`); the bundle hold is automated — `pipeline/dataset/publish.ts` reads the flag and excludes flagged texts (and all their verses/translations/glosses/parallels) from every dataset build until the flag is removed.
- The permission request letter is drafted at [docs/MIRI-PERMISSION-REQUEST.md](docs/MIRI-PERMISSION-REQUEST.md).
- For browse-only reader display, we operate under Muktabodha's scholarly-use terms.

### sanskritdocuments.org
- URL: https://sanskritdocuments.org/
- License: non-commercial scholarly use; redistribution requires per-text permission
- Used as a fallback source for texts not covered by GRETIL or Muktabodha
- Per-text volunteer transcriber credits preserved in `texts.attribution_html`

### Wikisource (Sanskrit)
- URL: https://sa.wikisource.org/
- License: CC-BY-SA 4.0 + GFDL
- Used as a license-clean fallback

## Public-domain English translations (anchor signals only)

The translation pipeline grounds on Sanskrit, not on these English texts. PD translations are passed to the LLM-as-judge as *reference signals*, not as the target.

- John Woodroffe (Arthur Avalon): *The Great Liberation* (Mahānirvāṇa Tantra, 1913), *Principles of Tantra* (1914–1916), *Śakti and Śākta* (1918), *The Garland of Letters* (1922), *Karpūrādi Stotra*
- Ralph T. H. Griffith: *Hymns of the Rigveda* (1889–1896), *White Yajurveda* (1899), *Sāmaveda* (1893), *Atharvaveda* (1895–96)
- George Thibaut: *Brahma Sūtra with Śaṅkara Bhāṣya* (SBE 34, 38, 1890–96)
- Max Müller: *Principal Upanishads* (SBE 1, 15, 1879/1884)
- W. D. Whitney: *Atharvaveda* (1905)
- J. H. Woods: *Yoga Sūtras* (HOS 17, 1914)

All translators in this section died before 1956 OR works are unambiguously pre-1930 US-PD as of 2026.

## Computational resources

- **Vidyut** (Ambuda Rust toolkit) — Sanskrit morphological segmentation. License: MIT/Apache. https://github.com/ambuda-org/vidyut
- **DCS (Digital Corpus of Sanskrit)** — lemmatized POS-tagged corpus. License: CC-BY 3.0. http://www.sanskrit-linguistics.org/dcs/ · Cite Hellwig (2010+).
- **Cologne C-SALT** — Monier-Williams + Apte + 20 other Sanskrit dictionaries via REST/GraphQL. License: CC-BY-SA. https://cceh.github.io/c-salt_sanskrit_data/
- **Skrutable** — meter identification. https://github.com/tylergneill/skrutable
- **Sanscript.js** (@indic-transliteration) — client-side script conversion. License: MIT. https://github.com/indic-transliteration/sanscript.js
- **Aksharamukha** — server-side script conversion (120 scripts). License: MIT/AGPL per component. https://www.aksharamukha.com/

## Translation models

AI-assisted translations use:
- Anthropic Claude Sonnet (model + version recorded per translation in `translations.model` and `translations.model_version`)
- OpenAI text-embedding-3-large (semantic search vector embeddings)

Model versions and prompt versions are recorded per translation. See [STATUS-CONTRACT.md](STATUS-CONTRACT.md) for the LLM-as-judge rubric.

## Reviewer credits

This section is populated as human reviewers accept translations (V1.x). Each accepted review records reviewer name (or pseudonym), date, and language.

| Reviewer | Languages | Texts reviewed | Verses count |
|---|---|---|---|
| (none yet) | — | — | — |

## Code contributors

Tracked via git history. Substantial contributors with consent are listed on the live site credits page.

## Dataset citations

Each tagged dataset release publishes a Zenodo deposit with DOI. Recommended citation format:

```
sohamhamso contributors. (YYYY). sohamhamso: Tantric Sanskrit canon dataset (vYYYY.MM.DD)
  [Data set]. Zenodo. https://doi.org/10.5281/zenodo.PLACEHOLDER
```

BibTeX template available at `/cite` on the live site (V1.x).
