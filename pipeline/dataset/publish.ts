#!/usr/bin/env bun
/**
 * sohamhamso — dataset publisher
 *
 * Emits a versioned CC-BY-SA 4.0 dataset bundle from the local SQLite DB
 * at db/sohamhamso.db, matching the V1 DX Spec layout (see plan
 * check-online-websites-aim-sparkling-pearl.md, section
 * "V1 DX Spec → 1. Dataset schema").
 *
 * Output:
 *   dataset/build/sohamhamso-dataset-vYYYY.MM.DD/
 *     ├── README.md
 *     ├── LICENSE-CC-BY-SA-4.0
 *     ├── ATTRIBUTION.md
 *     ├── CHANGELOG.md
 *     ├── checksums.sha256
 *     ├── texts.csv
 *     ├── verses.csv
 *     ├── translations.csv
 *     ├── word_glosses.csv
 *     ├── parallels.csv
 *     ├── json/{text-slug}.json   — denormalized verse anatomy
 *     └── tei/{text-slug}.xml     — minimal TEI per text
 *
 * Run:
 *   bun pipeline/dataset/publish.ts
 *   bun pipeline/dataset/publish.ts --version v2026.05.31
 *   bun pipeline/dataset/publish.ts --version v2026.05.31 --out dataset/build/
 *
 * Versioning: vYYYY.MM.DD (per V1 DX Spec). Pre-1.0 increments per text addition.
 *
 * MIRI gate: texts whose corpus YAML (data/corpus/*.yaml) carries
 * `text.pending_miri: true` are EXCLUDED from the bundle (texts, verses,
 * translations, glosses, parallels, JSON + TEI shards) until written
 * Muktabodha redistribution permission lands. See ATTRIBUTION.md and
 * docs/MIRI-PERMISSION-REQUEST.md.
 *
 * No external CSV/XML deps — tiny built-in writers below.
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

interface Args {
  version: string;
  out: string;
  db: string;
  corpus: string;
  repoRoot: string;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  // pipeline/dataset/publish.ts → repo root is two dirs up.
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');

  return {
    version: get('--version') ?? defaultVersion(),
    out: get('--out') ?? resolve(repoRoot, 'dataset', 'build'),
    db: get('--db') ?? resolve(repoRoot, 'db', 'sohamhamso.db'),
    corpus: get('--corpus') ?? resolve(repoRoot, 'data', 'corpus'),
    repoRoot,
  };
}

function defaultVersion(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `v${y}.${m}.${day}`;
}

function assertVersion(v: string): void {
  if (!/^v\d{4}\.\d{2}\.\d{2}$/.test(v)) {
    throw new Error(`--version must match vYYYY.MM.DD, got: ${v}. (Per V1 DX Spec § 1.)`);
  }
}

// ---------------------------------------------------------------
// MIRI permission gate — pending_miri texts are held out of the bundle
// ---------------------------------------------------------------

/**
 * Scans the corpus YAML directory for texts flagged `pending_miri: true`
 * (Muktabodha-derived texts awaiting written MIRI redistribution
 * permission — see ATTRIBUTION.md). Returns their slugs. There is no DB
 * column for this flag; the corpus YAML is the source of truth.
 *
 * Exported for unit tests (publish.ts otherwise runs as a CLI).
 */
export function readPendingMiriSlugs(corpusDir: string): Set<string> {
  const held = new Set<string>();
  if (!existsSync(corpusDir)) return held;
  for (const entry of readdirSync(corpusDir)) {
    // Skip templates (_template.yaml), FAQ sidecars, and non-YAML files.
    if (entry.startsWith('_') || /\.faq\.ya?ml$/.test(entry) || !/\.ya?ml$/.test(entry)) continue;
    const doc = yamlLoad(readFileSync(join(corpusDir, entry), 'utf8')) as {
      text?: { id?: string; slug?: string; pending_miri?: boolean };
    } | null;
    if (doc?.text?.pending_miri === true) {
      const slug = doc.text.slug ?? doc.text.id;
      if (slug) held.add(slug);
    }
  }
  return held;
}

