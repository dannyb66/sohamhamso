// biome-ignore lint/correctness/noUndeclaredDependencies: bun built-in
import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
/**
 * Unit tests for the MIRI permission gate in `pipeline/dataset/publish.ts`.
 *
 * Texts whose corpus YAML carries `text.pending_miri: true` (Muktabodha-
 * derived, awaiting written redistribution permission — see ATTRIBUTION.md)
 * MUST be excluded from every dataset bundle.
 *
 * Strategy:
 *   1. Direct unit tests of the exported gate helpers
 *      (`readPendingMiriSlugs`, `holdWhere`) against fixture corpus dirs.
 *   2. Black-box CLI run: fixture DB with one held + one clean text, fixture
 *      corpus dir passed via `--corpus`, then assert the held text (and all
 *      its child rows) is absent from every bundle surface and that the
 *      hold is loudly logged.
 *   3. Wiring check: the real repo corpus YAMLs actually carry the flag for
 *      the two Phase 1 Muktabodha-derived texts.
 *
 * Run with: `bun --bun vitest run tests/unit/dataset-publish-miri.test.ts`
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { holdWhere, readPendingMiriSlugs } from '../../pipeline/dataset/publish';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SCHEMA_PATH = resolve(REPO_ROOT, 'db', 'schema.sql');
const PUBLISH_SCRIPT = resolve(REPO_ROOT, 'pipeline', 'dataset', 'publish.ts');
const VERSION = 'v2026.06.10';

// Minimal corpus YAML — the gate reads only text.{id,slug,pending_miri}.
function corpusYaml(slug: string, pendingMiri: boolean | null): string {
  const flag = pendingMiri === null ? '' : `  pending_miri: ${pendingMiri}\n`;
  return `schema_version: 1\ntext:\n  id: ${slug}\n  slug: ${slug}\n${flag}chapters: []\n`;
}

let tmp: string;
let corpusDir: string;
let dbPath: string;
let outDir: string;
let buildDir: string;
let runResult: ReturnType<typeof spawnSync>;

function seed(db: Database): void {
  // One held (Muktabodha-derived) + one clean text, each with a verse,
  // translation, gloss — plus a parallel crossing the held boundary.
  db.exec(`
    INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
    VALUES
      ('held-tantra',  'held-tantra',  'गुप्ततन्त्र', 'Held Tantra', 'trika', 'PD'),
      ('clean-sutras', 'clean-sutras', 'शुद्धसूत्र',  'Clean Sūtras', 'trika', 'PD');
  `);
  db.exec(`
    INSERT INTO verses (text_id, chapter, verse_num, devanagari, iast)
    VALUES
      ('held-tantra',  1, 1, 'गुप्तश्लोकः ॥१॥', 'guptaślokaḥ'),
      ('clean-sutras', 1, 1, 'शुद्धसूत्रम् ॥१॥', 'śuddhasūtram');
  `);
  type IdRow = { id: number };
  const heldV = db
    .query<IdRow, []>("SELECT id FROM verses WHERE text_id='held-tantra'")
    .get() as IdRow;
  const cleanV = db
    .query<IdRow, []>("SELECT id FROM verses WHERE text_id='clean-sutras'")
    .get() as IdRow;
  db.exec(`
    INSERT INTO translations (verse_id, lang, translator, translation_text, license, status, ai_assisted)
    VALUES
      (${heldV.id},  'en', 'PD', 'HELD-SENTINEL translation.',  'PD', 'published', 0),
      (${cleanV.id}, 'en', 'PD', 'CLEAN-SENTINEL translation.', 'PD', 'published', 0);
  `);
  db.exec(`
    INSERT INTO word_glosses (verse_id, word_idx, word_sa, gloss_lang, gloss_text)
    VALUES
      (${heldV.id},  0, 'गुप्त', 'en', 'hidden'),
      (${cleanV.id}, 0, 'शुद्ध', 'en', 'pure');
  `);
  // A parallel touching a held verse must be excluded too.
  db.exec(`
    INSERT INTO parallels (source_verse_id, target_verse_id, citation_type, extracted_by)
    VALUES (${cleanV.id}, ${heldV.id}, 'parallel', 'manual');
  `);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'sohamhamso-miri-'));
  corpusDir = join(tmp, 'corpus');
  dbPath = join(tmp, 'fixture.db');
  outDir = join(tmp, 'out');
  mkdirSync(corpusDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  writeFileSync(join(corpusDir, 'held-tantra.yaml'), corpusYaml('held-tantra', true), 'utf8');
  writeFileSync(join(corpusDir, 'clean-sutras.yaml'), corpusYaml('clean-sutras', null), 'utf8');
  // Distractors the directory scan must skip.
  writeFileSync(join(corpusDir, '_template.yaml'), corpusYaml('template-text', true), 'utf8');
  writeFileSync(join(corpusDir, 'held-tantra.faq.yaml'), 'faqs: []\n', 'utf8');

  const db = new Database(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
  seed(db);
  db.close();

  runResult = spawnSync(
    'bun',
    [PUBLISH_SCRIPT, '--version', VERSION, '--db', dbPath, '--out', outDir, '--corpus', corpusDir],
    { encoding: 'utf8', cwd: REPO_ROOT, timeout: 60_000 },
  );

  buildDir = join(outDir, `sohamhamso-dataset-${VERSION}`);
}, 90_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Gate helpers
// ─────────────────────────────────────────────────────────────────────────
describe('readPendingMiriSlugs', () => {
  it('returns slugs of texts flagged pending_miri: true, skipping templates and FAQ sidecars', () => {
    const held = readPendingMiriSlugs(corpusDir);
    expect(held).toEqual(new Set(['held-tantra']));
  });

  it('returns an empty set for a missing directory', () => {
    expect(readPendingMiriSlugs(join(tmp, 'no-such-dir'))).toEqual(new Set());
  });

  it('finds the flags on the real Phase 1 Muktabodha-derived corpus files', () => {
    const held = readPendingMiriSlugs(resolve(REPO_ROOT, 'data', 'corpus'));
    expect(held.has('pratyabhijna-hrdayam')).toBe(true);
    expect(held.has('vijnana-bhairava-tantra')).toBe(true);
  });
});

describe('holdWhere', () => {
  it('is a no-op when nothing is held', () => {
    expect(holdWhere('texts', new Set())).toBe('');
  });

  it('excludes by id/text_id/verse subquery per table', () => {
    const held = new Set(['held-tantra']);
    expect(holdWhere('texts', held)).toBe("id NOT IN ('held-tantra')");
    expect(holdWhere('verses', held)).toBe("text_id NOT IN ('held-tantra')");
    expect(holdWhere('translations', held)).toContain('verse_id NOT IN');
    expect(holdWhere('parallels', held)).toContain('source_verse_id NOT IN');
    expect(holdWhere('parallels', held)).toContain('target_verse_id NOT IN');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Black-box: the held text is absent from every bundle surface
// ─────────────────────────────────────────────────────────────────────────
describe('publish.ts excludes pending_miri texts from the bundle', () => {
  it('exits 0 and loudly logs the hold', () => {
    expect(runResult.status, `stderr: ${runResult.stderr}\nstdout: ${runResult.stdout}`).toBe(0);
    const allOutput = `${runResult.stdout}${runResult.stderr}`;
    expect(allOutput).toContain('MIRI PERMISSION HOLD');
    expect(allOutput).toContain('held-tantra');
  });

  it('omits the held text from texts.csv but keeps clean texts', () => {
    const csv = readFileSync(join(buildDir, 'texts.csv'), 'utf8');
    expect(csv).not.toContain('held-tantra');
    expect(csv).toContain('clean-sutras');
  });

  it('omits the held text rows from verses/translations/word_glosses/parallels CSVs', () => {
    expect(readFileSync(join(buildDir, 'verses.csv'), 'utf8')).not.toContain('held-tantra');
    const translations = readFileSync(join(buildDir, 'translations.csv'), 'utf8');
    expect(translations).not.toContain('HELD-SENTINEL');
    expect(translations).toContain('CLEAN-SENTINEL');
    const glosses = readFileSync(join(buildDir, 'word_glosses.csv'), 'utf8');
    expect(glosses).not.toContain('hidden');
    expect(glosses).toContain('pure');
    // The seeded parallel touches a held verse → no data rows survive.
    const parallels = readFileSync(join(buildDir, 'parallels.csv'), 'utf8');
    expect(parallels.split('\n').filter((l) => l.length > 0)).toHaveLength(1); // header only
  });

  it('emits no JSON or TEI shard for the held text', () => {
    expect(existsSync(join(buildDir, 'json', 'held-tantra.json'))).toBe(false);
    expect(existsSync(join(buildDir, 'tei', 'held-tantra.xml'))).toBe(false);
    expect(existsSync(join(buildDir, 'json', 'clean-sutras.json'))).toBe(true);
    expect(existsSync(join(buildDir, 'tei', 'clean-sutras.xml'))).toBe(true);
  });

  it('keeps the held text out of CHANGELOG stats and reports it in the summary', () => {
    const changelog = readFileSync(join(buildDir, 'CHANGELOG.md'), 'utf8');
    expect(changelog).toContain('Texts: 1');
    expect(changelog).not.toContain('held-tantra');
    expect(String(runResult.stdout)).toContain('"held_texts"');
  });
});
