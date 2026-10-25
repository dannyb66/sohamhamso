import { Database } from 'bun:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

describe('static corpus export', () => {
  it('preserves translation preference, full search text, and collision-stable lemma slugs', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'soham-static-export-'));
    const dbPath = join(temporary, 'corpus.db');
    const output = join(temporary, 'assets');
    try {
      const db = new Database(dbPath);
      db.exec(readFileSync(join(ROOT, 'db/schema.sql'), 'utf8'));
      db.exec(`INSERT INTO texts (id, slug, title_sa, title_en, tradition, license)
        VALUES ('sample', 'sample', 'पाठ', 'Sample', 'trika', 'CC0')`);
      for (let number = 1; number <= 4; number++) {
        db.prepare(`INSERT INTO verses (id, text_id, chapter, verse_num, devanagari)
          VALUES (?, 'sample', 1, ?, 'शिव')`).run(number, number);
        db.prepare(`INSERT INTO word_glosses
          (verse_id, word_idx, word_sa, lemma_iast, gloss_lang, gloss_text)
          VALUES (?, 0, 'शिव', ?, 'en', 'Shiva')`).run(number, number === 1 ? 'siva' : 'śiva');
      }
      const translation = db.prepare(`INSERT INTO translations
        (verse_id, lang, translator, translation_text, license, status, ai_assisted, created_at)
        VALUES (2, 'en', ?, ?, 'CC0', ?, ?, ?)`);
      translation.run('published', 'Published first', 'published', 0, '2020-01-01');
      translation.run('reviewed-ai', 'Reviewed AI', 'reviewed', 1, '2020-01-02');
      translation.run('reviewed-human', `${'a'.repeat(250)} tailword`, 'reviewed', 0, '2020-01-03');
      translation.run('draft', 'Private draft', 'draft', 0, '2019-01-01');
      db.close();

      const result = spawnSync('bun', ['scripts/static-corpus-export.ts'], {
        cwd: ROOT,
        env: { ...process.env, SOHAMHAMSO_DB_PATH: dbPath, STATIC_CORPUS_OUT: output },
        encoding: 'utf8',
      });
      expect(result.status, result.stderr).toBe(0);
      const chapter = JSON.parse(readFileSync(join(output, 'sample/1.json'), 'utf8'));
      expect(chapter.translations.map((row: { translator: string }) => row.translator)).toEqual([
        'reviewed-human',
        'reviewed-ai',
        'published',
      ]);
      const search = JSON.parse(readFileSync(join(output, 'search/en.json'), 'utf8'));
      expect(search.rows[0].translation_excerpt).not.toContain('tailword');
      expect(search.rows[0].search_text).toContain('tailword');
      const lemmas = JSON.parse(readFileSync(join(output, 'lemmas.json'), 'utf8'));
      expect(lemmas.rows).toEqual([
        expect.objectContaining({ lemma_iast: 'śiva', slug: 'siva-2', occurrence_count: 3 }),
      ]);
      const summaries = JSON.parse(readFileSync(join(output, 'lemma-summaries.json'), 'utf8'));
      expect(summaries.rows).toEqual([
        expect.objectContaining({ lemma_iast: 'siva', slug: 'siva' }),
        expect.objectContaining({ lemma_iast: 'śiva', text_occurrences: { sample: 3 } }),
      ]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