/** SQL-quote a set of ids/slugs into an IN(...) list. Slugs match
 *  /^[a-z0-9-]+$/ per corpus schema, but escape quotes anyway. */
function sqlIdList(ids: Iterable<string>): string {
  return [...ids].map((id) => `'${id.replace(/'/g, "''")}'`).join(', ');
}

/** Maps held corpus slugs to texts.id values present in THIS db (slug and
 *  id are usually identical, but the DB id is what verses FK against). */
function resolveHeldTextIds(db: Database, heldSlugs: Set<string>): Set<string> {
  if (heldSlugs.size === 0) return new Set();
  const list = sqlIdList(heldSlugs);
  const rows = db
    .query(`SELECT id FROM texts WHERE slug IN (${list}) OR id IN (${list})`)
    .all() as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/**
 * Per-table WHERE fragment excluding everything belonging to held texts.
 * Returns '' when nothing is held (or the table needs no gate).
 */
export function holdWhere(table: string, heldTextIds: Set<string>): string {
  if (heldTextIds.size === 0) return '';
  const list = sqlIdList(heldTextIds);
  const verseSub = `SELECT id FROM verses WHERE text_id IN (${list})`;
  switch (table) {
    case 'texts':
      return `id NOT IN (${list})`;
    case 'verses':
      return `text_id NOT IN (${list})`;
    case 'translations':
    case 'word_glosses':
      return `verse_id NOT IN (${verseSub})`;
    case 'parallels':
      return `source_verse_id NOT IN (${verseSub}) AND target_verse_id NOT IN (${verseSub})`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------
// Tiny CSV writer (RFC 4180-ish: escape ", wrap fields containing ",\,\n,\r)
// ---------------------------------------------------------------

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(',');
}

function writeCsv(
  path: string,
  header: string[],
  rows: Iterable<unknown[]>,
): { rows: number; bytes: number } {
  const out: string[] = [csvRow(header)];
  let count = 0;
  for (const r of rows) {
    out.push(csvRow(r));
    count++;
  }
  // Trailing newline keeps `wc -l` honest and matches POSIX text-file convention.
  const body = `${out.join('\n')}\n`;
  writeFileSync(path, body, 'utf8');
  return { rows: count, bytes: Buffer.byteLength(body, 'utf8') };
}

// ---------------------------------------------------------------
// Tiny XML escaping for TEI emission
// ---------------------------------------------------------------

function xmlEscape(s: string | null | undefined): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------
// Schema column order — MUST match db/schema.sql exactly.
// ---------------------------------------------------------------

const TEXTS_COLS = [
  'id',
  'slug',
  'title_sa',
  'title_en',
  'title_iast',
  'author',
  'tradition',
  'school',
  'era',
  'source',
  'source_url',
  'source_revision',
  'license',
  'attribution_html',
  'parent_text_id',
  'manuscript_url',
  'description',
  'created_at',
  'updated_at',
];

const VERSES_COLS = [
  'id',
  'text_id',
  'book',
  'chapter',
  'verse_num',
  'devanagari',
  'slp1',
  'iast',
  'meter',
  'manuscript_folio_ref',
  'created_at',
];

const TRANSLATIONS_COLS = [
  'id',
  'verse_id',
  'lang',
  'translator',
  'translation_text',
  'source',
  'license',
  'status',
  'ai_assisted',
  'model',
  'model_version',
  'prompt_version',
  'judge_score',
  'reviewer',
  'reviewed_at',
  'created_at',
  'updated_at',
];

const WORD_GLOSSES_COLS = [
  'id',
  'verse_id',
  'word_idx',
  'word_sa',
  'lemma_sa',
  'lemma_iast',
  'gloss_lang',
  'gloss_text',
  'morph',
  'created_at',
];

const PARALLELS_COLS = [
  'id',
  'source_verse_id',
  'target_verse_id',
  'citation_type',
  'confidence',
  'extracted_by',
  'created_at',
];

// ---------------------------------------------------------------
// Row generators (streaming via bun:sqlite iterate())
// ---------------------------------------------------------------

function* rowsFor(
  db: Database,
  table: string,
  cols: string[],
  heldTextIds: Set<string>,
): Iterable<unknown[]> {
  // `draft` translations are reviewer-internal per STATUS-CONTRACT.md — never
  // shipped to the public dataset. pending_miri texts (and all their child
  // rows) are held out per the MIRI gate above. Everything else ships as-is.
  const clauses: string[] = [];
  if (table === 'translations') clauses.push("status IN ('reviewed','published')");
  const hold = holdWhere(table, heldTextIds);
  if (hold) clauses.push(hold);
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const q = db.query(`SELECT ${cols.join(', ')} FROM ${table}${where}`);
  // bun:sqlite Query has .iterate() in recent versions; fall back to .all().
  // We use .all() for portability — datasets stay small (~thousands of rows).
  const all = q.all() as Record<string, unknown>[];
  for (const r of all) {
    yield cols.map((c) => r[c]);
  }
}

// ---------------------------------------------------------------
// JSON shards — denormalized verse anatomy per text
// ---------------------------------------------------------------

interface TextRow {
  id: string;
  slug: string;
  [k: string]: unknown;
}

function emitJsonShards(
  db: Database,
  dir: string,
  heldTextIds: Set<string>,
): { files: number; bytes: number } {
  mkdirSync(dir, { recursive: true });

  const texts = (
    db.query(`SELECT ${TEXTS_COLS.join(', ')} FROM texts ORDER BY slug`).all() as TextRow[]
  ).filter((t) => !heldTextIds.has(t.id));

  let files = 0;
  let bytes = 0;

  for (const text of texts) {
    const verses = db
      .query(
        `SELECT ${VERSES_COLS.join(', ')} FROM verses WHERE text_id = ? ORDER BY chapter, verse_num`,
      )
      .all(text.id) as Array<Record<string, unknown>>;

    // group verses by chapter
    const byChapter = new Map<number, Array<Record<string, unknown>>>();
    for (const v of verses) {
      const ch = Number(v.chapter);
      if (!byChapter.has(ch)) byChapter.set(ch, []);
      byChapter.get(ch)?.push(v);
    }

    const chapters = [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapter, vs]) => ({
        chapter,
        verses: vs.map((v) => {
          const verseId = v.id as number;

          const glosses = db
            .query(
              `SELECT word_idx, word_sa, lemma_sa, lemma_iast, gloss_lang, gloss_text, morph
               FROM word_glosses WHERE verse_id = ? ORDER BY word_idx, gloss_lang`,
            )
            .all(verseId);

          const translations = db
            .query(
              `SELECT lang, translator, translation_text AS text, source, license,
                      status, ai_assisted, model, model_version, prompt_version,
                      judge_score, reviewer, reviewed_at
               FROM translations
               WHERE verse_id = ? AND status IN ('reviewed','published')
               ORDER BY lang, translator`,
            )
            .all(verseId)
            .map((row) => {
              const t = row as Record<string, unknown> & { ai_assisted: number | boolean };
              return { ...t, ai_assisted: t.ai_assisted === 1 || t.ai_assisted === true };
            });

          const parallels = db
            .query(
              `SELECT source_verse_id, target_verse_id, citation_type, confidence, extracted_by
               FROM parallels WHERE source_verse_id = ? ORDER BY confidence DESC`,
            )
            .all(verseId);

          return {
            verse: v.verse_num,
            book: v.book,
            devanagari: v.devanagari,
            iast: v.iast,
            slp1: v.slp1,
            meter: v.meter,
            manuscript_folio_ref: v.manuscript_folio_ref,
            word_glosses: glosses,
            translations,
            parallels,
          };
        }),
      }));

    const shard = { text, chapters };
    const path = join(dir, `${text.slug}.json`);
    const body = `${JSON.stringify(shard, null, 2)}\n`;
    writeFileSync(path, body, 'utf8');
    files++;
    bytes += Buffer.byteLength(body, 'utf8');
  }

  return { files, bytes };
}

