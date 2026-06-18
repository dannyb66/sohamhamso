/**
 * qa-chapter.test.ts
 *
 * Chapter QA limits: NO min/max duration window (user decision — chapters
 * have no cap), a 5MB byte floor, and the ±2s duration-CONSISTENCY gate
 * (|probed − expected| ≤ 2s catches truncated renders). The vacuous local-
 * vs-local ETag compare is dropped for chapters (checkEtag:false — see the
 * honesty note in qa.ts). SHORT_LIMITS stays the default arg, so existing
 * callers/tests are untouched.
 */
import { describe, expect, it } from 'vitest';
import {
  CHAPTER_LIMITS,
  type QaMetrics,
  SHORT_LIMITS,
  qaChecks,
} from '../../../pipeline/youtube/qa';

const GOOD_CHAPTER: QaMetrics = {
  bytes: 6_000_000,
  durationS: 901.2,
  expectedDurationS: 900,
  loudnessLufs: -18,
  codecVideo: 'h264',
  codecAudio: 'aac',
  etag: 'irrelevant-for-chapters',
  localMd5: 'deadbeef',
};

describe('qaChecks(CHAPTER_LIMITS) — happy path', () => {
  it('passes a good chapter probe with no failures', () => {
    const r = qaChecks(GOOD_CHAPTER, CHAPTER_LIMITS);
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });

  it('has NO duration window: a 1-hour chapter passes', () => {
    const r = qaChecks(
      { ...GOOD_CHAPTER, durationS: 3600, expectedDurationS: 3599 },
      CHAPTER_LIMITS,
    );
    expect(r.pass).toBe(true);
  });

  it('has NO duration floor: a tiny 1-verse chapter passes', () => {
    const r = qaChecks({ ...GOOD_CHAPTER, durationS: 24, expectedDurationS: 24 }, CHAPTER_LIMITS);
    expect(r.pass).toBe(true);
  });
});

describe('qaChecks(CHAPTER_LIMITS) — duration consistency (±2s)', () => {
  it('passes at exactly 2s drift (inclusive tolerance)', () => {
    const r = qaChecks({ ...GOOD_CHAPTER, durationS: 902, expectedDurationS: 900 }, CHAPTER_LIMITS);
    expect(r.pass).toBe(true);
  });

  it('fails beyond 2s drift (truncated render)', () => {
    const r = qaChecks(
      { ...GOOD_CHAPTER, durationS: 897.5, expectedDurationS: 900 },
      CHAPTER_LIMITS,
    );
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/duration drift/i);
  });

  it('fails when expectedDurationS is missing (the gate must not silently skip)', () => {
    const m = { ...GOOD_CHAPTER };
    m.expectedDurationS = undefined;
    const r = qaChecks(m, CHAPTER_LIMITS);
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/expectedDurationS missing/i);
  });
});

describe('qaChecks(CHAPTER_LIMITS) — other gates', () => {
  it('fails below the 5MB byte floor', () => {
    const r = qaChecks({ ...GOOD_CHAPTER, bytes: 4_000_000 }, CHAPTER_LIMITS);
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/too small/i);
  });

  it('still fails on too-quiet audio', () => {
    const r = qaChecks({ ...GOOD_CHAPTER, loudnessLufs: -55 }, CHAPTER_LIMITS);
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/quiet/i);
  });

  it('still enforces h264/aac codecs', () => {
    expect(qaChecks({ ...GOOD_CHAPTER, codecVideo: 'vp9' }, CHAPTER_LIMITS).pass).toBe(false);
    expect(qaChecks({ ...GOOD_CHAPTER, codecAudio: 'opus' }, CHAPTER_LIMITS).pass).toBe(false);
  });

  it('IGNORES the etag/md5 compare (vacuous local-vs-local check dropped)', () => {
    const r = qaChecks({ ...GOOD_CHAPTER, etag: 'xxxx', localMd5: 'yyyy' }, CHAPTER_LIMITS);
    expect(r.pass).toBe(true);
  });
});

describe('SHORT_LIMITS backward compatibility', () => {
  const GOOD_SHORT: QaMetrics = {
    bytes: 5_000_000,
    durationS: 18,
    loudnessLufs: -18,
    codecVideo: 'h264',
    codecAudio: 'aac',
    etag: 'deadbeef',
    localMd5: 'deadbeef',
  };

  it('is the default limits arg (one-arg call unchanged)', () => {
    expect(qaChecks(GOOD_SHORT).pass).toBe(true);
  });

  it('keeps the shorts duration window [6,182]', () => {
    expect(qaChecks({ ...GOOD_SHORT, durationS: 5 }).pass).toBe(false);
    expect(qaChecks({ ...GOOD_SHORT, durationS: 200 }).pass).toBe(false);
  });

  it('keeps the etag gate for shorts', () => {
    expect(qaChecks({ ...GOOD_SHORT, etag: 'xxxx' }).pass).toBe(false);
  });

  it('does not require expectedDurationS for shorts', () => {
    expect(GOOD_SHORT.expectedDurationS).toBeUndefined();
    expect(qaChecks(GOOD_SHORT, SHORT_LIMITS).pass).toBe(true);
  });
});
