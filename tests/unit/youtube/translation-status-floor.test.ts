/**
 * translation-status-floor.test.ts
 *
 * `meetsTranslationFloor` gates a translation's `status` against the text's
 * `min_translation_status` floor — no draft translations enter the pipeline.
 * `STATUS_ORDER` ranks draft < reviewed < published.
 */
import { describe, expect, it } from 'vitest';
import { STATUS_ORDER, meetsTranslationFloor } from '../../../pipeline/youtube/eligibility';

describe('STATUS_ORDER', () => {
  it('ranks draft < reviewed < published', () => {
    expect(STATUS_ORDER.draft).toBeLessThan(STATUS_ORDER.reviewed);
    expect(STATUS_ORDER.reviewed).toBeLessThan(STATUS_ORDER.published);
  });

  it('has the expected ordinals', () => {
    expect(STATUS_ORDER).toEqual({ draft: 0, reviewed: 1, published: 2 });
  });
});

describe('meetsTranslationFloor', () => {
  it('reviewed clears a reviewed floor', () => {
    expect(meetsTranslationFloor('reviewed', 'reviewed')).toBe(true);
  });

  it('published clears a reviewed floor', () => {
    expect(meetsTranslationFloor('published', 'reviewed')).toBe(true);
  });

  it('draft does NOT clear a reviewed floor', () => {
    expect(meetsTranslationFloor('draft', 'reviewed')).toBe(false);
  });

  it('reviewed does NOT clear a published floor', () => {
    expect(meetsTranslationFloor('reviewed', 'published')).toBe(false);
  });

  it('an unknown status never clears a floor', () => {
    expect(meetsTranslationFloor('garbage', 'reviewed')).toBe(false);
  });
});
