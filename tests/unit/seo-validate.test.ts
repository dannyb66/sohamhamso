import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectHtmlFile, validateBuild } from '../../scripts/seo-validate';

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

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

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
