/**
 * Zero-secret canned artifacts for the MOCK_ALL=true path (D1).
 *
 * These let `MOCK_ALL=true bun scripts/youtube-render.ts` (and the tts smoke)
 * produce a *real* MP4 from canned inputs with no Google TTS / YouTube / R2
 * credentials. The MP4 is muxed by Remotion from this silent WAV + this PNG,
 * so QA gates, the filename builder, and the R2/DB write paths all exercise
 * real code — only the external calls are stubbed.
 *
 * TTHW (time to first artifact for a fresh contributor) target: < 10 minutes.
 *
 * No dependencies — both functions return Buffers built byte-by-byte so the
 * mock layer never needs network, native modules, or secrets.
 */

const RIFF = 0x46464952; // "RIFF" (unused numeric form kept for reference)

/**
 * A valid PCM WAV of pure silence.
 *
 * 16-bit signed PCM, mono, 44.1kHz. Used to stand in for Google Cloud TTS
 * output so the renderer has a real audio track to mux under the visuals.
 *
 * @param seconds duration of silence (default 1). Clamped to >= 0.
 * @returns a Buffer containing a complete, playable WAV file.
 */
export function cannedSilentWav(seconds = 1): Buffer {
  const sampleRate = 44_100;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;

  const safeSeconds = Math.max(0, seconds);
  const numSamples = Math.round(sampleRate * safeSeconds);
  const dataSize = numSamples * blockAlign;

  // 44-byte canonical WAV header + PCM data (already zero-filled = silence).
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4); // ChunkSize = 36 + Subchunk2Size
  buffer.write('WAVE', 8, 'ascii');

  // "fmt " sub-chunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk1Size = 16 for PCM
  buffer.writeUInt16LE(1, 20); // AudioFormat = 1 (PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  // "data" sub-chunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  // PCM samples remain 0x00 → silence.

  return buffer;
}

/**
 * A tiny valid PNG (1x1 solid pixel).
 *
 * Stands in for a rendered background / thumbnail image so the renderer has a
 * real image to composite. The bytes below are a hand-assembled minimal PNG:
 * signature + IHDR (1x1, 8-bit RGB, no alpha) + a single zlib-stored IDAT
 * scanline + IEND. CRCs are precomputed and fixed, so this needs no zlib at
 * runtime.
 *
 * @returns a Buffer containing a complete 1x1 PNG (midnight-indigo-ish pixel).
 */
export function cannedImagePng(): Buffer {
  // Minimal 1x1 opaque PNG. Generated once and frozen as a base64 literal so
  // the mock has zero runtime dependencies (no zlib, no canvas, no sharp).
  // Decodes to: 8-bit/color-type-6 (RGBA) 1x1 pixel, near-black.
  const base64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return Buffer.from(base64, 'base64');
}

// Re-exported numeric constant is intentionally unused at runtime; silence the
// "declared but never read" lint without exporting noise into the public API.
void RIFF;