// ---------------------------------------------------------------
// TEI-XML shards — minimal valid TEI per text
// ---------------------------------------------------------------

function emitTeiShards(
  db: Database,
  dir: string,
  heldTextIds: Set<string>,
): { files: number; bytes: number } {
  mkdirSync(dir, { recursive: true });

  const texts = (
    db.query(`SELECT ${TEXTS_COLS.join(', ')} FROM texts ORDER BY slug`).all() as Array<
      Record<string, unknown>
    >
  ).filter((t) => !heldTextIds.has(t.id as string));

  let files = 0;
  let bytes = 0;

  for (const text of texts) {
    const verses = db
      .query(
        `SELECT id, book, chapter, verse_num, devanagari, iast, slp1, meter
         FROM verses WHERE text_id = ? ORDER BY chapter, verse_num`,
      )
      .all(text.id) as Array<Record<string, unknown>>;

    const byChapter = new Map<number, Array<Record<string, unknown>>>();
    for (const v of verses) {
      const ch = Number(v.chapter);
      if (!byChapter.has(ch)) byChapter.set(ch, []);
      byChapter.get(ch)?.push(v);
    }

    const lines: string[] = [];
    lines.push('<?xml version="1.0" encoding="UTF-8"?>');
    lines.push('<TEI xmlns="http://www.tei-c.org/ns/1.0">');
    lines.push('  <teiHeader>');
    lines.push('    <fileDesc>');
    lines.push('      <titleStmt>');
    lines.push(`        <title xml:lang="sa">${xmlEscape(text.title_sa as string)}</title>`);
    lines.push(`        <title xml:lang="en">${xmlEscape(text.title_en as string)}</title>`);
    if (text.author) {
      lines.push(`        <author>${xmlEscape(text.author as string)}</author>`);
    }
    lines.push('      </titleStmt>');
    lines.push('      <publicationStmt>');
    lines.push('        <publisher>sohamhamso</publisher>');
    lines.push(
      `        <availability><licence target="https://creativecommons.org/licenses/by-sa/4.0/">CC-BY-SA 4.0</licence></availability>`,
    );
    lines.push('      </publicationStmt>');
    lines.push('      <sourceDesc>');
    if (text.source || text.source_url || text.source_revision) {
      lines.push('        <bibl>');
      if (text.source) lines.push(`          <title>${xmlEscape(text.source as string)}</title>`);
      if (text.source_url)
        lines.push(`          <ref target="${xmlEscape(text.source_url as string)}"/>`);
      if (text.source_revision)
        lines.push(`          <edition>${xmlEscape(text.source_revision as string)}</edition>`);
      lines.push('        </bibl>');
    } else {
      lines.push('        <p>Source not recorded.</p>');
    }
    lines.push('      </sourceDesc>');
    lines.push('    </fileDesc>');
    lines.push('  </teiHeader>');
    lines.push('  <text>');
    lines.push('    <body>');

    const chapters = [...byChapter.entries()].sort((a, b) => a[0] - b[0]);
    for (const [chapter, vs] of chapters) {
      lines.push(`      <div type="chapter" n="${chapter}">`);
      for (const v of vs) {
        const attrs = [`n="${v.verse_num}"`, 'type="verse"'];
        if (v.meter) attrs.push(`met="${xmlEscape(v.meter as string)}"`);
        lines.push(`        <lg ${attrs.join(' ')}>`);
        // Each line of the verse becomes an <l>. We split on \n; if there are
        // no newlines, the whole verse is one <l>.
        const dev = String(v.devanagari ?? '')
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (dev.length === 0) dev.push('');
        for (const line of dev) {
          lines.push(`          <l xml:lang="sa-Deva">${xmlEscape(line)}</l>`);
        }
        if (v.iast) {
          const iastLines = String(v.iast)
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
          for (const line of iastLines) {
            lines.push(`          <l xml:lang="sa-Latn">${xmlEscape(line)}</l>`);
          }
        }
        lines.push('        </lg>');
      }
      lines.push('      </div>');
    }

    lines.push('    </body>');
    lines.push('  </text>');
    lines.push('</TEI>');
    lines.push('');

    const path = join(dir, `${text.slug}.xml`);
    const body = lines.join('\n');
    writeFileSync(path, body, 'utf8');
    files++;
    bytes += Buffer.byteLength(body, 'utf8');
  }

  return { files, bytes };
}

