/**
 * lease-sweep.test.ts (E4)
 *
 * The stale-lease sweep: a row stuck in 'rendering' whose `rendering_lease_at`
 * is older than 1h is sweepable (auto-flips to 'failed'); a fresh lease is
 * not.
 *
 * `scripts/youtube-lease-sweep.ts` does not (yet) export a pure predicate at
 * the time of writing, so we replicate the documented ">1h" boundary inline
 * and assert it against rows inserted into the real schema. If the script
 * later exports `isLeaseStale`, swap the inline helper for the import.
 *
 * TODO: import `isLeaseStale` from scripts/youtube-lease-sweep.ts once it
 * exposes the pure predicate (currently absent).
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLatestVideo, insertPending, updateVideoStatus } from '../../../src/lib/videos-db';
import { SIVA_1_1_NEW, buildTempDb } from './_db-helpers';

const ONE_HOUR_MS = 60 * 60 * 1000;
const IDENT = { text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en', short_index: 0 };

/**
 * Inline replica of the documented sweep predicate: a lease is stale when it
 * is more than 1h older than `now`. Mirrors the SQL the sweep cron runs:
 *   status='rendering' AND rendering_lease_at < datetime('now','-1 hour')
 */
function isLeaseStale(leaseAtIso: string | null, nowMs: number): boolean {
  if (!leaseAtIso) return false;
  const leaseMs = Date.parse(leaseAtIso);
  if (Number.isNaN(leaseMs)) return false;
  return nowMs - leaseMs > ONE_HOUR_MS;
}

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

describe('isLeaseStale (>1h boundary)', () => {
  const now = Date.now();

  it('a 2h-old lease is stale (sweepable)', () => {
    expect(isLeaseStale(isoAgo(2 * ONE_HOUR_MS), now)).toBe(true);
  });

  it('a 30-min-old lease is NOT stale', () => {
    expect(isLeaseStale(isoAgo(30 * 60 * 1000), now)).toBe(false);
  });

  it('exactly 1h is the boundary — not yet stale (strict >)', () => {
    expect(isLeaseStale(isoAgo(ONE_HOUR_MS), now)).toBe(false);
    expect(isLeaseStale(isoAgo(ONE_HOUR_MS + 1000), now)).toBe(true);
  });

  it('a null lease is never stale', () => {
    expect(isLeaseStale(null, now)).toBe(false);
  });
});

describe('sweep against the real schema', () => {
  let db: Database;
  beforeEach(() => {
    db = buildTempDb();
  });
  afterEach(() => {
    db.close();
  });

  it('a rendering row with a 2h-old lease is identified as sweepable', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    const staleLease = isoAgo(2 * ONE_HOUR_MS);
    updateVideoStatus(db, id, 'rendering', { rendering_lease_at: staleLease });

    const row = getLatestVideo(db, IDENT);
    expect(row!.status).toBe('rendering');
    expect(row!.rendering_lease_at).toBe(staleLease);
    expect(isLeaseStale(row!.rendering_lease_at, Date.now())).toBe(true);

    // The sweep would flip it to 'failed'.
    updateVideoStatus(db, id, 'failed', { last_error_phase: 'render' });
    expect(getLatestVideo(db, IDENT)!.status).toBe('failed');
  });

  it('a rendering row with a fresh lease is left alone', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    updateVideoStatus(db, id, 'rendering', { rendering_lease_at: isoAgo(5 * 60 * 1000) });
    const row = getLatestVideo(db, IDENT);
    expect(isLeaseStale(row!.rendering_lease_at, Date.now())).toBe(false);
  });
});
