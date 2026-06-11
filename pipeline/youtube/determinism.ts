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