// ---------------------------------------------------------------
// CC-BY-SA 4.0 license file (extracted from repo LICENSE for clarity)
// ---------------------------------------------------------------

const LICENSE_CC_BY_SA = `Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)

You are free to:

- Share — copy and redistribute the material in any medium or format
- Adapt — remix, transform, and build upon the material for any purpose,
  even commercially

Under the following terms:

- Attribution — You must give appropriate credit, provide a link to the
  license, and indicate if changes were made. You may do so in any reasonable
  manner, but not in any way that suggests the licensor endorses you or your
  use.
- ShareAlike — If you remix, transform, or build upon the material, you must
  distribute your contributions under the same license as the original.
- No additional restrictions — You may not apply legal terms or technological
  measures that legally restrict others from doing anything the license
  permits.

Full legal text: https://creativecommons.org/licenses/by-sa/4.0/legalcode

Attribution example:
  "Sanskrit text from sohamhamso (https://sohamhamso.org), released under
   CC-BY-SA 4.0. Source: GRETIL, Muktabodha Indological Research Institute.
   Translations AI-generated by sohamhamso, see methodology."

Upstream source licenses (per ATTRIBUTION.md) may impose additional or
alternative terms on specific files; the most-restrictive applicable license
governs.
`;

// ---------------------------------------------------------------
// README — pandas snippet per V1 DX Spec § 1.
// ---------------------------------------------------------------

