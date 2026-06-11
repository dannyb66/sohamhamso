/**
 * qa-gates.test.ts
 *
 * `qaChecks` is the automated QA gate Cron A runs before flipping
 * rendered→approved. A "good" probe passes; each individual gate failure
 * (too small / too short / too quiet / wrong codec / etag mismatch) yields
 * pass:false with a matching message.
 */
import { describe, expect, it } from 'vitest';
import { type QaMetrics, qaChecks } from '../../../pipeline/youtube/qa';

const GOOD: QaMetrics = {
  bytes: 5_000_000,
  durationS: 18,
  loudnessLufs: -18,
  codecVideo: 'h264',
  codecAudio: 'aac',
  etag: 'deadbeef',
  localMd5: 'deadbeef',
};

describe('qaChecks — happy path', () => {
  it('passes a good metadata object with no failures', () => {
    const r = qaChecks(GOOD);
    expect(r.pass).toBe(true);
    expect(r.failures).toEqual([]);
  });
});

describe('qaChecks — individual gate failures', () => {
  it('fails on a too-small file', () => {
    const r = qaChecks({ ...GOOD, bytes: 1_000 });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/too small/i);
  });

  it('fails on a too-short duration', () => {
    const r = qaChecks({ ...GOOD, durationS: 5 });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/duration/i);
  });

  it('fails on a too-long duration (beyond the 180s Shorts cap)', () => {
    const r = qaChecks({ ...GOOD, durationS: 200 });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/duration/i);
  });

  it('fails on too-quiet audio', () => {
    const r = qaChecks({ ...GOOD, loudnessLufs: -55 });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/quiet/i);
  });

  it('fails on a wrong video codec', () => {
    const r = qaChecks({ ...GOOD, codecVideo: 'vp9' });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/h264/i);
  });

  it('fails on a wrong audio codec', () => {
    const r = qaChecks({ ...GOOD, codecAudio: 'opus' });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/aac/i);
  });

  it('fails on an etag/md5 mismatch', () => {
    const r = qaChecks({ ...GOOD, etag: 'xxxx' });
    expect(r.pass).toBe(false);
    expect(r.failures.join('\n')).toMatch(/etag/i);
  });

  it('reports multiple failures at once', () => {
    const r = qaChecks({ ...GOOD, bytes: 1, durationS: 1, codecVideo: 'vp9' });
    expect(r.pass).toBe(false);
    expect(r.failures.length).toBeGreaterThanOrEqual(3);
  });
});
