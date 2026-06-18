// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Unit tests for the reconciling-ingest behaviour of
 * `pipeline/ingest/ingest.ts` (task E4):
 *
 *   - reconciliation: rows absent from the incoming YAML are deleted
 *   - logical idempotency: re-ingesting unchanged content is a no-op
 *     (updated_at untouched on texts and translations)
 *   - expected_verse_count: declared-vs-actual mismatch aborts the file
 *   - topo order: a commentary sorting before its parent still ingests
 *   - translator identity: missing translator gets a canonical label
 *   - WAL hygiene: finalize leaves a single self-contained DB file
 *
 * Run with: `bun --bun vitest run tests/unit/ingest-reconcile.test.ts`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSLATOR,
  type TextYaml,
  parseTextYaml,
  run,
  topoSortTexts,
} from '../../pipeline/ingest/ingest';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');

const BASE_YAML = `
id: reconcile-test
slug: reconcile-test
title_sa: परीक्षा
title_en: Reconcile Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "प्रथमः"
        word_glosses:
          - word_idx: 0
            word_sa: "प्रथमः"
            gloss_lang: en
            gloss_text: "first"
          - word_idx: 1
            word_sa: "पदम्"
            gloss_lang: en
            gloss_text: "word"
        translations:
          - lang: en
            translator: "Tester"
            translation_text: "The first."
            license: PD
            status: published
          - lang: hi
            translator: "Tester"
            translation_text: "पहला।"
            license: PD
            status: published
      - verse_num: 2
        devanagari: "द्वितीयः"
        translations:
          - lang: en
            translator: "Tester"
            translation_text: "The second."
            license: PD
            status: published
`;

// Same text with verse 2 removed, plus gloss word_idx=1 and the hi
// translation dropped from verse 1.
const SHRUNK_YAML = `
id: reconcile-test
slug: reconcile-test
title_sa: परीक्षा
title_en: Reconcile Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "प्रथमः"
        word_glosses:
          - word_idx: 0
            word_sa: "प्रथमः"
            gloss_lang: en
            gloss_text: "first"
        translations:
          - lang: en
            translator: "Tester"
            translation_text: "The first."
            license: PD
            status: published
`;

let tmp: string;
let dbPath: string;
let corpusDir: string;

function initSchema(path: string): void {
  const db = new Database(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  db.close();
}

function rowCount(db: Database, table: string): number {
  const r = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return r?.n ?? 0;
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-reconcile-'));
  dbPath = join(tmp, 'test.db');
  corpusDir = join(tmp, 'corpus');
  mkdirSync(corpusDir, { recursive: true });
  initSchema(dbPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('reconciliation — rows absent from YAML are deleted', () => {
  it('deletes removed verses (and their children) plus dropped glosses/translations', () => {
    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), BASE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    let db = new Database(dbPath, { readonly: true });
    expect(rowCount(db, 'verses')).toBe(2);
    expect(rowCount(db, 'word_glosses')).toBe(2);
    expect(rowCount(db, 'translations')).toBe(3);
    db.close();

    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), SHRUNK_YAML, 'utf8');
    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      // Verse 2 is gone, and so are its translations.
      expect(rowCount(db, 'verses')).toBe(1);
      const v2 = db
        .query<{ id: number }, []>(
          "SELECT id FROM verses WHERE text_id='reconcile-test' AND verse_num=2",
        )
        .get();
      expect(v2).toBeNull();
      // Dropped gloss (word_idx=1) and hi translation are gone too.
      expect(rowCount(db, 'word_glosses')).toBe(1);
      expect(rowCount(db, 'translations')).toBe(1);
    } finally {
      db.close();
    }
  });

  it('handles renumbered verses without leaving the old number public', () => {
    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), BASE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    // Renumber verse 2 -> verse 3.
    writeFileSync(
      join(corpusDir, 'reconcile-test.yaml'),
      BASE_YAML.replace('verse_num: 2', 'verse_num: 3'),
      'utf8',
    );
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const nums = db
        .query<{ verse_num: number }, []>(
          "SELECT verse_num FROM verses WHERE text_id='reconcile-test' ORDER BY verse_num",
        )
        .all()
        .map((r) => r.verse_num);
      expect(nums).toEqual([1, 3]);
    } finally {
      db.close();
    }
  });
});

