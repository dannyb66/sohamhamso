// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Unit tests for `pipeline/dataset/publish.ts` — dataset bundle serializers.
 *
 * Strategy:
 *   - `publish.ts` has no exports and runs `main()` at module load. We
 *     treat it as a black-box CLI: spawn it via `bun pipeline/dataset/publish.ts
 *     --version v2026.05.31 --db <fixtureDb> --out <tmpDir>` and assert on
 *     the produced files.
 *   - A fresh fixture DB is built per test from `db/schema.sql` and seeded
 *     with rows that exercise CSV-edge cases (quotes, commas, newlines).
 *
 * Covers:
 *   1. CSV escaping (RFC-4180-ish): quotes/commas/newlines properly wrapped.
 *   2. TEI-XML emits well-formed XML (validated via `xmllint --noout`,
 *      skipped if xmllint is missing).
 *   3. JSON shard round-trips: db → publisher → JSON.parse → verse_count.
 *   4. Manifest (build-dir contents) contains all expected files.
 *   5. checksums.sha256 lines are `<sha256>  <relative-path>` (TWO-space
 *      separator for `shasum -c` compatibility).
 *
 * Run with: `bun --bun vitest run tests/unit/dataset-publish.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'db', 'schema.sql');
const PUBLISH_SCRIPT = resolve(REPO_ROOT, 'pipeline', 'dataset', 'publish.ts');
const VERSION = 'v2026.05.31';

// CSV edge-case values we'll smuggle into a translation row so the CSV
// writer must escape them. Each field exercises one of the three RFC-4180
// special chars: a comma, a quote, an LF.
const TRICKY_TRANSLATION = `Smith, "the great", said:\nhello`;
const TRICKY_ATTRIBUTION = `Acharya "Anonymous", 2026`;

let tmp: string;
let dbPath: string;
let outDir: string;
let buildDir: string;
let runResult: ReturnType<typeof spawnSync>;

function seed(db: Database): void {
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, title_iast, author, tradition, school, license)
    VALUES
      ('siva-sutras', 'siva-sutras', 'शिवसूत्राणि', 'Śiva Sūtras', 'Śivasūtrāṇi',
       ${escSqlStr(TRICKY_ATTRIBUTION)}, 'trika', 'kashmir-shaivism', 'CC-BY-4.0'),
      ('spanda-karikas', 'spanda-karikas', 'स्पन्दकारिका', 'Spanda Kārikās', 'Spandakārikā',
       NULL, 'trika', 'kashmir-shaivism', 'CC-BY-4.0');
  `);
  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast, meter)
    VALUES
      ('siva-sutras',    1, 1, 'चैतन्यमात्मा ॥१॥', 'caitanyam ātmā', 'sūtra'),
      ('siva-sutras',    1, 2, 'ज्ञानं बन्धः ॥२॥', 'jñānaṃ bandhaḥ', 'sūtra'),
      ('spanda-karikas', 1, 1, 'यस्योन्मेषनिमेषाभ्याम् ।', 'yasyonmeṣanimeṣābhyām', 'anuṣṭubh');
  `);
  type IdRow = { id: number };
  const sivaV1 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=1",
    )
    .get() as IdRow;
  const sivaV2 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='siva-sutras' AND chapter=1 AND verse_num=2",
    )
    .get() as IdRow;
  const spandaV1 = db
    .query<IdRow, []>(
      "SELECT id FROM verses WHERE text_id='spanda-karikas' AND chapter=1 AND verse_num=1",
    )
    .get() as IdRow;

  // Translation row with quotes/commas/newlines → tests CSV escaping.
  // Use status='published' so it ships in the public bundle (drafts are
  // filtered out by rowsFor() per STATUS-CONTRACT.md).
  db.exec(`
    INSERT INTO translations
      (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${sivaV1.id}, 'en', 'PD', ${escSqlStr(TRICKY_TRANSLATION)}, 'PD', 'published', 0),
      (${sivaV2.id}, 'en', 'PD', 'Limited knowledge is bondage.', 'PD', 'published', 0),
      (${spandaV1.id}, 'en', 'PD', 'By whose opening and closing of the eyes…', 'PD', 'published', 0)
  `);
  db.exec(`
    INSERT INTO word_glosses
      (verse_id, word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph)
    VALUES
      (${sivaV1.id}, 0, 'caitanyam', 'caitanya', 'caitanya', 'en', 'pure consciousness', 'nom. sg. n.'),
      (${sivaV1.id}, 1, 'ātmā',      'ātman',    'ātman',    'en', 'the Self',           'nom. sg. m.')
  `);
}

// Helper: SQL-quote a string with single-quote escaping. Sufficient for
// fixture seeding; we never run this on user input.
function escSqlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-publish-'));
  dbPath = join(tmp, 'fixture.db');
  outDir = join(tmp, 'out');
  mkdirSync(outDir, { recursive: true });

  const db = new Database(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  seed(db);
  db.close();

  runResult = spawnSync(
    'bun',
    [PUBLISH_SCRIPT, '--version', VERSION, '--db', dbPath, '--out', outDir],
    {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 60_000,
    },
  );

  buildDir = join(outDir, `sohamhamso-dataset-${VERSION}`);
}, 90_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Smoke: the script actually ran
// ─────────────────────────────────────────────────────────────────────────
describe('publish.ts — invocation', () => {
  it('exits 0 and writes a build directory', () => {
    expect(runResult.status, `stderr: ${runResult.stderr}\nstdout: ${runResult.stdout}`).toBe(0);
    expect(existsSync(buildDir)).toBe(true);
    expect(statSync(buildDir).isDirectory()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 1. CSV escaping
// ─────────────────────────────────────────────────────────────────────────
describe('CSV escaping (RFC 4180-ish)', () => {
  it('wraps cells containing commas/quotes/newlines in double-quotes and doubles internal quotes', () => {
    const csv = readFileSync(join(buildDir, 'translations.csv'), 'utf8');

    // The exact escaped form per the writer's rules:
    //   raw:    Smith, "the great", said:\nhello
    //   quoted: "Smith, ""the great"", said:\nhello"
    const expectedField = `"Smith, ""the great"", said:\nhello"`;
    expect(
      csv.includes(expectedField),
      'translation_text with commas/quotes/newlines must be RFC4180-quoted',
    ).toBe(true);

    // Negative: an unescaped raw quote sequence ('"the great"') WITHOUT
    // doubling would indicate a broken writer. The exact substring "the great"
    // also occurs INSIDE the properly-escaped field, so we just spot-check
    // that ',' literally outside a quoted field doesn't break the row count.
    //
    // The simple cells (e.g. 'Limited knowledge is bondage.') should NOT be
    // quoted because they contain no special chars.
    expect(csv).toMatch(/(^|,|\n)Limited knowledge is bondage\.(,|\n|$)/);
  });

  it('escapes commas + quotes in the texts.author column too', () => {
    const csv = readFileSync(join(buildDir, 'texts.csv'), 'utf8');
    // raw:    Acharya "Anonymous", 2026
    // quoted: "Acharya ""Anonymous"", 2026"
    expect(csv).toContain(`"Acharya ""Anonymous"", 2026"`);
  });

  it('emits header + one row per verse in verses.csv', () => {
    const csv = readFileSync(join(buildDir, 'verses.csv'), 'utf8');
    const lines = csv.split('\n').filter((l) => l.length > 0);
    // 1 header + 3 verse rows.
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('id');
    expect(lines[0]).toContain('text_id');
    expect(lines[0]).toContain('verse_num');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. TEI-XML well-formedness
// ─────────────────────────────────────────────────────────────────────────
describe('TEI-XML output is well-formed', () => {
  const sivaPath = () => join(buildDir, 'tei', 'siva-sutras.xml');

  it('emits a tei/<slug>.xml file per text', () => {
    expect(existsSync(sivaPath())).toBe(true);
    expect(existsSync(join(buildDir, 'tei', 'spanda-karikas.xml'))).toBe(true);
  });

  it('parses cleanly with xmllint --noout (if installed)', () => {
    const which = spawnSync('which', ['xmllint'], { encoding: 'utf8' });
    if (which.status !== 0) {
      // No xmllint on this host — fall back to a shallow well-formedness
      // sanity check so we still get *some* signal.
      const xml = readFileSync(sivaPath(), 'utf8');
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<TEI');
      expect(xml).toContain('</TEI>');
      return;
    }
    const result = spawnSync('xmllint', ['--noout', sivaPath()], { encoding: 'utf8' });
    expect(result.status, `xmllint stderr: ${result.stderr}`).toBe(0);
  });

  it('escapes special chars (& < > " \') in XML attributes/text', () => {
    // Our fixture's author is `Acharya "Anonymous", 2026` — but TEI emits
    // author only under <author> text node. Plain seeded values don't
    // contain `<` or `&`, so we just confirm the escaping helper was used
    // (no raw double-quotes left unescaped inside element text). The
    // strongest portable assertion: every '&' in the file is followed by
    // a known entity name. (xmllint above is the load-bearing check; this
    // is the redundancy net.)
    const xml = readFileSync(sivaPath(), 'utf8');
    // Find every '&' and check what follows is a valid named/numeric entity.
    const amps = xml.match(/&[^;]{0,12};/g) ?? [];
    for (const e of amps) {
      expect(e).toMatch(/^&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3. JSON shard round-trip
// ─────────────────────────────────────────────────────────────────────────
describe('JSON shard round-trip (db → publisher → JSON.parse)', () => {
  it('produces a valid JSON file per text, with the expected verse count', () => {
    const sivaPath = join(buildDir, 'json', 'siva-sutras.json');
    const spandaPath = join(buildDir, 'json', 'spanda-karikas.json');
    expect(existsSync(sivaPath)).toBe(true);
    expect(existsSync(spandaPath)).toBe(true);

    const siva = JSON.parse(readFileSync(sivaPath, 'utf8')) as {
      text: { slug: string };
      chapters: Array<{ chapter: number; verses: unknown[] }>;
    };
    expect(siva.text.slug).toBe('siva-sutras');
    expect(siva.chapters).toHaveLength(1);
    const allVerses = siva.chapters.flatMap((c) => c.verses);
    // We seeded exactly two verses in siva-sutras chapter 1.
    expect(allVerses).toHaveLength(2);

    const spanda = JSON.parse(readFileSync(spandaPath, 'utf8')) as {
      chapters: Array<{ verses: unknown[] }>;
    };
    expect(spanda.chapters.flatMap((c) => c.verses)).toHaveLength(1);
  });

  it('nests word_glosses + translations under each verse in the shard', () => {
    const siva = JSON.parse(readFileSync(join(buildDir, 'json', 'siva-sutras.json'), 'utf8')) as {
      chapters: Array<{
        verses: Array<{
          verse: number;
          word_glosses: unknown[];
          translations: Array<{ lang: string; text: string; ai_assisted: boolean }>;
        }>;
      }>;
    };
    const v1 = siva.chapters[0]!.verses.find((v) => v.verse === 1)!;
    expect(v1.word_glosses).toHaveLength(2);
    expect(v1.translations.some((t) => t.text.includes('Smith'))).toBe(true);
    // ai_assisted is normalized to a real boolean (not 0/1).
    for (const t of v1.translations) {
      expect(typeof t.ai_assisted).toBe('boolean');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 4. Manifest — expected file paths exist
// ─────────────────────────────────────────────────────────────────────────
describe('manifest (build directory contents)', () => {
  it('contains every expected top-level file', () => {
    const required = [
      'README.md',
      'LICENSE-CC-BY-SA-4.0',
      'ATTRIBUTION.md',
      'CHANGELOG.md',
      'checksums.sha256',
      'texts.csv',
      'verses.csv',
      'translations.csv',
      'word_glosses.csv',
      'parallels.csv',
    ];
    for (const f of required) {
      expect(existsSync(join(buildDir, f)), `missing: ${f}`).toBe(true);
    }
  });

  it('contains json/ and tei/ subdirectories with at least one shard each', () => {
    const jsonDir = join(buildDir, 'json');
    const teiDir = join(buildDir, 'tei');
    expect(existsSync(jsonDir) && statSync(jsonDir).isDirectory()).toBe(true);
    expect(existsSync(teiDir) && statSync(teiDir).isDirectory()).toBe(true);
    expect(readdirSync(jsonDir).filter((f) => f.endsWith('.json')).length).toBeGreaterThan(0);
    expect(readdirSync(teiDir).filter((f) => f.endsWith('.xml')).length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 5. checksums.sha256 format
// ─────────────────────────────────────────────────────────────────────────
describe('checksums.sha256 format (shasum -c compatible)', () => {
  it('every line is `<64-hex-sha256><TWO spaces><relative-path>`', () => {
    const body = readFileSync(join(buildDir, 'checksums.sha256'), 'utf8');
    const lines = body.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(0);
    // shasum -c requires exactly two spaces between hash and filename.
    const lineRe = /^[0-9a-f]{64} {2}\S.*$/;
    for (const line of lines) {
      expect(line, `bad checksum line: ${JSON.stringify(line)}`).toMatch(lineRe);
    }
  });

  it('does not include checksums.sha256 itself (self-reference would be wrong)', () => {
    const body = readFileSync(join(buildDir, 'checksums.sha256'), 'utf8');
    expect(body).not.toContain('  checksums.sha256');
  });

  it('hashes match what shasum -a 256 would compute (spot-check one file)', () => {
    const body = readFileSync(join(buildDir, 'checksums.sha256'), 'utf8');
    const lines = body.split('\n').filter(Boolean);
    // Pick a small, deterministic file: LICENSE-CC-BY-SA-4.0.
    const licLine = lines.find((l) => l.endsWith('  LICENSE-CC-BY-SA-4.0'));
    expect(licLine).toBeDefined();
    const declared = licLine!.slice(0, 64);
    const { createHash } = require('node:crypto');
    const actual = createHash('sha256')
      .update(readFileSync(join(buildDir, 'LICENSE-CC-BY-SA-4.0')))
      .digest('hex');
    expect(declared).toBe(actual);
  });
});
