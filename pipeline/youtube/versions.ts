/**
 * pipeline/youtube/versions.ts
 *
 * Frozen version constants stamped into every `videos` row for the
 * determinism contract (translation_md5 + template_version) and for
 * 6-months-later replay reproducibility.
 *
 * TEMPLATE_VERSION is the keystone: ANY change to the Remotion
 * composition source, a style preset (bg/accent/footer wording),
 * or font selection MUST bump it. `template-version.test.ts` hashes
 * the composition source and fails CI if it changed without a bump.
 * A bump cascades a controlled re-render (old rows -> superseded).
 *
 * REMOTION_VERSION / FFMPEG_VERSION are pinned provenance — bump when
 * the respective dependency is installed/upgraded.
 */

// v2: dynamic per-verse duration + audio-aligned timing, length-calibrated
// font sizing, reserved footer band, Devanāgarī compound wrapping.
export const TEMPLATE_VERSION = 'v2';

// c1: chapter-format (16:9 full-chapter) composition. Independent version
// track so chapter/short template bumps never cross-supersede — bumping
// one MUST NOT touch the other.
export const CHAPTER_TEMPLATE_VERSION = 'c1';
export const REMOTION_VERSION = '4.0.474';
export const FFMPEG_VERSION = 'ffmpeg-static';
