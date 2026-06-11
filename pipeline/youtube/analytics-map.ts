/**
 * pipeline/youtube/analytics-map.ts
 *
 * Pure helpers for `scripts/youtube-analytics-sync.ts` (Cron E, M0.5):
 * id-chunking for the Analytics API `filters=video==...` cap, trailing-window
 * date math, response→row mapping, the 403 insufficient-scope classifier,
 * and the metric-honesty contract line. No I/O, no googleapis import —
 * everything here is unit-testable without the network or a DB
 * (tests/unit/youtube/analytics-sync.test.ts).
 *
 * METRIC HONESTY (plan M0.5 / eng decision #24): the YouTube Analytics API v2
 * fills views, averageViewDuration, averageViewPercentage and
 * subscribersGained. CTR and Shorts 3s-retention are YouTube-Studio-only;
 * "UTM link clicks" is a site-analytics metric, not a YouTube one. Those
 * `video_analytics` columns (ctr, retention_3s, link_clicks_utm) are written
 * as NULL — "not measured", never a fake zero — and every sync run logs
 * METRIC_HONESTY_LINE so the digest/kill-switch reader is never misled.
 *
 * Column mapping into the existing `video_analytics` schema:
 *   views                 → view_count
 *   averageViewDuration   → watch_time_s   (mean seconds watched PER VIEW —
 *                           the closest existing column; it is NOT channel
 *                           total watch time. Total ≈ view_count * watch_time_s.)
 *   averageViewPercentage → completion_rate (stored as a 0–1 fraction)
 *   subscribersGained     → subscribers_gained
 *   ctr / retention_3s / retention_50 / link_clicks_utm → NULL (see above)
 *   audio_lang            → NULL for now (multi-audio-track test fills it)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Contract constants
// ─────────────────────────────────────────────────────────────────────────────

/** Metrics the Analytics API v2 actually fills, in query order. */
export const ANALYTICS_API_METRICS = [
  'views',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
] as const;

/**
 * The one-line honesty contract, logged once per sync run. Keep the column
 * names literal so an operator can grep the digest for them.
 */
export const METRIC_HONESTY_LINE =
  'metric honesty: API fills view_count, watch_time_s (= averageViewDuration, mean s/view), ' +
  'completion_rate (= averageViewPercentage) and subscribers_gained. ' +
  'CTR and 3s-retention are YouTube-Studio-only and UTM link clicks are a site-side metric — ' +
  'ctr/retention_3s/link_clicks_utm stay NULL (not measured, never zero-filled).';

/**
 * Operator-facing fix for a 403 insufficient-scope failure. Printed once,
 * then the script exits non-zero WITHOUT retrying (no retry storm — the
 * failure is configuration, not transient).
 */
export const SCOPE_FIX_MESSAGE = [
  'problem: YouTube Analytics API rejected the request with 403 (insufficient OAuth scope).',
  'cause:   the YT_REFRESH_TOKEN was minted before the scope union and lacks yt-analytics.readonly.',
  'fix:     re-run `bun scripts/youtube-oauth-setup.ts` (one consent, scope union incl. yt-analytics.readonly),',
  '         then update the YT_REFRESH_TOKEN GitHub secret: gh secret set YT_REFRESH_TOKEN < .secrets/yt-refresh.txt',
].join('\n');

/**
 * The Analytics API caps the `filters` string length; ~50 video ids per
 * `video==id1,id2,...` filter is safely under it (50 × 12 chars ≈ 650).
 */
export const MAX_IDS_PER_QUERY = 50;

// ─────────────────────────────────────────────────────────────────────────────
// Id chunking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Split video ids into query-sized chunks, order-preserving.
 * Empty input → empty list (caller skips the API entirely).
 */
