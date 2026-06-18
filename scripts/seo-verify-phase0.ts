#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import {
  type OgFunctionContext,
  handleLemmaOgRequest,
  handleVerseOgRequest,
} from '../functions/og/_shared';
import { getLemmaRoutes, getLemmaSummaryBySlug } from '../src/lib/seo/corpus-bundle';
import { parseLemmaOgUrl, parseVerseOgUrl } from '../src/lib/seo/og-payload';
import { collectHtmlFiles, inspectHtmlFile, resolveSiteOrigin } from './seo-validate';

interface PngDimensions {
  height: number;
  width: number;
}

interface Phase0Report {
  build: {
    distExists: boolean;
    htmlFiles: number | null;
    ogTaggedPages: number | null;
    totalFiles: number | null;
    underCloudflarePagesCap: boolean | null;
  };
  files: {
    appleTouchIcon: boolean;
    favicon16: boolean;
    favicon32: boolean;
    manifest: boolean;
    ogDefaultPng: PngDimensions | null;
  };
  localChecks: {
    lemmaSlugAudit: {
      duplicates: string[];
      missingSummaries: string[];
      routeCount: number;
    };
    ogHandlers: {
      invalidLangRejected: boolean;
      lemmaSampleSlug: string;
      lemmaFallback: HandlerCheck;
      lemmaSuccess: HandlerCheck;
      noisyQueryNormalized: boolean;
      verseFallback: HandlerCheck;
      verseSuccess: HandlerCheck;
    };
  };
  manualChecks: Array<{
    blocker?: string;
    name: string;
    status: 'done' | 'pending';
  }>;
  siteOrigin: string;
}

interface HandlerCheck {
  cacheControl: string | null;
  contentType: string | null;
  fallback: string | null;
  format: string | null;
  ok: boolean;
  renderer: string | null;
  status: number;
}

function parseArgs(argv: string[]): { distDir: string; json: boolean } {
  let distDir = 'dist';
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--dist=')) {
      distDir = arg.slice('--dist='.length) || 'dist';
    }
  }
  return { distDir, json };
}

function readPngDimensions(filePath: string): PngDimensions | null {
  if (!existsSync(filePath)) return null;
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!signature.equals(expected)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

async function countFiles(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      total += await countFiles(fullPath);
      continue;
    }
    total += 1;
  }
  return total;
}

function auditLemmaRoutes(): Phase0Report['localChecks']['lemmaSlugAudit'] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const missingSummaries: string[] = [];

  for (const route of getLemmaRoutes()) {
    if (seen.has(route.slug)) duplicates.push(route.slug);
    seen.add(route.slug);
    if (!getLemmaSummaryBySlug(route.slug)) missingSummaries.push(route.slug);
  }

  return {
    duplicates,
    missingSummaries,
    routeCount: seen.size,
  };
}

async function assetResponseForPath(assetPath: string): Promise<Response> {
  const file = Bun.file(assetPath);
  return new Response(await file.arrayBuffer(), {
    status: 200,
    headers: {
      'Content-Type': mimeTypeForPath(assetPath),
    },
  });
}

function mimeTypeForPath(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.svg') return 'image/svg+xml; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.woff2') return 'font/woff2';
  if (extension === '.ttf') return 'font/ttf';
  if (extension === '.ttc') return 'font/collection';
  if (extension === '.wasm') return 'application/wasm';
  return 'application/octet-stream';
}

