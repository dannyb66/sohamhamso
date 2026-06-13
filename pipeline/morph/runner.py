#!/usr/bin/env python3
"""
sohamhamso — Vidyut-grounded morphology runner

Segments each verse of a corpus text with vidyut-cheda (Ambuda's Rust
Sanskrit toolkit, via the `vidyut` PyPI bindings) and emits deterministic
per-word analyses to `data/morph/{slug}.json`.

Contract (see pipeline/morph/README.md):
  - Input is the verbatim corpus YAML (`data/corpus/{slug}.yaml`).
  - Output is whatever vidyut-cheda actually produced — surface, lemma,
    morphological tags, and an MW headword *candidate* (the lemma in IAST,
    which is the Cologne MW lookup key; it is NOT verified against MW).
  - No LLM anywhere in this pipeline. If Vidyut is not installed or its
    linguistic data is missing, this runner explains the install path and
    exits nonzero. It never fabricates analyses.

Usage:
    python3 pipeline/morph/runner.py <text-slug> [--input iast|slp1]

    --input iast   (default) derive SLP1 input by transliterating the
                   verse `iast` field. Preferred: several corpus `slp1`
                   fields are Harvard-Kyoto-flavored (e.g. `ai` where SLP1
                   requires `E`), which corrupts segmentation.
    --input slp1   use the corpus `slp1` field verbatim.

Env:
    VIDYUT_DATA_DIR  path to Vidyut's linguistic data
                     (default: ~/.cache/sohamhamso/vidyut-data)

Exit codes:
    0  wrote data/morph/{slug}.json
    1  usage error / corpus YAML not found
    2  vidyut not installed (install instructions printed)
    3  Vidyut linguistic data missing (download instructions printed)
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
CORPUS = REPO / "data" / "corpus"
MORPH_OUT = REPO / "data" / "morph"

DEFAULT_DATA_DIR = Path.home() / ".cache" / "sohamhamso" / "vidyut-data"

INSTALL_HELP = """\
Vidyut is not installed for this Python interpreter.

Install (no Rust toolchain required — prebuilt wheels):

    uv venv pipeline/morph/.venv
    uv pip install --python pipeline/morph/.venv/bin/python vidyut ruamel.yaml
    pipeline/morph/.venv/bin/python pipeline/morph/runner.py <slug>

or plain pip:

    pip install vidyut ruamel.yaml

Then download the linguistic data (one-time, ~60 MB):

    python3 -c "import vidyut; vidyut.download_data('$HOME/.cache/sohamhamso/vidyut-data')"

See pipeline/morph/README.md. This runner will NOT fabricate analyses.
"""

DATA_HELP = """\
Vidyut's linguistic data was not found at: {path}

Download it (one-time, ~60 MB; fetched from the ambuda-org/vidyut GitHub
release matching the installed package version):

    python3 -c "import vidyut; vidyut.download_data('{path}')"

