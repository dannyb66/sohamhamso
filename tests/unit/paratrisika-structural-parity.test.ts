// QA Lane 1 — Structural & format parity for data/corpus/paratrisika.yaml
// (Parātrīśikā, Wave-1). Proves the merged corpus file is structurally
// indistinguishable from the live Phase-1 baseline texts (closest analogue:
// pratyabhijna-hrdayam.yaml), and guards the known legacy-encoding artifacts.
//
// Verification-only: this test reads existing data; it does not author it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const CORPUS = join(process.cwd(), 'data', 'corpus');
const LANGS = ['en', 'hi', 'mr', 'bn', 'as', 'gu', 'pa', 'kn', 'ml', 'or', 'ta', 'te'];
const INDIC = LANGS.filter((l) => l !== 'en');

function load(slug: string): any {
  return parseYaml(readFileSync(join(CORPUS, `${slug}.yaml`), 'utf8'));
}

function verses(doc: any): any[] {
  const out: any[] = [];
  for (const ch of doc.chapters ?? []) for (const v of ch.verses ?? []) out.push(v);
  return out;
}

const pt = load('paratrisika');
const ptVerses = verses(pt);

describe('paratrisika.yaml — structural & format parity (QA Lane 1)', () => {
  it('Check 1: text metadata is a superset of the required keys', () => {
    const required = [
      'id', 'slug', 'title_sa', 'title_en', 'title_iast', 'tradition',
      'license', 'source', 'source_url', 'source_revision', 'expected_verse_count',
    ];
    for (const k of required) {
      expect(pt.text, `text.${k} present`).toHaveProperty(k);
      expect(pt.text[k], `text.${k} non-empty`).toBeTruthy();
    }
    expect(pt.text.id).toBe('paratrisika');
    expect(pt.text.slug).toBe('paratrisika');
  });

  it('Check 2: 36 verses, each with devanagari/iast/word_glosses[]/translations[]', () => {
    expect(ptVerses.length).toBe(36);
    expect(pt.text.expected_verse_count).toBe(36);
    for (const v of ptVerses) {
      expect(typeof v.devanagari).toBe('string');
      expect(typeof v.iast).toBe('string');
      expect(Array.isArray(v.word_glosses)).toBe(true);
      expect(Array.isArray(v.translations)).toBe(true);
    }
  });

  it('Check 3: exactly 12 translations/verse, all published, no stray claude-fable-5', () => {
    for (const v of ptVerses) {
      const langs = v.translations.map((t: any) => t.lang).sort();
      expect(langs).toEqual([...LANGS].sort());
      for (const t of v.translations) {
        for (const f of ['translator', 'license', 'status', 'ai_assisted', 'model']) {
          expect(t, `translation ${t.lang} has ${f}`).toHaveProperty(f);
        }
        expect(t.status).toBe('published');
        expect(String(t.model)).not.toContain('fable');
      }
    }
  });

  it('Check 4: word_glosses anatomy matches baseline (word/iast/gloss_en/morph + 11 inline gloss_xx)', () => {
    for (const v of ptVerses) {
      for (const g of v.word_glosses) {
        for (const f of ['word', 'iast', 'gloss_en', 'morph']) {
          expect(g, `gloss has ${f}`).toHaveProperty(f);
        }
        for (const l of INDIC) {
          expect(g, `gloss has gloss_${l}`).toHaveProperty(`gloss_${l}`);
        }
      }
    }
  });

  it('Check 5: no literal [draft] marker anywhere', () => {
    const raw = readFileSync(join(CORPUS, 'paratrisika.yaml'), 'utf8');
    expect(raw).not.toContain('[draft]');
  });

  it('Check 5: legacy "." artifacts preserved (NOT minted into a danda)', () => {
    const v19 = ptVerses[18];
    const v29 = ptVerses[28];
    expect(v19.iast).toContain('adṛṣṭama.ṅdalo');
    expect(v29.iast).toContain('stha.ṅdilaṃ');
    // the artifact must remain a literal ASCII '.', never the danda '।'
    expect(v19.iast).not.toContain('adṛṣṭama।');
    expect(v29.iast).not.toContain('stha।');
  });
});