function datasetReadme(version: string): string {
  return `# sohamhamso — dataset bundle ${version}

The Tantric / Kashmir Shaivism / Trika / Kaula scripture corpus, released as
CSV + JSON + TEI under **CC-BY-SA 4.0**.

This bundle is the V1 dataset surface of the sohamhamso project. The live
reader is at https://sohamhamso.org. Source repo:
https://github.com/sohamhamso/sohamhamso.

## What's here

\`\`\`
${version === '' ? 'sohamhamso-dataset-vYYYY.MM.DD' : `sohamhamso-dataset-${version}`}/
├── README.md
├── LICENSE-CC-BY-SA-4.0
├── ATTRIBUTION.md
├── CHANGELOG.md
├── checksums.sha256
├── texts.csv             # one row per text
├── verses.csv            # one row per verse
├── translations.csv      # one row per (verse, lang, translator)
├── word_glosses.csv      # one row per (verse, word, lang)
├── parallels.csv         # inter-textual citation links
├── json/{text-slug}.json # denormalized verse anatomy for web use
└── tei/{text-slug}.xml   # minimal TEI (P5) per text
\`\`\`

CSV schemas match the SQLite schema 1:1 (see \`db/schema.sql\` in the source repo).

## Load in pandas

\`\`\`python
import pandas as pd
texts = pd.read_csv("texts.csv")
verses = pd.read_csv("verses.csv")
translations = pd.read_csv("translations.csv")
ss = verses[verses.text_id == texts.loc[texts.slug == "shiva-sutras", "id"].iloc[0]]
print(ss.head())
\`\`\`

## Verify integrity

\`\`\`sh
shasum -a 256 -c checksums.sha256
\`\`\`

## Versioning

\`vYYYY.MM.DD\` date tags. Pre-1.0 increments per text addition. After 1.0,
MAJOR for breaking schema changes, MINOR for new text additions.

## Translation provenance

Every translation carries:
- \`ai_assisted\` (boolean) — AI-generated or not.
- \`status\` — \`draft | reviewed | published\`. \`draft\` rows are excluded from
  public dataset builds.
- \`model\`, \`model_version\`, \`prompt_version\`, \`judge_score\` — full provenance
  for AI-assisted rows.
- \`reviewer\`, \`reviewed_at\` — when human-reviewed.

See \`STATUS-CONTRACT.md\` in the source repo for the badge-rendering contract.

## Citation

DOI auto-deposited per release via Zenodo. See \`zenodo-deposit.json\` (when
present) for the resolved DOI of this build. Suggested citation format
(BibTeX) generated by Zenodo on publish.

## License

Content: CC-BY-SA 4.0 (see \`LICENSE-CC-BY-SA-4.0\`).
Per-source upstream attributions in \`ATTRIBUTION.md\` may impose additional
restrictions; the most-restrictive applicable license governs.
`;
}