async function runHandlerCheck(
  handler: (context: OgFunctionContext) => Promise<Response>,
  url: string,
  options: { forceFallback?: boolean } = {},
): Promise<HandlerCheck> {
  const response = await handler({
    request: new Request(url),
    env: {
      ASSETS: {
        fetch: async (input) => {
          const requestUrl =
            input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
          if (options.forceFallback && requestUrl.pathname === '/og-runtime/resvg-index_bg.wasm') {
            return new Response('Not found', { status: 404 });
          }
          const assetPath = resolve(
            process.cwd(),
            'public',
            requestUrl.pathname.replace(/^\//, ''),
          );
          if (!existsSync(assetPath)) return new Response('Not found', { status: 404 });
          return assetResponseForPath(assetPath);
        },
      },
    },
    waitUntil: () => {},
  });
  return {
    ok: response.ok,
    status: response.status,
    cacheControl: response.headers.get('Cache-Control'),
    contentType: response.headers.get('Content-Type'),
    fallback: response.headers.get('X-OG-Fallback'),
    format: response.headers.get('X-OG-Format'),
    renderer: response.headers.get('X-OG-Renderer'),
  };
}

async function inspectOgCoverage(
  distDir: string,
  siteOrigin: string,
): Promise<{
  htmlFiles: number | null;
  ogTaggedPages: number | null;
  totalFiles: number | null;
  underCloudflarePagesCap: boolean | null;
}> {
  if (!existsSync(distDir)) {
    return {
      htmlFiles: null,
      ogTaggedPages: null,
      totalFiles: null,
      underCloudflarePagesCap: null,
    };
  }

  const htmlFiles = await collectHtmlFiles(distDir);
  let ogTaggedPages = 0;
  for (const filePath of htmlFiles) {
    const report = await inspectHtmlFile(filePath, { distDir, siteOrigin });
    if (report.ogImageUrl?.startsWith(`${siteOrigin}/og/`)) {
      ogTaggedPages += 1;
    }
  }

  const totalFiles = await countFiles(distDir);
  return {
    htmlFiles: htmlFiles.length,
    ogTaggedPages,
    totalFiles,
    underCloudflarePagesCap: totalFiles < 20000,
  };
}

function buildManualChecks(): Phase0Report['manualChecks'] {
  return [
    {
      name: 'Googlebot raw-HTML / Search Console URL inspection',
      status: 'pending',
      blocker: 'Requires live deploy access and external crawler tooling.',
    },
    {
      name: 'Indic demand / SERP sanity check',
      status: 'pending',
      blocker: 'Requires web search tools and live query validation.',
    },
    {
      name: 'Social debugger validation for X/Twitter and Facebook',
      status: 'pending',
      blocker: 'Requires live public URLs and external debugger tooling.',
    },
    {
      name: 'Production crawl validation after deploy',
      status: 'pending',
      blocker: 'Requires deployed responses rather than local function execution.',
    },
  ];
}

function summarize(report: Phase0Report): string {
  const lines = [
    'Phase 0 verification summary',
    `- Site origin: ${report.siteOrigin}`,
    `- Dist files: ${report.build.totalFiles ?? 'not built'}${report.build.underCloudflarePagesCap === null ? '' : report.build.underCloudflarePagesCap ? ' (under 20k cap)' : ' (over 20k cap)'}`,
    `- HTML pages: ${report.build.htmlFiles ?? 'not built'}`,
    `- Pages with dynamic og:image tags: ${report.build.ogTaggedPages ?? 'not built'}`,
    `- Lemma routes audited: ${report.localChecks.lemmaSlugAudit.routeCount}`,
    `- Lemma duplicates: ${report.localChecks.lemmaSlugAudit.duplicates.length}`,
    `- Lemma missing summaries: ${report.localChecks.lemmaSlugAudit.missingSummaries.length}`,
    `- Fallback OG asset: ${report.files.ogDefaultPng ? `${report.files.ogDefaultPng.width}x${report.files.ogDefaultPng.height}` : 'missing'}`,
    `- Sample lemma slug: ${report.localChecks.ogHandlers.lemmaSampleSlug}`,
    `- Verse handler success response: ${report.localChecks.ogHandlers.verseSuccess.status} ${report.localChecks.ogHandlers.verseSuccess.contentType ?? 'unknown'} (${report.localChecks.ogHandlers.verseSuccess.format ?? 'unknown'})`,
    `- Lemma handler success response: ${report.localChecks.ogHandlers.lemmaSuccess.status} ${report.localChecks.ogHandlers.lemmaSuccess.contentType ?? 'unknown'} (${report.localChecks.ogHandlers.lemmaSuccess.format ?? 'unknown'})`,
    `- Verse handler fallback response: ${report.localChecks.ogHandlers.verseFallback.status} ${report.localChecks.ogHandlers.verseFallback.contentType ?? 'unknown'} (${report.localChecks.ogHandlers.verseFallback.format ?? 'unknown'})`,
    `- Lemma handler fallback response: ${report.localChecks.ogHandlers.lemmaFallback.status} ${report.localChecks.ogHandlers.lemmaFallback.contentType ?? 'unknown'} (${report.localChecks.ogHandlers.lemmaFallback.format ?? 'unknown'})`,
    `- Invalid lang rejected: ${report.localChecks.ogHandlers.invalidLangRejected ? 'yes' : 'no'}`,
    `- Cache key strips noisy query params: ${report.localChecks.ogHandlers.noisyQueryNormalized ? 'yes' : 'no'}`,
  ];
  for (const item of report.manualChecks) {
    lines.push(
      `- Manual check ${item.name}: ${item.status}${item.blocker ? ` (${item.blocker})` : ''}`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const distDir = resolve(process.cwd(), args.distDir);
  const siteOrigin = await resolveSiteOrigin();
  const sampleLemma = getLemmaRoutes()[0];
  if (!sampleLemma) {
    throw new Error('No lemma routes are available for Phase 0 verification.');
  }

  const verseSuccessUrl = `${siteOrigin}/og/trika/siva-sutras/1/1?lang=hi&noise=1`;
  const verseFallbackUrl = `${siteOrigin}/og/trika/siva-sutras/1/1?lang=mr&noise=1`;
  const lemmaSuccessUrl = `${siteOrigin}/og/lemma/${sampleLemma.slug}?lang=ta&cachebust=1`;
  const lemmaFallbackUrl = `${siteOrigin}/og/lemma/${sampleLemma.slug}?lang=te&cachebust=1`;

  const parsedVerse = parseVerseOgUrl(new URL(verseSuccessUrl));
  const parsedLemma = parseLemmaOgUrl(new URL(lemmaSuccessUrl));
  const noisyQueryNormalized =
    parsedVerse.ok &&
    parsedLemma.ok &&
    parsedVerse.cacheKeyUrl === `${siteOrigin}/og/trika/siva-sutras/1/1?lang=hi` &&
    parsedLemma.cacheKeyUrl === `${siteOrigin}/og/lemma/${sampleLemma.slug}?lang=ta`;
  const invalidLangRejected = !parseVerseOgUrl(
    new URL(`${siteOrigin}/og/trika/siva-sutras/1/1?lang=zz`),
  ).ok;

  const report: Phase0Report = {
    build: {
      distExists: existsSync(distDir),
      ...(await inspectOgCoverage(distDir, siteOrigin)),
    },
    files: {
      appleTouchIcon: existsSync(resolve(process.cwd(), 'public/apple-touch-icon.png')),
      favicon16: existsSync(resolve(process.cwd(), 'public/favicon-16x16.png')),
      favicon32: existsSync(resolve(process.cwd(), 'public/favicon-32x32.png')),
      manifest: existsSync(resolve(process.cwd(), 'public/manifest.json')),
      ogDefaultPng: readPngDimensions(resolve(process.cwd(), 'public/og-default.png')),
    },
    localChecks: {
      lemmaSlugAudit: auditLemmaRoutes(),
      ogHandlers: {
        invalidLangRejected,
        lemmaSampleSlug: sampleLemma.slug,
        lemmaFallback: await runHandlerCheck(handleLemmaOgRequest, lemmaFallbackUrl, {
          forceFallback: true,
        }),
        noisyQueryNormalized,
        verseFallback: await runHandlerCheck(handleVerseOgRequest, verseFallbackUrl, {
          forceFallback: true,
        }),
        lemmaSuccess: await runHandlerCheck(handleLemmaOgRequest, lemmaSuccessUrl),
        verseSuccess: await runHandlerCheck(handleVerseOgRequest, verseSuccessUrl),
      },
    },
    manualChecks: buildManualChecks(),
    siteOrigin,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(summarize(report));
  }

  const failures: string[] = [];
  if (report.localChecks.lemmaSlugAudit.duplicates.length > 0)
    failures.push('lemma slug duplicates');
  if (report.localChecks.lemmaSlugAudit.missingSummaries.length > 0)
    failures.push('lemma summaries missing');
  if (
    !report.files.ogDefaultPng ||
    report.files.ogDefaultPng.width !== 1200 ||
    report.files.ogDefaultPng.height !== 630
  ) {
    failures.push('og-default.png must exist at 1200x630');
  }
  if (
    !report.localChecks.ogHandlers.verseSuccess.ok ||
    report.localChecks.ogHandlers.verseSuccess.format !== 'png' ||
    report.localChecks.ogHandlers.verseSuccess.renderer !== 'resvg-wasm' ||
    report.localChecks.ogHandlers.verseSuccess.fallback !== null ||
    report.localChecks.ogHandlers.verseSuccess.cacheControl !==
      'public, max-age=31536000, immutable'
  ) {
    failures.push('verse OG success path must resolve to an immutable PNG render');
  }
  if (
    !report.localChecks.ogHandlers.lemmaSuccess.ok ||
    report.localChecks.ogHandlers.lemmaSuccess.format !== 'png' ||
    report.localChecks.ogHandlers.lemmaSuccess.renderer !== 'resvg-wasm' ||
    report.localChecks.ogHandlers.lemmaSuccess.fallback !== null ||
    report.localChecks.ogHandlers.lemmaSuccess.cacheControl !==
      'public, max-age=31536000, immutable'
  ) {
    failures.push('lemma OG success path must resolve to an immutable PNG render');
  }
  if (
    !report.localChecks.ogHandlers.verseFallback.ok ||
    report.localChecks.ogHandlers.verseFallback.fallback !== 'asset' ||
    report.localChecks.ogHandlers.verseFallback.format !== 'png' ||
    report.localChecks.ogHandlers.verseFallback.renderer !== null ||
    report.localChecks.ogHandlers.verseFallback.cacheControl !== 'public, max-age=60'
  ) {
    failures.push('verse OG fallback path must resolve to the PNG asset response');
  }
  if (
    !report.localChecks.ogHandlers.lemmaFallback.ok ||
    report.localChecks.ogHandlers.lemmaFallback.fallback !== 'asset' ||
    report.localChecks.ogHandlers.lemmaFallback.format !== 'png' ||
    report.localChecks.ogHandlers.lemmaFallback.renderer !== null ||
    report.localChecks.ogHandlers.lemmaFallback.cacheControl !== 'public, max-age=60'
  ) {
    failures.push('lemma OG fallback path must resolve to the PNG asset response');
  }
  if (!report.localChecks.ogHandlers.invalidLangRejected)
    failures.push('invalid lang must be rejected');
  if (!report.localChecks.ogHandlers.noisyQueryNormalized)
    failures.push('cache key must strip noisy query params');
  if (failures.length > 0) {
    console.error(`Phase 0 verification failed: ${failures.join('; ')}`);
    process.exit(1);
  }
}

await main();
