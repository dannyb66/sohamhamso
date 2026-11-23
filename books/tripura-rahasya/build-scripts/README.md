# Build scripts: Parts 2 and 3 interiors

Python 3 scripts (needs `python-docx` and `lxml`) that turned the combined
Chapter 12–22 manuscript into the two 6x9 interiors, using the printed
Part 1 6x9 interior as the layout template.

This folder is named `build-scripts/` rather than `build/` because the
repository's root `.gitignore` ignores every `build/` directory.

| File | Purpose |
|---|---|
| `parse.py` | `python3 parse.py SOURCE.docx p2.json`: parses the manuscript into chapters and verses (Devanagari, transliteration, word meaning, translation) and logs anything it cannot place. |
| `normalize.py` | `python3 normalize.py p2.json p2n.json`: applies the approved clean-ups and writes `p2n_report.json` alongside. |
| `build_keep.py` | Final builder (see below). |
| `build.py` | Earlier builder without the keep-together rules; kept for reference. |
| `an.py` | `python3 an.py FILE.docx ...`: prints page size, margins, sections, headers/footers, styles and fonts of a DOCX, used to analyse the template. |
| `p2.json` | Parsed manuscript (Chapters 12–22). |
| `p2n.json` | Normalised data that the interiors were built from. |
| `p2n_report.json` | Every change `normalize.py` made, plus flags and errors. |
| `pk2.json`, `pk3.json` | Chapter start-page maps passed to `build_keep.py` for Parts 2 and 3 (used for the table of contents page numbers). |

## What `normalize.py` does

- Word-meaning lines: commas between word–meaning pairs become semicolons (Part 1 style).
- Dash normalisation in word-meaning lines.
- Splits lines that had been merged (for example two Devanagari or transliteration lines in one paragraph).
- Removes stray pasted text at the end of Chapter 13.

## `build_keep.py`

```
python3 build_keep.py TEMPLATE p2n.json OUT.docx PARTLABEL CHFROM CHTO LOG PAGEMAP.json
```

For example, Part 2:

```
python3 build_keep.py "TRIPURA RAHASYA 6x9_Interior_Template.docx" p2n.json P2.docx 2 12 17 k2_log.json pk2.json
```

- `PARTLABEL` is the part number only (the script writes `(PART <PARTLABEL>)` on the title page).
- Copies paragraph formatting from the Part 1 6x9 template.
- Adds keep-with-next and keep-lines-together so a verse is never split across pages.
- 6 x 9 in trim, mirrored margins (inside 1094, outside 864, top/bottom 1094 twips), gutter 204 twips.
- Calibri for Latin text, Mangal for Devanagari.
- Chapters start on a recto page; TOC field `TOC \o "1-1" \h \z \u`.

After building, open the DOCX in Word, update the TOC field and export the PDF.
