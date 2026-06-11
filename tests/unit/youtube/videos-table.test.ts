/**
 * videos-table.test.ts
 *
 * The `videos` lifecycle DB layer against a throwaway in-memory sqlite built
 * from db/schema.sql: insertPending (+ idempotency), updateVideoStatus,
 * getLatestVideo, listByStatus, countByStatus, markSuperseded, and the
 * quota round-trip (addQuotaUnits / getQuotaToday).
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addQuotaUnits,
  countByStatus,
  getLatestVideo,
  getQuotaToday,
  insertPending,
  listByStatus,
  markSuperseded,
  updateVideoStatus,
} from '../../../src/lib/videos-db';
import { SIVA_1_1_NEW, buildTempDb } from './_db-helpers';

const IDENT = { text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en', short_index: 0 };

let db: Database;
beforeEach(() => {
  db = buildTempDb();
});
afterEach(() => {
  db.close();
});

describe('insertPending', () => {
  it('creates a row in status pending', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    expect(id).toBeGreaterThan(0);
    const row = getLatestVideo(db, IDENT);
    expect(row).not.toBeNull();
    expect(row!.status).toBe('pending');
    expect(row!.text_id).toBe('siva-sutras');
  });

  it('is idempotent on the determinism key (same id, one row)', () => {
    const id1 = insertPending(db, SIVA_1_1_NEW);
    const id2 = insertPending(db, SIVA_1_1_NEW);
    expect(id2).toBe(id1);
    expect(countByStatus(db).pending).toBe(1);
  });
});

describe('updateVideoStatus', () => {
  it('moves a row pending → rendered', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    updateVideoStatus(db, id, 'rendered', { rendered_at: '2026-06-09T00:00:00Z' });
    const row = getLatestVideo(db, IDENT);
    expect(row!.status).toBe('rendered');
    expect(row!.rendered_at).toBe('2026-06-09T00:00:00Z');
  });
});

describe('getLatestVideo', () => {
  it('returns the newest row (highest id) for an identity tuple', () => {
    insertPending(db, SIVA_1_1_NEW);
    // A second, distinct determinism key (md5 drift) → new row.
    const id2 = insertPending(db, { ...SIVA_1_1_NEW, translation_md5: 'md5-v2' });
    const row = getLatestVideo(db, IDENT);
    expect(row!.id).toBe(id2);
    expect(row!.translation_md5).toBe('md5-v2');
  });

  it('returns null when no row exists', () => {
    expect(getLatestVideo(db, IDENT)).toBeNull();
  });
});

describe('listByStatus + countByStatus', () => {
  it('countByStatus reflects per-status counts (all keys present)', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    insertPending(db, { ...SIVA_1_1_NEW, translation_md5: 'md5-v2' });
    updateVideoStatus(db, id, 'rendered');

    const counts = countByStatus(db);
    expect(counts.pending).toBe(1);
    expect(counts.rendered).toBe(1);
    expect(counts.uploaded).toBe(0);
  });

  it('listByStatus returns rows in a given status', () => {
    insertPending(db, SIVA_1_1_NEW);
    const pending = listByStatus(db, 'pending', 10);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('pending');
  });
});

describe('markSuperseded', () => {
  it('sets status superseded + stamps the action', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    markSuperseded(db, id, 'manual');
    const row = getLatestVideo(db, IDENT);
    expect(row!.status).toBe('superseded');
    expect(row!.superseded_action).toBe('manual');
    expect(row!.superseded_at).toBeTruthy();
    expect(countByStatus(db).superseded).toBe(1);
  });
});

describe('quota round-trip', () => {
  it('addQuotaUnits + getQuotaToday accumulate units and uploads', () => {
    expect(getQuotaToday(db, '@sohamhamso', '2026-06-09')).toBeNull();

    addQuotaUnits(db, '@sohamhamso', '2026-06-09', 100, 1);
    let q = getQuotaToday(db, '@sohamhamso', '2026-06-09');
    expect(q).not.toBeNull();
    expect(q!.units_spent).toBe(100);
    expect(q!.uploads_count).toBe(1);

    // Second upload same day → upsert accumulates.
    addQuotaUnits(db, '@sohamhamso', '2026-06-09', 100, 1);
    q = getQuotaToday(db, '@sohamhamso', '2026-06-09');
    expect(q!.units_spent).toBe(200);
    expect(q!.uploads_count).toBe(2);
  });
});
