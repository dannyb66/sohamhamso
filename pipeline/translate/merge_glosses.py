#!/usr/bin/env python3
"""
Merge per-language gloss JSON files into the corpus YAML.

Reads files matching `data/glosses/{text-slug}/{lang}.json` and adds a
`gloss_{lang}: "..."` field to each word_gloss entry in the corresponding
YAML, matching by word_idx.

Each JSON shape:
  {
    "text_slug": "pratyabhijna-hrdayam",
    "lang": "hi",
    "verses": {
      "1.1": [
        { "word_idx": 0, "gloss_text": "हिन्दी अनुवाद ..." },
        { "word_idx": 1, "gloss_text": "..." }
      ],
      ...
    }
  }

Verses prefixed with "[draft] " in gloss_text strip the prefix on merge.
Idempotent — re-running replaces the same `gloss_{lang}` field cleanly.

Paired with ingest.ts logic that detects `gloss_{lang}` (2-letter ISO)
on each word and emits a row per language to the word_glosses table.

Usage:
    python3 pipeline/translate/merge_glosses.py [text-slug]

With no argument, merges all `data/glosses/*/` directories.
"""
import json
import sys
from pathlib import Path

try:
    from ruamel.yaml import YAML
except ImportError:
    sys.stderr.write("ruamel.yaml required. pip install ruamel.yaml\n")
    sys.exit(1)


REPO = Path(__file__).resolve().parents[2]
CORPUS = REPO / "data" / "corpus"
GLOSSES = REPO / "data" / "glosses"


def load_yaml_rt(path):
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    yaml.width = 4096
    with open(path) as f:
        return yaml, yaml.load(f)


def merge_one_text(slug):
    yaml_path = CORPUS / f"{slug}.yaml"
    if not yaml_path.exists():
        print(f"[skip] {slug}: no corpus YAML at {yaml_path}")
        return 0, 0

    json_dir = GLOSSES / slug
    if not json_dir.is_dir():
        print(f"[skip] {slug}: no glosses dir at {json_dir}")
        return 0, 0

    json_files = sorted(json_dir.glob("*.json"))
    if not json_files:
        print(f"[skip] {slug}: no JSON files in {json_dir}")
        return 0, 0

    yaml, doc = load_yaml_rt(yaml_path)
    chapters = doc.get("chapters", [])

    # Build index: (chapter, verse_num) -> verse dict
    verse_index = {}
    for ch in chapters:
        ch_num = ch.get("chapter")
        for v in ch.get("verses", []):
            vn = v.get("verse_num") or v.get("verse")
            verse_index[(int(ch_num), int(vn))] = v

    added = 0
    replaced = 0
    skipped = 0

    for jf in json_files:
        with open(jf) as f:
            data = json.load(f)
        lang = data["lang"]
        if lang == "en":
            print(f"  ! {slug}: skipping en glosses (already in YAML as gloss_en)")
            continue
        gloss_key = f"gloss_{lang}"

        for vkey, entries in data.get("verses", {}).items():
            try:
                ch_str, vn_str = vkey.split(".", 1)
                key = (int(ch_str), int(vn_str))
            except (ValueError, AttributeError):
                skipped += 1
                continue
            v = verse_index.get(key)
            if v is None:
                print(f"  ! {slug} {vkey}: no matching verse in YAML")
                skipped += 1
                continue

            word_glosses = v.get("word_glosses", [])
            if not isinstance(word_glosses, list):
                continue

            # Build idx → entry index map for the YAML
            idx_to_entry = {}
            for i, g in enumerate(word_glosses):
                if not isinstance(g, dict):
                    continue
                gi = g.get("word_idx")
                if gi is None:
                    gi = i  # default to array index
                idx_to_entry[int(gi)] = g

            if not isinstance(entries, list):
                skipped += 1
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    skipped += 1
                    continue
                widx = entry.get("word_idx")
                if widx is None:
                    skipped += 1
                    continue
                text = entry.get("gloss_text") or ""
                if not isinstance(text, str):
                    skipped += 1
                    continue
                # Strip [draft] prefix; mark by leaving as-is (gloss_lang draft
                # currently has no clean per-field status — keep value, the
                # whole YAML word_gloss row stays at the text's default status).
                if text.startswith("[draft] "):
                    text = text[len("[draft] "):]

                g = idx_to_entry.get(int(widx))
                if g is None:
                    skipped += 1
                    continue
                if gloss_key in g:
                    g[gloss_key] = text
                    replaced += 1
                else:
                    g[gloss_key] = text
                    added += 1

    # Write back
    with open(yaml_path, "w") as f:
        yaml.dump(doc, f)

    print(f"[ok] {slug}: +{added} new, ~{replaced} replaced, {skipped} skipped")
    return added, replaced


def main():
    args = sys.argv[1:]
    if args:
        slugs = args
    else:
        slugs = sorted({p.parent.name for p in GLOSSES.glob("*/*.json")})

    if not slugs:
        print("No glosses to merge.")
        return

    total_added = 0
    total_replaced = 0
    for slug in slugs:
        a, r = merge_one_text(slug)
        total_added += a
        total_replaced += r
    print(f"\nTotal: +{total_added} added, ~{total_replaced} replaced")


if __name__ == "__main__":
    main()
