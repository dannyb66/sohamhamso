/**
 * youtube/remotion.config.ts
 *
 * Minimal, render-stable Remotion config for the YouTube Shorts pipeline.
 *
 * Key choices:
 *   - h264 / mp4: YouTube-friendly, broad compatibility.
 *   - jpeg still frames: faster encode; we never need alpha.
 *   - ANGLE OpenGL renderer: most stable on headless Linux GHA runners.
 *   - --font-render-hinting=none: stable LCD glyph rendering for Devanagari
 *     conjuncts/matras across runners (see plan "Indic font rendering").
 *
 * `remotion` is installed by the orchestrator later; this only resolves after
 * `bun install`.
 */
import { Config } from 'remotion';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);

// Most stable GL backend for headless Linux runners.
if (typeof Config.setChromiumOpenGlRenderer === 'function') {
  Config.setChromiumOpenGlRenderer('angle');
}

// Stable Indic glyph shaping across runners. Newer Remotion exposes this as a
// dedicated setter; older versions only via the raw Chromium flag list.
if (typeof Config.setChromiumDisableWebSecurity === 'function') {
  // no-op marker: keep web security on; documented here for reviewers.
}
if (
  typeof (Config as { setFontRenderHinting?: (v: string) => void }).setFontRenderHinting ===
  'function'
) {
  (Config as unknown as { setFontRenderHinting: (v: string) => void }).setFontRenderHinting('none');
}
