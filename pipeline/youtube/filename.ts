/**
 * pipeline/youtube/filename.ts
 *
 * R2 object-key builder. Layout (hash-addressed, immutable):
 *   videos/<text_id>/<chapter>/<verse_num>/<lang>/<md5>.mp4
 *   …/<md5>.thumb.jpg
 *   …/<md5>.meta.json
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
