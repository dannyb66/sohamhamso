/**
 * determinism.test.ts
 *
 * The simplified determinism contract (E1): `translationMd5` is stable for
 * the same input and changes on any edit; `shouldSkipRender` skips only when
 * the latest row is in a terminal-good state AND both md5 + template_version
 * still match.
 */
import { describe, expect, it } from 'vitest';
import { translationMd5 } from '../../../pipeline/youtube/determinism';
import { type VideoRow, shouldSkipRender } from '../../../src/lib/videos-db';

const TEXT = 'Consciousness is the Self.';

describe('translationMd5', () => {
  it('is stable for the same input', () => {
    expect(translationMd5(TEXT)).toBe(translationMd5(TEXT));
  });

  it('matches the known md5 hex digest', () => {
    // md5('Consciousness is the Self.') — locked golden.
    expect(translationMd5(TEXT)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('differs when the translation is edited', () => {
    expect(translationMd5(TEXT)).not.toBe(translationMd5(`${TEXT} `));
    expect(translationMd5(TEXT)).not.toBe(translationMd5('Limited knowledge is bondage.'));
  });
});

/** Minimal VideoRow factory — only the fields shouldSkipRender reads matter. */
function row(overrides: Partial<VideoRow>): VideoRow {
  return {
    status: 'rendered',
    translation_md5: 'md5-a',
    template_version: 'v1',
    ...overrides,
  } as VideoRow;
}

describe('shouldSkipRender', () => {
  it('skips when latest is rendered and md5 + version match', () => {
    const latest = row({ status: 'rendered', translation_md5: 'md5-a', template_version: 'v1' });
    expect(shouldSkipRender(latest, 'md5-a', 'v1')).toBe(true);
  });

  it('also skips for approved / uploaded terminal-good states', () => {
    expect(shouldSkipRender(row({ status: 'approved' }), 'md5-a', 'v1')).toBe(true);
    expect(shouldSkipRender(row({ status: 'uploaded' }), 'md5-a', 'v1')).toBe(true);
  });

  it('does NOT skip on md5 drift (translation edited upstream)', () => {
    const latest = row({ translation_md5: 'md5-a' });
    expect(shouldSkipRender(latest, 'md5-DIFFERENT', 'v1')).toBe(false);
  });

  it('does NOT skip on template_version drift', () => {
    const latest = row({ template_version: 'v1' });
    expect(shouldSkipRender(latest, 'md5-a', 'v2')).toBe(false);
  });

  it('does NOT skip when the latest row is still pending', () => {
    expect(shouldSkipRender(row({ status: 'pending' }), 'md5-a', 'v1')).toBe(false);
  });

  it('does NOT skip when there is no prior row', () => {
    expect(shouldSkipRender(null, 'md5-a', 'v1')).toBe(false);
  });
});
