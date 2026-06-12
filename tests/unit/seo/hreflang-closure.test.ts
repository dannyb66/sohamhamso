import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkHreflangGraph,
  normalizeHref,
  parseHreflangTags,
} from '../../../scripts/seo-hreflang-closure';
import type { PageNode } from '../../../scripts/seo-hreflang-closure';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tempDir: string | null = null;

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'sohamhamso-hreflang-closure-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = null;
  }
});

const ORIGIN = 'https://sohamhamso.org';

// Helper: build a PageNode with a normalized hreflangByHref map
function makeNode(urls: Record<string, string>): PageNode {
  const hreflangByHref = new Map<string, string>();
  for (const [href, lang] of Object.entries(urls)) {
    hreflangByHref.set(href, lang);
  }
  // canonicalUrl is the first key by convention in tests
  const canonicalUrl = Object.keys(urls)[0] ?? '';
  return { canonicalUrl, hreflangByHref };
}

// Helper: build a graph from a record of { pageUrl → { targetUrl → lang } }
function buildGraph(spec: Record<string, Record<string, string>>): Map<string, PageNode> {
  const graph = new Map<string, PageNode>();
  for (const [pageUrl, hrefs] of Object.entries(spec)) {
    const hreflangByHref = new Map<string, string>(Object.entries(hrefs));
    graph.set(pageUrl, { canonicalUrl: pageUrl, hreflangByHref });
  }
  return graph;
}

// ---------------------------------------------------------------------------
// parseHreflangTags
// ---------------------------------------------------------------------------

