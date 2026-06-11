/**
 * filename-builder.test.ts
 *
 * R2 object-key layout (hash-addressed, immutable):
 *   videos/<text_id>/<chapter>/<verse_num>/<lang>/<md5>.{mp4,thumb.jpg,meta.json}
 */
import { describe, expect, it } from 'vitest';
import { buildR2Key, metaKey, thumbKey } from '../../../pipeline/youtube/filename';

const IDENT = { text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en' };
const MD5 = 'abc123';

describe('buildR2Key', () => {
  it('produces videos/<text>/<ch>/<v>/<lang>/<md5>.mp4', () => {
    expect(buildR2Key(IDENT, MD5)).toBe('videos/siva-sutras/1/1/en/abc123.mp4');
  });

  it('reflects identity fields in the path', () => {
    expect(
      buildR2Key({ text_id: 'spanda-karikas', chapter: 2, verse_num: 7, lang: 'hi' }, 'deadbeef'),
    ).toBe('videos/spanda-karikas/2/7/hi/deadbeef.mp4');
  });
});

describe('thumbKey', () => {
  it('produces the .thumb.jpg sidecar key', () => {
    expect(thumbKey(IDENT, MD5)).toBe('videos/siva-sutras/1/1/en/abc123.thumb.jpg');
  });
});

describe('metaKey', () => {
  it('produces the .meta.json sidecar key', () => {
    expect(metaKey(IDENT, MD5)).toBe('videos/siva-sutras/1/1/en/abc123.meta.json');
  });
});

describe('key family', () => {
  it('shares the same prefix across all three artifacts', () => {
    const prefix = 'videos/siva-sutras/1/1/en/abc123';
    expect(buildR2Key(IDENT, MD5).startsWith(prefix)).toBe(true);
    expect(thumbKey(IDENT, MD5).startsWith(prefix)).toBe(true);
    expect(metaKey(IDENT, MD5).startsWith(prefix)).toBe(true);
  });
});
