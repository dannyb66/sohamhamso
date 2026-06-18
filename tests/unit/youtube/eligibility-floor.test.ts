/**
 * eligibility-floor.test.ts
 *
 * Per-format translation-status floor (plan D1): shorts keep the text's
 * `min_translation_status` floor byte-for-byte (reviewed for the three
 * eligible texts — drafts stay out); chapters use the global
 * `chapters.min_translation_status` floor (draft in v1, so draft
 * translations clear it). Resolved via `translationFloorFor` /
 * `meetsTranslationFloorForFormat` against the real config.
 */
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadYoutubeConfig } from '../../../pipeline/youtube/config';
import {
  meetsTranslationFloor,
  meetsTranslationFloorForFormat,
  translationFloorFor,
} from '../../../pipeline/youtube/eligibility';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = resolve(REPO_ROOT, 'data', 'youtube-config.yaml');

const cfg = loadYoutubeConfig(CONFIG_PATH);

describe('translationFloorFor', () => {
  it('shorts resolve the text floor (reviewed for eligible texts)', () => {
    for (const slug of ['siva-sutras', 'spanda-karikas', 'pratyabhijna-hrdayam']) {
      expect(translationFloorFor(cfg, slug, 'short')).toBe('reviewed');
    }
  });

  it('shorts default to reviewed for an unknown slug', () => {
    expect(translationFloorFor(cfg, 'no-such-text', 'short')).toBe('reviewed');
  });

  it('format defaults to short', () => {
    expect(translationFloorFor(cfg, 'siva-sutras')).toBe('reviewed');
  });

  it('chapters resolve the per-format chapters.min_translation_status (draft)', () => {
    expect(translationFloorFor(cfg, 'siva-sutras', 'chapter')).toBe('draft');
    // The chapter floor is global, not per-text.
    expect(translationFloorFor(cfg, 'no-such-text', 'chapter')).toBe('draft');
  });
});

describe('meetsTranslationFloorForFormat', () => {
  it('shorts: draft does NOT clear the floor (behavior unchanged)', () => {
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'draft', 'short')).toBe(false);
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'draft')).toBe(false);
  });

  it('shorts: reviewed and published clear the floor (behavior unchanged)', () => {
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'reviewed', 'short')).toBe(true);
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'published', 'short')).toBe(true);
  });

  it('chapters: draft clears the draft floor', () => {
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'draft', 'chapter')).toBe(true);
  });

  it('chapters: an unknown status still never clears any floor', () => {
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'garbage', 'chapter')).toBe(false);
  });

  it('matches a direct meetsTranslationFloor call with the resolved floor', () => {
    expect(meetsTranslationFloorForFormat(cfg, 'siva-sutras', 'draft', 'chapter')).toBe(
      meetsTranslationFloor('draft', translationFloorFor(cfg, 'siva-sutras', 'chapter')),
    );
  });
});
