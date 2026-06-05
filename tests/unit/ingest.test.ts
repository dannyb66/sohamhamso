// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Unit tests for `pipeline/ingest/ingest.ts`.
 *
 * Strategy:
 *   - Each test creates a fresh temp dir + temp SQLite file.
 *   - Schema is applied from `db/schema.sql`.
 *   - `run({ dbPath, corpusDir })` exercises the full top-level entry,
 *     `ingestText()` / `parseTextYaml()` exercise the unit-level paths.
 *
 * Run with: `bun --bun vitest run tests/unit/ingest.test.ts`
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ingestText,
  listYamlFiles,
  openDb,
  parseTextYaml,
  prepareStatements,
  run,
} from '../../pipeline/ingest/ingest';

const SCHEMA_PATH = resolve(__dirname, '..', '..', 'db', 'schema.sql');
const FIXTURE_PATH = resolve(__dirname, '..', 'fixtures', 'sample-corpus.yaml');

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
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-ingest-'));
  dbPath = join(tmp, 'test.db');
  corpusDir = join(tmp, 'corpus');
  // mkdir + copy fixture into the temp corpus dir.
  mkdirSync(corpusDir, { recursive: true });
  copyFileSync(FIXTURE_PATH, join(corpusDir, 'siva-sutras.yaml'));
  initSchema(dbPath);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('run() — full pipeline', () => {
  it('parses a valid corpus YAML and writes texts + verses + glosses + translations', () => {
    const summary = run({ dbPath, corpusDir });

    expect(summary.total_texts).toBe(1);
    expect(summary.total_verses).toBe(2);
    expect(summary.total_glosses).toBe(4); // 2 per verse
    expect(summary.total_translations).toBe(3); // 2 on v1, 1 on v2

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(rowCount(db, 'texts')).toBe(1);
      expect(rowCount(db, 'verses')).toBe(2);
      expect(rowCount(db, 'word_glosses')).toBe(4);
      expect(rowCount(db, 'translations')).toBe(3);

      const text = db
        .query<{ slug: string; title_en: string }, []>(
          "SELECT slug, title_en FROM texts WHERE id='siva-sutras'",
        )
        .get();
      expect(text).toMatchObject({ slug: 'siva-sutras', title_en: 'Śiva Sūtras' });

      // ai_assisted persists as INTEGER 0/1.
      const ai = db
        .query<{ ai_assisted: number; translator: string }, []>(
          'SELECT ai_assisted, translator FROM translations ORDER BY translator',
        )
        .all();
      const aiRow = ai.find((r) => r.translator === 'ai-test');
      expect(aiRow?.ai_assisted).toBe(1);
    } finally {
      db.close();
    }
  });

  it('is idempotent — running twice does not duplicate rows', () => {
    run({ dbPath, corpusDir });
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      expect(rowCount(db, 'texts')).toBe(1);
      expect(rowCount(db, 'verses')).toBe(2);
      expect(rowCount(db, 'word_glosses')).toBe(4);
      expect(rowCount(db, 'translations')).toBe(3);
    } finally {
      db.close();
    }
  });

  it('handles uncommon meter strings without truncating Unicode (triṣṭubh, sūtra, anuṣṭubh)', () => {
    // Write a fixture exercising each meter once.
    const yaml = `
id: meter-test
slug: meter-test
title_sa: छन्दः
title_en: Meter Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "त्रिष्टुप्"
        meter: triṣṭubh
      - verse_num: 2
        devanagari: "अनुष्टुप्"
        meter: anuṣṭubh
      - verse_num: 3
        devanagari: "सूत्र"
        meter: sūtra
`;
    // Replace the fixture in corpusDir with this one.
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    writeFileSync(join(corpusDir, 'meter-test.yaml'), yaml, 'utf8');

    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      const meters = db
        .query<{ meter: string | null }, []>('SELECT meter FROM verses ORDER BY verse_num')
        .all()
        .map((r) => r.meter);
      expect(meters).toEqual(['triṣṭubh', 'anuṣṭubh', 'sūtra']);
    } finally {
      db.close();
    }
  });

  it('accepts wrapped corpus files with seo + faq_file and validates the sibling FAQ file', () => {
    const corpusYaml = `
schema_version: 1
faq_file: ./wrapped-text.faq.yaml
seo:
  schema_version: 1
  descriptions:
    en: "Wrapped override description."
  keywords:
    en: [wrapped text, trika]
  noindex_langs: [hi]
text:
  id: wrapped-text
  slug: wrapped-text
  title_sa: आवृतपाठः
  title_en: Wrapped Text
  tradition: trika
  license: PD
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: "आवृतम्"
        translations:
          - lang: en
            text: "Wrapped translation."
            license: PD
            status: published
`;
    const faqYaml = `
schema_version: 1
faqs:
  - question: "What is this wrapped text?"
    answer: "A test-only FAQ."
`;
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    writeFileSync(join(corpusDir, 'wrapped-text.yaml'), corpusYaml, 'utf8');
    writeFileSync(join(corpusDir, 'wrapped-text.faq.yaml'), faqYaml, 'utf8');

    const parsed = parseTextYaml(join(corpusDir, 'wrapped-text.yaml'));
    expect(parsed.slug).toBe('wrapped-text');
    expect(parsed.chapters[0]?.verses[0]?.verse_num).toBe(1);

    const summary = run({ dbPath, corpusDir });
    expect(summary.total_texts).toBe(1);
    expect(summary.total_verses).toBe(1);
  });
});