// ---------------------------------------------------------------
// CHANGELOG — compare against previous version (if any in --out parent)
// ---------------------------------------------------------------

interface BuildStats {
  texts: number;
  verses: number;
  translations: number;
  glosses: number;
  parallels: number;
  langs: string[];
  newTexts: string[];
}

function collectStats(db: Database, prevTexts: Set<string>, heldTextIds: Set<string>): BuildStats {
  // All counts mirror what actually ships: pending_miri texts (and their
  // child rows) are excluded via the same WHERE fragments as the CSVs.
  const and = (table: string): string => {
    const hold = holdWhere(table, heldTextIds);
    return hold ? ` AND ${hold}` : '';
  };
  const where = (table: string): string => {
    const hold = holdWhere(table, heldTextIds);
    return hold ? ` WHERE ${hold}` : '';
  };

  const texts = db.query(`SELECT slug FROM texts${where('texts')} ORDER BY slug`).all() as Array<{
    slug: string;
  }>;
  const langsRows = db
    .query(
      `SELECT DISTINCT lang FROM translations WHERE status IN ('reviewed','published')${and('translations')} ORDER BY lang`,
    )
    .all() as Array<{ lang: string }>;

  const newTexts = texts.filter((t) => !prevTexts.has(t.slug)).map((t) => t.slug);

  return {
    texts: texts.length,
    verses: (db.query(`SELECT COUNT(*) AS n FROM verses${where('verses')}`).get() as { n: number })
      .n,
    translations: (
      db
        .query(
          `SELECT COUNT(*) AS n FROM translations WHERE status IN ('reviewed','published')${and('translations')}`,
        )
        .get() as { n: number }
    ).n,
    glosses: (
      db.query(`SELECT COUNT(*) AS n FROM word_glosses${where('word_glosses')}`).get() as {
        n: number;
      }
    ).n,
    parallels: (
      db.query(`SELECT COUNT(*) AS n FROM parallels${where('parallels')}`).get() as { n: number }
    ).n,
    langs: langsRows.map((r) => r.lang),
    newTexts,
  };
}

function findPreviousBuild(outDir: string, currentVersion: string): string | null {
  if (!existsSync(outDir)) return null;
  const candidates = readdirSync(outDir)
    .filter((d) => /^sohamhamso-dataset-v\d{4}\.\d{2}\.\d{2}$/.test(d))
    .filter((d) => d !== `sohamhamso-dataset-${currentVersion}`)
    .sort();
  return candidates.length > 0 ? join(outDir, candidates[candidates.length - 1]) : null;
}

function readPrevTexts(prevBuild: string | null): Set<string> {
  if (!prevBuild) return new Set();
  const path = join(prevBuild, 'texts.csv');
  if (!existsSync(path)) return new Set();
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  if (lines.length < 2) return new Set();
  const header = lines[0].split(',');
  const slugIdx = header.indexOf('slug');
  if (slugIdx < 0) return new Set();
  const slugs = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    // Naive split — slug never contains a comma in our schema.
    const cols = line.split(',');
    if (cols[slugIdx]) slugs.add(cols[slugIdx]);
  }
  return slugs;
}

