# sohamhamso

`so'haṃ haṃsaḥ` — the ajapa-japa breath mantra: *haṃ* on the outbreath, *sa* on the in. Read forward and backward, it mirrors itself, a palindrome that doubles as the Pratyabhijñā motif of *pratibimba* (reflection).

A mobile-first reader for the Tantric / Kashmir Shaivism / Trika / Kaula corpus, with original Sanskrit, transliteration, word-by-word glosses, and translations across eleven Indic languages. No commentary layer glued under the verse; auto-commentaries (e.g., Kṣemarāja's Vimarśinī on the Śiva Sūtras) are ingested as their own texts under the same anatomy. The site is donation-funded and non-profit.

## Quick start

```sh
git clone https://github.com/sohamhamso/sohamhamso.git
cd sohamhamso
bun install
bun dev
```

Open `http://localhost:4321`.

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

## Sources

Sanskrit text from GRETIL (per-file CC-BY), Muktabodha (non-profit redistribution pending per-text permission from MIRI), sanskritdocuments.org, SARIT, and Wikisource. Public-domain English from John Woodroffe (1913–1922) and others. Full per-source attribution in [`ATTRIBUTION.md`](./ATTRIBUTION.md).

AI-assisted translations are labeled inline with an `AI · not verified` badge and full provenance (model, model_version, prompt_version, generated_at) on tap. Human-reviewed translations carry the reviewer's name. See [`STATUS-CONTRACT.md`](./STATUS-CONTRACT.md) for the badge rules.

## License

Code is MIT. Content (corpus YAML, translations, glosses, prose) is CC-BY-SA 4.0. See [`LICENSE`](./LICENSE).

## Links

- Discussions: https://github.com/sohamhamso/sohamhamso/discussions
- Dataset DOI: *TBD on first Zenodo release*
- Methodology: [`/methodology`](https://sohamhamso.org/methodology) on the live site
- Contributing: [`CONTRIBUTING.md`](./CONTRIBUTING.md)
