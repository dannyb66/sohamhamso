// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/**
 * Unit tests for the pure planning/checksum logic in
 * `scripts/turso-seed-corpus.ts`. No network: the runtime (libSQL client,
 * env checks) only executes when the script is invoked directly.
 *
 * The id-drift suite opens two in-memory SQLite DBs with the production
 * schema and inserts the same logical corpus in different orders, so the
 * AUTOINCREMENT ids differ — exactly what happens after a local DB rebuild.
 * The content checksums must still agree (and must disagree when content
 * actually changes).
 *
 * Run with: `bun --bun vitest run tests/unit/scripts/turso-seed-corpus.test.ts`
 */
import { describe, expect, it } from 'vitest';
import {
  BACKUP_WORKFLOW,
  TABLE_SPECS,
  VERIFY_SPECS,
  buildDeleteStatements,
  buildInserts,
  canonicalRow,
  canonicalValue,
  checksumRows,
  chunk,
  countSql,
  diffRowSets,
  formatRowSetDiff,
  parseCliArgs,
  scopedArgs,
  seedSelectSql,
  verifySql,
} from '../../../scripts/turso-seed-corpus';

const SCHEMA_PATH = resolve(__dirname, '..', '..', '..', 'db', 'schema.sql');

describe('parseCliArgs', () => {
  it('defaults to full-DB legacy mode with no flags', () => {
    expect(parseCliArgs([])).toEqual({
      textSlug: null,
      replace: false,
      deleteOnly: false,
      backupConfirmed: false,
    });
  });

  it('parses --text <slug>', () => {
    expect(parseCliArgs(['--text', 'vijnana-bhairava']).textSlug).toBe('vijnana-bhairava');
  });

  it('rejects --text without a slug value', () => {
    expect(() => parseCliArgs(['--text'])).toThrow('--text requires a <slug>');
    expect(() => parseCliArgs(['--text', '--replace'])).toThrow('--text requires a <slug>');
  });

  it('rejects unknown arguments', () => {
    expect(() => parseCliArgs(['--frobnicate'])).toThrow('Unknown argument: --frobnicate');
  });

  it('rejects --replace without --text', () => {
    expect(() => parseCliArgs(['--replace', '--backup-confirmed'])).toThrow('requires --text');
  });

  it('rejects --delete-only without --text', () => {
    expect(() => parseCliArgs(['--delete-only', '--backup-confirmed'])).toThrow('requires --text');
  });

  it('rejects --replace combined with --delete-only', () => {
    expect(() =>
      parseCliArgs(['--text', 'x', '--replace', '--delete-only', '--backup-confirmed']),
    ).toThrow('mutually exclusive');
  });

  it('refuses destructive ops without --backup-confirmed, naming the backup workflow', () => {
    for (const flag of ['--replace', '--delete-only']) {
      expect(() => parseCliArgs(['--text', 'x', flag])).toThrow(BACKUP_WORKFLOW);
      expect(() => parseCliArgs(['--text', 'x', flag])).toThrow(flag);
    }
  });

  it('allows destructive ops with --backup-confirmed', () => {
    const opts = parseCliArgs(['--text', 'x', '--replace', '--backup-confirmed']);
    expect(opts).toEqual({
      textSlug: 'x',
      replace: true,
      deleteOnly: false,
      backupConfirmed: true,
    });
    expect(parseCliArgs(['--text', 'x', '--delete-only', '--backup-confirmed']).deleteOnly).toBe(
      true,
    );
  });
});

describe('SQL planning', () => {
  const verses = TABLE_SPECS.find((s) => s.table === 'verses');
  const parallels = TABLE_SPECS.find((s) => s.table === 'parallels');
  if (!verses || !parallels) throw new Error('missing table specs');

  it('seedSelectSql scopes by text when requested', () => {
    expect(seedSelectSql(verses, false)).not.toContain('WHERE');
    expect(seedSelectSql(verses, true)).toContain('WHERE text_id = ?');
  });

  it('countSql scopes by text when requested', () => {
    expect(countSql(verses, false)).toBe('SELECT count(*) AS n FROM verses');
    expect(countSql(verses, true)).toContain('WHERE text_id = ?');
  });

  it('scopedArgs repeats text_id per placeholder (parallels has two)', () => {
    expect(scopedArgs(verses, 't1')).toEqual(['t1']);
    expect(scopedArgs(parallels, 't1')).toEqual(['t1', 't1']);
  });

  it('buildDeleteStatements deletes children before parents', () => {
    const stmts = buildDeleteStatements('t1');
    const tables = stmts.map((s) => /DELETE FROM (\w+)/.exec(s.sql)?.[1]);
    expect(tables).toEqual(['parallels', 'word_glosses', 'translations', 'verses', 'texts']);
    expect(stmts[0]?.args).toEqual(['t1', 't1']);
    expect(stmts[4]?.sql).toBe('DELETE FROM texts WHERE id = ?');
    expect(stmts[4]?.args).toEqual(['t1']);
  });

  it('buildInserts emits INSERT OR IGNORE with args in column order', () => {
    const stmts = buildInserts('texts', ['id', 'slug'], [{ slug: 'vb', id: 't1', extra: 9 }]);
    expect(stmts).toEqual([
      { sql: 'INSERT OR IGNORE INTO texts (id, slug) VALUES (?, ?)', args: ['t1', 'vb'] },
    ]);
  });

  it('buildInserts coerces missing columns to null', () => {
    const [stmt] = buildInserts('texts', ['id', 'author'], [{ id: 't1' }]);
    expect(stmt?.args).toEqual(['t1', null]);
  });

  it('chunk splits into at-most-size pieces', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 2)).toEqual([]);
  });
});

