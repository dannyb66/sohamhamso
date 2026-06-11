/**
 * supersede-policy.test.ts (E2)
 *
 * The supersede policy: a row marked superseded with the 'auto-private'
 * action records both `superseded_at` and the stored action — the audit
 * trail the supersede-sweep relies on (auto-private after 30d).
 */
// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import type { Database } from 'bun:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getLatestVideo, insertPending, markSuperseded } from '../../../src/lib/videos-db';
import { SIVA_1_1_NEW, buildTempDb } from './_db-helpers';

const IDENT = { text_id: 'siva-sutras', chapter: 1, verse_num: 1, lang: 'en', short_index: 0 };

let db: Database;
beforeEach(() => {
  db = buildTempDb();
});
afterEach(() => {
  db.close();
});

describe('markSuperseded — auto-private (E2)', () => {
  it('stamps superseded_at and stores the auto-private action', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    markSuperseded(db, id, 'auto-private');

    const row = getLatestVideo(db, IDENT);
    expect(row!.status).toBe('superseded');
    expect(row!.superseded_action).toBe('auto-private');
    expect(row!.superseded_at).toBeTruthy();
    // superseded_at must parse as a real timestamp.
    expect(Number.isNaN(Date.parse(row!.superseded_at!))).toBe(false);
  });

  it('accepts the replace-asset action variant', () => {
    const id = insertPending(db, SIVA_1_1_NEW);
    markSuperseded(db, id, 'replace-asset');
    const row = getLatestVideo(db, IDENT);
    expect(row!.superseded_action).toBe('replace-asset');
  });
});
