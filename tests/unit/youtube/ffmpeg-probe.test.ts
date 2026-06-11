/**
 * ffmpeg-probe.test.ts
 *
 * Regression cover for the QA probe. Before this, render-engine hardcoded
 * duration/LUFS/codecs and the loudness gate was a no-op for real renders —
 * a too-quiet or wrong-codec video would pass QA. `parseFfmpegProbe` now reads
 * the real metrics out of `ffmpeg -i … -af loudnorm` stderr.
 */
import { describe, expect, it } from 'vitest';
import { parseFfmpegProbe } from '../../../pipeline/youtube/render-engine';

// Trimmed real ffmpeg stderr: the input header streams print BEFORE the
// `-f null` output streams (wrapped_avframe / pcm_s16le).
const STDERR_SPEECH = `
  Duration: 00:00:21.50, start: 0.000000, bitrate: 430 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuvj420p, 1080x1920, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo
  Stream #0:0(und): Video: wrapped_avframe, yuvj420p, 1080x1920, 30 fps
  Stream #0:1(und): Audio: pcm_s16le, 192000 Hz, stereo
\t"input_i" : "-19.30",
\t"input_tp" : "-2.10",
`;

const STDERR_SILENCE = `
  Duration: 00:00:18.05, start: 0.000000, bitrate: 422 kb/s
  Stream #0:0[0x1](und): Video: h264 (High), 1080x1920, 30 fps
  Stream #0:1[0x2](und): Audio: aac (LC), 48000 Hz, stereo
\t"input_i" : "-inf",
`;

describe('parseFfmpegProbe', () => {
  it('parses HH:MM:SS.ss duration into seconds', () => {
    expect(parseFfmpegProbe(STDERR_SPEECH).durationS).toBeCloseTo(21.5, 2);
    expect(parseFfmpegProbe(STDERR_SILENCE).durationS).toBeCloseTo(18.05, 2);
  });

  it('picks the INPUT codecs (first match), not the -f null output streams', () => {
    const r = parseFfmpegProbe(STDERR_SPEECH);
    expect(r.codecVideo).toBe('h264'); // not "wrapped_avframe"
    expect(r.codecAudio).toBe('aac'); // not "pcm_s16le"
  });

  it('reads a finite integrated LUFS for narrated audio', () => {
    expect(parseFfmpegProbe(STDERR_SPEECH).loudnessLufs).toBeCloseTo(-19.3, 2);
  });

  it('maps "-inf" (pure silence) to -Infinity → fails the loudness gate', () => {
    expect(parseFfmpegProbe(STDERR_SILENCE).loudnessLufs).toBe(Number.NEGATIVE_INFINITY);
  });

  it('returns NaN duration when the header is absent (probe should throw upstream)', () => {
    expect(Number.isNaN(parseFfmpegProbe('garbage, no header').durationS)).toBe(true);
  });

  it('falls back to "unknown" codecs when streams are missing', () => {
    const r = parseFfmpegProbe('  Duration: 00:00:10.00\n');
    expect(r.codecVideo).toBe('unknown');
    expect(r.codecAudio).toBe('unknown');
  });
});