describe('logical idempotency — unchanged content is a no-op', () => {
  it('does not touch updated_at on texts/translations when content is unchanged', () => {
    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), BASE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    // Plant sentinels so a rewrite is observable regardless of clock granularity.
    const SENTINEL = '2000-01-01 00:00:00';
    let db = new Database(dbPath);
    db.exec(`UPDATE texts SET updated_at = '${SENTINEL}'`);
    db.exec(`UPDATE translations SET updated_at = '${SENTINEL}'`);
    db.close();

    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      const text = db
        .query<{ updated_at: string }, []>("SELECT updated_at FROM texts WHERE id='reconcile-test'")
        .get();
      expect(text?.updated_at).toBe(SENTINEL);
      const stamps = db
        .query<{ updated_at: string }, []>('SELECT updated_at FROM translations')
        .all()
        .map((r) => r.updated_at);
      expect(stamps).toEqual([SENTINEL, SENTINEL, SENTINEL]);
    } finally {
      db.close();
    }
  });

  it('does touch updated_at when translation content actually changes', () => {
    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), BASE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    const SENTINEL = '2000-01-01 00:00:00';
    let db = new Database(dbPath);
    db.exec(`UPDATE translations SET updated_at = '${SENTINEL}'`);
    db.close();

    writeFileSync(
      join(corpusDir, 'reconcile-test.yaml'),
      BASE_YAML.replace('The second.', 'The second, revised.'),
      'utf8',
    );
    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      const changed = db
        .query<{ updated_at: string }, []>(
          "SELECT updated_at FROM translations WHERE translation_text='The second, revised.'",
        )
        .get();
      expect(changed?.updated_at).not.toBe(SENTINEL);
      // The untouched sibling translations keep the sentinel.
      const untouched = db
        .query<{ updated_at: string }, []>(
          "SELECT updated_at FROM translations WHERE translation_text='The first.'",
        )
        .get();
      expect(untouched?.updated_at).toBe(SENTINEL);
    } finally {
      db.close();
    }
  });
});

