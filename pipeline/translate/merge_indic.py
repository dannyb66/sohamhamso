#!/usr/bin/env python3
"""
Merge per-language Indic translation JSON files into the corpus YAML.

Reads files matching `data/translations/{text-slug}/{lang}.json` (whole-text
shards) or `data/translations/{text-slug}/{lang}/ch{N}.json` (per-chapter
shards, as produced by the Phase 2 dispatch fan-out) and adds each verse's
translation to the corresponding `translations:` array in
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
    "model": "claude-opus-4-7",
    "model_version": "claude-opus-4-7-20251115",
    "verses": {
      "1.1": "हिन्दी पाठ ...",
      "1.2": "...",
      ...
    }
  }

`model`/`model_version` are read from the shard (provenance travels with the
data, never hardcoded here). Older shards without a `model` key fall back to
the parenthesised model in `translator`, e.g.
"sohamhamso (claude-opus-4-7)" -> "claude-opus-4-7".

Verses prefixed with "[draft] " in the JSON downgrade to status='draft'
in the YAML (the prefix is stripped). Idempotent — re-running replaces
existing translations for the same (verse, lang) pair without
duplicating.

Hardening:
  - per-chapter shard dirs are validated for completeness BEFORE merging:
    every chapter in the corpus YAML must have a ch{N}.json, else exit 1
    listing the missing chapters
  - verse keys with no matching verse in the YAML (and any other skip) are
    FATAL: the YAML is not written and the script exits 1
  - a shard missing its "lang" key fails with a clean error, not a traceback

Uses ruamel.yaml to round-trip cleanly (same approach as
`pipeline/backfill/patcher.py`).

Usage:
    python3 pipeline/translate/merge_indic.py [text-slug]

With no argument, merges all `data/translations/*/` directories.

Env (for tests):
    SOHAMHAMSO_CORPUS_DIR  override data/corpus
    SOHAMHAMSO_TRANS_DIR   override data/translations
"""
import json
import os
import re
import sys
from pathlib import Path

try:
    from ruamel.yaml import YAML
except ImportError:
    sys.stderr.write("ruamel.yaml required. pip install ruamel.yaml\n")
    sys.exit(1)


REPO = Path(__file__).resolve().parents[2]
CORPUS = Path(os.environ.get("SOHAMHAMSO_CORPUS_DIR") or REPO / "data" / "corpus")
TRANS = Path(os.environ.get("SOHAMHAMSO_TRANS_DIR") or REPO / "data" / "translations")

CHAPTER_SHARD_RE = re.compile(r"^ch(\d+)\.json$")


class MergeError(Exception):
    """Fatal merge problem — message is printed without a traceback."""


def load_yaml_rt(path):
    yaml = YAML(typ="rt")
    yaml.preserve_quotes = True
    yaml.width = 4096
    with open(path) as f:
        return yaml, yaml.load(f)


def shard_model(data, shard_path):
    """model/model_version from the shard JSON; legacy fallback via translator."""
    model = data.get("model")
    if model is None:
        # Legacy whole-text shards encode the model in the translator label,
        # e.g. "sohamhamso (claude-opus-4-7)".
        m = re.search(r"\(([^()]+)\)\s*$", data.get("translator") or "")
        if m:
            model = m.group(1)
    if model is None:
        raise MergeError(f"{shard_path}: no 'model' key and none derivable from 'translator'")
    return model, data.get("model_version")


def collect_shards(json_dir, slug, expected_chapters):
    """
    Return a list of shard JSON paths, supporting both layouts:
      {lang}.json           whole-text shard
      {lang}/ch{N}.json     per-chapter shards (must cover ALL chapters)

    Chapter completeness is validated per lang BEFORE any merging happens.
    """
    shards = sorted(json_dir.glob("*.json"))
    errors = []
    for lang_dir in sorted(p for p in json_dir.iterdir() if p.is_dir()):
        chapter_files = {}
        for p in sorted(lang_dir.glob("*.json")):
            m = CHAPTER_SHARD_RE.match(p.name)
            if not m:
                errors.append(f"{slug}/{lang_dir.name}: unrecognised shard name {p.name}")
                continue
            chapter_files[int(m.group(1))] = p
        missing = sorted(expected_chapters - set(chapter_files))
        if missing:
            errors.append(
                f"{slug}/{lang_dir.name}: missing chapter shard(s) "
                f"{', '.join(f'ch{n}.json' for n in missing)}"
            )
            continue
        shards.extend(chapter_files[n] for n in sorted(chapter_files))
    if errors:
        raise MergeError("\n".join(errors))
    return shards


def merge_one_text(slug):
    yaml_path = CORPUS / f"{slug}.yaml"
    if not yaml_path.exists():
        print(f"[skip] {slug}: no corpus YAML at {yaml_path}")
        return 0, 0

    json_dir = TRANS / slug
    if not json_dir.is_dir():
        print(f"[skip] {slug}: no translations dir at {json_dir}")
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

    expected_chapters = {int(ch.get("chapter")) for ch in chapters}
    json_files = collect_shards(json_dir, slug, expected_chapters)
    if not json_files:
        print(f"[skip] {slug}: no JSON files in {json_dir}")
        return 0, 0

    added = 0
    replaced = 0
    errors = []

    for jf in json_files:
        with open(jf) as f:
            data = json.load(f)
        if "lang" not in data:
            errors.append(f"{jf}: malformed shard — missing required 'lang' key")
            continue
        lang = data["lang"]
        translator = data["translator"]
        license_ = data.get("license", "CC-BY-SA")
        prompt_version = data.get("prompt_version", "v1-sanskrit-grounded")
        ai_assisted = data.get("ai_assisted", True)
        default_status = data.get("status", "published")
        try:
            model, model_version = shard_model(data, jf)
        except MergeError as e:
            errors.append(str(e))
            continue

        for vkey, text in data.get("verses", {}).items():
            try:
                ch_str, vn_str = vkey.split(".", 1)
                key = (int(ch_str), int(vn_str))
            except (ValueError, AttributeError):
                errors.append(f"{jf}: unparseable verse key {vkey!r}")
                continue
            v = verse_index.get(key)
            if v is None:
                errors.append(f"{jf}: {slug} {vkey}: no matching verse in YAML")
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
                "model": model,
                "prompt_version": prompt_version,
            }
            if model_version is not None:
                entry["model_version"] = model_version

            if existing_idx is not None:
                trans_list[existing_idx] = entry
                replaced += 1
            else:
                trans_list.append(entry)
                added += 1

    if errors:
        # Verse-level misses are FATAL: a silent partial merge would publish a
        # corpus with holes. Leave the YAML untouched.
        raise MergeError("\n".join(errors) + f"\n[fatal] {slug}: YAML not written")

    # Write back
    with open(yaml_path, "w") as f:
        yaml.dump(doc, f)

    print(f"[ok] {slug}: +{added} new, ~{replaced} replaced")
    return added, replaced


def main():
    args = sys.argv[1:]
    if args:
        slugs = args
    else:
        slugs = sorted(
            {p.parent.name for p in TRANS.glob("*/*.json")}
            | {p.parent.parent.name for p in TRANS.glob("*/*/*.json")}
        )

    if not slugs:
        print("No translations to merge.")
        return

    total_added = 0
    total_replaced = 0
    failed = False
    for slug in slugs:
        try:
            a, r = merge_one_text(slug)
        except MergeError as e:
            sys.stderr.write(f"{e}\n")
            failed = True
            continue
        total_added += a
        total_replaced += r
    print(f"\nTotal: +{total_added} added, ~{total_replaced} replaced")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