function buildChangelog(
  version: string,
  stats: BuildStats,
  prevBuild: string | null,
  existingChangelog: string | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const header =
    '# Changelog\n\nAll notable changes to the sohamhamso dataset.\nVersion scheme: `vYYYY.MM.DD`.\n\n';

  const newTextsLine =
    stats.newTexts.length > 0
      ? `- New texts: ${stats.newTexts.join(', ')}\n`
      : '- No new texts (re-publish or non-text additions).\n';

  const prevNote = prevBuild
    ? `- Diffed against previous build: \`${prevBuild.split('/').pop()}\`.\n`
    : '- First published build.\n';

  const entry = `## ${version} — ${today}

${prevNote}- Texts: ${stats.texts}
- Verses: ${stats.verses}
- Translations (reviewed/published): ${stats.translations}
- Word glosses: ${stats.glosses}
- Parallel-passage links: ${stats.parallels}
- Languages: ${stats.langs.join(', ') || '(none yet)'}
${newTextsLine}
`;

  // If an existing CHANGELOG.md is found in the repo root (unlikely for
  // dataset bundle, but harmless), prepend the new entry under the header.
  if (existingChangelog?.startsWith('# Changelog')) {
    const rest = existingChangelog.replace(/^# Changelog[\s\S]*?\n\n/, '');
    return `${header + entry}\n${rest}`;
  }
  return header + entry;
}

// ---------------------------------------------------------------
// SHA-256 over every file in the output dir
// ---------------------------------------------------------------

function walk(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(p, base));
    } else if (entry.isFile()) {
      out.push(p);
    }
  }
  return out;
}

function writeChecksums(dir: string): { files: number; bytes: number } {
  const files = walk(dir)
    .filter((f) => relative(dir, f) !== 'checksums.sha256')
    .sort();

  const lines: string[] = [];
  for (const f of files) {
    const data = readFileSync(f);
    const hash = createHash('sha256').update(data).digest('hex');
    const rel = relative(dir, f);
    lines.push(`${hash}  ${rel}`);
  }
  const body = `${lines.join('\n')}\n`;
  const out = join(dir, 'checksums.sha256');
  writeFileSync(out, body, 'utf8');
  return { files: files.length, bytes: Buffer.byteLength(body, 'utf8') };
}

// ---------------------------------------------------------------
// Copy a repo file into the bundle, with fallback content if missing.
// ---------------------------------------------------------------