describe('run() — failure modes', () => {
  it('throws when corpus YAML is missing required fields', () => {
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    writeFileSync(
      join(corpusDir, 'bad.yaml'),
      // Missing id, slug, title_sa, title_en, tradition, license.
      'chapters:\n  - chapter: 1\n    verses: []\n',
      'utf8',
    );
    expect(() => run({ dbPath, corpusDir })).toThrow(/Invalid input|Required/);
  });

  it('throws when DB file does not exist', () => {
    expect(() => run({ dbPath: join(tmp, 'no.db'), corpusDir })).toThrow(/DB not found/);
  });

  it('throws when faq_file points at a missing sibling YAML file', () => {
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    writeFileSync(
      join(corpusDir, 'bad-faq.yaml'),
      `
schema_version: 1
faq_file: ./missing.faq.yaml
text:
  id: bad-faq
  slug: bad-faq
  title_sa: दोषः
  title_en: Bad FAQ
  tradition: trika
  license: PD
chapters:
  - chapter: 1
    verses:
      - verse: 1
        devanagari: "दोषः"
`,
      'utf8',
    );

    expect(() => parseTextYaml(join(corpusDir, 'bad-faq.yaml'))).toThrow(/faq_file not found/);
  });

  it('no-ops with an empty summary when corpus dir is empty', () => {
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    const summary = run({ dbPath, corpusDir });
    expect(summary).toEqual({
      files: [],
      total_verses: 0,
      total_texts: 0,
      total_glosses: 0,
      total_translations: 0,
    });
  });

  it('skips faq files and underscore templates when listing corpus YAML files', () => {
    writeFileSync(join(corpusDir, '_template.yaml'), 'schema_version: 1\n', 'utf8');
    writeFileSync(
      join(corpusDir, 'sample.faq.yaml'),
      'schema_version: 1\nfaqs:\n  - question: "Q"\n    answer: "A"\n',
      'utf8',
    );

    expect(listYamlFiles(corpusDir).map((file) => file.split('/').at(-1))).toEqual([
      'siva-sutras.yaml',
    ]);
  });
});

describe('UNIQUE (text_id, chapter, verse_num) — upsert semantics', () => {
  it('treats a duplicate (text_id, chapter, verse_num) as an UPDATE, not an INSERT', () => {
    // First run loads the fixture (v1.devanagari = 'चैतन्यमात्मा ॥१॥').
    run({ dbPath, corpusDir });

    // Mutate the on-disk YAML so v1.devanagari changes, then re-run.
    const mutated = readFileSync(FIXTURE_PATH, 'utf8').replace(
      'चैतन्यमात्मा ॥१॥',
      'MUTATED-DEVANAGARI',
    );
    writeFileSync(join(corpusDir, 'siva-sutras.yaml'), mutated, 'utf8');
    run({ dbPath, corpusDir });

    const db = new Database(dbPath, { readonly: true });
    try {
      // Still exactly 2 verses — no duplicate row was inserted.
      expect(rowCount(db, 'verses')).toBe(2);
      const v1 = db
        .query<{ devanagari: string }, []>(
          "SELECT devanagari FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
        )
        .get();
      expect(v1?.devanagari).toBe('MUTATED-DEVANAGARI');
    } finally {
      db.close();
    }
  });
});

describe('per-file transaction semantics', () => {
  it('rejects malformed files before any ingest work starts', () => {
    // YAML with TWO chapters: chapter 1 verse 1 is valid; chapter 2 verse 1
    // is missing 'devanagari'. Schema validation now rejects this before
    // `ingestText()` opens its per-file transaction.
    const yaml = `
id: tx-test
slug: tx-test
title_sa: लेन्दे
title_en: Transaction Test
tradition: trika
license: PD
chapters:
  - chapter: 1
    verses:
      - verse_num: 1
        devanagari: "FIRST"
  - chapter: 2
    verses:
      - verse_num: 1
        # devanagari intentionally omitted — should explode.
        iast: "should-not-land"
`;
    rmSync(join(corpusDir, 'siva-sutras.yaml'));
    writeFileSync(join(corpusDir, 'tx-test.yaml'), yaml, 'utf8');

    expect(() => run({ dbPath, corpusDir })).toThrow(/Invalid input|devanagari|Required/);
  });
});

describe('parseTextYaml() + ingestText() — lower-level unit', () => {
  it('parses a valid YAML and ingests it into a pre-opened DB', () => {
    const doc = parseTextYaml(join(corpusDir, 'siva-sutras.yaml'));
    expect(doc.id).toBe('siva-sutras');
    expect(doc.chapters).toHaveLength(1);
    expect(doc.chapters[0]!.verses).toHaveLength(2);

    const db = openDb(dbPath);
    try {
      const stmts = prepareStatements(db);
      const stats = ingestText(db, stmts, doc, 'test.yaml');
      expect(stats.verses).toBe(2);
      expect(stats.glosses).toBe(4);
      expect(stats.translations).toBe(3);
    } finally {
      db.close();
    }
  });
});
