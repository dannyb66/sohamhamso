/**
 * chapter-filename.test.ts
 *
 * Chapter-format R2 key builders: hash-addressed layout under `chapters/`,
 * mp4 + `.meta.json` sidecar share one prefix (atomic pair), and chapter
 * keys can NEVER collide with the shorts `videos/` namespace.
 */
import { describe, expect, it } from 'vitest';
import {
  buildChapterR2Key,
  buildR2Key,
  chapterMetaKey,
  metaKey,
} from '../../../pipeline/youtube/filename';

const IDENT = { text_id: 'siva-sutras', chapter: 1, lang: 'en' };
const MD5 = 'cafebabe00112233445566778899aabb';

describe('buildChapterR2Key', () => {
  it('builds chapters/<text_id>/<chapter>/<lang>/<md5>.mp4', () => {
    expect(buildChapterR2Key(IDENT, MD5)).toBe(`chapters/siva-sutras/1/en/${MD5}.mp4`);
  });

  it('is hash-addressed: a different manifest md5 yields a different key', () => {
    expect(buildChapterR2Key(IDENT, 'aaaa')).not.toBe(buildChapterR2Key(IDENT, 'bbbb'));
  });
});

describe('chapterMetaKey', () => {
  it('builds the sidecar key with the SAME prefix as the mp4', () => {
    const meta = chapterMetaKey(IDENT, MD5);
    expect(meta).toBe(`chapters/siva-sutras/1/en/${MD5}.meta.json`);
    expect(meta.replace(/\.meta\.json$/, '.mp4')).toBe(buildChapterR2Key(IDENT, MD5));
  });
});

describe('namespace separation from shorts keys', () => {
  it('chapter keys live under chapters/, shorts under videos/', () => {
    expect(buildChapterR2Key(IDENT, MD5).startsWith('chapters/')).toBe(true);
    expect(
      buildR2Key({ text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en' }, MD5).startsWith(
        'videos/',
      ),
    ).toBe(true);
  });

  it('a chapter key never equals a shorts key, even for verse_num=0 + same md5', () => {
    const shortKey = buildR2Key(
      { text_id: 'siva-sutras', chapter: 1, verse_num: 0, lang: 'en' },
      MD5,
    );
    expect(buildChapterR2Key(IDENT, MD5)).not.toBe(shortKey);
    expect(chapterMetaKey(IDENT, MD5)).not.toBe(
      metaKey({ text_id: 'siva-sutras', chapter: 1, verse_num: 0, lang: 'en' }, MD5),
    );
  });
});
