# PD English reference index (Woodroffe + pre-1930 anchors)

Per-text catalogue of public-domain English translations available as `{{pd_english_reference}}` reference signals for the v1-sanskrit-grounded prompt. These are **reference signals, not anchors** — the pipeline grounds on Sanskrit + Vidyut morphology + Cologne MW; PD English is consulted only.

Pre-1930 translations are public domain in the US (pre-1929 corpus + life+95 rule for John Woodroffe d. 1936 puts his Indian editions in scope under the relevant jurisdictions for non-profit republication; verify per-text before any redistribution).

## V1 corpus

### Śiva Sūtras of Vasugupta (77 sūtras)

- **No Woodroffe translation.** The Śiva Sūtras lie outside Woodroffe's published canon.
- Partial PD coverage via early 20th-century Indological journals (Indian Antiquary, JRAS) — sparse and inconsistent, not suitable as a stable reference.
- **Reference: none.** Pipeline grounds on Sanskrit-only.
- Modern translators (Jaideva Singh 1979; Mark Dyczkowski 1992) are copyrighted — must not be consulted.

### Spanda Kārikās of Vasugupta (52 verses)

- **No direct PD translation.** Jaideva Singh 1980 is the standard modern translation (copyrighted).
- Use as Sanskrit-only ground truth.
- **Reference: none.**

### Pratyabhijñā Hṛdayam of Kṣemarāja (20 sūtras)

- **No PD translation.** Jaideva Singh 1963 (copyrighted) is the standard.
- Use as Sanskrit-only ground truth.
- **Reference: none.**

### Vijñāna Bhairava Tantra (163 dhāraṇās)

- **Partial Woodroffe summary** in *Garland of Letters* (1922), Chapter on Bhairava — selected dhāraṇās summarized, not a full translation.
  - archive.org: https://archive.org/details/garlandofletters00avalrich
  - sacred-texts.com mirror: https://www.sacred-texts.com/tantra/gol/
- **Reference for selected dhāraṇās: Garland of Letters, ch. on Bhairava.** Pass to prompt only when the specific dhāraṇā is covered by Woodroffe's summary. Otherwise: Sanskrit-only.

### Karpūrādi Stotra

- **Woodroffe 1922** — *Hymn to Kālī* (Karpūrādi Stotra) with introduction and commentary, Luzac & Co.
  - archive.org: https://archive.org/details/hymntokalkarpr00avalrich
  - sacred-texts.com mirror: https://www.sacred-texts.com/tantra/htk/
- **Reference: Woodroffe 1922, full text.**

## Phase 2 corpus (post-V1)

### Mahānirvāṇa Tantra (~1400 verses)

- **Woodroffe 1913** — *Mahanirvana Tantra (Tantra of the Great Liberation)*, Luzac & Co.
  - archive.org: https://archive.org/details/mahanirvanatantra00woodrich
  - sacred-texts.com mirror: https://www.sacred-texts.com/tantra/maha/
- **Reference: Woodroffe 1913, full text.** The canonical PD anchor for Tantric corpus translation.

### Paratrīśikā of Abhinavagupta + Vivaraṇa (~36 verses + comm.)

- **No Woodroffe.** Jaideva Singh 1988 (copyrighted) is the standard.
- **Reference: none.**

### Īśvarapratyabhijñā Kārikā of Utpaladeva (~190 verses)

- **No Woodroffe.** Torella 1994 (copyrighted) is the standard scholarly edition + translation.
- **Reference: none.**

### Śivadṛṣṭi of Somānanda

- **No PD translation.** Nemec 2011 (copyrighted) is the standard.
- **Reference: none.**

### Tantrasāra of Abhinavagupta

- **No PD translation.** H. N. Chakravarty 2012 (copyrighted) is the modern translation.
- **Reference: none.**

### Gītārtha Saṃgraha of Abhinavagupta

- **No PD translation.** Boris Marjanovic 2002 (copyrighted) is the modern translation.
- **Reference: none.**

## Phase 3 corpus (source tantras)

### Mālinīvijayottara Tantra

- **No PD translation.** Somdev Vasudeva 2004 (copyrighted) is the standard.
- **Reference: none.**

### Svacchanda Tantra, Netra Tantra, Kulārṇava Tantra, Rudrayāmala, Krama corpus

- **No PD translations** in scope. Various modern editions exist (copyrighted).
- **Reference: none.** All ground on Sanskrit-only.

## Phase 4 (magnum opus)

### Tantrāloka of Abhinavagupta (~5,800 verses)

- **No PD translation** in scope. Gnoli (Italian, copyrighted); Silburn / Padoux (French, copyrighted); no complete English PD or modern PD translation exists.
- **Reference: none.**

## Adjacent PD anchors (cross-Tantric reference, not in our V1 corpus)

These Woodroffe-era works are useful background reference but not currently ingested:

- **Principles of Tantra** (Woodroffe, ed., 1914) — archive.org: https://archive.org/details/principlesoftant01wood
- **Śakti and Śākta** (Woodroffe, 1918) — archive.org: https://archive.org/details/shaktiandshkta00aval
- **Garland of Letters** (Woodroffe, 1922) — archive.org: https://archive.org/details/garlandofletters00avalrich
- **The Serpent Power** (Woodroffe, 1919) — archive.org: https://archive.org/details/serpentpower00wood
- **Wave of Bliss** (Woodroffe, 1922) — Saundaryalaharī commentary — sacred-texts.com: https://www.sacred-texts.com/tantra/wob/

## Runner integration

The runner (`pipeline/translate/runner.ts`) consults this file (indirectly — via a hardcoded `PD_REFERENCES` map keyed by text slug) to populate `{{pd_english_reference}}` for verses in texts where a PD reference exists. For texts marked **Reference: none**, the prompt placeholder is left empty and the pipeline grounds on Sanskrit alone.

Future work: encode this mapping as `data/pd-anchors/{text-slug}.json` per-verse so the per-verse Garland-of-Letters partial coverage is correctly handled (some VBT dhāraṇās have Woodroffe summary, most do not).
