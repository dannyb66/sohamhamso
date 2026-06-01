#!/usr/bin/env python3
"""
YAML round-trip patcher: replaces `word_glosses` arrays for specified verses
in the four corpus files, preserving every other byte of the file.

Reads hand-authored gloss data from `gloss_data.py` and applies it to the
corpus YAMLs in place.

Usage:
    python3 pipeline/backfill/patcher.py            # apply to all files
    python3 pipeline/backfill/patcher.py --dry-run  # show what would change
"""

from __future__ import annotations
import sys
import argparse
import io
import os
import importlib.util
from pathlib import Path

sys.path.insert(0, '/Users/danny/Library/Python/3.9/lib/python/site-packages')
sys.path.insert(0, os.path.dirname(__file__))

from ruamel.yaml import YAML  # noqa: E402


ROOT = Path(__file__).resolve().parents[2]
CORPUS = ROOT / "data" / "corpus"

FILES = {
    "pratyabhijna-hrdayam": CORPUS / "pratyabhijna-hrdayam.yaml",
    "siva-sutras": CORPUS / "siva-sutras.yaml",
    "spanda-karikas": CORPUS / "spanda-karikas.yaml",
    "vijnana-bhairava-tantra": CORPUS / "vijnana-bhairava-tantra.yaml",
}


def make_yaml() -> YAML:
    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 100000  # never wrap long lines
    yaml.indent(mapping=2, sequence=4, offset=2)

    def represent_none(self, data):  # noqa: ANN001
        return self.represent_scalar('tag:yaml.org,2002:null', 'null')

    yaml.representer.add_representer(type(None), represent_none)
    return yaml


def load_gloss_data():
    """Import gloss_data module fresh each run."""
    path = Path(__file__).parent / "gloss_data.py"
    spec = importlib.util.spec_from_file_location("gloss_data", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.GLOSSES  # dict[(file_id, chapter, verse_num)] -> list[dict]


def apply_to_file(file_id: str, path: Path, glosses_by_key: dict, dry_run: bool) -> tuple[int, int]:
    """Returns (verses_patched, total_glosses_added)."""
    yaml = make_yaml()
    with open(path) as f:
        data = yaml.load(f)

    patched = 0
    total_added = 0

    for ch in data.get("chapters", []):
        chap = ch.get("chapter")
        for v in ch.get("verses", []):
            num = v.get("verse_num") or v.get("verse")
            key = (file_id, chap, num)
            if key not in glosses_by_key:
                continue
            new = glosses_by_key[key]
            if not new:
                continue
            old_count = len(v.get("word_glosses") or [])
            v["word_glosses"] = new
            patched += 1
            total_added += len(new) - old_count

    if dry_run:
        print(f"[dry-run] {file_id}: would patch {patched} verses, +{total_added} glosses net")
        return patched, total_added

    buf = io.StringIO()
    yaml.dump(data, buf)
    out = buf.getvalue()
    with open(path, "w") as f:
        f.write(out)
    print(f"  wrote {file_id}: patched {patched} verses, +{total_added} glosses net")
    return patched, total_added


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--only", help="restrict to a single file id")
    args = p.parse_args()

    all_glosses = load_gloss_data()
    # group by file
    by_file: dict[str, dict] = {fid: {} for fid in FILES}
    for (fid, chap, num), entries in all_glosses.items():
        by_file.setdefault(fid, {})[(fid, chap, num)] = entries

    total_v, total_g = 0, 0
    for fid, path in FILES.items():
        if args.only and fid != args.only:
            continue
        if not path.exists():
            print(f"  SKIP missing: {path}")
            continue
        v, g = apply_to_file(fid, path, by_file.get(fid, {}), args.dry_run)
        total_v += v
        total_g += g
    print(f"\nTotal: {total_v} verses patched, +{total_g} glosses net")


if __name__ == "__main__":
    main()
