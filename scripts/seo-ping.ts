#!/usr/bin/env bun
import { getLemmaRoutes } from '../src/lib/seo/corpus-bundle';

interface PingTarget {
  expectContentType: RegExp;
  name: string;
  path: string;
}

interface PingResult {
  contentType: string | null;
  name: string;
  ok: boolean;
  status: number;
  url: string;
}

function parseArgs(argv: string[]): { json: boolean; origin: string | null } {
  let json = false;
  let origin = process.env.SEO_PING_ORIGIN ?? null;

  for (const arg of argv) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg.startsWith('--origin=')) {
      origin = arg.slice('--origin='.length) || null;
    }
  }

  return { json, origin };
}

function buildTargets(): PingTarget[] {
  const sampleLemma = getLemmaRoutes()[0];
  if (!sampleLemma) {
    throw new Error('No lemma routes are available for seo:ping.');
  }

  return [
    {
      name: 'robots',
      path: '/robots.txt',
      expectContentType: /text\/plain/i,
    },
    {
      name: 'sitemap-index',
      path: '/sitemap-index.xml',
      expectContentType: /(application|text)\/xml/i,
    },
    {
      name: 'verse-page',
      path: '/trika/siva-sutras/1/1',
      expectContentType: /text\/html/i,
    },
    {
      name: 'localized-verse-page',
      path: '/hi/trika/siva-sutras/1/1',
      expectContentType: /text\/html/i,
    },
    {
      name: 'lemma-page',
      path: `/lemma/${sampleLemma.slug}`,
      expectContentType: /text\/html/i,
    },
    {
      name: 'verse-og',
      path: '/og/trika/siva-sutras/1/1?lang=hi',
      expectContentType: /image\/png/i,
    },
    {
      name: 'lemma-og',
      path: `/og/lemma/${sampleLemma.slug}?lang=ta`,
      expectContentType: /image\/png/i,
    },
  ];
}

async function ping(origin: string, target: PingTarget): Promise<PingResult> {
  const url = new URL(target.path, origin).toString();
  const response = await fetch(url, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'sohamhamso-seo-ping/1.0',
    },
  });
  const contentType = response.headers.get('Content-Type');
  const ok = response.ok && target.expectContentType.test(contentType ?? '');

  return {
    name: target.name,
    url,
    status: response.status,
    contentType,
    ok,
  };
}

function summarize(origin: string, results: PingResult[]): string {
  const lines = [`SEO ping summary`, `- Origin: ${origin}`];
  for (const result of results) {
    lines.push(
      `- ${result.name}: ${result.status} ${result.contentType ?? 'unknown'}${result.ok ? '' : ' [unexpected]'}`,
    );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.origin) {
    throw new Error('Pass --origin=https://example.com or set SEO_PING_ORIGIN.');
  }

  const origin = new URL(args.origin).toString();
  const results = await Promise.all(buildTargets().map((target) => ping(origin, target)));

  if (args.json) {
    console.log(JSON.stringify({ origin, results }, null, 2));
  } else {
    console.log(summarize(origin, results));
  }

  const failures = results.filter((result) => !result.ok);
  if (failures.length > 0) {
    const names = failures.map((result) => result.name).join(', ');
    console.error(`SEO ping failed for: ${names}`);
    process.exit(1);
  }
}

await main();
