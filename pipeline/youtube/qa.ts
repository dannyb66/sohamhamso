/**
 * pipeline/youtube/qa.ts
 *
 * Pure automated QA gate (Cron A flips rendered→approved only on a pass).
 * Each failing gate pushes a human-readable message; the orchestrator
 * persists the joined failures (scrubbed) into `last_error`.
 *
 * `qaChecks(m, limits)` is parameterized per format:
 *   - SHORT_LIMITS (default — byte-for-byte the Phase-1 gates):
 *     file >100KB, duration ∈ [6,182]s, loudness > -40 LUFS,
 *     h264 video, aac audio, R2 ETag == local md5.
 *   - CHAPTER_LIMITS: file >5MB, loudness > -40 LUFS, h264/aac, NO
 *     min/max duration window (user decision — chapters have no cap),
 *     but a duration-CONSISTENCY gate instead: |probed − expected| ≤ 2s
 *     catches truncated renders against the engine's own expected length.
 *
 * Shorts duration window: length is derived per-verse (leadIn + narration +
 * tail, see remotion-props.ts), so the floor is low (short sutras) and the
 * ceiling is the YouTube Shorts max of 3 min for original audio, +2s
 * container margin.
 *
 * ETag gate honesty note: render-engine.ts sets `etag = localMd5` before
 * calling qaChecks (it never reads the REMOTE ETag back from R2 — see
 * render-engine.ts:471), so the etag gate is vacuous in practice. It is
 * DROPPED for chapters (`checkEtag: false`) rather than pretending to verify
 * remote integrity; it is kept (unchanged) for shorts for backward
 * compatibility until a real remote-ETag read exists.
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
  /**
   * Engine-expected duration (durationInFrames / fps). Required when the
   * limits define `durationToleranceS` (chapter consistency gate).
   */
  expectedDurationS?: number;
}

export interface QaResult {
  pass: boolean;
  failures: string[];
}

/** Per-format gate thresholds. */
export interface QaLimits {
  minBytes: number;
  /** Duration window — omit BOTH for no min/max gate (chapters). */
  minDurationS?: number;
  maxDurationS?: number;
  minLoudnessLufs: number;
  /** Compare `etag` to `localMd5` (see honesty note above). */
  checkEtag: boolean;
  /**
   * Duration-consistency gate: require |durationS − expectedDurationS| ≤
   * this tolerance. A missing `expectedDurationS` FAILS the gate (an
   * integrity check that silently skips is no check at all).
   */
  durationToleranceS?: number;
}

/** Phase-1 Shorts gates (unchanged values). */
export const SHORT_LIMITS: QaLimits = {
  minBytes: 100_000,
  minDurationS: 6,
  // YouTube Shorts cap is 180s (3 min) for original audio; +2s container
  // margin so a verse clamped to exactly 180s isn't rejected by rounding.
  maxDurationS: 182,
  minLoudnessLufs: -40,
  checkEtag: true,
};

/** Chapter-format gates: no duration window; ±2s consistency vs expected. */
export const CHAPTER_LIMITS: QaLimits = {
  minBytes: 5_000_000,
  minLoudnessLufs: -40,
  checkEtag: false, // vacuous local-vs-local compare — dropped (see header)
  durationToleranceS: 2,
};

/** Run the QA gates over probe metrics. */
export function qaChecks(m: QaMetrics, limits: QaLimits = SHORT_LIMITS): QaResult {
  const failures: string[] = [];

  if (!(m.bytes > limits.minBytes)) {
    failures.push(`file too small: ${m.bytes} bytes (need > ${limits.minBytes})`);
  }

  if (limits.minDurationS !== undefined || limits.maxDurationS !== undefined) {
    const min = limits.minDurationS ?? 0;
    const max = limits.maxDurationS ?? Number.POSITIVE_INFINITY;
    if (!(m.durationS >= min && m.durationS <= max)) {
      failures.push(`duration out of range: ${m.durationS}s (need [${min},${max}])`);
    }
  }

  if (limits.durationToleranceS !== undefined) {
    if (m.expectedDurationS === undefined || !Number.isFinite(m.expectedDurationS)) {
      failures.push('duration-consistency gate: expectedDurationS missing from metrics');
    } else if (!(Math.abs(m.durationS - m.expectedDurationS) <= limits.durationToleranceS)) {
      failures.push(
        `duration drift: probed ${m.durationS}s vs expected ${m.expectedDurationS}s ` +
          `(tolerance ${limits.durationToleranceS}s — truncated/overlong render)`,
      );
    }
  }

  if (!(m.loudnessLufs > limits.minLoudnessLufs)) {
    failures.push(`too quiet: ${m.loudnessLufs} LUFS (need > ${limits.minLoudnessLufs})`);
  }
  if (m.codecVideo !== 'h264') {
    failures.push(`video codec not h264: ${m.codecVideo}`);
  }
  if (m.codecAudio !== 'aac') {
    failures.push(`audio codec not aac: ${m.codecAudio}`);
  }
  if (limits.checkEtag && m.etag !== m.localMd5) {
    failures.push(`R2 etag mismatch: ${m.etag} != local ${m.localMd5}`);
  }

  return { pass: failures.length === 0, failures };
}