export function chunkVideoIds(ids: string[], size: number = MAX_IDS_PER_QUERY): string[][] {
  if (!Number.isFinite(size) || size < 1) {
    throw new Error(`chunkVideoIds: chunk size must be >= 1 (got ${size})`);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Trailing window
// ─────────────────────────────────────────────────────────────────────────────

/**
 * UTC trailing window for `--days`: endDate = today (UTC), startDate =
 * today − days. Both as YYYY-MM-DD strings (the API's date format).
 */
export function trailingWindow(
  days: number,
  now: Date = new Date(),
): {
  startDate: string;
  endDate: string;
} {
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`trailingWindow: days must be >= 1 (got ${days})`);
  }
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = end - days * 86_400_000;
  const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Response → metric rows
// ─────────────────────────────────────────────────────────────────────────────

/** Shape of a youtubeAnalytics.reports.query response we consume. */
export interface AnalyticsReport {
  columnHeaders?: Array<{ name?: string | null } | null> | null;
  rows?: Array<Array<string | number | null>> | null;
}

/** One per-video metrics row, API-named (pre-DB-mapping). */
export interface VideoMetricsRow {
  youtubeVideoId: string;
  views: number;
  /** Mean seconds watched per view (averageViewDuration). */
  averageViewDurationS: number | null;
  /** Mean percentage of the video watched, 0–100 as the API returns it. */
  averageViewPercentage: number | null;
  subscribersGained: number | null;
}

function asFiniteNumber(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Map a `dimensions=video` Analytics report to per-video metric rows.
 * Column positions are resolved from `columnHeaders` by name (never by
 * fixed index), so metric reordering by the API cannot mis-assign values.
 * A report with no rows (zero activity in the window) maps to [].
 */
export function mapAnalyticsReport(report: AnalyticsReport): VideoMetricsRow[] {
  const rows = report.rows ?? [];
  if (rows.length === 0) return [];

  const headers = (report.columnHeaders ?? []).map((h) => h?.name ?? '');
  const videoIdx = headers.indexOf('video');
  if (videoIdx === -1) {
    throw new Error('analytics report has rows but no `video` dimension column');
  }
  const col = (name: string): number => headers.indexOf(name);
  const viewsIdx = col('views');
  const avgDurIdx = col('averageViewDuration');
  const avgPctIdx = col('averageViewPercentage');
  const subsIdx = col('subscribersGained');

  const out: VideoMetricsRow[] = [];
  for (const row of rows) {
    const id = row[videoIdx];
    if (typeof id !== 'string' || id.length === 0) continue; // malformed row — skip, don't crash the run
    out.push({
      youtubeVideoId: id,
      views: viewsIdx === -1 ? 0 : (asFiniteNumber(row[viewsIdx]) ?? 0),
      averageViewDurationS: avgDurIdx === -1 ? null : asFiniteNumber(row[avgDurIdx]),
      averageViewPercentage: avgPctIdx === -1 ? null : asFiniteNumber(row[avgPctIdx]),
      subscribersGained: subsIdx === -1 ? null : asFiniteNumber(row[subsIdx]),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Metric row → video_analytics upsert shape
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Exact column payload for the `video_analytics` upsert. The honesty
 * columns are typed `null` (not `number | null`) on purpose: this module
 * makes it impossible to "fill" a Studio-only metric by accident.
 */
export interface VideoAnalyticsUpsert {
  video_id: number;
  synced_at: string;
  view_count: number;
  /** averageViewDuration — mean seconds per view (see module header). */
  watch_time_s: number | null;
  /** averageViewPercentage / 100, as a 0–1 fraction. */
  completion_rate: number | null;
  subscribers_gained: number | null;
  // Honesty contract: API cannot fill these — always NULL.
  ctr: null;
  retention_3s: null;
  retention_50: null;
  link_clicks_utm: null;
  /** Multi-audio-track dimension; NULL until that test lands. */
  audio_lang: string | null;
}

/** Map one API metric row onto the DB upsert payload. */
export function toVideoAnalyticsUpsert(
  row: VideoMetricsRow,
  videoRowId: number,
  syncedAt: string,
  audioLang: string | null = null,
): VideoAnalyticsUpsert {
  return {
    video_id: videoRowId,
    synced_at: syncedAt,
    view_count: row.views,
    watch_time_s: row.averageViewDurationS === null ? null : Math.round(row.averageViewDurationS),
    completion_rate: row.averageViewPercentage === null ? null : row.averageViewPercentage / 100,
    subscribers_gained: row.subscribersGained,
    ctr: null,
    retention_3s: null,
    retention_50: null,
    link_clicks_utm: null,
    audio_lang: audioLang,
  };
}

/**
 * Row for a video the API returned NO row for in the window: genuinely zero
 * views (a real measurement → view_count 0), but the per-view averages are
 * undefined, so they stay NULL rather than fake zeros.
 */
export function zeroActivityUpsert(videoRowId: number, syncedAt: string): VideoAnalyticsUpsert {
  return {
    video_id: videoRowId,
    synced_at: syncedAt,
    view_count: 0,
    watch_time_s: null,
    completion_rate: null,
    subscribers_gained: null,
    ctr: null,
    retention_3s: null,
    retention_50: null,
    link_clicks_utm: null,
    audio_lang: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 403 insufficient-scope classification
// ─────────────────────────────────────────────────────────────────────────────

/** Loose shape of a googleapis (Gaxios) error without importing the dep. */
interface GaxiosLikeError {
  code?: number | string;
  message?: string;
  errors?: Array<{ reason?: string; message?: string } | null> | null;
  response?: {
    status?: number;
    data?: { error?: unknown } | null;
  } | null;
}

const SCOPE_TEXT_RE =
  /insufficient[ _]?permission|insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient[^.]{0,40}scope/i;

/**
 * True iff the error is a 403 caused by a missing OAuth scope (the refresh
 * token predates `yt-analytics.readonly`). 403 quotaExceeded, 401s and
 * transient 5xx all return false — only the scope case gets the named
 * re-auth fix + immediate non-zero exit (no retry storm).
 */
export function isInsufficientScopeError(e: unknown): boolean {
  if (e === null || typeof e !== 'object') {
    return typeof e === 'string' && SCOPE_TEXT_RE.test(e);
  }
  const err = e as GaxiosLikeError;
  const status = Number(err.code ?? err.response?.status ?? Number.NaN);

  const reasonText = (err.errors ?? [])
    .map((x) => `${x?.reason ?? ''} ${x?.message ?? ''}`)
    .join(' ');
  let dataText = '';
  try {
    dataText = JSON.stringify(err.response?.data?.error ?? '');
  } catch {
    dataText = '';
  }
  const text = `${err.message ?? ''} ${reasonText} ${dataText}`;

  if (!SCOPE_TEXT_RE.test(text)) return false;
  // Scope-shaped text + (403 or no status at all) → scope failure. Any
  // other explicit status (429/500/...) is not a scope problem.
  return status === 403 || Number.isNaN(status);
}

// ─────────────────────────────────────────────────────────────────────────────
// MOCK_ALL fixture (zero-secret path, pipeline/youtube/mocks pattern)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic canned Analytics report for the MOCK_ALL=true path — the
 * sync script feeds this through the REAL mapper + upsert code, so the
 * zero-secret run exercises everything except the network call (same
 * discipline as pipeline/youtube/mocks/canned.ts).
 */
export function cannedAnalyticsReport(ids: string[]): AnalyticsReport {
  return {
    columnHeaders: [
      { name: 'video' },
      { name: 'views' },
      { name: 'averageViewDuration' },
      { name: 'averageViewPercentage' },
      { name: 'subscribersGained' },
    ],
    rows: ids.map((id, i) => [id, 100 + i, 21.5, 53.2, i % 2]),
  };
}
