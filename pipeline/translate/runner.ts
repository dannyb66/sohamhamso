#!/usr/bin/env bun
/**
 * sohamhamso — AI translation pipeline runner
 *
 * Sanskrit-grounded translation pipeline. Reads verses lacking a translation in
 * a target language, calls the v1-sanskrit-grounded prompt against Claude Sonnet,
 * scores the candidate with v1-judge (Sanskrit fidelity), writes the result to
 * the `translations` table with full provenance.
 *
 * Grounding is Sanskrit + Vidyut morphology + Cologne MW glosses + meter — NOT
 * the PD English translation. PD English is a reference signal only. The judge
 * scores Sanskrit fidelity, not anchor similarity. See:
 *   /Users/danny/Documents/GitHub/sohamhamso/STATUS-CONTRACT.md
 *   pipeline/translate/prompts/v1-sanskrit-grounded.md
 *   pipeline/translate/prompts/v1-judge.md
 *
 * Usage:
 *   bun pipeline/translate/runner.ts --lang en --text siva-sutras
 *   bun pipeline/translate/runner.ts --lang ta --text vijnana-bhairava --limit 10
 *   bun pipeline/translate/runner.ts --lang en --text siva-sutras --dry-run
 *
 * Env:
 *   ANTHROPIC_API_KEY  required (skipped with warning if missing — dry-run still works)
 *
 * SDK assumption: @anthropic-ai/sdk v0.40+ (Messages API with system/user roles).
 * The package is NOT yet a dependency in package.json — install separately
 * before running with real API calls:
 *   bun add @anthropic-ai/sdk
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// pipeline/translate/runner.ts -> project root is two levels up
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DEFAULT_DB_PATH = join(PROJECT_ROOT, 'db', 'sohamhamso.db');

const PROMPT_TRANSLATE_PATH = join(__dirname, 'prompts', 'v1-sanskrit-grounded.md');
const PROMPT_JUDGE_PATH = join(__dirname, 'prompts', 'v1-judge.md');

// ---- constants pinned to the contract ----

const MODEL = 'claude-sonnet-4-5-20250929';
const MODEL_DISPLAY = 'claude-sonnet-4-6'; // logical name written to translations.model per STATUS-CONTRACT.md
const PROMPT_VERSION_TRANSLATE = 'v1-sanskrit-grounded';
const PROMPT_VERSION_JUDGE = 'v1-judge';
const JUDGE_PUBLISH_THRESHOLD = 7;
const RATE_LIMIT_SLEEP_MS = 1500; // simple sleep between calls; real gateway comes in shared rate-limit Worker workstream
const DEFAULT_TRANSLATOR_LABEL = 'sohamhamso AI pipeline';

// ---- PD English reference map (see pipeline/translate/anchors/woodroffe-references.md) ----

const PD_REFERENCES: Record<string, { citation: string; note: string } | null> = {
  'siva-sutras': null,
  'spanda-karikas': null,
  'pratyabhijna-hrdayam': null,
  // Vijñāna Bhairava: partial Woodroffe summary; per-verse coverage is sparse.
  // V1 scaffolding leaves this null; per-verse coverage will land via
  // data/pd-anchors/vijnana-bhairava.json in a follow-up.
  'vijnana-bhairava': null,
  'karpuradi-stotra': {
    citation: 'Woodroffe (Arthur Avalon), Hymn to Kali (Karpuradi-Stotra), Luzac & Co., 1922 (PD).',
    note: 'Full PD translation. Pass full text as reference signal.',
  },
  // Phase 2 additions
  'mahanirvana-tantra': {
    citation:
      'Woodroffe (Arthur Avalon), Mahanirvana Tantra (Tantra of the Great Liberation), Luzac & Co., 1913 (PD).',
    note: 'Full PD translation. Canonical Tantric anchor.',
  },
};

// ---- types ----

interface CliOpts {
  lang: string;
  text: string;
  limit?: number;
  dryRun: boolean;
  dbPath: string;
}

interface VerseRow {
  id: number;
  text_id: string;
  text_slug: string;
  chapter: number;
  verse_num: number;
  devanagari: string;
  iast: string | null;
  slp1: string | null;
  meter: string | null;
}

interface GlossRow {
  word_idx: number;
  word_sa: string;
  lemma_sa: string | null;
  lemma_iast: string | null;
  gloss_text: string;
  morph: string | null;
}

interface PromptInputs {
  devanagari: string;
  iast: string;
  slp1: string;
  morphology: string;
  lexicon_glosses: string;
  meter: string;
  prev_verse_context: string;
  target_language: string;
  pd_english_reference: string;
}

interface TranslationResult {
  translation: string;
  word_glosses: Array<{
    word_idx: number;
    word_sa: string;
    lemma_sa?: string;
    lemma_iast?: string;
    gloss: string;
    morph?: string;
  }>;
  confidence: number;
  sanskrit_grounding_notes: string;
  deviations_from_pd_english: string[];
  technical_term_resolutions: Array<{
    term_sa: string;
    rendered_as: string;
    rationale: string;
  }>;
}

interface JudgeResult {
  score: number;
  rationale: string;
  concerns: string[];
}

// ---- CLI ----

function parseArgs(argv: string[]): CliOpts {
  const opts: Partial<CliOpts> = { dryRun: false, dbPath: DEFAULT_DB_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--lang' && argv[i + 1]) opts.lang = argv[++i];
    else if (a === '--text' && argv[i + 1]) opts.text = argv[++i];
    else if (a === '--limit' && argv[i + 1]) opts.limit = Number.parseInt(argv[++i], 10);
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--db' && argv[i + 1]) opts.dbPath = argv[++i];
  }
  if (!opts.lang) throw new Error('Missing required --lang (e.g. --lang en)');
  if (!opts.text) throw new Error('Missing required --text (e.g. --text siva-sutras)');
  return opts as CliOpts;
}

// ---- prompt template loader (very simple {{placeholder}} substitution) ----

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name) => {
    if (!(name in vars)) {
      // leave placeholder visible if not supplied — caller bug we want to see
      return `{{${name}}}`;
    }
    return vars[name];
  });
}

// ---- DB helpers ----

function loadVersesNeedingTranslation(
  db: Database,
  textSlug: string,
  lang: string,
  limit?: number,
): VerseRow[] {
  const sql = `
    SELECT v.id, v.text_id, t.slug AS text_slug, v.chapter, v.verse_num,
           v.devanagari, v.iast, v.slp1, v.meter
    FROM verses v
    JOIN texts t ON t.id = v.text_id
    LEFT JOIN translations tr
      ON tr.verse_id = v.id AND tr.lang = ?
    WHERE t.slug = ?
      AND tr.id IS NULL
    ORDER BY v.chapter, v.verse_num
    ${limit ? 'LIMIT ?' : ''}
  `;
  const args = limit ? [lang, textSlug, limit] : [lang, textSlug];
  return db.query<VerseRow, unknown[]>(sql).all(...args);
}

function loadGlosses(db: Database, verseId: number, glossLang: string): GlossRow[] {
  // Prefer target-language glosses; fall back to English if none exist.
  const rows = db
    .query<GlossRow, [number, string]>(
      `SELECT word_idx, word_sa, lemma_sa, lemma_iast, gloss_text, morph
       FROM word_glosses
       WHERE verse_id = ? AND gloss_lang = ?
       ORDER BY word_idx`,
    )
    .all(verseId, glossLang);
  if (rows.length > 0) return rows;
  return db
    .query<GlossRow, [number]>(
      `SELECT word_idx, word_sa, lemma_sa, lemma_iast, gloss_text, morph
       FROM word_glosses
       WHERE verse_id = ? AND gloss_lang = 'en'
       ORDER BY word_idx`,
    )
    .all(verseId);
}

function loadPrevContext(db: Database, verse: VerseRow): string {
  // Pull preceding two verses in the same text (cross chapter boundary if needed).
  const rows = db
    .query<
      { chapter: number; verse_num: number; devanagari: string; iast: string | null },
      [string, number, number, number, number]
    >(
      `SELECT chapter, verse_num, devanagari, iast
       FROM verses
       WHERE text_id = ?
         AND ( (chapter < ?) OR (chapter = ? AND verse_num < ?) )
       ORDER BY chapter DESC, verse_num DESC
       LIMIT ?`,
    )
    .all(verse.text_id, verse.chapter, verse.chapter, verse.verse_num, 2);
  if (rows.length === 0) return '(no preceding context — this is the opening of the text)';
  return rows
    .reverse()
    .map((r) => `[${r.chapter}.${r.verse_num}] ${r.devanagari}${r.iast ? `\n${r.iast}` : ''}`)
    .join('\n\n');
}

function formatGlosses(glosses: GlossRow[]): { morphology: string; lexicon_glosses: string } {
  if (glosses.length === 0) {
    return {
      morphology: '(no morphology data available — verse not yet processed by morph agent)',
      lexicon_glosses: '(no lexicon glosses available — verse not yet processed by morph agent)',
    };
  }
  const morphology = glosses
    .map((g) => {
      const lemma = g.lemma_iast ?? g.lemma_sa ?? '?';
      const morph = g.morph ?? '(no morph)';
      return `#${g.word_idx} ${g.word_sa}  lemma=${lemma}  ${morph}`;
    })
    .join('\n');
  const lexicon = glosses
    .map((g) => {
      const lemma = g.lemma_iast ?? g.lemma_sa ?? g.word_sa;
      return `#${g.word_idx} ${lemma}: ${g.gloss_text}`;
    })
    .join('\n');
  return { morphology, lexicon_glosses: lexicon };
}

function pdReferenceFor(textSlug: string): string {
  const ref = PD_REFERENCES[textSlug];
  if (!ref)
    return '(no public-domain English translation available for this text; ground on Sanskrit alone)';
  return `${ref.citation}\nNote: ${ref.note}\n(Reference signal only — trust Sanskrit + morphology when they disagree.)`;
}

function insertTranslation(
  db: Database,
  verseId: number,
  lang: string,
  result: TranslationResult,
  judge: JudgeResult,
  license: string,
): void {
  const status = judge.score >= JUDGE_PUBLISH_THRESHOLD ? 'published' : 'draft';
  db.query(
    `INSERT INTO translations
      (verse_id, lang, translator, translation_text, source, license, status,
       ai_assisted, model, model_version, prompt_version, judge_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).run(
    verseId,
    lang,
    DEFAULT_TRANSLATOR_LABEL,
    result.translation,
    `AI pipeline ${PROMPT_VERSION_TRANSLATE} + judge ${PROMPT_VERSION_JUDGE}`,
    license,
    status,
    MODEL_DISPLAY,
    MODEL,
    PROMPT_VERSION_TRANSLATE,
    judge.score,
  );
  // Word glosses in the target language are also captured by the morph agent's
  // Indic fan-out (per plan workstream 4). This runner does NOT write into
  // word_glosses to avoid contention with the morph workstream.
}

// ---- Anthropic SDK shim ----
// Loaded lazily so dry-run works even when the SDK is not installed and so the
// scaffold compiles before `bun add @anthropic-ai/sdk` is run.

type AnthropicClient = {
  messages: {
    create: (req: {
      model: string;
      max_tokens: number;
      temperature: number;
      system: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    }) => Promise<{ content: Array<{ type: string; text?: string }> }>;
  };
};

let _client: AnthropicClient | null = null;

async function getClient(): Promise<AnthropicClient | null> {
  if (_client) return _client;
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[warn] ANTHROPIC_API_KEY not set — live API calls will be skipped');
    return null;
  }
  try {
    // dynamic import so missing SDK does not crash the scaffold at import time
    const mod = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (cfg: { apiKey: string }) => AnthropicClient;
    };
    _client = new mod.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    return _client;
  } catch (err) {
    console.warn(
      '[warn] @anthropic-ai/sdk not installed — run `bun add @anthropic-ai/sdk`. Skipping live calls.',
    );
    return null;
  }
}

async function callClaude(
  systemPrompt: string,
  userContent: string,
  temperature: number,
): Promise<string | null> {
  const client = await getClient();
  if (!client) return null;
  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });
  const block = resp.content.find((b) => b.type === 'text');
  return block?.text ?? null;
}

function parseJsonStrict<T>(raw: string, label: string): T {
  // Tolerate optional Markdown fences that the model sometimes emits despite
  // the prompt's instruction to output JSON only.
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed) as T;
  } catch (err) {
    throw new Error(
      `Failed to parse ${label} JSON: ${(err as Error).message}\n---raw---\n${raw}\n----------`,
    );
  }
}

// ---- main loop ----

async function processVerse(
  db: Database,
  verse: VerseRow,
  lang: string,
  templates: { translate: string; judge: string },
  dryRun: boolean,
  textLicense: string,
): Promise<void> {
  const glosses = loadGlosses(db, verse.id, lang);
  const { morphology, lexicon_glosses } = formatGlosses(glosses);
  const prev = loadPrevContext(db, verse);
  const pdRef = pdReferenceFor(verse.text_slug);

  const promptVars: Record<string, string> = {
    devanagari: verse.devanagari,
    iast: verse.iast ?? '(no IAST available)',
    slp1: verse.slp1 ?? '(no SLP1 available)',
    morphology,
    lexicon_glosses,
    meter: verse.meter ?? '(no meter tag)',
    prev_verse_context: prev,
    target_language: lang,
    pd_english_reference: pdRef,
  };

  const translatePrompt = renderTemplate(templates.translate, promptVars);

  if (dryRun) {
    console.log(
      `\n[dry-run] verse ${verse.text_slug} ${verse.chapter}.${verse.verse_num} (id=${verse.id})`,
    );
    console.log(
      `  lang=${lang}  morph_words=${glosses.length}  pd_ref=${PD_REFERENCES[verse.text_slug] ? 'yes' : 'no'}`,
    );
    console.log(
      `  would call ${MODEL} with v1-sanskrit-grounded prompt (~${translatePrompt.length} chars)`,
    );
    console.log(
      `  would then judge with v1-judge prompt, write status='published' if judge_score >= ${JUDGE_PUBLISH_THRESHOLD}`,
    );
    return;
  }

  // 1. translation
  const rawTranslate = await callClaude(
    translatePrompt,
    'Translate the verse above per the contract. Output JSON only.',
    0.2,
  );
  if (rawTranslate === null) {
    console.log(`  [skip] no API client; verse ${verse.id} not translated`);
    return;
  }
  const translationResult = parseJsonStrict<TranslationResult>(rawTranslate, 'translation');
  await sleep(RATE_LIMIT_SLEEP_MS);

  // 2. judge
  const judgePromptVars = {
    ...promptVars,
    candidate_translation: JSON.stringify(translationResult, null, 2),
  };
  const judgePrompt = renderTemplate(templates.judge, judgePromptVars);
  const rawJudge = await callClaude(
    judgePrompt,
    'Score the candidate translation per the rubric. Output JSON only.',
    0.0,
  );
  if (rawJudge === null) {
    console.log(`  [skip] no API client during judge step; verse ${verse.id} not written`);
    return;
  }
  const judgeResult = parseJsonStrict<JudgeResult>(rawJudge, 'judge');
  await sleep(RATE_LIMIT_SLEEP_MS);

  // 3. write
  insertTranslation(db, verse.id, lang, translationResult, judgeResult, textLicense);
  const status = judgeResult.score >= JUDGE_PUBLISH_THRESHOLD ? 'published' : 'draft';
  console.log(
    `  [${status}] ${verse.text_slug} ${verse.chapter}.${verse.verse_num} judge=${judgeResult.score} confidence=${translationResult.confidence}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function loadTextLicense(db: Database, textSlug: string): string {
  const row = db
    .query<{ license: string | null }, [string]>('SELECT license FROM texts WHERE slug = ?')
    .get(textSlug);
  // Default to CC-BY-SA 4.0 per plan; falls back to text-level license if set.
  return row?.license ?? 'CC-BY-SA-4.0';
}

export async function main(): Promise<void> {
  const opts = parseArgs(Bun.argv.slice(2));

  if (!existsSync(opts.dbPath)) {
    throw new Error(
      `DB not found at ${opts.dbPath}. Run \`bun pipeline/ingest/init-db.ts\` first.`,
    );
  }
  if (!existsSync(PROMPT_TRANSLATE_PATH)) {
    throw new Error(`Prompt not found at ${PROMPT_TRANSLATE_PATH}`);
  }
  if (!existsSync(PROMPT_JUDGE_PATH)) {
    throw new Error(`Prompt not found at ${PROMPT_JUDGE_PATH}`);
  }

  const templates = {
    translate: readFileSync(PROMPT_TRANSLATE_PATH, 'utf8'),
    judge: readFileSync(PROMPT_JUDGE_PATH, 'utf8'),
  };

  const db = new Database(opts.dbPath);
  db.exec('PRAGMA foreign_keys = ON;');

  const verses = loadVersesNeedingTranslation(db, opts.text, opts.lang, opts.limit);
  console.log(
    `Translate runner: text=${opts.text} lang=${opts.lang} limit=${opts.limit ?? 'none'} dry_run=${opts.dryRun}`,
  );
  console.log(`Found ${verses.length} verse(s) without a ${opts.lang} translation.`);

  if (verses.length === 0) {
    db.close();
    return;
  }

  const textLicense = loadTextLicense(db, opts.text);
  console.log(`Text license: ${textLicense}`);
  console.log(
    `Model: ${MODEL_DISPLAY} (${MODEL})  prompt: ${PROMPT_VERSION_TRANSLATE}  judge: ${PROMPT_VERSION_JUDGE}`,
  );

  for (const verse of verses) {
    try {
      await processVerse(db, verse, opts.lang, templates, opts.dryRun, textLicense);
    } catch (err) {
      console.error(
        `[err] verse ${verse.id} (${verse.text_slug} ${verse.chapter}.${verse.verse_num}):`,
        (err as Error).message,
      );
    }
  }

  db.close();
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
