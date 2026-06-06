import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ALLOWED_NOINDEX_ROUTES,
  classifyUrl,
  extractLocale,
  hasNoindex,
  isRedirectPage,
  sweepDistForNoindex,
} from '../../../scripts/seo-dist-noindex-sweep';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tempDir: string | null = null;

function makeTempDistDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'sohamhamso-noindex-sweep-'));
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function writeHtml(dir: string, relPath: string, content: string): void {
  const fullPath = join(dir, relPath);
  mkdirSync(fullPath.slice(0, fullPath.lastIndexOf('/')), { recursive: true });
  writeFileSync(fullPath, content, 'utf8');
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

// Minimal HTML with a noindex robots meta tag
const NOINDEX_HTML = `<!DOCTYPE html><html>
<head>
<meta name="robots" content="noindex, nofollow">
</head><body></body></html>`;

// Minimal HTML without noindex
const CLEAN_HTML = `<!DOCTYPE html><html>
<head>
<meta name="robots" content="index, follow">
</head><body></body></html>`;

// Redirect stub (carries noindex by design)
const REDIRECT_HTML = `<!DOCTYPE html><html>
<head>
<meta http-equiv="refresh" content="0; url=/en/trika/siva-sutras">
<meta name="robots" content="noindex, nofollow">
</head><body></body></html>`;

// ---------------------------------------------------------------------------
// classifyUrl
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: classifyUrl', () => {
  describe('homepage classification', () => {
    it('classifies root index.html as homepage', () => {
      expect(classifyUrl('index.html')).toBe('homepage');
    });

    it('classifies locale root as homepage (hi/index.html)', () => {
      expect(classifyUrl('hi/index.html')).toBe('homepage');
    });

    it('classifies en locale root as homepage (en/index.html)', () => {
      expect(classifyUrl('en/index.html')).toBe('homepage');
    });
  });

  describe('text path classification', () => {
    it('classifies tradition/text (2 segments after locale) as text', () => {
      // hi/trika/siva-sutras/index.html → segments after locale: trika, siva-sutras
      expect(classifyUrl('hi/trika/siva-sutras/index.html')).toBe('text');
    });

    it('classifies en-default text path (no locale prefix) as text', () => {
      // trika/siva-sutras/index.html → segments: trika, siva-sutras (no lang code first)
      expect(classifyUrl('trika/siva-sutras/index.html')).toBe('text');
    });
  });

  describe('verse path classification', () => {
    it('classifies locale/tradition/text/chapter/verse (4 numeric-tail segments) as verse', () => {
      expect(classifyUrl('hi/trika/siva-sutras/1/1/index.html')).toBe('verse');
    });

    it('classifies en-default verse path (no locale prefix) as verse', () => {
      expect(classifyUrl('trika/siva-sutras/1/1/index.html')).toBe('verse');
    });

    it('classifies verse paths with hyphenated numeric segments as verse', () => {
      expect(classifyUrl('trika/siva-sutras/1-2/3-4/index.html')).toBe('verse');
    });

    it('does not classify a 4-segment path where last two are not numeric as verse', () => {
      // tradition/text/foo/bar — non-numeric tail
      const kind = classifyUrl('trika/siva-sutras/intro/overview/index.html');
      expect(kind).not.toBe('verse');
    });
  });

  describe('lemma path classification', () => {
    it('classifies /lemma root as lemma', () => {
      expect(classifyUrl('lemma/index.html')).toBe('lemma');
    });

    it('classifies hi/lemma as lemma (locale prefix)', () => {
      expect(classifyUrl('hi/lemma/index.html')).toBe('lemma');
    });

    it('classifies lemma/word paths as lemma', () => {
      // "lemma" as first segment after optional locale
      expect(classifyUrl('lemma/atman/index.html')).toBe('lemma');
    });
  });

  describe('other classification', () => {
    it('classifies a 3-segment path with non-numeric tail as other', () => {
      // tradition/text/chapter — 3 segments, not 2 or 4 with numeric
      expect(classifyUrl('trika/siva-sutras/1/index.html')).toBe('other');
    });

    it('classifies a deep path beyond 4 content segments as other', () => {
      expect(classifyUrl('trika/siva-sutras/1/1/extra/index.html')).toBe('other');
    });
  });
});

