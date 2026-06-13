# Attribution

Per-source and per-text attribution. Updated each release; per-text entries land as texts are ingested.

## Sanskrit source texts

### GRETIL (Göttingen Register of Electronic Texts in Indian Languages)
- URL: https://gretil.sub.uni-goettingen.de/
- License: per-file (mostly CC-BY 4.0; some files have stricter terms — header-parsed at ingestion)
- Citation: GRETIL, Universitätsbibliothek Göttingen, accessed YYYY-MM-DD
- Per-text revisions tracked in `texts.source_revision` column
- **Parātrīśikā (Parātriṃśikā)** — `data/corpus/paratrisika.yaml` (36 verses, Sanskrit only).
  - Source file: https://gretil.sub.uni-goettingen.de/gretil/corpustei/sa_parAtriMzikA.xml (TEI version 2020-07-31, mass conversion of legacy `1_sanskr/6_sastra/3_phil/saiva/paratriu.htm`; both accessed 2026-06-12).
  - Data entry: Marino Faliero (July 1998); TEI normalization: Maximilian Mehner; legacy GRETIL conversion: Reinhold Grünendahl.
  - License (per TEI header): CC BY-NC-SA 4.0 — https://creativecommons.org/licenses/by-nc-sa/4.0/
  - IAST is the source of record; Devanagari + SLP1 in the YAML are mechanical Sanscript transliterations. Two legacy-encoding artifacts (verse 19 `ma.ṅdalo`, verse 29 `stha.ṅdilaṃ`) are preserved verbatim, un-emended.
- **Īśvarapratyabhijñākārikā (Utpaladeva)** — `data/corpus/isvarapratyabhijna-karika.yaml` (190 kārikās, Sanskrit only; the interleaved vṛtti auto-commentary is excluded, reserved for a sibling text).
  - Source file: https://gretil.sub.uni-goettingen.de/gretil/corpustei/transformations/plaintext/sa_utpaladeva-IzvarapratyabhijJAkArikA-with-vRtti.txt (TEI version 2020-07-31, mass conversion of legacy `utipk_au.htm`; accessed 2026-06-12).
  - Data entry: Somadeva Vasudeva. Edition basis: Madhusudan Kaul Shastri, Srinagar 1921 (Kashmir Series of Texts and Studies 34), revised per Raffaele Torella, Roma 1994 (Serie Orientale Roma 71).
  - License (per GRETIL header): CC BY-NC-SA 4.0 — https://creativecommons.org/licenses/by-nc-sa/4.0/
  - IAST is the source of record; Devanagari + SLP1 in the YAML are mechanical Sanscript transliterations. Upstream transcription quirks (kārikā 1,2.6 `smṛitisiddhau`, 1,2.8 `nārthaprakāsatā`, editorial brackets in 3,2.15 `sauṣupta[ṃ]`) are preserved verbatim, un-emended.
  - Verse count cross-check: 190 kārikās in 4 adhikāras / 15 āhnikas (5+11+7+8+21+11+14+11 | 8+7+17+21 | 11+20 | 18), identical in the GRETIL e-text and the sanskrit-trikashaivism.com edition (https://www.sanskrit-trikashaivism.com/en/scriptures-trika-scriptures-iishvarapratyabhijnaakaarikaas/1003, accessed 2026-06-12; used for count verification only, no text copied from it).

### Muktabodha Indological Research Institute (MIRI)
- URL: https://muktabodha.org/ · library: https://muktalib7.com/
- Status: written redistribution permission **requested — letter SENT 2026-06-12**, awaiting reply. No Muktabodha-derived text is published in our dataset or upstreamed to Ambuda until this permission lands.
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

### Gītārthasaṃgraha (gitartha-samgraha)
- **Text:** Gītārthasaṃgraha — Abhinavagupta's commentary on the Bhagavad Gītā (Kashmirian recension)
- **Author:** Abhinavagupta (c. 975–1025 CE)
- **Source:** Muktabodha Indological Research Institute, catalog no. M00244 (bhagavadgītārthasaṃgraha); based on the edition of Lakṣmaṇa Raina Brahmacārī (Lakshman Joo), Kashmiri Pratap Steam Press, Srinagar 1933.
- **URL:** https://muktalib7.com/DL_CATALOG_ROOT/MUKTABODHA-LIBRARY-IAST/bhagavadgItA-M00244-IAST.txt
- **Revision:** Muktabodha revision 0, 2012-02-05; accessed 2026-06-12
- **License:** CC-BY-NC 4.0 (`pending_miri: true` — held from dataset releases until MIRI permission).

### Tantrasāra (tantrasara)
- **Text:** Tantrasāra (prose) by Abhinavagupta
- **Source:** GRETIL Devanāgarī e-text (input by Oliver Hellwig), based on the public-domain editio princeps — Mukund Rām Śāstrī (ed.), *The Tantrasāra of Abhinava Gupta*, Nirnaya Sagara Press, Bombay, 1918 (Kashmir Series of Texts and Studies 17).
- **Revision:** retrieved via the sanskrit/raw_etexts mirror, accessed 2026-06-12
- **License:** underlying text public domain (KSTS 1918). Flagged `pending_miri: true` conservatively pending a Muktabodha/critical-edition cross-check; relaxable since the source is GRETIL/PD, not Muktabodha.

### Mahānirvāṇa Tantra (mahanirvana-tantra), ullāsas 1–3
- **Text:** Mahānirvāṇa Tantra (Śākta; public/reformist Kaula), sample ullāsas 1–3 (mūla only; Hariharānanda Bhāratī's ṭīkā excluded)
- **Source:** Muktabodha Indological Research Institute, catalog M00049; data entered from Tantrik Series Vol. 13, ed. Arthur Avalon (Sir John Woodroffe), Luzac & Co., Calcutta, 1926; accessed via Sanskrit Wikisource.
- **URL:** https://sa.wikisource.org/wiki/महानिर्वाणतन्त्रम्
- **Revision:** accessed 2026-06-12
- **License:** CC-BY-NC 4.0 (`pending_miri: true` — held from dataset releases until MIRI permission).