describe('expected_verse_count validator', () => {
  it('ingests cleanly when the declared count matches', () => {
    writeFileSync(
      join(corpusDir, 'reconcile-test.yaml'),
      BASE_YAML.replace('license: PD', 'license: PD\nexpected_verse_count: 2'),
      'utf8',
    );
    const summary = run({ dbPath, corpusDir });
    expect(summary.total_verses).toBe(2);
  });

  it('aborts with an expected-vs-actual error (and rolls back) on mismatch', () => {
    writeFileSync(
      join(corpusDir, 'reconcile-test.yaml'),
      BASE_YAML.replace('license: PD', 'license: PD\nexpected_verse_count: 5'),
      'utf8',
    );
    expect(() => run({ dbPath, corpusDir })).toThrow(
      /expected_verse_count=5 but ingested 2 verses/,
    );

    // The per-text transaction rolled back: nothing landed.
    const db = new Database(dbPath, { readonly: true });
    try {
      expect(rowCount(db, 'texts')).toBe(0);
      expect(rowCount(db, 'verses')).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('topo order — parents ingest before children', () => {
  const PARENT_YAML = `
id: z-parent
slug: z-parent
title_sa: मूलम्
title_en: Z Parent
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "मूलम्"
`;
  // Filename 'a-commentary.yaml' sorts before 'z-parent.yaml' — without the
  // topo sort the parent_text_id FK would fail on a fresh DB.
  const COMMENTARY_YAML = `
id: a-commentary
slug: a-commentary
title_sa: टीका
title_en: A Commentary
tradition: trika
license: PD
parent_text_id: z-parent
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "टीका"
`;

  it('ingests a commentary whose filename sorts before its parent', () => {
    writeFileSync(join(corpusDir, 'a-commentary.yaml'), COMMENTARY_YAML, 'utf8');
    writeFileSync(join(corpusDir, 'z-parent.yaml'), PARENT_YAML, 'utf8');

    const summary = run({ dbPath, corpusDir });
    expect(summary.total_texts).toBe(2);

    const db = new Database(dbPath, { readonly: true });
    try {
      const child = db
        .query<{ parent_text_id: string | null }, []>(
          "SELECT parent_text_id FROM texts WHERE id='a-commentary'",
        )
        .get();
      expect(child?.parent_text_id).toBe('z-parent');
    } finally {
      db.close();
    }
  });

  it('topoSortTexts() emits parents first and preserves file order otherwise', () => {
    writeFileSync(join(corpusDir, 'a-commentary.yaml'), COMMENTARY_YAML, 'utf8');
    writeFileSync(join(corpusDir, 'z-parent.yaml'), PARENT_YAML, 'utf8');
    const entries = [
      { file: 'a-commentary.yaml', doc: parseTextYaml(join(corpusDir, 'a-commentary.yaml')) },
      { file: 'z-parent.yaml', doc: parseTextYaml(join(corpusDir, 'z-parent.yaml')) },
    ];
    expect(topoSortTexts(entries).map((e) => e.doc.id)).toEqual(['z-parent', 'a-commentary']);
  });

  it('topoSortTexts() throws on a parent_text_id cycle', () => {
    const mk = (id: string, parent: string): { doc: TextYaml } => ({
      doc: { id, parent_text_id: parent } as TextYaml,
    });
    expect(() => topoSortTexts([mk('a', 'b'), mk('b', 'a')])).toThrow(/cycle/);
  });
});

describe('translator identity — canonical non-null label', () => {
  const NO_TRANSLATOR_YAML = `
id: anon-test
slug: anon-test
title_sa: अनामकः
title_en: Anon Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "अनामकः"
        translations:
          - lang: en
            translation_text: "No translator given."
            license: PD
            status: published
`;

  it('stores missing translators under the canonical label and stays idempotent', () => {
    writeFileSync(join(corpusDir, 'anon-test.yaml'), NO_TRANSLATOR_YAML, 'utf8');
    run({ dbPath, corpusDir });
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .query<{ translator: string | null }, []>('SELECT translator FROM translations')
        .all();
      // NULL translators would be pairwise distinct under the UNIQUE key and
      // duplicate on every re-run; the canonical label prevents that.
      expect(rows).toEqual([{ translator: DEFAULT_TRANSLATOR }]);
    } finally {
      db.close();
    }
  });

  it('reconciles away legacy NULL-translator duplicates', () => {
    writeFileSync(join(corpusDir, 'anon-test.yaml'), NO_TRANSLATOR_YAML, 'utf8');
    run({ dbPath, corpusDir });

    // Simulate a pre-fix DB state: a NULL-translator duplicate of the row.
    let db = new Database(dbPath);
    db.exec(`
      INSERT INTO translations (verse_id, lang, translator, translation_text, license, status)
      SELECT verse_id, lang, NULL, translation_text, license, status FROM translations
    `);
    expect(rowCount(db, 'translations')).toBe(2);
    db.close();

    run({ dbPath, corpusDir });

    db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .query<{ translator: string | null }, []>('SELECT translator FROM translations')
        .all();
      expect(rows).toEqual([{ translator: DEFAULT_TRANSLATOR }]);
    } finally {
      db.close();
    }
  });
});

describe('WAL hygiene at finalize', () => {
  it('leaves a single self-contained DB file (no -wal sidecar, journal_mode=delete)', () => {
    writeFileSync(join(corpusDir, 'reconcile-test.yaml'), BASE_YAML, 'utf8');
    run({ dbPath, corpusDir });

    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}-shm`)).toBe(false);

    const db = new Database(dbPath, { readonly: true });
    try {
      const mode = db.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get();
      expect(mode?.journal_mode).toBe('delete');
    } finally {
      db.close();
    }
  });
});