describe('seo-hreflang-closure: parseHreflangTags', () => {
  it('extracts hreflang entries from a standard HTML head', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="en" href="https://sohamhamso.org/trika/siva-sutras">
      <link rel="alternate" hreflang="hi" href="https://sohamhamso.org/hi/trika/siva-sutras">
      <link rel="alternate" hreflang="x-default" href="https://sohamhamso.org/trika/siva-sutras">
    </head></html>`;

    const entries = parseHreflangTags(html);
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.hrefLang)).toEqual(['en', 'hi', 'x-default']);
  });

  it('returns empty array when no hreflang link tags are present', () => {
    const html = `<html><head><link rel="canonical" href="/foo"></head></html>`;
    expect(parseHreflangTags(html)).toHaveLength(0);
  });

  it('ignores link tags without rel="alternate"', () => {
    const html = `<html><head>
      <link rel="stylesheet" hreflang="en" href="/style.css">
      <link rel="alternate" hreflang="en" href="/en/page">
    </head></html>`;
    const entries = parseHreflangTags(html);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.hrefLang).toBe('en');
  });

  it('lowercases hreflang values', () => {
    const html = `<html><head>
      <link rel="alternate" hreflang="EN" href="/en/page">
      <link rel="alternate" hreflang="X-Default" href="/en/page">
    </head></html>`;
    const entries = parseHreflangTags(html);
    expect(entries.map((e) => e.hrefLang)).toEqual(['en', 'x-default']);
  });

  it('ignores alternate links that have no hreflang attribute', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
    </head></html>`;
    expect(parseHreflangTags(html)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeHref
// ---------------------------------------------------------------------------

describe('seo-hreflang-closure: normalizeHref', () => {
  it('strips trailing slash from non-root paths', () => {
    const result = normalizeHref('https://sohamhamso.org/trika/siva-sutras/', ORIGIN);
    expect(result).toBe('https://sohamhamso.org/trika/siva-sutras');
  });

  it('preserves root path as /', () => {
    const result = normalizeHref('https://sohamhamso.org/', ORIGIN);
    expect(result).toBe('https://sohamhamso.org/');
  });

  it('strips hash fragment', () => {
    const result = normalizeHref('https://sohamhamso.org/trika/siva-sutras#verse-1', ORIGIN);
    expect(result).toBe('https://sohamhamso.org/trika/siva-sutras');
  });

  it('returns null for truly unparseable hrefs (empty string)', () => {
    // normalizeHref resolves relative paths; only fully unparseable inputs return null.
    // An empty string after stripping cannot form a valid URL with just the origin base.
    const result = normalizeHref('', ORIGIN);
    // Empty href resolves to the origin root — not null — so verify it normalizes to root.
    expect(result).toBe('https://sohamhamso.org/');
  });

  it('URL-encodes unusual but parseable relative paths (does not return null)', () => {
    // new URL("not a url", base) percent-encodes spaces rather than throwing
    const result = normalizeHref('not a url !!!', ORIGIN);
    expect(result).not.toBeNull();
    expect(result).toContain('sohamhamso.org');
  });

  it('resolves relative hrefs against the base origin', () => {
    const result = normalizeHref('/trika/siva-sutras', ORIGIN);
    expect(result).toBe('https://sohamhamso.org/trika/siva-sutras');
  });
});

// ---------------------------------------------------------------------------
// checkHreflangGraph: bidirectional closure
// ---------------------------------------------------------------------------

describe('seo-hreflang-closure: checkHreflangGraph', () => {
  const enUrl = 'https://sohamhamso.org/trika/siva-sutras';
  const hiUrl = 'https://sohamhamso.org/hi/trika/siva-sutras';

  describe('perfect bidirectional cluster', () => {
    it('returns no violations for a fully symmetric cluster with x-default', () => {
      const enNode = new Map<string, string>([
        [enUrl, 'en'],
        [hiUrl, 'hi'],
        ['x-default-sentinel', 'x-default'],
      ]);
      const hiNode = new Map<string, string>([
        [enUrl, 'en'],
        [hiUrl, 'hi'],
        ['x-default-sentinel', 'x-default'],
      ]);
      const cleanGraph = new Map<string, PageNode>([
        [enUrl, { canonicalUrl: enUrl, hreflangByHref: enNode }],
        [hiUrl, { canonicalUrl: hiUrl, hreflangByHref: hiNode }],
      ]);

      const violations = checkHreflangGraph(cleanGraph);
      expect(violations).toHaveLength(0);
    });

    it('returns no violations for a page with no hreflang entries', () => {
      const graph = buildGraph({
        [enUrl]: {},
      });
      const violations = checkHreflangGraph(graph);
      expect(violations).toHaveLength(0);
    });
  });

  describe('asymmetric-hreflang violation', () => {
    it('detects asymmetry when A→B but B does not link back to A', () => {
      const graph = new Map<string, PageNode>([
        [
          enUrl,
          {
            canonicalUrl: enUrl,
            hreflangByHref: new Map([
              [hiUrl, 'hi'],
              ['x-default-sentinel', 'x-default'],
            ]),
          },
        ],
        [
          hiUrl,
          {
            canonicalUrl: hiUrl,
            // Missing link back to enUrl
            hreflangByHref: new Map([['x-default-sentinel', 'x-default']]),
          },
        ],
      ]);

      const violations = checkHreflangGraph(graph);
      const asymmetric = violations.filter((v) => v.issue === 'asymmetric-hreflang');
      expect(asymmetric).toHaveLength(1);
      expect(asymmetric[0]).toMatchObject({
        source: enUrl,
        lang: 'hi',
        target: hiUrl,
        issue: 'asymmetric-hreflang',
      });
    });
  });

  describe('orphan-hreflang violation', () => {
    it('detects orphan when a hreflang href points to a URL not in the graph', () => {
      const missingUrl = 'https://sohamhamso.org/ta/trika/siva-sutras';
      const graph = new Map<string, PageNode>([
        [
          enUrl,
          {
            canonicalUrl: enUrl,
            hreflangByHref: new Map([
              [hiUrl, 'hi'],
              [missingUrl, 'ta'], // ta page not in graph
              ['x-default-sentinel', 'x-default'],
            ]),
          },
        ],
        [
          hiUrl,
          {
            canonicalUrl: hiUrl,
            hreflangByHref: new Map([
              [enUrl, 'en'],
              ['x-default-sentinel', 'x-default'],
            ]),
          },
        ],
      ]);

      const violations = checkHreflangGraph(graph);
      const orphans = violations.filter((v) => v.issue === 'orphan-hreflang');
      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toMatchObject({
        source: enUrl,
        lang: 'ta',
        target: missingUrl,
        issue: 'orphan-hreflang',
      });
    });
  });

  describe('missing-x-default violation', () => {
    it('detects missing x-default on a page that emits hreflang entries', () => {
      const graph = new Map<string, PageNode>([
        [
          enUrl,
          {
            canonicalUrl: enUrl,
            // No x-default entry
            hreflangByHref: new Map([
              [enUrl, 'en'],
              [hiUrl, 'hi'],
            ]),
          },
        ],
        [
          hiUrl,
          {
            canonicalUrl: hiUrl,
            // No x-default entry
            hreflangByHref: new Map([
              [enUrl, 'en'],
              [hiUrl, 'hi'],
            ]),
          },
        ],
      ]);

      const violations = checkHreflangGraph(graph);
      const missingXDefault = violations.filter((v) => v.issue === 'missing-x-default');
      expect(missingXDefault.length).toBeGreaterThanOrEqual(1);
      expect(missingXDefault[0]).toMatchObject({
        lang: 'x-default',
        issue: 'missing-x-default',
      });
    });

    it('does NOT emit missing-x-default for a page with zero hreflang entries', () => {
      const graph = new Map<string, PageNode>([
        [
          enUrl,
          {
            canonicalUrl: enUrl,
            hreflangByHref: new Map(), // No hreflang at all → skipped
          },
        ],
      ]);

      const violations = checkHreflangGraph(graph);
      expect(violations.filter((v) => v.issue === 'missing-x-default')).toHaveLength(0);
    });
  });

  describe('clean cluster with x-default', () => {
    it('passes with no violations for a clean 3-lang cluster with x-default', () => {
      const taUrl = 'https://sohamhamso.org/ta/trika/siva-sutras';
      const xDefault = 'x-default-sentinel';

      const makeCluster = (selfUrl: string) =>
        new Map<string, string>([
          [enUrl, 'en'],
          [hiUrl, 'hi'],
          [taUrl, 'ta'],
          [xDefault, 'x-default'],
        ]);

      const graph = new Map<string, PageNode>([
        [enUrl, { canonicalUrl: enUrl, hreflangByHref: makeCluster(enUrl) }],
        [hiUrl, { canonicalUrl: hiUrl, hreflangByHref: makeCluster(hiUrl) }],
        [taUrl, { canonicalUrl: taUrl, hreflangByHref: makeCluster(taUrl) }],
      ]);

      const violations = checkHreflangGraph(graph);
      expect(violations).toHaveLength(0);
    });
  });

  describe('multiple violation types simultaneously', () => {
    it('collects asymmetric and orphan violations in the same sweep', () => {
      const orphanUrl = 'https://sohamhamso.org/xx/trika/siva-sutras';
      const graph = new Map<string, PageNode>([
        [
          enUrl,
          {
            canonicalUrl: enUrl,
            hreflangByHref: new Map([
              [hiUrl, 'hi'], // hiUrl won't link back → asymmetric
              [orphanUrl, 'xx'], // not in graph → orphan
              ['x-default-sentinel', 'x-default'],
            ]),
          },
        ],
        [
          hiUrl,
          {
            canonicalUrl: hiUrl,
            // No link back to enUrl
            hreflangByHref: new Map([['x-default-sentinel', 'x-default']]),
          },
        ],
      ]);

      const violations = checkHreflangGraph(graph);
      const orphans = violations.filter((v) => v.issue === 'orphan-hreflang');
      const asymmetric = violations.filter((v) => v.issue === 'asymmetric-hreflang');
      expect(orphans).toHaveLength(1);
      expect(asymmetric).toHaveLength(1);
    });
  });
});
