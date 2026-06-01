#!/usr/bin/env python3
"""Strip leading '[draft] ' marker from translation/gloss JSON files.

The marker was a per-verse agent signal meant to be consumed by the
ingest pipeline (which would set status='draft' on that row), but the
prefix was never stripped from the body — so it leaked into rendered
verse pages. This script cleans the source-of-truth JSON in-place.

Idempotent. Run as: `python3 pipeline/clean-draft-prefix.py`.

Per-verse status (already set by ingest based on the prefix) is unchanged
in the DB; only the visible text body is normalized. V1's AI-badge state
matrix surfaces both ai_assisted=true × {draft,published} with the same
amber pill, so no UX downgrade.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIRS = [ROOT / "data" / "translations", ROOT / "data" / "glosses"]
CORPUS_DIR = ROOT / "data" / "corpus"
PREFIX = re.compile(r"^\s*\[draft\]\s+", re.IGNORECASE)
INLINE = re.compile(r"\s*\[draft\]\s*", re.IGNORECASE)
COLLAPSE_WS = re.compile(r"  +")


def strip_prefix(s: str) -> tuple[str, bool]:
    new = PREFIX.sub("", s)
    # Some agents inlined [draft] mid-clause as a per-segment uncertainty
    # signal. Strip those too — the row's AI-amber badge already conveys
    # the uncertainty at row granularity. Collapse any double spaces left
    # behind so the prose stays clean.
    new = INLINE.sub(" ", new)
    new = COLLAPSE_WS.sub(" ", new).strip()
    return new, new != s


def walk_translations(payload: dict) -> int:
    verses = payload.get("verses", {})
    n = 0
    for k, v in list(verses.items()):
        if isinstance(v, str):
            cleaned, changed = strip_prefix(v)
            if changed:
                verses[k] = cleaned
                n += 1
    return n


def walk_glosses(payload: dict) -> int:
    verses = payload.get("verses", {})
    n = 0
    for k, entries in list(verses.items()):
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            gloss = entry.get("gloss_text")
            if isinstance(gloss, str):
                cleaned, changed = strip_prefix(gloss)
                if changed:
                    entry["gloss_text"] = cleaned
                    n += 1
    return n


def clean_yaml_corpus() -> tuple[int, int]:
    """Round-trip clean every YAML file in data/corpus/. Uses ruamel.yaml
    so block-scalar / flow-scalar formatting + comments are preserved."""
    try:
        from ruamel.yaml import YAML
    except ImportError:
        print("ruamel.yaml not available — skipping YAML corpus cleanup", file=sys.stderr)
        return (0, 0)

    yaml = YAML()
    yaml.preserve_quotes = True
    yaml.width = 10_000  # disable line wrapping
    files = 0
    changes = 0

    def walk(node) -> int:
        nonlocal_changes = 0
        if isinstance(node, dict):
            for k, v in list(node.items()):
                if isinstance(v, str) and "[draft]" in v.lower():
                    cleaned, ch = strip_prefix(v)
                    if ch:
                        node[k] = cleaned
                        nonlocal_changes += 1
                else:
                    nonlocal_changes += walk(v)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                if isinstance(v, str) and "[draft]" in v.lower():
                    cleaned, ch = strip_prefix(v)
                    if ch:
                        node[i] = cleaned
                        nonlocal_changes += 1
                else:
                    nonlocal_changes += walk(v)
        return nonlocal_changes

    for path in sorted(CORPUS_DIR.glob("*.yaml")):
        with path.open("r", encoding="utf-8") as f:
            data = yaml.load(f)
        n = walk(data)
        if n > 0:
            with path.open("w", encoding="utf-8") as f:
                yaml.dump(data, f)
            files += 1
            changes += n
            print(f"  {path.relative_to(ROOT)} — {n} entries")
    return files, changes


def main() -> int:
    total_files = 0
    total_changes = 0
    for root in DATA_DIRS:
        if not root.exists():
            continue
        is_translations = root.name == "translations"
        for path in sorted(root.rglob("*.json")):
            payload = json.loads(path.read_text(encoding="utf-8"))
            n = walk_translations(payload) if is_translations else walk_glosses(payload)
            if n > 0:
                path.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
                total_files += 1
                total_changes += n
                print(f"  {path.relative_to(ROOT)} — {n} entries")
    print(f"\nJSON: cleaned {total_changes} entries across {total_files} files")

    yf, yc = clean_yaml_corpus()
    print(f"YAML: cleaned {yc} entries across {yf} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
