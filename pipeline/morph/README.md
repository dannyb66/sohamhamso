# pipeline/morph — Vidyut-grounded morphology

Deterministic, tool-derived morphological analysis for the corpus, and a
trust audit comparing it against the LLM-authored `word_glosses` already in
the YAML. This exists because the methodology page implies Vidyut-grounded
morphology; until this pipeline, the `morph` fields in the corpus were
LLM-self-generated. The trust review called that the credibility gap.

## The contract

- **Verbatim corpus in.** Input is `data/corpus/{slug}.yaml`, read-only.
- **Deterministic analyses out.** Output is exactly what
  [vidyut-cheda](https://github.com/ambuda-org/vidyut) produced — same input,
  same data version, same output. Full provenance (tool, version, data dir,
  input mode) is recorded in every output file.
- **No LLM in the loop.** Nothing in this pipeline calls a model. If Vidyut
  is not installed or its linguistic data is missing, the runner prints the
  install path and **exits nonzero**. It never fabricates analyses.

## Toolkit choice (research notes, 2026-06)

- **Vidyut** is Ambuda's Rust Sanskrit toolkit. The Python bindings are
  published as the [`vidyut` package on PyPI](https://pypi.org/project/vidyut/)
  (prebuilt wheels, no Rust toolchain needed; the old `vidyut-py` repo is
  deprecated — bindings now live in `bindings-python/` of the main repo).
  There is **no maintained npm/JS binding**, so this runner is Python —
  consistent with the existing Python steps in `pipeline/translate/*.py`.
- `vidyut.cheda.Chedaka(data_dir).run(slp1_text)` segments an SLP1 string
  and returns tokens with `.text` (surface), `.lemma` (may be `None` for
  words absent from the kosha), and `.data` (a `PadaEntry` carrying
  subanta/tiṅanta morphology). The API is marked **experimental** upstream.
- Linguistic data is a one-time download via `vidyut.download_data(path)`
  (fetched from the matching `ambuda-org/vidyut` GitHub release, ~60 MB,
  unpacks to `cheda/`, `kosha/`, `sandhi/`, `prakriya/`, `chandas/`).
- **Cologne MW**: Vidyut lemmas are SLP1 stems; transliterated to IAST they
  are the natural Monier-Williams lookup keys (CDSL,
  sanskrit-lexicon.uni-koeln.de). We emit them as `mw_headword_candidate`
  and do **not** claim they are verified MW headwords — see "MW headwords"
  below.

## Install

```sh
# 1. Python env with vidyut (prebuilt wheels; needs Python >= 3.7)
uv venv pipeline/morph/.venv
uv pip install --python pipeline/morph/.venv/bin/python vidyut ruamel.yaml

# 2. One-time linguistic data download (~60 MB)
pipeline/morph/.venv/bin/python -c \
  "import vidyut; vidyut.download_data('$HOME/.cache/sohamhamso/vidyut-data')"
```

The data location defaults to `~/.cache/sohamhamso/vidyut-data` and can be
overridden with `VIDYUT_DATA_DIR`. The venv and all outputs are gitignored.

## Usage

```sh
# 1. Segment + analyze -> data/morph/{slug}.json
pipeline/morph/.venv/bin/python pipeline/morph/runner.py siva-sutras

# 2. Trust audit vs the LLM word_glosses -> data/morph/{slug}-audit.json
bun pipeline/morph/audit.ts siva-sutras
```

Without Vidyut installed, step 1 prints these install steps and exits `2`
(`3` if only the data is missing). Outputs are not committed yet
(`data/morph/.gitignore`); regenerate locally.

### Input handling

By default the runner transliterates each verse's **`iast` field** to SLP1
(deterministic table in `runner.py`, mirrored in `compare.ts`). Several
corpus `slp1` fields are Harvard-Kyoto-flavored (e.g. `caitanyamAtmA` where
SLP1 requires `cEtanyamAtmA`), which corrupts segmentation — `--input slp1`
uses the raw field if you want to audit exactly that. Fixing the corpus
`slp1` fields is a follow-up for the corpus owners.

## Output shapes

`data/morph/{slug}.json` (runner):

```jsonc
{
  "text_slug": "siva-sutras",
  "tool": { "name": "vidyut-cheda", "package": "vidyut (PyPI)", "version": "0.4.0", "data_dir": "..." },
  "contract": "verbatim corpus in, deterministic vidyut-cheda analyses out, no LLM",
  "verses": {
    "1.5": {
      "input": "udyamo BEravaH",
      "input_source": "iast (transliterated to SLP1)",
      "tokens": [
        {
          "surface": "udyamas",
          "lemma": "udyam",
          "lemma_iast": "udyam",
          "mw_headword_candidate": "udyam",   // MW lookup key, NOT verified
          "pos": "subanta",
          "tags": { "linga": "puM", "vibhakti": "praTamA", "vacana": "eka" },
          "entry": "PadaEntry.Subanta(...)"   // full vidyut repr, for provenance
        }
      ]
    }
  }
}
```

`data/morph/{slug}-audit.json` (audit): per gloss word, the aligned Vidyut
tokens, a classification (`match` / `split` / `merged` / `split_crossing` /
`mismatch` / `unmatched`), and a lemma-level `lemma_agreement` boolean, plus
a summary with the overall agreement rate. Alignment is exact by character
spans when sandhi resolution lines up, with a bounded greedy fallback
otherwise (`alignment_mode` is recorded per verse). All comparison logic is
pure and lives in `compare.ts`; tests in `tests/unit/morph-compare.test.ts`
run with fixtures only — no Vidyut required.

## How to read the audit (important)

**Disagreement does not mean the LLM gloss is wrong.** vidyut-cheda 0.4 is
experimental and visibly over-segments terse sūtra text and vocabulary
absent from its kosha (e.g. it shreds `caitanyam ātmā` into
`ca/Et/an/yamAt/mA`, while handling `udyamo bhairavaḥ` perfectly). Observed
lemma-agreement rates on this corpus (2026-06, vidyut 0.4.0 / data 0.4.0):

| text | words | agreement |
|---|---|---|
| karpuradi-stotra | 489 | 47.2% |
| siva-sutras | 189 | 43.9% |
| spanda-karikas | 533 | 41.5% |
| pratyabhijna-hrdayam | 104 | 26.9% |
| vijnana-bhairava-tantra | 1074 | 23.8% |

Treat the audit as a **human-review triage queue**: `match` rows are
independently corroborated; `split`/`merged` rows are usually compound- or
sandhi-splitting conventions differing; `mismatch`/`unmatched` rows need a
human with a grammar. What the methodology page may honestly claim today is
"morphology cross-checked against Vidyut, with the disagreement audit
published" — not "morphology generated by Vidyut".

## MW headwords

`mw_headword_candidate` is the Vidyut lemma transliterated to IAST — the key
you would look up in Cologne MW. It is emitted as a *candidate* because it
is not verified against the actual MW headword list. Follow-up: download the
CDSL MW headword index (sanskrit-lexicon.uni-koeln.de offers the full
digitization for download) and add a verification pass that sets a
`mw_verified` flag. Until then, nothing in the site should render these as
confirmed MW links.

## Files

- `runner.py` — vidyut-cheda segmentation; Python because the only solid
  Vidyut binding is the PyPI package. Exit codes: 0 ok, 1 usage, 2 vidyut
  missing, 3 data missing.
- `compare.ts` — pure comparison/alignment logic (transliteration,
  normalization, alignment, audit construction). No I/O, no dependencies.
- `audit.ts` — Bun CLI wrapping `compare.ts`; reads the corpus YAML +
  runner output, writes the audit. Exit codes: 0 ok, 1 usage, 4 runner
  output missing.