describe('checksum primitives', () => {
  it('canonicalValue normalizes driver value types', () => {
    expect(canonicalValue(null)).toBeNull();
    expect(canonicalValue(undefined)).toBeNull();
    expect(canonicalValue(7n)).toBe(7);
    expect(canonicalValue(2n ** 60n)).toBe((2n ** 60n).toString());
    expect(canonicalValue(new Uint8Array([0xde, 0xad]))).toBe('blob:dead');
    expect(canonicalValue('x')).toBe('x');
  });

  it('canonicalRow is column-order significant and id-free by construction', () => {
    const row = { a: 1, b: 'x', id: 999 };
    expect(canonicalRow(row, ['a', 'b'])).toBe('[1,"x"]');
    expect(canonicalRow(row, ['b', 'a'])).toBe('["x",1]');
  });

  it('checksumRows is row-order independent', () => {
    const r1 = { k: 'a', v: 1 };
    const r2 = { k: 'b', v: 2 };
    expect(checksumRows([r1, r2], ['k', 'v'])).toBe(checksumRows([r2, r1], ['k', 'v']));
  });

  it('checksumRows treats BigInt and Number integers as equal (libSQL vs bun:sqlite)', () => {
    expect(checksumRows([{ k: 'a', v: 5n }], ['k', 'v'])).toBe(
      checksumRows([{ k: 'a', v: 5 }], ['k', 'v']),
    );
  });

  it('checksumRows changes when content changes (not just counts)', () => {
    expect(checksumRows([{ k: 'a', v: 'old' }], ['k', 'v'])).not.toBe(
      checksumRows([{ k: 'a', v: 'new' }], ['k', 'v']),
    );
  });
});

