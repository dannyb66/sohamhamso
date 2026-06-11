/**
 * upload-metadata.snapshot.test.ts
 *
 * Locks the exact `buildUploadMetadata` output for a fixed, deterministic
 * input. Any wording / attribution / UTM change must be reviewed as a
 * snapshot diff (run `vitest -u` to intentionally update).
 */
import { describe, expect, it } from 'vitest';
import { buildUploadMetadata } from '../../../pipeline/youtube/upload-metadata';

describe('buildUploadMetadata — snapshot', () => {
  it('is deterministic for a fixed input', () => {
    const meta = buildUploadMetadata({
      textTitle: 'Śiva Sūtra',
      chapter: 1,
      verseNum: 1,
      lang: 'en',
      translation: 'Consciousness is the Self.',
      canonicalUrl: 'https://sohamhamso.org/texts/siva-sutras/1/1',
    });
    expect(meta).toMatchSnapshot();
  });
});
