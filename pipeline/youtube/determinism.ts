/**
 * pipeline/youtube/determinism.ts
 *
 * Determinism contract helper (E1): the md5 of a translation's text is
 * stamped into `videos.translation_md5`. When the upstream translation is
 * edited the md5 changes, which cascades a re-render (see
 * `videos-db.ts::shouldSkipRender`).
 *
 * Pure + import-light: only node `crypto`. Unit-tested separately.
 */

import { createHash } from 'node:crypto';

/** md5 hex digest of a translation's text. */
export function translationMd5(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * One verse's provenance entry in a chapter's content manifest (the same
 * manifest the render engine writes to the `.meta.json` sidecar). Hashing the
 * MANIFEST — not just the text tuples — means a translation-row swap or a
 * voice change also cascades a chapter re-render (eng decision #17).
 */
export type ChapterManifestEntry = {
  verse_num: number;
  devanagari: string;
  iast: string;
  translation_text: string;
  translation_row_id: number;
  tts_voice_id: string;
};

/**
 * Chapter content hash stored in `videos.translation_md5` for
 * `format='chapter'` rows: md5 of the JSON-serialized manifest IN THE GIVEN
 * ORDER. The caller sorts by `verse_num` before hashing — order is part of
 * the contract (a reordering must cascade a re-render).
 */
export function chapterContentMd5(manifest: ChapterManifestEntry[]): string {
  return createHash('md5').update(JSON.stringify(manifest), 'utf8').digest('hex');
}