describe('diffRowSets / formatRowSetDiff', () => {
  const spec = VERIFY_SPECS.find((s) => s.table === 'texts');
  if (!spec) throw new Error('missing texts verify spec');

  it('classifies missing, stale, and changed rows by natural key', () => {
    const base = { title_sa: 's', title_en: 'e' };
    const local = [
      { slug: 'a', ...base },
      { slug: 'b', ...base },
    ];
    const remote = [
      { slug: 'b', ...base, title_en: 'stale-edit' },
      { slug: 'c', ...base },
    ];
    const diff = diffRowSets(local, remote, spec);
    expect(diff.onlyLocal).toEqual(['["a"]']);
    expect(diff.onlyRemote).toEqual(['["c"]']);
    expect(diff.changed).toEqual(['["b"]']);
  });

  it('formats a capped human-readable report', () => {
    const diff = {
      onlyLocal: Array.from({ length: 12 }, (_, i) => `["k${i}"]`),
      onlyRemote: [],
      changed: ['["x"]'],
    };
    const report = formatRowSetDiff('verses', diff, 10);
    expect(report).toContain('[verses] content mismatch:');
    expect(report).toContain('missing on remote (12):');
    expect(report).toContain('... and 2 more');
    expect(report).toContain('content differs (1):');
    expect(report).not.toContain('stale/extra on remote');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Id-drift simulation against the real schema (still no network: two local
// in-memory DBs stand in for "local" and "remote").
// ─────────────────────────────────────────────────────────────────────────────

interface Fixture {
  slug: string;
  verses: Array<{ chapter: number; verse_num: number; devanagari: string; gloss: string }>;
}

const TEXT_A: Fixture = {
  slug: 'vijnana-bhairava',
  verses: [
    { chapter: 1, verse_num: 1, devanagari: 'श्लोक-अ-१', gloss: 'gloss-a-1' },
    { chapter: 1, verse_num: 2, devanagari: 'श्लोक-अ-२', gloss: 'gloss-a-2' },
  ],
};
const TEXT_B: Fixture = {
  slug: 'shiva-sutras',
  verses: [{ chapter: 1, verse_num: 1, devanagari: 'श्लोक-ब-१', gloss: 'gloss-b-1' }],
};

/** Seed one text; AUTOINCREMENT ids depend on insertion order across texts. */
function seedFixture(db: Database, fx: Fixture): void {
  db.query(
    `INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
     VALUES (?, ?, ?, ?, 'trika', 'CC0')`,
  ).run(fx.slug, fx.slug, `sa-${fx.slug}`, `en-${fx.slug}`);
  for (const v of fx.verses) {
    db.query(
      'INSERT INTO verses (text_id, chapter, verse_num, devanagari) VALUES (?, ?, ?, ?)',
    ).run(fx.slug, v.chapter, v.verse_num, v.devanagari);
    const verseId = db.query<{ id: number }, []>('SELECT last_insert_rowid() AS id').get()?.id;
    db.query(
      `INSERT INTO translations (verse_id, lang, translator, translation_text, license, status)
       VALUES (?, 'en', 'tester', ?, 'CC0', 'published')`,
    ).run(verseId ?? 0, `translation of ${v.devanagari}`);
    db.query(
      `INSERT INTO word_glosses (verse_id, word_idx, word_sa, gloss_lang, gloss_text)
       VALUES (?, 0, ?, 'en', ?)`,
    ).run(verseId ?? 0, v.devanagari, v.gloss);
  }
  // One intra-text parallel between the first two verses, if present.
  if (fx.verses.length >= 2) {
    const ids = db
      .query<{ id: number }, [string]>('SELECT id FROM verses WHERE text_id = ? ORDER BY id')
      .all(fx.slug);
    db.query(
      `INSERT INTO parallels (source_verse_id, target_verse_id, citation_type, confidence)
       VALUES (?, ?, 'echo', 0.9)`,
    ).run(ids[0]?.id ?? 0, ids[1]?.id ?? 0);
  }
}

function openDb(fixturesInOrder: Fixture[]): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  for (const fx of fixturesInOrder) seedFixture(db, fx);
  return db;
}

function rows(db: Database, sql: string, args: string[] = []): Array<Record<string, unknown>> {
  return db.query<Record<string, unknown>, string[]>(sql).all(...args);
}

describe('verification checksums against the real schema', () => {
  // "local" inserts A then B; "remote" inserts B then A → verse ids differ.
  const localDb = openDb([TEXT_A, TEXT_B]);
  const remoteDb = openDb([TEXT_B, TEXT_A]);

  it('fixture DBs really do assign different AUTOINCREMENT ids', () => {
    const lId = rows(localDb, 'SELECT id FROM verses WHERE text_id = ?', [TEXT_A.slug])[0]?.id;
    const rId = rows(remoteDb, 'SELECT id FROM verses WHERE text_id = ?', [TEXT_A.slug])[0]?.id;
    expect(lId).not.toBe(rId);
  });

  it('checksums match across id drift for every table (full scope)', () => {
    for (const spec of VERIFY_SPECS) {
      const lSum = checksumRows(rows(localDb, verifySql(spec, false)), spec.cols);
      const rSum = checksumRows(rows(remoteDb, verifySql(spec, false)), spec.cols);
      expect(lSum, spec.table).toBe(rSum);
    }
  });

  it('checksums match across id drift for a --text scope', () => {
    for (const spec of VERIFY_SPECS) {
      const args = Array(spec.scopedArgCount).fill(TEXT_A.slug);
      const lSum = checksumRows(rows(localDb, verifySql(spec, true), args), spec.cols);
      const rSum = checksumRows(rows(remoteDb, verifySql(spec, true), args), spec.cols);
      expect(lSum, spec.table).toBe(rSum);
    }
  });

  it('catches stale remote content that row counts would miss', () => {
    const staleDb = openDb([TEXT_B, TEXT_A]);
    staleDb
      .query("UPDATE translations SET translation_text = 'STALE pre-rebuild text' WHERE id = 1")
      .run();
    const spec = VERIFY_SPECS.find((s) => s.table === 'translations');
    if (!spec) throw new Error('missing translations verify spec');

    const lRows = rows(localDb, verifySql(spec, false));
    const sRows = rows(staleDb, verifySql(spec, false));
    expect(lRows.length).toBe(sRows.length); // counts agree...
    expect(checksumRows(lRows, spec.cols)).not.toBe(checksumRows(sRows, spec.cols)); // ...content does not

    const diff = diffRowSets(lRows, sRows, spec);
    expect(diff.onlyLocal).toHaveLength(0);
    expect(diff.onlyRemote).toHaveLength(0);
    expect(diff.changed).toHaveLength(1);
  });

  it('seedSelectSql --text scope selects exactly the text rows in seed order', () => {
    for (const spec of TABLE_SPECS) {
      const scoped = rows(localDb, seedSelectSql(spec, true), scopedArgs(spec, TEXT_A.slug));
      const all = rows(localDb, seedSelectSql(spec, false));
      expect(scoped.length, spec.table).toBeGreaterThan(0);
      expect(all.length, spec.table).toBeGreaterThan(scoped.length - 1);
    }
    // verses: text A has exactly its own 2 verses in scope, of 3 total.
    const verses = TABLE_SPECS.find((s) => s.table === 'verses');
    if (!verses) throw new Error('missing verses spec');
    expect(rows(localDb, seedSelectSql(verses, true), [TEXT_A.slug])).toHaveLength(2);
    expect(rows(localDb, seedSelectSql(verses, false))).toHaveLength(3);
  });
});
