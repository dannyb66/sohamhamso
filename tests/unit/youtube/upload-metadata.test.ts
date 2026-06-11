/**
 * upload-metadata.test.ts
 *
 * `buildUploadMetadata` bakes the non-negotiable attribution chain
 * (CC-BY-SA + source) + a UTM-tagged canonical backlink into the YouTube
 * `videos.insert` body, defaults to unlisted, and stamps the lang on both
 * defaultLanguage + defaultAudioLanguage.
 */
import { describe, expect, it } from 'vitest';
import { buildUploadMetadata } from '../../../pipeline/youtube/upload-metadata';

const ARGS = {
  textTitle: 'Śiva Sūtra',
  chapter: 1,
  verseNum: 1,
  lang: 'en',
  translation: 'Consciousness is the Self.',
  canonicalUrl: 'https://sohamhamso.org/texts/siva-sutras/1/1',
};

describe('buildUploadMetadata', () => {
  const meta = buildUploadMetadata(ARGS);

  it('builds a title containing the 1.1 reference', () => {
    expect(meta.snippet.title).toContain('1.1');
  });

  it('description contains the UTM-tagged canonical link', () => {
    expect(meta.snippet.description).toContain('https://sohamhamso.org/texts/siva-sutras/1/1');
    expect(meta.snippet.description).toContain('utm_source=youtube');
    expect(meta.snippet.description).toContain('utm_medium=short');
    expect(meta.snippet.description).toContain('utm_campaign=verse');
  });

  it('description carries the CC-BY-SA license attribution', () => {
    expect(meta.snippet.description).toContain('CC-BY-SA');
  });

  it('defaults privacyStatus to unlisted', () => {
    expect(meta.status.privacyStatus).toBe('unlisted');
  });

  it('stamps lang on both defaultLanguage and defaultAudioLanguage', () => {
    expect(meta.snippet.defaultLanguage).toBe('en');
    expect(meta.snippet.defaultAudioLanguage).toBe('en');
  });

  it('includes the base tag set', () => {
    expect(meta.snippet.tags).toEqual(
      expect.arrayContaining(['Kashmir Shaivism', 'Trika', 'Sanskrit']),
    );
  });

  it('appends caller-supplied tags onto the base set', () => {
    const withTags = buildUploadMetadata({ ...ARGS, tags: ['Spanda'] });
    expect(withTags.snippet.tags).toEqual(
      expect.arrayContaining(['Kashmir Shaivism', 'Trika', 'Sanskrit', 'Spanda']),
    );
  });
});