Or point VIDYUT_DATA_DIR at an existing download. The directory must
contain `cheda/`, `kosha/`, and `sandhi/` subdirectories.
"""

# ---------------------------------------------------------------------------
# Deterministic transliteration (IAST -> SLP1, SLP1 -> IAST). Pure mappings,
# no external dependency, so the runner's input handling is auditable.
# ---------------------------------------------------------------------------

_IAST_TO_SLP1 = [
    # multi-char first (order matters)
    ("ai", "E"), ("au", "O"),
    ("kh", "K"), ("gh", "G"), ("ch", "C"), ("jh", "J"),
    ("ṭh", "W"), ("ḍh", "Q"), ("th", "T"), ("dh", "D"),
    ("ph", "P"), ("bh", "B"),
    ("ā", "A"), ("ī", "I"), ("ū", "U"),
    ("ṝ", "F"), ("ṛ", "f"), ("ḹ", "X"), ("ḷ", "x"),
    ("ṅ", "N"), ("ñ", "Y"), ("ṭ", "w"), ("ḍ", "q"), ("ṇ", "R"),
    ("ś", "S"), ("ṣ", "z"), ("ṃ", "M"), ("ṁ", "M"), ("ḥ", "H"),
    ("ē", "e"), ("ō", "o"),
]

_SLP1_TO_IAST = {
    "A": "ā", "I": "ī", "U": "ū", "f": "ṛ", "F": "ṝ", "x": "ḷ", "X": "ḹ",
    "E": "ai", "O": "au",
    "K": "kh", "G": "gh", "C": "ch", "J": "jh",
    "W": "ṭh", "Q": "ḍh", "T": "th", "D": "dh", "P": "ph", "B": "bh",
    "N": "ṅ", "Y": "ñ", "w": "ṭ", "q": "ḍ", "R": "ṇ",
    "S": "ś", "z": "ṣ", "M": "ṃ", "H": "ḥ",
}


def iast_to_slp1(text):
    import unicodedata
    s = unicodedata.normalize("NFC", text).lower()
    for src, dst in _IAST_TO_SLP1:
        s = s.replace(src, dst)
    return s


def slp1_to_iast(text):
    return "".join(_SLP1_TO_IAST.get(ch, ch) for ch in text)


def clean_slp1_input(text):
    """Strip daṇḍas, verse numerals, and punctuation; keep SLP1 + spaces."""
    allowed = set("aAiIuUfFxXeEoOMHkKgGNcCjJYwWqQRtTdDnpPbBmyrlvSzsh' ")
    out = []
    for ch in text.replace("।", " ").replace("॥", " ").replace("-", " "):
        if ch in allowed:
            out.append(ch)
        elif ch.isspace():
            out.append(" ")
        # everything else (digits, devanagari numerals, brackets) dropped
    return " ".join("".join(out).split())


# ---------------------------------------------------------------------------
# Vidyut token -> plain dict (guarded: the cheda API is marked experimental)
# ---------------------------------------------------------------------------

def _enum_name(value):
    if value is None:
        return None
    s = str(value)
    return s.rsplit(".", 1)[-1] if "." in s else s


def token_to_analysis(token):
    surface = token.text
    lemma = token.lemma  # may be None for words absent from the kosha
    data = token.data
    pos = None
    tags = {}
    if data is not None:
        type_name = type(data).__name__
        if "Tinanta" in type_name:
            pos = "tinanta"
            for attr in ("purusha", "lakara", "prayoga", "vacana"):
                tags[attr] = _enum_name(getattr(data, attr, None))
        elif "Subanta" in type_name:
            pos = "subanta"
            for attr in ("linga", "vibhakti", "vacana"):
                tags[attr] = _enum_name(getattr(data, attr, None))
        elif "Avyaya" in type_name:
            pos = "avyaya"
        try:
            if getattr(data, "is_avyaya", False):
                pos = "avyaya"
        except Exception:
            pass
    lemma_iast = slp1_to_iast(lemma) if lemma else None
    return {
        "surface": surface,
        "lemma": lemma,
        "lemma_iast": lemma_iast,
        # MW lookup key candidate — NOT verified against the Cologne MW
        # headword list. See README ("MW headwords").
        "mw_headword_candidate": lemma_iast,
        "pos": pos,
        "tags": tags or None,
        "entry": repr(data) if data is not None else None,
    }


# ---------------------------------------------------------------------------
# Corpus iteration
# ---------------------------------------------------------------------------

def iter_verses(doc):
    for ch in doc.get("chapters", []) or []:
        ch_num = ch.get("chapter")
        for v in ch.get("verses", []) or []:
            vn = v.get("verse_num")
            if vn is None:
                vn = v.get("verse")
            if ch_num is None or vn is None:
                continue
            yield f"{int(ch_num)}.{int(vn)}", v


def main():
    import argparse

    parser = argparse.ArgumentParser(
        prog="pipeline/morph/runner.py",
        description="Vidyut-grounded morphology runner (see module docstring).",
    )
    parser.add_argument("slug", help="corpus text slug, e.g. siva-sutras")
    parser.add_argument(
        "--input",
        choices=("iast", "slp1"),
        default="iast",
        dest="input_mode",
        help="verse field to segment (default: iast, transliterated to SLP1)",
    )
    ns = parser.parse_args()
    slug = ns.slug
    input_mode = ns.input_mode

    yaml_path = CORPUS / f"{slug}.yaml"
    if not yaml_path.exists():
        sys.stderr.write(f"No corpus YAML at {yaml_path}\n")
        return 1

    # --- dependency gates: explain, never fabricate -----------------------
    try:
        import vidyut
        from vidyut.cheda import Chedaka
    except ImportError:
        sys.stderr.write(INSTALL_HELP)
        return 2

    data_dir = Path(os.environ.get("VIDYUT_DATA_DIR", str(DEFAULT_DATA_DIR)))
    if not (data_dir / "cheda").is_dir() or not (data_dir / "sandhi").is_dir():
        sys.stderr.write(DATA_HELP.format(path=data_dir))
        return 3

    try:
        from ruamel.yaml import YAML
    except ImportError:
        sys.stderr.write("ruamel.yaml required. pip install ruamel.yaml\n")
        return 2

    yaml = YAML(typ="safe")
    with open(yaml_path) as f:
        doc = yaml.load(f)

    chedaka = Chedaka(str(data_dir))

    verses = {}
    skipped = []
    for ref, v in iter_verses(doc):
        if input_mode == "iast" and v.get("iast"):
            raw = iast_to_slp1(v["iast"])
            source = "iast (transliterated to SLP1)"
        elif v.get("slp1"):
            raw = v["slp1"]
            source = "slp1 (verbatim corpus field)"
        elif v.get("iast"):
            raw = iast_to_slp1(v["iast"])
            source = "iast (transliterated to SLP1)"
        else:
            skipped.append(ref)
            continue
        cleaned = clean_slp1_input(raw)
        if not cleaned:
            skipped.append(ref)
            continue
        tokens = chedaka.run(cleaned)
        verses[ref] = {
            "ref": ref,
            "input": cleaned,
            "input_source": source,
            "tokens": [token_to_analysis(t) for t in tokens],
        }

    try:
        from importlib.metadata import version as pkg_version
        vidyut_version = pkg_version("vidyut")
    except Exception:
        vidyut_version = "unknown"

    out = {
        "text_slug": slug,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "tool": {
            "name": "vidyut-cheda",
            "package": "vidyut (PyPI)",
            "version": vidyut_version,
            "data_dir": str(data_dir),
        },
        "contract": "verbatim corpus in, deterministic vidyut-cheda analyses out, no LLM",
        "input_mode": input_mode,
        "verse_count": len(verses),
        "skipped_refs": skipped,
        "verses": verses,
    }

    MORPH_OUT.mkdir(parents=True, exist_ok=True)
    out_path = MORPH_OUT / f"{slug}.json"
    with open(out_path, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")

    print(f"[ok] {slug}: {len(verses)} verses analyzed, {len(skipped)} skipped -> {out_path}")
    print("Next (trust audit): bun pipeline/morph/audit.ts " + slug)
    return 0


if __name__ == "__main__":
    sys.exit(main())
