import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectHtmlFile, loadRuntimeVersePaths, validateBuild } from '../../scripts/seo-validate';
import { __setDbForTests } from '../../src/lib/db';

const FIXTURE_ROOT = resolve(__dirname, '..', 'fixtures', 'seo');
const SITE_ORIGIN = 'https://sohamhamso.org';

function fixture(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf8');
}

async function writeTempFile(root: string, relativePath: string, contents: string): Promise<void> {
  const fullPath = resolve(root, relativePath);
  await mkdir(resolve(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, contents, 'utf8');
}

async function writeTempBinary(root: string, relativePath: string): Promise<void> {
  const fullPath = resolve(root, relativePath);
  await mkdir(resolve(fullPath, '..'), { recursive: true });
  writeFileSync(fullPath, 'png', 'utf8');
}

function makeTempDist(): string {
  return mkdtempSync(resolve(tmpdir(), 'sohamhamso-seo-'));
}

const tempDirs: string[] = [];
let corpusDb: Database | null = null;

afterEach(async () => {
  if (corpusDb) {
    __setDbForTests(null);
    corpusDb.close();
    corpusDb = null;
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function seedRuntimeCorpus(distDir: string, english = true, localized = true): Promise<void> {
  corpusDb = new Database(':memory:');
  corpusDb.exec(readFileSync(resolve('db/schema.sql'), 'utf8'));
  corpusDb.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
    VALUES ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Siva Sutras', 'trika', 'PD');
    INSERT INTO verses (text_id, chapter, verse_num, devanagari)
    VALUES ('siva-sutras', 1, 1, 'चैतन्यमात्मा');
  `);
  __setDbForTests(corpusDb);
  if (english) {
    await writeTempFile(
      distDir,
      '_worker.js/pages/_tradition_/_text_/_chapter_/_verse_.astro.mjs',
      '// Fixture for the compiled English SSR route',
    );
  }
  if (localized) {
    await writeTempFile(
      distDir,
      '_worker.js/pages/_lang_/_tradition_/_text_/_chapter_/_verse_.astro.mjs',
      '// Fixture for the compiled localized SSR route',
    );
  }
}

async function seedSupportFiles(distDir: string): Promise<void> {
  await writeTempBinary(distDir, 'og/siva-sutras-1-1.png');
  await writeTempFile(
    distDir,
    'about/methodology/index.html',
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '  <title>Methodology guide | sohamhamso reference page for readers</title>',
      '  <meta name="description" content="Methodology guide for sohamhamso readers with project context, editorial process, and reading notes for the canon and translations for release checks." />',
      '  <link rel="canonical" href="https://sohamhamso.org/about/methodology" />',
      '  <meta property="og:image" content="https://sohamhamso.org/og/siva-sutras-1-1.png" />',
      '  <link rel="alternate" hreflang="en" href="https://sohamhamso.org/about/methodology" />',
      '  <link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/about/methodology" />',
      '  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","url":"https://sohamhamso.org/about/methodology","inLanguage":"en"}</script>',
      '</head>',
      '<body><a href="/trika/siva-sutras/1/1">Verse</a></body>',
      '</html>',
    ].join('\n'),
  );
}

describe('validateBuild()', () => {
  it('accepts existing SSR verse links without static HTML or localized translations', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);
    await seedRuntimeCorpus(distDir);
    await seedSupportFiles(distDir);
    const page = resolve(distDir, 'about/methodology/index.html');
    writeFileSync(
      page,
      readFileSync(page, 'utf8').replace(
        '</body>',
        '<a href="/as/trika/siva-sutras/1/1?ref=chapter#word-0">Assamese fallback</a></body>',
      ),
    );
    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });
    expect(summary.ok).toBe(true);
    expect(summary.scannedFiles).toBe(1);
  });

  it.each([
    '/trika/missing-text/1/1',
    '/trika/siva-sutras/99/1',
    '/as/trika/siva-sutras/1/99',
    '/trika/siva-sutras/0/1',
    '/zz/trika/siva-sutras/1/1',
    '/en/trika/siva-sutras/1/1',
    '/unknown/siva-sutras/1/1',
  ])('still rejects nonexistent runtime targets: %s', async (href) => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);
    await seedRuntimeCorpus(distDir);
    await seedSupportFiles(distDir);
    const page = resolve(distDir, 'about/methodology/index.html');
    writeFileSync(page, readFileSync(page, 'utf8').replace('/trika/siva-sutras/1/1', href));
    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });
    expect(summary.issues.filter((issue) => issue.rule === 'internal-links')).toEqual([
      expect.objectContaining({ message: `Broken internal link: ${href}` }),
    ]);
  });

  it('requires the compiled SSR route, rather than trusting corpus addresses alone', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);
    await seedRuntimeCorpus(distDir, false, true);
    expect(loadRuntimeVersePaths(distDir).has('/as/trika/siva-sutras/1/1')).toBe(true);
    expect(loadRuntimeVersePaths(distDir).has('/trika/siva-sutras/1/1')).toBe(false);
    await seedSupportFiles(distDir);
    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });
    expect(summary.issues.some((issue) => issue.rule === 'internal-links')).toBe(true);
  });

  it('passes for a valid two-language cluster plus redirect stubs', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);

    await seedSupportFiles(distDir);
    await writeTempFile(
      distDir,
      'trika/siva-sutras/1/1/index.html',
      fixture('valid-en-verse.html'),
    );
    await writeTempFile(
      distDir,
      'hi/trika/siva-sutras/1/1/index.html',
      fixture('valid-hi-verse.html'),
    );
    await writeTempFile(
      distDir,
      'ta/trika/siva-sutras/1/1/index.html',
      fixture('noindex-ta-verse.html'),
    );
    await writeTempFile(
      distDir,
      'trika/shiva-sutras/1/1/index.html',
      fixture('redirect-page.html'),
    );

    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });

    expect(summary.ok).toBe(true);
    expect(summary.issueCount).toBe(0);
    expect(summary.skippedFiles).toBe(1);
  });

  it('reports grouped issues for broken pages', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);

    await seedSupportFiles(distDir);
    await writeTempFile(distDir, 'trika/siva-sutras/1/1/index.html', fixture('broken-page.html'));

    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });

    expect(summary.ok).toBe(false);
    expect(summary.grouped.map((group) => group.rule)).toEqual(
      expect.arrayContaining(['canonical', 'hreflang', 'og-image', 'jsonld', 'internal-links']),
    );
  });

  it('flags hreflang links that point at noindex pages', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);

    const enWithTamil = fixture('valid-en-verse.html').replace(
      '<link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/trika/siva-sutras/1/1" />',
      [
        '<link rel="alternate" hreflang="ta" href="https://sohamhamso.org/ta/trika/siva-sutras/1/1" />',
        '<link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/trika/siva-sutras/1/1" />',
      ].join('\n  '),
    );
    const hiWithTamil = fixture('valid-hi-verse.html').replace(
      '<link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/trika/siva-sutras/1/1" />',
      [
        '<link rel="alternate" hreflang="ta" href="https://sohamhamso.org/ta/trika/siva-sutras/1/1" />',
        '<link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/trika/siva-sutras/1/1" />',
      ].join('\n  '),
    );

    await seedSupportFiles(distDir);
    await writeTempFile(distDir, 'trika/siva-sutras/1/1/index.html', enWithTamil);
    await writeTempFile(distDir, 'hi/trika/siva-sutras/1/1/index.html', hiWithTamil);
    await writeTempFile(
      distDir,
      'ta/trika/siva-sutras/1/1/index.html',
      fixture('noindex-ta-verse.html'),
    );

    const summary = await validateBuild({ distDir, siteOrigin: SITE_ORIGIN });

    expect(summary.ok).toBe(false);
    expect(summary.issues.some((issue) => issue.message.includes('points at noindex page'))).toBe(
      true,
    );
  });
});

describe('inspectHtmlFile()', () => {
  it.each([
    ['as/shakta/mahanirvana-tantra/2.html', '/as/shakta/mahanirvana-tantra/2/', true],
    ['hi/trika/siva-sutras/1/index.html', '/hi/trika/siva-sutras/1/', true],
    ['hi/trika/siva-sutras/1.html', '/hi/trika/siva-sutras/1', false],
    ['trika/siva-sutras/1.html', '/trika/siva-sutras/1', true],
    ['trika/siva-sutras/1.html', '/trika/siva-sutras/1/', false],
    ['hi/about/methodology.html', '/hi/about/methodology/', false],
    ['hi/lemma/atman.html', '/hi/lemma/atman/', false],
    ['hi/trika/siva-sutras/1/1.html', '/hi/trika/siva-sutras/1/1/', false],
    ['hi/trika/siva-sutras/1.html', '/hi/trika/siva-sutras/2/', false],
  ])('enforces the specific chapter canonical contract for %s', async (file, canonical, valid) => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);
    await writeTempFile(
      distDir,
      file,
      `
      <html lang="hi"><head>
        <title>Chapter</title>
        <meta name="description" content="Read the chapter." />
        <link rel="canonical" href="${SITE_ORIGIN}${canonical}" />
        <meta property="og:image" content="${SITE_ORIGIN}/og/chapter" />
        <script type="application/ld+json">{"@type":"WebPage"}</script>
      </head><body></body></html>
    `,
    );
    const report = await inspectHtmlFile(resolve(distDir, file), {
      distDir,
      siteOrigin: SITE_ORIGIN,
    });
    expect(report.issues.some((issue) => issue.rule === 'canonical')).toBe(!valid);
  });

  it('treats redirect stubs as redirect documents instead of normal pages', async () => {
    const distDir = makeTempDist();
    tempDirs.push(distDir);
    await writeTempFile(
      distDir,
      'trika/shiva-sutras/1/1/index.html',
      fixture('redirect-page.html'),
    );

    const report = await inspectHtmlFile(resolve(distDir, 'trika/shiva-sutras/1/1/index.html'), {
      distDir,
      siteOrigin: SITE_ORIGIN,
    });

    expect(report.isRedirect).toBe(true);
    expect(report.issues).toEqual([]);
  });
});
