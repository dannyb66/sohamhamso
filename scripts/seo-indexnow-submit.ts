#!/usr/bin/env bun
/**
 * IndexNow submitter for sohamhamso.org.
 *
 * Reads all 5 sitemaps from production, extracts <loc> URLs, dedupes,
 * and POSTs them to the IndexNow API in batches of 10000.
 *
 * Usage:
 *   bun scripts/seo-indexnow-submit.ts             # submit all URLs
 *   bun scripts/seo-indexnow-submit.ts --dry-run   # list count + first 10
 *   bun scripts/seo-indexnow-submit.ts --limit=100 # cap submissions
 */

export {};

const HOST = 'sohamhamso.org';
const KEY = 'c2a4f8280a57eee77934f6ed5aab3845fd81a9bdcdec354564a1dde2020d9dc7';
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH_SIZE = 10000;

const SITEMAPS = [
  `https://${HOST}/sitemap-index.xml`,
  `https://${HOST}/sitemap-verses.xml`,
  `https://${HOST}/sitemap-texts.xml`,
  `https://${HOST}/sitemap-lemmas.xml`,
  `https://${HOST}/sitemap-chrome.xml`,
];

interface CliArgs {
  dryRun: boolean;
  limit: number | null;
}

interface BatchResult {
  batchIndex: number;
  ok: boolean;
  status: number;
  body: string;
  urlCount: number;
}

function parseArgs(argv: string[]): CliArgs {
  let dryRun = false;
  let limit: number | null = null;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      const value = Number.parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --limit value: ${arg}`);
      }
      limit = value;
    }
  }

  return { dryRun, limit };
}

async function fetchSitemap(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'sohamhamso-indexnow/1.0' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

function extractLocs(xml: string): string[] {
  const matches = xml.matchAll(/<loc>([^<]+)<\/loc>/g);
  const urls: string[] = [];
  for (const match of matches) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

async function collectUrls(): Promise<string[]> {
  const all = new Set<string>();
  for (const sitemap of SITEMAPS) {
    const xml = await fetchSitemap(sitemap);
    const locs = extractLocs(xml);
    console.log(`- ${sitemap}: ${locs.length} <loc> entries`);
    for (const url of locs) {
      // Skip nested sitemap references; we list them explicitly above.
      if (url.endsWith('.xml')) continue;
      all.add(url);
    }
  }
  return Array.from(all);
}

async function submitBatch(urls: string[], batchIndex: number): Promise<BatchResult> {
  const body = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: urls,
  };
  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': 'sohamhamso-indexnow/1.0',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const ok = response.status === 200 || response.status === 202;
  return {
    batchIndex,
    ok,
    status: response.status,
    body: text,
    urlCount: urls.length,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log(`IndexNow submitter for ${HOST}`);
  console.log(`Key location: ${KEY_LOCATION}`);
  console.log('Fetching sitemaps...');

  let urls = await collectUrls();
  console.log(`\nTotal unique URLs: ${urls.length}`);

  if (args.limit !== null) {
    urls = urls.slice(0, args.limit);
    console.log(`Limited to first ${urls.length} URLs (--limit=${args.limit})`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: first 10 URLs:');
    for (const url of urls.slice(0, 10)) {
      console.log(`  ${url}`);
    }
    console.log(
      `\nDry run complete. Would submit ${urls.length} URLs in ${Math.ceil(urls.length / BATCH_SIZE)} batch(es).`,
    );
    return;
  }

  if (urls.length === 0) {
    console.error('No URLs to submit.');
    process.exit(1);
  }

  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE));
  }
  console.log(
    `Submitting ${urls.length} URLs in ${batches.length} batch(es) of up to ${BATCH_SIZE}...`,
  );

  const results: BatchResult[] = [];
  for (let i = 0; i < batches.length; i++) {
    const result = await submitBatch(batches[i], i + 1);
    results.push(result);
    const flag = result.ok ? 'OK' : 'FAIL';
    console.log(
      `Batch ${result.batchIndex}/${batches.length}: ${result.status} ${flag} (${result.urlCount} URLs)`,
    );
    if (!result.ok) {
      console.error(`  Response body: ${result.body.slice(0, 500)}`);
    }
  }

  console.log('\nSummary:');
  console.log(`- Total URLs: ${urls.length}`);
  console.log(`- Batches: ${batches.length}`);
  const statusCounts = new Map<number, number>();
  for (const r of results) {
    statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1);
  }
  for (const [status, count] of statusCounts) {
    console.log(`- Status ${status}: ${count} batch(es)`);
  }

  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error(`\n${failures.length} batch(es) failed.`);
    process.exit(1);
  }
}

await main();
