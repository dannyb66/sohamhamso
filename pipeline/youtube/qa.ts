/**
 * pipeline/youtube/qa.ts
 *
 * Pure automated QA gate (Cron A flips rendered→approved only on a pass).
 * Each failing gate pushes a human-readable message; the orchestrator
 * persists the joined failures (scrubbed) into `last_error`.
 *
 * Gates: file >100KB, duration ∈ [6,182]s, loudness > -40 LUFS,
 * h264 video, aac audio, R2 ETag == local md5.
 *
 * Duration window: length is now derived per-verse (leadIn + narration + tail,
 * see remotion-props.ts), so the floor is low (short sutras) and the ceiling is
 * the YouTube Shorts max of 3 min for original audio, +2s container margin.
 *
 * Pure — no imports. Unit-tested separately.
 */

export interface QaMetrics {
  bytes: number;
  durationS: number;
  loudnessLufs: number;
  codecVideo: string;
  codecAudio: string;
  etag: string;
  localMd5: string;
}

export interface QaResult {
  pass: boolean;
  failures: string[];
}

const MIN_BYTES = 100_000;
const MIN_DURATION_S = 6;
// YouTube Shorts cap is 180s (3 min) for original audio; +2s container margin
// so a verse clamped to exactly 180s isn't rejected by probe rounding.
const MAX_DURATION_S = 182;
const MIN_LOUDNESS_LUFS = -40;

/** Run the QA gates over probe metrics. */
export function qaChecks(m: QaMetrics): QaResult {
  const failures: string[] = [];

  if (!(m.bytes > MIN_BYTES)) {
    failures.push(`file too small: ${m.bytes} bytes (need > ${MIN_BYTES})`);
  }
  if (!(m.durationS >= MIN_DURATION_S && m.durationS <= MAX_DURATION_S)) {
    failures.push(
      `duration out of range: ${m.durationS}s (need [${MIN_DURATION_S},${MAX_DURATION_S}])`,
    );
  }
  if (!(m.loudnessLufs > MIN_LOUDNESS_LUFS)) {
    failures.push(`too quiet: ${m.loudnessLufs} LUFS (need > ${MIN_LOUDNESS_LUFS})`);
  }
  if (m.codecVideo !== 'h264') {
    failures.push(`video codec not h264: ${m.codecVideo}`);
  }
  if (m.codecAudio !== 'aac') {
    failures.push(`audio codec not aac: ${m.codecAudio}`);
  }
  if (m.etag !== m.localMd5) {
    failures.push(`R2 etag mismatch: ${m.etag} != local ${m.localMd5}`);
  }

  return { pass: failures.length === 0, failures };
}
