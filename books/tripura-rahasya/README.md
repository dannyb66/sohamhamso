# Tripura Rahasya (book series)

Sanskrit to English translation of the *Tripura Rahasya* (also known as the
Haritayana Samhita), a dialogue between Dattatreya and Parashurama, published
by **Soham Hamso** in three parts. Every verse is given in Devanagari, Roman
transliteration, word-to-word meaning and English translation.

> © Soham Hamso. All rights reserved. These files are provided for reference
> and archival purposes and are **not** covered by this repository's MIT or
> CC-BY-SA 4.0 terms. See [`../LICENSE.md`](../LICENSE.md).

| Part | Chapters | Status | Format |
|---|---|---|---|
| Part 1 | 1–11 | Published 14 Aug 2024, Notion Press. ISBN 979-8895440872, ASIN B0DD3RNKRB | 6 x 9 in, 482 pages |
| Part 2 | 12–17 (594 verses) | Draft in Notion Press, not submitted | 6 x 9 in, 313-page interior PDF |
| Part 3 | 18–22 (663 verses) | Interior built; cover not chosen; not published | 6 x 9 in, 345-page interior PDF |

Parts 2 and 3 come from one source manuscript (Chapters 12–22) that was split
into two books. A Hindi edition of Part 2 is in draft.

Each part's `metadata.md` has the listing details, descriptions and cover notes.

## Files

### Part 1 (`part-1/`)

| File | Description |
|---|---|
| `metadata.md` | Amazon title, description, back-cover verse, listing facts and a 23 Nov 2026 listing snapshot. |
| `tripura_rahasya_part1_manuscript.docx` | Translation manuscript, Chapters 1–11. |
| `tripura_rahasya_part1_interior_6x9.docx` | The 6x9 interior that was printed. |
| `tripura_rahasya_part1_interior_6x9_print_2024-08-13.pdf` | Word export of the 6x9 interior, 481 pages (original name `TRIPURA RAHASYA FINAL 1.pdf`). |
| `drafts/tripura_rahasya_part1_interior_8.5x11_draft.docx` | 8.5x11 layout, not used. |
| `drafts/tripura_rahasya_part1_ch1_draft_google_docs.pdf` | Early 10-page Google Docs draft of Chapter 1. |

The Part 1 cover art is a third-party painting and is not included.

### Part 2 (`part-2/`)

| File | Description |
|---|---|
| `metadata.md` | Notion Press metadata: title, category, keywords, prices, description, author bio, cover specification, interior notes, known TOC issue. |
| `tripura_rahasya_part2_source_manuscript_ch12-22.docx` | Original combined manuscript, Chapters 12–22, before the split. |
| `tripura_rahasya_part2_interior_6x9.docx` | Part 2 interior, Chapters 12–17. |
| `tripura_rahasya_part2_interior_6x9.pdf` | Word export of the Part 2 interior, 313 pages (TOC stale; see metadata). |
| `part2-3_change_report.md` | Changes applied when splitting and normalising Parts 2 and 3, and points flagged for review. |
| `part2-3_cover_guide.md` | Notion Press Cover Creator guide and series design plan for Parts 2 and 3. |
| `cover/part2_cover_art_final_avadhuta_1875x2775_300dpi.jpg` | Final front-cover art uploaded to Notion (1875 x 2775 px, 300 dpi). |
| `cover/part2_cover_art_master_avadhuta_3392x5020.jpg` | Full-resolution master of the cover art. |
| `cover/part2_front_mockup_a_part1_layout.jpg` | Front-cover mockup using the Part 1 layout. |
| `cover/part2_front_mockup_b_split_layout.jpg` | Front-cover mockup with a split layout. |
| `cover/notion_cover_creator_final.png` | Screenshot of the saved cover in Notion Cover Creator. |
| `hindi/tripura_rahasya_part2_interior_6x9_hindi.docx` | Hindi edition interior, Chapters 12–17. |
| `hindi/tripura_rahasya_part2_interior_6x9_hindi.pdf` | Word export of the Hindi interior, 308 pages. |
| `hindi/hindi_sample_3_verses.docx` | 3-verse Hindi sample. |
| `hindi/hindi_sample_3_verses_preview.pdf` | PDF preview of the 3-verse sample. |
| `hindi/hindi_sample_10_verses.docx` | 10-verse Hindi sample. |
| `hindi/hindi_sample_10_verses_preview.pdf` | PDF preview of the 10-verse sample. |
| `hindi/hindi_translation_report.md` | Hindi translation rules and verification notes. |

### Part 3 (`part-3/`)

| File | Description |
|---|---|
| `metadata.md` | Status, chapter titles, cover recommendation, known TOC issue. |
| `tripura_rahasya_part3_interior_6x9.docx` | Part 3 interior, Chapters 18–22. |
| `tripura_rahasya_part3_interior_6x9.pdf` | Word export of the Part 3 interior, 345 pages (TOC stale; see metadata). |
| `cover-options/P3_A1_ravi_varma_manidvipa.jpg` | Cover option A1. |
| `cover-options/P3_A2_mysore_rajarajeshwari.jpg` | Cover option A2. |
| `cover-options/P3_A3_sri_chakra_cosmic.jpg` | Cover option A3. |
| `cover-options/P3_B1_pahari_vision_above.jpg` | Cover option B1. |
| `cover-options/P3_B2_oleograph_sky_vision.jpg` | Cover option B2. |
| `cover-options/P3_B3_paubha_mirror.jpg` | Cover option B3. |
| `cover-options/P3_C1_pahari_combined.jpg` | Cover option C1. |
| `cover-options/P3_C2_mysore_combined.jpg` | Cover option C2. |
| `cover-options/P3_C3_pahari_dusk_combined.jpg` | Cover option C3 (recommended, with fixes). |
| `cover-options/part3_tripura_sundari_research.md` | Iconography and source research for the Part 3 cover. |

### Build scripts (`build-scripts/`)

| File | Description |
|---|---|
| `README.md` | Usage and what each step does. |
| `parse.py` | Parses the source manuscript into JSON. |
| `normalize.py` | Applies the approved clean-ups and writes a change report. |
| `build_keep.py` | Builds a 6x9 interior DOCX with verses kept whole across pages. |
| `build.py` | Earlier builder without keep-together rules. |
| `an.py` | Prints the layout and style details of a DOCX. |
| `p2.json`, `p2n.json`, `p2n_report.json` | Parsed data, normalised data and normalisation report. |
| `pk2.json`, `pk3.json` | Chapter start-page maps for Parts 2 and 3. |

## How the Part 2 and Part 3 interiors were built

1. `parse.py` read the Chapter 12–22 manuscript into structured JSON.
2. `normalize.py` applied the approved clean-ups (word-meaning commas to semicolons, dash normalisation, splitting merged lines, a Chapter 13 stray-text fix). All Devanagari lines are byte-for-byte unchanged.
3. `build_keep.py` generated each interior from the printed Part 1 6x9 interior as a template: 6 x 9 in trim, mirrored margins with a 204-twip gutter, Calibri with Mangal for Devanagari, recto chapter starts, and keep-together rules so no verse is split across pages.
4. Word was used to export the PDFs. The table of contents in both exported PDFs needs a field update before upload (see each part's `metadata.md`).