function copyOrWrite(src: string | null, dst: string, fallback: string | null): void {
  if (src && existsSync(src)) {
    copyFileSync(src, dst);
    return;
  }
  if (fallback !== null) {
    writeFileSync(dst, fallback, 'utf8');
    return;
  }
  throw new Error(`Missing required file: ${src ?? dst}`);
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

function main(): void {
  const args = parseArgs();
  assertVersion(args.version);

  if (!existsSync(args.db)) {
    throw new Error(
      `DB not found at ${args.db}. Run \`bun pipeline/ingest/init-db.ts\` and \`bun pipeline/ingest/ingest.ts\` first.`,
    );
  }

  const buildDir = join(args.out, `sohamhamso-dataset-${args.version}`);
  mkdirSync(buildDir, { recursive: true });

  const db = new Database(args.db, { readonly: true });

  // --- MIRI gate: hold pending_miri texts out of the whole bundle ---
  const heldSlugs = readPendingMiriSlugs(args.corpus);
  const heldTextIds = resolveHeldTextIds(db, heldSlugs);
  if (heldTextIds.size > 0) {
    const held = [...heldTextIds].sort().join(', ');
    console.warn('');
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('  MIRI PERMISSION HOLD — texts EXCLUDED from this bundle:');
    console.warn(`    ${held}`);
    console.warn('  These texts carry pending_miri: true in data/corpus/*.yaml.');
    console.warn('  They ship in a follow-up release once written Muktabodha');
    console.warn('  permission lands (see docs/MIRI-PERMISSION-REQUEST.md).');
    console.warn('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('');
  }

  // --- CSVs (exact schema order) ---
  const csvStats = {
    texts: writeCsv(
      join(buildDir, 'texts.csv'),
      TEXTS_COLS,
      rowsFor(db, 'texts', TEXTS_COLS, heldTextIds),
    ),
    verses: writeCsv(
      join(buildDir, 'verses.csv'),
      VERSES_COLS,
      rowsFor(db, 'verses', VERSES_COLS, heldTextIds),
    ),
    translations: writeCsv(
      join(buildDir, 'translations.csv'),
      TRANSLATIONS_COLS,
      rowsFor(db, 'translations', TRANSLATIONS_COLS, heldTextIds),
    ),
    word_glosses: writeCsv(
      join(buildDir, 'word_glosses.csv'),
      WORD_GLOSSES_COLS,
      rowsFor(db, 'word_glosses', WORD_GLOSSES_COLS, heldTextIds),
    ),
    parallels: writeCsv(
      join(buildDir, 'parallels.csv'),
      PARALLELS_COLS,
      rowsFor(db, 'parallels', PARALLELS_COLS, heldTextIds),
    ),
  };

  // --- JSON shards ---
  const jsonStats = emitJsonShards(db, join(buildDir, 'json'), heldTextIds);

  // --- TEI shards ---
  const teiStats = emitTeiShards(db, join(buildDir, 'tei'), heldTextIds);

  // --- README / LICENSE / ATTRIBUTION ---
  // README is bundle-specific (not a copy of the repo README): it includes the
  // pandas load snippet from the V1 DX Spec, the integrity-verification
  // command, and a list of THIS bundle's files. The repo README is the
  // project-level surface; the bundle README is the dataset-level surface.
  writeFileSync(join(buildDir, 'README.md'), datasetReadme(args.version), 'utf8');

  writeFileSync(join(buildDir, 'LICENSE-CC-BY-SA-4.0'), LICENSE_CC_BY_SA, 'utf8');

  copyOrWrite(
    join(args.repoRoot, 'ATTRIBUTION.md'),
    join(buildDir, 'ATTRIBUTION.md'),
    '# Attribution\n\nSee https://github.com/sohamhamso/sohamhamso/blob/main/ATTRIBUTION.md\n',
  );

  // --- CHANGELOG (diffed against previous build in args.out) ---
  const prevBuild = findPreviousBuild(args.out, args.version);
  const prevTexts = readPrevTexts(prevBuild);
  const stats = collectStats(db, prevTexts, heldTextIds);
  const existingChangelog = existsSync(join(args.repoRoot, 'CHANGELOG.md'))
    ? readFileSync(join(args.repoRoot, 'CHANGELOG.md'), 'utf8')
    : null;
  const changelog = buildChangelog(args.version, stats, prevBuild, existingChangelog);
  writeFileSync(join(buildDir, 'CHANGELOG.md'), changelog, 'utf8');

  // --- checksums.sha256 (MUST be last — hashes every file in the dir) ---
  writeChecksums(buildDir);

  db.close();

  // --- Final summary ---
  const allFiles = walk(buildDir);
  const totalBytes = allFiles.reduce((acc, f) => acc + statSync(f).size, 0);

  const summary = {
    version: args.version,
    output: buildDir,
    files: allFiles.length,
    bytes: totalBytes,
    csv: {
      texts: csvStats.texts.rows,
      verses: csvStats.verses.rows,
      translations: csvStats.translations.rows,
      word_glosses: csvStats.word_glosses.rows,
      parallels: csvStats.parallels.rows,
    },
    json_shards: jsonStats.files,
    tei_shards: teiStats.files,
    new_texts: stats.newTexts,
    held_texts: [...heldTextIds].sort(),
    langs: stats.langs,
  };

  console.log('sohamhamso dataset build complete:');
  console.log(JSON.stringify(summary, null, 2));
  console.log(
    `\n  ${allFiles.length} files, ${(totalBytes / 1024).toFixed(1)} KiB at:\n  ${buildDir}`,
  );
}

// Guarded so unit tests can import readPendingMiriSlugs/holdWhere without
// triggering a full build (same pattern as pipeline/ingest/ingest.ts).
if (import.meta.main) {
  main();
}
