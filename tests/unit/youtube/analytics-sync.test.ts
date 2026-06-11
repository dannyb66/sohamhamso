/**
 * analytics-sync.test.ts
 *
 * Unit tests for the pure parts of the Cron E analytics syncer
 * (pipeline/youtube/analytics-map.ts): id-chunking against the API filter
 * cap, trailing-window date math, fixture-response → metric-row mapping,
 * the video_analytics upsert shape (METRIC HONESTY: ctr/retention_3s/
 * link_clicks_utm always NULL), and the 403 insufficient-scope classifier.
 *
 * Self-contained: no DB, no _db-helpers.ts, no live API calls.
 */
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_API_METRICS,
  MAX_IDS_PER_QUERY,
  METRIC_HONESTY_LINE,
  SCOPE_FIX_MESSAGE,
  cannedAnalyticsReport,
  chunkVideoIds,
  isInsufficientScopeError,
  mapAnalyticsReport,
  toVideoAnalyticsUpsert,
  trailingWindow,
  zeroActivityUpsert,
} from '../../../pipeline/youtube/analytics-map';

// ─────────────────────────────────────────────────────────────────────────────
// chunkVideoIds
// ─────────────────────────────────────────────────────────────────────────────

describe('chunkVideoIds', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `vid${i}`);

  it('returns [] for no ids (caller skips the API entirely)', () => {
    expect(chunkVideoIds([])).toEqual([]);
  });

  it('keeps <=50 ids in a single chunk (API filter-length cap)', () => {
    expect(chunkVideoIds(ids(50))).toHaveLength(1);
    expect(chunkVideoIds(ids(50))[0]).toHaveLength(50);
  });

  it('splits 149 ids (the current shorts corpus) into 50/50/49', () => {
    const chunks = chunkVideoIds(ids(149));
    expect(chunks.map((c) => c.length)).toEqual([50, 50, 49]);
  });

  it('preserves order across chunk boundaries', () => {
    const chunks = chunkVideoIds(ids(120), 50);
    expect(chunks.flat()).toEqual(ids(120));
    expect(chunks[1][0]).toBe('vid50');
    expect(chunks[2][0]).toBe('vid100');
  });

  it('default chunk size is the documented MAX_IDS_PER_QUERY', () => {
    expect(MAX_IDS_PER_QUERY).toBe(50);
    expect(chunkVideoIds(ids(51)).map((c) => c.length)).toEqual([50, 1]);
  });

  it('rejects a nonsensical chunk size', () => {
    expect(() => chunkVideoIds(ids(3), 0)).toThrow(/size/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// trailingWindow
// ─────────────────────────────────────────────────────────────────────────────

describe('trailingWindow', () => {
  const NOW = new Date('2026-06-10T14:30:00Z');

  it('default-style 30-day window ends today (UTC)', () => {
    expect(trailingWindow(30, NOW)).toEqual({ startDate: '2026-05-11', endDate: '2026-06-10' });
  });

  it('crosses month and year boundaries correctly', () => {
    expect(trailingWindow(30, new Date('2026-01-15T01:00:00Z'))).toEqual({
      startDate: '2025-12-16',
      endDate: '2026-01-15',
    });
  });

  it('rejects days < 1', () => {
    expect(() => trailingWindow(0, NOW)).toThrow(/days/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapAnalyticsReport (fixture API response → metric rows)
// ─────────────────────────────────────────────────────────────────────────────

const FIXTURE_REPORT = {
  columnHeaders: [
    { name: 'video' },
    { name: 'views' },
    { name: 'averageViewDuration' },
    { name: 'averageViewPercentage' },
    { name: 'subscribersGained' },
  ],
  rows: [
    ['abc123def45', 1234, 21.5, 53.2, 3],
    ['xyz987uvw65', 0, 0, 0, 0],
  ],
};

describe('mapAnalyticsReport', () => {
  it('maps a fixture response to per-video metric rows', () => {
    expect(mapAnalyticsReport(FIXTURE_REPORT)).toEqual([
      {
        youtubeVideoId: 'abc123def45',
        views: 1234,
        averageViewDurationS: 21.5,
        averageViewPercentage: 53.2,
        subscribersGained: 3,
      },
      {
        youtubeVideoId: 'xyz987uvw65',
        views: 0,
        averageViewDurationS: 0,
        averageViewPercentage: 0,
        subscribersGained: 0,
      },
    ]);
  });

  it('resolves columns by header NAME, not position', () => {
    const shuffled = {
      columnHeaders: [
        { name: 'subscribersGained' },
        { name: 'video' },
        { name: 'averageViewPercentage' },
        { name: 'views' },
        { name: 'averageViewDuration' },
      ],
      rows: [[7, 'abc123def45', 53.2, 1234, 21.5]],
    };
    expect(mapAnalyticsReport(shuffled)).toEqual([
      {
        youtubeVideoId: 'abc123def45',
        views: 1234,
        averageViewDurationS: 21.5,
        averageViewPercentage: 53.2,
        subscribersGained: 7,
      },
    ]);
  });

  it('coerces string-typed numerics (defensive against JSON transport)', () => {
    const r = mapAnalyticsReport({
      columnHeaders: FIXTURE_REPORT.columnHeaders,
      rows: [['abc123def45', '42', '10.5', '99.9', '1']],
    });
    expect(r[0].views).toBe(42);
    expect(r[0].averageViewDurationS).toBe(10.5);
    expect(r[0].averageViewPercentage).toBe(99.9);
    expect(r[0].subscribersGained).toBe(1);
  });

  it('empty/missing rows (zero activity in window) map to []', () => {
    expect(mapAnalyticsReport({ columnHeaders: FIXTURE_REPORT.columnHeaders, rows: [] })).toEqual(
      [],
    );
    expect(mapAnalyticsReport({})).toEqual([]);
  });

  it('missing metric columns become NULL, never fake zeros (except views→0)', () => {
    const r = mapAnalyticsReport({
      columnHeaders: [{ name: 'video' }, { name: 'views' }],
      rows: [['abc123def45', 10]],
    });
    expect(r[0]).toEqual({
      youtubeVideoId: 'abc123def45',
      views: 10,
      averageViewDurationS: null,
      averageViewPercentage: null,
      subscribersGained: null,
    });
  });

  it('throws when rows exist but the video dimension is absent', () => {
    expect(() => mapAnalyticsReport({ columnHeaders: [{ name: 'views' }], rows: [[5]] })).toThrow(
      /video/,
    );
  });

  it('queried metric list matches the four API-fillable metrics exactly', () => {
    expect([...ANALYTICS_API_METRICS]).toEqual([
      'views',
      'averageViewDuration',
      'averageViewPercentage',
      'subscribersGained',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toVideoAnalyticsUpsert / zeroActivityUpsert (DB column mapping + honesty)
// ─────────────────────────────────────────────────────────────────────────────

describe('toVideoAnalyticsUpsert', () => {
  const METRIC = {
    youtubeVideoId: 'abc123def45',
    views: 1234,
    averageViewDurationS: 21.5,
    averageViewPercentage: 53.2,
    subscribersGained: 3,
  };

  it('maps API metrics onto the video_analytics columns', () => {
    const u = toVideoAnalyticsUpsert(METRIC, 17, '2026-06-10');
    expect(u.video_id).toBe(17);
    expect(u.synced_at).toBe('2026-06-10');
    expect(u.view_count).toBe(1234);
    expect(u.watch_time_s).toBe(22); // averageViewDuration, rounded seconds
    expect(u.completion_rate).toBeCloseTo(0.532, 10); // pct → 0–1 fraction
    expect(u.subscribers_gained).toBe(3);
  });

  it('HONESTY: ctr / retention_3s / link_clicks_utm are NULL — never zero-filled', () => {
    const u = toVideoAnalyticsUpsert(METRIC, 17, '2026-06-10');
    expect(u.ctr).toBeNull();
    expect(u.retention_3s).toBeNull();
    expect(u.retention_50).toBeNull();
    expect(u.link_clicks_utm).toBeNull();
  });

  it('audio_lang defaults to NULL (multi-audio test fills it later)', () => {
    expect(toVideoAnalyticsUpsert(METRIC, 17, '2026-06-10').audio_lang).toBeNull();
    expect(toVideoAnalyticsUpsert(METRIC, 17, '2026-06-10', 'hi').audio_lang).toBe('hi');
  });

  it('NULL API averages stay NULL through the mapping', () => {
    const u = toVideoAnalyticsUpsert(
      {
        ...METRIC,
        averageViewDurationS: null,
        averageViewPercentage: null,
        subscribersGained: null,
      },
      17,
      '2026-06-10',
    );
    expect(u.watch_time_s).toBeNull();
    expect(u.completion_rate).toBeNull();
    expect(u.subscribers_gained).toBeNull();
  });
});

describe('zeroActivityUpsert', () => {
  it('records a real zero view_count but NULL per-view averages', () => {
    const u = zeroActivityUpsert(9, '2026-06-10');
    expect(u).toEqual({
      video_id: 9,
      synced_at: '2026-06-10',
      view_count: 0,
      watch_time_s: null,
      completion_rate: null,
      subscribers_gained: null,
      ctr: null,
      retention_3s: null,
      retention_50: null,
      link_clicks_utm: null,
      audio_lang: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isInsufficientScopeError (403 classification — named fix, no retry storm)
// ─────────────────────────────────────────────────────────────────────────────

describe('isInsufficientScopeError', () => {
  it('matches a googleapis-shaped 403 with reason insufficientPermissions', () => {
    expect(
      isInsufficientScopeError({
        code: 403,
        message: 'Insufficient Permission',
        errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }],
      }),
    ).toBe(true);
  });

  it('matches a 403 whose response data carries ACCESS_TOKEN_SCOPE_INSUFFICIENT', () => {
    expect(
      isInsufficientScopeError({
        response: {
          status: 403,
          data: {
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
            },
          },
        },
      }),
    ).toBe(true);
  });

  it('matches scope-shaped text even when no HTTP status is attached', () => {
    expect(
      isInsufficientScopeError(new Error('Request had insufficient authentication scopes.')),
    ).toBe(true);
  });

  it('does NOT match 403 quotaExceeded (expected, separate handling)', () => {
    expect(
      isInsufficientScopeError({
        code: 403,
        message: 'The request cannot be completed because you have exceeded your quota.',
        errors: [{ reason: 'quotaExceeded' }],
      }),
    ).toBe(false);
  });

  it('does NOT match transient 5xx / 429 / unrelated errors', () => {
    expect(isInsufficientScopeError({ code: 500, message: 'Backend Error' })).toBe(false);
    expect(isInsufficientScopeError({ code: 429, message: 'rate limited' })).toBe(false);
    expect(isInsufficientScopeError(new Error('socket hang up'))).toBe(false);
    expect(isInsufficientScopeError(null)).toBe(false);
    expect(isInsufficientScopeError(undefined)).toBe(false);
  });

  it('a 429 that merely mentions scopes is still not a scope failure', () => {
    expect(
      isInsufficientScopeError({ code: 429, message: 'insufficient scope tokens remaining' }),
    ).toBe(false);
  });

  it('the operator fix names the missing scope, the setup script and the secret', () => {
    expect(SCOPE_FIX_MESSAGE).toContain('yt-analytics.readonly');
    expect(SCOPE_FIX_MESSAGE).toContain('bun scripts/youtube-oauth-setup.ts');
    expect(SCOPE_FIX_MESSAGE).toContain('YT_REFRESH_TOKEN');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Honesty contract line + MOCK_ALL fixture
// ─────────────────────────────────────────────────────────────────────────────

describe('METRIC_HONESTY_LINE', () => {
  it('names every Studio-only / site-side gap so the digest reader is never misled', () => {
    expect(METRIC_HONESTY_LINE).toMatch(/CTR/i);
    expect(METRIC_HONESTY_LINE).toMatch(/3s-retention/i);
    expect(METRIC_HONESTY_LINE).toMatch(/Studio-only/i);
    expect(METRIC_HONESTY_LINE).toMatch(/site-side/i);
    expect(METRIC_HONESTY_LINE).toMatch(/NULL/);
    // The columns it protects, literally greppable:
    expect(METRIC_HONESTY_LINE).toContain('ctr/retention_3s/link_clicks_utm');
  });
});

describe('cannedAnalyticsReport (MOCK_ALL fixture)', () => {
  it('round-trips through the real mapper', () => {
    const rows = mapAnalyticsReport(cannedAnalyticsReport(['mock-abc', 'mock-def']));
    expect(rows).toHaveLength(2);
    expect(rows[0].youtubeVideoId).toBe('mock-abc');
    expect(rows[0].views).toBe(100);
    expect(rows[1].views).toBe(101);
    expect(rows[0].averageViewDurationS).toBe(21.5);
    expect(rows[0].averageViewPercentage).toBe(53.2);
  });

  it('is deterministic (same input → same report)', () => {
    expect(cannedAnalyticsReport(['a'])).toEqual(cannedAnalyticsReport(['a']));
  });
});
