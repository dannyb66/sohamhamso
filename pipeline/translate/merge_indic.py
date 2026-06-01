#!/usr/bin/env python3
"""
Merge per-language Indic translation JSON files into the corpus YAML.

Reads files matching `data/translations/{text-slug}/{lang}.json` and adds
each verse's translation to the corresponding `translations:` array in
`data/corpus/{text-slug}.yaml`.

Each JSON looks like:
  {
    "text_slug": "karpuradi-stotra",
    "lang": "hi",
    "translator": "sohamhamso (claude-opus-4-7)",
    "license": "CC-BY-SA",
    "prompt_version": "v1-sanskrit-grounded",
    "ai_assisted": true,
    "status": "published",
    "verses": {
      "1.1": "हिन्दी पाठ ...",
      "1.2": "...",
      ...
    }
  }

Verses prefixed with "[draft] " in the JSON downgrade to status='draft'
in the YAML (the prefix is stripped). Idempotent — re-running replaces
existing translations for the same (verse, lang) pair without
duplicating.

Uses ruamel.yaml to round-trip cleanly (same approach as
`pipeline/backfill/patcher.py`).

Usage:
    python3 pipeline/translate/merge_indic.py [text-slug]

With no argument, merges all `data/translations/*/` directories.
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
TRANS = REPO / "data" / "translations"


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

    json_dir = TRANS / slug
    if not json_dir.is_dir():
        print(f"[skip] {slug}: no translations dir at {json_dir}")
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
        translator = data["translator"]
        license_ = data.get("license", "CC-BY-SA")
        prompt_version = data.get("prompt_version", "v1-sanskrit-grounded")
        ai_assisted = data.get("ai_assisted", True)
        default_status = data.get("status", "published")

        for vkey, text in data.get("verses", {}).items():
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

            # Strip [draft] prefix and downgrade status
            status = default_status
            if isinstance(text, str) and text.startswith("[draft] "):
                text = text[len("[draft] "):]
                status = "draft"

            # Get or create translations array
            trans_list = v.setdefault("translations", [])

            # Look for existing (lang) entry
            existing_idx = None
            for i, t in enumerate(trans_list):
                if t.get("lang") == lang:
                    existing_idx = i
                    break

            entry = {
                "lang": lang,
                "translator": translator,
                "license": license_,
                "text": text,
                "ai_assisted": ai_assisted,
                "status": status,
                "model": "claude-opus-4-7",
                "prompt_version": prompt_version,
            }

            if existing_idx is not None:
                trans_list[existing_idx] = entry
                replaced += 1
            else:
                trans_list.append(entry)
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
        slugs = sorted({p.parent.name for p in TRANS.glob("*/*.json")})

    if not slugs:
        print("No translations to merge.")
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
