#!/usr/bin/env bun
/**
 * sohamhamso — morph trust audit CLI (comparison mode)
 *
 * Reads vidyut-cheda output (data/morph/{slug}.json, written by
 * pipeline/morph/runner.py) and the corpus YAML's existing LLM word_glosses,
 * then writes a lemma-level agreement/disagreement report to
 * data/morph/{slug}-audit.json. This is the trust-audit input — see
 * pipeline/morph/README.md for how to read it (disagreement is a triage
 * queue, not a verdict).
 *
 * Usage:
 *   bun pipeline/morph/audit.ts <text-slug>
 *
 * Exit codes:
 *   0  audit written
 *   1  usage error / corpus YAML not found
 *   4  no vidyut output for this slug (run pipeline/morph/runner.py first)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';
import { type CorpusVerse, type CorpusWordGloss, type MorphVerse, buildAudit } from './compare';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..', '..');
const CORPUS = join(REPO, 'data', 'corpus');
const MORPH = join(REPO, 'data', 'morph');

interface CorpusChapter {
  chapter?: number;
  verses?: Array<{
    verse?: number;
    verse_num?: number;
    word_glosses?: CorpusWordGloss[];
  }>;
}

interface CorpusDoc {
  chapters?: CorpusChapter[];
}

interface MorphDoc {
  text_slug: string;
  tool?: Record<string, string>;
  input_mode?: string;
  verses: Record<string, MorphVerse>;
}

function main(): number {
  const slug = process.argv[2];
  if (!slug || slug.startsWith('-')) {
    console.error('Usage: bun pipeline/morph/audit.ts <text-slug>');
    return 1;
  }

  const corpusPath = join(CORPUS, `${slug}.yaml`);
  if (!existsSync(corpusPath)) {
    console.error(`No corpus YAML at ${corpusPath}`);
    return 1;
  }

  const morphPath = join(MORPH, `${slug}.json`);
  if (!existsSync(morphPath)) {
    console.error(`No vidyut output at ${morphPath}.`);
    console.error('Run the morphology runner first (see pipeline/morph/README.md):');
    console.error(`  python3 pipeline/morph/runner.py ${slug}`);
    return 4;
  }

  const doc = yamlLoad(readFileSync(corpusPath, 'utf-8')) as CorpusDoc;
  const morphDoc = JSON.parse(readFileSync(morphPath, 'utf-8')) as MorphDoc;

  const corpusVerses: CorpusVerse[] = [];
  for (const ch of doc.chapters ?? []) {
    const chNum = ch.chapter;
    if (chNum == null) continue;
    for (const v of ch.verses ?? []) {
      const vn = v.verse_num ?? v.verse;
      if (vn == null) continue;
      corpusVerses.push({
        ref: `${chNum}.${vn}`,
        word_glosses: v.word_glosses ?? [],
      });
    }
  }

  const morphVerses = new Map<string, MorphVerse>(Object.entries(morphDoc.verses ?? {}));

  const audit = buildAudit(slug, corpusVerses, morphVerses);
  const out = {
    ...audit,
    generated_at: new Date().toISOString(),
    sources: {
      corpus: `data/corpus/${slug}.yaml`,
      morph: `data/morph/${slug}.json`,
      tool: morphDoc.tool ?? null,
      input_mode: morphDoc.input_mode ?? null,
    },
    note:
      'Disagreement does not mean the LLM gloss is wrong: vidyut-cheda is ' +
      'experimental and struggles on terse sutra text and proper nouns ' +
      'absent from its kosha. Treat disagreements as a human-review queue; ' +
      'each disagreeing row carries a heuristic triage `category` ' +
      '(llm_gloss_error | vidyut_segmentation | legitimate_ambiguity | ' +
      'unresolved_alignment) — see pipeline/morph/README.md.',
  };

  mkdirSync(MORPH, { recursive: true });
  const outPath = join(MORPH, `${slug}-audit.json`);
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  const s = audit.summary;
  console.log(`[ok] ${slug}: audit -> ${outPath}`);
  console.log(
    `  verses compared: ${s.verses_compared} (no morph: ${s.verses_without_morph}, no glosses: ${s.verses_without_glosses})`,
  );
  console.log(
    `  words: ${s.words_total}  aligned: ${s.words_aligned} (${(s.aligned_rate * 100).toFixed(1)}%)  lemma agree: ${s.lemma_agree}  disagree: ${s.lemma_disagree}  rate: ${(s.agreement_rate * 100).toFixed(1)}%`,
  );
  console.log(`  classifications: ${JSON.stringify(s.classifications)}`);
  console.log(
    `  match kinds: ${JSON.stringify(s.match_kinds)}  dhatu-flagged: ${s.dhatu_flagged}`,
  );
  console.log(`  disagreement categories: ${JSON.stringify(s.categories)}`);
  return 0;
}

process.exit(main());
