/**
 * pipeline/youtube/filename.ts
 *
 * R2 object-key builder. Layout (hash-addressed, immutable):
 *
 * Shorts:
 *   videos/<text_id>/<chapter>/<verse_num>/<lang>/<md5>.mp4
 *   …/<md5>.thumb.jpg
 *   …/<md5>.meta.json
 *
 * Chapter videos (format 2 — md5 = chapterContentMd5 of the manifest):
 *   chapters/<text_id>/<chapter>/<lang>/<md5>.mp4
 *   …/<md5>.meta.json   (timestamp/provenance sidecar — atomic pair w/ mp4)
 *
 * The two layouts live under disjoint top-level prefixes (`videos/` vs
 * `chapters/`) so they can never collide.
 *
 * Pure — no imports. Unit-tested separately.
 */

export interface VideoR2Ident {
  text_id: string;
  chapter: number;
  verse_num: number;
  lang: string;
}

function prefix(ident: VideoR2Ident, md5: string): string {
  return `videos/${ident.text_id}/${ident.chapter}/${ident.verse_num}/${ident.lang}/${md5}`;
}

/** R2 key for the rendered MP4. */
export function buildR2Key(ident: VideoR2Ident, md5: string): string {
  return `${prefix(ident, md5)}.mp4`;
}

/** R2 key for the thumbnail JPEG. */
export function thumbKey(ident: VideoR2Ident, md5: string): string {
  return `${prefix(ident, md5)}.thumb.jpg`;
}

/** R2 key for the sidecar metadata JSON. */
export function metaKey(ident: VideoR2Ident, md5: string): string {
  return `${prefix(ident, md5)}.meta.json`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chapter-format keys (16:9 full-chapter videos; rows use verse_num=0)
// ─────────────────────────────────────────────────────────────────────────────

export interface ChapterR2Ident {
  text_id: string;
  chapter: number;
  lang: string;
}

function chapterPrefix(ident: ChapterR2Ident, md5: string): string {
  return `chapters/${ident.text_id}/${ident.chapter}/${ident.lang}/${md5}`;
}

/** R2 key for a rendered chapter MP4. `md5` = chapterContentMd5(manifest). */
export function buildChapterR2Key(parts: ChapterR2Ident, md5: string): string {
  return `${chapterPrefix(parts, md5)}.mp4`;
}

/**
 * R2 key for a chapter's `.meta.json` sidecar (per-verse timestamps +
 * provenance). Uploaded as an ATOMIC PAIR with the mp4: a row is never
 * approved unless both objects landed.
 */
export function chapterMetaKey(parts: ChapterR2Ident, md5: string): string {
  return `${chapterPrefix(parts, md5)}.meta.json`;
}