// ---------------------------------------------------------------------------
// extractLocale
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: extractLocale', () => {
  it('returns hi for hi/-prefixed path', () => {
    expect(extractLocale('hi/trika/siva-sutras/index.html')).toBe('hi');
  });

  it('returns en for root-level path without lang code prefix', () => {
    expect(extractLocale('index.html')).toBe('en');
  });

  it('returns en for tradition-prefixed path (trika is not a lang code)', () => {
    expect(extractLocale('trika/siva-sutras/index.html')).toBe('en');
  });

  it('returns en for en/ locale prefix explicitly', () => {
    // 'en' is a valid lang code → extractLocale returns 'en'
    expect(extractLocale('en/trika/siva-sutras/index.html')).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// hasNoindex
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: hasNoindex', () => {
  it('returns true for html with noindex robots meta', () => {
    expect(hasNoindex(NOINDEX_HTML)).toBe(true);
  });

  it('returns false for html with index robots meta', () => {
    expect(hasNoindex(CLEAN_HTML)).toBe(false);
  });

  it('returns false for html with no robots meta at all', () => {
    const html = `<html><head></head><body></body></html>`;
    expect(hasNoindex(html)).toBe(false);
  });

  it('returns true for noindex in single-value content', () => {
    const html = `<html><head><meta name="robots" content="noindex"></head></html>`;
    expect(hasNoindex(html)).toBe(true);
  });

  it('returns false when robots content is nofollow-only (no noindex)', () => {
    const html = `<html><head><meta name="robots" content="nofollow"></head></html>`;
    expect(hasNoindex(html)).toBe(false);
  });

  it('handles single-quoted content attribute', () => {
    const html = `<html><head><meta name='robots' content='noindex, nofollow'></head></html>`;
    expect(hasNoindex(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isRedirectPage
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: isRedirectPage', () => {
  it('returns true for a page with meta http-equiv refresh', () => {
    expect(isRedirectPage(REDIRECT_HTML)).toBe(true);
  });

  it('returns false for a normal page without meta refresh', () => {
    expect(isRedirectPage(CLEAN_HTML)).toBe(false);
  });

  it('returns true for refresh with double-quoted attribute', () => {
    const html = `<html><head><meta http-equiv="refresh" content="0; url=/foo"></head></html>`;
    expect(isRedirectPage(html)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ALLOWED_NOINDEX_ROUTES
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: ALLOWED_NOINDEX_ROUTES', () => {
  it('contains /404', () => {
    expect(ALLOWED_NOINDEX_ROUTES.has('/404')).toBe(true);
  });

  it('contains /sample', () => {
    expect(ALLOWED_NOINDEX_ROUTES.has('/sample')).toBe(true);
  });

  it('does not contain ordinary content routes', () => {
    expect(ALLOWED_NOINDEX_ROUTES.has('/trika/siva-sutras')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sweepDistForNoindex — integration tests with fixture dist trees
// ---------------------------------------------------------------------------

describe('seo-dist-noindex-sweep: sweepDistForNoindex', () => {
  const LIVE_EN_HI = new Set(['en', 'hi']);

  it('detects noindex violation in a live-locale content page', async () => {
    const distDir = makeTempDistDir();
    // hi locale is live; noindex on a verse page → violation
    writeHtml(distDir, 'hi/trika/siva-sutras/1/1/index.html', NOINDEX_HTML);

    const { failures } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      locale: 'hi',
      kind: 'verse',
    });
  });

  it('reports no violation when a live-locale page does NOT carry noindex', async () => {
    const distDir = makeTempDistDir();
    writeHtml(distDir, 'hi/trika/siva-sutras/1/1/index.html', CLEAN_HTML);

    const { failures } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(0);
  });

  it('ignores noindex on pages belonging to a NON-live locale', async () => {
    const distDir = makeTempDistDir();
    // 'ta' (Tamil) is a valid lang code but NOT in LIVE_EN_HI — should be skipped
    writeHtml(distDir, 'ta/trika/siva-sutras/1/1/index.html', NOINDEX_HTML);

    const { failures } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(0);
  });

  it('skips ALLOWED_NOINDEX_ROUTES paths even when they carry noindex', async () => {
    const distDir = makeTempDistDir();
    // dist/404.html → inferRoutePath produces '/404' → in ALLOWED_NOINDEX_ROUTES
    writeHtml(distDir, '404.html', NOINDEX_HTML);
    // Also add a clean live-locale page so we confirm the sweep still ran
    writeHtml(distDir, 'hi/trika/siva-sutras/1/1/index.html', CLEAN_HTML);

    const { failures } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(0);
  });

  it('skips redirect stub pages (they must carry noindex)', async () => {
    const distDir = makeTempDistDir();
    // A redirect page in a live locale carries noindex by design — must not be a violation
    writeHtml(distDir, 'hi/trika/siva-sutras/index.html', REDIRECT_HTML);

    const { failures } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(0);
  });

  it('returns correct matrix counts per live locale', async () => {
    const distDir = makeTempDistDir();
    writeHtml(distDir, 'en/trika/siva-sutras/1/1/index.html', CLEAN_HTML);
    writeHtml(distDir, 'hi/trika/siva-sutras/1/1/index.html', CLEAN_HTML);
    writeHtml(distDir, 'hi/trika/siva-sutras/1/2/index.html', CLEAN_HTML);

    const { failures, matrix } = await sweepDistForNoindex({ distDir, liveLocales: LIVE_EN_HI });

    expect(failures).toHaveLength(0);
    expect(matrix.get('en')).toBe(1);
    expect(matrix.get('hi')).toBe(2);
  });
});
